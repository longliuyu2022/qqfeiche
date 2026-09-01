import { serverOrigin, isCrossOrigin } from './server-origin.js';

export async function fetchSeasonLeaderboard({ limit = 50, signal } = {}) {
  const url = `${serverOrigin()}/multiplayer/leaderboard?limit=${Math.max(1, Math.min(50, Math.floor(limit)))}`;
  const response = await fetch(url, { signal, credentials: isCrossOrigin() ? 'include' : 'same-origin' });
  if (!response.ok) throw new Error('赛季榜暂时不可用');
  const payload = await response.json();
  return { season: payload.season || 'S1', players: Array.isArray(payload.players) ? payload.players : [] };
}
