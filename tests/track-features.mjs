import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ROAD_WIDTH, TRACK_CURVE } from '../src/night-track.js';
import { DAY_TRACK_CURVE } from '../src/day-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
} from '../src/scenic-worlds.js';
import {
  computeTrackFeatures,
  featureZonesForPhysics,
  rampHeightAt,
  shortcutGuardrailZones,
} from '../src/track-features.js';
import { buildTrackFeatureMeshes } from '../src/track-feature-meshes.js';

const curves = {
  night: TRACK_CURVE,
  day: DAY_TRACK_CURVE,
  alpine: ALPINE_TRACK_CURVE,
  canyon: CANYON_TRACK_CURVE,
  coast: COAST_TRACK_CURVE,
};

function turnRadiusAt(curve, progress, sampleCount = 1600, sampleSpan = 3) {
  const sampleDistance = curve.getLength() / sampleCount;
  const index = Math.round(progress * sampleCount);
  const before = curve.getTangentAt(
    ((index - sampleSpan + sampleCount) % sampleCount) / sampleCount,
  ).setY(0).normalize();
  const after = curve.getTangentAt(
    ((index + sampleSpan) % sampleCount) / sampleCount,
  ).setY(0).normalize();
  const angle = Math.acos(THREE.MathUtils.clamp(before.dot(after), -1, 1));
  return (sampleDistance * sampleSpan * 2) / Math.max(angle, 1e-6);
}

function circularDistance(a, b) {
  const distance = Math.abs(a - b);
  return Math.min(distance, 1 - distance);
}

const snapshotFeatures = (features) => ({
  trackLength: features.trackLength,
  pads: features.boostPads.map((pad) => ({
    id: pad.id,
    progress: pad.progress,
    length: pad.length,
    width: pad.width,
    point: pad.point.toArray(),
    tangent: pad.tangent.toArray(),
    normal: pad.normal.toArray(),
    spine: pad.spine.map((frame) => frame.point.toArray()),
  })),
  ramps: features.ramps.map((ramp) => ({
    id: ramp.id,
    progress: ramp.progress,
    endProgress: ramp.endProgress,
    height: ramp.height,
    width: ramp.width,
    point: ramp.point.toArray(),
    endPoint: ramp.endPoint.toArray(),
  })),
});

const summary = {};
for (const [trackId, curve] of Object.entries(curves)) {
  const features = computeTrackFeatures(curve, { trackId, roadWidth: ROAD_WIDTH });
  const repeat = computeTrackFeatures(curve, { trackId, roadWidth: ROAD_WIDTH });
  assert.deepEqual(
    snapshotFeatures(features),
    snapshotFeatures(repeat),
    `${trackId} feature layout must be deterministic`,
  );

  assert.equal(features.boostPads.length, 6, `${trackId} must place 6 boost pads`);
  assert.equal(features.ramps.length, 2, `${trackId} must place 2 ramps`);
  assert.equal(features.trackLength, curve.getLength(), `${trackId} trackLength must come from getLength()`);
  assert.ok(Object.isFrozen(features) && Object.isFrozen(features.boostPads) && Object.isFrozen(features.ramps));
  assert.equal(features.meta.minSpacing, 0.06, `${trackId} must keep the full 6% spacing`);
  assert.ok(features.meta.radiusFloor >= 66, `${trackId} must not need the relaxed curvature fallback`);

  for (const pad of features.boostPads) {
    assert.ok(Object.isFrozen(pad), `${pad.id} must be frozen`);
    assert.equal(pad.length, 14);
    assert.ok(Math.abs(pad.width - ROAD_WIDTH * 0.55) < 1e-9);
    for (const vector of [pad.point, pad.tangent, pad.normal]) assert.ok(vector instanceof THREE.Vector3);
    assert.ok(Math.abs(pad.tangent.length() - 1) < 1e-6, `${pad.id} tangent must be normalized`);
    assert.ok(pad.normal.y > 0.6, `${pad.id} normal must point roughly up`);
  }
  for (const ramp of features.ramps) {
    assert.ok(Object.isFrozen(ramp), `${ramp.id} must be frozen`);
    assert.equal(ramp.length, 16);
    assert.ok(ramp.height >= 2.2 && ramp.height <= 3.0, `${ramp.id} height must stay in [2.2, 3.0]`);
    assert.ok(Math.abs(ramp.width - ROAD_WIDTH * 0.62) < 1e-9);
    for (const vector of [ramp.point, ramp.tangent, ramp.normal]) assert.ok(vector instanceof THREE.Vector3);
    const spanMeters = (ramp.endProgress - ramp.progress) * features.trackLength;
    assert.ok(Math.abs(spanMeters - 16) < 1e-6, `${ramp.id} zone span must cover 16 m`);
  }

  const zones = featureZonesForPhysics(features);
  assert.equal(zones.pads.length, 6);
  assert.equal(zones.ramps.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(zones)),
    zones,
    `${trackId} physics zones must be plain THREE-free data`,
  );

  const allZones = [
    ...zones.pads.map((zone) => ({ ...zone, kind: 'pad' })),
    ...zones.ramps.map((zone) => ({ ...zone, kind: 'ramp' })),
  ];
  for (const zone of allZones) {
    assert.equal(typeof zone.id, 'string');
    for (const value of [zone.start, zone.end, zone.halfWidth]) assert.equal(typeof value, 'number');
    assert.ok(zone.start < zone.end, `${zone.id} zone must not wrap across t=0`);
    assert.ok(zone.start >= 0.03 - 1e-9 && zone.end <= 0.97 + 1e-9, `${zone.id} must avoid the start area`);
    assert.ok(zone.halfWidth > 3 && zone.halfWidth < 8, `${zone.id} halfWidth must fit the 16 m road`);
    const radius = turnRadiusAt(curve, (zone.start + zone.end) / 2);
    assert.ok(radius > 60, `${zone.id} midpoint turn radius must exceed 60 m (got ${radius.toFixed(1)})`);
  }

  const ordered = [...allZones].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      ordered[index].start > ordered[index - 1].end,
      `${trackId} zones ${ordered[index - 1].id} and ${ordered[index].id} must not overlap`,
    );
  }
  const centers = ordered.map((zone) => (zone.start + zone.end) / 2);
  for (let left = 0; left < centers.length; left += 1) {
    for (let right = left + 1; right < centers.length; right += 1) {
      assert.ok(
        circularDistance(centers[left], centers[right]) >= 0.06 - 1e-9,
        `${trackId} features ${ordered[left].id} and ${ordered[right].id} must keep 6% spacing`,
      );
    }
  }

  for (const rampZone of zones.ramps) {
    assert.equal(rampHeightAt(rampZone, rampZone.start), 0, `${rampZone.id} height at start must be 0`);
    assert.ok(
      Math.abs(rampHeightAt(rampZone, rampZone.end) - rampZone.height) < 1e-9,
      `${rampZone.id} height at end must equal ramp height`,
    );
    assert.equal(rampHeightAt(rampZone, rampZone.start - 0.004), 0);
    assert.equal(rampHeightAt(rampZone, rampZone.end + 0.004), 0);
    const middle = rampHeightAt(rampZone, (rampZone.start + rampZone.end) / 2);
    assert.ok(middle > rampZone.height * 0.45 && middle < rampZone.height * 0.55);
    let previous = -1e-9;
    for (let step = 0; step <= 24; step += 1) {
      const height = rampHeightAt(rampZone, rampZone.start + ((rampZone.end - rampZone.start) * step) / 24);
      assert.ok(height >= previous, `${rampZone.id} profile must rise monotonically`);
      previous = height;
    }
  }

  const group = buildTrackFeatureMeshes(features, { theme: trackId });
  assert.ok(group.isGroup);
  assert.equal(typeof group.userData.update, 'function');
  let meshCount = 0;
  group.traverse((object) => { if (object.isMesh) meshCount += 1; });
  assert.ok(meshCount > 0 && meshCount <= 12, `${trackId} feature meshes must stay within 12 draw calls`);
  const chevrons = group.getObjectByName('BoostPadChevrons');
  const rails = group.getObjectByName('RampRails');
  assert.ok(chevrons && rails, `${trackId} must build pad chevrons and ramp rails`);
  group.userData.update(0.35);
  const early = chevrons.material.opacity;
  group.userData.update(1.05);
  assert.ok(Math.abs(chevrons.material.opacity - early) > 1e-4, `${trackId} pad pulse must animate`);

  summary[trackId] = {
    pads: zones.pads.map((zone) => Number(((zone.start + zone.end) / 2).toFixed(4))),
    ramps: zones.ramps.map((zone) => [Number(zone.start.toFixed(4)), Number(zone.end.toFixed(4))]),
    rampHeights: zones.ramps.map((zone) => Number(zone.height.toFixed(2))),
    radiusFloor: features.meta.radiusFloor,
    minMidRadius: Math.round(Math.min(...allZones.map((zone) => turnRadiusAt(curve, (zone.start + zone.end) / 2)))),
    meshCount,
  };
}

const nightLayout = computeTrackFeatures(TRACK_CURVE, { trackId: 'night', roadWidth: ROAD_WIDTH });
const altLayout = computeTrackFeatures(TRACK_CURVE, { trackId: 'night-alt', roadWidth: ROAD_WIDTH });
assert.notDeepEqual(
  nightLayout.boostPads.map((pad) => pad.progress),
  altLayout.boostPads.map((pad) => pad.progress),
  'different trackId seeds must vary the layout on the same curve',
);

const defaults = computeTrackFeatures(TRACK_CURVE, { trackId: 'night' });
assert.equal(defaults.boostPads.length, 6);
assert.ok(Math.abs(defaults.boostPads[0].width - 16 * 0.55) < 1e-9, 'roadWidth must default to 16');

const custom = computeTrackFeatures(TRACK_CURVE, { trackId: 'night', padCount: 3, rampCount: 1 });
assert.equal(custom.boostPads.length, 3);
assert.equal(custom.ramps.length, 1);

assert.deepEqual(featureZonesForPhysics(null), { pads: [], ramps: [], shortcuts: [] });
assert.equal(rampHeightAt(null, 0.5), 0);
assert.equal(rampHeightAt({ start: 0.4, end: 0.4, height: 2.5 }, 0.4), 0, 'degenerate zone must be inert');

const noShortcuts = computeTrackFeatures(TRACK_CURVE, { trackId: 'night', shortcutCount: 0 });
assert.equal(noShortcuts.shortcuts.length, 0, 'shortcutCount 0 must disable branches');
assert.equal(noShortcuts.meta.shortcutsPlaced, 0);
assert.equal(noShortcuts.meta.shortcutShortfall, null, 'asking for zero branches is not a shortfall');

const SHORTCUT_MIN_GAP = 0.05;

/** Smallest circular gap between two non-wrapping spans; negative when they overlap. */
function shortcutSpanGap(a, b) {
  if (a.progress <= b.endProgress && b.progress <= a.endProgress) return -1;
  const direct = a.progress > b.endProgress ? a.progress - b.endProgress : b.progress - a.endProgress;
  const around = 1 - Math.max(a.endProgress, b.endProgress) + Math.min(a.progress, b.progress);
  return Math.min(direct, around);
}

/**
 * Every hard rule a branch has to satisfy, applied to each branch of a layout:
 * the constraints are per-shortcut, not per-track, now that a lap carries more
 * than one. Returns the compact summary rows for the report.
 */
function auditShortcuts(trackId, curve, layout, requested) {
  const list = layout.shortcuts;
  assert.ok(
    list.length >= 1 && list.length <= requested,
    `${trackId} must offer between 1 and ${requested} shortcuts (got ${list.length})`,
  );
  assert.equal(layout.meta.shortcutsRequested, requested, `${trackId} must record the requested branch count`);
  assert.equal(layout.meta.shortcutsPlaced, list.length, `${trackId} must record the placed branch count`);
  if (list.length < requested) {
    assert.equal(
      typeof layout.meta.shortcutShortfall,
      'string',
      `${trackId} must explain why it fell back to ${list.length} branches`,
    );
  } else {
    assert.equal(layout.meta.shortcutShortfall, null, `${trackId} must not report a shortfall when full`);
  }

  const zones = featureZonesForPhysics(layout).shortcuts;
  assert.equal(zones.length, list.length, `${trackId} physics zones must mirror the branch list`);
  const mechanismZones = [
    ...layout.boostPads.map((pad) => ({ id: pad.id, start: pad.progress, end: pad.endProgress })),
    ...layout.ramps.map((ramp) => ({ id: ramp.id, start: ramp.progress, end: ramp.endProgress })),
  ];

  list.forEach((shortcut, index) => {
    const zone = zones[index];
    assert.equal(zone.id, shortcut.id, `${trackId} branch ${index} must keep its id in the physics zone`);

    assert.ok(shortcut.progress > 0 && shortcut.endProgress < 1, `${shortcut.id} must not wrap t=0`);
    assert.ok(shortcut.endProgress > shortcut.progress, `${shortcut.id} span must be ordered`);
    assert.ok(
      shortcut.progress >= 0.03 - 1e-9 && shortcut.endProgress <= 0.97 + 1e-9,
      `${shortcut.id} must avoid the start area`,
    );
    assert.ok(shortcut.savedMeters >= 12, `${shortcut.id} must save a meaningful distance on its own`);
    assert.ok(shortcut.pathLength < shortcut.savedMeters + (shortcut.endProgress - shortcut.progress) * layout.trackLength);
    assert.ok(shortcut.maxDeviation <= 52, `${shortcut.id} must stay inside the reserved corridor`);
    assert.ok(shortcut.side === 1 || shortcut.side === -1, `${shortcut.id} needs a branch side`);
    assert.equal(zone.points.length, shortcut.points.length);
    assert.ok(zone.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z)));

    // The branch must start and finish on the drivable road it forks from, so a
    // car hugging that shoulder can flow into and out of it without a jump.
    const entryPoint = curve.getPointAt(shortcut.progress);
    const exitPoint = curve.getPointAt(shortcut.endProgress);
    const first = shortcut.points[0];
    const last = shortcut.points.at(-1);
    const entryOffset = Math.hypot(first.x - entryPoint.x, first.z - entryPoint.z);
    const exitOffset = Math.hypot(last.x - exitPoint.x, last.z - exitPoint.z);
    assert.ok(entryOffset <= ROAD_WIDTH / 2, `${shortcut.id} must fork from the road (got ${entryOffset.toFixed(1)}m)`);
    assert.ok(exitOffset <= ROAD_WIDTH / 2, `${shortcut.id} must rejoin onto the road (got ${exitOffset.toFixed(1)}m)`);
    assert.ok(entryOffset > 2, `${shortcut.id} mouth must sit off the centre line`);

    // Its mouth and exit have to be clean road: no pad, no ramp, and no other
    // branch's corridor sitting where a driver has to commit to the fork.
    const spanT = shortcut.endProgress - shortcut.progress;
    const lead = Math.max(0.012, spanT * 0.2);
    const blocking = [
      ...mechanismZones,
      ...list
        .filter((other) => other.id !== shortcut.id)
        .map((other) => ({ id: other.id, start: other.progress, end: other.endProgress })),
    ];
    for (const other of blocking) {
      const clashesMouth = other.end >= shortcut.progress - 0.012 && other.start <= shortcut.progress + lead;
      const clashesExit = other.end >= shortcut.endProgress - lead && other.start <= shortcut.endProgress + 0.012;
      assert.ok(
        !clashesMouth && !clashesExit,
        `${shortcut.id} mouth/exit must stay clear of ${other.id}`,
      );
    }

    // It must not graze an unrelated part of the loop.
    let minForeignDistance = Infinity;
    for (const point of shortcut.points) {
      const deviation = Math.hypot(point.x - entryPoint.x, point.z - entryPoint.z);
      if (deviation < 22) continue;
      for (let sample = 0; sample < 400; sample += 1) {
        const t = sample / 400;
        const inSpan = t >= shortcut.progress - 0.06 && t <= shortcut.endProgress + 0.06;
        if (inSpan) continue;
        const linePoint = curve.getPointAt(t);
        minForeignDistance = Math.min(minForeignDistance, Math.hypot(point.x - linePoint.x, point.z - linePoint.z));
      }
    }
    assert.ok(
      minForeignDistance >= 22,
      `${shortcut.id} must not cross another part of the track (min ${minForeignDistance.toFixed(1)}m)`,
    );
  });

  // Branches share a lap: never overlapping, always a stretch of normal racing
  // line between them.
  for (let left = 0; left < list.length; left += 1) {
    for (let right = left + 1; right < list.length; right += 1) {
      const gap = shortcutSpanGap(list[left], list[right]);
      assert.ok(gap > 0, `${list[left].id} and ${list[right].id} must not overlap`);
      assert.ok(
        gap >= SHORTCUT_MIN_GAP - 1e-9,
        `${list[left].id} and ${list[right].id} must keep a 5% lap gap (got ${(gap * 100).toFixed(1)}%)`,
      );
    }
  }
  assert.deepEqual(
    list.map((shortcut) => shortcut.id),
    list.map((_, index) => `${trackId}-shortcut-${index + 1}`),
    `${trackId} branch ids must stay sequential`,
  );

  return list.map((shortcut) => ({
    span: [Number(shortcut.progress.toFixed(3)), Number(shortcut.endProgress.toFixed(3))],
    side: shortcut.side,
    deviation: Number(shortcut.maxDeviation.toFixed(1)),
    saved: Number(shortcut.savedMeters.toFixed(1)),
  }));
}

const DEFAULT_SHORTCUTS = computeTrackFeatures(TRACK_CURVE, { trackId: 'night' }).meta.shortcutsRequested;
assert.equal(DEFAULT_SHORTCUTS, 2, 'shortcutCount must default to 2');

const shortcutSummary = {};
for (const [trackId, curve] of Object.entries(curves)) {
  const layout = computeTrackFeatures(curve, { trackId, roadWidth: ROAD_WIDTH });
  const rows = auditShortcuts(trackId, curve, layout, DEFAULT_SHORTCUTS);

  const repeat = computeTrackFeatures(curve, { trackId, roadWidth: ROAD_WIDTH });
  assert.deepEqual(
    repeat.shortcuts.map((entry) => [entry.progress, entry.endProgress, entry.side]),
    layout.shortcuts.map((entry) => [entry.progress, entry.endProgress, entry.side]),
    `${trackId} shortcut placement must be deterministic`,
  );
  assert.equal(repeat.shortcuts.length, layout.shortcuts.length, `${trackId} branch count must be deterministic`);

  shortcutSummary[trackId] = { count: layout.shortcuts.length, branches: rows };
}

// Asking for a third branch must never throw; a track simply keeps whatever
// number of legal corners it has.
const tripleSummary = {};
for (const [trackId, curve] of Object.entries(curves)) {
  const layout = computeTrackFeatures(curve, { trackId, roadWidth: ROAD_WIDTH, shortcutCount: 3 });
  auditShortcuts(trackId, curve, layout, 3);
  assert.ok(
    layout.shortcuts.length >= shortcutSummary[trackId].count,
    `${trackId} must not lose branches when more are requested`,
  );
  tripleSummary[trackId] = layout.shortcuts.length;
}

// A track that runs out of legal corners degrades instead of throwing, and says
// why in meta.
const greedy = computeTrackFeatures(TRACK_CURVE, { trackId: 'night', roadWidth: ROAD_WIDTH, shortcutCount: 12 });
assert.ok(greedy.shortcuts.length >= 1 && greedy.shortcuts.length < 12, 'an over-ask must degrade, not throw');
assert.equal(greedy.meta.shortcutsRequested, 12);
assert.ok(
  greedy.meta.shortcutShortfall.startsWith(`${greedy.shortcuts.length}/12 placed:`),
  'the shortfall note must state the placed and requested counts',
);
assert.equal(computeTrackFeatures(TRACK_CURVE, { trackId: 'night', shortcutCount: Number.NaN }).shortcuts.length, 0);

// The consumers of these lists (driving.js, the world builders) only ever see
// longer arrays — the row shape must not move.
const guardrailZones = shortcutGuardrailZones(nightLayout);
assert.equal(guardrailZones.length, nightLayout.shortcuts.length);
for (const zone of guardrailZones) {
  assert.deepEqual(Object.keys(zone), ['start', 'end', 'side'], 'guardrail zone shape must not change');
  assert.ok(zone.start < zone.end && (zone.side === 1 || zone.side === -1));
}
assert.deepEqual(shortcutGuardrailZones(null), []);
assert.deepEqual(
  Object.keys(featureZonesForPhysics(nightLayout).shortcuts[0]),
  ['id', 'start', 'end', 'side', 'halfWidth', 'savedMeters', 'points'],
  'physics shortcut zone shape must not change',
);

const fallbackGroup = buildTrackFeatureMeshes(nightLayout, { theme: 'unknown-theme' });
assert.equal(fallbackGroup.userData.theme, 'night', 'unknown themes must fall back to night');

const shortcutGroup = buildTrackFeatureMeshes(nightLayout, { theme: 'night' });
assert.ok(
  shortcutGroup.children.some((child) => child.name === 'ShortcutDecks'),
  'a track with a shortcut must render its branch road',
);
assert.ok(shortcutGroup.children.length <= 12, 'feature meshes must stay inside the draw call budget');

console.log(JSON.stringify({
  status: 'track features ok',
  tracks: summary,
  shortcuts: shortcutSummary,
  shortcutsAtCountThree: tripleSummary,
}));
