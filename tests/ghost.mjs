import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  createGhostRecorder,
  createGhostPlayer,
  serializeGhost,
  deserializeGhost,
} from '../src/ghost.js';
import { GHOST_KEY_PREFIX, saveGhost, loadGhost, clearGhost } from '../src/race-records.js';

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

  removeItem(key) {
    this.values.delete(key);
  }
}

const TWO_PI = Math.PI * 2;

function angleDiff(a, b) {
  let delta = (a - b) % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return Math.abs(delta);
}

function poseAt(t) {
  return {
    x: 80 * Math.sin(0.22 * t),
    y: 3 + 2 * Math.sin(0.4 * t),
    z: 55 * Math.cos(0.17 * t),
    heading: 0.35 * t + 0.6 * Math.sin(0.5 * t), // wraps past ±π repeatedly
    drifting: Math.sin(0.5 * t) > 0.3,
  };
}

function recordRun(seconds) {
  const recorder = createGhostRecorder();
  assert.equal(recorder.recording, false);
  recorder.begin();
  assert.equal(recorder.recording, true);
  const frames = Math.round(seconds * 60);
  for (let frame = 0; frame <= frames; frame += 1) {
    recorder.sample(frame * (1 / 60), poseAt(frame * (1 / 60)));
  }
  const ghost = recorder.complete(seconds);
  assert.equal(recorder.recording, false);
  return ghost;
}

// 1. Record a 90 s sine trajectory, round-trip through serialization, then
//    verify interpolated playback fidelity.
const ghost90 = recordRun(90);
assert.ok(ghost90, 'complete() should return ghost data');
assert.equal(ghost90.v, 1);
assert.equal(ghost90.interval, 0.12);
assert.equal(ghost90.duration, 90);
assert.ok(ghost90.count >= 730 && ghost90.count <= 770, `throttled count, got ${ghost90.count}`);
assert.equal(ghost90.times[0], 0, 'first sample kept');
assert.equal(ghost90.times[ghost90.count - 1], 90, 'final sample kept');

const serialized90 = serializeGhost(ghost90);
assert.equal(typeof serialized90, 'string');
const decoded90 = deserializeGhost(serialized90);
assert.ok(decoded90, 'deserializeGhost should accept its own output');
assert.equal(decoded90.v, 1);
assert.equal(decoded90.count, ghost90.count);
assert.equal(decoded90.duration, 90);
assert.equal(serializeGhost(decoded90), serialized90, 'serialize(deserialize(x)) round trip');

const player = createGhostPlayer();
assert.equal(player.start(decoded90), true);
assert.equal(player.active, true);
assert.equal(player.duration, 90);
for (const t of [0.03, 7.31, 23.77, 42.5, 61.13, 88.88, 90]) {
  const frame = player.sampleAt(t);
  assert.ok(frame, `frame at ${t}`);
  const expected = poseAt(t);
  const error = Math.hypot(frame.x - expected.x, frame.y - expected.y, frame.z - expected.z);
  assert.ok(error < 0.6, `position error ${error.toFixed(4)} m at t=${t}`);
  const headingError = angleDiff(frame.heading, expected.heading);
  assert.ok(headingError < 0.05, `heading error ${headingError.toFixed(5)} rad at t=${t}`);
}
assert.equal(player.sampleAt(3).drifting, true, 'drifting flag survives round trip');
assert.equal(player.sampleAt(9).drifting, false, 'non-drifting flag survives round trip');

// 2. Serialized size: a 180 s trace must stay under 40 KB.
const ghost180 = recordRun(180);
const serialized180 = serializeGhost(ghost180);
assert.equal(typeof serialized180, 'string');
assert.ok(serialized180.length < 40_000, `180 s ghost is ${serialized180.length} chars`);

// 3. deserializeGhost must return null (never throw) on any malformed input.
assert.equal(deserializeGhost(''), null);
assert.equal(deserializeGhost(null), null);
assert.equal(deserializeGhost(undefined), null);
assert.equal(deserializeGhost(1234), null);
assert.equal(deserializeGhost('%%%not-base64%%'), null);
assert.equal(deserializeGhost('SGVsbG8gd29ybGQ='), null, 'valid base64, wrong payload');
assert.equal(deserializeGhost(serialized90.slice(0, 40)), null, 'truncated to whole quartets');
assert.equal(deserializeGhost(serialized90.slice(0, 41)), null, 'truncated mid-quartet');
assert.equal(deserializeGhost(`${serialized90}AAAA`), null, 'trailing junk');
const tampered = Buffer.from(serialized90, 'base64');
tampered.writeDoubleLE(Number.NaN, 12); // duration field
assert.equal(deserializeGhost(tampered.toString('base64')), null, 'NaN duration rejected');

// 4. Player boundaries: before start, t < 0, past duration + 0.5, after stop.
const boundaryPlayer = createGhostPlayer();
assert.equal(boundaryPlayer.sampleAt(1), null, 'no ghost started');
assert.equal(boundaryPlayer.active, false);
assert.equal(boundaryPlayer.duration, 0);
assert.equal(boundaryPlayer.start({ v: 1, count: 3 }), false, 'invalid ghost rejected');
assert.equal(boundaryPlayer.active, false);
assert.equal(boundaryPlayer.start(decoded90), true);
const before = boundaryPlayer.sampleAt(-2);
assert.ok(before, 'negative time clamps to first frame');
assert.equal(before.x, decoded90.x[0]);
assert.equal(before.heading, decoded90.heading[0]);
const held = boundaryPlayer.sampleAt(90.4);
assert.ok(held, 'last frame held for 0.5 s past duration');
assert.equal(held.x, decoded90.x[decoded90.count - 1]);
assert.equal(boundaryPlayer.sampleAt(90.51), null, 'null after duration + 0.5');
assert.equal(boundaryPlayer.sampleAt(Number.NaN), null);
boundaryPlayer.stop();
assert.equal(boundaryPlayer.active, false);
assert.equal(boundaryPlayer.sampleAt(1), null, 'null after stop');

// Recorder edge cases: cancel discards, empty recordings return null.
const cancelled = createGhostRecorder();
cancelled.begin();
cancelled.sample(0, poseAt(0));
cancelled.cancel();
assert.equal(cancelled.recording, false);
assert.equal(cancelled.complete(10), null, 'complete after cancel');
const empty = createGhostRecorder();
empty.begin();
assert.equal(empty.complete(5), null, 'complete without samples');
const idle = createGhostRecorder();
assert.equal(idle.sample(0, poseAt(0)), false, 'sample before begin is ignored');

// 5. race-records ghost storage: injected fake storage, per-track keys,
//    oversize rejection, unavailable/throwing storage.
const storage = new MemoryStorage();
assert.equal(loadGhost('alpine', storage), null);
assert.equal(saveGhost('alpine', serialized90, storage), true);
assert.equal(storage.values.has(`${GHOST_KEY_PREFIX}alpine`), true);
assert.equal(storage.values.has('neon-apex:ghost:alpine'), true, 'key shape');
assert.equal(loadGhost('alpine', storage), serialized90);
assert.ok(deserializeGhost(loadGhost('alpine', storage)), 'stored ghost stays playable');
assert.equal(saveGhost('canyon', serialized180, storage), true);
assert.equal(loadGhost('canyon', storage), serialized180);
clearGhost('canyon', storage);
assert.equal(loadGhost('canyon', storage), null);
assert.equal(loadGhost('alpine', storage), serialized90, 'clear only touches its track');
assert.equal(saveGhost('big', 'x'.repeat(80_001), storage), false, 'oversize rejected');
assert.equal(loadGhost('big', storage), null);
assert.equal(saveGhost('big', 'x'.repeat(80_000), storage), true, 'exactly 80_000 allowed');
assert.equal(saveGhost('', serialized90, storage), false);
assert.equal(saveGhost('alpine', '', storage), false);
assert.equal(loadGhost('', storage), null);
assert.equal(saveGhost('alpine', serialized90, null), false, 'no storage available');
assert.equal(loadGhost('alpine', null), null);
clearGhost('alpine', null);
const throwing = {
  getItem() { throw new Error('quota'); },
  setItem() { throw new Error('quota'); },
  removeItem() { throw new Error('quota'); },
};
assert.equal(saveGhost('alpine', serialized90, throwing), false, 'setItem throw swallowed');
assert.equal(loadGhost('alpine', throwing), null, 'getItem throw swallowed');
clearGhost('alpine', throwing);
assert.equal(loadGhost('alpine', storage), serialized90, 'original storage untouched');

console.log(JSON.stringify({
  recordPlayback: 'ok',
  size90s: serialized90.length,
  size180s: serialized180.length,
  corruptInputs: 'ok',
  playerBounds: 'ok',
  ghostStorage: 'ok',
}));
