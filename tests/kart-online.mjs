import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 14600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_START_DELAY_MS: '20',
    NEON_APEX_MAX_CONNECTIONS_PER_IP: '8',
    NEON_APEX_LOBBY_ACTION_LIMIT: '40',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForMessage = (socket, type, timeoutMs = 5000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.off('message', handler);
    reject(new Error(`Timed out waiting for ${type}`));
  }, timeoutMs);
  const handler = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== type) return;
    clearTimeout(timeout);
    socket.off('message', handler);
    resolve(message);
  };
  socket.on('message', handler);
});

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  await once(socket, 'open');
  return socket;
}

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 5000)),
  ]);
  const host = await connect();
  const hostJoinedPromise = waitForMessage(host, 'joined');
  host.send(JSON.stringify({ type: 'create', name: 'Kart Host', map: 'candyland', raceMode: 'kart' }));
  const hostJoined = await hostJoinedPromise;
  assert.equal(hostJoined.room.raceMode, 'kart');
  assert.equal(hostJoined.room.map, 'candyland', 'kart rooms should preserve a selected candy circuit');

  const guest = await connect();
  const guestJoinedPromise = waitForMessage(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', name: 'Kart Guest', code: hostJoined.room.code }));
  const guestJoined = await guestJoinedPromise;
  assert.equal(guestJoined.room.raceMode, 'kart');
  assert.equal(guestJoined.room.map, 'candyland');

  const hostPrepare = waitForMessage(host, 'prepare');
  const guestPrepare = waitForMessage(guest, 'prepare');
  host.send(JSON.stringify({ type: 'start' }));
  const prepare = await Promise.all([hostPrepare, guestPrepare]);
  for (const message of prepare) {
    assert.equal(message.raceMode, 'kart');
    assert.equal(message.map, 'candyland');
  }

  const hostStart = waitForMessage(host, 'race-start');
  const guestStart = waitForMessage(guest, 'race-start');
  host.send(JSON.stringify({ type: 'ready' }));
  guest.send(JSON.stringify({ type: 'ready' }));
  const starts = await Promise.all([hostStart, guestStart]);
  for (const message of starts) {
    assert.equal(message.raceMode, 'kart');
    assert.equal(message.map, 'candyland');
  }

  host.close();
  guest.close();

  // --- 碰碰赛可以开在霓虹地图上 ---------------------------------------------
  // 回归：服务端曾把碰碰赛房的地图强行规范到糖果两图之一（normalizeKartMap），
  // 房主选夜港会被静默搬到糖果湾。碰撞是车与车之间的规则，与赛道无关。
  const neonMaps = ['night', 'day', 'alpine', 'canyon', 'coast'];
  for (const map of neonMaps) {
    const neonHost = await connect();
    const neonJoinedPromise = waitForMessage(neonHost, 'joined');
    neonHost.send(JSON.stringify({ type: 'create', name: 'Neon Kart', map, raceMode: 'kart' }));
    const neonJoined = await neonJoinedPromise;
    assert.equal(neonJoined.room.raceMode, 'kart');
    assert.equal(neonJoined.room.map, map, `碰碰赛房应保留 ${map}，不得改写成糖果地图`);

    // 整条协议链路都要带着这张图，不能在 prepare / race-start 时被换掉。
    const neonGuest = await connect();
    const neonGuestJoined = waitForMessage(neonGuest, 'joined');
    neonGuest.send(JSON.stringify({ type: 'join', name: 'Neon Guest', code: neonJoined.room.code }));
    await neonGuestJoined;

    const neonPrepare = waitForMessage(neonHost, 'prepare');
    neonHost.send(JSON.stringify({ type: 'start' }));
    const preparedNeon = await neonPrepare;
    assert.equal(preparedNeon.map, map, `prepare 应保留 ${map}`);
    assert.equal(preparedNeon.raceMode, 'kart');

    const neonStart = waitForMessage(neonHost, 'race-start');
    neonHost.send(JSON.stringify({ type: 'ready' }));
    neonGuest.send(JSON.stringify({ type: 'ready' }));
    const startedNeon = await neonStart;
    assert.equal(startedNeon.map, map, `race-start 应保留 ${map}`);
    assert.equal(startedNeon.raceMode, 'kart');

    neonHost.close();
    neonGuest.close();
  }

  // 非法地图仍然要被挡住，退回默认的夜港。
  const bogusHost = await connect();
  const bogusJoined = waitForMessage(bogusHost, 'joined');
  bogusHost.send(JSON.stringify({ type: 'create', name: 'Bogus', map: '不存在的图', raceMode: 'kart' }));
  assert.equal((await bogusJoined).room.map, 'night', '非法地图应退回夜港');
  bogusHost.close();

  console.log(JSON.stringify({
    roomMode: 'kart',
    map: 'candyland',
    prepare: 'ok',
    raceStart: 'ok',
    neonMaps: neonMaps.length,
    invalidMapFallback: 'ok',
  }));
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
