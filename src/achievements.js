// 成就系统：纯逻辑模块，不依赖 THREE / window，可在 node 中直接运行。
// 与 ranked.js / shop.js 保持一致的风格：storage 注入、纯函数、入参永不被修改。
//
// 设计要点：所有成就都由 state.progress 里的一个"指标"驱动（见 METRICS），
// 指标只增不减，因此成就一旦达标就永久解锁，进度条也永远不会倒退：
//   累计型 → 每场结算累加（场次 / 漂移分 / 近道次数 …）
//   单场型 → 记录历史最好的单场表现（连喷段数 / 落地喷次数 / 单场漂移分 …）
//   快照型 → 记录历史最高的账户状态（车库数量 / 车漆 / 段位）
export const ACHIEVEMENTS_KEY = 'neon-apex:achievements:v1';

export const ACHIEVEMENT_CATEGORIES = Object.freeze([
  'milestone',
  'skill',
  'race',
  'shortcut',
  'collection',
  'rank',
]);

export const ACHIEVEMENTS = Object.freeze([
  // 里程碑：跑得越多解得越多。
  Object.freeze({
    id: 'first-race',
    name: '初次上路',
    desc: '完成 1 场比赛。',
    category: 'milestone',
    target: 1,
    coinReward: 100,
  }),
  Object.freeze({
    id: 'ten-races',
    name: '夜港常客',
    desc: '累计完成 10 场比赛。',
    category: 'milestone',
    target: 10,
    coinReward: 250,
  }),
  Object.freeze({
    id: 'fifty-races',
    name: '五十战老手',
    desc: '累计完成 50 场比赛。',
    category: 'milestone',
    target: 50,
    coinReward: 800,
  }),
  Object.freeze({
    id: 'mode-explorer',
    name: '全能车手',
    desc: '竞速 / 卡丁车 / 道具 / 计时 / 漂移五种模式各完赛一次。',
    category: 'milestone',
    target: 5,
    coinReward: 350,
  }),
  Object.freeze({
    id: 'drift-century',
    name: '十万漂移',
    desc: '累计漂移分达到 100000。',
    category: 'milestone',
    target: 100_000,
    coinReward: 900,
  }),
  Object.freeze({
    id: 'coin-tycoon',
    name: '金库满仓',
    desc: '累计获得 50000 金币。',
    category: 'milestone',
    target: 50_000,
    coinReward: 1000,
  }),

  // 技巧：单场表现，取历史最好的一场。
  Object.freeze({
    id: 'perfect-start',
    name: '完美起步',
    desc: '在起跑倒计时打出一次完美起步。',
    category: 'skill',
    target: 1,
    coinReward: 200,
  }),
  Object.freeze({
    id: 'landing-triple',
    name: '落地三连',
    desc: '单场触发 3 次落地喷。',
    category: 'skill',
    target: 3,
    coinReward: 400,
  }),
  Object.freeze({
    id: 'boost-chain-5',
    name: '连喷大师',
    desc: '单场打出连喷 x5。',
    category: 'skill',
    target: 5,
    coinReward: 600,
  }),
  Object.freeze({
    id: 'drift-8000',
    name: '漂移风暴',
    desc: '单场漂移分达到 8000。',
    category: 'skill',
    target: 8000,
    coinReward: 500,
  }),
  Object.freeze({
    id: 'skill-storm',
    name: '技巧狂潮',
    desc: '单场技巧分达到 25000。',
    category: 'skill',
    target: 25_000,
    coinReward: 700,
  }),

  // 竞速：名次相关，单人模式（entrants <= 1）不算夺冠。
  Object.freeze({
    id: 'first-win',
    name: '首夺桂冠',
    desc: '在多人对局中首次夺冠。',
    category: 'race',
    target: 1,
    coinReward: 300,
  }),
  Object.freeze({
    id: 'flawless-win',
    name: '零失误冠军',
    desc: '无碰撞、无重生、不切线地拿下一场冠军。',
    category: 'race',
    target: 1,
    coinReward: 700,
    hidden: true,
  }),
  Object.freeze({
    id: 'grand-tour',
    name: '五图通吃',
    desc: '在五张不同地图上各夺冠一次。',
    category: 'race',
    target: 5,
    coinReward: 1500,
  }),

  // 近道 / 机关。
  Object.freeze({
    id: 'shortcut-first',
    name: '近道行家',
    desc: '首次完整走完一条近道。',
    category: 'shortcut',
    target: 1,
    coinReward: 200,
  }),
  Object.freeze({
    id: 'pad-sweep',
    name: '加速带全收',
    desc: '单场吃满 6 条加速带。',
    category: 'shortcut',
    target: 6,
    coinReward: 450,
  }),

  // 收藏。
  Object.freeze({
    id: 'garage-full',
    name: '车库全满',
    desc: '拥有全部 4 台车。',
    category: 'collection',
    target: 4,
    coinReward: 1200,
  }),
  Object.freeze({
    id: 'painted',
    name: '焕新涂装',
    desc: '装备任意一款车漆。',
    category: 'collection',
    target: 1,
    coinReward: 150,
  }),

  // 段位：target 是 RANK_TIER_ORDER 中的下标（黄金 = 2，钻石 = 4）。
  Object.freeze({
    id: 'gold-rank',
    name: '黄金车手',
    desc: '排位赛达到黄金段位。',
    category: 'rank',
    target: 2,
    coinReward: 400,
  }),
  Object.freeze({
    id: 'diamond-rank',
    name: '钻石车手',
    desc: '排位赛达到钻石段位。',
    category: 'rank',
    target: 4,
    coinReward: 1000,
  }),
]);

// 成就 id → state.progress 里的指标字段；数组字段按去重后的长度计。
const METRICS = Object.freeze({
  'first-race': 'racesFinished',
  'ten-races': 'racesFinished',
  'fifty-races': 'racesFinished',
  'mode-explorer': 'modesFinished',
  'drift-century': 'driftTotal',
  'coin-tycoon': 'coinsEarned',
  'perfect-start': 'perfectStarts',
  'landing-triple': 'bestLandingBoosts',
  'boost-chain-5': 'bestBoostChain',
  'drift-8000': 'bestDriftScore',
  'skill-storm': 'bestSkillScore',
  'first-win': 'wins',
  'flawless-win': 'cleanWins',
  'grand-tour': 'winTracks',
  'shortcut-first': 'shortcutRuns',
  'pad-sweep': 'bestPadBoosts',
  'garage-full': 'ownedCarCount',
  'painted': 'paintEquipped',
  'gold-rank': 'rankTierIndex',
  'diamond-rank': 'rankTierIndex',
});

const ACHIEVEMENT_INDEX = new Map(ACHIEVEMENTS.map((item, index) => [item.id, index]));

const MODE_IDS = Object.freeze(['race', 'kart', 'items', 'timeTrial', 'drift']);
// 与 ranked.js 的 RANK_TIERS 顺序保持一致（此处不 import，保持模块零依赖）。
const RANK_TIER_ORDER = Object.freeze([
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
  'stellar',
  'legend',
]);
// 去重列表的长度上限，避免被篡改的存档把 localStorage 撑爆。
const MAX_TRACKED_IDS = 16;
const COUNTER_CAP = 9_999_999_999;

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

function nonNegativeInteger(value) {
  return clampInt(value, 0, COUNTER_CAP, 0);
}

function normalizeUpdatedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

// 去重 + 排序的 id 列表；allow 非空时只保留白名单内的 id。
function normalizeIdList(value, allow) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue;
    if (allow && !allow.includes(entry)) continue;
    seen.add(entry);
    if (seen.size >= MAX_TRACKED_IDS) break;
  }
  return [...seen].sort();
}

function withId(list, id) {
  if (list.includes(id) || list.length >= MAX_TRACKED_IDS) return list;
  return [...list, id].sort();
}

// 解锁标记只保留目录里存在的成就；值是解锁时间戳，拿不到时间就存 true。
function normalizeUnlocked(value) {
  const unlocked = {};
  if (!value || typeof value !== 'object') return unlocked;
  for (const achievement of ACHIEVEMENTS) {
    if (!Object.hasOwn(value, achievement.id)) continue;
    const stamp = value[achievement.id];
    if (stamp === null || stamp === undefined || stamp === false) continue;
    unlocked[achievement.id] = normalizeUpdatedAt(stamp) ?? true;
  }
  return unlocked;
}

function createDefaultProgress() {
  return {
    racesFinished: 0,
    wins: 0,
    cleanWins: 0,
    winTracks: [],
    modesFinished: [],
    driftTotal: 0,
    coinsEarned: 0,
    shortcutRuns: 0,
    perfectStarts: 0,
    bestBoostChain: 0,
    bestLandingBoosts: 0,
    bestPadBoosts: 0,
    bestDriftScore: 0,
    bestSkillScore: 0,
    ownedCarCount: 0,
    paintEquipped: 0,
    rankTierIndex: 0,
  };
}

function normalizeProgress(value) {
  return {
    racesFinished: nonNegativeInteger(value?.racesFinished),
    wins: nonNegativeInteger(value?.wins),
    cleanWins: nonNegativeInteger(value?.cleanWins),
    winTracks: normalizeIdList(value?.winTracks),
    modesFinished: normalizeIdList(value?.modesFinished, MODE_IDS),
    driftTotal: nonNegativeInteger(value?.driftTotal),
    coinsEarned: nonNegativeInteger(value?.coinsEarned),
    shortcutRuns: nonNegativeInteger(value?.shortcutRuns),
    perfectStarts: nonNegativeInteger(value?.perfectStarts),
    bestBoostChain: nonNegativeInteger(value?.bestBoostChain),
    bestLandingBoosts: nonNegativeInteger(value?.bestLandingBoosts),
    bestPadBoosts: nonNegativeInteger(value?.bestPadBoosts),
    bestDriftScore: nonNegativeInteger(value?.bestDriftScore),
    bestSkillScore: nonNegativeInteger(value?.bestSkillScore),
    ownedCarCount: nonNegativeInteger(value?.ownedCarCount),
    paintEquipped: clampInt(value?.paintEquipped, 0, 1, 0),
    rankTierIndex: clampInt(value?.rankTierIndex, 0, RANK_TIER_ORDER.length - 1, 0),
  };
}

// 段位可以传 'gold' 这样的 id、RANK_TIERS 的下标，或 getRankTier() 返回的对象。
function rankTierIndex(value) {
  if (typeof value === 'string') return Math.max(0, RANK_TIER_ORDER.indexOf(value));
  if (typeof value === 'number') return clampInt(value, 0, RANK_TIER_ORDER.length - 1, 0);
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    return Math.max(0, RANK_TIER_ORDER.indexOf(value.id));
  }
  return 0;
}

function hasPaint(value) {
  if (typeof value === 'string') return value.length > 0 ? 1 : 0;
  if (value && typeof value === 'object') return 1;
  return value === true ? 1 : 0;
}

// 任何字段缺失/非法都按 0 / false 处理；finished 必须显式为 true 才算完赛，
// 这样传空 context 不会白送里程碑成就。
function normalizeContext(context) {
  const finished = context?.finished === true;
  const entrants = clampInt(context?.entrants, 1, Number.MAX_SAFE_INTEGER, 1);
  const rawPosition = Number(context?.position);
  const position = Number.isFinite(rawPosition) && rawPosition >= 1 ? Math.round(rawPosition) : null;
  const mode = MODE_IDS.includes(context?.mode) ? context.mode : null;
  const trackId = typeof context?.trackId === 'string' && context.trackId.length > 0 ? context.trackId : null;
  return {
    finished,
    mode,
    trackId,
    // 单人模式（计时/漂移）entrants 为 1，第一名不算"夺冠"。
    won: finished && entrants > 1 && position === 1,
    cleanRace: context?.cleanRace === true,
    skillScore: nonNegativeInteger(context?.skillScore),
    driftScore: nonNegativeInteger(context?.driftScore),
    maxBoostChain: nonNegativeInteger(context?.maxBoostChain),
    perfectStart: context?.perfectStart === true,
    landingBoosts: nonNegativeInteger(context?.landingBoosts),
    padBoosts: nonNegativeInteger(context?.padBoosts),
    shortcutRuns: nonNegativeInteger(context?.shortcutRuns),
    totalCoins: nonNegativeInteger(context?.totalCoins),
    ownedCarCount: nonNegativeInteger(context?.ownedCarCount),
    equippedPaint: hasPaint(context?.equippedPaint),
    rankTierIndex: rankTierIndex(context?.rankTier),
  };
}

function advanceProgress(progress, ctx) {
  const next = { ...progress };
  // 快照类指标与是否完赛无关：钱包 / 车库 / 段位任何时候都可以推进。
  next.coinsEarned = Math.max(progress.coinsEarned, ctx.totalCoins);
  next.ownedCarCount = Math.max(progress.ownedCarCount, ctx.ownedCarCount);
  next.paintEquipped = Math.max(progress.paintEquipped, ctx.equippedPaint);
  next.rankTierIndex = Math.max(progress.rankTierIndex, ctx.rankTierIndex);
  if (!ctx.finished) return next;

  next.racesFinished = Math.min(COUNTER_CAP, progress.racesFinished + 1);
  next.driftTotal = Math.min(COUNTER_CAP, progress.driftTotal + ctx.driftScore);
  next.shortcutRuns = Math.min(COUNTER_CAP, progress.shortcutRuns + ctx.shortcutRuns);
  next.perfectStarts = Math.min(COUNTER_CAP, progress.perfectStarts + (ctx.perfectStart ? 1 : 0));
  next.bestBoostChain = Math.max(progress.bestBoostChain, ctx.maxBoostChain);
  next.bestLandingBoosts = Math.max(progress.bestLandingBoosts, ctx.landingBoosts);
  next.bestPadBoosts = Math.max(progress.bestPadBoosts, ctx.padBoosts);
  next.bestDriftScore = Math.max(progress.bestDriftScore, ctx.driftScore);
  next.bestSkillScore = Math.max(progress.bestSkillScore, ctx.skillScore);
  if (ctx.mode) next.modesFinished = withId(next.modesFinished, ctx.mode);
  if (ctx.won) {
    next.wins = Math.min(COUNTER_CAP, progress.wins + 1);
    if (ctx.cleanRace) next.cleanWins = Math.min(COUNTER_CAP, progress.cleanWins + 1);
    if (ctx.trackId) next.winTracks = withId(next.winTracks, ctx.trackId);
  }
  return next;
}

function metricValue(progress, id) {
  const value = progress[METRICS[id]];
  return Array.isArray(value) ? value.length : value ?? 0;
}

export function createDefaultAchievementState() {
  return { unlocked: {}, progress: createDefaultProgress(), updatedAt: null };
}

export function normalizeAchievementState(value = {}) {
  return {
    unlocked: normalizeUnlocked(value?.unlocked),
    progress: normalizeProgress(value?.progress),
    updatedAt: normalizeUpdatedAt(value?.updatedAt),
  };
}

export function getAchievementById(id) {
  const index = ACHIEVEMENT_INDEX.get(id);
  return index === undefined ? null : ACHIEVEMENTS[index];
}

// 每场比赛结算调用一次；返回全新的 state，入参永不被修改。
// newlyUnlocked 只包含本次新解锁的成就定义，coinReward 是它们的奖励总和。
export function evaluateAchievements(state, context, now) {
  const base = normalizeAchievementState(state);
  const progress = advanceProgress(base.progress, normalizeContext(context));
  const unlocked = { ...base.unlocked };
  const newlyUnlocked = [];
  let coinReward = 0;
  for (const achievement of ACHIEVEMENTS) {
    if (Object.hasOwn(unlocked, achievement.id)) continue;
    if (metricValue(progress, achievement.id) < achievement.target) continue;
    unlocked[achievement.id] = now ?? true;
    newlyUnlocked.push(achievement);
    coinReward += achievement.coinReward;
  }
  return {
    state: { unlocked, progress, updatedAt: now ?? null },
    newlyUnlocked,
    coinReward,
  };
}

export function achievementProgress(state, id) {
  const achievement = getAchievementById(id);
  if (!achievement) return { current: 0, target: 0, ratio: 0, unlocked: false };
  const normalized = normalizeAchievementState(state);
  const unlocked = Object.hasOwn(normalized.unlocked, achievement.id);
  const target = achievement.target;
  // 进度封顶在 target：已解锁的成就即使存档里指标偏低也显示满进度。
  const current = unlocked ? target : Math.min(target, metricValue(normalized.progress, achievement.id));
  return { current, target, ratio: target > 0 ? current / target : 0, unlocked };
}

export function listAchievements(state) {
  const normalized = normalizeAchievementState(state);
  return ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    ...achievementProgress(normalized, achievement.id),
  }));
}

export function loadAchievementState(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return createDefaultAchievementState();
  try {
    const stored = target.getItem(ACHIEVEMENTS_KEY);
    return stored ? normalizeAchievementState(JSON.parse(stored)) : createDefaultAchievementState();
  } catch {
    return createDefaultAchievementState();
  }
}

export function saveAchievementState(state, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.setItem) return false;
  try {
    target.setItem(ACHIEVEMENTS_KEY, JSON.stringify(normalizeAchievementState(state)));
    return true;
  } catch {
    return false;
  }
}
