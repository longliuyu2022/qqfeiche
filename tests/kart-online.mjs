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
  console.log(JSON.stringify({ roomMode: 'kart', map: 'candyland', prepare: 'ok', raceStart: 'ok' }));
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
