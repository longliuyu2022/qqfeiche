import assert from 'node:assert/strict';
import { racePosition } from './race-fixtures.mjs';
import { curves } from '../scripts/generate-race-routes.mjs';
import { createTrackVariantCurve } from '../src/track-variant.js';
import { computeTrackFeatures, featureZonesForPhysics } from '../src/track-features.js';
import {
  ONLINE_RACE_LAPS,
  TRACK_LENGTH_METERS,
  minimumFinishTimeMs,
  validateRaceState,
} from '../server/race-validation.mjs';

const startAt = 1_000_000;
const baseMessage = {
  sequence: 1,
  ...racePosition('night', 0.04),
  yaw: 0.2,
  speed: 60,
  progress: 0.04,
  lap: 9,
  finished: false,
};

assert.equal(ONLINE_RACE_LAPS, 3);
assert.deepEqual(Object.keys(TRACK_LENGTH_METERS), ['night', 'day', 'alpine', 'canyon', 'coast', 'candy', 'candyland']);
assert.equal(
  validateRaceState({ message: baseMessage, map: 'night', startAt, now: startAt - 1 }).reason,
  'race_not_started',
);

const first = validateRaceState({ message: baseMessage, map: 'night', startAt, now: startAt + 1000 });
assert.equal(first.accepted, true);
assert.equal(first.state.lap, 1, 'lap must be derived from trusted progress');

const jump = validateRaceState({
  previous: { ...first.state, acceptedAt: first.acceptedAt },
  message: { ...baseMessage, sequence: 2, progress: 1.2, x: 12 },
  map: 'night',
  startAt,
  now: startAt + 1100,
});
assert.deepEqual({ accepted: jump.accepted, reason: jump.reason }, { accepted: false, reason: 'progress_jump' });

const teleport = validateRaceState({
  previous: { ...first.state, acceptedAt: first.acceptedAt },
  message: { ...baseMessage, sequence: 2, progress: 0.045, x: 900, z: 900 },
  map: 'night',
  startAt,
  now: startAt + 1100,
});
assert.deepEqual({ accepted: teleport.accepted, reason: teleport.reason }, { accepted: false, reason: 'position_jump' });

const minimumFinish = minimumFinishTimeMs('night');
const finishPrevious = {
  ...first.state,
  sequence: 3,
  progress: 2.99,
  distanceTravelled: TRACK_LENGTH_METERS.night * 2.99,
  ...racePosition('night', 2.99),
  lap: 3,
  acceptedAt: startAt + minimumFinish - 1000,
};
const tooFast = validateRaceState({
  previous: finishPrevious,
  message: { ...baseMessage, ...racePosition('night', 3), sequence: 4, progress: 3, finished: true, finishTime: 0 },
  map: 'night',
  startAt,
  now: startAt + minimumFinish - 1,
});
assert.deepEqual({ accepted: tooFast.accepted, reason: tooFast.reason }, { accepted: false, reason: 'finish_too_fast' });

const finish = validateRaceState({
  previous: finishPrevious,
  message: { ...baseMessage, ...racePosition('night', 3), sequence: 4, progress: 3, finished: true, finishTime: 0 },
  map: 'night',
  startAt,
  now: startAt + minimumFinish + 100,
});
assert.equal(finish.accepted, true);
assert.equal(finish.state.finished, true);
assert.equal(finish.state.lap, 3);
assert.equal(finish.state.progress, 3);
assert.equal(finish.state.finishTime, (minimumFinish + 100) / 1000, 'server clock must own finish time');

const mismatch = validateRaceState({ message: { ...baseMessage, x: 0, y: 0, z: 0 }, map: 'night', startAt, now: startAt + 1000 });
assert.equal(mismatch.reason, 'position_progress_mismatch');
const wrongVariant = validateRaceState({ message: baseMessage, map: 'night', trackVariant: 'mirror', startAt, now: startAt + 1000 });
assert.equal(wrongVariant.reason, 'position_progress_mismatch');
const afterFinish = validateRaceState({ previous: { ...finish.state, acceptedAt: finish.acceptedAt }, message: { ...baseMessage, sequence: 5, progress: 0, x: 900 }, map: 'night', startAt, now: finish.acceptedAt + 100 });
assert.equal(afterFinish.state.progress, 3, 'post-finish movement cannot revoke settlement');
const atGrid = validateRaceState({ message: { ...baseMessage, ...racePosition('night', 0), progress: 0 }, map: 'night', startAt, now: startAt + 100 });
const reversing = validateRaceState({ previous: { ...atGrid.state, acceptedAt: atGrid.acceptedAt }, message: { ...baseMessage, ...racePosition('night', -0.025), sequence: 2, progress: 0, speed: -15 }, map: 'night', startAt, now: startAt + 4100 });
assert.equal(reversing.accepted, true, 'reversing behind the starting grid must remain legal');
const parkedFinish = validateRaceState({ previous: { ...atGrid.state, acceptedAt: atGrid.acceptedAt }, message: { ...baseMessage, ...racePosition('night', 3), sequence: 2, progress: 3, finished: true }, map: 'night', startAt, now: startAt + minimumFinish + 1000 });
assert.equal(parkedFinish.reason, 'insufficient_movement', 'waiting at the finish line cannot stand in for observed movement');
const firstPacketFinish = validateRaceState({ message: { ...baseMessage, ...racePosition('night', 3), progress: 3, finished: true }, map: 'night', startAt, now: startAt + minimumFinish + 1000 });
assert.equal(firstPacketFinish.reason, 'insufficient_movement');

let fullRoutes = 0;
let legalShortcuts = 0;
for (const [map, source] of Object.entries(curves)) {
  for (const variant of ['normal', 'reverse', 'mirror']) {
    for (const index of [0, 2, 5]) {
      let previous = null;
      for (let tick = 0; tick <= 600; tick++) {
        const progress = tick / 200;
        const result = validateRaceState({
          previous, map, trackVariant: variant, startProgress: ((0.002 - Math.floor(index / 2) * 0.0042) % 1 + 1) % 1,
          startAt, now: startAt + tick * 200,
          message: { ...baseMessage, ...racePosition(map, progress, { index, variant }), sequence: tick + 1, progress, finished: tick === 600 },
        });
        assert.equal(result.accepted, true, `${map}/${variant}/grid${index}/tick${tick}: ${result.reason}`);
        previous = { ...result.state, acceptedAt: result.acceptedAt };
      }
      fullRoutes++;
    }
    const curve = createTrackVariantCurve(source, variant);
    const zones = featureZonesForPhysics(computeTrackFeatures(curve, { trackId: map, roadWidth: 16 }));
    for (const zone of zones.shortcuts) {
      const lengths = zone.points.slice(1).map((p, i) => Math.hypot(p.x - zone.points[i].x, p.z - zone.points[i].z));
      const total = lengths.reduce((a, b) => a + b, 0);
      let distance = 0;
      for (let i = 0; i < zone.points.length; i++) {
        const absolute = zone.start + (zone.end - zone.start) * distance / total;
        const progress = absolute - 0.002;
        const result = validateRaceState({
          map, trackVariant: variant, startAt, now: startAt + progress * TRACK_LENGTH_METERS[map] / 80 * 1000,
          message: { ...baseMessage, ...zone.points[i], sequence: 1, progress },
        });
        assert.equal(result.accepted, true, `${map}/${variant}/${zone.id}/${i}: ${result.reason}`);
        distance += lengths[i] ?? 0;
      }
      legalShortcuts++;
    }
  }
}

console.log(JSON.stringify({
  tracks: Object.keys(TRACK_LENGTH_METERS).length,
  minimumFinishSeconds: Number((minimumFinish / 1000).toFixed(2)),
  invalidProgress: 'rejected',
  authoritativeFinishTime: 'ok',
  fullRoutes,
  legalShortcuts,
  stationaryProgress: 'rejected',
}));
