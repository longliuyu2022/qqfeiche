import assert from 'node:assert/strict';
import {
  SHOP_ITEMS,
  WALLET_KEY,
  createDefaultWallet,
  earnCoins,
  equip,
  getItemById,
  isOwned,
  itemsByCategory,
  loadWallet,
  normalizeWallet,
  purchase,
  saveWallet,
} from '../src/shop.js';
import { CAR_CATALOG } from '../src/car-catalog.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }
}

class ThrowingStorage {
  getItem() {
    throw new Error('storage unavailable');
  }

  setItem() {
    throw new Error('storage unavailable');
  }
}

const CATEGORIES = new Set(['car', 'paint', 'decal']);
const PATTERNS = new Set(['stripe', 'flame', 'circuit', 'checker']);
const HEX = /^#[0-9a-f]{6}$/i;
const carIds = new Set(CAR_CATALOG.map((car) => car.id));

// 1. Catalog integrity: unique ids, sane prices, payloads the game can actually use.
const ids = SHOP_ITEMS.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length);
assert.ok(Object.isFrozen(SHOP_ITEMS));
for (const item of SHOP_ITEMS) {
  assert.ok(Object.isFrozen(item), `${item.id} must be frozen`);
  assert.ok(CATEGORIES.has(item.category), `${item.id} category`);
  assert.equal(typeof item.name, 'string');
  assert.ok(item.name.length > 0);
  assert.equal(typeof item.desc, 'string');
  assert.ok(item.desc.length > 0);
  assert.ok(Number.isInteger(item.price) && item.price >= 0, `${item.id} price`);
  assert.ok(item.price > 0 || item.id === 'volt', `${item.id} is free`);
  assert.equal(getItemById(item.id), item);
}

const cars = itemsByCategory('car');
const paints = itemsByCategory('paint');
const decals = itemsByCategory('decal');
assert.equal(cars.length + paints.length + decals.length, SHOP_ITEMS.length);
assert.deepEqual(cars.map((item) => [item.id, item.price]), [
  ['volt', 0],
  ['nimbus', 3200],
  ['goliath', 4200],
  ['raiden', 6800],
]);
for (const car of cars) {
  assert.equal(typeof car.payload, 'string');
  assert.ok(carIds.has(car.payload), `${car.id} payload must exist in car-catalog`);
}
// Raiden is the S-class flagship and must stay the priciest car.
assert.equal(Math.max(...cars.map((car) => car.price)), getItemById('raiden').price);

assert.ok(paints.length >= 6);
for (const paint of paints) {
  assert.ok(paint.price >= 800 && paint.price <= 2600, `${paint.id} price band`);
  assert.ok(HEX.test(paint.payload.color), `${paint.id} color`);
  assert.ok(HEX.test(paint.payload.accentColor), `${paint.id} accentColor`);
  assert.ok(Object.isFrozen(paint.payload));
}
assert.ok(decals.length >= 4);
for (const decal of decals) {
  assert.ok(decal.price >= 600 && decal.price <= 2000, `${decal.id} price band`);
  assert.ok(PATTERNS.has(decal.payload.pattern), `${decal.id} pattern`);
  assert.ok(HEX.test(decal.payload.color), `${decal.id} color`);
  assert.ok(Object.isFrozen(decal.payload));
}
assert.equal(new Set(decals.map((decal) => decal.payload.pattern)).size, 4);

assert.equal(getItemById('nope'), null);
assert.equal(getItemById(undefined), null);
assert.equal(getItemById({ id: 'volt' }), null);
assert.deepEqual(itemsByCategory('helmet'), []);
// itemsByCategory hands out a fresh array; mutating it cannot corrupt the catalog.
const carsAgain = itemsByCategory('car');
assert.notEqual(carsAgain, cars);
carsAgain.pop();
assert.equal(itemsByCategory('car').length, 4);

// 2. Default wallet and normalization of corrupt saves.
assert.deepEqual(createDefaultWallet(), {
  coins: 0,
  owned: ['volt'],
  equipped: { paint: null, decal: null },
  totalEarned: 0,
  updatedAt: null,
});
assert.notEqual(createDefaultWallet().owned, createDefaultWallet().owned);
assert.deepEqual(normalizeWallet(), createDefaultWallet());
assert.deepEqual(normalizeWallet(null), createDefaultWallet());
assert.deepEqual(normalizeWallet('garbage'), createDefaultWallet());
assert.deepEqual(normalizeWallet({
  coins: -50,
  owned: ['nope', 'nimbus', 'nimbus', 'decal-flame', 42],
  equipped: { paint: 'paint-cyan', decal: 'decal-flame', bogus: 'x' },
  totalEarned: '80.9',
  updatedAt: {},
}), {
  coins: 0,
  // 'volt' is free and always owned; unknown ids and duplicates are dropped,
  // and the rest is sorted into catalog order.
  owned: ['volt', 'nimbus', 'decal-flame'],
  // paint-cyan is not owned → slot cleared; decal-flame is owned → kept.
  equipped: { paint: null, decal: 'decal-flame' },
  totalEarned: 80,
  updatedAt: null,
});
assert.deepEqual(normalizeWallet({ coins: 99_999_999, totalEarned: 1e12, updatedAt: 'now' }), {
  coins: 9_999_999,
  owned: ['volt'],
  equipped: { paint: null, decal: null },
  totalEarned: 9_999_999,
  updatedAt: 'now',
});
// Cross-category equips are rejected even when the items are owned.
assert.deepEqual(normalizeWallet({
  owned: ['paint-cyan', 'decal-flame'],
  equipped: { paint: 'decal-flame', decal: 'paint-cyan' },
}).equipped, { paint: null, decal: null });
assert.equal(normalizeWallet({ owned: ['volt', 'paint-void'], equipped: { paint: 'paint-void' } }).equipped.paint, 'paint-void');

assert.equal(isOwned(createDefaultWallet(), 'volt'), true);
assert.equal(isOwned(createDefaultWallet(), 'nimbus'), false);
assert.equal(isOwned(createDefaultWallet(), 'nope'), false);
assert.equal(isOwned(null, 'volt'), true);
assert.equal(isOwned({ owned: ['raiden'] }, 'raiden'), true);

// 3. earnCoins: every component, mode multipliers, and garbage tolerance.
const wallet = createDefaultWallet();
const podium = earnCoins(wallet, {
  mode: 'race',
  position: 1,
  entrants: 6,
  finalTime: 128.4,
  cleanRace: true,
  skillScore: 4200,
  isNewRecord: false,
  laps: 3,
}, 1000);
// 120 finish + 300 first place + floor(4200/120)=35 skill + 80 clean, x1.0 race.
assert.deepEqual(podium.breakdown, {
  mode: 'race',
  base: 120,
  placement: 300,
  skill: 35,
  clean: 80,
  record: 0,
  subtotal: 535,
  multiplier: 1,
  total: 535,
  capped: false,
});
assert.equal(podium.earned, 535);
assert.deepEqual(podium.wallet, {
  coins: 535,
  owned: ['volt'],
  equipped: { paint: null, decal: null },
  totalEarned: 535,
  updatedAt: 1000,
});
assert.deepEqual(wallet, createDefaultWallet());

const totalOf = (result, state = createDefaultWallet()) => earnCoins(state, result).breakdown.total;
// Record bonus stacks on top of the same podium run.
assert.equal(totalOf({ mode: 'race', position: 1, entrants: 6, cleanRace: true, skillScore: 4200, isNewRecord: true }), 685);
// A dirty run loses the clean bonus only.
assert.equal(totalOf({ mode: 'race', position: 1, entrants: 6, cleanRace: false, skillScore: 4200 }), 455);
// Skill bonus is floored and capped at 250.
assert.equal(totalOf({ mode: 'race', skillScore: 119 }), 120);
assert.equal(totalOf({ mode: 'race', skillScore: 120 }), 121);
assert.equal(totalOf({ mode: 'race', skillScore: 29_999 }), 369);
assert.equal(totalOf({ mode: 'race', skillScore: 30_000 }), 370);
assert.equal(totalOf({ mode: 'race', skillScore: 9_999_999 }), 370);
assert.equal(totalOf({ mode: 'race', skillScore: -500 }), 120);
assert.equal(totalOf({ mode: 'race', skillScore: 'x' }), 120);
// cleanRace / isNewRecord only count when strictly true.
assert.equal(totalOf({ mode: 'race', cleanRace: 'yes', isNewRecord: 1 }), 120);

// Mode coefficients apply to the whole subtotal, rounded last.
const soloRun = { position: 1, entrants: 1, skillScore: 2400, cleanRace: true, isNewRecord: true };
assert.equal(totalOf({ ...soloRun, mode: 'race' }), 370);
assert.equal(totalOf({ ...soloRun, mode: 'items' }), 370);
assert.equal(totalOf({ ...soloRun, mode: 'timeTrial' }), 296);
assert.equal(totalOf({ ...soloRun, mode: 'drift' }), 333);
// Rounding kicks in on fractional products: 535 * 0.9 = 481.5 → 482.
assert.equal(totalOf({ mode: 'drift', position: 1, entrants: 6, cleanRace: true, skillScore: 4200 }), 482);
// Unknown / missing / prototype-key modes fall back to race.
assert.equal(earnCoins(createDefaultWallet(), { ...soloRun, mode: 'battle' }).breakdown.mode, 'race');
assert.equal(earnCoins(createDefaultWallet(), { ...soloRun, mode: 'constructor' }).breakdown.multiplier, 1);
assert.equal(earnCoins(createDefaultWallet(), soloRun).breakdown.mode, 'race');

// Placement rewards: pinned endpoints, monotonically decreasing for any grid size.
const placementFor = (position, entrants) =>
  earnCoins(createDefaultWallet(), { mode: 'race', position, entrants }).breakdown.placement;
assert.deepEqual([1, 2, 3, 4, 5, 6].map((position) => placementFor(position, 6)), [300, 200, 140, 90, 50, 20]);
assert.deepEqual([1, 2, 3, 4].map((position) => placementFor(position, 4)), [300, 160, 77, 20]);
assert.deepEqual([1, 2].map((position) => placementFor(position, 2)), [300, 20]);
assert.equal(placementFor(2, 3), 115);
for (const entrants of [2, 3, 4, 5, 6, 8]) {
  const row = Array.from({ length: entrants }, (_, index) => placementFor(index + 1, entrants));
  assert.equal(row[0], 300, `first place in a ${entrants} grid`);
  assert.equal(row[entrants - 1], 20, `last place in a ${entrants} grid`);
  for (let i = 1; i < row.length; i += 1) {
    assert.ok(row[i] < row[i - 1], `placement must decrease in a ${entrants} grid`);
  }
}
// Solo modes pay no placement bonus, and out-of-range positions are clamped.
assert.equal(placementFor(1, 1), 0);
assert.equal(placementFor(9, 1), 0);
assert.equal(placementFor(0, 6), 20);
assert.equal(placementFor(99, 6), 20);
assert.equal(placementFor(1.4, 6), 300);
// Missing or unusable positions score as last place instead of a free win.
assert.equal(placementFor(undefined, 6), 20);
assert.equal(placementFor(null, 6), 20);
assert.equal(placementFor('x', 6), 20);
assert.equal(earnCoins(createDefaultWallet(), { mode: 'race', position: 1, entrants: 'x' }).breakdown.placement, 0);

// Fully missing/illegal input still settles at the flat finish reward.
assert.equal(earnCoins(createDefaultWallet()).earned, 120);
assert.equal(earnCoins(createDefaultWallet(), null).earned, 120);
assert.equal(earnCoins(createDefaultWallet(), 'nonsense').earned, 120);
assert.equal(earnCoins(createDefaultWallet(), { position: NaN, entrants: -3, skillScore: Infinity }).earned, 120);
assert.equal(earnCoins(createDefaultWallet(), {}, undefined).wallet.updatedAt, null);

// Coin cap: the wallet stops at 9,999,999 and `earned` reports what really landed.
const nearlyFull = earnCoins({ coins: 9_999_900, totalEarned: 9_999_900 }, {
  mode: 'race',
  position: 1,
  entrants: 6,
  cleanRace: true,
  skillScore: 4200,
}, 2000);
assert.equal(nearlyFull.wallet.coins, 9_999_999);
assert.equal(nearlyFull.earned, 99);
assert.equal(nearlyFull.breakdown.total, 535);
assert.equal(nearlyFull.breakdown.capped, true);
assert.equal(nearlyFull.wallet.totalEarned, 9_999_999);
const full = earnCoins(nearlyFull.wallet, { mode: 'race', position: 1, entrants: 6 });
assert.equal(full.earned, 0);
assert.equal(full.breakdown.capped, true);
assert.equal(full.wallet.coins, 9_999_999);

// earnCoins never mutates its input wallet.
const frozenWallet = Object.freeze({
  coins: 5000,
  owned: Object.freeze(['volt', 'nimbus']),
  equipped: Object.freeze({ paint: null, decal: 'decal-flame' }),
  totalEarned: 5000,
  updatedAt: 500,
});
const frozenSnapshot = JSON.stringify(frozenWallet);
const afterEarn = earnCoins(frozenWallet, { mode: 'race', position: 2, entrants: 6 }, 900);
assert.equal(JSON.stringify(frozenWallet), frozenSnapshot);
assert.notEqual(afterEarn.wallet, frozenWallet);
assert.notEqual(afterEarn.wallet.owned, frozenWallet.owned);
assert.equal(afterEarn.wallet.coins, 5320);
assert.equal(afterEarn.wallet.totalEarned, 5320);
assert.equal(afterEarn.wallet.updatedAt, 900);
// decal-flame was never bought, so the corrupt equip slot is scrubbed on the way through.
assert.deepEqual(afterEarn.wallet.equipped, { paint: null, decal: null });

// 4. purchase: unknown / owned / insufficient / success.
const buyer = { coins: 5000, owned: ['volt'], equipped: { paint: null, decal: null }, totalEarned: 5000, updatedAt: 1 };
const unknownBuy = purchase(buyer, 'nope', 10);
assert.deepEqual(unknownBuy, { wallet: normalizeWallet(buyer), ok: false, reason: 'unknown', item: null });
assert.equal(unknownBuy.wallet.updatedAt, 1);
const ownedBuy = purchase(buyer, 'volt', 10);
assert.equal(ownedBuy.ok, false);
assert.equal(ownedBuy.reason, 'owned');
assert.equal(ownedBuy.item, getItemById('volt'));
assert.deepEqual(ownedBuy.wallet, normalizeWallet(buyer));
const brokeBuy = purchase(buyer, 'raiden', 10);
assert.equal(brokeBuy.ok, false);
assert.equal(brokeBuy.reason, 'insufficient');
assert.equal(brokeBuy.item.price, 6800);
assert.equal(brokeBuy.wallet.coins, 5000);

const boughtPaint = purchase(buyer, 'paint-cyan', 1200);
assert.equal(boughtPaint.ok, true);
assert.equal(boughtPaint.reason, null);
assert.equal(boughtPaint.item.id, 'paint-cyan');
assert.deepEqual(boughtPaint.wallet, {
  coins: 4200,
  owned: ['volt', 'paint-cyan'],
  equipped: { paint: null, decal: null },
  totalEarned: 5000,
  updatedAt: 1200,
});
// Buying is not earning: totalEarned never moves.
const boughtCar = purchase(boughtPaint.wallet, 'nimbus', 1300);
assert.equal(boughtCar.ok, true);
assert.equal(boughtCar.wallet.coins, 1000);
assert.deepEqual(boughtCar.wallet.owned, ['volt', 'nimbus', 'paint-cyan']);
assert.equal(boughtCar.wallet.totalEarned, 5000);
assert.equal(purchase(boughtCar.wallet, 'nimbus').reason, 'owned');
// Exact change is enough; one coin short is not.
assert.equal(purchase({ coins: 600 }, 'decal-stripe').ok, true);
assert.equal(purchase({ coins: 600 }, 'decal-stripe').wallet.coins, 0);
assert.equal(purchase({ coins: 599 }, 'decal-stripe').reason, 'insufficient');

const frozenBuyer = Object.freeze({
  coins: 3000,
  owned: Object.freeze(['volt']),
  equipped: Object.freeze({ paint: null, decal: null }),
  totalEarned: 3000,
  updatedAt: 7,
});
const frozenBuyerSnapshot = JSON.stringify(frozenBuyer);
const frozenBuy = purchase(frozenBuyer, 'paint-void', 8);
assert.equal(JSON.stringify(frozenBuyer), frozenBuyerSnapshot);
assert.notEqual(frozenBuy.wallet.owned, frozenBuyer.owned);
assert.deepEqual(frozenBuy.wallet.owned, ['volt', 'paint-void']);
assert.equal(frozenBuy.wallet.coins, 1000);

// 5. equip: paint/decal only, one per slot, re-equipping toggles it off.
const dressed = normalizeWallet({
  coins: 100,
  owned: ['volt', 'paint-cyan', 'paint-lava', 'decal-flame'],
  totalEarned: 900,
  updatedAt: 42,
});
assert.equal(equip(dressed, 'nope').reason, 'unknown');
assert.equal(equip(dressed, 'decal-checker').reason, 'not-owned');
// Cars are never equipped here; the garage keeps using preferences.carId.
assert.deepEqual(equip(dressed, 'volt'), { wallet: dressed, ok: false, reason: 'not-equippable' });
assert.equal(equip(dressed, 'raiden').reason, 'not-equippable');
assert.deepEqual(equip(dressed, 'volt').wallet, dressed);

const cyan = equip(dressed, 'paint-cyan');
assert.equal(cyan.ok, true);
assert.equal(cyan.reason, null);
assert.deepEqual(cyan.wallet.equipped, { paint: 'paint-cyan', decal: null });
assert.equal(cyan.wallet.updatedAt, 42);
assert.equal(cyan.wallet.coins, 100);
// Same-slot exclusivity: the new paint replaces the old one.
const lava = equip(cyan.wallet, 'paint-lava');
assert.deepEqual(lava.wallet.equipped, { paint: 'paint-lava', decal: null });
// Toggle: equipping what is already on takes it off.
const stripped = equip(lava.wallet, 'paint-lava');
assert.equal(stripped.ok, true);
assert.deepEqual(stripped.wallet.equipped, { paint: null, decal: null });
// Slots are independent.
const decaled = equip(lava.wallet, 'decal-flame');
assert.deepEqual(decaled.wallet.equipped, { paint: 'paint-lava', decal: 'decal-flame' });
assert.deepEqual(equip(decaled.wallet, 'decal-flame').wallet.equipped, { paint: 'paint-lava', decal: null });
assert.deepEqual(equip(decaled.wallet, 'paint-cyan').wallet.equipped, { paint: 'paint-cyan', decal: 'decal-flame' });
assert.deepEqual(lava.wallet.equipped, { paint: 'paint-lava', decal: null });

const frozenDressed = Object.freeze({
  coins: 0,
  owned: Object.freeze(['volt', 'decal-circuit']),
  equipped: Object.freeze({ paint: null, decal: null }),
  totalEarned: 0,
  updatedAt: null,
});
const frozenDressedSnapshot = JSON.stringify(frozenDressed);
const frozenEquip = equip(frozenDressed, 'decal-circuit');
assert.equal(JSON.stringify(frozenDressed), frozenDressedSnapshot);
assert.notEqual(frozenEquip.wallet.equipped, frozenDressed.equipped);
assert.equal(frozenEquip.wallet.equipped.decal, 'decal-circuit');

// 6. Storage round trip with injected storage plus corrupt-data fallback.
const storage = new MemoryStorage();
assert.deepEqual(loadWallet(storage), createDefaultWallet());
const persisted = normalizeWallet({
  coins: 3400,
  owned: ['volt', 'nimbus', 'paint-champion', 'decal-circuit'],
  equipped: { paint: 'paint-champion', decal: 'decal-circuit' },
  totalEarned: 12_600,
  updatedAt: 1723,
});
assert.equal(saveWallet(persisted, storage), true);
assert.equal(typeof storage.getItem(WALLET_KEY), 'string');
assert.deepEqual(loadWallet(storage), persisted);
const settled = earnCoins(persisted, { mode: 'items', position: 2, entrants: 6, cleanRace: true }, 1724);
assert.equal(saveWallet(settled.wallet, storage), true);
assert.deepEqual(loadWallet(storage), settled.wallet);

storage.setItem(WALLET_KEY, '{broken');
assert.deepEqual(loadWallet(storage), createDefaultWallet());
storage.setItem(WALLET_KEY, JSON.stringify({ coins: 'x', owned: 'volt', equipped: 5, totalEarned: -9 }));
assert.deepEqual(loadWallet(storage), createDefaultWallet());
storage.setItem(WALLET_KEY, JSON.stringify({ coins: 250, owned: ['ghost-car', 'decal-checker'] }));
assert.deepEqual(loadWallet(storage), {
  coins: 250,
  owned: ['volt', 'decal-checker'],
  equipped: { paint: null, decal: null },
  totalEarned: 0,
  updatedAt: null,
});

// Default storage in node: no globalThis.localStorage → default wallet, save is a no-op.
assert.deepEqual(loadWallet(), createDefaultWallet());
assert.equal(saveWallet(createDefaultWallet()), false);
assert.deepEqual(loadWallet(null), createDefaultWallet());
assert.deepEqual(loadWallet({}), createDefaultWallet());
assert.deepEqual(loadWallet(new ThrowingStorage()), createDefaultWallet());
assert.equal(saveWallet(createDefaultWallet(), null), false);
assert.equal(saveWallet(createDefaultWallet(), new ThrowingStorage()), false);

// 7. A full session: earn, buy, equip, persist, reload.
let session = createDefaultWallet();
for (let i = 0; i < 8; i += 1) {
  session = earnCoins(session, {
    mode: 'race',
    position: 1,
    entrants: 6,
    cleanRace: true,
    skillScore: 4200,
    laps: 3,
  }, 3000 + i).wallet;
}
assert.equal(session.coins, 4280);
assert.equal(session.totalEarned, 4280);
// Equipping a paint that was never bought is refused and leaves the wallet alone.
assert.equal(equip(session, 'paint-cyan').reason, 'not-owned');
session = purchase(session, 'nimbus', 3100).wallet;
session = purchase(session, 'decal-stripe', 3200).wallet;
session = equip(session, 'decal-stripe').wallet;
assert.deepEqual(session, {
  coins: 4280 - 3200 - 600,
  owned: ['volt', 'nimbus', 'decal-stripe'],
  equipped: { paint: null, decal: 'decal-stripe' },
  totalEarned: 4280,
  // equip leaves the timestamp to the last real transaction.
  updatedAt: 3200,
});
assert.equal(saveWallet(session, storage), true);
assert.deepEqual(loadWallet(storage), session);

console.log(JSON.stringify({
  catalog: 'ok',
  normalization: 'ok',
  earnBreakdown: 'ok',
  placementMapping: 'ok',
  modeMultipliers: 'ok',
  coinCap: 'ok',
  purchaseBranches: 'ok',
  equipToggle: 'ok',
  storageRoundTrip: 'ok',
  immutability: 'ok',
  podiumPayout: podium.earned,
}));
