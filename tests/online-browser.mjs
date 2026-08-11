import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const balancedPreferences = JSON.stringify({ quality: 'balanced', lastMode: 'race', lastTrack: 'night' });
await Promise.all([
  hostContext.addInitScript((value) => localStorage.setItem('neon-apex:preferences:v1', value), balancedPreferences),
  guestContext.addInitScript((value) => localStorage.setItem('neon-apex:preferences:v1', value), balancedPreferences),
]);
const host = await hostContext.newPage();
const guest = await guestContext.newPage();
for (const [label, page] of [['host', host], ['guest', guest]]) {
  page.on('pageerror', (error) => console.error(`[${label}:pageerror]`, error));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[${label}:console]`, message.text());
  });
}

try {
  await host.goto(baseUrl, { waitUntil: 'networkidle' });
  await host.locator('[data-track="day"]').click();
  await host.locator('#openMultiplayer').click();
  await host.locator('#onlineName').fill('Host');
  await host.locator('#createRoom').click();
  await host.locator('#onlineLobby').waitFor({ state: 'visible' });
  const code = await host.locator('#onlineRoomCode').textContent();
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(await host.locator('#onlineMapName').textContent(), '晴川山谷环线');

  await guest.goto(baseUrl, { waitUntil: 'networkidle' });
  await guest.locator('#openMultiplayer').click();
  await guest.locator('#onlineName').fill('Guest');
  await guest.locator('#roomCode').fill(code);
  await guest.locator('#joinRoom').click();
  await guest.locator('#onlineLobby').waitFor({ state: 'visible' });
  await host.locator('#onlinePlayers li').nth(1).waitFor();
  assert.equal(await host.locator('#onlinePlayers li').count(), 2);
  assert.equal(await guest.locator('#onlinePlayers li').count(), 2);
  assert.equal(await host.locator('#startOnlineRace').isEnabled(), true);

  await host.screenshot({ path: '/tmp/neon-apex-online-host.png', fullPage: true });
  await guest.screenshot({ path: '/tmp/neon-apex-online-mobile.png', fullPage: true });
  await host.locator('#startOnlineRace').click();
  await guest.waitForFunction(() => Boolean(window.__NEON_APEX_ONLINE__?.room));
  const guestSession = await guest.evaluate(() => ({
    code: window.__NEON_APEX_ONLINE__.room.code,
    playerId: window.__NEON_APEX_ONLINE__.selfId,
    reconnectToken: window.__NEON_APEX_ONLINE__.reconnectToken,
  }));
  const socketUrl = baseUrl.replace(/^http/, 'ws') + '/multiplayer';
  await guest.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await guest.evaluate(({ url, session }) => {
    window.__raceStarted = false;
    window.__snapshotReceived = false;
    const socket = new WebSocket(url);
    window.__raceSocket = socket;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'resume', ...session })));
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'resumed') socket.send(JSON.stringify({ type: 'ready' }));
      if (message.type === 'race-start') window.__raceStarted = true;
      if (message.type === 'snapshot' && message.players.some((player) => player.id !== session.playerId)) {
        window.__snapshotReceived = true;
      }
    });
  }, { url: socketUrl, session: guestSession });
  await host.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 120000 });
  await host.waitForFunction(() => window.__NEON_APEX__?.online === true && window.__NEON_APEX__?.activeTrack === 'day');
  await guest.waitForFunction(() => window.__raceStarted === true, null, { timeout: 10000 });
  await host.waitForTimeout(4300);
  const hostRuntime = await host.evaluate(() => ({
    online: window.__NEON_APEX__.online,
    track: window.__NEON_APEX__.activeTrack,
    remotePlayers: window.__NEON_APEX__.remotePlayers.size,
    menuOpen: document.body.classList.contains('menu-open'),
    canvasWidth: document.querySelector('#game').width,
  }));
  assert.deepEqual(hostRuntime, { online: true, track: 'day', remotePlayers: 1, menuOpen: false, canvasWidth: 1296 });
  assert.equal(await host.locator('#position small').textContent(), '/ 2');
  await host.evaluate(() => window.__NEON_APEX_ONLINE__.sendState({
    sequence: 999999,
    x: window.__NEON_APEX__.vehicle.position.x,
    y: window.__NEON_APEX__.vehicle.position.y,
    z: window.__NEON_APEX__.vehicle.position.z,
    yaw: window.__NEON_APEX__.vehicle.heading,
    speed: 0,
    progress: 0,
    lap: 1,
    finished: false,
  }));
  await guest.waitForFunction(() => window.__snapshotReceived === true, null, { timeout: 10000 });
  const dataUrl = await host.evaluate(() => window.__NEON_APEX__.qaCaptureProgress(0.18, 46));
  await fs.writeFile('/tmp/neon-apex-day-race.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(JSON.stringify({ room: code, players: 2, track: hostRuntime.track, runtime: 'ready' }));
} finally {
  await hostContext.close();
  await guestContext.close();
  await browser.close();
}
