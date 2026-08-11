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
  quality: 'balanced',
  vibration: false,
  cameraShake: false,
  lastMode: 'drift',
  lastTrack: 'day',
}, storage);
assert.deepEqual(saved, {
  soundEnabled: false,
  masterVolume: 1,
  quality: 'balanced',
  vibration: false,
  cameraShake: false,
  lastMode: 'drift',
  lastTrack: 'day',
});
assert.deepEqual(loadPreferences(storage), saved);
assert.equal(normalizePreferences({ quality: 'invalid', lastMode: 'invalid' }).quality, 'auto');
assert.equal(normalizePreferences({ lastTrack: 'invalid' }).lastTrack, 'night');

storage.setItem(PREFERENCES_KEY, '{broken');
assert.deepEqual(loadPreferences(storage), DEFAULT_PREFERENCES);

console.log(JSON.stringify({ persistence: 'ok', validation: 'ok', corruptStorageFallback: 'ok' }));
