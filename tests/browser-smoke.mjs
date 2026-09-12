import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { chromiumPath } from './browser-support.mjs';

async function freePort() {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  return port;
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return; } catch { /* Server starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

function canvasMetrics(buffer) {
  const png = PNG.sync.read(buffer);
  let sum = 0;
  let squared = 0;
  let nonBlack = 0;
  let count = 0;
  for (let i = 0; i < png.data.length; i += 16) {
    const light = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
    sum += light;
    squared += light * light;
    nonBlack += light > 4 ? 1 : 0;
    count++;
  }
  return { nonBlack: nonBlack / count, variance: squared / count - (sum / count) ** 2 };
}

const directory = await mkdtemp(join(tmpdir(), 'neon-apex-browser-smoke-'));
const output = 'artifacts/browser-smoke';
await mkdir(output, { recursive: true });
const serverPort = await freePort();
const previewPort = await freePort();
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, NEON_APEX_PORT: String(serverPort),
    NEON_APEX_AUTH_FILE: join(directory, 'accounts.json'), NEON_APEX_WALLET_FILE: join(directory, 'wallets.json'), NEON_APEX_RANK_FILE: join(directory, 'ranked.json') },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'], {
  env: { ...process.env, NEON_APEX_MULTIPLAYER_TARGET: `http://127.0.0.1:${serverPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  await Promise.all([waitForHttp(`http://127.0.0.1:${serverPort}/multiplayer/healthz`), waitForHttp(`http://127.0.0.1:${previewPort}`)]);
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true,
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const results = [];
  for (const sample of [
    { name: 'desktop', width: 1280, height: 720, mobile: false },
    { name: 'portrait', width: 390, height: 844, mobile: true },
    { name: 'landscape', width: 640, height: 360, mobile: true },
  ].filter((sample) => !process.env.CASE || sample.name === process.env.CASE)) {
    console.log(`[browser-smoke] ${sample.name}: home`);
    const context = await browser.newContext({ viewport: { width: sample.width, height: sample.height }, isMobile: sample.mobile, hasTouch: sample.mobile, deviceScaleFactor: 1 });
    await context.addInitScript(() => localStorage.setItem('neon-apex:preferences:v1', JSON.stringify({ quality: 'balanced', lastTrack: 'candy', lastMode: 'timeTrial', soundEnabled: false })));
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(`http://127.0.0.1:${previewPort}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => Boolean(window.__NEON_APEX__)), false, 'home must keep the 3D runtime lazy');
    await page.screenshot({ path: `${output}/${sample.name}-home.png` });
    await page.locator('#startRace').click();
    console.log(`[browser-smoke] ${sample.name}: loading race`);
    try {
      await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 90000 });
      // Keep real input/countdown behavior affordable on CI's software renderer.
      await page.evaluate(() => {
        window.__NEON_APEX__.renderer.setPixelRatio(0.3);
        window.__NEON_APEX__.renderer.setSize(innerWidth, innerHeight, false);
      });
      await page.waitForFunction(() => window.__NEON_APEX__.vehicle.state.started === true, null, { timeout: 90000 });
    } catch (error) {
      await page.screenshot({ path: `${output}/${sample.name}-failure.png`, timeout: 10000 }).catch(() => {});
      const diagnostic = await page.evaluate(() => ({ ready: window.__NEON_APEX_READY__, state: window.__NEON_APEX__?.vehicle?.state, text: document.body.innerText.slice(-1500) }));
      throw new Error(`${sample.name}: ${error.message}; ${JSON.stringify({ errors, diagnostic })}`);
    }
    console.log(`[browser-smoke] ${sample.name}: driving`);
    const before = await page.evaluate(() => ({ x: window.__NEON_APEX__.vehicle.position.x, z: window.__NEON_APEX__.vehicle.position.z }));
    if (sample.mobile) await page.locator('[data-control="accelerate"]').dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', bubbles: true });
    else await page.keyboard.down('KeyW');
    await page.waitForFunction(() => Math.abs(window.__NEON_APEX__.vehicle.state.forwardSpeed) > 12);
    await page.waitForTimeout(500);
    if (sample.mobile) await page.locator('[data-control="accelerate"]').dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', bubbles: true });
    else await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => ({ x: window.__NEON_APEX__.vehicle.position.x, z: window.__NEON_APEX__.vehicle.position.z }));
    assert.ok(Math.hypot(after.x - before.x, after.z - before.z) > 2, 'controls must move the car');
    const canvas = await page.locator('#game').screenshot();
    const pixels = canvasMetrics(canvas);
    assert.ok(pixels.nonBlack > 0.35 && pixels.variance > 30, `${sample.name}: blank canvas`);
    await writeFile(`${output}/${sample.name}-canvas.png`, canvas);
    await page.screenshot({ path: `${output}/${sample.name}-race.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('pauseMenu').hidden === false);
    assert.deepEqual(errors, []);
    results.push({ viewport: sample.name, controls: 'ok', pixels });
    await context.close();
  }
  await writeFile(`${output}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results));
} finally {
  await browser?.close();
  for (const child of [preview, server]) {
    if (child.exitCode !== null) continue;
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
