import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { applyRaceResult, createDefaultRankState, formatRank } from '../src/ranked.js';
import { ONLINE_RACE_LAPS, TRACK_LENGTH_METERS, minimumFinishTimeMs } from '../server/race-validation.mjs';
import { createRankedStore, isValidPlayerId, rankOrdinal } from '../server/ranked-store.mjs';

const MAP = 'day';
const MAX_VALID_SPEED_MPS = 150;
const dataDir = mkdtempSync(join(tmpdir(), 'neon-apex-ranked-'));
const storeFile = join(dataDir, 'ranked.json');
const port = 14010 + Math.floor(Math.random() * 500);
const ALPHA_ID = 'alpha-1111111111111111';
const BETA_ID = 'beta-22222222222222222';
const GAMMA_ID = 'gamma-3333333333333333';
const DELTA_ID = 'delta-4444444444444444';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForMessage = (socket, type, timeoutMs = 8000, predicate = () => true) => new Promise((resolve, reject) => {
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

const waitForMatchReady = (socket) => waitForMessage(socket, 'match-status', 8000, (message) => message.state === 'ready');

async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  await once(socket, 'open');
  return socket;
}

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

async function quickMatch(socket, name, playerId, extra = {}) {
  const joined = waitForMessage(socket, 'joined');
  sendJson(socket, { type: 'quickMatch', name, playerId, ...extra });
  return joined;
}

function rankOf(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.rank ?? null;
}

// Drives a legal race: progress ramps just under the validator's speed ceiling,
// so a clean finish takes as long online as it would in the game.
function driveRace({
  socket, startAt, pace, finish = true,
}) {
  const trackLength = TRACK_LENGTH_METERS[MAP];
  const slope = (MAX_VALID_SPEED_MPS / trackLength) * pace;
  return new Promise((resolve) => {
    let sequence = 0;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startAt;
      if (elapsed < 0) return;
      const progress = Math.min(ONLINE_RACE_LAPS, (elapsed / 1000) * slope);
      const done = progress >= ONLINE_RACE_LAPS && elapsed >= minimumFinishTimeMs(MAP) + 50;
      sequence += 1;
      sendJson(socket, {
        type: 'state',
        sequence,
        x: Math.sin(sequence / 10) * 3,
        y: 0.4,
        z: Math.cos(sequence / 10) * 3,
        yaw: 0.1,
        speed: 60,
        progress,
        lap: 1,
        finished: done && finish,
      });
      if (done) {
        clearInterval(timer);
        resolve(sequence);
      }
    }, 200);
  });
}

// --- ranked-store unit coverage + seed data ---------------------------------

const seedStore = createRankedStore({ filePath: storeFile, flushIntervalMs: 0 });
assert.deepEqual(seedStore.get(ALPHA_ID), createDefaultRankState(), '未知 playerId 返回默认段位');
assert.equal(seedStore.apply('short', { position: 1, totalRacers: 2 }), null, '过短 playerId 被拒');
assert.equal(seedStore.apply('a'.repeat(65), { position: 1, totalRacers: 2 }), null, '超长 playerId 被拒');
assert.equal(seedStore.apply('../../etc/passwd', { position: 1, totalRacers: 2 }), null, '路径注入 playerId 被拒');
assert.equal(seedStore.apply('bad id ✅', { position: 1, totalRacers: 2 }), null, '非白名单字符 playerId 被拒');
assert.equal(isValidPlayerId(ALPHA_ID), true);
assert.equal(isValidPlayerId(''), false);
assert.equal(isValidPlayerId(null), false);
assert.equal(seedStore.size, 0, '非法 playerId 不写入存储');

let seedState = createDefaultRankState();
for (const playerId of [ALPHA_ID, BETA_ID]) {
  for (let index = 0; index < 2; index += 1) {
    const outcome = seedStore.apply(playerId, { position: 1, totalRacers: 6 });
    seedState = outcome.state;
  }
}
assert.equal(seedState.points, 60);
seedStore.close();

// ⑤ 落盘后重新打开能读回（进程内先验一次，服务端重启再验一次）
const reopened = createRankedStore({ filePath: storeFile, flushIntervalMs: 0 });
assert.equal(reopened.get(ALPHA_ID).points, 60);
assert.equal(reopened.get(BETA_ID).points, 60);
assert.equal(rankOrdinal(reopened.get(ALPHA_ID)), 0);
reopened.close();

const expectedWinner = applyRaceResult(reopened.get(ALPHA_ID), { position: 1, totalRacers: 2 }, 1);
const expectedLoser = applyRaceResult(reopened.get(BETA_ID), { position: 2, totalRacers: 2 }, 1);
assert.equal(expectedWinner.delta, 30);
assert.equal(expectedLoser.delta, -16);

const serverEnv = {
  ...process.env,
  NEON_APEX_PORT: String(port),
  NEON_APEX_START_DELAY_MS: '20',
  NEON_APEX_RANKED_FILL_MS: '900',
  NEON_APEX_RANKED_WIDEN_MS: '600',
  NEON_APEX_RANK_FILE: storeFile,
  NEON_APEX_RANKED_MAPS: MAP,
  NEON_APEX_MAX_ROOMS: '8',
  NEON_APEX_MAX_CONNECTIONS_PER_IP: '16',
  NEON_APEX_LOBBY_ACTION_LIMIT: '80',
  NEON_APEX_UNAUTHENTICATED_IDLE_MS: '30000',
};

async function startServer() {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  await Promise.race([
    once(child.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 5000)),
  ]);
  return child;
}

async function stopServer(child) {
  child.kill('SIGTERM');
  await once(child, 'exit').catch(() => {});
}

let server = await startServer();
const summary = {};

try {
  // ⑥ 非法 playerId 被拒
  const stranger = await connect();
  for (const playerId of ['abc', 'x'.repeat(65), 'has space', '<script>alert(1)</script>', null]) {
    const errorPromise = waitForMessage(stranger, 'error');
    sendJson(stranger, { type: 'quickMatch', name: '游客', playerId });
    const error = await errorPromise;
    assert.equal(error.code, 'INVALID_PLAYER_ID');
  }
  summary.invalidPlayerId = 'rejected';

  // ⑦ 取消排位
  const quitter = await connect();
  const quitterRoom = (await quickMatch(quitter, 'Quitter', GAMMA_ID)).room;
  assert.equal(quitterRoom.ranked, true);
  assert.equal(quitterRoom.mode, 'ranked');
  assert.equal(quitterRoom.players.length, 1);
  const cancelPromise = waitForMessage(quitter, 'match-cancelled');
  sendJson(quitter, { type: 'cancelQuickMatch' });
  assert.equal((await cancelPromise).reason, 'cancelled');
  const rejoinRoom = (await quickMatch(quitter, 'Quitter', GAMMA_ID)).room;
  assert.notEqual(rejoinRoom.code, quitterRoom.code, '取消后原排位房间已释放');
  assert.equal(rejoinRoom.players.length, 1);
  sendJson(quitter, { type: 'cancelQuickMatch' });
  await waitForMessage(quitter, 'match-cancelled');
  summary.cancelQuickMatch = 'ok';

  // ④ 未完赛 / 校验失败不结算
  const cheater = await connect();
  const drifter = await connect();
  const cheaterJoined = await quickMatch(cheater, 'Cheater', GAMMA_ID);
  const cheaterStatus = waitForMatchReady(cheater);
  const drifterJoined = await quickMatch(drifter, 'Drifter', DELTA_ID);
  assert.equal(drifterJoined.room.code, cheaterJoined.room.code);
  assert.equal((await cheaterStatus).state, 'ready');
  const cheaterPrepare = waitForMessage(cheater, 'prepare', 5000);
  const drifterPrepare = waitForMessage(drifter, 'prepare', 5000);
  await Promise.all([cheaterPrepare, drifterPrepare]);
  const cheaterStart = waitForMessage(cheater, 'race-start');
  const drifterStart = waitForMessage(drifter, 'race-start');
  sendJson(cheater, { type: 'ready' });
  sendJson(drifter, { type: 'ready' });
  const [dirtyStart] = await Promise.all([cheaterStart, drifterStart]);
  await sleep(Math.max(0, dirtyStart.startAt - Date.now() + 20));
  // Teleporting straight to the finish line: every state is rejected and the
  // socket is dropped after MAX_INVALID_STATES.
  const cheaterClosed = once(cheater, 'close');
  for (let sequence = 1; sequence <= 10; sequence += 1) {
    sendJson(cheater, {
      type: 'state', sequence, x: 0, y: 0.4, z: 0, yaw: 0, speed: 140, progress: 3, lap: 3, finished: true,
    });
  }
  const [closeCode] = await cheaterClosed;
  assert.equal(closeCode, 1008);
  sendJson(drifter, { type: 'leave' });
  await sleep(300);
  const auditor = await connect();
  const auditRoom = (await quickMatch(auditor, 'Auditor', GAMMA_ID)).room;
  assert.equal(rankOf(auditRoom, auditRoom.players[0].id).points, 0, '作弊者段位未被结算');
  assert.equal(rankOf(auditRoom, auditRoom.players[0].id).label, formatRank(createDefaultRankState()));
  sendJson(auditor, { type: 'cancelQuickMatch' });
  await waitForMessage(auditor, 'match-cancelled');
  auditor.close();
  drifter.close();
  summary.unsettled = 'ok';

  // ① 快速排位匹配成功并开赛
  const alpha = await connect();
  const beta = await connect();
  const alphaJoined = await quickMatch(alpha, 'Alpha', ALPHA_ID);
  const alphaStatus = waitForMatchReady(alpha);
  // ③ 客户端谎报段位分，服务端必须忽略
  const betaJoined = await quickMatch(beta, 'Beta', BETA_ID, { rankPoints: 999999 });
  assert.equal(betaJoined.room.code, alphaJoined.room.code, '同段位玩家匹配进同一房间');
  assert.equal(betaJoined.room.ranked, true);
  assert.equal(betaJoined.room.map, MAP);
  assert.equal(betaJoined.room.players.length, 2);
  assert.equal(rankOf(betaJoined.room, betaJoined.selfId).points, 60, '服务端以自己的存储为准');
  assert.equal(rankOf(betaJoined.room, betaJoined.selfId).label, '青铜 III · 60分');
  const status = await alphaStatus;
  assert.equal(status.players, 2);
  assert.equal(status.state, 'ready');
  assert.equal(typeof status.serverTime, 'number');
  assert.equal(typeof status.queuedForMs, 'number');
  assert.equal(typeof status.searchRange, 'number');

  const alphaPrepare = waitForMessage(alpha, 'prepare', 5000);
  const betaPrepare = waitForMessage(beta, 'prepare', 5000);
  const [prepare] = await Promise.all([alphaPrepare, betaPrepare]);
  assert.equal(prepare.map, MAP);
  const alphaStart = waitForMessage(alpha, 'race-start');
  const betaStart = waitForMessage(beta, 'race-start');
  sendJson(alpha, { type: 'ready' });
  sendJson(beta, { type: 'ready' });
  const [raceStart] = await Promise.all([alphaStart, betaStart]);
  assert.match(raceStart.raceId, /^[0-9a-f-]{36}$/);
  summary.match = { room: alphaJoined.room.code, map: raceStart.map, players: 2 };

  // ② 赛后按名次结算
  const betaResultPromise = waitForMessage(beta, 'rankResult', 60000);
  const standingsPromise = waitForMessage(beta, 'race-result', 60000);
  process.stderr.write(`[ranked-online] 正在跑完整 3 圈联机排位（约 ${Math.round(minimumFinishTimeMs(MAP) / 1000)} 秒）…\n`);
  const alphaFinished = waitForMessage(alpha, 'race-finish', 60000, (message) => message.playerId === alphaJoined.selfId);
  const betaDrive = driveRace({ socket: beta, startAt: raceStart.startAt, pace: 0.9 });
  await driveRace({ socket: alpha, startAt: raceStart.startAt, pace: 0.97 });
  const alphaFinish = await alphaFinished;
  assert.equal(alphaFinish.raceId, raceStart.raceId);
  assert.equal(alphaFinish.position, 1);
  alpha.close();
  await once(alpha, 'close');
  await betaDrive;
  const [betaResult, standings] = await Promise.all([betaResultPromise, standingsPromise]);

  // The winner dropped after finishing but before the race settled. Resume must
  // replay the immutable authoritative settlement without applying it again.
  const alphaResumedSocket = await connect();
  const resumedPromise = waitForMessage(alphaResumedSocket, 'resumed');
  const alphaResultPromise = waitForMessage(alphaResumedSocket, 'rankResult');
  const replayedStandingsPromise = waitForMessage(alphaResumedSocket, 'race-result');
  sendJson(alphaResumedSocket, {
    type: 'resume',
    code: alphaJoined.room.code,
    playerId: alphaJoined.selfId,
    reconnectToken: alphaJoined.reconnectToken,
  });
  await resumedPromise;
  const [alphaResult, replayedStandings] = await Promise.all([alphaResultPromise, replayedStandingsPromise]);

  assert.equal(standings.ranked, true);
  assert.equal(standings.reason, 'completed');
  assert.equal(standings.totalRacers, 2);
  assert.equal(standings.standings[0].name, 'Alpha');
  assert.equal(standings.standings[1].name, 'Beta');
  assert.equal(standings.authoritative, true);
  assert.equal(standings.raceId, raceStart.raceId);
  assert.equal(replayedStandings.settlementId, standings.settlementId);

  assert.equal(alphaResult.settled, true);
  assert.equal(alphaResult.position, 1);
  assert.equal(alphaResult.delta, expectedWinner.delta);
  assert.equal(alphaResult.rank.points, expectedWinner.state.points);
  assert.equal(alphaResult.rank.tier, expectedWinner.state.tier);
  assert.equal(alphaResult.rank.division, expectedWinner.state.division);
  assert.equal(alphaResult.rank.label, expectedWinner.label);
  assert.equal(alphaResult.promoted, expectedWinner.promoted);
  assert.equal(alphaResult.authoritative, true);
  assert.equal(alphaResult.settlementId, standings.settlementId);

  assert.equal(betaResult.settled, true);
  assert.equal(betaResult.position, 2);
  assert.ok(betaResult.delta < 0, '末位车手必须扣分');
  assert.equal(betaResult.delta, expectedLoser.delta);
  assert.equal(betaResult.rank.points, expectedLoser.state.points);
  assert.equal(betaResult.rank.label, expectedLoser.label);
  assert.equal(betaResult.demoted, expectedLoser.demoted);
  assert.ok(betaResult.rank.points < 60 && alphaResult.rank.points > 60);
  summary.settlement = {
    winner: { delta: alphaResult.delta, points: alphaResult.rank.points },
    loser: { delta: betaResult.delta, points: betaResult.rank.points },
    resumed: alphaResult.settlementId,
  };

  alphaResumedSocket.close();
  beta.close();
  cheater.close();
  quitter.close();
  stranger.close();

  // ⑤ 落盘 + 重启读回
  await stopServer(server);
  const persisted = JSON.parse(readFileSync(storeFile, 'utf8'));
  assert.equal(persisted.version, 1);
  assert.deepEqual(Object.keys(persisted.players).sort(), [ALPHA_ID, BETA_ID].sort());
  assert.equal(persisted.players[ALPHA_ID].points, expectedWinner.state.points);
  assert.equal(persisted.players[BETA_ID].points, expectedLoser.state.points);

  server = await startServer();
  const revenant = await connect();
  const revenantRoom = (await quickMatch(revenant, 'Alpha', ALPHA_ID)).room;
  assert.equal(rankOf(revenantRoom, revenantRoom.players[0].id).points, expectedWinner.state.points);
  assert.equal(rankOf(revenantRoom, revenantRoom.players[0].id).label, expectedWinner.label);
  sendJson(revenant, { type: 'cancelQuickMatch' });
  await waitForMessage(revenant, 'match-cancelled');
  revenant.close();
  summary.persistence = { file: 'ranked.json', alpha: persisted.players[ALPHA_ID].points };

  // 客户端封装：匿名 playerId 持久化 + quickMatch / cancelQuickMatch
  const { MultiplayerClient, PLAYER_ID_KEY, resolvePlayerId } = await import('../src/multiplayer-client.js');
  const storage = new Map();
  const memoryStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const generatedId = resolvePlayerId(memoryStorage);
  assert.match(generatedId, /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(resolvePlayerId(memoryStorage), generatedId, 'playerId 只生成一次并持久化');
  assert.equal(memoryStorage.getItem(PLAYER_ID_KEY), generatedId);

  const client = new MultiplayerClient({
    url: `ws://127.0.0.1:${port}/multiplayer`,
    storage: memoryStorage,
    rankState: { points: 999999 },
  });
  assert.equal(client.playerId, generatedId);
  const clientRoom = await client.quickMatch({ name: '客户端' });
  assert.equal(clientRoom.ranked, true);
  assert.equal(client.isRanked, true);
  assert.equal(client.rank.label, formatRank(createDefaultRankState()), '客户端谎报的分数不会变成段位');
  const selfRow = client.roster.find((player) => player.self);
  assert.equal(client.roster.length, 1);
  assert.equal(selfRow.rank.tierId, 'bronze');
  assert.equal(selfRow.hasRank, true);
  const cancelled = new Promise((resolve) => {
    client.addEventListener('match-cancelled', resolve, { once: true });
  });
  client.cancelQuickMatch();
  await cancelled;
  assert.equal(client.room, null);
  assert.equal(client.matching, false);
  client.leave();
  summary.client = 'ok';

  console.log(JSON.stringify(summary));
} finally {
  await stopServer(server);
}
