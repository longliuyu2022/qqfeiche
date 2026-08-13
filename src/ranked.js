export const RANK_STATE_KEY = 'neon-apex:rank:v1';

export const RANK_TIERS = Object.freeze([
  Object.freeze({ id: 'bronze', label: '青铜' }),
  Object.freeze({ id: 'silver', label: '白银' }),
  Object.freeze({ id: 'gold', label: '黄金' }),
  Object.freeze({ id: 'platinum', label: '铂金' }),
  Object.freeze({ id: 'diamond', label: '钻石' }),
  Object.freeze({ id: 'stellar', label: '星耀' }),
  Object.freeze({ id: 'legend', label: '车神' }),
]);

const LEGEND_TIER = RANK_TIERS.length - 1;
const DIVISION_POINTS = 100;
const DEMOTION_SAFE_POINTS = 40;
// division: 2 = III, 1 = II, 0 = I (legend has no divisions).
const DIVISION_LABELS = Object.freeze(['I', 'II', 'III']);
// Points per finish position in a 6-racer grid; smaller grids interpolate
// linearly across this table with first/last place pinned to the endpoints.
const RACE_POINTS = Object.freeze([30, 22, 14, 6, -8, -16]);

function defaultStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function normalizeUpdatedAt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

// Linear position within the ladder; every legend state maps to the same slot.
function rankOrdinal(tier, division) {
  return tier === LEGEND_TIER ? LEGEND_TIER * 3 : tier * 3 + (2 - division);
}

function sanitizePosition(position, totalRacers) {
  const number = Number(position);
  if (!Number.isFinite(number)) return totalRacers;
  return Math.min(totalRacers, Math.max(1, Math.round(number)));
}

function pointsForRacePosition(position, totalRacers) {
  const lastIndex = RACE_POINTS.length - 1;
  if (totalRacers <= 1) return RACE_POINTS[0];
  const t = ((position - 1) * lastIndex) / (totalRacers - 1);
  const lower = Math.floor(t);
  const upper = Math.min(lastIndex, lower + 1);
  return Math.round(RACE_POINTS[lower] + (RACE_POINTS[upper] - RACE_POINTS[lower]) * (t - lower));
}

export function createDefaultRankState() {
  return {
    tier: 0,
    division: 2,
    points: 0,
    wins: 0,
    races: 0,
    bestTierReached: 0,
    updatedAt: null,
  };
}

export function normalizeRankState(value = {}) {
  const tier = clampInt(value?.tier, 0, LEGEND_TIER, 0);
  return {
    tier,
    division: tier === LEGEND_TIER ? 0 : clampInt(value?.division, 0, 2, 2),
    points: nonNegativeInteger(value?.points),
    wins: nonNegativeInteger(value?.wins),
    races: nonNegativeInteger(value?.races),
    bestTierReached: Math.max(tier, clampInt(value?.bestTierReached, 0, LEGEND_TIER, 0)),
    updatedAt: normalizeUpdatedAt(value?.updatedAt),
  };
}

// Converts the public rank snapshot returned by the multiplayer server back
// into the local persistence shape. Older servers omit bestTierReached and
// updatedAt, so retain those continuity fields from the last local snapshot.
export function rankStateFromServer(rank, fallback = createDefaultRankState()) {
  if (!rank || typeof rank !== 'object') return null;
  const base = normalizeRankState(fallback);
  const tier = clampInt(rank.tier, 0, LEGEND_TIER, base.tier);
  return normalizeRankState({
    ...base,
    tier,
    division: rank.division,
    points: rank.points,
    wins: rank.wins,
    races: rank.races,
    bestTierReached: rank.bestTierReached ?? Math.max(base.bestTierReached, tier),
    updatedAt: rank.updatedAt ?? base.updatedAt,
  });
}

export function applyRaceResult(state, result = {}, now) {
  const base = normalizeRankState(state);
  const totalRacers = clampInt(result?.totalRacers, 1, Number.MAX_SAFE_INTEGER, 6);
  const finished = result?.finishedRace !== false;
  // Quitting mid-race scores as finishing last.
  const position = finished ? sanitizePosition(result?.position, totalRacers) : totalRacers;
  const delta = pointsForRacePosition(position, totalRacers);

  let tier = base.tier;
  let division = base.division;
  let points = base.points + delta;

  // Promotions: each division holds 100 points, overflow carries forward.
  // Legend has no divisions and accumulates points without a cap.
  while (points >= DIVISION_POINTS && tier < LEGEND_TIER) {
    points -= DIVISION_POINTS;
    if (division > 0) {
      division -= 1;
    } else {
      tier += 1;
      division = tier === LEGEND_TIER ? 0 : 2;
    }
  }

  // Demotions: dropping below zero costs one division and lands on a soft
  // cushion of 40 points. Bronze III floors at 0; legend falls to Stellar I.
  if (points < 0) {
    if (tier === LEGEND_TIER) {
      tier = LEGEND_TIER - 1;
      division = 0;
      points = DEMOTION_SAFE_POINTS;
    } else if (tier === 0 && division === 2) {
      points = 0;
    } else if (division < 2) {
      division += 1;
      points = DEMOTION_SAFE_POINTS;
    } else {
      tier -= 1;
      division = 0;
      points = DEMOTION_SAFE_POINTS;
    }
  }

  const next = {
    tier,
    division,
    points,
    wins: base.wins + (finished && position === 1 ? 1 : 0),
    races: base.races + 1,
    bestTierReached: Math.max(base.bestTierReached, tier),
    updatedAt: now ?? null,
  };

  const before = rankOrdinal(base.tier, base.division);
  const after = rankOrdinal(next.tier, next.division);

  return {
    state: next,
    delta,
    promoted: after > before,
    demoted: after < before,
    divisionChanged: after !== before,
    tierChanged: next.tier !== base.tier,
    label: formatRank(next),
  };
}

export function formatRank(state) {
  const normalized = normalizeRankState(state);
  const tierInfo = RANK_TIERS[normalized.tier];
  if (normalized.tier === LEGEND_TIER) return `${tierInfo.label} · ${normalized.points}分`;
  return `${tierInfo.label} ${DIVISION_LABELS[normalized.division]} · ${normalized.points}分`;
}

export function rankProgress(state) {
  const normalized = normalizeRankState(state);
  if (normalized.tier === LEGEND_TIER) return 1;
  return Math.min(1, normalized.points / DIVISION_POINTS);
}

export function getRankTier(state) {
  const normalized = normalizeRankState(state);
  const tierInfo = RANK_TIERS[normalized.tier];
  if (normalized.tier === LEGEND_TIER) {
    return { id: tierInfo.id, label: tierInfo.label, division: null, divisionLabel: null };
  }
  return {
    id: tierInfo.id,
    label: tierInfo.label,
    division: normalized.division,
    divisionLabel: DIVISION_LABELS[normalized.division],
  };
}

export function loadRankState(storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.getItem) return createDefaultRankState();
  try {
    const stored = target.getItem(RANK_STATE_KEY);
    return stored ? normalizeRankState(JSON.parse(stored)) : createDefaultRankState();
  } catch {
    return createDefaultRankState();
  }
}

export function saveRankState(state, storage) {
  const target = storage === undefined ? defaultStorage() : storage;
  if (!target?.setItem) return false;
  try {
    target.setItem(RANK_STATE_KEY, JSON.stringify(normalizeRankState(state)));
    return true;
  } catch {
    return false;
  }
}
