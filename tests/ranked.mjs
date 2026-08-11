import assert from 'node:assert/strict';
import {
  RANK_STATE_KEY,
  RANK_TIERS,
  applyRaceResult,
  createDefaultRankState,
  formatRank,
  getRankTier,
  loadRankState,
  rankProgress,
  saveRankState,
} from '../src/ranked.js';

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

const rankOf = (state) => ({ tier: state.tier, division: state.division, points: state.points });

assert.equal(RANK_TIERS.length, 7);
assert.equal(RANK_TIERS[0].id, 'bronze');
assert.equal(RANK_TIERS[6].label, '车神');
assert.deepEqual(createDefaultRankState(), {
  tier: 0,
  division: 2,
  points: 0,
  wins: 0,
  races: 0,
  bestTierReached: 0,
  updatedAt: null,
});

// 1. Winning streak: Bronze III 0 → division and tier promotions with overflow carry.
let state = createDefaultRankState();
const streak = [];
for (let i = 0; i < 10; i += 1) {
  const outcome = applyRaceResult(state, { position: 1, totalRacers: 6 }, 1000 + i);
  streak.push(outcome);
  state = outcome.state;
}
assert.ok(streak.every((outcome) => outcome.delta === 30));
assert.deepEqual(rankOf(streak[0].state), { tier: 0, division: 2, points: 30 });
assert.equal(streak[0].promoted, false);
assert.equal(streak[0].divisionChanged, false);
assert.equal(streak[0].label, '青铜 III · 30分');
// Race 4: 90 + 30 → Bronze II, 20 overflow points carried in.
assert.deepEqual(rankOf(streak[3].state), { tier: 0, division: 1, points: 20 });
assert.equal(streak[3].promoted, true);
assert.equal(streak[3].divisionChanged, true);
assert.equal(streak[3].tierChanged, false);
// Race 7: 80 + 30 → Bronze I, 10 overflow points.
assert.deepEqual(rankOf(streak[6].state), { tier: 0, division: 0, points: 10 });
// Race 10: Bronze I hits 100 → Silver III 0.
assert.deepEqual(rankOf(streak[9].state), { tier: 1, division: 2, points: 0 });
assert.equal(streak[9].promoted, true);
assert.equal(streak[9].tierChanged, true);
assert.equal(streak[9].label, '白银 III · 0分');
assert.equal(state.wins, 10);
assert.equal(state.races, 10);
assert.equal(state.bestTierReached, 1);
assert.equal(state.updatedAt, 1009);

// Stellar I 95 + 30 → Legend with 25 overflow points; legend accumulates uncapped.
const nearLegend = { tier: 5, division: 0, points: 95, wins: 40, races: 80, bestTierReached: 5, updatedAt: null };
const toLegend = applyRaceResult(nearLegend, { position: 1, totalRacers: 6 });
assert.deepEqual(rankOf(toLegend.state), { tier: 6, division: 0, points: 25 });
assert.equal(toLegend.promoted, true);
assert.equal(toLegend.tierChanged, true);
assert.equal(toLegend.label, '车神 · 25分');
const legendMore = applyRaceResult({ ...toLegend.state, points: 90 }, { position: 1, totalRacers: 6 });
assert.deepEqual(rankOf(legendMore.state), { tier: 6, division: 0, points: 120 });
assert.equal(legendMore.promoted, false);
assert.equal(legendMore.divisionChanged, false);

// 2. Losing points: soft 40-point landing, Bronze III floor, legend falling back.
const goldThree = { tier: 2, division: 2, points: 5, wins: 3, races: 9, bestTierReached: 2, updatedAt: null };
const acrossTier = applyRaceResult(goldThree, { position: 6, totalRacers: 6 });
assert.equal(acrossTier.delta, -16);
assert.deepEqual(rankOf(acrossTier.state), { tier: 1, division: 0, points: 40 });
assert.equal(acrossTier.demoted, true);
assert.equal(acrossTier.tierChanged, true);
assert.equal(acrossTier.state.bestTierReached, 2);
assert.equal(acrossTier.label, '白银 I · 40分');

const goldTwo = applyRaceResult({ ...goldThree, division: 1 }, { position: 6, totalRacers: 6 });
assert.deepEqual(rankOf(goldTwo.state), { tier: 2, division: 2, points: 40 });
assert.equal(goldTwo.demoted, true);
assert.equal(goldTwo.tierChanged, false);

// The 40-point cushion absorbs the next loss without another demotion.
const cushioned = applyRaceResult(acrossTier.state, { position: 6, totalRacers: 6 });
assert.deepEqual(rankOf(cushioned.state), { tier: 1, division: 0, points: 24 });
assert.equal(cushioned.demoted, false);

const bronzeFloor = applyRaceResult({ ...createDefaultRankState(), points: 5 }, { position: 6, totalRacers: 6 });
assert.equal(bronzeFloor.delta, -16);
assert.deepEqual(rankOf(bronzeFloor.state), { tier: 0, division: 2, points: 0 });
assert.equal(bronzeFloor.demoted, false);
assert.equal(bronzeFloor.divisionChanged, false);
const stillFloor = applyRaceResult(bronzeFloor.state, { position: 6, totalRacers: 6 });
assert.deepEqual(rankOf(stillFloor.state), { tier: 0, division: 2, points: 0 });

const legendLow = { tier: 6, division: 0, points: 10, wins: 50, races: 90, bestTierReached: 6, updatedAt: null };
const fell = applyRaceResult(legendLow, { position: 6, totalRacers: 6 });
assert.deepEqual(rankOf(fell.state), { tier: 5, division: 0, points: 40 });
assert.equal(fell.demoted, true);
assert.equal(fell.tierChanged, true);
assert.equal(fell.state.bestTierReached, 6);
assert.equal(fell.label, '星耀 I · 40分');

// 3. Point mapping for smaller grids: endpoints pinned, strictly decreasing.
const deltaFor = (position, totalRacers) =>
  applyRaceResult(createDefaultRankState(), { position, totalRacers }).delta;
assert.deepEqual([1, 2, 3, 4, 5, 6].map((position) => deltaFor(position, 6)), [30, 22, 14, 6, -8, -16]);
assert.equal(deltaFor(1, 2), 30);
assert.equal(deltaFor(2, 2), -16);
assert.equal(deltaFor(2, 3), 10);
const fourGrid = [1, 2, 3, 4].map((position) => deltaFor(position, 4));
assert.deepEqual(fourGrid, [30, 17, 1, -16]);
assert.ok(fourGrid[0] > 0);
assert.ok(fourGrid[fourGrid.length - 1] < 0);
for (let i = 1; i < fourGrid.length; i += 1) {
  assert.ok(fourGrid[i] < fourGrid[i - 1]);
}

// 4. Quitting mid-race scores as last place and never counts as a win.
const dnf = applyRaceResult(createDefaultRankState(), { position: 1, totalRacers: 6, finishedRace: false });
assert.equal(dnf.delta, -16);
assert.equal(dnf.state.wins, 0);
assert.equal(dnf.state.races, 1);
assert.equal(applyRaceResult(createDefaultRankState(), { totalRacers: 4, finishedRace: false }).delta, -16);

// 5. formatRank / rankProgress / getRankTier branches.
const goldMid = { tier: 2, division: 1, points: 37, wins: 5, races: 12, bestTierReached: 2, updatedAt: null };
const legendState = { tier: 6, division: 0, points: 214, wins: 70, races: 120, bestTierReached: 6, updatedAt: null };
assert.equal(formatRank(goldMid), '黄金 II · 37分');
assert.equal(formatRank(legendState), '车神 · 214分');
assert.equal(formatRank(createDefaultRankState()), '青铜 III · 0分');
assert.equal(rankProgress(goldMid), 0.37);
assert.equal(rankProgress(createDefaultRankState()), 0);
assert.equal(rankProgress(legendState), 1);
assert.deepEqual(getRankTier(goldMid), { id: 'gold', label: '黄金', division: 1, divisionLabel: 'II' });
assert.deepEqual(getRankTier(createDefaultRankState()), { id: 'bronze', label: '青铜', division: 2, divisionLabel: 'III' });
assert.deepEqual(getRankTier({ ...goldMid, tier: 4, division: 0 }), { id: 'diamond', label: '钻石', division: 0, divisionLabel: 'I' });
assert.deepEqual(getRankTier(legendState), { id: 'legend', label: '车神', division: null, divisionLabel: null });

// 6. load/save round trip with injected storage plus corrupt-data fallback.
const storage = new MemoryStorage();
assert.deepEqual(loadRankState(storage), createDefaultRankState());
const persisted = { tier: 3, division: 1, points: 64, wins: 12, races: 40, bestTierReached: 4, updatedAt: 1723 };
assert.equal(saveRankState(persisted, storage), true);
assert.deepEqual(loadRankState(storage), persisted);
const applied = applyRaceResult(persisted, { position: 2, totalRacers: 6 }, 1724);
assert.equal(saveRankState(applied.state, storage), true);
assert.deepEqual(loadRankState(storage), applied.state);

storage.setItem(RANK_STATE_KEY, '{broken');
assert.deepEqual(loadRankState(storage), createDefaultRankState());
storage.setItem(RANK_STATE_KEY, JSON.stringify({ tier: 99, division: -3, points: -50, wins: 'x', updatedAt: {} }));
assert.deepEqual(loadRankState(storage), {
  tier: 6,
  division: 0,
  points: 0,
  wins: 0,
  races: 0,
  bestTierReached: 6,
  updatedAt: null,
});

// Default storage in node: no globalThis.localStorage → default state.
assert.deepEqual(loadRankState(), createDefaultRankState());
assert.equal(saveRankState(createDefaultRankState()), false);
assert.deepEqual(loadRankState(null), createDefaultRankState());
assert.deepEqual(loadRankState(new ThrowingStorage()), createDefaultRankState());
assert.equal(saveRankState(createDefaultRankState(), null), false);
assert.equal(saveRankState(createDefaultRankState(), new ThrowingStorage()), false);

// 7. applyRaceResult never mutates its input.
const frozen = Object.freeze({ tier: 1, division: 1, points: 90, wins: 2, races: 5, bestTierReached: 1, updatedAt: 500 });
const snapshot = { ...frozen };
const outcome = applyRaceResult(frozen, { position: 1, totalRacers: 6 }, 999);
assert.notEqual(outcome.state, frozen);
assert.deepEqual({ ...frozen }, snapshot);
assert.deepEqual(rankOf(outcome.state), { tier: 1, division: 0, points: 20 });
assert.equal(outcome.state.updatedAt, 999);
assert.equal(outcome.label, formatRank(outcome.state));
assert.equal(applyRaceResult(frozen, { position: 3, totalRacers: 6 }).state.updatedAt, null);

console.log(JSON.stringify({
  promotionPath: 'ok',
  demotionProtection: 'ok',
  pointsMapping: 'ok',
  dnfPenalty: 'ok',
  formatters: 'ok',
  storageRoundTrip: 'ok',
  immutability: 'ok',
}));
