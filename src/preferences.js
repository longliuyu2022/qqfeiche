export const PREFERENCES_KEY = 'neon-apex:preferences:v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  soundEnabled: true,
  masterVolume: 0.7,
  musicEnabled: true,
  musicVolume: 0.5,
  voiceEnabled: true,
  voicePack: 'female',
  ghostEnabled: true,
  quality: 'auto',
  vibration: true,
  cameraShake: true,
  lastMode: 'race',
  lastTrack: 'night',
  carId: 'volt',
});

const QUALITY_OPTIONS = new Set(['auto', 'balanced', 'high', 'ultra']);
// 与 audio.js 的 VOICE_PACKS 键一一对应。
const VOICE_PACK_OPTIONS = new Set(['female', 'classic']);
const MODE_OPTIONS = new Set(['race', 'items', 'timeTrial', 'drift']);
const TRACK_OPTIONS = new Set(['night', 'day', 'alpine', 'canyon', 'coast']);
const CAR_OPTIONS = new Set(['volt', 'raiden', 'nimbus', 'goliath']);

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function normalizeVolume(value, fallback) {
  const volume = Number(value);
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : fallback;
}

export function normalizePreferences(value = {}) {
  return {
    soundEnabled: typeof value?.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_PREFERENCES.soundEnabled,
    masterVolume: normalizeVolume(value?.masterVolume, DEFAULT_PREFERENCES.masterVolume),
    musicEnabled: typeof value?.musicEnabled === 'boolean' ? value.musicEnabled : DEFAULT_PREFERENCES.musicEnabled,
    musicVolume: normalizeVolume(value?.musicVolume, DEFAULT_PREFERENCES.musicVolume),
    voiceEnabled: typeof value?.voiceEnabled === 'boolean' ? value.voiceEnabled : DEFAULT_PREFERENCES.voiceEnabled,
    voicePack: VOICE_PACK_OPTIONS.has(value?.voicePack) ? value.voicePack : DEFAULT_PREFERENCES.voicePack,
    ghostEnabled: typeof value?.ghostEnabled === 'boolean' ? value.ghostEnabled : DEFAULT_PREFERENCES.ghostEnabled,
    quality: QUALITY_OPTIONS.has(value?.quality) ? value.quality : DEFAULT_PREFERENCES.quality,
    vibration: typeof value?.vibration === 'boolean' ? value.vibration : DEFAULT_PREFERENCES.vibration,
    cameraShake: typeof value?.cameraShake === 'boolean' ? value.cameraShake : DEFAULT_PREFERENCES.cameraShake,
    lastMode: MODE_OPTIONS.has(value?.lastMode) ? value.lastMode : DEFAULT_PREFERENCES.lastMode,
    lastTrack: TRACK_OPTIONS.has(value?.lastTrack) ? value.lastTrack : DEFAULT_PREFERENCES.lastTrack,
    carId: CAR_OPTIONS.has(value?.carId) ? value.carId : DEFAULT_PREFERENCES.carId,
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
