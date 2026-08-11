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
  modeRaces: { race: 1, items: 0, timeTrial: 0, drift: 0 },
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
assert.deepEqual(drift.records.modeRaces, { race: 2, items: 0, timeTrial: 1, drift: 1 });

const items = recordRaceResult({ mode: 'items', finalTime: 59.4, bestLapTime: 19.2, position: 1 }, storage);
assert.equal(items.isNewModeBest, true);
assert.equal(items.records.itemBest, 59.4);
assert.equal(items.records.wins, 2);
assert.equal(items.records.modeRaces.items, 1);

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
  modeRaces: { race: 0, items: 0, timeTrial: 0, drift: 0 },
});

console.log(JSON.stringify({ persistence: 'ok', modeRecords: 'ok', corruptStorageFallback: 'ok' }));
