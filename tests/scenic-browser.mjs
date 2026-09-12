import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { chromiumPath } from './browser-support.mjs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4181';
const output = 'artifacts/scenic-modeling';
const maps = ['canyon', 'coast', 'alpine'].filter((id) => !process.env.MAP || process.env.MAP === id);
const cases = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false, quality: 'high' },
  { name: 'landscape', viewport: { width: 844, height: 390 }, mobile: true, quality: 'balanced' },
  { name: 'portrait', viewport: { width: 390, height: 844 }, mobile: true, quality: 'balanced' },
].filter((entry) => !process.env.CASE || process.env.CASE === entry.name);
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const results = [];
await fs.mkdir(output, { recursive: true });

function pixels(buffer) {
  const png = PNG.sync.read(buffer);
  let sum = 0;
  let sumSq = 0;
  let lit = 0;
  let count = 0;
  for (let i = 0; i < png.data.length; i += 64) {
    const value = png.data[i] * 0.2126 + png.data[i + 1] * 0.7152 + png.data[i + 2] * 0.0722;
    sum += value;
    sumSq += value * value;
    lit += value > 5 ? 1 : 0;
    count += 1;
  }
  return { mean: sum / count, variance: sumSq / count - (sum / count) ** 2, lit: lit / count };
}

try {
  for (const testCase of cases) {
    for (const id of maps) {
      console.log(`[scenic] ${testCase.name}/${id}: loading`);
      const context = await browser.newContext({ viewport: testCase.viewport, deviceScaleFactor: 1, isMobile: testCase.mobile, hasTouch: testCase.mobile });
      const page = await context.newPage();
      page.setDefaultTimeout(180000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
      await page.addInitScript(({ id, quality }) => localStorage.setItem('neon-apex:preferences:v1', JSON.stringify({
        lastTrack: id, lastMode: 'timeTrial', quality, soundEnabled: false, musicEnabled: false, voiceEnabled: false, cameraShake: false,
      })), { id, quality: process.env.QUALITY || testCase.quality });
      await page.goto(baseUrl, { waitUntil: 'networkidle' });
      await page.locator('#startRace').click();
      await page.waitForFunction(() => window.__NEON_APEX_READY__ === true);
      await page.evaluate(() => window.__NEON_APEX__.qaAdvance(0));
      await page.evaluate(async () => {
        const ready = window.__NEON_APEX__.world.environmentReady;
        await (ready.environmentSettled ?? ready);
      });
      const progress = { canyon: 0.42, coast: 0.68, alpine: 0.12 }[id];
      const before = await page.evaluate((t) => {
        window.__NEON_APEX__.qaCaptureProgress(t, 32);
        window.__NEON_APEX__.qaAdvance(1 / 60, { throttle: 1 });
        return document.querySelector('#game').toDataURL('image/png');
      }, progress);
      const canvas = Buffer.from(before.split(',')[1], 'base64');
      const pixelMetrics = pixels(canvas);
      assert.ok(pixelMetrics.lit > 0.65 && pixelMetrics.variance > 100, `${id}: canvas is blank`);
      await fs.writeFile(`${output}/${testCase.name}-${id}.png`, canvas);
      await page.screenshot({ path: `${output}/${testCase.name}-${id}-hud.png`, timeout: 120000 });
      const beforePosition = await page.evaluate(() => window.__NEON_APEX__.vehicle.position.toArray());
      if (testCase.mobile) await page.locator('[data-control="accelerate"]').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
      else await page.keyboard.down('w');
      const movement = await page.evaluate((start) => {
        const game = window.__NEON_APEX__;
        game.vehicle.update(0.1);
        const inputSpeed = game.vehicle.speedKph;
        game.renderer.info.autoReset = false;
        game.renderer.info.reset();
        game.qaAdvance(0.6, { throttle: 1, autopilot: true });
        const render = { ...game.renderer.info.render };
        game.renderer.info.autoReset = true;
        return {
          inputSpeed,
          distance: Math.hypot(...game.vehicle.position.toArray().map((value, i) => value - start[i])),
          render,
          guideCount: game.scene.getObjectByName('CornerGuidance').userData.placements.length,
          reliefCount: game.world.world.children.filter((object) => /Relief_/.test(object.name)).length,
          assetFailures: game.world.environmentReady.metrics?.errors ?? [],
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      }, beforePosition);
      if (testCase.mobile) await page.locator('[data-control="accelerate"]').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
      else await page.keyboard.up('w');
      const after = await page.evaluate(() => document.querySelector('#game').toDataURL('image/png'));
      assert.notEqual(after, before, 'driving must change the rendered frame');
      assert.ok(movement.distance > 1 && movement.inputSpeed > 0, 'driving input must move the car');
      assert.ok(movement.guideCount > 0 && movement.reliefCount === 3, 'modeled scenery is missing');
      assert.equal(movement.overflow, false);
      assert.deepEqual(errors, [], `${testCase.name}/${id}: browser errors`);
      results.push({ case: testCase.name, id, pixels: pixelMetrics, ...movement });
      console.log(`[scenic] ${testCase.name}/${id}: passed (${movement.render.calls} calls, ${movement.render.triangles} triangles)`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await fs.writeFile(`${output}/results${process.env.CASE ? `-${process.env.CASE}` : ''}${process.env.MAP ? `-${process.env.MAP}` : ''}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
