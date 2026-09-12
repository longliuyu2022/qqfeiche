import { curves } from '../scripts/generate-race-routes.mjs';
import { createTrackVariantCurve } from '../src/track-variant.js';

export function racePosition(map, progress, { index = 0, variant = 'normal' } = {}) {
  const curve = createTrackVariantCurve(curves[map], variant);
  const start = 0.002 - Math.floor(index / 2) * 0.0042;
  const point = curve.getPointAt(((start + progress) % 1 + 1) % 1);
  return { x: point.x, y: point.y + 0.05, z: point.z };
}
