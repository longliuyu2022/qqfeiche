export const CHALLENGES_KEY = 'neon-apex:challenges:v1';

function dayKey(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function weekKey(now) {
  const date = new Date(now);
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function hash(text) {
  let value = 2166136261;
  for (const character of text) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

const DAILY_POOL = Object.freeze([
  Object.freeze({ key: 'finish', label: '完成比赛', target: 1, reward: 120 }),
  Object.freeze({ key: 'clean', label: '无碰撞完赛', target: 1, reward: 180 }),
  Object.freeze({ key: 'drift', label: '累计漂移分', target: 3000, reward: 160 }),
  Object.freeze({ key: 'boostChain', label: '达成氮气连喷', target: 2, reward: 150 }),
  Object.freeze({ key: 'shortcut', label: '通过近道', target: 1, reward: 140 }),
  Object.freeze({ key: 'hard', label: '完成困难模式', target: 1, reward: 220 }),
]);

const WEEKLY_POOL = Object.freeze([
  Object.freeze({ key: 'finish', label: '完成比赛', target: 6, reward: 520 }),
  Object.freeze({ key: 'wins', label: '赢得多人赛事', target: 2, reward: 680 }),
  Object.freeze({ key: 'drift', label: '累计漂移分', target: 18000, reward: 620 }),
  Object.freeze({ key: 'hard', label: '完成困难模式', target: 3, reward: 720 }),
  Object.freeze({ key: 'kart', label: '完成卡丁车赛', target: 3, reward: 560 }),
]);

// mulberry32：由 hash 播种的确定性 PRNG。同一天/同一周永远得到同一组挑战，
// 但不同日期之间能取遍所有组合。
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 洗牌后取前 count 条。
//
// 旧实现用固定步长 2 取样（`pool[(offset + index * 2) % pool.length]`）：步长与
// 池长同为偶数时，offset 的奇偶性会锁死取值集合——6 条池取 3 条只能产出
// {0,2,4} 和 {1,3,5} 两种组合，「每日」挑战因此永远在两套之间交替。改为洗牌后
// 6 选 3 可覆盖全部 C(6,3)=20 种组合，且不再依赖池长与步长互质。
function pick(pool, key, count) {
  const random = seededRandom(hash(key));
  const order = [...pool];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order.slice(0, Math.min(count, order.length));
}

export function challengeCatalog(now = Date.now()) {
  const dailyId = dayKey(now);
  const weeklyId = weekKey(now);
  return {
    dailyId,
    weeklyId,
    daily: pick(DAILY_POOL, dailyId, 3).map((item) => ({ ...item, id: `daily:${dailyId}:${item.key}` })),
    weekly: pick(WEEKLY_POOL, weeklyId, 3).map((item) => ({ ...item, id: `weekly:${weeklyId}:${item.key}` })),
  };
}

function emptyPeriod(id) {
  return { id, progress: {}, rewarded: {} };
}

export function normalizeChallengeState(value = {}, now = Date.now()) {
  const catalog = challengeCatalog(now);
  const normalizePeriod = (stored, id) => stored?.id === id ? {
    id,
    progress: typeof stored.progress === 'object' && stored.progress ? { ...stored.progress } : {},
    rewarded: typeof stored.rewarded === 'object' && stored.rewarded ? { ...stored.rewarded } : {},
  } : emptyPeriod(id);
  return {
    daily: normalizePeriod(value?.daily, catalog.dailyId),
    weekly: normalizePeriod(value?.weekly, catalog.weeklyId),
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
  };
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function loadChallengeState(storage, now = Date.now()) {
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    const value = target?.getItem?.(CHALLENGES_KEY);
    return normalizeChallengeState(value ? JSON.parse(value) : {}, now);
  } catch {
    return normalizeChallengeState({}, now);
  }
}

export function saveChallengeState(state, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  try { target?.setItem?.(CHALLENGES_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

function incrementFor(key, context) {
  if (!context?.finished) return 0;
  if (key === 'finish') return 1;
  if (key === 'wins') return context.position === 1 && context.entrants > 1 ? 1 : 0;
  if (key === 'clean') return context.cleanRace ? 1 : 0;
  if (key === 'drift') return Math.max(0, Math.round(context.driftScore || 0));
  if (key === 'boostChain') return Math.max(0, Math.round(context.maxBoostChain || 0));
  if (key === 'shortcut') return Math.max(0, Math.round(context.shortcutRuns || 0));
  if (key === 'hard') return context.difficulty === 'hard' ? 1 : 0;
  if (key === 'kart') return context.mode === 'kart' ? 1 : 0;
  return 0;
}

export function updateChallenges(value, context, now = Date.now()) {
  const state = normalizeChallengeState(value, now);
  const catalog = challengeCatalog(now);
  let coinReward = 0;
  const completed = [];
  for (const [periodName, definitions] of [['daily', catalog.daily], ['weekly', catalog.weekly]]) {
    const period = state[periodName];
    for (const definition of definitions) {
      const previous = Math.max(0, Number(period.progress[definition.id]) || 0);
      const current = Math.min(definition.target, previous + incrementFor(definition.key, context));
      period.progress[definition.id] = current;
      if (current >= definition.target && !period.rewarded[definition.id]) {
        period.rewarded[definition.id] = now || true;
        coinReward += definition.reward;
        completed.push(definition);
      }
    }
  }
  state.updatedAt = now;
  return { state, coinReward, completed, catalog };
}

export function listChallenges(value, now = Date.now()) {
  const state = normalizeChallengeState(value, now);
  const catalog = challengeCatalog(now);
  return ['daily', 'weekly'].flatMap((periodName) => catalog[periodName].map((definition) => ({
    ...definition,
    period: periodName,
    current: Math.min(definition.target, Math.max(0, Number(state[periodName].progress[definition.id]) || 0)),
    completed: Boolean(state[periodName].rewarded[definition.id]),
  })));
}
