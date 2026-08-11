import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

await fs.mkdir('artifacts/maps', { recursive: true });
const maps = ['alpine', 'canyon', 'coast'].filter((id) => !process.env.MAP || process.env.MAP === id);
const cases = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, mobile: false },
  { name: 'landscape', viewport: { width: 640, height: 360 }, mobile: true },
].filter((testCase) => !process.env.CASE || process.env.CASE === testCase.name);
const results = [];

async function canvasMetrics(buffer) {
  const png = PNG.sync.read(buffer);
  let total = 0;
  let squared = 0;
  let nonBlack = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const offset = (y * png.width + x) * 4;
      const luminance = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
      total += luminance;
      squared += luminance * luminance;
      if (luminance > 4) nonBlack += 1;
    }
  }
  const count = Math.ceil(png.width / 4) * Math.ceil(png.height / 4);
  const mean = total / count;
  return {
    width: png.width,
    height: png.height,
    mean: Number(mean.toFixed(2)),
    variance: Number((squared / count - mean * mean).toFixed(2)),
    nonBlackRatio: Number((nonBlack / count).toFixed(3)),
  };
}

for (const testCase of cases) {
  const context = await browser.newContext({
    viewport: testCase.viewport,
    deviceScaleFactor: 1,
    isMobile: testCase.mobile,
    hasTouch: testCase.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true, null, { timeout: 10000 });

  const home = await page.evaluate(async () => {
    const ids = [...document.querySelectorAll('#trackSelector [data-track]')].map((button) => button.dataset.track);
    const covers = await Promise.all(ids.map(async (id) => {
      const response = await fetch(`/assets/tracks/${id}-cover.webp`, { cache: 'no-store' });
      return { id, status: response.status, contentType: response.headers.get('content-type') };
    }));
    const selector = document.querySelector('#trackSelector');
    return {
      ids,
      covers,
      selectorWidth: selector.clientWidth,
      selectorScrollWidth: selector.scrollWidth,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  assert.deepEqual(home.ids, ['night', 'day', 'alpine', 'canyon', 'coast']);
  assert.ok(home.covers.every((cover) => cover.status === 200), `${testCase.name}: a map cover did not load: ${JSON.stringify(home.covers)}`);
  assert.ok(home.covers.every((cover) => cover.contentType === 'image/webp'), `${testCase.name}: a map cover has the wrong content type: ${JSON.stringify(home.covers)}`);
  assert.equal(home.pageOverflow, false, `${testCase.name}: home page overflows horizontally`);
  if (testCase.mobile) assert.ok(home.selectorScrollWidth > home.selectorWidth, 'mobile selector should scroll across five maps');

  for (const id of maps) {
    console.log(`[maps-browser] loading ${testCase.name}/${id}`);
    await page.locator(`[data-track="${id}"]`).click();
    await page.waitForFunction((trackId) => document.querySelector('[data-track].active')?.dataset.track === trackId, id);
    const selection = await page.evaluate(() => ({
      id: document.querySelector('[data-track].active')?.dataset.track,
      overflow: document.documentElement.scrollWidth > innerWidth,
      eventTitle: document.querySelector('#homeEventTitle').textContent,
    }));
    assert.equal(selection.id, id);
    assert.equal(selection.overflow, false, `${testCase.name}/${id}: selector overflowed page`);
    await page.locator('#startRace').click();
    try {
      await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 240000 });
    } catch (error) {
      console.error(`[maps-browser] ${testCase.name}/${id} failed: ${errors.join('; ') || error.message}`);
      await page.screenshot({ path: `artifacts/maps/failed-${testCase.name}-${id}.png`, timeout: 30000 }).catch(() => {});
      throw error;
    }
    const runtime = await page.evaluate(() => ({
      track: window.__NEON_APEX__.activeTrack,
      world: window.__NEON_APEX__.world?.world?.name,
      road: window.__NEON_APEX__.world?.road?.name,
      curveLength: window.__NEON_APEX__.trackCurve?.getLength?.(),
      objectCount: window.__NEON_APEX__.world?.world?.children?.length,
    }));
    assert.equal(runtime.track, id);
    assert.ok(runtime.world && runtime.road, `${testCase.name}/${id}: world metadata missing`);
    assert.ok(runtime.curveLength > 1200, `${testCase.name}/${id}: route is too short`);
    assert.ok(runtime.objectCount > 10, `${testCase.name}/${id}: scene has too few objects`);
    await page.waitForTimeout(2500);
    const dataUrl = await page.evaluate((trackId) => window.__NEON_APEX__.qaCaptureProgress({ alpine: 0.12, canyon: 0.42, coast: 0.68 }[trackId]), id);
    const image = Buffer.from(dataUrl.split(',')[1], 'base64');
    const path = `artifacts/maps/${testCase.name}-${id}.png`;
    await fs.writeFile(path, image);
    const pixels = await canvasMetrics(image);
    assert.ok(pixels.nonBlackRatio > 0.3 && pixels.variance > 20, `${testCase.name}/${id}: canvas appears blank: ${JSON.stringify(pixels)}`);
    await page.evaluate(() => localStorage.removeItem('neon-apex:preferences:v1'));
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true, null, { timeout: 10000 });
    results.push({ case: testCase.name, id, runtime, pixels, path });
    console.log(`[maps-browser] passed ${testCase.name}/${id}`);
  }
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
