import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRouteNavigator } from '../src/route-navigator.js';
import { createTrackVariantCurve, applyWorldVariant, variantWorldOptions } from '../src/track-variant.js';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 100),
  new THREE.Vector3(80, 0, 150),
  new THREE.Vector3(130, 0, 80),
  new THREE.Vector3(90, 0, 0),
], true, 'catmullrom', 0.5);

const reverse = createTrackVariantCurve(curve, 'reverse');
assert.ok(reverse.getPointAt(0).distanceTo(curve.getPointAt(0)) < 0.001);
assert.ok(reverse.getTangentAt(0).dot(curve.getTangentAt(0)) < -0.99);

const mirror = createTrackVariantCurve(curve, 'mirror');
const sourcePoint = curve.getPointAt(0.25);
const mirrorPoint = mirror.getPointAt(0.25);
assert.equal(mirrorPoint.x, -sourcePoint.x);
assert.equal(mirrorPoint.z, sourcePoint.z);

const world = { world: new THREE.Group() };
applyWorldVariant(world, 'mirror');
assert.equal(world.world.scale.x, -1);
const transformedZones = variantWorldOptions({ shortcuts: [{ start: 0.2, end: 0.3, side: 1, points: [mirrorPoint] }] }, 'reverse');
assert.equal(transformedZones.shortcuts[0].start, 0.7);
assert.equal(transformedZones.shortcuts[0].end, 0.8);
assert.equal(transformedZones.shortcuts[0].side, -1);

const navigator = createRouteNavigator(curve, { maxLookAheadMeters: 400 });
const cue = navigator.getCue(0.02);
assert.ok(cue.primary, 'a curved loop should produce an upcoming turn');
assert.ok(cue.primary.distance > 0 && cue.primary.distance <= 400);
assert.ok(['left', 'right'].includes(cue.primary.direction));

console.log(JSON.stringify({ variants: 'ok', turnGuidance: 'ok' }));
