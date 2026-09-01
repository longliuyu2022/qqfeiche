import assert from 'node:assert/strict';
import {
  RACE_RECORDS_KEY,
  getModeBest,
  loadRaceRecords,
  recordRaceResult,
} from '../src/race-records.js';

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

const storage = new MemoryStorage();
const first = recordRaceResult({ finalTime: 64.2, bestLapTime: 20.1, skillScore: 450, position: 2 }, storage);
assert.equal(first.isNewBestTime, true);
assert.deepEqual(first.records, {
  races: 1,
  wins: 0,
  bestTime: 64.2,
  bestLap: 20.1,
  highScore: 450,
  timeTrialBest: null,
  driftBest: 0,
  itemBest: null,
  kartBest: null,
  modeRaces: { race: 1, kart: 0, items: 0, timeTrial: 0, drift: 0 },
  difficultyRecords: {
    easy: {
      races: 1,
      wins: 0,
      bestTime: 64.2,
      bestLap: 20.1,
      timeTrialBest: null,
      driftBest: 0,
      itemBest: null,
      kartBest: null,
    },
    hard: {
      races: 0,
      wins: 0,
      bestTime: null,
      bestLap: null,
      timeTrialBest: null,
      driftBest: 0,
      itemBest: null,
      kartBest: null,
    },
  },
  // 不带 trackId 的调用仍然只写聚合桶，按图纪录保持为空。
  scoped: {},
});

const second = recordRaceResult({ finalTime: 61.8, bestLapTime: 20.4, skillScore: 390, position: 1 }, storage);
assert.equal(second.isNewBestTime, true);
assert.equal(second.isNewBestLap, false);
assert.equal(second.records.bestTime, 61.8);
assert.equal(second.records.wins, 1);

const timeTrial = recordRaceResult({ mode: 'timeTrial', finalTime: 19.8, bestLapTime: 19.8, skillScore: 20 }, storage);
assert.equal(timeTrial.isNewModeBest, true);
assert.equal(timeTrial.records.timeTrialBest, 19.8);

const drift = recordRaceResult({ mode: 'drift', finalTime: 65, skillScore: 3200 }, storage);
assert.equal(drift.isNewModeBest, true);
assert.equal(drift.records.driftBest, 3200);
assert.deepEqual(drift.records.modeRaces, { race: 2, kart: 0, items: 0, timeTrial: 1, drift: 1 });

const items = recordRaceResult({ mode: 'items', finalTime: 59.4, bestLapTime: 19.2, position: 1 }, storage);
assert.equal(items.isNewModeBest, true);
assert.equal(items.records.itemBest, 59.4);
assert.equal(items.records.wins, 2);
assert.equal(items.records.modeRaces.items, 1);

const kart = recordRaceResult({ mode: 'kart', finalTime: 62.7, bestLapTime: 20.6, position: 1 }, storage);
assert.equal(kart.isNewModeBest, true);
assert.equal(kart.records.kartBest, 62.7);
assert.equal(kart.records.wins, 3);
assert.equal(kart.records.modeRaces.kart, 1);

const hard = recordRaceResult({
  mode: 'race',
  difficulty: 'hard',
  finalTime: 70,
  bestLapTime: 22.5,
  position: 1,
}, storage);
assert.equal(hard.isNewBestTime, true);
assert.equal(hard.records.difficultyRecords.hard.bestTime, 70);
assert.equal(hard.records.difficultyRecords.easy.bestTime, 61.8);
assert.equal(hard.records.bestTime, 61.8);

const legacyStorage = new MemoryStorage();
legacyStorage.setItem(RACE_RECORDS_KEY, JSON.stringify({
  races: 4,
  wins: 2,
  bestTime: 58.5,
  bestLap: 18.8,
  timeTrialBest: 57.9,
  driftBest: 2400,
  itemBest: 59.2,
  kartBest: 60.1,
}));
const migrated = loadRaceRecords(legacyStorage);
assert.deepEqual(migrated.difficultyRecords.easy, {
  races: 4,
  wins: 2,
  bestTime: 58.5,
  bestLap: 18.8,
  timeTrialBest: 57.9,
  driftBest: 2400,
  itemBest: 59.2,
  kartBest: 60.1,
});
assert.equal(migrated.difficultyRecords.hard.races, 0);

storage.setItem(RACE_RECORDS_KEY, '{broken');
assert.deepEqual(loadRaceRecords(storage), {
  races: 0,
  wins: 0,
  bestTime: null,
  bestLap: null,
  highScore: 0,
  timeTrialBest: null,
  driftBest: 0,
  itemBest: null,
  kartBest: null,
  modeRaces: { race: 0, kart: 0, items: 0, timeTrial: 0, drift: 0 },
  difficultyRecords: {
    easy: {
      races: 0,
      wins: 0,
      bestTime: null,
      bestLap: null,
      timeTrialBest: null,
      driftBest: 0,
      itemBest: null,
      kartBest: null,
    },
    hard: {
      races: 0,
      wins: 0,
      bestTime: null,
      bestLap: null,
      timeTrialBest: null,
      driftBest: 0,
      itemBest: null,
      kartBest: null,
    },
  },
  scoped: {},
});

// --- 按赛道 + 变体分别记纪录 ---------------------------------------------
// 回归：此前纪录只按「赛制 + 难度」分组，短赛道的成绩会永久压住长赛道，
// 4867m 的糖果王国跑出本图最好成绩也判不出破纪录。
const scopedStorage = new MemoryStorage();
const shortTrack = recordRaceResult({
  mode: 'race', difficulty: 'easy', trackId: 'candy', trackVariant: 'normal',
  finalTime: 95.2, bestLapTime: 31, position: 1,
}, scopedStorage);
assert.equal(shortTrack.isNewBestTime, true);
assert.equal(shortTrack.scopeKey, 'easy:candy:normal');

// 近 3 倍长的赛道用时必然更大，但它是本图第一笔成绩，必须算破纪录。
const longTrack = recordRaceResult({
  mode: 'race', difficulty: 'easy', trackId: 'candyland', trackVariant: 'normal',
  finalTime: 280.5, bestLapTime: 92, position: 1,
}, scopedStorage);
assert.equal(longTrack.isNewBestTime, true);

// 反向赛道的最优线路与正向不同，纪录必须独立。
const reversed = recordRaceResult({
  mode: 'race', difficulty: 'easy', trackId: 'candyland', trackVariant: 'reverse',
  finalTime: 290.1, bestLapTime: 95, position: 1,
}, scopedStorage);
assert.equal(reversed.isNewBestTime, true);
assert.equal(reversed.scopeKey, 'easy:candyland:reverse');

// 同图同变体跑得更慢，不算破纪录。
const slower = recordRaceResult({
  mode: 'race', difficulty: 'easy', trackId: 'candyland', trackVariant: 'reverse',
  finalTime: 295, bestLapTime: 97, position: 1,
}, scopedStorage);
assert.equal(slower.isNewBestTime, false);

// 同图同变体但难度不同，同样各记一份。
const hardScoped = recordRaceResult({
  mode: 'race', difficulty: 'hard', trackId: 'candy', trackVariant: 'normal',
  finalTime: 99.9, bestLapTime: 33, position: 1,
}, scopedStorage);
assert.equal(hardScoped.isNewBestTime, true);

const scopedRecords = loadRaceRecords(scopedStorage);
assert.equal(getModeBest(scopedRecords, 'race', 'easy', 'candy', 'normal'), 95.2);
assert.equal(getModeBest(scopedRecords, 'race', 'easy', 'candyland', 'normal'), 280.5);
assert.equal(getModeBest(scopedRecords, 'race', 'easy', 'candyland', 'reverse'), 290.1);
assert.equal(getModeBest(scopedRecords, 'race', 'hard', 'candy', 'normal'), 99.9);
// 没跑过的赛道没有纪录，漂移模式的空值是 0 而非 null。
assert.equal(getModeBest(scopedRecords, 'race', 'easy', 'night', 'normal'), null);
assert.equal(getModeBest(scopedRecords, 'drift', 'easy', 'night', 'normal'), 0);
// 不传赛道时退回跨赛道聚合口径，供生涯统计与成就使用。
assert.equal(getModeBest(scopedRecords, 'race', 'easy'), 95.2);
assert.equal(scopedRecords.races, 5);
assert.deepEqual(Object.keys(scopedRecords.scoped).sort(), [
  'easy:candy:normal',
  'easy:candyland:normal',
  'easy:candyland:reverse',
  'hard:candy:normal',
]);

// 变体缺失或非法时归到 normal，不会散出垃圾桶。
const looseVariant = recordRaceResult({
  mode: 'race', difficulty: 'easy', trackId: 'candy', trackVariant: 'bogus',
  finalTime: 94, bestLapTime: 30, position: 1,
}, scopedStorage);
assert.equal(looseVariant.scopeKey, 'easy:candy:normal');
assert.equal(looseVariant.isNewBestTime, true);

// 存档里的非法作用域键要被丢掉，避免脏数据无限膨胀。
const dirtyStorage = new MemoryStorage();
dirtyStorage.setItem(RACE_RECORDS_KEY, JSON.stringify({
  scoped: {
    'easy:candy:normal': { races: 2, bestTime: 90 },
    'easy:candy': { races: 1, bestTime: 10 },
    'nightmare:candy:normal': { races: 1, bestTime: 10 },
    'easy:candy:sideways': { races: 1, bestTime: 10 },
    'easy::normal': { races: 1, bestTime: 10 },
  },
}));
assert.deepEqual(Object.keys(loadRaceRecords(dirtyStorage).scoped), ['easy:candy:normal']);

console.log(JSON.stringify({
  persistence: 'ok',
  modeRecords: 'ok',
  corruptStorageFallback: 'ok',
  perTrackScope: 'ok',
  variantScope: 'ok',
  scopeKeySanitation: 'ok',
}));
