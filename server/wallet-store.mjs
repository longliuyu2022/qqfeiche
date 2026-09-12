// 账号钱包的服务端持久化：金币、已购道具和装备槽跟着账号走，换设备登录能对上。
// 临时文件 + rename 原子替换；操作序号与钱包一起落盘后才确认同步。
// 字段校验共用 src/shop.js，避免前后端商品目录和金币上限漂移。
import { randomBytes } from 'node:crypto';
import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EQUIP_SLOTS, createDefaultWallet, normalizeWallet } from './shop-catalog.mjs';
import { isValidPlayerId, normalizePlayerId } from './ranked-store.mjs';
import { applyWalletOperation, validWalletOperation } from './wallet-operations.mjs';

export const WALLET_STORE_VERSION = 1;

const DEFAULT_FLUSH_INTERVAL_MS = 4000;
const DEFAULT_DIRTY_THRESHOLD = 8;
const DEFAULT_MAX_ACCOUNTS = 20000;

export function defaultWalletFilePath() {
  return process.env.NEON_APEX_WALLET_FILE
    || fileURLToPath(new URL('./data/wallets.json', import.meta.url));
}

function readStoredWallets(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw new Error('Unable to read wallet store; refusing to overwrite existing data', { cause: error });
  }
  const entries = new Map();
  const wallets = parsed?.wallets;
  if (parsed?.version !== WALLET_STORE_VERSION || !wallets || typeof wallets !== 'object' || Array.isArray(wallets)) {
    throw new Error('Invalid wallet snapshot; refusing to overwrite existing data');
  }
  for (const [accountId, value] of Object.entries(wallets)) {
    // 账号 id 是 randomUUID()，与联机侧接受的 player id 形状一致。
    if (!isValidPlayerId(accountId)) continue;
    const clients = Object.fromEntries(Object.entries(value?.clients ?? {}).filter(([id, sequence]) => (
      isValidPlayerId(id) && Number.isSafeInteger(sequence) && sequence >= 0
    )));
    entries.set(accountId, { ...normalizeWallet(value), clients });
  }
  return entries;
}

// 首次把本地游客钱包绑上账号时用：谁也不该因为登录而丢东西，
// 所以金币和累计收益取两边较大值，已购道具取并集。
export function mergeWallets(stored, incoming) {
  const base = normalizeWallet(stored);
  const extra = normalizeWallet(incoming);
  const equipped = {};
  // 装备槽以本地为准（玩家刚刚看到的就是这套），本地为空才回落到云端。
  // 并集之后原本"未拥有"的装备可能变得合法，最终仍由 normalizeWallet 裁决。
  for (const slot of EQUIP_SLOTS) equipped[slot] = extra.equipped[slot] ?? base.equipped[slot];
  return normalizeWallet({
    coins: Math.max(base.coins, extra.coins),
    totalEarned: Math.max(base.totalEarned, extra.totalEarned),
    owned: [...new Set([...base.owned, ...extra.owned])],
    equipped,
  });
}

export function createWalletStore({
  filePath = defaultWalletFilePath(),
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  dirtyThreshold = DEFAULT_DIRTY_THRESHOLD,
  maxAccounts = DEFAULT_MAX_ACCOUNTS,
  now = () => Date.now(),
} = {}) {
  const wallets = readStoredWallets(filePath);
  let dirty = 0;
  let closed = false;

  const timer = flushIntervalMs > 0
    ? setInterval(() => { flush(); }, flushIntervalMs)
    : null;
  timer?.unref?.();

  function serialize() {
    const output = {};
    for (const [accountId, wallet] of wallets) output[accountId] = { ...wallet };
    return { version: WALLET_STORE_VERSION, updatedAt: now(), wallets: output };
  }

  // 写临时文件再 rename，POSIX 下是原子的：写一半崩掉也不会毁掉上一份快照。
  function flush() {
    if (!dirty) return false;
    const temporaryPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify(serialize()), 'utf8');
      renameSync(temporaryPath, filePath);
      dirty = 0;
      return true;
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // 临时文件已经不在了，无需清理。
      }
      console.error('[wallet-store] flush failed', error?.message || error);
      return false;
    }
  }

  function get(accountId) {
    const id = normalizePlayerId(accountId);
    if (!id) return createDefaultWallet();
    const stored = wallets.get(id);
    return stored ? normalizeWallet(stored) : createDefaultWallet();
  }

  function write(id, wallet, clients = wallets.get(id)?.clients ?? {}) {
    if (!wallets.has(id) && wallets.size >= maxAccounts) throw new Error('Wallet account capacity reached');
    const next = { ...normalizeWallet(wallet), updatedAt: now(), clients };
    wallets.set(id, next);
    dirty += 1;
    if (dirty >= dirtyThreshold) flush();
    return normalizeWallet(next);
  }

  function sync(accountId, { clientId, operations } = {}) {
    if (closed) return null;
    const id = normalizePlayerId(accountId);
    if (!id || !isValidPlayerId(clientId) || !Array.isArray(operations)
      || operations.length > 16 || !operations.every(validWalletOperation)) {
      throw new TypeError('Invalid wallet operations');
    }
    const clients = wallets.get(id)?.clients ?? {};
    let acknowledged = Object.hasOwn(clients, clientId) ? clients[clientId] : 0;
    if (!Object.hasOwn(clients, clientId) && Object.keys(clients).length >= 128) {
      throw new TypeError('Wallet device limit reached');
    }
    let wallet = get(id);
    const rejectedPurchases = [];
    let changed = false;
    for (const operation of operations) {
      if (operation.sequence <= acknowledged) continue;
      if (operation.sequence !== acknowledged + 1) throw new TypeError('Wallet operation sequence gap');
      const result = applyWalletOperation(wallet, operation);
      wallet = result.wallet;
      rejectedPurchases.push(...result.rejected);
      acknowledged = operation.sequence;
      changed = true;
    }
    if (changed) wallet = write(id, wallet, { ...clients, [clientId]: acknowledged });
    // Acknowledgments must survive a restart, including a retry after a lost response.
    if (dirty && !flush()) throw new Error('Wallet persistence unavailable');
    return { wallet, acknowledged, rejectedPurchases };
  }

  // 兼容旧客户端的快照写入；新版客户端使用 sync 操作队列。
  // 唯一的例外是防清零 —— totalEarned 在设计上只增不减（earnCoins 只会往上加，
  // 购买扣的是 coins），所以传上来的 totalEarned 比库里小，只可能是这台设备的
  // 本地存档被清了或严重过期。这种写入退化成合并，宁可多给也不能把账号洗白。
  function put(accountId, wallet) {
    if (closed) return null;
    const id = normalizePlayerId(accountId);
    if (!id) return null;
    const stored = get(id);
    const next = normalizeWallet(wallet);
    if (next.totalEarned < stored.totalEarned) return write(id, mergeWallets(stored, next));
    return write(id, next);
  }

  function merge(accountId, wallet) {
    if (closed) return null;
    const id = normalizePlayerId(accountId);
    if (!id) return null;
    return write(id, mergeWallets(get(id), wallet));
  }

  /**
   * 服务端自己给账号加钱（目前只有联机赛结算走这条路）。
   *
   * coins 和 totalEarned 必须同时加：`put` 的防清零规则以 totalEarned 为判据，
   * 只加 coins 的话，客户端随后推一份旧存档就会整份覆盖掉刚发的奖励。两个字段
   * 一起涨，过期写入才会退化成 mergeWallets 并被 Math.max 挡住。
   */
  function credit(accountId, amount) {
    if (closed) return null;
    const id = normalizePlayerId(accountId);
    if (!id) return null;
    const delta = Number(amount);
    if (!Number.isFinite(delta) || delta <= 0) return null;
    const rounded = Math.floor(delta);
    const stored = get(id);
    const next = write(id, {
      ...stored,
      coins: stored.coins + rounded,
      totalEarned: stored.totalEarned + rounded,
    });
    // normalizeWallet 会把两个字段夹到 COIN_CAP，实际入账可能少于 rounded。
    return { wallet: next, credited: next.coins - stored.coins };
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    flush();
  }

  return {
    filePath,
    get,
    put,
    merge,
    sync,
    credit,
    snapshot: serialize,
    flush,
    close,
    get size() {
      return wallets.size;
    },
  };
}
