import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ENVIRONMENT_ASSETS,
  ENVIRONMENT_STREAM_BUDGETS,
  attachEnvironmentHLOD,
  streamEnvironmentLOD,
} from '../src/environment-assets.js';

function createTemplate() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, 0, -1,
    1, 0, -1,
    0, 2, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0.5, 1,
  ], 2));
  geometry.computeBoundingBox();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  assert.fail(message);
}

// A successful far model must make the environment usable without waiting for
// either higher-detail request. Each upgrade starts behind its own idle gate.
const requested = [];
const idleGates = [];
const staged = streamEnvironmentLOD('boulder', {
  modelLoader: async (url, { level }) => {
    requested.push(level);
    return createTemplate();
  },
  textureLoader: async () => new THREE.DataTexture(
    new Uint8Array([180, 180, 180, 255]), 1, 1, THREE.RGBAFormat,
  ),
  idleScheduler: () => {
    const gate = deferred();
    idleGates.push(gate);
    return gate.promise;
  },
});

const stagedLOD = await staged.environmentReady;
assert.deepEqual(requested, ['far'], 'environmentReady must only require the cheapest far model');
assert.deepEqual(staged.metrics.loadedLevels, ['far']);
assert.equal(stagedLOD.levels.length, 1);
assert.equal(stagedLOD.levels[0].object.userData.lodLevel, 'far');
assert.equal(staged.metrics.initialBytes,
  ENVIRONMENT_ASSETS.boulder.bytes.far + ENVIRONMENT_ASSETS.boulder.lightMapBytes.far);
assert.ok(staged.metrics.bytesLoaded >= ENVIRONMENT_ASSETS.boulder.bytes.far);
assert.equal(staged.metrics.state, 'ready');

await waitUntil(() => idleGates.length === 1, 'mid upgrade must wait for its idle gate');
idleGates[0].resolve();
await waitUntil(() => requested.includes('mid'), 'mid model was not requested after idle');
assert.deepEqual(requested, ['far', 'mid']);
await waitUntil(() => idleGates.length === 2, 'near upgrade must use a separate idle gate');
assert.ok(!requested.includes('near'));
idleGates[1].resolve();
await staged.environmentSettled;
assert.deepEqual(requested, ['far', 'mid', 'near']);
assert.deepEqual(staged.metrics.loadedLevels, ['far', 'mid', 'near']);
assert.equal(staged.metrics.bytesLoaded, Object.values(ENVIRONMENT_ASSETS.boulder.bytes)
  .reduce((sum, bytes) => sum + bytes, 0)
  + Object.values(ENVIRONMENT_ASSETS.boulder.lightMapBytes).reduce((sum, bytes) => sum + bytes, 0));
assert.equal(staged.metrics.state, 'settled');
assert.equal(stagedLOD.levels.length, 3);
assert.deepEqual(stagedLOD.levels.map(({ distance }) => distance), [
  0,
  ENVIRONMENT_ASSETS.boulder.nearDistance,
  ENVIRONMENT_ASSETS.boulder.midDistance,
]);

// A failed initial level should immediately fall through to the next usable
// model. A later failure must preserve all already installed levels.
const fallbackRequests = [];
const fallbackErrors = [];
const fallback = streamEnvironmentLOD('fir', {
  modelLoader: async (url, { level }) => {
    fallbackRequests.push(level);
    if (level !== 'mid') throw new Error(`${level} unavailable`);
    return createTemplate();
  },
  textureLoader: async () => new THREE.DataTexture(
    new Uint8Array([180, 180, 180, 255]), 1, 1, THREE.RGBAFormat,
  ),
  idleScheduler: () => Promise.resolve(),
  onError: (error, kind, level) => fallbackErrors.push({ error, kind, level }),
});
const fallbackLOD = await fallback.environmentReady;
assert.deepEqual(fallbackRequests, ['far', 'mid']);
assert.equal(fallbackLOD.levels[0].object.userData.lodLevel, 'mid');
await fallback.environmentSettled;
assert.deepEqual(fallbackRequests, ['far', 'mid', 'near']);
assert.deepEqual(fallback.metrics.loadedLevels, ['mid']);
assert.deepEqual(fallback.metrics.failedLevels, ['far', 'near']);
assert.deepEqual(fallbackErrors.map(({ level }) => level), ['far', 'near']);
assert.equal(fallbackLOD.levels.length, 1, 'failed upgrades must not remove the usable fallback');

// Verify a real Three.js lightMap binding, including the current renderer's
// uv1 channel and a uv2 compatibility attribute for asset inspection tools.
const bakedTexture = new THREE.DataTexture(
  new Uint8Array([180, 180, 180, 255]),
  1,
  1,
  THREE.RGBAFormat,
);
const bakedUrls = [];
const baked = streamEnvironmentLOD('apartment', {
  modelLoader: async () => createTemplate(),
  idleScheduler: () => Promise.resolve(),
  textureLoader: async (url) => {
    bakedUrls.push(url);
    return bakedTexture;
  },
  lightMapIntensity: 1.35,
});
const bakedLOD = await baked.environmentSettled;
let bakedMeshes = 0;
bakedLOD.traverse((object) => {
  if (!object.isMesh) return;
  bakedMeshes += 1;
  assert.ok(object.geometry.hasAttribute('uv1'));
  assert.ok(object.geometry.hasAttribute('uv2'));
  assert.equal(object.material.lightMap, bakedTexture);
  assert.equal(object.material.lightMapIntensity, 1.35);
});
assert.equal(bakedMeshes, 3);
assert.equal(bakedTexture.channel, 1);
assert.equal(bakedTexture.colorSpace, THREE.NoColorSpace);
assert.equal(bakedLOD.userData.bakedLighting, true);
assert.equal(baked.metrics.lightMapsApplied, 3);
assert.equal(baked.metrics.lightMapMaterials, 3);
assert.deepEqual(bakedUrls, [
  ENVIRONMENT_ASSETS.apartment.lightMaps.far,
  ENVIRONMENT_ASSETS.apartment.lightMaps.mid,
  ENVIRONMENT_ASSETS.apartment.lightMaps.near,
]);

// Aggregate budgets count browser-cacheable asset kinds once even when the
// same authored model is placed repeatedly around a map.
const previousWindow = globalThis.window;
globalThis.window = {};
const root = new THREE.Group();
const attached = attachEnvironmentHLOD(root, 'ultra', [
  { kind: 'boulder', position: [0, 0, 0] },
  { kind: 'boulder', position: [20, 0, 0] },
  { kind: 'fir', position: [-20, 0, 0] },
], {
  modelLoader: async () => createTemplate(),
  textureLoader: async () => bakedTexture,
  idleScheduler: () => Promise.resolve(),
});
const group = await attached;
assert.equal(group.children.length, 3);
assert.equal(attached.metrics.initialBytes,
  ENVIRONMENT_ASSETS.boulder.bytes.far + ENVIRONMENT_ASSETS.boulder.lightMapBytes.far
  + ENVIRONMENT_ASSETS.fir.bytes.far + ENVIRONMENT_ASSETS.fir.lightMapBytes.far);
assert.equal(attached.metrics.budget.initialBytes, ENVIRONMENT_STREAM_BUDGETS.initialBytes);
assert.equal(attached.metrics.budget.initialWithinBudget, true);
assert.equal(attached.metrics.budget.totalWithinBudget, true);
await attached.environmentSettled;
assert.equal(attached.metrics.state, 'settled');
assert.equal(attached.metrics.requestedLevels, 9);
assert.equal(attached.metrics.loadedLevels, 9);
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

console.log(JSON.stringify({
  farFirst: true,
  idleUpgrades: staged.metrics.loadedLevels,
  fallbackLevels: fallback.metrics.failedLevels,
  bakedMeshes,
  initialBudgetBytes: attached.metrics.initialBytes,
  totalBudgetBytes: attached.metrics.totalBytes,
}));
