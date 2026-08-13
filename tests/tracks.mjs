import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { TRACK_CURVE } from '../src/world.js';
import { DAY_TRACK_CURVE, createDayWorld } from '../src/day-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
  SCENIC_TRACK_CURVES,
  createClearanceField,
  createScenicWorld,
} from '../src/scenic-worlds.js';
import { TRACK_CATALOG, normalizeTrackId } from '../src/track-catalog.js';
import {
  MAP_ART_LAYOUTS,
  buildMapArtPlacements,
  curveArtFrame,
} from '../src/map-art-layouts.js';

const expectedTrackIds = ['night', 'day', 'alpine', 'canyon', 'coast'];
assert.deepEqual(Object.keys(TRACK_CATALOG), expectedTrackIds);
assert.deepEqual(Object.keys(MAP_ART_LAYOUTS), expectedTrackIds);
const environmentKinds = new Set(['mountainside', 'boulder', 'apartment', 'factory', 'fir']);
for (const [trackId, layout] of Object.entries(MAP_ART_LAYOUTS)) {
  assert.equal(layout.length, 10, `${trackId} should have ten authored HLOD placements`);
  assert.equal(new Set(layout.map(({ id }) => id)).size, layout.length, `${trackId} placement IDs must be unique`);
  assert.ok(new Set(layout.map(({ sector }) => sector)).size >= 5, `${trackId} art must cover at least five race sectors`);
  assert.ok(
    layout.filter(({ landmarkTier }) => landmarkTier !== 'supporting').length >= 3,
    `${trackId} should feature at least three named landmarks`,
  );
  for (const entry of layout) {
    assert.ok(environmentKinds.has(entry.kind), `${trackId}.${entry.id} uses an unknown environment asset`);
    assert.ok(entry.progress >= 0 && entry.progress < 1, `${trackId}.${entry.id} has invalid track progress`);
    assert.ok(entry.name.length > 3 && entry.sector.length > 2, `${trackId}.${entry.id} needs art metadata`);
  }
}
for (const track of Object.values(TRACK_CATALOG)) {
  assert.ok(track.environmentAsset, `${track.id} should define an HDR environment`);
  assert.ok(
    fs.existsSync(new URL(`../public/assets/environment/polyhaven/${track.environmentAsset}`, import.meta.url)),
    `${track.id} HDR environment should exist`,
  );
}
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
  const clearance = createClearanceField(curve);
  const placements = buildMapArtPlacements(
    trackId,
    clearance,
    (progress) => curveArtFrame(curve, progress),
  );
  assert.equal(placements.length, 10, `${trackId} should place every authored HLOD anchor`);
  for (const placement of placements) {
    const { x, z } = new THREE.Vector3().fromArray(placement.position);
    const { radius, clearance: clearanceKind } = placement.anchor;
    const margin = clearanceKind === 'terrain' ? 20 : 12;
    assert.ok(clearance.clears(x, z, radius, margin), `${trackId}.${placement.anchor.id} must clear the circuit`);
  }
}

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
assert.equal(dayWorld.world.userData.environmentArt.placementCount, 10);
assert.ok(dayWorld.world.userData.environmentArt.landmarkCount >= 3);
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
  assert.equal(scenicWorld.world.userData.environmentArt.placementCount, 10);
  assert.ok(scenicWorld.world.userData.environmentArt.sectors.length >= 5);
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
