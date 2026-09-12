import { WALLET_KEY, loadWallet, normalizeWallet, saveWallet } from './shop.js';
import { fetchAccountWallet, mergeAccountWallet, syncAccountWallet } from './auth-client.js';
import { applyWalletOperation, validWalletOperation, walletOperation } from './wallet-operations.js';

export const WALLET_BOUND_KEY = 'neon-apex:wallet-bound:v1';
export const accountWalletKey = (id) => `${WALLET_KEY}:${id}`;
export const walletOutboxKey = (id) => `${WALLET_KEY}:outbox:${id}`;

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage?.getItem?.(key) || 'null') ?? fallback; } catch { return fallback; }
}

function newClientId() {
  return globalThis.crypto?.randomUUID?.() ?? `wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createWalletSync({
  storage,
  fetchWallet = fetchAccountWallet,
  mergeWallet = mergeAccountWallet,
  syncWallet = syncAccountWallet,
  delayMs = 800,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle),
} = {}) {
  const target = storage === undefined ? defaultStorage() : storage;
  const listeners = new Set();
  const statusListeners = new Set();
  let accountId = null;
  let state = null;
  let timer = null;
  let flight = null;
  let generation = 0;
  let retryMs = 2000;
  let status = '';

  function setStatus(message) {
    status = message;
    for (const listener of statusListeners) listener(message);
  }

  function notify() {
    const wallet = read();
    for (const listener of listeners) listener(wallet);
    return wallet;
  }

  function save() {
    if (!accountId) return;
    try {
      // Keep the optimistic wallet and its operations in one atomic storage write.
      target?.setItem?.(walletOutboxKey(accountId), JSON.stringify(state));
    } catch {
      setStatus('本机存储不可用，请保持页面打开直到同步完成');
    }
    saveWallet(state.wallet, target, accountWalletKey(accountId));
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms = delayMs) {
    cancelTimer();
    timer = setTimer(() => { timer = null; flush(); }, ms);
  }

  function read() {
    return accountId ? normalizeWallet(state.wallet) : loadWallet(target, WALLET_KEY);
  }

  function persist(wallet) {
    const next = normalizeWallet(wallet);
    if (!accountId) {
      saveWallet(next, target, WALLET_KEY);
      return next;
    }
    const operation = walletOperation(state.wallet, next);
    if (operation) state.outbox.push({ ...operation, sequence: ++state.sequence });
    state.wallet = next;
    save();
    if (operation) schedule();
    return next;
  }

  async function synchronize(refresh = false) {
    cancelTimer();
    if (!accountId) return false;
    while (flight) {
      await flight;
      if (!accountId) return false;
      if (!refresh && !state.outbox.length) return true;
    }
    if (!refresh && !state.outbox.length) return false;
    const id = accountId;
    const activeState = state;
    const epoch = generation;
    const work = async () => {
      try {
        if (!activeState.initialized) {
          const bound = readJson(target, WALLET_BOUND_KEY, []);
          const cached = normalizeWallet(activeState.initialWallet);
          let remote;
          if (!Array.isArray(bound) || !bound.includes(id)) {
            remote = (await mergeWallet(loadWallet(target, WALLET_KEY), id))?.wallet;
          } else {
            const fetched = await fetchWallet();
            if (fetched?.accountId && fetched.accountId !== id) throw new Error('Account changed');
            remote = normalizeWallet(fetched?.wallet);
            // Older saves have no journal; preserve their unsent income and purchases once.
            if (cached.totalEarned > remote.totalEarned || cached.owned.some((item) => !remote.owned.includes(item))) {
              remote = (await mergeWallet({ ...cached, coins: cached.totalEarned > remote.totalEarned ? cached.coins : remote.coins }, id))?.wallet;
            }
          }
          if (epoch !== generation || id !== accountId) return false;
          activeState.wallet = normalizeWallet(remote);
          for (const operation of activeState.outbox) activeState.wallet = applyWalletOperation(activeState.wallet, operation).wallet;
          activeState.initialized = true;
          delete activeState.initialWallet;
          try { target?.setItem?.(WALLET_BOUND_KEY, JSON.stringify([...new Set([...(Array.isArray(bound) ? bound : []), id])])); } catch { /* Optional migration marker. */ }
          save();
        }
        do {
          const operations = activeState.outbox.slice(0, 4);
          const result = await syncWallet({ accountId: id, clientId: activeState.clientId, operations });
          if (epoch !== generation || id !== accountId) return false;
          if (!Number.isSafeInteger(result?.acknowledged) || !result.wallet
            || (operations.length && result.acknowledged < operations.at(-1).sequence)) {
            throw new Error('Invalid wallet acknowledgment');
          }
          activeState.outbox = activeState.outbox.filter((op) => op.sequence > result.acknowledged);
          activeState.sequence = Math.max(activeState.sequence, result.acknowledged);
          activeState.wallet = normalizeWallet(result.wallet);
          for (const operation of activeState.outbox) {
            activeState.wallet = applyWalletOperation(activeState.wallet, operation).wallet;
          }
          save();
          notify();
          retryMs = 2000;
          setStatus(result.rejectedPurchases?.length ? '余额已在其他设备使用，部分购买未完成' : '');
        } while (activeState.outbox.length);
        return true;
      } catch {
        if (epoch === generation && id === accountId) {
          setStatus('待同步，联网后自动重试');
          if (activeState.outbox.length) schedule(retryMs);
          retryMs = Math.min(60000, retryMs * 2);
        }
        return false;
      }
    };
    const request = work();
    flight = request;
    try { return await request; } finally { if (flight === request) flight = null; }
  }

  const flush = () => synchronize();
  async function refresh() {
    await synchronize(true);
    return read();
  }

  async function signIn(user) {
    const id = user?.id ? String(user.id) : null;
    if (!id) return signOut();
    await flush();
    const epoch = ++generation;
    accountId = id;
    const cached = loadWallet(target, accountWalletKey(id));
    const saved = readJson(target, walletOutboxKey(id), null);
    const validSaved = saved && typeof saved.clientId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved.clientId)
      && Number.isSafeInteger(saved.sequence) && saved.sequence >= 0
      && Array.isArray(saved.outbox) && saved.outbox.every(validWalletOperation);
    state = validSaved ? { ...saved, wallet: normalizeWallet(saved.wallet) } : {
      clientId: newClientId(), sequence: 0, wallet: cached, outbox: [], initialized: false, initialWallet: cached,
    };
    save();
    const synchronized = await synchronize(true);
    if (!synchronized && epoch === generation && accountId === id) notify();
    return read();
  }

  async function signOut({ flushPending = true } = {}) {
    if (flushPending) await flush();
    generation += 1;
    cancelTimer();
    accountId = null;
    state = null;
    setStatus('');
    return notify();
  }

  // Online rewards already exist on the server and must never become earn operations.
  function creditFromServer(amount) {
    if (!accountId) return read();
    state.wallet = normalizeWallet({ ...state.wallet, coins: state.wallet.coins + amount, totalEarned: state.wallet.totalEarned + amount });
    save();
    return notify();
  }

  const onPageHide = () => { flush(); };
  const onOnline = () => { if (accountId) refresh(); };
  globalThis.window?.addEventListener?.('pagehide', onPageHide);
  globalThis.window?.addEventListener?.('online', onOnline);

  return {
    persist, read, flush, refresh, signIn, signOut, creditFromServer,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    subscribeStatus(listener) { statusListeners.add(listener); return () => statusListeners.delete(listener); },
    get status() { return status; },
    get accountId() { return accountId; },
    destroy() {
      generation += 1;
      cancelTimer();
      globalThis.window?.removeEventListener?.('pagehide', onPageHide);
      globalThis.window?.removeEventListener?.('online', onOnline);
    },
  };
}

let shared = null;
export function getWalletSync() {
  if (!shared) shared = createWalletSync();
  return shared;
}
