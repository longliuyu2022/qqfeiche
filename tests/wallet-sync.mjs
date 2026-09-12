// 账号钱包同步：服务端存储的合并/防清零语义，以及客户端的登录接管、
// 游客与账号存储键隔离、离线降级。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WALLET_KEY, loadWallet, saveWallet, purchase, equip } from '../src/shop.js';
import { accountWalletKey, createWalletSync, walletOutboxKey } from '../src/wallet-sync.js';
import { walletOperation } from '../src/wallet-operations.js';
import { createWalletStore, mergeWallets } from '../server/wallet-store.mjs';

class MemoryStorage {
  constructor() { this.values = new Map(); }

  getItem(key) { return this.values.get(key) ?? null; }

  setItem(key, value) { this.values.set(key, value); }
}

// --- 服务端存储 -------------------------------------------------------------

const directory = mkdtempSync(join(tmpdir(), 'neon-apex-wallet-'));
const filePath = join(directory, 'wallets.json');
const accountId = '11111111-2222-4333-8444-555555555555';

try {
  const store = createWalletStore({ filePath, flushIntervalMs: 0, dirtyThreshold: 1 });

  assert.deepEqual(store.get(accountId).coins, 0, '没写过的账号返回默认空钱包');
  assert.doesNotThrow(() => store.get('不是合法 id'), '非法 id 不抛错');
  assert.equal(store.put('不是合法 id', { coins: 10 }), null, '非法 id 不写入');

  const stored = store.put(accountId, { coins: 5000, owned: ['volt', 'raiden'], totalEarned: 20000 });
  assert.equal(stored.coins, 5000);
  assert.deepEqual(stored.owned, ['volt', 'raiden']);

  // 换设备登录读到的就是同一份。
  assert.equal(store.get(accountId).coins, 5000);

  // 购买：金币减少、totalEarned 持平，必须原样生效。
  const afterPurchase = store.put(accountId, { coins: 300, owned: ['volt', 'raiden', 'nimbus'], totalEarned: 20000 });
  assert.equal(afterPurchase.coins, 300);
  assert.ok(afterPurchase.owned.includes('nimbus'));

  // 防清零：本地存档被清掉的客户端推上来一份空钱包，不能把账号洗白。
  const afterWipe = store.put(accountId, { coins: 0, owned: [], totalEarned: 0 });
  assert.equal(afterWipe.coins, 300, '空钱包不得覆盖已有余额');
  assert.ok(afterWipe.owned.includes('nimbus'), '空钱包不得抹掉已购道具');

  // 正常赚钱：totalEarned 增长，照常整份覆盖。
  const afterRace = store.put(accountId, { coins: 900, owned: ['volt', 'raiden', 'nimbus'], totalEarned: 20600 });
  assert.equal(afterRace.coins, 900);

  // 合并：金币与累计收益取大，道具取并集，未拥有的装备被剔除。
  const merged = store.merge(accountId, {
    coins: 40, owned: ['volt', 'goliath'], totalEarned: 90000, equipped: { paint: 'paint-aurora' },
  });
  assert.equal(merged.coins, 900, '金币取两边较大值');
  assert.equal(merged.totalEarned, 90000, '累计收益取两边较大值');
  for (const id of ['volt', 'raiden', 'nimbus', 'goliath']) {
    assert.ok(merged.owned.includes(id), `${id} 应保留在并集里`);
  }
  assert.equal(merged.equipped.paint, null, '没买过的涂装不能被装上');

  // 脏数据不抛错。
  assert.doesNotThrow(() => store.put(accountId, { coins: -5, owned: '不是数组', totalEarned: 'abc' }));

  // --- 服务端主动加钱（联机赛结算） ---------------------------------------
  // 沿用上面已有的道具列表，别把后面「重启后仍读回 goliath」的前提清掉。
  const ownedBeforeCredit = [...store.get(accountId).owned];
  const beforeCredit = store.put(accountId, {
    coins: 1000, owned: ownedBeforeCredit, totalEarned: 90000,
  });
  const credited = store.credit(accountId, 252);
  assert.equal(credited.credited, 252);
  assert.equal(credited.wallet.coins, beforeCredit.coins + 252);
  // coins 和 totalEarned 必须同时涨，否则客户端推一份旧存档就会整份覆盖掉奖励。
  assert.equal(credited.wallet.totalEarned, beforeCredit.totalEarned + 252);

  // 关键防护：奖励入账后，客户端推上来一份「奖励之前」的存档不得抹掉这笔钱。
  const staleAfterCredit = store.put(accountId, {
    coins: beforeCredit.coins, owned: ownedBeforeCredit, totalEarned: beforeCredit.totalEarned,
  });
  assert.equal(staleAfterCredit.coins, credited.wallet.coins, '过期存档不得覆盖服务端刚发的奖励');
  assert.equal(staleAfterCredit.totalEarned, credited.wallet.totalEarned);

  assert.equal(store.credit('不是合法 id', 100), null, '非法 id 不加钱');
  assert.equal(store.credit(accountId, 0), null, '零奖励不写入');
  assert.equal(store.credit(accountId, -50), null, '负数不得用来扣钱');
  assert.equal(store.credit(accountId, Number.NaN), null, 'NaN 不写入');

  store.close();
  assert.equal(store.credit(accountId, 100), null, '关闭后不再加钱');

  // 重启后仍在磁盘上。
  const reopened = createWalletStore({ filePath, flushIntervalMs: 0 });
  assert.ok(reopened.get(accountId).owned.includes('goliath'), '重启后应读回同一份钱包');
  reopened.close();
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// mergeWallets 是纯函数，单独再确认一次不改原始入参。
const frozenBase = Object.freeze({ coins: 10, owned: ['volt'], totalEarned: 10 });
assert.doesNotThrow(() => mergeWallets(frozenBase, { coins: 20, owned: ['raiden'], totalEarned: 5 }));
assert.equal(mergeWallets(frozenBase, { coins: 20, totalEarned: 5 }).coins, 20);

// --- 客户端同步 -------------------------------------------------------------

const harnessDirectory = mkdtempSync(join(tmpdir(), 'neon-apex-wallet-journal-'));
const harnesses = [];
function createHarness({ remoteWallet, failing = false, storage = new MemoryStorage(), store } = {}) {
  store ??= createWalletStore({ filePath: join(harnessDirectory, `${harnesses.length}.json`), flushIntervalMs: 0 });
  if (remoteWallet) store.put(accountId, remoteWallet);
  const calls = [];
  let lostResponse = false;
  const checkNetwork = () => { if (failing) throw new Error('offline'); };
  const sync = createWalletSync({
    storage,
    // 定时器交给测试掌控：只入队，由 flush() 显式触发。
    setTimer: () => 0,
    clearTimer: () => {},
    fetchWallet: async () => { checkNetwork(); calls.push('fetch'); return { wallet: store.get(accountId) }; },
    syncWallet: async (batch) => {
      checkNetwork();
      assert.equal(batch.accountId, accountId);
      calls.push('sync');
      const result = store.sync(accountId, batch);
      if (lostResponse) { lostResponse = false; throw new Error('response lost after commit'); }
      return result;
    },
    mergeWallet: async (wallet) => {
      checkNetwork();
      calls.push('merge');
      return { wallet: store.merge(accountId, wallet) };
    },
  });
  const harness = { storage, sync, store, calls, remoteOf: () => store.get(accountId),
    setFailing(value) { failing = value; }, loseResponse() { lostResponse = true; } };
  harnesses.push(harness);
  return harness;
}

const account = { id: accountId, username: 'racer' };

// 首次绑定：本地游客钱包并入云端，谁也不因为登录丢东西。
{
  const { storage, sync, calls } = createHarness({
    remoteWallet: { coins: 900, owned: ['volt', 'raiden'], totalEarned: 2000 },
  });
  saveWallet({ coins: 500, owned: ['volt', 'nimbus'], totalEarned: 700 }, storage);

  const seen = [];
  sync.subscribe((wallet) => seen.push(wallet));
  const signedIn = await sync.signIn(account);

  assert.deepEqual(calls, ['merge', 'sync'], '本机首次绑定该账号时走合并');
  assert.equal(signedIn.coins, 900, '金币取两边较大值');
  assert.ok(signedIn.owned.includes('nimbus') && signedIn.owned.includes('raiden'), '道具取并集');
  assert.equal(seen.length, 1, '订阅方应收到一次钱包更新');

  // 游客钱包原封不动，账号钱包单独存放。
  assert.equal(loadWallet(storage, WALLET_KEY).coins, 500, '游客钱包不被账号数据覆盖');
  assert.equal(loadWallet(storage, accountWalletKey(accountId)).coins, 900);

  // 比赛结算：先落本地，再排队上传。
  sync.persist({ coins: 1200, owned: signedIn.owned, totalEarned: 2300 });
  assert.equal(loadWallet(storage, accountWalletKey(accountId)).coins, 1200, '本地立即可见');
  assert.equal(loadWallet(storage, WALLET_KEY).coins, 500, '写入不该污染游客钱包');
  assert.equal(await sync.flush(), true);
  assert.deepEqual(calls, ['merge', 'sync', 'sync']);

  // 退出登录回到游客钱包。
  const guest = await sync.signOut();
  assert.equal(guest.coins, 500, '登出后金币回到游客钱包');
  assert.equal(sync.accountId, null);

  // 再次登录：已经绑过了，这次直接拉取。
  await sync.signIn(account);
  assert.deepEqual(calls, ['merge', 'sync', 'sync', 'sync'], '同一台设备第二次登录不再重复合并');
}

// 上次上传没成功（本地 totalEarned 更高）：反过来把本地推上去，不采纳过期的云端数据。
{
  const { storage, sync, calls } = createHarness({
    remoteWallet: { coins: 100, owned: ['volt'], totalEarned: 1000 },
  });
  storage.setItem('neon-apex:wallet-bound:v1', JSON.stringify([accountId]));
  saveWallet({ coins: 800, owned: ['volt', 'raiden'], totalEarned: 5000 }, storage, accountWalletKey(accountId));

  const adopted = await sync.signIn(account);
  assert.equal(adopted.coins, 800, '本地更新的战果不能被过期云端数据盖掉');
  assert.equal(await sync.flush(), false);
  assert.deepEqual(calls, ['fetch', 'merge', 'sync'], '旧版本离线存档应迁移一次');
}

// 离线：照常用本机缓存开玩，不抛错、不清空。
{
  const { storage, sync } = createHarness({ remoteWallet: {}, failing: true });
  storage.setItem('neon-apex:wallet-bound:v1', JSON.stringify([accountId]));
  saveWallet({ coins: 640, owned: ['volt'], totalEarned: 640 }, storage, accountWalletKey(accountId));

  const offline = await sync.signIn(account);
  assert.equal(offline.coins, 640, '离线时回退到本机缓存');

  sync.persist({ coins: 700, owned: ['volt'], totalEarned: 700 });
  assert.equal(await sync.flush(), false, '上传失败应如实返回 false');
  assert.equal(loadWallet(storage, accountWalletKey(accountId)).coins, 700, '上传失败也不影响本地游玩');
  // 失败的那份留在队列里，等下次补推。
  assert.equal(await sync.flush(), false);
}

// 未登录时不产生任何网络请求。
{
  const { sync, calls, storage } = createHarness({ remoteWallet: {} });
  sync.persist({ coins: 42, owned: ['volt'], totalEarned: 42 });
  assert.equal(await sync.flush(), false);
  assert.deepEqual(calls, [], '游客模式不该触碰账号接口');
  assert.equal(loadWallet(storage, WALLET_KEY).coins, 42, '游客钱包写在默认键上');
}

// A purchase and equipment change must survive a failed upload and a page reload.
{
  const first = createHarness({ remoteWallet: { coins: 5000, totalEarned: 5000 } });
  await first.sync.signIn(account);
  first.setFailing(true);
  first.sync.persist(purchase(first.sync.read(), 'paint-cyan').wallet);
  first.sync.persist(equip(first.sync.read(), 'paint-cyan').wallet);
  assert.equal(await first.sync.flush(), false);
  first.sync.destroy();
  const resumed = createHarness({ storage: first.storage, store: first.store });
  await resumed.sync.signIn(account);
  assert.equal(resumed.sync.read().coins, 4200);
  assert.equal(resumed.sync.read().equipped.paint, 'paint-cyan');
  assert.equal(resumed.remoteOf().equipped.paint, 'paint-cyan');
  assert.equal(JSON.parse(first.storage.getItem(walletOutboxKey(accountId))).outbox.length, 0);
}

// Independent purchases and earnings merge; a duplicate purchase is charged once.
{
  const a = createHarness({ remoteWallet: { coins: 5000, totalEarned: 5000 } });
  const b = createHarness({ store: a.store });
  await a.sync.signIn(account);
  await b.sync.signIn(account);
  a.sync.persist(purchase(a.sync.read(), 'paint-cyan').wallet);
  b.sync.persist(purchase(b.sync.read(), 'wheel-spoke').wallet);
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  assert.equal(a.remoteOf().coins, 3500);
  assert.ok(a.remoteOf().owned.includes('paint-cyan'));
  assert.ok(a.remoteOf().owned.includes('wheel-spoke'));
  a.sync.persist({ ...a.sync.read(), coins: a.sync.read().coins + 100, totalEarned: 5100 });
  b.sync.persist({ ...b.sync.read(), coins: b.sync.read().coins + 200, totalEarned: 5200 });
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  assert.equal(a.remoteOf().coins, 3800);
  assert.equal(a.remoteOf().totalEarned, 5300);
  await Promise.all([a.sync.refresh(), b.sync.refresh()]);
  a.sync.persist(purchase(a.sync.read(), 'paint-lava').wallet);
  b.sync.persist(purchase(b.sync.read(), 'paint-lava').wallet);
  await Promise.all([a.sync.flush(), b.sync.flush()]);
  assert.equal(a.remoteOf().coins, 2800, 'same item purchased on two devices is charged once');
}

// Committed operations remain idempotent even after a server restart.
{
  const a = createHarness({ remoteWallet: { coins: 100, totalEarned: 100 } });
  await a.sync.signIn(account);
  a.sync.persist({ ...a.sync.read(), coins: 400, totalEarned: 400 });
  a.loseResponse();
  assert.equal(await a.sync.flush(), false);
  assert.equal(a.remoteOf().coins, 400);
  a.sync.destroy();
  a.store.close();
  const reopened = createWalletStore({ filePath: a.store.filePath, flushIntervalMs: 0 });
  const b = createHarness({ storage: a.storage, store: reopened });
  await b.sync.signIn(account);
  assert.equal(b.sync.read().coins, 400, 'lost response cannot duplicate earnings');
}

// A stale session response must not initialize one account with another account's wallet.
{
  const storage = new MemoryStorage();
  storage.setItem('neon-apex:wallet-bound:v1', JSON.stringify([accountId]));
  saveWallet({ coins: 120, totalEarned: 120 }, storage, accountWalletKey(accountId));
  const sync = createWalletSync({ storage, fetchWallet: async () => ({ accountId: 'another-account', wallet: { coins: 9000 } }),
    syncWallet: async () => { assert.fail('mismatched account must never reach sync'); }, setTimer: () => 0, clearTimer: () => {} });
  await sync.signIn(account);
  assert.equal(sync.read().coins, 120);
  sync.destroy();
}

// Offline logout retains the original account's outbox.
{
  const a = createHarness({ remoteWallet: { coins: 1000, totalEarned: 1000 } });
  await a.sync.signIn(account);
  a.setFailing(true);
  a.sync.persist(purchase(a.sync.read(), 'paint-cyan').wallet);
  await a.sync.signOut();
  assert.equal(a.sync.read().coins, 0);
  a.setFailing(false);
  await a.sync.signIn(account);
  assert.equal(a.sync.read().coins, 200);
  assert.ok(a.sync.read().owned.includes('paint-cyan'));
}

// Server rewards and coin-only achievement bonuses are not lost or counted twice.
{
  const a = createHarness({ remoteWallet: { coins: 1000, totalEarned: 1000 } });
  await a.sync.signIn(account);
  a.store.credit(accountId, 252);
  a.sync.creditFromServer(252);
  a.sync.persist({ ...a.sync.read(), coins: a.sync.read().coins + 100 });
  await a.sync.flush();
  assert.equal(a.remoteOf().coins, 1352);
  assert.equal(a.remoteOf().totalEarned, 1252);
}

// Conflicting spending has a visible result instead of silently replacing purchases.
{
  const a = createHarness({ remoteWallet: { coins: 1000, totalEarned: 1000 } });
  const b = createHarness({ store: a.store });
  await a.sync.signIn(account);
  await b.sync.signIn(account);
  a.sync.persist(purchase(a.sync.read(), 'paint-cyan').wallet);
  b.sync.persist(purchase(b.sync.read(), 'wheel-spoke').wallet);
  await a.sync.flush();
  await b.sync.flush();
  assert.equal(b.sync.read().coins, 200);
  assert.match(b.sync.status, /部分购买未完成/);
  assert.ok(b.sync.read().owned.includes('paint-cyan'));
  assert.ok(!b.sync.read().owned.includes('wheel-spoke'));
}

{
  const limited = createWalletStore({ filePath: join(harnessDirectory, 'limited.json'), maxAccounts: 1, flushIntervalMs: 0 });
  limited.put(accountId, { coins: 800 });
  assert.throws(() => limited.put('second-account', { coins: 1 }), /capacity/);
  assert.equal(limited.get(accountId).coins, 800, 'capacity cannot evict existing wallets');
  const operation = { ...walletOperation({ coins: 800 }, { coins: 900 }), sequence: 2 };
  assert.throws(() => limited.sync(accountId, { clientId: 'test-client', operations: [operation] }), /sequence gap/);
  assert.equal(limited.get(accountId).coins, 800);
  limited.close();
  const corrupt = join(harnessDirectory, 'corrupt.json');
  writeFileSync(corrupt, '{broken');
  assert.throws(() => createWalletStore({ filePath: corrupt }), /refusing to overwrite/);
}

for (const harness of harnesses) { harness.sync.destroy(); harness.store.close(); }
rmSync(harnessDirectory, { recursive: true, force: true });
console.log(JSON.stringify({ store: 'ok', migration: 'ok', offlineReload: 'ok', concurrentPurchases: 'ok',
  idempotentRetry: 'ok', serverRestart: 'ok', spendingConflict: 'ok', guest: 'ok' }));
