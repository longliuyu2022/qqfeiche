/**
 * 三人好友房跑完整一局，复现玩家反馈的三个症状：
 *   1. 互相进度不同步
 *   2. 偶发"连接不稳定"
 *   3. 冲线后不结算，比赛还在继续
 *
 * 只用真实服务端与真实协议，不打桩。
 */
import assert from 'node:assert/strict';
import { racePosition } from './race-fixtures.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { ONLINE_RACE_LAPS, TRACK_LENGTH_METERS } from '../server/race-validation.mjs';

const port = 14100 + Math.floor(Math.random() * 400);
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
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务端启动超时')), 15000);
  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('listening')) { clearTimeout(timer); resolve(); }
  });
});
await ready;

async function open() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
    await once(socket, 'open');
    const peer = { socket, inbox: [], closed: null, snapshots: [] };
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      peer.inbox.push(message);
      if (message.type === 'snapshot') peer.snapshots.push(message);
    });
    socket.on('close', (code, reason) => { peer.closed = { code, reason: reason.toString() }; });
    return peer;
}

const send = (peer, type, payload = {}) => peer.socket.send(JSON.stringify({ type, ...payload }));
const waitFor = async (peer, type, timeoutMs = 6000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = peer.inbox.find((m) => m.type === type);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`等待 ${type} 超时`);
    await new Promise((r) => setTimeout(r, 25));
  }
};

const host = await open();
const guestA = await open();
const guestB = await open();

send(host, 'create', { name: '房主', map: 'night' });
const created = await waitFor(host, 'room');
const code = created.room.code;
assert.ok(code, '房主应拿到房间码');
assert.equal(created.room.ranked, false, '房间码房间不是排位赛');

send(guestA, 'join', { name: '车手A', code });
send(guestB, 'join', { name: '车手B', code });
await waitFor(guestA, 'room');
await waitFor(guestB, 'room');

const peers = [host, guestA, guestB];
// 时序：房主 start 让房间进入 loading，各客户端再报 ready，服务端才发 race-start。
send(host, 'start');
await waitFor(host, 'room');
for (const p of peers) send(p, 'ready');
const started = await waitFor(host, 'race-start', 8000);
const startAt = started.startAt;
await new Promise((r) => setTimeout(r, Math.max(0, startAt - Date.now()) + 60));

// 三人以不同配速跑完 3 圈。进度按真实时间推进，确保通过服务端的速度校验。
const trackLength = TRACK_LENGTH_METERS.night;
const raceStart = Date.now();
// 校验设了最短完赛时间（2071m × 3 圈 ÷ 150m/s ≈ 41 秒），配速取接近上限的值，
// 既能通过校验又不至于让测试跑太久。
const pace = { 房主: 135, 车手A: 125, 车手B: 115 };   // m/s，低于 150 的校验上限
const sequences = { 房主: 0, 车手A: 0, 车手B: 0 };
const names = ['房主', '车手A', '车手B'];
const finishedAt = {};

for (let tick = 0; tick < 1100; tick += 1) {
  const elapsed = (Date.now() - raceStart) / 1000;
  let allDone = true;
  peers.forEach((peer, index) => {
    const name = names[index];
    const progress = Math.min(ONLINE_RACE_LAPS, (elapsed * pace[name]) / trackLength);
    const done = progress >= ONLINE_RACE_LAPS;
    if (!done) allDone = false;
    sequences[name] += 1;
    const angle = (progress % 1) * Math.PI * 2;
    send(peer, 'state', {
      sequence: sequences[name],
      ...racePosition('night', progress, { index }),
      yaw: angle, speed: pace[name],
      progress, lap: Math.min(ONLINE_RACE_LAPS, Math.floor(progress) + 1),
      finished: done,
      finishTime: done ? elapsed : null,
    });
    if (done && !finishedAt[name]) finishedAt[name] = Date.now();
  });
  if (allDone) break;
  await new Promise((r) => setTimeout(r, 66));
}

assert.equal(Object.keys(finishedAt).length, 3, '三人都应跑完 3 圈');

// --- 症状 1：互相进度是否同步 -------------------------------------------------
await new Promise((r) => setTimeout(r, 400));
const latest = host.snapshots.at(-1);
assert.ok(latest, '房主应收到过快照');
// 快照按 id 标识玩家且包含自己，三人都应出现。
assert.equal(latest.players.length, 3, `快照里应有三名车手，实际 ${latest.players.length} 名`);
const stalled = latest.players.filter((p) => (p.progress ?? 0) < ONLINE_RACE_LAPS - 0.05);
assert.deepEqual(
  stalled.map((p) => `${p.name}@${(p.progress ?? 0).toFixed(2)}`),
  [],
  '所有人都已冲线，快照里不应还有人卡在半路',
);

// --- 症状 2：是否有人被服务端踢下线 -------------------------------------------
const dropped = peers.map((p, i) => (p.closed ? `${names[i]}:${p.closed.code}` : null)).filter(Boolean);
assert.deepEqual(dropped, [], '正常跑完全程不应有人被断开连接');

// --- 症状 3：冲线后是否结算 ---------------------------------------------------
let settled = null;
const settleDeadline = Date.now() + 6000;
while (Date.now() < settleDeadline) {
  settled = host.inbox.find((m) => m.type === 'race-result' || m.type === 'rank-result');
  if (settled) break;
  await new Promise((r) => setTimeout(r, 100));
}
const lastRoom = [...host.inbox].reverse().find((m) => m.type === 'room');
assert.ok(
  settled || lastRoom?.room?.phase === 'finished',
  `三人全部冲线后 6 秒内应结算，实际房间仍处于 ${lastRoom?.room?.phase} 阶段`,
);

// --- 结算内容：好友房只出名次，绝不动段位分 -----------------------------------
const raceResult = host.inbox.find((m) => m.type === 'race-result');
assert.ok(raceResult, '结算应广播 race-result');
assert.equal(raceResult.ranked, false, '好友房的结算不能被标记为排位赛');
assert.equal(raceResult.standings.length, 3, '结算名单应含三人');
assert.deepEqual(
  raceResult.standings.map((r) => r.position),
  [1, 2, 3],
  '名次应按冲线顺序排定',
);
for (const row of raceResult.standings) {
  assert.equal(row.finished, true, `${row.name} 应被记为完赛`);
  assert.equal(row.settled, false, '好友房不应产生上分结算');
  assert.equal(row.reason, 'unranked_room');
  assert.equal(row.delta, 0, '好友房不得增减段位分');
}

// 客户端据 settled 判断是否回写段位；好友房这里必须是 false，
// 否则 main.js 会把服务端返回的默认段位覆盖到本地，把玩家洗成青铜。
const rankResult = host.inbox.find((m) => m.type === 'rankResult');
assert.ok(rankResult, '每位玩家都应收到 rankResult');
assert.equal(rankResult.settled, false, '好友房的 rankResult 必须 settled=false');
assert.ok(Number.isFinite(rankResult.position), 'rankResult 应带权威名次');

for (const p of peers) p.socket.close();
server.kill('SIGTERM');
console.log(JSON.stringify({
  progressSync: 'ok', noDrops: 'ok', settlement: 'ok',
  standings: 'ok', rankUntouched: 'ok',
}));
