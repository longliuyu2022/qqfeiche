import { readFileSync } from 'node:fs';

export const RACE_ROUTES = JSON.parse(readFileSync(new URL('./race-routes.json', import.meta.url), 'utf8'));
const wrap = (value) => ((value % 1) + 1) % 1;
export const gridStartProgress = (index = 0) => wrap(0.002 - Math.floor(index / 2) * 0.0042);

function interpolate(a, b, t) {
  return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, z: a[2] + (b[2] - a[2]) * t };
}

export function routePoint(map, progress, variant = 'normal') {
  const route = RACE_ROUTES[map] ?? RACE_ROUTES.night;
  const t = wrap(variant === 'reverse' ? -progress : progress) * (route.points.length - 1);
  const index = Math.floor(t);
  const point = interpolate(route.points[index], route.points[index + 1], t - index);
  if (variant === 'mirror') point.x *= -1;
  return point;
}

const branches = new Map();
for (const [map, route] of Object.entries(RACE_ROUTES)) {
  for (const [variant, zones] of Object.entries(route.shortcuts)) {
    branches.set(`${map}:${variant}`, zones.map((zone) => {
      const lengths = zone.points.slice(1).map((p, i) => Math.hypot(p[0] - zone.points[i][0], p[2] - zone.points[i][2]));
      return { ...zone, lengths, length: lengths.reduce((a, b) => a + b, 0) };
    }));
  }
}

export function shortcutPoint(zone, progress) {
  let distance = ((progress - zone.start) / (zone.end - zone.start)) * zone.length;
  for (let i = 0; i < zone.lengths.length; i++) {
    if (distance <= zone.lengths[i] || i === zone.lengths.length - 1) {
      return interpolate(zone.points[i], zone.points[i + 1], Math.min(1, Math.max(0, distance / zone.lengths[i])));
    }
    distance -= zone.lengths[i];
  }
}

export function positionMatchesProgress(map, progress, position, variant = 'normal', backtrackMeters = 0) {
  const absolute = wrap(progress);
  const nearby = (point, width) => Math.hypot(point.x - position.x, point.z - position.z) <= width
    && Math.abs(point.y - position.y) <= 20;
  // Includes road width, grid offsets, projection error, and kart contact impulses.
  if (nearby(routePoint(map, absolute, variant), 16)) return true;
  // Client race progress is clamped at zero while reversing behind the start grid.
  const length = (RACE_ROUTES[map] ?? RACE_ROUTES.night).length;
  for (let distance = 8; distance <= backtrackMeters; distance += 8) {
    if (nearby(routePoint(map, absolute - distance / length, variant), 16)) return true;
  }
  for (const zone of branches.get(`${map}:${variant}`) ?? []) {
    if (absolute < zone.start || absolute > zone.end) continue;
    if (nearby(shortcutPoint(zone, absolute), zone.halfWidth + 6)) return true;
  }
  return false;
}
