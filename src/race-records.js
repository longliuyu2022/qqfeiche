export const RACE_RECORDS_KEY = 'neon-apex:race-records:v1';
export const GHOST_KEY_PREFIX = 'neon-apex:ghost:';

const GHOST_MAX_SERIALIZED_LENGTH = 80_000;

const EMPTY_RECORDS = Object.freeze({
  races: 0,
  wins: 0,
  bestTime: null,
  bestLap: null,
  highScore: 0,
  timeTrialBest: null,
  driftBest: 0,
  itemBest: null,
  modeRaces: Object.freeze({ race: 0, items: 0, timeTrial: 0, drift: 0 }),
});

const MODES = new Set(['race', 'items', 'timeTrial', 'drift']);

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

export function normalizeRaceRecords(value = {}) {
  const races = nonNegativeInteger(value?.races);
  return {
    races,
    wins: nonNegativeInteger(value?.wins),
    bestTime: positiveNumber(value?.bestTime),
    bestLap: positiveNumber(value?.bestLap),
    highScore: nonNegativeInteger(value?.highScore),
    timeTrialBest: positiveNumber(value?.timeTrialBest),
    driftBest: nonNegativeInteger(value?.driftBest),
    itemBest: positiveNumber(value?.itemBest),
    modeRaces: {
      race: nonNegativeInteger(value?.modeRaces?.race ?? races),
      items: nonNegativeInteger(value?.modeRaces?.items),
      timeTrial: nonNegativeInteger(value?.modeRaces?.timeTrial),
      drift: nonNegativeInteger(value?.modeRaces?.drift),
    },
  };
}

export function loadRaceRecords(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return { ...EMPTY_RECORDS, modeRaces: { ...EMPTY_RECORDS.modeRaces } };
  try {
    const stored = target.getItem(RACE_RECORDS_KEY);
    return stored
      ? normalizeRaceRecords(JSON.parse(stored))
      : { ...EMPTY_RECORDS, modeRaces: { ...EMPTY_RECORDS.modeRaces } };
  } catch {
    return { ...EMPTY_RECORDS, modeRaces: { ...EMPTY_RECORDS.modeRaces } };
  }
}

export function recordRaceResult(result, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  const previous = loadRaceRecords(target);
  const mode = MODES.has(result?.mode) ? result.mode : 'race';
  const finalTime = positiveNumber(result?.finalTime);
  const bestLapTime = positiveNumber(result?.bestLapTime);
  const skillScore = nonNegativeInteger(result?.skillScore);
  const position = positiveNumber(result?.position);
  const isNewBestTime = mode === 'race' && finalTime !== null
    && (previous.bestTime === null || finalTime < previous.bestTime);
  const isNewBestLap = bestLapTime !== null
    && (previous.bestLap === null || bestLapTime < previous.bestLap);
  const isNewTimeTrialBest = mode === 'timeTrial' && finalTime !== null
    && (previous.timeTrialBest === null || finalTime < previous.timeTrialBest);
  const isNewDriftBest = mode === 'drift' && skillScore > previous.driftBest;
  const isNewItemBest = mode === 'items' && finalTime !== null
    && (previous.itemBest === null || finalTime < previous.itemBest);

  const records = {
    races: previous.races + 1,
    wins: previous.wins + ((mode === 'race' || mode === 'items') && position === 1 ? 1 : 0),
    bestTime: isNewBestTime ? finalTime : previous.bestTime,
    bestLap: isNewBestLap ? bestLapTime : previous.bestLap,
    highScore: Math.max(previous.highScore, skillScore),
    timeTrialBest: isNewTimeTrialBest ? finalTime : previous.timeTrialBest,
    driftBest: isNewDriftBest ? skillScore : previous.driftBest,
    itemBest: isNewItemBest ? finalTime : previous.itemBest,
    modeRaces: {
      ...previous.modeRaces,
      [mode]: previous.modeRaces[mode] + 1,
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
    isNewBestTime,
    isNewBestLap,
    isNewModeBest: isNewBestTime || isNewTimeTrialBest || isNewDriftBest || isNewItemBest,
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
