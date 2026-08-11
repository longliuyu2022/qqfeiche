// 商店与金币经济：纯逻辑模块，不依赖 THREE / window，可在 node 中直接运行。
// 与 ranked.js 保持一致的风格：storage 注入、纯函数、入参永不被修改。

export const WALLET_KEY = 'neon-apex:wallet:v1';

// 商品目录：数组顺序即商店展示顺序，也是钱包 owned 的排序依据。
// payload 是装备后交给游戏使用的数据：
//   car   → car-catalog 的车辆 id 字符串
//   paint → { color, accentColor }，覆盖当前车辆配色
//   decal → { pattern, color }，pattern ∈ stripe | flame | circuit | checker
export const SHOP_ITEMS = Object.freeze([
  Object.freeze({
    id: 'volt',
    category: 'car',
    name: '幻影 Volt',
    desc: '初始座驾。均衡调校，任何赛道都能稳定发挥。',
    price: 0,
    payload: 'volt',
  }),
  Object.freeze({
    id: 'nimbus',
    category: 'car',
    name: '云雀 Nimbus',
    desc: 'A 级。漂移集气效率冠军，弯道就是它的充电站。',
    price: 3200,
    payload: 'nimbus',
  }),
  Object.freeze({
    id: 'goliath',
    category: 'car',
    name: '磐石 Goliath',
    desc: 'B 级。宽体重装的抓地怪兽，再乱的车阵也撞不乱走线。',
    price: 4200,
    payload: 'goliath',
  }),
  Object.freeze({
    id: 'raiden',
    category: 'car',
    name: '雷鸣 Raiden',
    desc: 'S 级。为极速而生的直线猛兽，氮气全开时无人能挡。',
    price: 6800,
    payload: 'raiden',
  }),
  Object.freeze({
    id: 'paint-cyan',
    category: 'paint',
    name: '霓虹青',
    desc: '夜港招牌色，冷光车身在雨幕里最醒目。',
    price: 800,
    payload: Object.freeze({ color: '#2ce8f5', accentColor: '#eafcff' }),
  }),
  Object.freeze({
    id: 'paint-lava',
    category: 'paint',
    name: '熔岩橙',
    desc: '尾灯拖尾般的高温橙，直线加速时像一道火线。',
    price: 1000,
    payload: Object.freeze({ color: '#ff6a13', accentColor: '#ffd166' }),
  }),
  Object.freeze({
    id: 'paint-abyss',
    category: 'paint',
    name: '深海蓝',
    desc: '深潜级的暗蓝金属漆，配上冰蓝饰条格外冷静。',
    price: 1400,
    payload: Object.freeze({ color: '#1f4fff', accentColor: '#7ad9ff' }),
  }),
  Object.freeze({
    id: 'paint-sakura',
    category: 'paint',
    name: '樱花粉',
    desc: '柔光粉车身搭配奶白饰条，弯道里最上镜的一台。',
    price: 1600,
    payload: Object.freeze({ color: '#ff7ab8', accentColor: '#ffd9ec' }),
  }),
  Object.freeze({
    id: 'paint-void',
    category: 'paint',
    name: '暗夜紫',
    desc: '吸光紫漆，只有霓虹灯扫过时才泄露一线光。',
    price: 2000,
    payload: Object.freeze({ color: '#7a2cff', accentColor: '#c9a3ff' }),
  }),
  Object.freeze({
    id: 'paint-champion',
    category: 'paint',
    name: '冠军金',
    desc: '车神段位专属的镀金车身，冲线时整条街都在反光。',
    price: 2600,
    payload: Object.freeze({ color: '#ffc23c', accentColor: '#fff3c4' }),
  }),
  Object.freeze({
    id: 'decal-stripe',
    category: 'decal',
    name: '极速条纹',
    desc: '经典双道贯穿条纹，最耐看的入门涂装。',
    price: 600,
    payload: Object.freeze({ pattern: 'stripe', color: '#f2fbff' }),
  }),
  Object.freeze({
    id: 'decal-flame',
    category: 'decal',
    name: '烈焰纹',
    desc: '从前翼子板烧到车尾的火焰，氮气一开更有戏。',
    price: 1000,
    payload: Object.freeze({ pattern: 'flame', color: '#ff5722' }),
  }),
  Object.freeze({
    id: 'decal-circuit',
    category: 'decal',
    name: '电路涂装',
    desc: '发光电路走线，夜港赛道的赛博标配。',
    price: 1500,
    payload: Object.freeze({ pattern: 'circuit', color: '#2ce8f5' }),
  }),
  Object.freeze({
    id: 'decal-checker',
    category: 'decal',
    name: '方格旗',
    desc: '把终点线穿在身上，只有常胜车手压得住。',
    price: 2000,
    payload: Object.freeze({ pattern: 'checker', color: '#ffffff' }),
  }),
]);

const ITEM_INDEX = new Map(SHOP_ITEMS.map((item, index) => [item.id, index]));
// 价格为 0 的商品默认拥有，永远无法被"卖掉"或从存档里丢失。
const DEFAULT_OWNED_IDS = Object.freeze(SHOP_ITEMS.filter((item) => item.price === 0).map((item) => item.id));
const EQUIP_SLOTS = Object.freeze(['paint', 'decal']);

const COIN_CAP = 9_999_999;
// 结算构成：完赛底薪 + 名次 + 技巧分 + 净胜 + 破纪录，最后乘模式系数。
const FINISH_REWARD = 120;
// 6 人房的名次奖励；人数不同时按首尾对齐线性插值（与 ranked.js 的 RACE_POINTS 同思路）。
const PLACEMENT_REWARDS = Object.freeze([300, 200, 140, 90, 50, 20]);
const SKILL_SCORE_PER_COIN = 120;
const SKILL_REWARD_CAP = 250;
const CLEAN_RACE_REWARD = 80;
const NEW_RECORD_REWARD = 150;
const MODE_MULTIPLIERS = Object.freeze({ race: 1, items: 1, timeTrial: 0.8, drift: 0.9 });
const DEFAULT_MODE = 'race';

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeUpdatedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function catalogOrder(a, b) {
  return ITEM_INDEX.get(a) - ITEM_INDEX.get(b);
}

function normalizeOwned(value) {
  const owned = new Set(DEFAULT_OWNED_IDS);
  if (Array.isArray(value)) {
    for (const id of value) {
      if (ITEM_INDEX.has(id)) owned.add(id);
    }
  }
  return [...owned].sort(catalogOrder);
}

// 装备槽只接受"已拥有且类别匹配"的商品，其余一律视为未装备。
function normalizeEquippedSlot(value, category, owned) {
  const item = getItemById(value);
  if (!item || item.category !== category || !owned.includes(item.id)) return null;
  return item.id;
}

// 缺失名次按最后一名处理，避免脏数据白拿冠军奖励。
function sanitizePosition(value, entrants) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return entrants;
  return Math.min(entrants, Math.max(1, Math.round(number)));
}

function coinsForPlacement(position, entrants) {
  const lastIndex = PLACEMENT_REWARDS.length - 1;
  if (entrants <= 1) return 0;
  const t = ((position - 1) * lastIndex) / (entrants - 1);
  const lower = Math.floor(t);
  const upper = Math.min(lastIndex, lower + 1);
  return Math.round(
    PLACEMENT_REWARDS[lower] + (PLACEMENT_REWARDS[upper] - PLACEMENT_REWARDS[lower]) * (t - lower),
  );
}

export function createDefaultWallet() {
  return {
    coins: 0,
    owned: [...DEFAULT_OWNED_IDS],
    equipped: { paint: null, decal: null },
    totalEarned: 0,
    updatedAt: null,
  };
}

export function normalizeWallet(value = {}) {
  const owned = normalizeOwned(value?.owned);
  return {
    coins: clampInt(value?.coins, 0, COIN_CAP, 0),
    owned,
    equipped: {
      paint: normalizeEquippedSlot(value?.equipped?.paint, 'paint', owned),
      decal: normalizeEquippedSlot(value?.equipped?.decal, 'decal', owned),
    },
    totalEarned: clampInt(value?.totalEarned, 0, COIN_CAP, 0),
    updatedAt: normalizeUpdatedAt(value?.updatedAt),
  };
}

export function getItemById(id) {
  const index = ITEM_INDEX.get(id);
  return index === undefined ? null : SHOP_ITEMS[index];
}

export function itemsByCategory(category) {
  return SHOP_ITEMS.filter((item) => item.category === category);
}

export function isOwned(wallet, itemId) {
  return normalizeWallet(wallet).owned.includes(itemId);
}

// 比赛结算：任何非法/缺失字段都按 0 计，永不抛错。laps 目前不参与计价，
// 只是允许调用方把完整的 modeResult 直接传进来。
export function earnCoins(wallet, result = {}, now) {
  const base = normalizeWallet(wallet);
  const mode = Object.hasOwn(MODE_MULTIPLIERS, result?.mode ?? '') ? result.mode : DEFAULT_MODE;
  const multiplier = MODE_MULTIPLIERS[mode];
  const entrants = clampInt(result?.entrants, 1, Number.MAX_SAFE_INTEGER, 1);
  const placement = coinsForPlacement(sanitizePosition(result?.position, entrants), entrants);
  const skill = Math.min(
    SKILL_REWARD_CAP,
    Math.floor(clampInt(result?.skillScore, 0, Number.MAX_SAFE_INTEGER, 0) / SKILL_SCORE_PER_COIN),
  );
  const clean = result?.cleanRace === true ? CLEAN_RACE_REWARD : 0;
  const record = result?.isNewRecord === true ? NEW_RECORD_REWARD : 0;
  const subtotal = FINISH_REWARD + placement + skill + clean + record;
  const total = Math.round(subtotal * multiplier);
  const coins = Math.min(COIN_CAP, base.coins + total);
  // 撞到金币上限时实际入账会少于 total，earned 汇报的是真正进钱包的数额。
  const earned = coins - base.coins;

  return {
    wallet: {
      ...base,
      coins,
      totalEarned: Math.min(COIN_CAP, base.totalEarned + earned),
      updatedAt: now ?? null,
    },
    earned,
    breakdown: {
      mode,
      base: FINISH_REWARD,
      placement,
      skill,
      clean,
      record,
      subtotal,
      multiplier,
      total,
      capped: earned < total,
    },
  };
}

export function purchase(wallet, itemId, now) {
  const base = normalizeWallet(wallet);
  const item = getItemById(itemId);
  if (!item) return { wallet: base, ok: false, reason: 'unknown', item: null };
  if (base.owned.includes(item.id)) return { wallet: base, ok: false, reason: 'owned', item };
  if (base.coins < item.price) return { wallet: base, ok: false, reason: 'insufficient', item };
  return {
    wallet: {
      ...base,
      coins: base.coins - item.price,
      owned: [...base.owned, item.id].sort(catalogOrder),
      updatedAt: now ?? null,
    },
    ok: true,
    reason: null,
    item,
  };
}

// 车漆/贴花的装备是同类互斥的开关：装备已装备项 = 卸下。
// 车辆不走 equip，选车依然由 preferences.carId 负责。
export function equip(wallet, itemId) {
  const base = normalizeWallet(wallet);
  const item = getItemById(itemId);
  if (!item) return { wallet: base, ok: false, reason: 'unknown' };
  if (!EQUIP_SLOTS.includes(item.category)) return { wallet: base, ok: false, reason: 'not-equippable' };
  if (!base.owned.includes(item.id)) return { wallet: base, ok: false, reason: 'not-owned' };
  return {
    wallet: {
      ...base,
      equipped: {
        ...base.equipped,
        [item.category]: base.equipped[item.category] === item.id ? null : item.id,
      },
    },
    ok: true,
    reason: null,
  };
}

export function loadWallet(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return createDefaultWallet();
  try {
    const stored = target.getItem(WALLET_KEY);
    return stored ? normalizeWallet(JSON.parse(stored)) : createDefaultWallet();
  } catch {
    return createDefaultWallet();
  }
}

export function saveWallet(wallet, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.setItem) return false;
  try {
    target.setItem(WALLET_KEY, JSON.stringify(normalizeWallet(wallet)));
    return true;
  } catch {
    return false;
  }
}
