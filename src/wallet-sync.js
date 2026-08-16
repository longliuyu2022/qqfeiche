// 账号钱包同步：本地 localStorage 仍是每一帧读写的来源（离线也要能玩），
// 登录后额外把整份钱包同步到服务端，换设备登录就能对上。
//
// 存储键是分开的：游客用 WALLET_KEY，登录后用 accountWalletKey(id)。
// 合在一起的话，登出后游客会直接继承账号的金币。
import {
  WALLET_KEY, loadWallet, normalizeWallet, saveWallet,
} from './shop.js';
import {
  fetchAccountWallet, mergeAccountWallet, pushAccountWallet,
} from './auth-client.js';

// 记录哪些账号已经在本机绑过，用来决定首次登录该合并还是直接拉取。
export const WALLET_BOUND_KEY = 'neon-apex:wallet-bound:v1';

export function accountWalletKey(accountId) {
  return `${WALLET_KEY}:${accountId}`;
}

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readBoundAccounts(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(WALLET_BOUND_KEY) || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function createWalletSync({
  storage,
  fetchWallet = fetchAccountWallet,
  pushWallet = pushAccountWallet,
  mergeWallet = mergeAccountWallet,
  delayMs = 800,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  const target = storage === undefined ? defaultStorage() : storage;
  const listeners = new Set();
  let accountId = null;
  let pending = null;
  let timer = null;

  const storageKey = () => (accountId ? accountWalletKey(accountId) : WALLET_KEY);

  // bootstrap 的首页和 main 的车库各自持有一份 wallet 变量，都要跟着变。
  function notify(wallet) {
    for (const listener of listeners) listener(wallet);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function adopt(wallet) {
    const next = normalizeWallet(wallet);
    saveWallet(next, target, storageKey());
    notify(next);
    return next;
  }

  function isBound(id) {
    return readBoundAccounts(target).has(id);
  }

  function markBound(id) {
    const bound = readBoundAccounts(target);
    bound.add(id);
    try {
      target?.setItem?.(WALLET_BOUND_KEY, JSON.stringify([...bound]));
    } catch {
      // 存不下就当没绑过：下次登录再合并一次，合并是幂等的，不会出问题。
    }
  }

  // 上传失败一律不打断游戏：本地已经写好了，等下一次写入或下次登录再补。
  async function flush() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    if (!accountId || !pending) return false;
    const wallet = pending;
    pending = null;
    try {
      await pushWallet(wallet);
      return true;
    } catch {
      // 期间可能又攒了更新的一份，别把它盖回旧的。
      pending = pending ?? wallet;
      return false;
    }
  }

  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      flush();
    }, delayMs);
  }

  // 游戏里所有钱包写入都走这里：先落本地，再排队上传。
  function persist(wallet) {
    const next = normalizeWallet(wallet);
    saveWallet(next, target, storageKey());
    if (!accountId) return next;
    pending = next;
    schedule();
    return next;
  }

  function read() {
    return loadWallet(target, storageKey());
  }

  async function signIn(user) {
    const id = user?.id ? String(user.id) : null;
    if (!id) return signOut();
    await flush();
    accountId = id;
    const cached = loadWallet(target, accountWalletKey(id));
    try {
      if (!isBound(id)) {
        // 本机第一次绑这个账号：把游客钱包并上去，谁也不该因为登录丢东西。
        const merged = await mergeWallet(loadWallet(target, WALLET_KEY));
        markBound(id);
        return adopt(merged?.wallet);
      }
      const remote = normalizeWallet((await fetchWallet())?.wallet);
      // totalEarned 只增不减，本地更高说明上一次上传没成功，反过来把本地推上去。
      if (cached.totalEarned > remote.totalEarned) {
        pending = cached;
        schedule();
        return adopt(cached);
      }
      return adopt(remote);
    } catch {
      // 离线或服务端不可用：照常用本机缓存开玩，等下次写入再补推。
      return adopt(cached);
    }
  }

  // 退出登录要在服务端会话失效之前调用，否则最后一次上传会 401。
  async function signOut() {
    await flush();
    accountId = null;
    pending = null;
    const guest = loadWallet(target, WALLET_KEY);
    notify(guest);
    return guest;
  }

  if (typeof globalThis.window?.addEventListener === 'function') {
    globalThis.window.addEventListener('pagehide', () => { flush(); });
  }

  return {
    persist,
    read,
    flush,
    signIn,
    signOut,
    subscribe,
    get accountId() {
      return accountId;
    },
  };
}

// bootstrap 的首页和 main 的游戏内共用同一个实例：两个各自同步会互相覆盖。
let shared = null;

export function getWalletSync() {
  if (!shared) shared = createWalletSync();
  return shared;
}
