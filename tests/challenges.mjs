import assert from 'node:assert/strict';
import { challengeCatalog, listChallenges, loadChallengeState, saveChallengeState, updateChallenges } from '../src/challenges.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

const now = new Date('2026-08-19T12:00:00+08:00').getTime();
const catalog = challengeCatalog(now);
assert.equal(catalog.daily.length, 3);
assert.equal(catalog.weekly.length, 3);
assert.equal(new Set(catalog.daily.map((item) => item.id)).size, 3);

let state = loadChallengeState(new MemoryStorage(), now);
const outcome = updateChallenges(state, {
  finished: true, position: 1, entrants: 6, cleanRace: true, driftScore: 20000,
  maxBoostChain: 5, shortcutRuns: 2, difficulty: 'hard', mode: 'kart',
}, now);
state = outcome.state;
assert.ok(outcome.coinReward >= 0);
const replay = updateChallenges(state, {
  finished: true, position: 1, entrants: 6, cleanRace: true, driftScore: 20000,
  maxBoostChain: 5, shortcutRuns: 2, difficulty: 'hard', mode: 'kart',
}, now + 1);
for (const completed of outcome.completed) assert.ok(!replay.completed.some((item) => item.id === completed.id));

const storage = new MemoryStorage();
assert.equal(saveChallengeState(state, storage), true);
assert.deepEqual(loadChallengeState(storage, now), state);
assert.equal(listChallenges(state, now).length, 6);
const tomorrow = now + 86400000;
assert.notEqual(loadChallengeState(storage, tomorrow).daily.id, state.daily.id);

// --- 轮换覆盖面 -----------------------------------------------------------
// 回归：旧的取样用固定步长 2（`pool[(offset + index * 2) % pool.length]`），步长与
// 每日池长 6 同为偶数，offset 的奇偶性锁死了取值集合，400 天里只会出现 2 种组合
// （boostChain+clean+hard 与 drift+finish+shortcut），半个池子永远抽不到。
const dailySets = new Set();
const weeklySets = new Set();
const base = Date.UTC(2026, 0, 1);
for (let day = 0; day < 400; day += 1) {
  const rotated = challengeCatalog(base + day * 86400000);
  dailySets.add(rotated.daily.map((item) => item.key).sort().join('+'));
  weeklySets.add(rotated.weekly.map((item) => item.key).sort().join('+'));
  // 同一期内三条任务不能重复。
  assert.equal(new Set(rotated.daily.map((item) => item.key)).size, 3);
  assert.equal(new Set(rotated.weekly.map((item) => item.key)).size, 3);
}
// 6 选 3 的全部组合是 C(6,3)=20，5 选 3 是 C(5,3)=10。
assert.equal(dailySets.size, 20);
assert.equal(weeklySets.size, 10);

// 确定性：同一天内任何时刻都必须给出同一组挑战，否则玩家刷新页面任务就变了。
// dayKey 走本地时区，所以锚点用本地正午，±4 小时不会跨日。
const localNoon = new Date(2026, 5, 17, 12, 0).getTime();
assert.deepEqual(
  challengeCatalog(localNoon - 4 * 3600000).daily.map((item) => item.id),
  challengeCatalog(localNoon + 4 * 3600000).daily.map((item) => item.id),
);

console.log(JSON.stringify({
  rotation: 'ok',
  rewardsOnce: 'ok',
  persistence: 'ok',
  dailyCombinations: dailySets.size,
  weeklyCombinations: weeklySets.size,
  deterministicWithinPeriod: 'ok',
}));
