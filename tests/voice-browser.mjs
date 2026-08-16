// 播报音色的运行时接线：默认加载女声包，设置里切换后立刻改拉另一套音频，
// 且选择能持久化。manifest 的完整性由 tests/voice.mjs 负责。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url);
const vitePort = 15800 + Math.floor(Math.random() * 300);
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite 还在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await waitForHttp(`http://127.0.0.1:${vitePort}/`);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  });
  // 首页开始按钮带无限循环的流光动画，Playwright 会一直判定"元素不稳定"。
  // 页面本身就支持 prefers-reduced-motion，直接走它的无障碍路径。
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const errors = [];
  const voiceRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/assets/audio/voice')) voiceRequests.push(new URL(url).pathname);
  });

  await page.goto(`http://127.0.0.1:${vitePort}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);

  // 设置面板默认选中女声。
  await page.locator('#openSettings').click();
  assert.equal(await page.locator('#voicePack').inputValue(), 'female', '默认播报音色是女声');

  // 切到原声并确认写进偏好。
  await page.locator('#voicePack').selectOption('classic');
  await page.waitForFunction(() => JSON.parse(
    window.localStorage.getItem('neon-apex:preferences:v1') || '{}',
  ).voicePack === 'classic');

  // 刷新后保持选择。
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
  await page.locator('#openSettings').click();
  assert.equal(await page.locator('#voicePack').inputValue(), 'classic', '音色选择应持久化');

  // 进入游戏，此时真正会去加载语音包：应当拉原声那一套。
  await page.locator('#closeSettings').click();
  await page.waitForFunction(() => document.getElementById('settingsMenu').hidden === true);
  await page.locator('#startRace').click();
  await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 240000 });
  await page.waitForFunction(
    () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/assets/audio/voice/manifest.json')),
    null,
    { timeout: 30000 },
  );
  assert.ok(
    voiceRequests.some((path) => path === '/assets/audio/voice/manifest.json'),
    '选原声时应加载 voice/ 包',
  );
  assert.ok(
    !voiceRequests.some((path) => path.startsWith('/assets/audio/voice-female/')),
    '选原声时不该再去拉女声包',
  );

  // 游戏模块已接管设置面板后再切回女声，应立刻加载女声包，不必重开游戏。
  // 这里直接派发 change 事件：要验的是"改设置 → 换包"这条接线本身，
  // 不想被比赛中弹窗的显隐动画绊住。
  await page.evaluate(() => {
    const select = document.getElementById('voicePack');
    select.value = 'female';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => performance.getEntriesByType('resource').some((entry) => entry.name.includes('/assets/audio/voice-female/manifest.json')),
    null,
    { timeout: 15000 },
  );
  assert.ok(
    voiceRequests.some((path) => path === '/assets/audio/voice-female/manifest.json'),
    '切换音色应即时加载新包',
  );
  assert.equal(
    await page.evaluate(() => JSON.parse(window.localStorage.getItem('neon-apex:preferences:v1')).voicePack),
    'female',
    '游戏内切换同样要写回偏好',
  );

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    defaultPack: 'female',
    persistence: 'ok',
    runtimeSwitch: 'ok',
    manifests: [...new Set(voiceRequests.filter((path) => path.endsWith('manifest.json')))],
    errors,
  }));
} finally {
  await browser?.close().catch(() => {});
  if (vite.exitCode === null) vite.kill('SIGTERM');
  await once(vite, 'exit').catch(() => {});
}
