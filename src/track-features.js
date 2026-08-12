import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

const CURVATURE_SAMPLES = 400;
const PAD_LENGTH = 14;
const PAD_WIDTH_RATIO = 0.55;
const PAD_SPINE_SAMPLES = 5;
const RAMP_LENGTH = 16;
const RAMP_WIDTH_RATIO = 0.62;
const RAMP_HEIGHT_MIN = 2.2;
const RAMP_HEIGHT_SPAN = 0.8;
const START_ZONE_MARGIN = 0.03;
const ZONE_CLEARANCE_METERS = 5;
const PLACEMENT_ATTEMPTS = 32;
const SHORTCUT_WIDTH_RATIO = 0.68;
const SHORTCUT_SPAN_OPTIONS = Object.freeze([120, 170, 230, 300, 380]);
const SHORTCUT_PATH_SAMPLES = 15;
const SHORTCUT_CUT = 0.86;
const SHORTCUT_MAX_DEVIATION = 52;
const SHORTCUT_MIN_SAVED = 12;
const SHORTCUT_SELF_CLEARANCE = 22;
const SHORTCUT_RADIUS_CEILING = 420;
// Two branches on the same lap must stay clearly separate stretches of road:
// their progress spans may never overlap and have to keep a 5% lap gap so a
// driver always gets a stretch of normal racing line between them.
const SHORTCUT_MIN_GAP = 0.05;

// Relaxation ladder: prefer very straight road and full spacing, only loosen if a
// track cannot fit every feature. The floor never drops below 62 m so features
// always stay on comfortably straight sections (turn radius well above 60 m).
const PLACEMENT_LADDER = Object.freeze([
  Object.freeze({ radiusFloor: 95, minSpacing: 0.06 }),
  Object.freeze({ radiusFloor: 85, minSpacing: 0.06 }),
  Object.freeze({ radiusFloor: 75, minSpacing: 0.06 }),
  Object.freeze({ radiusFloor: 66, minSpacing: 0.06 }),
  Object.freeze({ radiusFloor: 66, minSpacing: 0.05 }),
  Object.freeze({ radiusFloor: 62, minSpacing: 0.045 }),
]);

function hashStringSeed(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

/** Horizontal turn radius (meters) sampled at CURVATURE_SAMPLES points along the loop. */
function sampleTurnRadii(curve, trackLength, sampleCount) {
  const tangents = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    tangents[index] = curve.getTangentAt(index / sampleCount).setY(0).normalize();
  }
  const step = trackLength / sampleCount;
  const radii = new Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    const before = tangents[(index - 1 + sampleCount) % sampleCount];
    const after = tangents[(index + 1) % sampleCount];
    const dot = Math.min(1, Math.max(-1, before.dot(after)));
    const angle = Math.acos(dot);
    radii[index] = (step * 2) / Math.max(angle, 1e-6);
  }
  return radii;
}

/**
 * Candidate zone centers whose whole span (plus approach clearance) stays on
 * road straighter than `radiusFloor`, away from the start area, and never
 * wrapping across t = 0. Sorted straightest-first for quality-biased picking.
 */
function eligibleCenters(radii, sampleCount, spanT, clearanceT, radiusFloor) {
  const half = spanT / 2 + clearanceT;
  const centers = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleCount;
    const startT = t - half;
    const endT = t + half;
    if (startT < START_ZONE_MARGIN || endT > 1 - START_ZONE_MARGIN) continue;
    let minRadius = Infinity;
    const first = Math.max(0, Math.floor(startT * sampleCount));
    const last = Math.min(sampleCount - 1, Math.ceil(endT * sampleCount));
    for (let sample = first; sample <= last; sample += 1) {
      if (radii[sample] < minRadius) minRadius = radii[sample];
    }
    if (minRadius >= radiusFloor) centers.push({ index, t, score: minRadius });
  }
  centers.sort((a, b) => b.score - a.score || a.index - b.index);
  return centers;
}

function attemptPlacement(rng, rampPool, padPool, rampCount, padCount, minSpacing) {
  const placedCenters = [];
  const takeFrom = (pool, needed, sink) => {
    for (let taken = 0; taken < needed; taken += 1) {
      const available = pool.filter(
        (candidate) => placedCenters.every((t) => circularDistance(candidate.t, t) >= minSpacing),
      );
      if (available.length === 0) return false;
      // Quality-biased seeded pick: pools are sorted straightest-first, the
      // exponent skews the draw toward the front without being deterministic-flat.
      const pick = available[Math.min(available.length - 1, Math.floor(rng() ** 1.5 * available.length))];
      placedCenters.push(pick.t);
      sink.push(pick);
    }
    return true;
  };
  const ramps = [];
  const pads = [];
  if (!takeFrom(rampPool, rampCount, ramps)) return null;
  if (!takeFrom(padPool, padCount, pads)) return null;
  return { ramps, pads };
}

function frameAt(curve, t) {
  const point = curve.getPointAt(t);
  const tangent = curve.getTangentAt(t).normalize();
  const side = new THREE.Vector3().crossVectors(UP, tangent);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  else side.normalize();
  const normal = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { point, tangent, side, normal };
}

/**
 * Traces one candidate corner cut. Returns null when the geometry is not worth
 * a shortcut: too little distance saved, too far off the racing line, or the
 * corridor would run through an unrelated part of the loop.
 */
function traceShortcut(curve, spine, startT, endT, spanT, trackLength, roadWidth) {
  const startPoint = curve.getPointAt(startT);
  const endPoint = curve.getPointAt(endT);

  // Peak lateral cut, derived from how far the arc bows away from its chord.
  const midFrame = frameAt(curve, (startT + endT) / 2);
  const chordMid = startPoint.clone().lerp(endPoint, 0.5);
  const bow = chordMid.clone().sub(midFrame.point);
  const insideSign = Math.sign(bow.dot(midFrame.side)) || 1;
  const sagitta = Math.hypot(bow.x, bow.z);
  // The branch peels off from the road shoulder rather than the centre line so
  // the fork is something a car already hugging that edge can simply follow.
  const edgeOffset = roadWidth * 0.5 - 2;
  const peak = Math.min(SHORTCUT_MAX_DEVIATION, Math.max(edgeOffset + 5, sagitta * SHORTCUT_CUT));
  if (peak <= edgeOffset + 1) return null;

  const points = [];
  let maxDeviation = 0;
  for (let sample = 0; sample < SHORTCUT_PATH_SAMPLES; sample += 1) {
    const u = sample / (SHORTCUT_PATH_SAMPLES - 1);
    const arcT = startT + spanT * u;
    const frame = frameAt(curve, arcT);
    const magnitude = edgeOffset + (peak - edgeOffset) * Math.sin(Math.PI * u);
    points.push(frame.point.clone().addScaledVector(frame.side, insideSign * magnitude));
    maxDeviation = Math.max(maxDeviation, magnitude);
  }
  if (maxDeviation > SHORTCUT_MAX_DEVIATION) return null;

  let pathLength = 0;
  for (let sample = 1; sample < points.length; sample += 1) {
    pathLength += Math.hypot(
      points[sample].x - points[sample - 1].x,
      points[sample].z - points[sample - 1].z,
    );
  }
  const saved = spanT * trackLength - pathLength;
  if (saved < SHORTCUT_MIN_SAVED) return null;

  // The corridor must not graze a different part of the loop. Only the bulging
  // middle is checked (the ends sit on the road shoulder), and the branch's own
  // span plus a lead-in margin is excluded from the comparison.
  const spanMargin = spanT + 0.05;
  for (const point of points) {
    const offsetFromLine = Math.hypot(point.x - startPoint.x, point.z - startPoint.z);
    if (offsetFromLine < SHORTCUT_SELF_CLEARANCE) continue;
    for (const sample of spine) {
      if (circularDistance(sample.t, (startT + endT) / 2) <= spanMargin / 2 + spanT / 2) continue;
      if (Math.hypot(point.x - sample.x, point.z - sample.z) < SHORTCUT_SELF_CLEARANCE) return null;
    }
  }
  return { points, maxDeviation, pathLength, saved, side: insideSign, startPoint, endPoint };
}

/**
 * Circular gap between two non-wrapping progress spans. Returns a negative
 * value when they overlap, otherwise the smaller of the two ways around.
 */
function spanGap(startA, endA, startB, endB) {
  if (startA <= endB && startB <= endA) return -1;
  const direct = startA > endB ? startA - endB : startB - endA;
  const around = 1 - Math.max(endA, endB) + Math.min(startA, startB);
  return Math.min(direct, around);
}

/**
 * Builds corner-cutting shortcuts: branch corridors that leave and rejoin the
 * racing line, trading a tighter, narrower line for a shorter lap distance.
 * Several span lengths are tried per corner and the biggest legal saving wins;
 * corners are visited tightest-first and every accepted branch reserves its own
 * span plus a 5% lap gap, so multiple branches never overlap or crowd.
 * Returns the branches plus a note describing why fewer than `count` fit.
 */
function buildShortcuts(curve, { id, roadWidth, trackLength, radii, sampleCount, takenZones, count }) {
  if (count <= 0) return { shortcuts: [], shortfallReason: null };
  const spine = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / sampleCount;
    const point = curve.getPointAt(t);
    spine.push({ t, x: point.x, z: point.z });
  }

  // A branch may bypass a pad mid-corner, but its mouth and exit have to be
  // clean road: forking off a jump ramp — or off another branch's mouth — is
  // not a line anyone can drive.
  const mouthIsClear = (startT, endT, spanT, blockedZones) => {
    const lead = Math.max(0.012, spanT * 0.2);
    return blockedZones.every((zone) => {
      const clashesMouth = zone.end >= startT - 0.012 && zone.start <= startT + lead;
      const clashesExit = zone.end >= endT - lead && zone.start <= endT + 0.012;
      return !clashesMouth && !clashesExit;
    });
  };

  const candidates = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const centerT = index / sampleCount;
    if (radii[index] > SHORTCUT_RADIUS_CEILING) continue;
    candidates.push({ centerT, radius: radii[index] });
  }
  candidates.sort((a, b) => a.radius - b.radius || a.centerT - b.centerT);

  const accepted = [];
  const placed = [];
  const rejected = { crowded: 0, mouth: 0, geometry: 0 };
  for (const candidate of candidates) {
    if (accepted.length >= count) break;
    // Cheap pre-filter: a corner sitting inside (or right beside) an accepted
    // branch can never host one of its own, whatever span it is given.
    if (placed.some((zone) => candidate.centerT > zone.start - SHORTCUT_MIN_GAP
      && candidate.centerT < zone.end + SHORTCUT_MIN_GAP)) {
      rejected.crowded += 1;
      continue;
    }

    let best = null;
    for (const spanMeters of SHORTCUT_SPAN_OPTIONS) {
      const spanT = spanMeters / trackLength;
      if (spanT > 0.3) continue;
      const startT = candidate.centerT - spanT / 2;
      const endT = candidate.centerT + spanT / 2;
      if (startT < START_ZONE_MARGIN || endT > 1 - START_ZONE_MARGIN) continue;
      if (placed.some((zone) => spanGap(startT, endT, zone.start, zone.end) < SHORTCUT_MIN_GAP)) {
        rejected.crowded += 1;
        continue;
      }
      if (!mouthIsClear(startT, endT, spanT, takenZones.concat(placed))) {
        rejected.mouth += 1;
        continue;
      }
      const traced = traceShortcut(curve, spine, startT, endT, spanT, trackLength, roadWidth);
      if (!traced) {
        rejected.geometry += 1;
        continue;
      }
      if (!best || traced.saved > best.traced.saved) best = { traced, startT, endT, spanT };
    }
    if (!best) continue;

    const { traced, startT, endT } = best;
    placed.push({ start: startT, end: endT });
    accepted.push({ traced, startT, endT, radius: candidate.radius });
  }

  // Corners are picked tightest-first, but the branches ship in lap order so
  // their ids read the way a driver meets them, like the pads and ramps do.
  accepted.sort((a, b) => a.startT - b.startT);
  const shortcuts = accepted.map(({ traced, startT, endT, radius }, index) => Object.freeze({
    id: `${id}-shortcut-${index + 1}`,
    progress: startT,
    endProgress: endT,
    width: roadWidth * SHORTCUT_WIDTH_RATIO,
    side: traced.side,
    points: Object.freeze(traced.points),
    entry: Object.freeze({ point: traced.startPoint, tangent: curve.getTangentAt(startT).normalize() }),
    exit: Object.freeze({ point: traced.endPoint, tangent: curve.getTangentAt(endT).normalize() }),
    maxDeviation: traced.maxDeviation,
    pathLength: traced.pathLength,
    savedMeters: traced.saved,
    minTurnRadius: radius,
  }));

  let shortfallReason = null;
  if (shortcuts.length < count) {
    const dominant = rejected.crowded >= rejected.geometry && rejected.crowded >= rejected.mouth
      ? `no remaining corner keeps the ${SHORTCUT_MIN_GAP * 100}% gap from the branches already placed`
      : rejected.geometry >= rejected.mouth
        ? `remaining corners fail the corridor rules (saving, ${SHORTCUT_MAX_DEVIATION} m offset or ${SHORTCUT_SELF_CLEARANCE} m self clearance)`
        : 'remaining corners have their mouth or exit blocked by a pad, ramp or another branch';
    shortfallReason = `${shortcuts.length}/${count} placed: ${dominant}`;
  }
  return { shortcuts, shortfallReason };
}

/**
 * Deterministically places boost pads and jump ramps on the straightest parts
 * of a closed track curve. Same curve + options always yield the same layout;
 * the trackId string seeds the variation between maps.
 */
export function computeTrackFeatures(curve, { trackId, roadWidth = 16, padCount = 6, rampCount = 2, shortcutCount = 2 } = {}) {
  if (!curve || typeof curve.getPointAt !== 'function' || typeof curve.getTangentAt !== 'function') {
    throw new Error('computeTrackFeatures requires a THREE.Curve-compatible closed curve');
  }
  const id = typeof trackId === 'string' && trackId.length > 0 ? trackId : 'track';
  const trackLength = curve.getLength();
  const radii = sampleTurnRadii(curve, trackLength, CURVATURE_SAMPLES);
  const clearanceT = ZONE_CLEARANCE_METERS / trackLength;
  const padSpanT = PAD_LENGTH / trackLength;
  const rampSpanT = RAMP_LENGTH / trackLength;
  const seedBase = hashStringSeed(`${id}|${padCount}|${rampCount}`);

  let placement = null;
  let rungUsed = null;
  for (const rung of PLACEMENT_LADDER) {
    const rampPool = eligibleCenters(radii, CURVATURE_SAMPLES, rampSpanT, clearanceT, rung.radiusFloor);
    const padPool = eligibleCenters(radii, CURVATURE_SAMPLES, padSpanT, clearanceT, rung.radiusFloor);
    if (rampPool.length < rampCount || padPool.length < padCount) continue;
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS && !placement; attempt += 1) {
      const rng = mulberry32((seedBase + attempt * 0x9e3779b9) >>> 0);
      placement = attemptPlacement(rng, rampPool, padPool, rampCount, padCount, rung.minSpacing);
    }
    if (placement) {
      rungUsed = rung;
      break;
    }
  }
  if (!placement) {
    throw new Error(`computeTrackFeatures: no low-curvature layout found for "${id}"`);
  }

  placement.ramps.sort((a, b) => a.t - b.t);
  placement.pads.sort((a, b) => a.t - b.t);

  const heightRng = mulberry32((seedBase ^ 0x85ebca6b) >>> 0);
  const ramps = placement.ramps.map((slot, index) => {
    const startT = slot.t - rampSpanT / 2;
    const endT = startT + rampSpanT;
    const frame = frameAt(curve, startT);
    const endFrame = frameAt(curve, endT);
    return Object.freeze({
      id: `${id}-ramp-${index + 1}`,
      progress: startT,
      endProgress: endT,
      length: RAMP_LENGTH,
      height: RAMP_HEIGHT_MIN + heightRng() * RAMP_HEIGHT_SPAN,
      width: roadWidth * RAMP_WIDTH_RATIO,
      point: frame.point,
      tangent: frame.tangent,
      normal: frame.normal,
      side: frame.side,
      endPoint: endFrame.point,
      minTurnRadius: slot.score,
    });
  });

  const boostPads = placement.pads.map((slot, index) => {
    const startT = slot.t - padSpanT / 2;
    const endT = startT + padSpanT;
    const frame = frameAt(curve, slot.t);
    const spine = [];
    for (let sample = 0; sample < PAD_SPINE_SAMPLES; sample += 1) {
      const t = startT + (padSpanT * sample) / (PAD_SPINE_SAMPLES - 1);
      const spineFrame = frameAt(curve, t);
      spine.push(Object.freeze({
        point: spineFrame.point,
        tangent: spineFrame.tangent,
        side: spineFrame.side,
        normal: spineFrame.normal,
      }));
    }
    return Object.freeze({
      id: `${id}-pad-${index + 1}`,
      progress: startT,
      endProgress: endT,
      length: PAD_LENGTH,
      width: roadWidth * PAD_WIDTH_RATIO,
      point: frame.point,
      tangent: frame.tangent,
      normal: frame.normal,
      side: frame.side,
      spine: Object.freeze(spine),
      minTurnRadius: slot.score,
    });
  });

  const requestedShortcuts = Math.max(0, Math.floor(shortcutCount) || 0);
  const { shortcuts, shortfallReason } = buildShortcuts(curve, {
    id,
    roadWidth,
    trackLength,
    radii,
    sampleCount: CURVATURE_SAMPLES,
    takenZones: [
      ...boostPads.map((pad) => ({ start: pad.progress, end: pad.endProgress })),
      ...ramps.map((ramp) => ({ start: ramp.progress, end: ramp.endProgress })),
    ],
    count: requestedShortcuts,
  });

  return Object.freeze({
    boostPads: Object.freeze(boostPads),
    ramps: Object.freeze(ramps),
    shortcuts: Object.freeze(shortcuts),
    trackLength,
    meta: Object.freeze({
      trackId: id,
      seed: seedBase,
      curvatureSamples: CURVATURE_SAMPLES,
      radiusFloor: rungUsed.radiusFloor,
      minSpacing: rungUsed.minSpacing,
      shortcutsRequested: requestedShortcuts,
      shortcutsPlaced: shortcuts.length,
      shortcutMinGap: SHORTCUT_MIN_GAP,
      shortcutShortfall: shortfallReason,
    }),
  });
}

/**
 * THREE-free zone data for the vehicle controller. All values are plain
 * numbers/strings; start < end is guaranteed (zones never wrap across t = 0).
 */
export function featureZonesForPhysics(features) {
  if (!features) return { pads: [], ramps: [], shortcuts: [] };
  const trackLength = features.trackLength || 1;
  const pads = (features.boostPads ?? []).map((pad) => ({
    id: pad.id,
    start: pad.progress,
    end: pad.endProgress ?? pad.progress + pad.length / trackLength,
    halfWidth: pad.width / 2,
  }));
  const ramps = (features.ramps ?? []).map((ramp) => ({
    id: ramp.id,
    start: ramp.progress,
    end: ramp.endProgress,
    height: ramp.height,
    halfWidth: ramp.width / 2,
  }));
  const shortcuts = (features.shortcuts ?? []).map((shortcut) => ({
    id: shortcut.id,
    start: shortcut.progress,
    end: shortcut.endProgress,
    side: shortcut.side,
    halfWidth: shortcut.width / 2,
    savedMeters: shortcut.savedMeters,
    points: shortcut.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  }));
  return { pads, ramps, shortcuts };
}

/**
 * Guardrail-opening zones for the world builders: the racing-line band each
 * shortcut branches through, on the side it leaves toward.
 */
export function shortcutGuardrailZones(features) {
  return (features?.shortcuts ?? []).map((shortcut) => ({
    start: shortcut.progress,
    end: shortcut.endProgress,
    side: shortcut.side,
  }));
}

/**
 * Smooth ramp surface height at a lap progress value: 0 at the zone start,
 * `height` at the zone end (smoothstep easing), 0 outside the zone.
 */
export function rampHeightAt(rampZone, progress) {
  if (!rampZone || !Number.isFinite(progress)) return 0;
  const { start, end, height } = rampZone;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) return 0;
  if (progress < start || progress > end) return 0;
  const u = (progress - start) / (end - start);
  return u * u * (3 - 2 * u) * (height ?? 0);
}
