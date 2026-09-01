import assert from 'node:assert/strict';
import {
  ONLINE_RACE_LAPS,
  TRACK_LENGTH_METERS,
  minimumFinishTimeMs,
  validateRaceState,
} from '../server/race-validation.mjs';

const startAt = 1_000_000;
const baseMessage = {
  sequence: 1,
  x: 10,
  y: 0.05,
  z: -4,
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
  lap: 3,
  acceptedAt: startAt + minimumFinish - 1000,
};
const tooFast = validateRaceState({
  previous: finishPrevious,
  message: { ...baseMessage, sequence: 4, progress: 3, finished: true, finishTime: 0 },
  map: 'night',
  startAt,
  now: startAt + minimumFinish - 1,
});
assert.deepEqual({ accepted: tooFast.accepted, reason: tooFast.reason }, { accepted: false, reason: 'finish_too_fast' });

const finish = validateRaceState({
  previous: finishPrevious,
  message: { ...baseMessage, sequence: 4, progress: 3, finished: true, finishTime: 0 },
  map: 'night',
  startAt,
  now: startAt + minimumFinish + 100,
});
assert.equal(finish.accepted, true);
assert.equal(finish.state.finished, true);
assert.equal(finish.state.lap, 3);
assert.equal(finish.state.progress, 3);
assert.equal(finish.state.finishTime, (minimumFinish + 100) / 1000, 'server clock must own finish time');

console.log(JSON.stringify({
  tracks: Object.keys(TRACK_LENGTH_METERS).length,
  minimumFinishSeconds: Number((minimumFinish / 1000).toFixed(2)),
  invalidProgress: 'rejected',
  authoritativeFinishTime: 'ok',
}));
