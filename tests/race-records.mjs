import assert from 'node:assert/strict';
import {
  RACE_RECORDS_KEY,
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
});

console.log(JSON.stringify({ persistence: 'ok', modeRecords: 'ok', corruptStorageFallback: 'ok' }));
