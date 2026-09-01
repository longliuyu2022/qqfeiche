import { normalizeDifficulty } from './race-rules.js';

export const RACE_RECORDS_KEY = 'neon-apex:race-records:v1';
export const GHOST_KEY_PREFIX = 'neon-apex:ghost:';

const GHOST_MAX_SERIALIZED_LENGTH = 80_000;

const EMPTY_DIFFICULTY_RECORD = Object.freeze({
  races: 0,
  wins: 0,
  bestTime: null,
  bestLap: null,
  timeTrialBest: null,
  driftBest: 0,
  itemBest: null,
  kartBest: null,
});

const MODES = new Set(['race', 'kart', 'items', 'timeTrial', 'drift']);

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function normalizeDifficultyRecord(value = {}, fallback = {}) {
  return {
    races: nonNegativeInteger(value?.races ?? fallback?.races),
    wins: nonNegativeInteger(value?.wins ?? fallback?.wins),
    bestTime: positiveNumber(value?.bestTime ?? fallback?.bestTime),
    bestLap: positiveNumber(value?.bestLap ?? fallback?.bestLap),
    timeTrialBest: positiveNumber(value?.timeTrialBest ?? fallback?.timeTrialBest),
    driftBest: nonNegativeInteger(value?.driftBest ?? fallback?.driftBest),
    itemBest: positiveNumber(value?.itemBest ?? fallback?.itemBest),
    kartBest: positiveNumber(value?.kartBest ?? fallback?.kartBest),
  };
}

export function normalizeRaceRecords(value = {}) {
  const races = nonNegativeInteger(value?.races);
  const legacyEasy = value?.difficultyRecords ? {} : value;
  return {
    races,
    wins: nonNegativeInteger(value?.wins),
    bestTime: positiveNumber(value?.bestTime),
    bestLap: positiveNumber(value?.bestLap),
    highScore: nonNegativeInteger(value?.highScore),
    timeTrialBest: positiveNumber(value?.timeTrialBest),
    driftBest: nonNegativeInteger(value?.driftBest),
    itemBest: positiveNumber(value?.itemBest),
    kartBest: positiveNumber(value?.kartBest),
    modeRaces: {
      race: nonNegativeInteger(value?.modeRaces?.race ?? races),
      kart: nonNegativeInteger(value?.modeRaces?.kart),
      items: nonNegativeInteger(value?.modeRaces?.items),
      timeTrial: nonNegativeInteger(value?.modeRaces?.timeTrial),
      drift: nonNegativeInteger(value?.modeRaces?.drift),
    },
    difficultyRecords: {
      easy: normalizeDifficultyRecord(value?.difficultyRecords?.easy, legacyEasy),
      hard: normalizeDifficultyRecord(value?.difficultyRecords?.hard),
    },
  };
}

function emptyRecords() {
  return normalizeRaceRecords();
}

export function loadRaceRecords(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return emptyRecords();
  try {
    const stored = target.getItem(RACE_RECORDS_KEY);
    return stored
      ? normalizeRaceRecords(JSON.parse(stored))
      : emptyRecords();
  } catch {
    return emptyRecords();
  }
}

export function getModeBest(records, mode = 'race', difficulty = 'easy') {
  const normalized = normalizeRaceRecords(records);
  const scoped = normalized.difficultyRecords[normalizeDifficulty(difficulty)];
  if (mode === 'timeTrial') return scoped.timeTrialBest;
  if (mode === 'drift') return scoped.driftBest;
  if (mode === 'items') return scoped.itemBest;
  if (mode === 'kart') return scoped.kartBest;
  return scoped.bestTime;
}

export function recordRaceResult(result, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  const previous = loadRaceRecords(target);
  const mode = MODES.has(result?.mode) ? result.mode : 'race';
  const difficulty = normalizeDifficulty(result?.difficulty);
  const scopedPrevious = previous.difficultyRecords[difficulty];
  const finalTime = positiveNumber(result?.finalTime);
  const bestLapTime = positiveNumber(result?.bestLapTime);
  const skillScore = nonNegativeInteger(result?.skillScore);
  const position = positiveNumber(result?.position);
  const isNewBestTime = mode === 'race' && finalTime !== null
    && (scopedPrevious.bestTime === null || finalTime < scopedPrevious.bestTime);
  const isNewBestLap = bestLapTime !== null
    && (scopedPrevious.bestLap === null || bestLapTime < scopedPrevious.bestLap);
  const isNewTimeTrialBest = mode === 'timeTrial' && finalTime !== null
    && (scopedPrevious.timeTrialBest === null || finalTime < scopedPrevious.timeTrialBest);
  const isNewDriftBest = mode === 'drift' && skillScore > scopedPrevious.driftBest;
  const isNewItemBest = mode === 'items' && finalTime !== null
    && (scopedPrevious.itemBest === null || finalTime < scopedPrevious.itemBest);
  const isNewKartBest = mode === 'kart' && finalTime !== null
    && (scopedPrevious.kartBest === null || finalTime < scopedPrevious.kartBest);

  const scopedRecords = {
    races: scopedPrevious.races + 1,
    wins: scopedPrevious.wins + ((mode === 'race' || mode === 'items' || mode === 'kart') && position === 1 ? 1 : 0),
    bestTime: isNewBestTime ? finalTime : scopedPrevious.bestTime,
    bestLap: isNewBestLap ? bestLapTime : scopedPrevious.bestLap,
    timeTrialBest: isNewTimeTrialBest ? finalTime : scopedPrevious.timeTrialBest,
    driftBest: isNewDriftBest ? skillScore : scopedPrevious.driftBest,
    itemBest: isNewItemBest ? finalTime : scopedPrevious.itemBest,
    kartBest: isNewKartBest ? finalTime : scopedPrevious.kartBest,
  };

  const records = {
    races: previous.races + 1,
    wins: previous.wins + ((mode === 'race' || mode === 'items' || mode === 'kart') && position === 1 ? 1 : 0),
    bestTime: mode === 'race' && finalTime !== null && (previous.bestTime === null || finalTime < previous.bestTime)
      ? finalTime : previous.bestTime,
    bestLap: bestLapTime !== null && (previous.bestLap === null || bestLapTime < previous.bestLap)
      ? bestLapTime : previous.bestLap,
    highScore: Math.max(previous.highScore, skillScore),
    timeTrialBest: mode === 'timeTrial' && finalTime !== null
      && (previous.timeTrialBest === null || finalTime < previous.timeTrialBest) ? finalTime : previous.timeTrialBest,
    driftBest: mode === 'drift' ? Math.max(previous.driftBest, skillScore) : previous.driftBest,
    itemBest: mode === 'items' && finalTime !== null
      && (previous.itemBest === null || finalTime < previous.itemBest) ? finalTime : previous.itemBest,
    kartBest: mode === 'kart' && finalTime !== null
      && (previous.kartBest === null || finalTime < previous.kartBest) ? finalTime : previous.kartBest,
    modeRaces: {
      ...previous.modeRaces,
      [mode]: previous.modeRaces[mode] + 1,
    },
    difficultyRecords: {
      ...previous.difficultyRecords,
      [difficulty]: scopedRecords,
    },
  };

  try {
    target?.setItem?.(RACE_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }

  return {
    records,
    previous,
    mode,
    difficulty,
    isNewBestTime,
    isNewBestLap,
    isNewModeBest: isNewBestTime || isNewTimeTrialBest || isNewDriftBest || isNewItemBest || isNewKartBest,
  };
}

function ghostStorageKey(trackId) {
  return `${GHOST_KEY_PREFIX}${trackId}`;
}

function validTrackId(trackId) {
  return typeof trackId === 'string' && trackId.length > 0;
}

export function saveGhost(trackId, serialized, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!validTrackId(trackId)) return false;
  if (typeof serialized !== 'string' || serialized.length === 0) return false;
  if (serialized.length > GHOST_MAX_SERIALIZED_LENGTH) return false;
  if (!target?.setItem) return false;
  try {
    target.setItem(ghostStorageKey(trackId), serialized);
    return true;
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
    return false;
  }
}

export function loadGhost(trackId, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!validTrackId(trackId) || !target?.getItem) return null;
  try {
    const stored = target.getItem(ghostStorageKey(trackId));
    return typeof stored === 'string' && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

export function clearGhost(trackId, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!validTrackId(trackId)) return;
  try {
    target?.removeItem?.(ghostStorageKey(trackId));
  } catch {
    // Storage can be unavailable in private or embedded browser contexts.
  }
}
