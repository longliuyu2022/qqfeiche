import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 13010 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NEON_APEX_PORT: String(port) },
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

  const guest = await connect();
  const guestJoinedPromise = waitForMessage(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', name: 'Guest', code: hostJoined.room.code }));
  const guestJoined = await guestJoinedPromise;
  assert.equal(guestJoined.room.players.length, 2);

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
  assert.ok(raceStart.startAt > Date.now());
  assert.equal(raceStart.map, 'coast');

  const snapshotPromise = waitForMessage(guest, 'snapshot');
  host.send(JSON.stringify({
    type: 'state', sequence: 1, x: 12, y: 3, z: -8, yaw: 0.5,
    speed: 42, progress: 0.2, lap: 1, finished: false,
  }));
  const snapshot = await snapshotPromise;
  assert.equal(snapshot.players[0].x, 12);
  assert.equal(snapshot.players[0].progress, 0.2);

  host.close();
  guest.close();
  console.log(JSON.stringify({ room: hostJoined.room.code, players: 2, map: 'coast', sync: 'ok' }));
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
