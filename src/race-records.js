import { normalizeDifficulty, normalizeTrackVariant } from './race-rules.js';

export const RACE_RECORDS_KEY = 'neon-apex:race-records:v1';
export const GHOST_KEY_PREFIX = 'neon-apex:ghost:';

const GHOST_MAX_SERIALIZED_LENGTH = 80_000;

// 单个赛道 + 变体的纪录桶上限。7 张图 × 3 变体 × 2 难度 = 42 个桶，留足余量后
// 仍然封顶，避免异常写入把 localStorage 撑爆。
const MAX_SCOPED_BUCKETS = 120;

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

// 纪录作用域键：难度 + 赛道 + 变体。反向和镜像的最优线路与正向完全不同，
// 长短赛道的用时也不可比，因此三者必须各记一份，否则短图成绩会永久压住长图。
export function recordScopeKey(difficulty, trackId, variant) {
  return `${normalizeDifficulty(difficulty)}:${validTrackId(trackId) ? trackId : 'unknown'}:${normalizeTrackVariant(variant)}`;
}

function normalizeScoped(value) {
  if (!value || typeof value !== 'object') return {};
  const scoped = {};
  let count = 0;
  for (const [key, record] of Object.entries(value)) {
    if (count >= MAX_SCOPED_BUCKETS) break;
    // 键必须是 难度:赛道:变体 三段，且首尾两段能被规范化回自身，否则丢弃。
    const parts = String(key).split(':');
    if (parts.length !== 3) continue;
    const [difficulty, trackId, variant] = parts;
    if (normalizeDifficulty(difficulty) !== difficulty) continue;
    if (normalizeTrackVariant(variant) !== variant) continue;
    if (!validTrackId(trackId)) continue;
    scoped[key] = normalizeDifficultyRecord(record);
    count += 1;
  }
  return scoped;
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
    // 老存档没有赛道信息，无法把既有纪录归属到某张图，硬塞给任何一张都是伪造。
    // 因此聚合字段原样保留（成就与生涯统计仍读它），按图纪录从空开始累积。
    scoped: normalizeScoped(value?.scoped),
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

function pickModeBest(bucket, mode) {
  if (mode === 'timeTrial') return bucket.timeTrialBest;
  if (mode === 'drift') return bucket.driftBest;
  if (mode === 'items') return bucket.itemBest;
  if (mode === 'kart') return bucket.kartBest;
  return bucket.bestTime;
}

/**
 * 读取个人最佳。传了 trackId 就取该赛道 + 变体的纪录（正确口径）；不传则退回
 * 跨赛道聚合值，仅供老调用点与生涯统计使用。
 */
export function getModeBest(records, mode = 'race', difficulty = 'easy', trackId, variant) {
  const normalized = normalizeRaceRecords(records);
  if (validTrackId(trackId)) {
    const bucket = normalized.scoped[recordScopeKey(difficulty, trackId, variant)];
    return bucket ? pickModeBest(bucket, mode) : (mode === 'drift' ? 0 : null);
  }
  return pickModeBest(normalized.difficultyRecords[normalizeDifficulty(difficulty)], mode);
}

export function recordRaceResult(result, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  const previous = loadRaceRecords(target);
  const mode = MODES.has(result?.mode) ? result.mode : 'race';
  const difficulty = normalizeDifficulty(result?.difficulty);
  const trackId = validTrackId(result?.trackId) ? result.trackId : null;
  const variant = normalizeTrackVariant(result?.trackVariant);
  const difficultyPrevious = previous.difficultyRecords[difficulty];
  const finalTime = positiveNumber(result?.finalTime);
  const bestLapTime = positiveNumber(result?.bestLapTime);
  const skillScore = nonNegativeInteger(result?.skillScore);
  const position = positiveNumber(result?.position);

  // 破纪录一律以「该赛道 + 该变体 + 该难度」为准。没有 trackId 的调用点退回按
  // 难度聚合的老口径，保持向后兼容。
  const scopeKey = trackId ? recordScopeKey(difficulty, trackId, variant) : null;
  const scopedPrevious = scopeKey
    ? (previous.scoped[scopeKey] ?? normalizeDifficultyRecord())
    : difficultyPrevious;

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

  const winIncrement = (mode === 'race' || mode === 'items' || mode === 'kart') && position === 1 ? 1 : 0;

  const advance = (bucket) => ({
    races: bucket.races + 1,
    wins: bucket.wins + winIncrement,
    bestTime: mode === 'race' && finalTime !== null
      && (bucket.bestTime === null || finalTime < bucket.bestTime) ? finalTime : bucket.bestTime,
    bestLap: bestLapTime !== null
      && (bucket.bestLap === null || bestLapTime < bucket.bestLap) ? bestLapTime : bucket.bestLap,
    timeTrialBest: mode === 'timeTrial' && finalTime !== null
      && (bucket.timeTrialBest === null || finalTime < bucket.timeTrialBest) ? finalTime : bucket.timeTrialBest,
    driftBest: mode === 'drift' ? Math.max(bucket.driftBest, skillScore) : bucket.driftBest,
    itemBest: mode === 'items' && finalTime !== null
      && (bucket.itemBest === null || finalTime < bucket.itemBest) ? finalTime : bucket.itemBest,
    kartBest: mode === 'kart' && finalTime !== null
      && (bucket.kartBest === null || finalTime < bucket.kartBest) ? finalTime : bucket.kartBest,
  });

  const scopedRecords = advance(difficultyPrevious);
  const nextScoped = { ...previous.scoped };
  if (scopeKey && (Object.hasOwn(nextScoped, scopeKey) || Object.keys(nextScoped).length < MAX_SCOPED_BUCKETS)) {
    nextScoped[scopeKey] = advance(previous.scoped[scopeKey] ?? normalizeDifficultyRecord());
  }

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
    scoped: nextScoped,
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
    trackId,
    trackVariant: variant,
    scopeKey,
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
