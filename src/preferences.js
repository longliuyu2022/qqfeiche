export const PREFERENCES_KEY = 'neon-apex:preferences:v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  soundEnabled: true,
  masterVolume: 0.7,
  quality: 'auto',
  vibration: true,
  cameraShake: true,
  lastMode: 'race',
  lastTrack: 'night',
});

const QUALITY_OPTIONS = new Set(['auto', 'balanced', 'high']);
const MODE_OPTIONS = new Set(['race', 'items', 'timeTrial', 'drift']);
const TRACK_OPTIONS = new Set(['night', 'day', 'alpine', 'canyon', 'coast']);

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function normalizePreferences(value = {}) {
  const volume = Number(value?.masterVolume);
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_PREFERENCES.soundEnabled,
    masterVolume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_PREFERENCES.masterVolume,
    quality: QUALITY_OPTIONS.has(value?.quality) ? value.quality : DEFAULT_PREFERENCES.quality,
    vibration: typeof value?.vibration === 'boolean' ? value.vibration : DEFAULT_PREFERENCES.vibration,
    cameraShake: typeof value?.cameraShake === 'boolean' ? value.cameraShake : DEFAULT_PREFERENCES.cameraShake,
    lastMode: MODE_OPTIONS.has(value?.lastMode) ? value.lastMode : DEFAULT_PREFERENCES.lastMode,
    lastTrack: TRACK_OPTIONS.has(value?.lastTrack) ? value.lastTrack : DEFAULT_PREFERENCES.lastTrack,
  };
}

export function loadPreferences(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return { ...DEFAULT_PREFERENCES };
  try {
    const stored = target.getItem(PREFERENCES_KEY);
    return stored ? normalizePreferences(JSON.parse(stored)) : { ...DEFAULT_PREFERENCES };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(value, storage) {
  const preferences = normalizePreferences(value);
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.setItem?.(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences remain active for the current session when storage is unavailable.
  }
  return preferences;
}
