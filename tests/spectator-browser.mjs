import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { WebSocket } from 'ws';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const port = 14610 + Math.floor(Math.random() * 300);
const serverOrigin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_ALLOWED_ORIGINS: new URL(baseUrl).origin,
    NEON_APEX_START_DELAY_MS: '20',
    NEON_APEX_UNAUTHENTICATED_IDLE_MS: '10000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (chunk) => process.stderr.write(`[spectator-server] ${chunk}`));

const waitForMessage = (socket, type, timeoutMs = 10000, predicate = () => true) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.off('message', handler);
    reject(new Error(`Timed out waiting for ${type}`));
  }, timeoutMs);
  const handler = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== type || !predicate(message)) return;
    clearTimeout(timeout);
    socket.off('message', handler);
    resolve(message);
  };
  socket.on('message', handler);
});

async function connect() {
  const socket = new WebSocket(`${serverOrigin.replace(/^http/, 'ws')}/multiplayer`);
  await once(socket, 'open');
  return socket;
}

function send(socket, payload) {
  socket.send(JSON.stringify(payload));
}

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 5000)),
  ]);

  const host = await connect();
  const hostJoinedPromise = waitForMessage(host, 'joined');
  send(host, { type: 'create', name: 'Host', map: 'night' });
  const hostJoined = await hostJoinedPromise;

  const guest = await connect();
  const guestJoinedPromise = waitForMessage(guest, 'joined');
  send(guest, { type: 'join', name: 'Guest', code: hostJoined.room.code });
  await guestJoinedPromise;

  const prepare = Promise.all([
    waitForMessage(host, 'prepare'),
    waitForMessage(guest, 'prepare'),
  ]);
  send(host, { type: 'start' });
  await prepare;
  const raceStart = Promise.all([
    waitForMessage(host, 'race-start'),
    waitForMessage(guest, 'race-start'),
  ]);
  send(host, { type: 'ready' });
  send(guest, { type: 'ready' });
  const [hostStart] = await raceStart;

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
    args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript((origin) => {
    localStorage.setItem('neon-apex:preferences:v1', JSON.stringify({ quality: 'balanced', lastMode: 'race', lastTrack: 'night' }));
    window.__NEON_APEX_SERVER__ = origin;
  }, serverOrigin);
  const page = await context.newPage();
  page.on('pageerror', (error) => console.error(`[spectator-page] ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[spectator-page] ${message.text()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#openMultiplayer').click();
  await page.locator('#onlineName').fill('Viewer');
  await page.locator('#roomCode').fill(hostJoined.room.code);
  await page.locator('#spectateRoom').click();
  await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 120000 });

  await page.evaluate(() => {
    const online = window.__NEON_APEX_ONLINE__;
    let count = 0;
    const original = online.sendState.bind(online);
    online.sendState = (...args) => { count += 1; online.__spectatorSendCount = count; return original(...args); };
    online.__spectatorSendCount = 0;
  });
  await page.waitForTimeout(1000);
  const runtime = await page.evaluate(() => ({
    online: window.__NEON_APEX__.online,
    spectator: document.body.classList.contains('spectator'),
    localCarVisible: window.__NEON_APEX__.vehicle.object.visible,
    remotePlayers: window.__NEON_APEX__.remotePlayers.size,
    position: document.querySelector('#position').textContent,
    touchDisplay: getComputedStyle(document.querySelector('.touch-controls')).display,
    sendCount: window.__NEON_APEX_ONLINE__.__spectatorSendCount,
  }));
  assert.deepEqual(runtime, {
    online: true,
    spectator: true,
    localCarVisible: false,
    remotePlayers: 2,
    position: '观战/ 2',
    touchDisplay: 'none',
    sendCount: 0,
  });
  console.log(JSON.stringify({ spectator: 'ready', remotePlayers: runtime.remotePlayers, controls: 'hidden', raceId: hostStart.raceId }));
  await context.close();
  await browser.close();
  host.close();
  guest.close();
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
