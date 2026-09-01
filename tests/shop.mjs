import assert from 'node:assert/strict';
import {
  EQUIP_SLOTS,
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
  onlineRaceReward,
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

const CATEGORIES = new Set(['car', 'paint', 'decal', 'wheel', 'spoiler', 'horn']);
const PATTERNS = new Set(['stripe', 'flame', 'circuit', 'checker']);
const WHEEL_STYLES = new Set(['spoke', 'mesh', 'blade', 'turbine']);
const SPOILER_STYLES = new Set(['ducktail', 'gt-wing', 'swan', 'diffuser']);
const HORN_TONES = new Set(['classic', 'siren', 'chiptune', 'airhorn']);
const HEX = /^#[0-9a-f]{6}$/i;
const carIds = new Set(CAR_CATALOG.map((car) => car.id));
// Every equip slot the wallet carries; `equippedWith` spells out an expectation
// without repeating the five nulls at every assertion.
const EMPTY_EQUIPPED = Object.freeze({ paint: null, decal: null, wheel: null, spoiler: null, horn: null });
const equippedWith = (overrides = {}) => ({ ...EMPTY_EQUIPPED, ...overrides });
assert.deepEqual(EQUIP_SLOTS, ['paint', 'decal', 'wheel', 'spoiler', 'horn']);
assert.ok(Object.isFrozen(EQUIP_SLOTS));

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
const wheels = itemsByCategory('wheel');
const spoilers = itemsByCategory('spoiler');
const horns = itemsByCategory('horn');
assert.equal(
  cars.length + paints.length + decals.length + wheels.length + spoilers.length + horns.length,
  SHOP_ITEMS.length,
);
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

// 1b. Wheels / spoilers / horns: the three gear categories car-parts.js consumes.
// wheel.style and spoiler.style must stay in lockstep with car-parts' builders,
// and horn.tone with its Web Audio recipes.
const GEAR = Object.freeze([
  ['wheel', wheels, 'style', WHEEL_STYLES],
  ['spoiler', spoilers, 'style', SPOILER_STYLES],
  ['horn', horns, 'tone', HORN_TONES],
]);
for (const [category, items, field, allowed] of GEAR) {
  assert.ok(items.length >= 3 && items.length <= 4, `${category} needs 3-4 entries`);
  const values = new Set();
  for (const item of items) {
    assert.equal(item.category, category);
    assert.ok(item.price >= 500 && item.price <= 3000, `${item.id} price band`);
    assert.ok(Object.isFrozen(item.payload), `${item.id} payload must be frozen`);
    assert.equal(typeof item.payload[field], 'string', `${item.id} ${field}`);
    assert.ok(allowed.has(item.payload[field]), `${item.id} ${field} value`);
    // Every gear card is coloured by the shop UI from payload.color / accentColor.
    assert.ok(HEX.test(item.payload.color), `${item.id} color`);
    assert.ok(HEX.test(item.payload.accentColor), `${item.id} accentColor`);
    values.add(item.payload[field]);
  }
  assert.equal(values.size, items.length, `${category} ${field} values must be distinct`);
}
assert.deepEqual(wheels.map((item) => item.id), ['wheel-spoke', 'wheel-mesh', 'wheel-blade', 'wheel-turbine']);
assert.deepEqual(spoilers.map((item) => item.id), ['spoiler-ducktail', 'spoiler-diffuser', 'spoiler-gt-wing', 'spoiler-swan']);
assert.deepEqual(horns.map((item) => item.id), ['horn-classic', 'horn-siren', 'horn-chiptune', 'horn-airhorn']);
// All four styles/tones of each family are covered, so no builder is unreachable.
assert.deepEqual(new Set(wheels.map((item) => item.payload.style)), WHEEL_STYLES);
assert.deepEqual(new Set(spoilers.map((item) => item.payload.style)), SPOILER_STYLES);
assert.deepEqual(new Set(horns.map((item) => item.payload.tone)), HORN_TONES);
// itemsByCategory hands back live catalog objects for the new families too.
assert.equal(itemsByCategory('wheel')[0], getItemById('wheel-spoke'));
assert.notEqual(itemsByCategory('horn'), horns);
assert.deepEqual(itemsByCategory('spoiler').map((item) => item.id), spoilers.map((item) => item.id));

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
  equipped: equippedWith(),
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
  equipped: equippedWith({ decal: 'decal-flame' }),
  totalEarned: 80,
  updatedAt: null,
});
assert.deepEqual(normalizeWallet({ coins: 99_999_999, totalEarned: 1e12, updatedAt: 'now' }), {
  coins: 9_999_999,
  owned: ['volt'],
  equipped: equippedWith(),
  totalEarned: 9_999_999,
  updatedAt: 'now',
});
// Cross-category equips are rejected even when the items are owned.
assert.deepEqual(normalizeWallet({
  owned: ['paint-cyan', 'decal-flame'],
  equipped: { paint: 'decal-flame', decal: 'paint-cyan' },
}).equipped, equippedWith());
assert.equal(normalizeWallet({ owned: ['volt', 'paint-void'], equipped: { paint: 'paint-void' } }).equipped.paint, 'paint-void');

// Legacy saves (v1.5 and older) only carry paint/decal. They must load without
// throwing, keep everything they already had, and simply gain empty gear slots.
const legacySave = {
  coins: 4321,
  owned: ['volt', 'nimbus', 'paint-sakura', 'decal-circuit'],
  equipped: { paint: 'paint-sakura', decal: 'decal-circuit' },
  totalEarned: 15_000,
  updatedAt: 99,
};
const migrated = normalizeWallet(legacySave);
assert.deepEqual(migrated, {
  coins: 4321,
  owned: ['volt', 'nimbus', 'paint-sakura', 'decal-circuit'],
  equipped: equippedWith({ paint: 'paint-sakura', decal: 'decal-circuit' }),
  totalEarned: 15_000,
  updatedAt: 99,
});
// The legacy object itself is never touched.
assert.deepEqual(legacySave.equipped, { paint: 'paint-sakura', decal: 'decal-circuit' });
assert.deepEqual(Object.keys(migrated.equipped), ['paint', 'decal', 'wheel', 'spoiler', 'horn']);
// Normalization is idempotent, so a migrated save survives another round trip.
assert.deepEqual(normalizeWallet(migrated), migrated);
// Gear slots pointing at unowned items are scrubbed the same way paint/decal are.
assert.deepEqual(normalizeWallet({
  owned: ['volt', 'wheel-blade'],
  equipped: { wheel: 'wheel-blade', spoiler: 'spoiler-swan', horn: 'horn-airhorn' },
}).equipped, equippedWith({ wheel: 'wheel-blade' }));
// ...as are unknown ids and cross-category values.
assert.deepEqual(normalizeWallet({
  owned: ['volt', 'wheel-mesh', 'spoiler-gt-wing', 'horn-siren'],
  equipped: { wheel: 'ghost-wheel', spoiler: 'horn-siren', horn: 'spoiler-gt-wing' },
}).equipped, equippedWith());
assert.deepEqual(normalizeWallet({
  owned: ['volt', 'wheel-mesh', 'spoiler-gt-wing', 'horn-siren'],
  equipped: { wheel: 'wheel-mesh', spoiler: 'spoiler-gt-wing', horn: 'horn-siren' },
}).equipped, equippedWith({ wheel: 'wheel-mesh', spoiler: 'spoiler-gt-wing', horn: 'horn-siren' }));

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
  difficulty: 'easy',
  base: 120,
  placement: 300,
  skill: 35,
  clean: 80,
  record: 0,
  subtotal: 535,
  modeMultiplier: 1,
  difficultyMultiplier: 1,
  multiplier: 1,
  total: 535,
  capped: false,
});
assert.equal(podium.earned, 535);
assert.deepEqual(podium.wallet, {
  coins: 535,
  owned: ['volt'],
  equipped: equippedWith(),
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
assert.equal(totalOf({ ...soloRun, mode: 'race', difficulty: 'hard' }), 463);
assert.equal(totalOf({ ...soloRun, mode: 'kart' }), 389);
assert.equal(totalOf({ ...soloRun, mode: 'items' }), 370);
assert.equal(totalOf({ ...soloRun, mode: 'timeTrial' }), 296);
assert.equal(totalOf({ ...soloRun, mode: 'drift' }), 333);
// Rounding kicks in on fractional products: 535 * 0.9 = 481.5 → 482.
assert.equal(totalOf({ mode: 'drift', position: 1, entrants: 6, cleanRace: true, skillScore: 4200 }), 482);
// Unknown / missing / prototype-key modes fall back to race.
assert.equal(earnCoins(createDefaultWallet(), { ...soloRun, mode: 'battle' }).breakdown.mode, 'race');
assert.equal(earnCoins(createDefaultWallet(), { ...soloRun, mode: 'constructor' }).breakdown.multiplier, 1);
assert.equal(earnCoins(createDefaultWallet(), soloRun).breakdown.mode, 'race');
assert.equal(earnCoins(createDefaultWallet(), { ...soloRun, difficulty: 'hard' }).breakdown.difficultyMultiplier, 1.25);

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
assert.deepEqual(afterEarn.wallet.equipped, equippedWith());

// 4. purchase: unknown / owned / insufficient / success.
const buyer = { coins: 5000, owned: ['volt'], equipped: equippedWith(), totalEarned: 5000, updatedAt: 1 };
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
  equipped: equippedWith(),
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
assert.deepEqual(cyan.wallet.equipped, equippedWith({ paint: 'paint-cyan' }));
assert.equal(cyan.wallet.updatedAt, 42);
assert.equal(cyan.wallet.coins, 100);
// Same-slot exclusivity: the new paint replaces the old one.
const lava = equip(cyan.wallet, 'paint-lava');
assert.deepEqual(lava.wallet.equipped, equippedWith({ paint: 'paint-lava' }));
// Toggle: equipping what is already on takes it off.
const stripped = equip(lava.wallet, 'paint-lava');
assert.equal(stripped.ok, true);
assert.deepEqual(stripped.wallet.equipped, equippedWith());
// Slots are independent.
const decaled = equip(lava.wallet, 'decal-flame');
assert.deepEqual(decaled.wallet.equipped, equippedWith({ paint: 'paint-lava', decal: 'decal-flame' }));
assert.deepEqual(equip(decaled.wallet, 'decal-flame').wallet.equipped, equippedWith({ paint: 'paint-lava' }));
assert.deepEqual(equip(decaled.wallet, 'paint-cyan').wallet.equipped, equippedWith({ paint: 'paint-cyan', decal: 'decal-flame' }));
assert.deepEqual(lava.wallet.equipped, equippedWith({ paint: 'paint-lava' }));

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

// 5b. The gear categories go through the exact same buy → equip → toggle path.
let geared = { coins: 12_000, owned: ['volt'], totalEarned: 12_000, updatedAt: 5 };
for (const id of ['wheel-spoke', 'wheel-turbine', 'spoiler-gt-wing', 'spoiler-swan', 'horn-siren', 'horn-airhorn']) {
  const bought = purchase(geared, id, 6);
  assert.equal(bought.ok, true, `buying ${id}`);
  geared = bought.wallet;
}
assert.equal(geared.coins, 12_000 - 700 - 2400 - 1600 - 2200 - 1200 - 2600);
assert.equal(geared.totalEarned, 12_000);
// Gear that was never bought cannot be equipped, and unknown ids are still 'unknown'.
assert.equal(equip(geared, 'wheel-blade').reason, 'not-owned');
assert.equal(equip(geared, 'spoiler-ducktail').reason, 'not-owned');
assert.equal(equip(geared, 'horn-chiptune').reason, 'not-owned');
assert.equal(equip(geared, 'wheel-nope').reason, 'unknown');

// One slot per family, and the three families never interfere with each other.
const withWheel = equip(geared, 'wheel-spoke');
assert.equal(withWheel.ok, true);
assert.deepEqual(withWheel.wallet.equipped, equippedWith({ wheel: 'wheel-spoke' }));
const withSpoiler = equip(withWheel.wallet, 'spoiler-gt-wing');
const withHorn = equip(withSpoiler.wallet, 'horn-siren');
assert.deepEqual(withHorn.wallet.equipped, equippedWith({
  wheel: 'wheel-spoke',
  spoiler: 'spoiler-gt-wing',
  horn: 'horn-siren',
}));
// Same-slot exclusivity: the second wheel replaces the first, nothing else moves.
const swappedWheel = equip(withHorn.wallet, 'wheel-turbine');
assert.deepEqual(swappedWheel.wallet.equipped, equippedWith({
  wheel: 'wheel-turbine',
  spoiler: 'spoiler-gt-wing',
  horn: 'horn-siren',
}));
const swappedSpoiler = equip(swappedWheel.wallet, 'spoiler-swan');
assert.equal(swappedSpoiler.wallet.equipped.spoiler, 'spoiler-swan');
assert.equal(swappedSpoiler.wallet.equipped.wheel, 'wheel-turbine');
const swappedHorn = equip(swappedSpoiler.wallet, 'horn-airhorn');
assert.deepEqual(swappedHorn.wallet.equipped, equippedWith({
  wheel: 'wheel-turbine',
  spoiler: 'spoiler-swan',
  horn: 'horn-airhorn',
}));
// Toggle each gear slot back off; the other two stay put.
assert.deepEqual(equip(swappedHorn.wallet, 'wheel-turbine').wallet.equipped, equippedWith({
  spoiler: 'spoiler-swan',
  horn: 'horn-airhorn',
}));
assert.deepEqual(equip(swappedHorn.wallet, 'spoiler-swan').wallet.equipped, equippedWith({
  wheel: 'wheel-turbine',
  horn: 'horn-airhorn',
}));
assert.deepEqual(equip(swappedHorn.wallet, 'horn-airhorn').wallet.equipped, equippedWith({
  wheel: 'wheel-turbine',
  spoiler: 'spoiler-swan',
}));
// Earlier wallets in the chain are untouched by any of the above.
assert.deepEqual(withWheel.wallet.equipped, equippedWith({ wheel: 'wheel-spoke' }));
// Paint/decal and gear coexist in one wallet.
const fullKit = equip(equip(swappedHorn.wallet, 'paint-cyan').wallet, 'decal-flame').wallet;
assert.deepEqual(fullKit.equipped, equippedWith({
  wheel: 'wheel-turbine',
  spoiler: 'spoiler-swan',
  horn: 'horn-airhorn',
}));
// paint-cyan / decal-flame were never bought, so those two equips were refused.
assert.equal(equip(swappedHorn.wallet, 'paint-cyan').reason, 'not-owned');

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
  equipped: equippedWith(),
  totalEarned: 0,
  updatedAt: null,
});
// A v1.5 save on disk (no gear slots at all) loads clean and gains empty slots.
storage.setItem(WALLET_KEY, JSON.stringify({
  coins: 700,
  owned: ['volt', 'paint-lava', 'decal-stripe'],
  equipped: { paint: 'paint-lava', decal: 'decal-stripe' },
  totalEarned: 3000,
  updatedAt: 12,
}));
assert.deepEqual(loadWallet(storage), {
  coins: 700,
  owned: ['volt', 'paint-lava', 'decal-stripe'],
  equipped: equippedWith({ paint: 'paint-lava', decal: 'decal-stripe' }),
  totalEarned: 3000,
  updatedAt: 12,
});
// Gear survives a full save/load round trip.
assert.equal(saveWallet(fullKit, storage), true);
assert.deepEqual(loadWallet(storage), fullKit);

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
  equipped: equippedWith({ decal: 'decal-stripe' }),
  totalEarned: 4280,
  // equip leaves the timestamp to the last real transaction.
  updatedAt: 3200,
});
assert.equal(saveWallet(session, storage), true);
assert.deepEqual(loadWallet(storage), session);

// --- 联机奖励 -------------------------------------------------------------
// 服务端权威口径：只按「完赛底薪 + 名次」发钱并打 6 折，不含技巧分 / 净胜 /
// 破纪录（这三项来自客户端自报，联机采信就是刷钱口子）。
const onlineFirst = onlineRaceReward({ position: 1, totalRacers: 6, finished: true });
const onlineLast = onlineRaceReward({ position: 6, totalRacers: 6, finished: true });
assert.equal(onlineFirst, 252, '6 人房第一名 = (120 底薪 + 300 名次) × 0.6');
assert.equal(onlineLast, 84, '6 人房末位 = (120 + 20) × 0.6');
// 名次越靠前奖励越高，且严格单调。
let previousReward = Number.POSITIVE_INFINITY;
for (let position = 1; position <= 6; position += 1) {
  const reward = onlineRaceReward({ position, totalRacers: 6, finished: true });
  assert.ok(reward < previousReward, `第 ${position} 名的奖励应低于上一名`);
  previousReward = reward;
}
// 门禁：未完赛、被判无效、单人房一律 0。
assert.equal(onlineRaceReward({ position: 1, totalRacers: 6, finished: false }), 0, '未完赛不发钱');
assert.equal(onlineRaceReward({ position: 1, totalRacers: 6, finished: true, settled: false }), 0, '状态无效不发钱');
assert.equal(onlineRaceReward({ position: 1, totalRacers: 1, finished: true }), 0, '单人房不发钱');
assert.equal(onlineRaceReward({}), 0, '空参数不发钱');
// 脏名次按末位处理，不能白拿冠军奖励。
assert.equal(onlineRaceReward({ position: 0, totalRacers: 6, finished: true }), onlineLast);
assert.equal(onlineRaceReward({ position: 999, totalRacers: 6, finished: true }), onlineLast);
assert.equal(onlineRaceReward({ position: 'abc', totalRacers: 6, finished: true }), onlineLast);
// 联机第一名必须低于同名次的单机收益，避免联机成为刷钱捷径。
const soloFirst = earnCoins(createDefaultWallet(), {
  mode: 'race', position: 1, entrants: 6, cleanRace: true, skillScore: 30000, isNewRecord: true,
}).earned;
assert.ok(onlineFirst < soloFirst, '联机奖励应低于单机满配收益');

console.log(JSON.stringify({
  catalog: 'ok',
  gearCatalog: `${wheels.length}/${spoilers.length}/${horns.length}`,
  normalization: 'ok',
  legacyMigration: 'ok',
  earnBreakdown: 'ok',
  placementMapping: 'ok',
  modeMultipliers: 'ok',
  coinCap: 'ok',
  purchaseBranches: 'ok',
  equipToggle: 'ok',
  gearEquipToggle: 'ok',
  storageRoundTrip: 'ok',
  immutability: 'ok',
  podiumPayout: podium.earned,
  onlineReward: `${onlineFirst}/${onlineLast}`,
  onlineGates: 'ok',
}));
