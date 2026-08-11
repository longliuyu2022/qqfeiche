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
 * Deterministically places boost pads and jump ramps on the straightest parts
 * of a closed track curve. Same curve + options always yield the same layout;
 * the trackId string seeds the variation between maps.
 */
export function computeTrackFeatures(curve, { trackId, roadWidth = 16, padCount = 6, rampCount = 2 } = {}) {
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

  return Object.freeze({
    boostPads: Object.freeze(boostPads),
    ramps: Object.freeze(ramps),
    trackLength,
    meta: Object.freeze({
      trackId: id,
      seed: seedBase,
      curvatureSamples: CURVATURE_SAMPLES,
      radiusFloor: rungUsed.radiusFloor,
      minSpacing: rungUsed.minSpacing,
    }),
  });
}

/**
 * THREE-free zone data for the vehicle controller. All values are plain
 * numbers/strings; start < end is guaranteed (zones never wrap across t = 0).
 */
export function featureZonesForPhysics(features) {
  if (!features) return { pads: [], ramps: [] };
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
  return { pads, ramps };
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
