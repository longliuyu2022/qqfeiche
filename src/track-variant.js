import * as THREE from 'three';
import { trackVariantRule } from './race-rules.js';

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function sourceProgress(progress, rule) {
  const normalized = wrap01(progress);
  return rule.reverse ? wrap01(1 - normalized) : normalized;
}

function transformPoint(point, rule, target) {
  target.copy(point);
  if (rule.mirror) target.x *= -1;
  return target;
}

export function createTrackVariantCurve(source, variant = 'normal') {
  if (!source?.getPointAt || !source?.getTangentAt || !source?.getLength) {
    throw new Error('Track variant requires a curve with arc-length sampling.');
  }
  const rule = trackVariantRule(variant);
  if (rule.id === 'normal') return source;
  const scratchPoint = new THREE.Vector3();
  const scratchTangent = new THREE.Vector3();
  return Object.freeze({
    variant: rule.id,
    getLength: () => source.getLength(),
    getPointAt(progress, target = new THREE.Vector3()) {
      source.getPointAt(sourceProgress(progress, rule), scratchPoint);
      return transformPoint(scratchPoint, rule, target);
    },
    getTangentAt(progress, target = new THREE.Vector3()) {
      source.getTangentAt(sourceProgress(progress, rule), scratchTangent);
      transformPoint(scratchTangent, rule, target);
      if (rule.reverse) target.multiplyScalar(-1);
      return target.normalize();
    },
    getPoint(progress, target) {
      return this.getPointAt(progress, target);
    },
    getTangent(progress, target) {
      return this.getTangentAt(progress, target);
    },
    getSpacedPoints(divisions = 5) {
      return Array.from({ length: divisions + 1 }, (_, index) => this.getPointAt(index / divisions));
    },
  });
}

export function variantWorldOptions(featureZones, variant = 'normal') {
  const rule = trackVariantRule(variant);
  const mirrorPoint = (point) => {
    const clone = point.clone?.() ?? new THREE.Vector3(point.x, point.y ?? 0, point.z);
    if (rule.mirror) clone.x *= -1;
    return clone;
  };
  const shortcuts = (featureZones?.shortcuts ?? []).map((zone) => {
    const start = rule.reverse ? 1 - zone.end : zone.start;
    const end = rule.reverse ? 1 - zone.start : zone.end;
    return {
      ...zone,
      start,
      end,
      side: rule.reverse || rule.mirror ? -zone.side : zone.side,
      points: (zone.points ?? []).map(mirrorPoint),
    };
  });
  return { shortcuts };
}

export function applyWorldVariant(world, variant = 'normal') {
  const rule = trackVariantRule(variant);
  if (world?.world && rule.mirror) {
    world.world.scale.x = -1;
    world.world.updateMatrixWorld(true);
  }
  return world;
}
