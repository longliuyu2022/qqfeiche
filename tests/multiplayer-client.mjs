import assert from 'node:assert/strict';
import { connectionQuality, MultiplayerClient } from '../src/multiplayer-client.js';
import { createDefaultRankState, rankStateFromServer } from '../src/ranked.js';

const storage = new Map();
const client = new MultiplayerClient({
  url: 'ws://127.0.0.1:1/multiplayer',
  storage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  },
});

const dispatchMessage = (message) => client._handleMessage({ data: JSON.stringify(message) });
const rank = {
  tier: 1,
  division: 2,
  points: 17,
  wins: 4,
  races: 11,
  bestTierReached: 2,
  updatedAt: 12345,
  label: '白银 III · 17分',
};
const result = {
  type: 'rankResult',
  authoritative: true,
  settled: true,
  settlementId: 'race-1:12345',
  raceId: 'race-1',
  position: 1,
  totalRacers: 2,
  delta: 30,
  rank,
};

let resultEvents = 0;
client.addEventListener('rankResult', () => { resultEvents += 1; });
const pending = client.waitForRankResult({ raceId: 'race-1', timeoutMs: 100 });
dispatchMessage(result);
assert.deepEqual(await pending, result, '等待者只接收指定比赛的服务器结算');
assert.equal(client.lastRankResult.settlementId, result.settlementId);
assert.equal(client.rank.label, rank.label);
dispatchMessage(result);
assert.equal(resultEvents, 1, '重连重放的相同结算不应重复触发 UI 或计分');
assert.deepEqual(await client.waitForRankResult({ raceId: 'race-1', timeoutMs: 10 }), result);

dispatchMessage({
  type: 'race-result', settlementId: result.settlementId, raceId: result.raceId, authoritative: true,
});
dispatchMessage({
  type: 'race-result', settlementId: result.settlementId, raceId: result.raceId, authoritative: true,
});
assert.equal(client.lastRaceResult.settlementId, result.settlementId);

assert.equal(connectionQuality(null), 'unknown');
assert.equal(connectionQuality(45), 'excellent');
assert.equal(connectionQuality(100), 'good');
assert.equal(connectionQuality(180), 'fair');
assert.equal(connectionQuality(300), 'poor');
client.probes.set(7, Date.now() - 50);
dispatchMessage({ type: 'pong', nonce: 7, serverTime: Date.now() - 25 });
assert.ok(client.latencyMs >= 40 && client.latencyMs <= 100);
assert.equal(client.networkQuality, 'excellent');

const restored = rankStateFromServer(rank, createDefaultRankState());
assert.deepEqual(restored, {
  tier: 1, division: 2, points: 17, wins: 4, races: 11, bestTierReached: 2, updatedAt: 12345,
});
const legacy = rankStateFromServer({ tier: 2, division: 1, points: 9, wins: 2, races: 8 }, {
  tier: 1, division: 0, points: 80, wins: 1, races: 7, bestTierReached: 3, updatedAt: 99,
});
assert.equal(legacy.bestTierReached, 3, '旧服务器快照保留本地历史最高段位');
assert.equal(legacy.updatedAt, 99);
assert.equal(rankStateFromServer(null), null);

console.log(JSON.stringify({ settlementDedupe: 'ok', authoritativeRank: 'ok', networkQuality: 'ok' }));
