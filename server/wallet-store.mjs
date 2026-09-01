// 账号钱包的服务端持久化：金币、已购道具和装备槽跟着账号走，换设备登录能对上。
// 落盘方式照搬 ranked-store.mjs（临时文件 + rename 原子替换、dirty 阈值 + 定时 flush、
// 按 updatedAt 淘汰），钱包的字段校验则一律走 src/shop.js 的 normalizeWallet，
// 避免商品目录和金币上限在前后端各写一套。
import { randomBytes } from 'node:crypto';
import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EQUIP_SLOTS, createDefaultWallet, normalizeWallet } from './shop-catalog.mjs';
import { isValidPlayerId, normalizePlayerId } from './ranked-store.mjs';

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
  } catch {
    return new Map();
  }
  const entries = new Map();
  const wallets = parsed?.wallets;
  if (!wallets || typeof wallets !== 'object') return entries;
  for (const [accountId, value] of Object.entries(wallets)) {
    // 账号 id 是 randomUUID()，与联机侧接受的 player id 形状一致。
    if (!isValidPlayerId(accountId)) continue;
    entries.set(accountId, normalizeWallet(value));
  }
  return entries;
}

function stateTimestamp(wallet) {
  const value = wallet?.updatedAt;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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

  // 与排位表同理：给文件设上限，最久没更新的先丢。
  function evict() {
    if (wallets.size <= maxAccounts) return;
    const ordered = [...wallets.entries()].sort((a, b) => stateTimestamp(a[1]) - stateTimestamp(b[1]));
    const excess = wallets.size - maxAccounts;
    for (let index = 0; index < excess; index += 1) wallets.delete(ordered[index][0]);
  }

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
    return stored ? { ...stored } : createDefaultWallet();
  }

  function write(id, wallet) {
    const next = { ...normalizeWallet(wallet), updatedAt: now() };
    wallets.set(id, next);
    evict();
    dirty += 1;
    if (dirty >= dirtyThreshold) flush();
    return { ...next };
  }

  // 整份覆盖：客户端是钱包的唯一计算方，服务端只负责校验和保存。
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
    credit,
    snapshot: serialize,
    flush,
    close,
    get size() {
      return wallets.size;
    },
  };
}
