// 端到端复现"同账号换浏览器登录金币不同步"：两个隔离的浏览器上下文各有独立的
// cookie 与 localStorage，等价于两台设备/两个浏览器。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'neon-apex-wallet-browser-'));
const serverPort = 15200 + Math.floor(Math.random() * 300);
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

const USERNAME = '同步车手';
const PASSWORD = 'wallet-sync-42';
const GUEST_COINS = 4200;

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 进程还在启动。
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// 每个 context 都是一套独立的 cookie + localStorage，正好当成"另一个浏览器"。
async function openBrowserWindow(errors) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vitePort}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
  return { context, page };
}

async function signIn(page, mode) {
  await page.locator('#openAccount').click();
  await page.locator(`[data-auth-mode="${mode}"]`).click();
  await page.locator('#accountUsername').fill(USERNAME);
  await page.locator('#accountPassword').fill(PASSWORD);
  if (mode === 'register') await page.locator('#accountConfirm').fill(PASSWORD);
  await page.locator('#accountSubmit').click();
  await page.waitForFunction(
    (name) => window.__NEON_APEX_ACCOUNT__?.username === name,
    USERNAME,
    { timeout: 15000 },
  );
  await page.locator('#closeAccount').click();
}

const coinsOf = (page) => page.locator('#homeCoins').textContent();

try {
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${serverPort}/multiplayer/healthz`),
    waitForHttp(`http://127.0.0.1:${vitePort}/`),
  ]);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  });
  const errors = [];

  // --- 浏览器 A：以游客身份攒下金币，然后注册账号 ---------------------------
  const a = await openBrowserWindow(errors);
  await a.page.evaluate((coins) => {
    window.localStorage.setItem('neon-apex:wallet:v1', JSON.stringify({
      coins, owned: ['volt'], totalEarned: coins,
    }));
  }, GUEST_COINS);
  await a.page.reload({ waitUntil: 'networkidle' });
  await a.page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
  assert.equal(await coinsOf(a.page), '4,200', '游客金币应显示在首页');

  await signIn(a.page, 'register');
  await a.page.waitForFunction(() => document.getElementById('homeCoins').textContent === '4,200');
  assert.equal(await coinsOf(a.page), '4,200', '注册后本地游客金币应被并入账号');

  // --- 浏览器 B：全新 cookie 与 localStorage，登录同一个账号 -----------------
  const b = await openBrowserWindow(errors);
  assert.equal(await coinsOf(b.page), '0', '新浏览器起步是空钱包');
  await signIn(b.page, 'login');
  await b.page.waitForFunction(() => document.getElementById('homeCoins').textContent === '4,200', null, { timeout: 15000 });
  assert.equal(await coinsOf(b.page), '4,200', '换浏览器登录同一账号应看到同一份金币');

  // --- 浏览器 B 花钱买东西，A 刷新后应同步看到 ------------------------------
  await b.page.locator('#openShop').click();
  const affordable = b.page.locator('.shop-card').filter({ hasNotText: '初始赠送' })
    .locator('button.shop-card-action:not([disabled])').first();
  await affordable.click();
  await b.page.waitForFunction(() => document.getElementById('homeCoins').textContent !== '4,200');
  const coinsAfterPurchase = await coinsOf(b.page);
  assert.notEqual(coinsAfterPurchase, '4,200', '购买后金币应减少');
  await b.page.locator('#closeShop').click();
  // 等防抖上传落地。
  await b.page.waitForTimeout(1500);

  await a.page.reload({ waitUntil: 'networkidle' });
  await a.page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
  await a.page.waitForFunction(
    (expected) => document.getElementById('homeCoins').textContent === expected,
    coinsAfterPurchase,
    { timeout: 15000 },
  );
  assert.equal(await coinsOf(a.page), coinsAfterPurchase, '另一个浏览器的消费应同步回来');

  // --- 退出登录应回到本机游客钱包，而不是继承账号余额 -----------------------
  await b.page.locator('#openAccount').click();
  await b.page.locator('#accountLogout').click();
  await b.page.waitForFunction(() => window.__NEON_APEX_ACCOUNT__ === null);
  assert.equal(await coinsOf(b.page), '0', '登出后回到该浏览器自己的游客钱包');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    guestMerge: 'ok',
    crossBrowserSync: 'ok',
    purchasePropagation: 'ok',
    logoutIsolation: 'ok',
    coinsAfterPurchase,
    errors,
  }));
} finally {
  await browser?.close().catch(() => {});
  for (const processHandle of [vite, server]) {
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
  }
  await Promise.all([once(vite, 'exit').catch(() => {}), once(server, 'exit').catch(() => {})]);
  await rm(temporaryDirectory, { recursive: true, force: true });
}
