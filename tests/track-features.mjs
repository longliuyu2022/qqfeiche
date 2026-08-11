import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ROAD_WIDTH, TRACK_CURVE } from '../src/night-track.js';
import { DAY_TRACK_CURVE } from '../src/day-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
} from '../src/scenic-worlds.js';
import { computeTrackFeatures, featureZonesForPhysics, rampHeightAt } from '../src/track-features.js';
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

assert.deepEqual(featureZonesForPhysics(null), { pads: [], ramps: [] });
assert.equal(rampHeightAt(null, 0.5), 0);
assert.equal(rampHeightAt({ start: 0.4, end: 0.4, height: 2.5 }, 0.4), 0, 'degenerate zone must be inert');

const fallbackGroup = buildTrackFeatureMeshes(nightLayout, { theme: 'unknown-theme' });
assert.equal(fallbackGroup.userData.theme, 'night', 'unknown themes must fall back to night');

console.log(JSON.stringify({ status: 'track features ok', tracks: summary }));
