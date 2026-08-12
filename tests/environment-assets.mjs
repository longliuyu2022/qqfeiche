import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  ENVIRONMENT_ASSETS,
  attachEnvironmentHLOD,
  environmentAssetUrl,
  loadEnvironmentLODGracefully,
} from '../src/environment-assets.js';

const LEVELS = Object.freeze(['near', 'mid', 'far']);
const EXPECTED_KINDS = Object.freeze([
  'mountainside',
  'boulder',
  'apartment',
  'factory',
  'fir',
]);
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 22 * 1024 * 1024;

assert.deepEqual(Object.keys(ENVIRONMENT_ASSETS), EXPECTED_KINDS);

let totalBytes = 0;
let assetCount = 0;
for (const kind of EXPECTED_KINDS) {
  const definition = ENVIRONMENT_ASSETS[kind];
  assert.ok(Number.isFinite(definition.nearDistance) && definition.nearDistance > 0);
  assert.ok(
    Number.isFinite(definition.midDistance) && definition.midDistance > definition.nearDistance,
    `${kind} must switch near -> mid -> far at increasing distances`,
  );

  const sizes = [];
  for (const level of LEVELS) {
    assert.equal(typeof definition[level], 'string', `${kind}.${level} must define a GLB path`);
    assert.match(definition[level], new RegExp(`^${kind}/${kind}-${level}\\.glb$`));
    assert.equal(
      environmentAssetUrl(kind, level),
      `/assets/environment/models/${definition[level]}`,
    );

    const file = new URL(`../public/assets/environment/models/${definition[level]}`, import.meta.url);
    assert.ok(fs.existsSync(file), `${definition[level]} must exist`);
    const data = fs.readFileSync(file);
    assert.ok(data.byteLength > 20, `${definition[level]} must not be empty`);
    assert.ok(
      data.byteLength <= MAX_FILE_BYTES,
      `${definition[level]} exceeds the 4 MiB browser budget (${data.byteLength} bytes)`,
    );
    assert.equal(data.toString('ascii', 0, 4), 'glTF', `${definition[level]} must be a GLB`);
    assert.equal(data.readUInt32LE(4), 2, `${definition[level]} must use GLB version 2`);
    assert.equal(data.readUInt32LE(8), data.byteLength, `${definition[level]} has an invalid GLB length`);
    sizes.push(data.byteLength);
    totalBytes += data.byteLength;
    assetCount += 1;
  }
  assert.ok(sizes[0] >= sizes[1] && sizes[1] >= sizes[2], `${kind} LOD files must decrease in size`);
}
assert.equal(assetCount, 15, 'five assets must publish near/mid/far GLBs');
assert.ok(totalBytes <= MAX_TOTAL_BYTES, `environment GLBs exceed 22 MiB (${totalBytes} bytes)`);
assert.equal(environmentAssetUrl('unknown'), null);

// With no browser globals, authored assets must remain optional. This keeps
// server-side tests and procedural fallback world creation independent of GLB I/O.
const headlessRoot = new THREE.Group();
const headlessResult = await attachEnvironmentHLOD(headlessRoot, 'ultra', [
  { kind: 'mountainside', position: [0, 0, 0] },
]);
assert.equal(headlessResult, null);
assert.equal(headlessRoot.children.length, 0);

// Exercise the balanced guard with a browser-like global. An invalid kind
// would invoke the error hook if loading were accidentally started.
const previousWindow = globalThis.window;
globalThis.window = {};
let balancedLoadErrors = 0;
const balancedRoot = new THREE.Group();
const balancedResult = await attachEnvironmentHLOD(balancedRoot, 'balanced', [
  { kind: 'intentionally-invalid', position: [0, 0, 0] },
], { onError: () => { balancedLoadErrors += 1; } });
assert.equal(balancedResult, null);
assert.equal(balancedLoadErrors, 0, 'balanced mode must not begin authored asset loading');
assert.equal(balancedRoot.children.length, 0, 'balanced mode must not attach an HLOD group');

let fallbackError = null;
const gracefulResult = await loadEnvironmentLODGracefully('intentionally-invalid', {
  onError: (error, kind) => { fallbackError = { error, kind }; },
});
assert.equal(gracefulResult, null);
assert.equal(fallbackError?.kind, 'intentionally-invalid');
assert.match(fallbackError?.error?.message ?? '', /Unknown environment asset/);

// The map builders are asynchronous only for authored props. In balanced mode
// every map must resolve immediately with its procedural scenery left intact.
function createCanvasShim() {
  const gradient = { addColorStop() {} };
  const context = (canvas) => ({
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    globalCompositeOperation: 'source-over',
    beginPath() {}, closePath() {}, clearRect() {}, fill() {}, fillRect() {},
    fillText() {}, stroke() {}, strokeRect() {}, moveTo() {}, lineTo() {},
    ellipse() {}, arc() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, putImageData() {},
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    getImageData: (x, y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    measureText: () => ({ width: 10 }),
  });
  const element = (tag) => {
    if (tag !== 'canvas') return { style: {}, addEventListener() {}, removeEventListener() {} };
    const canvas = { width: 256, height: 256, style: {} };
    canvas.getContext = () => context(canvas);
    return canvas;
  };
  return {
    createElement: element,
    createElementNS: (namespace, tag) => element(tag),
  };
}

const previousDocument = globalThis.document;
globalThis.document = createCanvasShim();
const [{ createWorld }, { createDayWorld }, { createScenicWorld }] = await Promise.all([
  import('../src/world.js'),
  import('../src/day-world.js'),
  import('../src/scenic-worlds.js'),
]);

const worlds = [
  ['night', createWorld(new THREE.Scene(), { qualityTier: 'balanced' })],
  ['day', createDayWorld(new THREE.Scene(), { qualityTier: 'balanced' })],
  ...['alpine', 'canyon', 'coast'].map((trackId) => [
    trackId,
    createScenicWorld(new THREE.Scene(), trackId, { qualityTier: 'balanced' }),
  ]),
];
for (const [trackId, world] of worlds) {
  assert.equal(await world.environmentReady, null, `${trackId} balanced HLOD should resolve to null`);
  let hlodCount = 0;
  world.world.traverse((object) => {
    if (object.userData.hlod || object.name.includes('EnvironmentHLOD')) hlodCount += 1;
  });
  assert.equal(hlodCount, 0, `${trackId} balanced world must not attach authored HLOD`);
}

if (previousDocument === undefined) delete globalThis.document;
else globalThis.document = previousDocument;
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

console.log(JSON.stringify({
  assets: assetCount,
  totalBytes,
  maxFileBytes: MAX_FILE_BYTES,
  mapsWithoutBalancedHLOD: worlds.map(([trackId]) => trackId),
}));
