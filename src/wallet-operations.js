import { EQUIP_SLOTS, getItemById, normalizeWallet, purchase } from './shop.js';

export function walletOperation(before, after) {
  const base = normalizeWallet(before);
  const next = normalizeWallet(after);
  const purchases = next.owned.filter((id) => !base.owned.includes(id));
  const cost = purchases.reduce((sum, id) => sum + getItemById(id).price, 0);
  const equipped = Object.fromEntries(EQUIP_SLOTS
    .filter((slot) => base.equipped[slot] !== next.equipped[slot])
    .map((slot) => [slot, next.equipped[slot]]));
  const coins = Math.max(0, next.coins - base.coins + cost);
  const earned = Math.max(0, next.totalEarned - base.totalEarned);
  return coins || earned || purchases.length || Object.keys(equipped).length
    ? { coins, earned, purchases, equipped }
    : null;
}

export function validWalletOperation(operation) {
  if (!operation || !Number.isSafeInteger(operation.sequence) || operation.sequence < 1) return false;
  if (![operation.coins, operation.earned].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 9_999_999)) return false;
  if (!Array.isArray(operation.purchases) || operation.purchases.length > 26
    || operation.purchases.some((id) => typeof id !== 'string' || !getItemById(id))) return false;
  if (!operation.equipped || typeof operation.equipped !== 'object' || Array.isArray(operation.equipped)) return false;
  return Object.entries(operation.equipped).every(([slot, id]) => (
    EQUIP_SLOTS.includes(slot) && (id === null || getItemById(id)?.category === slot)
  ));
}

// The server and the optimistic client use the same purchase and rebase rules.
export function applyWalletOperation(wallet, operation) {
  const base = normalizeWallet(wallet);
  let next = normalizeWallet({
    ...base,
    coins: base.coins + operation.coins,
    totalEarned: base.totalEarned + operation.earned,
  });
  const rejected = [];
  for (const id of operation.purchases) {
    if (next.owned.includes(id)) continue;
    const result = purchase(next, id);
    if (result.ok) next = result.wallet;
    else rejected.push(id);
  }
  next = normalizeWallet({ ...next, equipped: { ...next.equipped, ...operation.equipped } });
  return { wallet: next, rejected };
}
