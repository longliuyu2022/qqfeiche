// 联机赛金币奖励：服务端按名次算钱并直接记到账号钱包，客户端上报的技巧分 /
// 净胜 / 破纪录一概不采信。这里跑一场真实的两人好友房比赛，验证：
//   1. 奖励额度按名次由服务端计算，第一名高于第二名
//   2. 钱真的进了账号钱包文件，且 coins 与 totalEarned 同步增长
//   3. 未完赛的车手拿 0，并带上原因
//   4. 游客（未登录）拿 0，原因是 guest_no_account
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { ONLINE_RACE_LAPS, TRACK_LENGTH_METERS, minimumFinishTimeMs } from '../server/race-validation.mjs';
import { onlineRaceReward } from '../src/shop.js';

// 糖果湾是最短赛道（1671m），最短合法完赛约 33 秒，端到端测试用它最省时间。
const MAP = 'candy';
const MAX_VALID_SPEED_MPS = 150;
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'neon-apex-online-rewards-'));
const authFile = path.join(temporaryDirectory, 'accounts.json');
const walletFile = path.join(temporaryDirectory, 'wallets.json');
const port = 14800 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_AUTH_FILE: authFile,
    NEON_APEX_WALLET_FILE: walletFile,
    NEON_APEX_START_DELAY_MS: '20',
    NEON_APEX_MAX_CONNECTIONS_PER_IP: '8',
    NEON_APEX_LOBBY_ACTION_LIMIT: '40',
    NEON_APEX_AUTH_ACTION_LIMIT: '50',
    // 中途退赛那一场靠「掉线后被移出名单」触发结算，把重连窗口压到最短，
    // 免得测试干等默认的 20 秒。
    NEON_APEX_RECONNECT_MS: '1000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const waitForMessage = (socket, type, timeoutMs = 8000, predicate) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.off('message', handler);
    reject(new Error(`Timed out waiting for ${type}`));
  }, timeoutMs);
  const handler = (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type !== type) return;
    if (predicate && !predicate(message)) return;
    clearTimeout(timeout);
    socket.off('message', handler);
    resolve(message);
  };
  socket.on('message', handler);
});

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    setCookie: response.headers.get('set-cookie'),
  };
}

async function registerAccount(username) {
  const registered = await request('/multiplayer/auth/register', {
    method: 'POST',
    body: { username, password: 'Str0ng-Passw0rd!' },
  });
  assert.equal(registered.status, 201, `注册 ${username} 应成功`);
  return {
    id: registered.body.user.id,
    cookie: registered.setCookie.split(';')[0],
  };
}

async function connect(cookie) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`, {
    headers: cookie ? { cookie } : {},
  });
  await once(socket, 'open');
  return socket;
}

function sendJson(socket, payload) {
  socket.send(JSON.stringify(payload));
}

// 钱包存储按固定间隔刷盘（默认 4 秒），所以读文件要等它真的写出来。
async function readWalletFile(timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await readFile(walletFile, 'utf8'));
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

// 合法节奏跑完全程：进度爬升略低于校验器的速度上限，所以线上完赛耗时与真实
// 比赛一致。pace 越小越慢，用来拉开名次。
function driveRace({ socket, startAt, pace, finish = true }) {
  const slope = (MAX_VALID_SPEED_MPS / TRACK_LENGTH_METERS[MAP]) * pace;
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

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 5000)),
  ]);

  const suffix = Math.floor(Math.random() * 100000);
  const winner = await registerAccount(`冠军${suffix}`);
  const runnerUp = await registerAccount(`亚军${suffix}`);

  // --- 两个登录账号跑一场好友房 --------------------------------------------
  const host = await connect(winner.cookie);
  const guest = await connect(runnerUp.cookie);

  const hostJoined = waitForMessage(host, 'joined');
  sendJson(host, { type: 'create', map: MAP, name: '忽略这个昵称' });
  const hostRoom = await hostJoined;
  assert.equal(hostRoom.room.players[0].registered, true, '登录账号应标记为已注册');

  const guestJoined = waitForMessage(guest, 'joined');
  sendJson(guest, { type: 'join', code: hostRoom.room.code, name: '忽略这个昵称' });
  await guestJoined;

  // 房主先 start 进入准备，两边 ready 之后才会收到 race-start。
  const hostPrepare = waitForMessage(host, 'prepare');
  const guestPrepare = waitForMessage(guest, 'prepare');
  sendJson(host, { type: 'start' });
  await Promise.all([hostPrepare, guestPrepare]);

  const hostStart = waitForMessage(host, 'race-start');
  const guestStartMessage = waitForMessage(guest, 'race-start');
  sendJson(host, { type: 'ready' });
  sendJson(guest, { type: 'ready' });
  const [started] = await Promise.all([hostStart, guestStartMessage]);
  const startAt = started.startAt;

  const hostResult = waitForMessage(host, 'rankResult', 90000);
  const guestResult = waitForMessage(guest, 'rankResult', 90000);
  // 主机跑得更快，先冲线拿第一。
  await Promise.all([
    driveRace({ socket: host, startAt, pace: 1 }),
    driveRace({ socket: guest, startAt, pace: 0.92 }),
  ]);
  const [hostRow, guestRow] = await Promise.all([hostResult, guestResult]);

  assert.equal(hostRow.position, 1, '主机应拿第一');
  assert.equal(guestRow.position, 2, '客人应拿第二');

  // 好友房不上分（unranked_room），但必须发钱。
  assert.equal(hostRow.settled, false, '好友房不动段位分');
  assert.equal(hostRow.reason, 'unranked_room');

  const expectedFirst = onlineRaceReward({ position: 1, totalRacers: 2, finished: true });
  const expectedSecond = onlineRaceReward({ position: 2, totalRacers: 2, finished: true });
  assert.equal(hostRow.coinsAwarded, expectedFirst, '第一名奖励应与服务端公式一致');
  assert.equal(guestRow.coinsAwarded, expectedSecond, '第二名奖励应与服务端公式一致');
  assert.ok(hostRow.coinsAwarded > guestRow.coinsAwarded, '第一名应比第二名拿得多');
  assert.equal(hostRow.coinsReason, null, '正常完赛没有拦截原因');

  // 钱真的落到了钱包文件里，coins 与 totalEarned 同步增长。
  // 存储按 4 秒间隔刷盘，等它写出来再读。
  const wallets = (await readWalletFile()).wallets;
  assert.equal(wallets[winner.id].coins, expectedFirst, '第一名的金币应已入账');
  assert.equal(wallets[winner.id].totalEarned, expectedFirst, 'totalEarned 必须同步增长');
  assert.equal(wallets[runnerUp.id].coins, expectedSecond, '第二名的金币应已入账');

  // HTTP 侧读到的也是同一份。
  const fetched = await request('/multiplayer/auth/wallet', { cookie: winner.cookie });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.wallet.coins, expectedFirst, '钱包接口应返回已入账的金币');

  host.close();
  guest.close();

  // --- 游客与未完赛 --------------------------------------------------------
  const guestHost = await connect();
  const quitter = await connect();

  const guestHostJoined = waitForMessage(guestHost, 'joined');
  sendJson(guestHost, { type: 'create', map: MAP, name: '游客房主' });
  const guestRoom = await guestHostJoined;
  assert.equal(guestRoom.room.players[0].registered, false, '未登录应是游客');

  const quitterJoined = waitForMessage(quitter, 'joined');
  sendJson(quitter, { type: 'join', code: guestRoom.room.code, name: '中途退赛' });
  await quitterJoined;

  const guestHostPrepare = waitForMessage(guestHost, 'prepare');
  const quitterPrepare = waitForMessage(quitter, 'prepare');
  sendJson(guestHost, { type: 'start' });
  await Promise.all([guestHostPrepare, quitterPrepare]);

  const guestStart = waitForMessage(guestHost, 'race-start');
  const quitterStart = waitForMessage(quitter, 'race-start');
  sendJson(guestHost, { type: 'ready' });
  sendJson(quitter, { type: 'ready' });
  const [guestStarted] = await Promise.all([guestStart, quitterStart]);

  const guestHostResult = waitForMessage(guestHost, 'rankResult', 90000);
  // 整场的名次表，退赛者那一行只能从这里看：它已经断线，收不到自己的 rankResult。
  const guestRaceResult = waitForMessage(guestHost, 'race-result', 90000);
  // 这位跑到一半就退：始终不报完赛，然后断线。房间里只要还有人可能改变名次就
  // 不会结算，所以必须真的离开，否则要干等 12 分钟超时。
  driveRace({ socket: quitter, startAt: guestStarted.startAt, pace: 0.9, finish: false });
  await driveRace({ socket: guestHost, startAt: guestStarted.startAt, pace: 1 });
  quitter.close();
  const [guestHostRow, raceResult] = await Promise.all([guestHostResult, guestRaceResult]);
  const quitterRow = raceResult.standings.find((row) => row.playerId !== guestHostRow.playerId);

  // 游客完赛了，奖励算得出来但没有账号可记账。
  assert.equal(guestHostRow.finished, true, '游客房主应已完赛');
  assert.equal(guestHostRow.coinsAwarded, 0, '游客拿不到金币');
  assert.equal(guestHostRow.coinsReason, 'guest_no_account', '应说明是因为没有账号');

  // 未完赛：奖励在算之前就被拦掉。
  assert.equal(quitterRow.finished, false, '未上报完赛应算未完赛');
  assert.equal(quitterRow.coinsAwarded, 0, '未完赛不发钱');
  assert.equal(quitterRow.coinsReason, 'not_finished');

  guestHost.close();

  // 游客那场不该在钱包文件里凭空造出账号。
  const finalWallets = (await readWalletFile()).wallets;
  assert.deepEqual(
    Object.keys(finalWallets).sort(),
    [winner.id, runnerUp.id].sort(),
    '游客不该在钱包文件里留下条目',
  );

  console.log(JSON.stringify({
    payoutByPlacement: `${hostRow.coinsAwarded}/${guestRow.coinsAwarded}`,
    creditedToAccount: 'ok',
    walletEndpoint: 'ok',
    unrankedRoomStillPays: 'ok',
    guestNoAccount: 'ok',
    notFinished: 'ok',
    noGuestWalletRows: 'ok',
  }));
} finally {
  server.kill('SIGTERM');
  await rm(temporaryDirectory, { recursive: true, force: true });
}
