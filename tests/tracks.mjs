import assert from 'node:assert/strict';
import * as THREE from 'three';
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
for (const [trackId, curve] of Object.entries(curves)) {
  const length = curve.getLength();
  assert.ok(length > 1800 && length < 2800, `${trackId} circuit length should be plausible`);
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
