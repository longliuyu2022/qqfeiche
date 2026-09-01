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

console.log(JSON.stringify({ rotation: 'ok', rewardsOnce: 'ok', persistence: 'ok' }));
