import assert from 'node:assert/strict';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  loadPreferences,
  normalizePreferences,
  savePreferences,
} from '../src/preferences.js';

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
const saved = savePreferences({
  soundEnabled: false,
  masterVolume: 2,
  musicEnabled: false,
  musicVolume: -1,
  voiceEnabled: false,
  voicePack: 'classic',
  ghostEnabled: false,
  difficulty: 'hard',
  trackVariant: 'reverse',
  touchLayout: 'left-handed',
  touchOpacity: 0.4,
  quality: 'balanced',
  vibration: false,
  cameraShake: false,
  lastMode: 'drift',
  lastTrack: 'day',
  carId: 'raiden',
}, storage);
assert.deepEqual(saved, {
  soundEnabled: false,
  masterVolume: 1,
  musicEnabled: false,
  musicVolume: 0,
  voiceEnabled: false,
  voicePack: 'classic',
  ghostEnabled: false,
  difficulty: 'hard',
  trackVariant: 'reverse',
  touchLayout: 'left-handed',
  touchOpacity: 0.4,
  quality: 'balanced',
  vibration: false,
  cameraShake: false,
  lastMode: 'drift',
  lastTrack: 'day',
  carId: 'raiden',
});
assert.deepEqual(loadPreferences(storage), saved);
assert.equal(normalizePreferences({ quality: 'invalid', lastMode: 'invalid' }).quality, 'auto');
assert.equal(normalizePreferences({ quality: 'ultra' }).quality, 'ultra');
assert.equal(normalizePreferences({ lastTrack: 'invalid' }).lastTrack, 'night');
assert.equal(normalizePreferences({ lastTrack: 'candyland' }).lastTrack, 'candyland');
assert.equal(normalizePreferences({ carId: 'unknown-car' }).carId, 'volt');
assert.equal(normalizePreferences({ musicVolume: 'loud' }).musicVolume, 0.5);
assert.equal(normalizePreferences({}).voiceEnabled, true);
assert.equal(normalizePreferences({}).ghostEnabled, true);
assert.equal(normalizePreferences({}).difficulty, 'easy');
assert.equal(normalizePreferences({ difficulty: 'hard' }).difficulty, 'hard');
assert.equal(normalizePreferences({ difficulty: 'expert' }).difficulty, 'easy');
assert.equal(normalizePreferences({}).trackVariant, 'normal');
assert.equal(normalizePreferences({ trackVariant: 'mirror' }).trackVariant, 'mirror');
assert.equal(normalizePreferences({ trackVariant: 'random' }).trackVariant, 'normal');
assert.equal(normalizePreferences({}).touchLayout, 'standard');
assert.equal(normalizePreferences({ touchLayout: 'compact' }).touchLayout, 'compact');
assert.equal(normalizePreferences({ touchLayout: 'invalid' }).touchLayout, 'standard');
assert.equal(normalizePreferences({ touchOpacity: 4 }).touchOpacity, 1);
// 播报音色默认女声：老存档没有这个字段，归一化后也要落到女声。
assert.equal(normalizePreferences({}).voicePack, 'female');
assert.equal(normalizePreferences({ voicePack: 'classic' }).voicePack, 'classic');
assert.equal(normalizePreferences({ voicePack: 'nope' }).voicePack, 'female');

storage.setItem(PREFERENCES_KEY, '{broken');
assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);

console.log(JSON.stringify({ persistence: 'ok', validation: 'ok', corruptStorageFallback: 'ok' }));
