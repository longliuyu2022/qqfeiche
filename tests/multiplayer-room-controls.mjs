import assert from 'node:assert/strict';
import { racePosition } from './race-fixtures.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 14510 + Math.floor(Math.random() * 400);
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_START_DELAY_MS: '20',
    NEON_APEX_MAX_ROOMS: '4',
    NEON_APEX_MAX_CONNECTIONS_PER_IP: '16',
    NEON_APEX_LOBBY_ACTION_LIMIT: '80',
    NEON_APEX_UNAUTHENTICATED_IDLE_MS: '5000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForMessage = (socket, type, timeoutMs = 4000, predicate = () => true) => new Promise((resolve, reject) => {
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
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  await once(socket, 'open');
  return socket;
}

function send(socket, payload) {
  socket.send(JSON.stringify(payload));
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 4000)),
  ]);

  const host = await connect();
  const hostJoinedPromise = waitForMessage(host, 'joined');
  send(host, {
    type: 'create', name: 'Host', map: 'candyland', raceMode: 'kart', trackVariant: 'mirror', password: 'sugar-42',
  });
  const hostJoined = await hostJoinedPromise;
  const code = hostJoined.room.code;
  assert.equal(hostJoined.room.raceMode, 'kart');
  assert.equal(hostJoined.room.trackVariant, 'mirror');
  assert.equal(hostJoined.room.passwordProtected, true);

  const wrongPassword = await connect();
  const badPasswordPromise = waitForMessage(wrongPassword, 'error');
  send(wrongPassword, { type: 'join', name: 'Wrong', code, password: 'nope' });
  assert.equal((await badPasswordPromise).code, 'BAD_PASSWORD');
  wrongPassword.close();

  const guest = await connect();
  const guestJoinedPromise = waitForMessage(guest, 'joined');
  send(guest, { type: 'join', name: 'Guest', code, password: 'sugar-42' });
  const guestJoined = await guestJoinedPromise;
  assert.equal(guestJoined.room.players.filter((player) => !player.spectator).length, 2);

  const spectator = await connect();
  const spectatorJoinedPromise = waitForMessage(spectator, 'joined');
  send(spectator, { type: 'join', name: 'Viewer', code, password: 'sugar-42', spectator: true });
  const spectatorJoined = await spectatorJoinedPromise;
  assert.equal(spectatorJoined.room.players.filter((player) => !player.spectator).length, 2);
  assert.equal(spectatorJoined.room.players.filter((player) => player.spectator).length, 1);

  const spectatorId = spectatorJoined.selfId;
  assert.equal(spectatorJoined.room.connectedCount, 2);
  assert.equal(spectatorJoined.room.readyCount, 0);
  const guestKickErrorPromise = waitForMessage(guest, 'error');
  send(guest, { type: 'kick', playerId: spectatorId });
  assert.equal((await guestKickErrorPromise).code, 'HOST_ONLY');

  const kickedPromise = waitForMessage(spectator, 'kicked');
  const hostRoomAfterKickPromise = waitForMessage(host, 'room', 4000, (message) => !message.room.players.some((player) => player.id === spectatorId));
  send(host, { type: 'kick', playerId: spectatorId });
  assert.equal((await kickedPromise).message, '你已被房主移出房间');
  await hostRoomAfterKickPromise;

  const viewer = await connect();
  const viewerJoinedPromise = waitForMessage(viewer, 'joined');
  send(viewer, { type: 'join', name: 'Viewer 2', code, password: 'sugar-42', spectator: true });
  const viewerJoined = await viewerJoinedPromise;
  assert.equal(viewerJoined.room.players.find((player) => player.id === viewerJoined.selfId).spectator, true);

  const hostPrepare = waitForMessage(host, 'prepare');
  const guestPrepare = waitForMessage(guest, 'prepare');
  const viewerPrepare = waitForMessage(viewer, 'prepare');
  send(host, { type: 'start' });
  const [prepare, guestPrepareMessage, viewerPrepareMessage] = await Promise.all([hostPrepare, guestPrepare, viewerPrepare]);
  assert.equal(prepare.trackVariant, 'mirror');
  assert.equal(guestPrepareMessage.raceMode, 'kart');
  assert.equal(viewerPrepareMessage.map, 'candyland');

  const hostStart = waitForMessage(host, 'race-start');
  const guestStart = waitForMessage(guest, 'race-start');
  const viewerStart = waitForMessage(viewer, 'race-start');
  send(host, { type: 'ready' });
  send(guest, { type: 'ready' });
  const [raceStart, guestRaceStart, viewerRaceStart] = await Promise.all([hostStart, guestStart, viewerStart]);
  assert.equal(raceStart.trackVariant, 'mirror');
  assert.equal(guestRaceStart.raceMode, 'kart');
  assert.equal(viewerRaceStart.map, 'candyland');
  await sleep(Math.max(0, raceStart.startAt - Date.now() + 10));

  const lateViewer = await connect();
  const lateJoinedPromise = waitForMessage(lateViewer, 'joined');
  const latePreparePromise = waitForMessage(lateViewer, 'prepare');
  const lateRaceStartPromise = waitForMessage(lateViewer, 'race-start');
  send(lateViewer, { type: 'join', name: 'Late viewer', code, password: 'sugar-42', spectator: true });
  await lateJoinedPromise;
  const latePrepare = await latePreparePromise;
  const lateRaceStart = await lateRaceStartPromise;
  assert.equal(latePrepare.trackVariant, 'mirror');
  assert.equal(lateRaceStart.raceId, raceStart.raceId);

  const snapshotPromise = waitForMessage(viewer, 'snapshot');
  send(viewer, {
    type: 'state', sequence: 1, x: 999, y: 0, z: 999, yaw: 0, speed: 150, progress: 2.9, lap: 3, finished: true,
  });
  send(host, {
    type: 'state', sequence: 1, ...racePosition(raceStart.map, 0.001, { variant: 'mirror' }), yaw: 0.5, speed: 42, progress: 0.001, lap: 1, finished: false,
  });
  const snapshot = await snapshotPromise;
  assert.equal(snapshot.players.length, 1, 'spectator state must not enter snapshots');
  assert.equal(snapshot.players[0].id, hostJoined.selfId);
  assert.equal(snapshot.players.some((player) => player.id === viewerJoined.selfId), false);

  for (const socket of [host, guest, viewer, lateViewer]) socket.close();
  console.log(JSON.stringify({
    password: 'ok',
    kick: 'host-only',
    spectator: 'non-participant',
    trackVariant: 'mirror',
    kartMap: 'candyland',
  }));
} finally {
  server.kill('SIGTERM');
  await once(server, 'exit').catch(() => {});
}
