import { randomBytes } from 'node:crypto';
import {
  mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RANK_TIERS,
  applyRaceResult,
  createDefaultRankState,
  formatRank,
  getRankTier,
  normalizeRankState,
} from '../src/ranked.js';

export const RANKED_STORE_VERSION = 1;

const LEGEND_TIER = RANK_TIERS.length - 1;
// Anonymous ids are client generated (UUID v4 by default); keep the accepted
// shape narrow so nothing weird ever reaches the JSON file or a log line.
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const DEFAULT_FLUSH_INTERVAL_MS = 4000;
const DEFAULT_DIRTY_THRESHOLD = 16;
const DEFAULT_MAX_PLAYERS = 20000;

export function isValidPlayerId(value) {
  return typeof value === 'string' && PLAYER_ID_PATTERN.test(value);
}

export function normalizePlayerId(value) {
  return isValidPlayerId(value) ? value : null;
}

export function defaultRankedFilePath() {
  return process.env.NEON_APEX_RANK_FILE
    || fileURLToPath(new URL('./data/ranked.json', import.meta.url));
}

// Linear ladder position, mirroring the ordinal used by src/ranked.js so
// matchmaking buckets and promotion/demotion detection stay in sync.
export function rankOrdinal(state) {
  const normalized = normalizeRankState(state);
  if (normalized.tier === LEGEND_TIER) return LEGEND_TIER * 3;
  return normalized.tier * 3 + (2 - normalized.division);
}

// Public view of a rank; safe to broadcast (never carries the player id).
export function describeRank(state) {
  const normalized = normalizeRankState(state);
  const tier = getRankTier(normalized);
  return {
    tier: normalized.tier,
    division: normalized.division,
    points: normalized.points,
    wins: normalized.wins,
    races: normalized.races,
    tierId: tier.id,
    tierLabel: tier.label,
    divisionLabel: tier.divisionLabel,
    ordinal: rankOrdinal(normalized),
    label: formatRank(normalized),
  };
}

function readStoredPlayers(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch {
    return new Map();
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  const players = parsed?.players;
  const entries = new Map();
  if (!players || typeof players !== 'object') return entries;
  for (const [playerId, value] of Object.entries(players)) {
    if (!isValidPlayerId(playerId)) continue;
    entries.set(playerId, normalizeRankState(value));
  }
  return entries;
}

function stateTimestamp(state) {
  return typeof state?.updatedAt === 'number' && Number.isFinite(state.updatedAt) ? state.updatedAt : 0;
}

export function createRankedStore({
  filePath = defaultRankedFilePath(),
  flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
  dirtyThreshold = DEFAULT_DIRTY_THRESHOLD,
  maxPlayers = DEFAULT_MAX_PLAYERS,
  now = () => Date.now(),
} = {}) {
  const players = readStoredPlayers(filePath);
  let dirty = 0;
  let closed = false;

  const timer = flushIntervalMs > 0
    ? setInterval(() => { flush(); }, flushIntervalMs)
    : null;
  timer?.unref?.();

  // Bound the file so a long-lived server cannot grow it without limit;
  // the least recently updated ranks are dropped first.
  function evict() {
    if (players.size <= maxPlayers) return;
    const ordered = [...players.entries()].sort((a, b) => stateTimestamp(a[1]) - stateTimestamp(b[1]));
    const excess = players.size - maxPlayers;
    for (let index = 0; index < excess; index += 1) players.delete(ordered[index][0]);
  }

  function serialize() {
    const output = {};
    for (const [playerId, state] of players) output[playerId] = { ...state };
    return { version: RANKED_STORE_VERSION, updatedAt: now(), players: output };
  }

  // Atomic on POSIX: a partially written temp file is never renamed into place,
  // so a crash mid-write leaves the previous snapshot intact.
  function flush() {
    if (!dirty) return false;
    const temporaryPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify(serialize()), 'utf8');
      renameSync(temporaryPath, filePath);
      dirty = 0;
      return true;
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // The temp file is already gone; nothing to clean up.
      }
      console.error('[ranked-store] flush failed', error?.message || error);
      return false;
    }
  }

  function get(playerId) {
    const id = normalizePlayerId(playerId);
    if (!id) return createDefaultRankState();
    const stored = players.get(id);
    return stored ? { ...stored } : createDefaultRankState();
  }

  function apply(playerId, result = {}) {
    if (closed) return null;
    const id = normalizePlayerId(playerId);
    if (!id) return null;
    const outcome = applyRaceResult(get(id), {
      position: result.position,
      totalRacers: result.totalRacers,
      finishedRace: result.finishedRace,
    }, now());
    players.set(id, outcome.state);
    evict();
    dirty += 1;
    if (dirty >= dirtyThreshold) flush();
    return outcome;
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    flush();
  }

  return {
    filePath,
    get,
    apply,
    snapshot: serialize,
    flush,
    close,
    get size() {
      return players.size;
    },
  };
}
