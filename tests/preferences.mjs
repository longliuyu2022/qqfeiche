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
  ghostEnabled: false,
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
  ghostEnabled: false,
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
assert.equal(normalizePreferences({ carId: 'unknown-car' }).carId, 'volt');
assert.equal(normalizePreferences({ musicVolume: 'loud' }).musicVolume, 0.5);
assert.equal(normalizePreferences({}).voiceEnabled, true);
assert.equal(normalizePreferences({}).ghostEnabled, true);

storage.setItem(PREFERENCES_KEY, '{broken');
assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);

console.log(JSON.stringify({ persistence: 'ok', validation: 'ok', corruptStorageFallback: 'ok' }));
