import { RACE_ROUTES, gridStartProgress, positionMatchesProgress, routePoint } from './race-routes.mjs';

export const ONLINE_RACE_LAPS = 3;

export const TRACK_LENGTH_METERS = Object.freeze(Object.fromEntries(Object.entries(RACE_ROUTES).map(([id, route]) => [id, route.length])));

const MAX_VALID_SPEED_MPS = 150;
const PROGRESS_SLOP = 0.008;
const MAX_RESPAWN_BACKTRACK = 0.09;
const POSITION_SLOP_METERS = 12;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function minimumFinishTimeMs(map) {
  const length = TRACK_LENGTH_METERS[map] ?? TRACK_LENGTH_METERS.night;
  return (length * ONLINE_RACE_LAPS / MAX_VALID_SPEED_MPS) * 1000;
}

export function validateRaceState({ previous = null, message, map, trackVariant = 'normal', startProgress = gridStartProgress(), startAt, now = Date.now() }) {
  if (!Number.isFinite(startAt) || now < startAt) {
    return { accepted: false, reason: 'race_not_started' };
  }

  const sequence = Math.floor(finite(message.sequence, 0));
  if (sequence <= (previous?.sequence ?? -1)) {
    return { accepted: false, reason: 'stale_sequence' };
  }
  if (previous?.finished) {
    return { accepted: true, acceptedAt: now, state: { ...previous, sequence, sentAt: now } };
  }
  if (!['x', 'y', 'z', 'progress'].every((key) => Number.isFinite(message[key]))) {
    return { accepted: false, reason: 'invalid_fields' };
  }

  const acceptedAt = Math.max(startAt, previous?.acceptedAt ?? startAt);
  const elapsedSeconds = Math.max(1 / 60, (now - acceptedAt) / 1000);
  const trackLength = TRACK_LENGTH_METERS[map] ?? TRACK_LENGTH_METERS.night;
  const previousProgress = previous?.progress ?? 0;
  const reportedProgress = clamp(finite(message.progress), 0, ONLINE_RACE_LAPS);
  const maximumAdvance = MAX_VALID_SPEED_MPS * elapsedSeconds / trackLength + PROGRESS_SLOP;

  if (reportedProgress - previousProgress > maximumAdvance) {
    return { accepted: false, reason: 'progress_jump' };
  }

  const progress = Math.max(previousProgress - MAX_RESPAWN_BACKTRACK, reportedProgress);
  const x = clamp(finite(message.x), -1200, 1200);
  const y = clamp(finite(message.y), -40, 300);
  const z = clamp(finite(message.z), -1200, 1200);

  if (previous) {
    const distance = Math.hypot(x - previous.x, y - previous.y, z - previous.z);
    const maximumDistance = MAX_VALID_SPEED_MPS * elapsedSeconds + POSITION_SLOP_METERS;
    const isRespawn = progress < previousProgress - PROGRESS_SLOP;
    if (distance > maximumDistance && !isRespawn) {
      return { accepted: false, reason: 'position_jump' };
    }
  }

  const wantsFinish = Boolean(message.finished);
  if (wantsFinish && progress < ONLINE_RACE_LAPS - 0.01) {
    return { accepted: false, reason: 'finish_without_progress' };
  }
  if (wantsFinish && now - startAt < minimumFinishTimeMs(map)) {
    return { accepted: false, reason: 'finish_too_fast' };
  }
  const startBacktrack = previous && progress === 0 && !wantsFinish ? trackLength * MAX_RESPAWN_BACKTRACK : 0;
  if (!positionMatchesProgress(map, startProgress + progress, { x, y, z }, trackVariant, startBacktrack)) {
    return { accepted: false, reason: 'position_progress_mismatch' };
  }
  const anchor = previous ?? routePoint(map, startProgress, trackVariant);
  const distanceTravelled = (previous?.distanceTravelled ?? 0) + Math.hypot(x - anchor.x, z - anchor.z);
  // A generous lower bound tolerates shortcuts and lost packets, but not parking
  // on the finish line until the minimum timer elapses and claiming whole laps.
  if (wantsFinish && distanceTravelled < trackLength * ONLINE_RACE_LAPS * 0.25) {
    return { accepted: false, reason: 'insufficient_movement' };
  }

  const finished = Boolean(previous?.finished || wantsFinish);
  const trustedProgress = finished ? ONLINE_RACE_LAPS : progress;
  const lap = finished
    ? ONLINE_RACE_LAPS
    : Math.min(ONLINE_RACE_LAPS, Math.floor(trustedProgress) + 1);

  return {
    accepted: true,
    acceptedAt: now,
    state: {
      sequence,
      x,
      y,
      z,
      yaw: finite(message.yaw),
      speed: clamp(finite(message.speed), -30, 140),
      progress: trustedProgress,
      distanceTravelled,
      lap,
      finished,
      finishTime: finished ? previous?.finishTime ?? (now - startAt) / 1000 : null,
      sentAt: now,
    },
  };
}
