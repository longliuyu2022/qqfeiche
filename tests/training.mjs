import assert from 'node:assert/strict';
import { createTrainingCoach } from '../src/training.js';

const coach = createTrainingCoach();
assert.equal(coach.getState().step.id, 'throttle');
coach.update({ speedKph: 40 });
assert.equal(coach.getState().step.id, 'steer');
coach.update({ speedKph: 40, steering: 0.5 });
assert.equal(coach.getState().step.id, 'drift');
coach.update({ speedKph: 40, isDrifting: true });
assert.equal(coach.getState().step.id, 'nitro');
coach.update({ speedKph: 40, isBoosting: true });
assert.equal(coach.getState().step.id, 'finish');
coach.update({ finished: true });
assert.equal(coach.getState().completed, true);
console.log(JSON.stringify({ guidedSteps: 'ok' }));
