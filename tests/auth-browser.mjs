import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { chromiumPath } from './browser-support.mjs';

const root = new URL('..', import.meta.url);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'neon-apex-auth-browser-'));
const serverPort = 14800 + Math.floor(Math.random() * 300);
const vitePort = serverPort + 400;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    NEON_APEX_PORT: String(serverPort),
    NEON_APEX_AUTH_FILE: path.join(temporaryDirectory, 'accounts.json'),
    NEON_APEX_WALLET_FILE: path.join(temporaryDirectory, 'wallets.json'),
    NEON_APEX_RANK_FILE: path.join(temporaryDirectory, 'ranked.json'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const vite = spawn(process.execPath, [
  'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort',
], {
  cwd: root,
  env: { ...process.env, NEON_APEX_MULTIPLAYER_TARGET: `http://127.0.0.1:${serverPort}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;

async function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Processes are still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

try {
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${serverPort}/multiplayer/healthz`),
    waitForHttp(`http://127.0.0.1:${vitePort}/`),
  ]);
  browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vitePort}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);

  await page.locator('#openAccount').click();
  await page.locator('[data-auth-mode="register"]').click();
  await page.locator('#accountUsername').fill('浏览器车手');
  await page.locator('#accountPassword').fill('browser-pass-42');
  await page.locator('#accountConfirm').fill('browser-pass-42');
  await page.locator('#accountSubmit').click();
  await page.waitForFunction(() => window.__NEON_APEX_ACCOUNT__?.username === '浏览器车手');
  assert.equal(await page.locator('#accountSignedIn').isVisible(), true);
  assert.equal(await page.locator('#homeAccount').textContent(), '浏览器车手');
  assert.equal(await page.locator('#onlineName').inputValue(), '浏览器车手');
  assert.equal(await page.locator('#onlineName').getAttribute('readonly'), '');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_ACCOUNT__?.username === '浏览器车手');
  assert.equal(await page.locator('#homeAccount').textContent(), '浏览器车手');
  await page.locator('#openAccount').click();
  await page.locator('#accountLogout').click();
  await page.waitForFunction(() => window.__NEON_APEX_ACCOUNT__ === null);
  assert.equal(await page.locator('#accountSignedOut').isVisible(), true);
  assert.equal(await page.locator('#homeAccount').textContent(), '游客');
  assert.equal(await page.locator('#accountStatus').textContent(), '已退出登录');
  await page.locator('#closeAccount').click();
  await page.locator('#openAccountAction').click();
  assert.equal(await page.locator('#accountSignedOut').isVisible(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ registrationUi: 'ok', sessionReload: 'ok', logoutUi: 'ok', accountAction: 'ok', errors }));
} finally {
  await browser?.close().catch(() => {});
  for (const processHandle of [vite, server]) {
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
  }
  await Promise.all([once(vite, 'exit').catch(() => {}), once(server, 'exit').catch(() => {})]);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
