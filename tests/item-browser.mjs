import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4175';
const fast = process.env.FAST === '1';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
await fs.mkdir('artifacts', { recursive: true });

const cases = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'mobile', viewport: { width: 640, height: 360 }, mobile: true },
].filter((testCase) => !process.env.CASE || process.env.CASE === testCase.name);
const results = [];

for (const testCase of cases) {
  const context = await browser.newContext({
    viewport: testCase.viewport,
    isMobile: testCase.mobile,
    hasTouch: testCase.mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await context.addInitScript(() => {
    localStorage.setItem('neon-apex:preferences:v1', JSON.stringify({
      soundEnabled: false,
      masterVolume: 0,
      quality: 'balanced',
      vibration: false,
      cameraShake: false,
      lastMode: 'items',
      lastTrack: 'night',
    }));
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
  await page.locator('[data-race-mode="items"]').click();

  const home = await page.evaluate(() => ({
    modes: document.querySelectorAll('[data-race-mode]').length,
    selected: document.querySelector('[data-race-mode].active')?.dataset.raceMode,
    overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
  }));
  await page.locator('#startRace').click();
  await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__NEON_APEX__?.activeMode === 'items');

  const collection = await page.evaluate(() => {
    const { itemRace, vehicle } = window.__NEON_APEX__;
    const pickup = itemRace.pickups.find((entry) => Math.abs(entry.lane) < 0.5 && entry.active);
    vehicle.position.copy(pickup.object.position);
    vehicle.position.y -= 1.05;
    vehicle.velocity.set(0, 0, 0);
    vehicle.syncObject();
    const distanceBefore = pickup.object.position.distanceTo(vehicle.position);
    itemRace.update(1 / 30, { racing: true });
    return {
      enabled: itemRace.enabled,
      distanceBefore,
      pickupActive: pickup.active,
      inventory: itemRace.inventory,
      raceStarted: vehicle.state.started,
    };
  });
  assert.equal(collection.enabled, true, `${testCase.name}: item race system should be enabled`);
  assert.ok(collection.distanceBefore < 2, `${testCase.name}: vehicle should be inside pickup radius`);
  assert.ok(collection.inventory, `${testCase.name}: pickup should immediately fill inventory: ${JSON.stringify(collection)}`);
  await page.evaluate(() => window.__NEON_APEX__.qaAdvance(0.016, { autopilot: true }));
  assert.equal(await page.locator('#itemUse').isEnabled(), true, `${testCase.name}: item button should be enabled`);

  const state = await page.evaluate(() => {
    const selectors = ['#itemUse', '.steer-pad button', '.pedal-pad button', '.performance-strip', '.telemetry'];
    const rects = [...document.querySelectorAll(selectors.join(','))]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id || element.dataset.control || element.className,
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        };
      });
    const item = rects.find((rect) => rect.id === 'itemUse');
    const overlaps = rects.filter((rect) => rect !== item).filter((rect) => (
      Math.min(item.right, rect.right) - Math.max(item.left, rect.left) > 1
      && Math.min(item.bottom, rect.bottom) - Math.max(item.top, rect.top) > 1
    ));
    return {
      inventory: window.__NEON_APEX__.itemRace.inventory,
      pickupCount: window.__NEON_APEX__.itemRace.pickups.length,
      activeBoxes: window.__NEON_APEX__.itemRace.pickups.filter((pickup) => pickup.object.visible).length,
      itemButton: item,
      overlaps,
      renderCalls: window.__NEON_APEX__.renderer.info.render.calls,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    };
  });

  const beforeUse = state.inventory;
  await page.locator('#itemUse').click();
  await page.waitForFunction(() => window.__NEON_APEX__.itemRace.inventory === null);
  let pixels = null;
  if (!fast) {
    const screenshot = await page.screenshot({
      path: `artifacts/item-race-${testCase.name}.png`,
      animations: 'disabled',
      timeout: 120000,
    });
    const png = PNG.sync.read(screenshot);
    let samples = 0;
    let nonBlack = 0;
    let total = 0;
    let squared = 0;
    for (let y = 0; y < png.height; y += 4) {
      for (let x = 0; x < png.width; x += 4) {
        const offset = (y * png.width + x) * 4;
        const value = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
        if (value > 4) nonBlack += 1;
        total += value;
        squared += value * value;
        samples += 1;
      }
    }
    const mean = total / samples;
    pixels = { nonBlackRatio: nonBlack / samples, variance: squared / samples - mean * mean };
  }
  results.push({ case: testCase.name, errors, home, beforeUse, state, pixels });
  await context.close();
}

await browser.close();
for (const result of results) {
  assert.deepEqual(result.errors, [], `${result.case} should have no browser errors`);
  assert.equal(result.home.modes, 4);
  assert.equal(result.home.selected, 'items');
  assert.equal(result.home.overflow, false);
  assert.equal(result.state.pickupCount, 12);
  assert.ok(result.state.activeBoxes >= 10, '3D item boxes should remain visible around the track');
  assert.ok(result.beforeUse, 'player should collect an item');
  assert.deepEqual(result.state.overlaps, [], `${result.case} item control overlaps other HUD controls`);
  assert.equal(result.state.overflow, false);
  assert.ok(result.state.renderCalls > 0);
  if (result.pixels) {
    assert.ok(result.pixels.nonBlackRatio > 0.35 && result.pixels.variance > 30, 'render should not be blank');
  }
}
console.log(JSON.stringify(results, null, 2));
