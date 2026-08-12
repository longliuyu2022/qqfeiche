import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_KEY,
  ACHIEVEMENT_CATEGORIES,
  achievementProgress,
  createDefaultAchievementState,
  evaluateAchievements,
  getAchievementById,
  listAchievements,
  loadAchievementState,
  normalizeAchievementState,
  saveAchievementState,
} from '../src/achievements.js';

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

// 依次跑一串 context，返回 { state, unlockedIds, payouts }。
function runAll(contexts, startState = createDefaultAchievementState()) {
  let state = startState;
  const unlockedIds = [];
  const payouts = [];
  contexts.forEach((context, index) => {
    const outcome = evaluateAchievements(state, context, 1000 + index);
    state = outcome.state;
    unlockedIds.push(...outcome.newlyUnlocked.map((item) => item.id));
    payouts.push(outcome.coinReward);
  });
  return { state, unlockedIds, payouts };
}

const finishedRace = (extra = {}) => ({ mode: 'race', finished: true, ...extra });
const wonRace = (extra = {}) => finishedRace({ position: 1, entrants: 6, ...extra });
const repeat = (count, factory) => Array.from({ length: count }, (_, index) => factory(index));

// 1. 目录完整性。
assert.ok(ACHIEVEMENTS.length >= 16 && ACHIEVEMENTS.length <= 20, `catalog size ${ACHIEVEMENTS.length}`);
assert.ok(Object.isFrozen(ACHIEVEMENTS));
const ids = new Set();
const allowedKeys = new Set(['id', 'name', 'desc', 'category', 'target', 'coinReward', 'hidden']);
for (const achievement of ACHIEVEMENTS) {
  assert.ok(Object.isFrozen(achievement), `${achievement.id} not frozen`);
  assert.equal(typeof achievement.id, 'string');
  assert.ok(achievement.id.length > 0);
  assert.equal(ids.has(achievement.id), false, `duplicate id ${achievement.id}`);
  ids.add(achievement.id);
  assert.ok(typeof achievement.name === 'string' && achievement.name.length > 0, `${achievement.id} name`);
  assert.ok(typeof achievement.desc === 'string' && achievement.desc.length > 0, `${achievement.id} desc`);
  assert.ok(ACHIEVEMENT_CATEGORIES.includes(achievement.category), `${achievement.id} category`);
  assert.ok(Number.isInteger(achievement.target) && achievement.target > 0, `${achievement.id} target`);
  assert.ok(Number.isInteger(achievement.coinReward) && achievement.coinReward > 0, `${achievement.id} reward`);
  assert.ok(achievement.coinReward >= 100 && achievement.coinReward <= 1500, `${achievement.id} reward range`);
  if (Object.hasOwn(achievement, 'hidden')) assert.equal(typeof achievement.hidden, 'boolean');
  for (const key of Object.keys(achievement)) assert.ok(allowedKeys.has(key), `${achievement.id} extra key ${key}`);
}
// 每个类别都至少有一条成就，奖励分布覆盖 100 到 1500。
for (const category of ACHIEVEMENT_CATEGORIES) {
  assert.ok(ACHIEVEMENTS.some((item) => item.category === category), `empty category ${category}`);
}
const rewards = ACHIEVEMENTS.map((item) => item.coinReward);
assert.equal(Math.min(...rewards), 100);
assert.equal(Math.max(...rewards), 1500);

assert.equal(getAchievementById('first-race').name, '初次上路');
assert.equal(getAchievementById('nope'), null);
assert.equal(getAchievementById(undefined), null);
assert.deepEqual(createDefaultAchievementState().unlocked, {});
assert.equal(createDefaultAchievementState().updatedAt, null);
assert.deepEqual(createDefaultAchievementState().progress.winTracks, []);

// 2. 逐条验证：每一条成就都有一串能解锁它的 context。
const SCENARIOS = {
  'first-race': [finishedRace()],
  'ten-races': repeat(10, () => finishedRace()),
  'fifty-races': repeat(50, () => finishedRace()),
  'mode-explorer': ['race', 'items', 'timeTrial', 'drift'].map((mode) => ({ mode, finished: true })),
  'drift-century': [finishedRace({ driftScore: 100_000 })],
  'coin-tycoon': [finishedRace({ totalCoins: 50_000 })],
  'perfect-start': [finishedRace({ perfectStart: true })],
  'landing-triple': [finishedRace({ landingBoosts: 3 })],
  'boost-chain-5': [finishedRace({ maxBoostChain: 5 })],
  'drift-8000': [finishedRace({ driftScore: 8000 })],
  'skill-storm': [finishedRace({ skillScore: 25_000 })],
  'first-win': [wonRace()],
  'flawless-win': [wonRace({ cleanRace: true })],
  'grand-tour': ['night', 'day', 'alpine', 'canyon', 'coast'].map((trackId) => wonRace({ trackId })),
  'shortcut-first': [finishedRace({ shortcutRuns: 1 })],
  'pad-sweep': [finishedRace({ padBoosts: 6 })],
  'garage-full': [{ ownedCarCount: 4 }],
  'painted': [{ equippedPaint: 'paint-cyan' }],
  'gold-rank': [{ rankTier: 'gold' }],
  'diamond-rank': [{ rankTier: 'diamond' }],
};
assert.deepEqual(Object.keys(SCENARIOS).sort(), [...ids].sort(), 'scenario table misses an achievement');
for (const [id, contexts] of Object.entries(SCENARIOS)) {
  const { state, unlockedIds } = runAll(contexts);
  assert.ok(unlockedIds.includes(id), `${id} never unlocked by its scenario`);
  assert.equal(achievementProgress(state, id).unlocked, true, `${id} not marked unlocked`);
  assert.equal(achievementProgress(state, id).ratio, 1);
}

// 段位靠 id / 下标 / getRankTier() 对象都能推进；青铜不解锁任何段位成就。
assert.deepEqual(runAll([{ rankTier: 'bronze' }]).unlockedIds, []);
assert.deepEqual(runAll([{ rankTier: 4 }]).unlockedIds, ['gold-rank', 'diamond-rank']);
assert.deepEqual(runAll([{ rankTier: { id: 'legend', label: '车神' } }]).unlockedIds, ['gold-rank', 'diamond-rank']);
assert.deepEqual(runAll([{ rankTier: 'platinum' }]).unlockedIds, ['gold-rank']);
assert.deepEqual(runAll([{ rankTier: 'not-a-tier' }]).unlockedIds, []);
// 车漆可以是 id 字符串，也可以是 shop 的 payload 对象。
assert.deepEqual(runAll([{ equippedPaint: { color: '#fff' } }]).unlockedIds, ['painted']);
assert.deepEqual(runAll([{ equippedPaint: '' }]).unlockedIds, []);
assert.deepEqual(runAll([{ equippedPaint: null }]).unlockedIds, []);

// 单人模式的"第一名"不算夺冠。
assert.deepEqual(runAll([{ mode: 'timeTrial', finished: true, position: 1, entrants: 1 }]).unlockedIds, ['first-race']);
// 没完赛就不推进任何比赛类指标。
const dnf = runAll([{ mode: 'race', finished: false, position: 1, entrants: 6, driftScore: 99_999, padBoosts: 9 }]);
assert.deepEqual(dnf.unlockedIds, []);
assert.equal(dnf.state.progress.racesFinished, 0);
assert.equal(dnf.state.progress.driftTotal, 0);
assert.equal(dnf.state.progress.bestPadBoosts, 0);
// 但钱包 / 车库 / 段位这类快照指标即使没完赛也会记录。
const snapshotOnly = runAll([{ finished: false, totalCoins: 1200, ownedCarCount: 2, rankTier: 'silver' }]);
assert.equal(snapshotOnly.state.progress.coinsEarned, 1200);
assert.equal(snapshotOnly.state.progress.ownedCarCount, 2);
assert.equal(snapshotOnly.state.progress.rankTierIndex, 1);

// 3. 累计型跨多次调用正确累积，并且只在达标那一次解锁。
const drifting = repeat(3, () => finishedRace({ driftScore: 40_000 }));
let driftState = createDefaultAchievementState();
const driftUnlocks = drifting.map((context, index) => {
  const outcome = evaluateAchievements(driftState, context, index);
  driftState = outcome.state;
  return outcome.newlyUnlocked.map((item) => item.id);
});
assert.deepEqual(driftUnlocks[0], ['first-race', 'drift-8000']);
assert.deepEqual(driftUnlocks[1], []);
assert.deepEqual(driftUnlocks[2], ['drift-century']);
assert.equal(driftState.progress.driftTotal, 120_000);
assert.equal(driftState.progress.bestDriftScore, 40_000);
assert.deepEqual(achievementProgress(driftState, 'drift-century'), {
  current: 100_000,
  target: 100_000,
  ratio: 1,
  unlocked: true,
});

// 场次里程碑：第 1 / 10 / 50 场分别解锁，中间的场次不发奖。
let raceState = createDefaultAchievementState();
const raceUnlockAt = new Map();
for (let i = 1; i <= 50; i += 1) {
  const outcome = evaluateAchievements(raceState, finishedRace(), i);
  raceState = outcome.state;
  for (const item of outcome.newlyUnlocked) raceUnlockAt.set(item.id, i);
}
assert.equal(raceUnlockAt.get('first-race'), 1);
assert.equal(raceUnlockAt.get('ten-races'), 10);
assert.equal(raceUnlockAt.get('fifty-races'), 50);
assert.equal(raceState.progress.racesFinished, 50);
assert.equal(raceState.progress.wins, 0);
// 累计金币按"历史最高快照"记，而不是每场相加。
const coinRun = runAll([finishedRace({ totalCoins: 30_000 }), finishedRace({ totalCoins: 20_000 })]);
assert.equal(coinRun.state.progress.coinsEarned, 30_000);
assert.equal(coinRun.unlockedIds.includes('coin-tycoon'), false);
assert.equal(achievementProgress(coinRun.state, 'coin-tycoon').ratio, 0.6);

// 模式去重：同一模式跑三次仍然只算一种。
const sameMode = runAll(repeat(3, () => finishedRace()));
assert.deepEqual(sameMode.state.progress.modesFinished, ['race']);
assert.equal(sameMode.unlockedIds.includes('mode-explorer'), false);
// 非法 mode 不进 modesFinished。
assert.deepEqual(runAll([{ mode: 'ludicrous', finished: true }]).state.progress.modesFinished, []);

// 4. 五图夺冠去重：同一张图赢两次只算一次。
const tourContexts = [
  wonRace({ trackId: 'night' }),
  wonRace({ trackId: 'night' }),
  wonRace({ trackId: 'day' }),
  wonRace({ trackId: 'alpine' }),
  wonRace({ trackId: 'canyon' }),
];
const tour = runAll(tourContexts);
assert.deepEqual(tour.state.progress.winTracks, ['alpine', 'canyon', 'day', 'night']);
assert.equal(tour.state.progress.wins, 5);
assert.equal(tour.unlockedIds.includes('grand-tour'), false);
assert.deepEqual(achievementProgress(tour.state, 'grand-tour'), {
  current: 4,
  target: 5,
  ratio: 0.8,
  unlocked: false,
});
const tourDone = evaluateAchievements(tour.state, wonRace({ trackId: 'coast' }), 2000);
assert.deepEqual(tourDone.newlyUnlocked.map((item) => item.id), ['grand-tour']);
assert.equal(tourDone.coinReward, getAchievementById('grand-tour').coinReward);
// 缺 trackId 的夺冠只记 wins，不记地图。
const noTrack = runAll([wonRace()]);
assert.deepEqual(noTrack.state.progress.winTracks, []);
assert.equal(noTrack.state.progress.wins, 1);

// 5. 已解锁不重复发奖。
const firstWin = evaluateAchievements(createDefaultAchievementState(), wonRace({ cleanRace: true, trackId: 'night' }), 10);
assert.deepEqual(firstWin.newlyUnlocked.map((item) => item.id), ['first-race', 'first-win', 'flawless-win']);
assert.equal(
  firstWin.coinReward,
  ['first-race', 'first-win', 'flawless-win'].reduce((sum, id) => sum + getAchievementById(id).coinReward, 0),
);
// newlyUnlocked 直接返回目录里的定义对象。
assert.equal(firstWin.newlyUnlocked[0], getAchievementById('first-race'));
const secondWin = evaluateAchievements(firstWin.state, wonRace({ cleanRace: true, trackId: 'night' }), 11);
assert.deepEqual(secondWin.newlyUnlocked, []);
assert.equal(secondWin.coinReward, 0);
assert.equal(secondWin.state.progress.wins, 2);
assert.equal(secondWin.state.unlocked['first-win'], 10, 'unlock timestamp must not be rewritten');
assert.equal(secondWin.state.updatedAt, 11);
// now 缺省时时间戳退化成 true，updatedAt 为 null。
const noClock = evaluateAchievements(createDefaultAchievementState(), finishedRace());
assert.equal(noClock.state.unlocked['first-race'], true);
assert.equal(noClock.state.updatedAt, null);

// 6. 非法 / 空 context 不抛错，也不会误解锁。
const junkContexts = [
  undefined,
  null,
  {},
  { mode: 42, position: 'first', entrants: -3, finished: 'yes', trackId: 7 },
  { driftScore: NaN, skillScore: Infinity, maxBoostChain: -9, padBoosts: null, landingBoosts: {} },
  { perfectStart: 'true', cleanRace: 1, shortcutRuns: '3', totalCoins: [], ownedCarCount: undefined },
  { rankTier: [], equippedPaint: 0, position: 0, entrants: Number.NaN },
];
for (const context of junkContexts) {
  const outcome = evaluateAchievements(createDefaultAchievementState(), context, 5);
  assert.deepEqual(outcome.newlyUnlocked, [], `junk context unlocked something: ${JSON.stringify(context)}`);
  assert.equal(outcome.coinReward, 0);
  assert.deepEqual(outcome.state.progress, createDefaultAchievementState().progress);
}
// 完全不给 state 也能工作。
assert.deepEqual(evaluateAchievements(undefined, undefined).newlyUnlocked, []);
assert.deepEqual(evaluateAchievements(null, finishedRace()).newlyUnlocked.map((item) => item.id), ['first-race']);
// 数字字符串按数字读（与 ranked.js / shop.js 的 clampInt 口径一致），非数字才归 0。
assert.equal(evaluateAchievements(null, { finished: true, shortcutRuns: '3' }).state.progress.shortcutRuns, 3);
assert.equal(evaluateAchievements(null, { finished: true, shortcutRuns: '3m' }).state.progress.shortcutRuns, 0);
assert.equal(evaluateAchievements(null, { finished: true, driftScore: 8000.9 }).state.progress.bestDriftScore, 8000);

// 7. normalizeAchievementState：丢掉未知 id、修正越界进度。
const dirty = normalizeAchievementState({
  unlocked: { 'first-race': 999, 'ghost-achievement': 1, 'painted': false, 'first-win': true, 'gold-rank': null },
  progress: {
    racesFinished: -5,
    driftTotal: 'x',
    coinsEarned: 12.9,
    winTracks: ['night', 'night', 42, '', 'day'],
    modesFinished: ['race', 'nope', 'drift'],
    paintEquipped: 7,
    rankTierIndex: 99,
    bestDriftScore: Infinity,
  },
  updatedAt: {},
});
assert.deepEqual(Object.keys(dirty.unlocked).sort(), ['first-race', 'first-win']);
assert.equal(dirty.unlocked['first-race'], 999);
assert.equal(dirty.unlocked['first-win'], true);
assert.equal(dirty.progress.racesFinished, 0);
assert.equal(dirty.progress.driftTotal, 0);
assert.equal(dirty.progress.coinsEarned, 12);
assert.deepEqual(dirty.progress.winTracks, ['day', 'night']);
assert.deepEqual(dirty.progress.modesFinished, ['drift', 'race']);
assert.equal(dirty.progress.paintEquipped, 1);
assert.equal(dirty.progress.rankTierIndex, 6);
assert.equal(dirty.progress.bestDriftScore, 0);
assert.equal(dirty.updatedAt, null);
assert.deepEqual(normalizeAchievementState(), createDefaultAchievementState());
assert.deepEqual(normalizeAchievementState('broken'), createDefaultAchievementState());
assert.deepEqual(normalizeAchievementState({ unlocked: 'nope', progress: 12 }), createDefaultAchievementState());

// 8. load / save 假 storage 往返与坏数据回退。
const storage = new MemoryStorage();
assert.deepEqual(loadAchievementState(storage), createDefaultAchievementState());
const persisted = runAll([wonRace({ trackId: 'night', driftScore: 9000, padBoosts: 6 })]).state;
assert.equal(saveAchievementState(persisted, storage), true);
assert.deepEqual(loadAchievementState(storage), persisted);
const resumed = evaluateAchievements(loadAchievementState(storage), wonRace({ trackId: 'day' }), 77);
assert.deepEqual(resumed.newlyUnlocked, [], '存档回来的成就不应该重复解锁');
assert.equal(saveAchievementState(resumed.state, storage), true);
assert.deepEqual(loadAchievementState(storage), resumed.state);

storage.setItem(ACHIEVEMENTS_KEY, '{broken');
assert.deepEqual(loadAchievementState(storage), createDefaultAchievementState());
storage.setItem(ACHIEVEMENTS_KEY, JSON.stringify({ unlocked: { nope: 1 }, progress: { racesFinished: -1 } }));
assert.deepEqual(loadAchievementState(storage), createDefaultAchievementState());
storage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(['not', 'an', 'object']));
assert.deepEqual(loadAchievementState(storage), createDefaultAchievementState());

// node 里没有 globalThis.localStorage：默认 storage 直接退化。
assert.deepEqual(loadAchievementState(), createDefaultAchievementState());
assert.equal(saveAchievementState(createDefaultAchievementState()), false);
assert.deepEqual(loadAchievementState(null), createDefaultAchievementState());
assert.deepEqual(loadAchievementState({}), createDefaultAchievementState());
assert.deepEqual(loadAchievementState(new ThrowingStorage()), createDefaultAchievementState());
assert.equal(saveAchievementState(createDefaultAchievementState(), null), false);
assert.equal(saveAchievementState(createDefaultAchievementState(), new ThrowingStorage()), false);

// 9. 入参不可变：冻结 state / progress / 数组后依然能正常结算。
const frozenState = Object.freeze({
  unlocked: Object.freeze({ 'first-race': 1 }),
  progress: Object.freeze({
    ...createDefaultAchievementState().progress,
    racesFinished: 9,
    wins: 1,
    winTracks: Object.freeze(['night']),
    modesFinished: Object.freeze(['race']),
  }),
  updatedAt: 1,
});
const snapshot = JSON.parse(JSON.stringify(frozenState));
const mutated = evaluateAchievements(frozenState, wonRace({ trackId: 'day', mode: 'drift' }), 4242);
assert.deepEqual(JSON.parse(JSON.stringify(frozenState)), snapshot, 'input state was mutated');
assert.notEqual(mutated.state, frozenState);
assert.notEqual(mutated.state.progress, frozenState.progress);
assert.notEqual(mutated.state.unlocked, frozenState.unlocked);
assert.notEqual(mutated.state.progress.winTracks, frozenState.progress.winTracks);
assert.deepEqual(mutated.state.progress.winTracks, ['day', 'night']);
assert.deepEqual(mutated.state.progress.modesFinished, ['drift', 'race']);
assert.equal(mutated.state.progress.racesFinished, 10);
assert.deepEqual(mutated.newlyUnlocked.map((item) => item.id), ['ten-races', 'first-win']);
// 冻结的 context 同样不会被写坏。
const frozenContext = Object.freeze(wonRace({ trackId: 'coast' }));
assert.doesNotThrow(() => evaluateAchievements(frozenState, frozenContext, 1));
// listAchievements / achievementProgress 也不动 state。
const beforeRead = JSON.parse(JSON.stringify(mutated.state));
listAchievements(mutated.state);
achievementProgress(mutated.state, 'grand-tour');
assert.deepEqual(JSON.parse(JSON.stringify(mutated.state)), beforeRead);

// 10. achievementProgress 分支。
assert.deepEqual(achievementProgress(createDefaultAchievementState(), 'unknown-id'), {
  current: 0,
  target: 0,
  ratio: 0,
  unlocked: false,
});
assert.deepEqual(achievementProgress(undefined, 'fifty-races'), { current: 0, target: 50, ratio: 0, unlocked: false });
const halfway = runAll(repeat(25, () => finishedRace())).state;
assert.deepEqual(achievementProgress(halfway, 'fifty-races'), { current: 25, target: 50, ratio: 0.5, unlocked: false });
// 超额完成时进度封顶在 target，ratio 不会超过 1。
const overshoot = runAll(repeat(12, () => finishedRace())).state;
assert.deepEqual(achievementProgress(overshoot, 'ten-races'), { current: 10, target: 10, ratio: 1, unlocked: true });
// 存档里标了解锁但指标偏低时，仍然显示满进度。
const patched = normalizeAchievementState({ unlocked: { 'fifty-races': 1 }, progress: { racesFinished: 3 } });
assert.deepEqual(achievementProgress(patched, 'fifty-races'), { current: 50, target: 50, ratio: 1, unlocked: true });
// 段位类进度按段位下标算。
assert.deepEqual(achievementProgress(runAll([{ rankTier: 'silver' }]).state, 'diamond-rank'), {
  current: 1,
  target: 4,
  ratio: 0.25,
  unlocked: false,
});

// 11. listAchievements 分支。
const listed = listAchievements(halfway);
assert.equal(listed.length, ACHIEVEMENTS.length);
assert.deepEqual(listed.map((item) => item.id), ACHIEVEMENTS.map((item) => item.id));
for (const entry of listed) {
  const definition = getAchievementById(entry.id);
  assert.equal(entry.name, definition.name);
  assert.equal(entry.desc, definition.desc);
  assert.equal(entry.category, definition.category);
  assert.equal(entry.coinReward, definition.coinReward);
  assert.equal(entry.target, definition.target);
  assert.equal(entry.hidden, definition.hidden);
  assert.equal(typeof entry.unlocked, 'boolean');
  assert.ok(entry.ratio >= 0 && entry.ratio <= 1, `${entry.id} ratio out of range`);
  assert.ok(entry.current <= entry.target);
  assert.equal(entry.unlocked, achievementProgress(halfway, entry.id).unlocked);
}
assert.deepEqual(
  listed.filter((item) => item.unlocked).map((item) => item.id),
  ['first-race', 'ten-races'],
);
assert.equal(listed.find((item) => item.id === 'flawless-win').hidden, true);
assert.equal(listed.every((item) => item.ratio === 0 || item.current > 0), true);
const emptyList = listAchievements(undefined);
assert.equal(emptyList.length, ACHIEVEMENTS.length);
assert.equal(emptyList.every((item) => item.unlocked === false && item.current === 0 && item.ratio === 0), true);

// 12. 一条全能记录可以一次点亮大部分成就（收尾的整体冒烟）。
const monster = evaluateAchievements(createDefaultAchievementState(), {
  mode: 'race',
  finished: true,
  position: 1,
  entrants: 6,
  cleanRace: true,
  trackId: 'night',
  skillScore: 26_000,
  driftScore: 12_000,
  maxBoostChain: 6,
  perfectStart: true,
  landingBoosts: 4,
  padBoosts: 6,
  shortcutRuns: 2,
  totalCoins: 51_000,
  ownedCarCount: 4,
  equippedPaint: 'paint-void',
  rankTier: 'diamond',
}, 9000);
const monsterIds = monster.newlyUnlocked.map((item) => item.id);
assert.equal(monsterIds.length, ACHIEVEMENTS.length - 5, '除累计/去重类外都应解锁');
for (const id of ['ten-races', 'fifty-races', 'mode-explorer', 'drift-century', 'grand-tour']) {
  assert.equal(monsterIds.includes(id), false, `${id} 不该被单场解锁`);
}
assert.equal(monster.coinReward, monsterIds.reduce((sum, id) => sum + getAchievementById(id).coinReward, 0));
assert.equal(monster.state.progress.shortcutRuns, 2);

console.log(JSON.stringify({
  catalog: `${ACHIEVEMENTS.length} achievements`,
  perAchievementUnlock: 'ok',
  cumulativeProgress: 'ok',
  trackDedupe: 'ok',
  noDoubleReward: 'ok',
  junkContexts: 'ok',
  normalize: 'ok',
  storageRoundTrip: 'ok',
  immutability: 'ok',
  progressBranches: 'ok',
  listing: 'ok',
}));
