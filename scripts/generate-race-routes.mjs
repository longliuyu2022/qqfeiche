import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TRACK_CURVE } from '../src/night-track.js';
import { DAY_TRACK_CURVE } from '../src/day-world.js';
import { SCENIC_TRACK_CURVES } from '../src/scenic-worlds.js';
import { CANDY_TRACK_CURVE } from '../src/candy-world.js';
import { CANDY_KINGDOM_TRACK_CURVE } from '../src/candy-kingdom-world.js';
import { createTrackVariantCurve } from '../src/track-variant.js';
import { computeTrackFeatures, featureZonesForPhysics } from '../src/track-features.js';

export const curves = { night: TRACK_CURVE, day: DAY_TRACK_CURVE, ...SCENIC_TRACK_CURVES, candy: CANDY_TRACK_CURVE, candyland: CANDY_KINGDOM_TRACK_CURVE };
const pointArray = (point) => [point.x, point.y, point.z].map((n) => Math.round(n * 1000) / 1000);

export function generateRaceRoutes() {
  return Object.fromEntries(Object.entries(curves).map(([id, curve]) => {
    const samples = Math.ceil(curve.getLength() / 6);
    const shortcuts = Object.fromEntries(['normal', 'reverse', 'mirror'].map((variant) => {
      const featureCurve = createTrackVariantCurve(curve, variant);
      const zones = featureZonesForPhysics(computeTrackFeatures(featureCurve, { trackId: id, roadWidth: 16 }));
      return [variant, zones.shortcuts.map((zone) => ({ ...zone, points: zone.points.map(pointArray) }))];
    }));
    return [id, { length: Math.round(curve.getLength()), points: Array.from({ length: samples + 1 }, (_, i) => pointArray(curve.getPointAt(i / samples))), shortcuts }];
  }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL('../server/race-routes.json', import.meta.url);
  const generated = `${JSON.stringify(generateRaceRoutes())}\n`;
  if (process.argv.includes('--write')) writeFileSync(target, generated);
  else if (readFileSync(target, 'utf8') !== generated) throw new Error('Race routes are stale. Run npm run routes:generate.');
  console.log('Race route data matches all seven maps and three variants.');
}
