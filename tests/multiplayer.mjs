import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 13010 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_START_DELAY_MS: '20',
    NEON_APEX_MAX_ROOMS: '1',
    NEON_APEX_MAX_CONNECTIONS_PER_IP: '3',
    NEON_APEX_LOBBY_ACTION_LIMIT: '4',
    NEON_APEX_UNAUTHENTICATED_IDLE_MS: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForMessage = (socket, type, timeoutMs = 4000) => new Promise((resolve, reject) => {
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

async function expectConnectionRejected(statusCode) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
    let settled = false;
    socket.once('unexpected-response', (_request, response) => {
      settled = true;
      response.resume();
      try {
        assert.equal(response.statusCode, statusCode);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    socket.once('open', () => reject(new Error('connection limit accepted an extra socket')));
    socket.once('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 4000)),
  ]);

  const host = await connect();
  const hostJoinedPromise = waitForMessage(host, 'joined');
  host.send(JSON.stringify({ type: 'create', name: 'Host', map: 'coast' }));
  const hostJoined = await hostJoinedPromise;
  assert.match(hostJoined.room.code, /^[A-Z2-9]{6}$/);
  assert.equal(hostJoined.room.map, 'coast');

  const probe = await connect();
  const roomLimitPromise = waitForMessage(probe, 'error');
  probe.send(JSON.stringify({ type: 'create', name: 'Probe', map: 'night' }));
  const roomLimit = await roomLimitPromise;
  assert.equal(roomLimit.code, 'SERVER_BUSY');

  const guest = await connect();
  const guestJoinedPromise = waitForMessage(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', name: 'Guest', code: hostJoined.room.code }));
  const guestJoined = await guestJoinedPromise;
  assert.equal(guestJoined.room.players.length, 2);

  // Friend rooms stay unranked but still surface每位车手的段位, so the host can
  // size up the grid before发车.
  assert.equal(guestJoined.room.mode, 'friendly');
  assert.equal(guestJoined.room.ranked, false);
  for (const player of guestJoined.room.players) {
    assert.equal(typeof player.rank.tier, 'number');
    assert.equal(typeof player.rank.division, 'number');
    assert.equal(typeof player.rank.points, 'number');
    assert.equal(typeof player.rank.label, 'string');
    assert.equal(player.rank.tierId, 'bronze');
    assert.equal(player.rank.label, '青铜 III · 0分');
    assert.equal(player.hasRank, false);
  }

  await expectConnectionRejected(429);

  const missingRoomPromise = waitForMessage(probe, 'error');
  probe.send(JSON.stringify({ type: 'join', name: 'Probe', code: 'ZZZZZZ' }));
  const missingRoom = await missingRoomPromise;
  assert.equal(missingRoom.code, 'ROOM_NOT_FOUND');
  const rateLimitPromise = waitForMessage(probe, 'error');
  probe.send(JSON.stringify({ type: 'join', name: 'Probe', code: 'YYYYYY' }));
  const rateLimit = await rateLimitPromise;
  assert.equal(rateLimit.code, 'RATE_LIMITED');

  const hostPrepare = waitForMessage(host, 'prepare');
  const guestPrepare = waitForMessage(guest, 'prepare');
  host.send(JSON.stringify({ type: 'start' }));
  const prepareMessages = await Promise.all([hostPrepare, guestPrepare]);
  assert.ok(prepareMessages.every((message) => message.map === 'coast'));

  const hostStart = waitForMessage(host, 'race-start');
  const guestStart = waitForMessage(guest, 'race-start');
  host.send(JSON.stringify({ type: 'ready' }));
  guest.send(JSON.stringify({ type: 'ready' }));
  const [raceStart] = await Promise.all([hostStart, guestStart]);
  assert.ok(raceStart.startAt > Date.now() - 1000, 'race start must be within the server start window');
  assert.equal(raceStart.map, 'coast');
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, raceStart.startAt - Date.now() + 10)));

  const snapshotPromise = waitForMessage(guest, 'snapshot');
  host.send(JSON.stringify({
    type: 'state', sequence: 1, x: 12, y: 3, z: -8, yaw: 0.5,
    speed: 42, progress: 0.001, lap: 9, finished: false,
  }));
  const snapshot = await snapshotPromise;
  assert.equal(snapshot.players[0].x, 12);
  assert.equal(snapshot.players[0].progress, 0.001);
  assert.equal(snapshot.players[0].lap, 1);

  const rejectedSnapshotPromise = waitForMessage(guest, 'snapshot');
  host.send(JSON.stringify({
    type: 'state', sequence: 2, x: 14, y: 3, z: -8, yaw: 0.5,
    speed: 42, progress: 2, lap: 3, finished: false,
  }));
  const rejectedSnapshot = await rejectedSnapshotPromise;
  assert.equal(rejectedSnapshot.players[0].sequence, 1);
  assert.equal(rejectedSnapshot.players[0].progress, 0.001);

  host.close();
  guest.close();
  probe.close();
  console.log(JSON.stringify({
    room: hostJoined.room.code,
    players: 2,
    map: 'coast',
    sync: 'ok',
    roomLimit: roomLimit.code,
    rateLimit: rateLimit.code,
    connectionLimit: 429,
    invalidState: 'rejected',
    rankFields: 'ok',
  }));
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
