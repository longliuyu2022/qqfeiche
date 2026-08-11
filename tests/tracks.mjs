import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { TRACK_CURVE } from '../src/world.js';
import { DAY_TRACK_CURVE, createDayWorld } from '../src/day-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
  SCENIC_TRACK_CURVES,
  createScenicWorld,
} from '../src/scenic-worlds.js';
import { TRACK_CATALOG, normalizeTrackId } from '../src/track-catalog.js';

const expectedTrackIds = ['night', 'day', 'alpine', 'canyon', 'coast'];
assert.deepEqual(Object.keys(TRACK_CATALOG), expectedTrackIds);
for (const trackId of expectedTrackIds) assert.equal(normalizeTrackId(trackId), trackId);
assert.equal(normalizeTrackId('unknown'), 'night');
assert.ok(DAY_TRACK_CURVE.getLength() > 1200, 'day circuit should be race length');

const curves = {
  night: TRACK_CURVE,
  day: DAY_TRACK_CURVE,
  alpine: ALPINE_TRACK_CURVE,
  canyon: CANYON_TRACK_CURVE,
  coast: COAST_TRACK_CURVE,
};
assert.deepEqual(Object.keys(SCENIC_TRACK_CURVES), ['alpine', 'canyon', 'coast']);

function minimumTurnRadius(curve, sampleCount = 1600, sampleSpan = 3) {
  const sampleDistance = curve.getLength() / sampleCount;
  let minimum = Infinity;
  for (let index = 0; index < sampleCount; index += 1) {
    const before = curve.getTangentAt(
      ((index - sampleSpan + sampleCount) % sampleCount) / sampleCount,
    ).setY(0).normalize();
    const after = curve.getTangentAt(
      ((index + sampleSpan) % sampleCount) / sampleCount,
    ).setY(0).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(before.dot(after), -1, 1));
    minimum = Math.min(minimum, (sampleDistance * sampleSpan * 2) / Math.max(angle, 1e-6));
  }
  return minimum;
}

for (const [trackId, curve] of Object.entries(curves)) {
  const length = curve.getLength();
  const seamAlignment = curve.getTangentAt(0.998).setY(0).normalize()
    .dot(curve.getTangentAt(0.002).setY(0).normalize());
  const routeProbe = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16, trackSamples: 720 });
  assert.ok(length > 1650 && length < 2800, `${trackId} circuit length should be plausible`);
  assert.ok(seamAlignment > 0.72, `${trackId} circuit seam must not fold back into an opposing lane`);
  assert.ok(minimumTurnRadius(curve) > 12, `${trackId} circuit must not contain an impassable hairpin`);
  for (let index = 0; index < 160; index += 1) {
    const progress = index / 160;
    const point = curve.getPointAt(progress);
    const tangent = curve.getTangentAt(progress).setY(0).normalize();
    const sample = routeProbe.sampleTrack(point);
    const progressError = Math.abs(sample.progress - progress);
    const wrappedProgressError = Math.min(progressError, 1 - progressError);
    assert.ok(wrappedProgressError < 0.012, `${trackId} route point must map to the same track section`);
    assert.ok(sample.tangent.dot(tangent) > 0.92, `${trackId} route point must not map to an opposing lane`);
  }
}

const curveSignature = (curve) => [0.13, 0.37, 0.71]
  .flatMap((progress) => curve.getPointAt(progress).toArray().map((value) => Math.round(value)));
const signatures = Object.entries(curves).map(([trackId, curve]) => [trackId, curveSignature(curve)]);
for (let left = 0; left < signatures.length; left += 1) {
  for (let right = left + 1; right < signatures.length; right += 1) {
    assert.notDeepEqual(
      signatures[left][1],
      signatures[right][1],
      `${signatures[left][0]} and ${signatures[right][0]} must have distinct routes`,
    );
  }
}

const scene = new THREE.Scene();
const dayWorld = createDayWorld(scene);
assert.equal(dayWorld.world.name, 'SunvaleDayWorld');
assert.equal(dayWorld.road.name, 'DayCircuitRoad');
assert.ok(dayWorld.world.children.length > 10, 'day map should include scenery and landmarks');
assert.ok(scene.background instanceof THREE.Color);
dayWorld.update(4);

const expectedScenicWorlds = {
  alpine: ['FrostpeakAlpineWorld', 'FrostpeakCircuitRoad'],
  canyon: ['RedMesaCanyonWorld', 'RedMesaCircuitRoad'],
  coast: ['AzureCoastWorld', 'AzureCoastCircuitRoad'],
};
const scenicWorldObjects = {};
for (const [trackId, [worldName, roadName]] of Object.entries(expectedScenicWorlds)) {
  const scenicScene = new THREE.Scene();
  const scenicWorld = createScenicWorld(scenicScene, trackId, { qualityTier: 'balanced' });
  assert.equal(scenicWorld.world.name, worldName);
  assert.equal(scenicWorld.road.name, roadName);
  assert.ok(scenicWorld.world.children.length > 20, `${trackId} should include detailed scenery`);
  assert.ok(scenicScene.background instanceof THREE.Color);
  assert.ok(scenicScene.fog instanceof THREE.FogExp2);
  assert.equal(typeof scenicWorld.update, 'function');
  scenicWorld.update(4);
  assert.ok(scenicWorld.animated.clouds.rotation.y > 0);
  scenicWorldObjects[trackId] = scenicWorld.world.children.length;
}
assert.throws(() => createScenicWorld(new THREE.Scene(), 'unknown'), /Unknown scenic track/);

console.log(JSON.stringify({
  tracks: Object.keys(TRACK_CATALOG),
  lengths: Object.fromEntries(Object.entries(curves).map(([trackId, curve]) => [trackId, Math.round(curve.getLength())])),
  dayWorldObjects: dayWorld.world.children.length,
  scenicWorldObjects,
}));
