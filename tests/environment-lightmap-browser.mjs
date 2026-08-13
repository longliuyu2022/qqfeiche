import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(`${baseURL}/src/environment-assets.js`, { waitUntil: 'networkidle' });

const results = await page.evaluate(async () => {
  const { ENVIRONMENT_ASSETS, streamEnvironmentLOD } = await import('/src/environment-assets.js');
  return Promise.all(Object.keys(ENVIRONMENT_ASSETS).map(async (kind) => {
    const stream = streamEnvironmentLOD(kind, {
      idleScheduler: () => Promise.resolve(),
    });
    const ready = await stream.environmentReady;
    const readyLevels = [...stream.metrics.loadedLevels];
    const lod = await stream.environmentSettled;
    const levels = [];
    for (const entry of lod.levels) {
      let meshes = 0;
      let withLightMap = 0;
      let withUv1 = 0;
      let withUv2 = 0;
      entry.object.traverse((object) => {
        if (!object.isMesh) return;
        meshes += 1;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.every((material) => material.lightMap?.isTexture && material.lightMap.channel === 1)) {
          withLightMap += 1;
        }
        if (object.geometry.hasAttribute('uv1')) withUv1 += 1;
        if (object.geometry.hasAttribute('uv2')) withUv2 += 1;
      });
      levels.push({ level: entry.object.userData.lodLevel, meshes, withLightMap, withUv1, withUv2 });
    }
    return {
      kind,
      isLOD: ready?.isLOD === true,
      readyLevels,
      settledLevels: stream.metrics.loadedLevels,
      state: stream.metrics.state,
      bakedLighting: lod.userData.bakedLighting,
      lightMapsApplied: stream.metrics.lightMapsApplied,
      lightMapFailures: stream.metrics.lightMapFailures,
      levels,
    };
  }));
});

await browser.close();
assert.equal(results.length, 5);
for (const result of results) {
  assert.equal(result.isLOD, true, result.kind);
  assert.deepEqual(result.readyLevels, ['far'], result.kind);
  assert.deepEqual(result.settledLevels, ['far', 'mid', 'near'], result.kind);
  assert.equal(result.state, 'settled', result.kind);
  assert.equal(result.bakedLighting, true, result.kind);
  assert.equal(result.lightMapsApplied, 3, result.kind);
  assert.equal(result.lightMapFailures, 0, result.kind);
  assert.equal(result.levels.length, 3, result.kind);
  for (const level of result.levels) {
    assert.ok(level.meshes > 0, `${result.kind}.${level.level}`);
    assert.equal(level.withLightMap, level.meshes, `${result.kind}.${level.level}`);
    assert.equal(level.withUv1, level.meshes, `${result.kind}.${level.level}`);
    assert.equal(level.withUv2, level.meshes, `${result.kind}.${level.level}`);
  }
}
assert.deepEqual(errors, []);
console.log(JSON.stringify(results));
