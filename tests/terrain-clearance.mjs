import assert from 'node:assert/strict';
import * as THREE from 'three';

/**
 * Terrain / scenery clearance test.
 *
 * The bug this guards against: scenery was laid out without ever measuring the
 * distance to the *whole* circuit. Mountains sat on a ring around the world
 * origin (radius 430-675, half width up to 160m) while the tracks run between
 * radius 188 and 405, so rock grew straight through the road; boulders and
 * trees were validated against a single sample of the curve, so the stretch of
 * the loop that came back around later could pass through them.
 *
 * What is asserted, for all five maps:
 *   1. no scenery footprint reaches inside the driving corridor
 *      (track half width 8m + 8m of margin), nor inside a shortcut branch
 *      corridor (branch half width + 8m) when shortcut zones are supplied;
 *   2. the maps are deterministic - two builds from the same seed are identical;
 *   3. guardrails are unchanged when `shortcutZones` is omitted or empty, and
 *      lose segments (only on the requested side) when a zone is supplied,
 *      including a zone that wraps past the start/finish line.
 *
 * Whitelist. Objects that are *meant* to sit on or beside the racing line carry
 * `userData.clearanceExempt` (set by the world builders via
 * markClearanceExempt(), see src/scenic-worlds.js):
 *
 *   'road-surface'    road ribbon, shoulders, embankments, lane paint, start
 *                     line, wet patches / skid marks
 *   'track-furniture' curbs, rails, barriers, lamps, gantries, tunnel shell,
 *                     start gantry, harbour dock props, mountain-pass walls
 *   'terrain-surface' ground, sea, ocean, lakes and crop fields - the surfaces
 *                     the circuit is built on top of
 *   'backdrop'        sky dome, clouds, aurora, moon, rain and stars
 *
 * Everything else - mountains, hills, boulders, cliffs, trees, city blocks,
 * tower shells and hand-placed landmarks - is scenery and must keep clear.
 * Only an object's own tag counts (tags are not inherited from a parent group),
 * so tagging a district cannot hide untagged scenery inside it.
 *
 * The geometry maths here is deliberately a second implementation, independent
 * of the placement helpers in src/scenic-worlds.js, so that a bug in the
 * placement rule cannot hide itself in the test.
 */

/* -------------------------------------------------------------------------- *
 * Headless canvas shim.
 *
 * src/world.js paints its asphalt/facade/signage textures on a 2D canvas at
 * module scope, so the night map cannot be built under plain node without one.
 * The shim only has to satisfy the drawing calls; nothing samples the pixels.
 * It must be installed before world.js is imported, hence the dynamic imports.
 * -------------------------------------------------------------------------- */
function createCanvasShim() {
  const gradient = { addColorStop() {} };
  const context = (canvas) => ({
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    globalCompositeOperation: 'source-over',
    beginPath() {}, closePath() {}, clearRect() {}, fill() {}, fillRect() {},
    fillText() {}, stroke() {}, strokeRect() {}, moveTo() {}, lineTo() {},
    ellipse() {}, arc() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, putImageData() {},
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createImageData: (width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    getImageData: (x, y, width, height) => ({
      data: new Uint8ClampedArray(width * height * 4), width, height,
    }),
    measureText: () => ({ width: 10 }),
  });
  const element = (tag) => {
    if (tag !== 'canvas') return { style: {}, addEventListener() {}, removeEventListener() {} };
    const canvas = { width: 256, height: 256, style: {} };
    canvas.getContext = () => context(canvas);
    return canvas;
  };
  return {
    createElement: element,
    createElementNS: (namespace, tag) => element(tag),
  };
}
if (typeof globalThis.document === 'undefined') globalThis.document = createCanvasShim();

const { createWorld, TRACK_CURVE } = await import('../src/world.js');
const { createDayWorld, DAY_TRACK_CURVE } = await import('../src/day-world.js');
const { createScenicWorld, SCENIC_TRACK_CURVES } = await import('../src/scenic-worlds.js');
const { computeTrackFeatures, featureZonesForPhysics } = await import('../src/track-features.js');

const TRACK_HALF_WIDTH = 8; // matches the road ribbon of every map
const TEST_MARGIN = 8; // scenery is placed with 12m, so 8m leaves slack
const CURVE_SAMPLES = 720; // ~2.8m apart on a 2km lap

/* -------------------------------------------------------------------------- *
 * 2D geometry helpers
 * -------------------------------------------------------------------------- */

function sampleCurve(curve, count = CURVE_SAMPLES) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const point = curve.getPointAt(index / count);
    points.push({ x: point.x, z: point.z });
  }
  return points;
}

/** Andrew's monotone chain convex hull over [x, z] pairs. */
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const stack = [];
    for (const point of list) {
      while (stack.length >= 2 && cross(stack[stack.length - 2], stack[stack.length - 1], point) <= 0) {
        stack.pop();
      }
      stack.push(point);
    }
    stack.pop();
    return stack;
  };
  const hull = half(sorted).concat(half(sorted.slice().reverse()));
  return hull.length >= 3 ? hull : points.slice();
}

const footprintCache = new WeakMap();

/** Convex hull of a geometry's vertices projected onto the ground plane. */
function geometryFootprint(geometry) {
  const cached = footprintCache.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position');
  const points = [];
  for (let index = 0; index < position.count; index += 1) {
    points.push([position.getX(index), position.getZ(index)]);
  }
  const hull = convexHull(points);
  footprintCache.set(geometry, hull);
  return hull;
}

function pointSegmentDistance(x, z, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  let t = lengthSquared > 0 ? ((x - ax) * dx + (z - az) * dz) / lengthSquared : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

function pointPolylineDistance(x, z, polyline, closed) {
  const last = closed ? polyline.length : polyline.length - 1;
  let best = Infinity;
  for (let index = 0; index < last; index += 1) {
    const a = polyline[index];
    const b = polyline[(index + 1) % polyline.length];
    best = Math.min(best, pointSegmentDistance(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/** 0 when (x, z) is inside the convex polygon, otherwise the distance to it. */
function pointPolygonDistance(x, z, polygon) {
  let inside = false;
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    best = Math.min(best, pointSegmentDistance(x, z, xi, zi, xj, zj));
  }
  return inside ? 0 : best;
}

/**
 * Exact distance between a polyline corridor and a convex footprint: for two
 * disjoint shapes the closest pair always involves a vertex of one of them, so
 * checking both directions is enough.
 */
function corridorDistance(polygon, corridor) {
  let best = Infinity;
  for (const point of corridor.points) {
    best = Math.min(best, pointPolygonDistance(point.x, point.z, polygon));
    if (best === 0) return 0;
  }
  for (const [x, z] of polygon) {
    best = Math.min(best, pointPolylineDistance(x, z, corridor.points, corridor.closed));
  }
  return best;
}

/* -------------------------------------------------------------------------- *
 * Scene scan
 * -------------------------------------------------------------------------- */

const matrix = new THREE.Matrix4();

function instanceFootprint(hull, elements) {
  return hull.map(([x, z]) => [
    elements[0] * x + elements[8] * z + elements[12],
    elements[2] * x + elements[10] * z + elements[14],
  ]);
}

/**
 * Walks every Mesh / InstancedMesh instance and measures its footprint against
 * each corridor. Lights, Points (rain, stars, snow) and Lines (cables) are not
 * solid geometry and are skipped, as is anything carrying a clearanceExempt tag.
 */
function scanWorld(root, corridors) {
  root.updateMatrixWorld(true);
  const violations = [];
  let checkedInstances = 0;
  let exemptInstances = 0;
  let worstMargin = Infinity;
  root.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) return;
    const count = object.isInstancedMesh ? object.count : 1;
    if (object.userData.clearanceExempt) {
      exemptInstances += count;
      return;
    }
    const hull = geometryFootprint(object.geometry);
    for (let index = 0; index < count; index += 1) {
      checkedInstances += 1;
      if (object.isInstancedMesh) {
        object.getMatrixAt(index, matrix);
        matrix.premultiply(object.matrixWorld);
      } else {
        matrix.copy(object.matrixWorld);
      }
      const elements = matrix.elements;
      const polygon = instanceFootprint(hull, elements);
      const originX = elements[12];
      const originZ = elements[14];
      let radius = 0;
      for (const [x, z] of polygon) radius = Math.max(radius, Math.hypot(x - originX, z - originZ));
      for (const corridor of corridors) {
        const required = corridor.halfWidth + TEST_MARGIN;
        // Broad phase: the origin cannot be closer than (distance - radius).
        const originDistance = pointPolylineDistance(originX, originZ, corridor.points, corridor.closed);
        if (originDistance - radius > required) {
          worstMargin = Math.min(worstMargin, originDistance - radius - required);
          continue;
        }
        const distance = corridorDistance(polygon, corridor);
        worstMargin = Math.min(worstMargin, distance - required);
        if (distance < required) {
          violations.push({
            corridor: corridor.name,
            object: `${object.name || '(unnamed)'}#${index} ${object.geometry.type}`
              + ` in ${object.parent?.name || 'world'}`,
            distance: Number(distance.toFixed(2)),
            required,
          });
        }
      }
    }
  });
  return { violations, checkedInstances, exemptInstances, worstMargin };
}

function mainCorridor(curve) {
  return { name: 'circuit', points: sampleCurve(curve), closed: true, halfWidth: TRACK_HALF_WIDTH };
}

function shortcutCorridors(zones) {
  return zones
    .filter((zone) => Array.isArray(zone.points) && zone.points.length > 1)
    .map((zone, index) => ({
      name: `shortcut-${index}`,
      points: zone.points.map((point) => ({ x: point.x, z: point.z })),
      closed: false,
      halfWidth: zone.halfWidth,
    }));
}

/** Guardrail segments currently drawn, i.e. the rails/barriers/walls. */
function guardrailSegments(root) {
  let segments = 0;
  root.traverse((object) => {
    if (!object.userData.guardrail) return;
    segments += object.isInstancedMesh ? object.count : 1;
  });
  return segments;
}

/** Every instance translation, for the determinism check. */
function transformDigest(root) {
  root.updateMatrixWorld(true);
  const digest = [];
  root.traverse((object) => {
    if (!object.isMesh && !object.isInstancedMesh) return;
    const count = object.isInstancedMesh ? object.count : 1;
    for (let index = 0; index < count; index += 1) {
      if (object.isInstancedMesh) object.getMatrixAt(index, matrix);
      else matrix.copy(object.matrixWorld);
      digest.push(
        Math.round(matrix.elements[12] * 1e4),
        Math.round(matrix.elements[13] * 1e4),
        Math.round(matrix.elements[14] * 1e4),
      );
    }
  });
  return digest;
}

/* -------------------------------------------------------------------------- *
 * Maps under test
 * -------------------------------------------------------------------------- */

const MAPS = [
  {
    id: 'night',
    curve: TRACK_CURVE,
    minimumChecked: 400,
    build: (options = {}) => createWorld(new THREE.Scene(), options).world,
  },
  {
    id: 'day',
    curve: DAY_TRACK_CURVE,
    minimumChecked: 200,
    build: (options = {}) => createDayWorld(new THREE.Scene(), options).world,
  },
  ...['alpine', 'canyon', 'coast'].map((trackId) => ({
    id: trackId,
    curve: SCENIC_TRACK_CURVES[trackId],
    minimumChecked: 200,
    build: (options = {}) => createScenicWorld(
      new THREE.Scene(),
      trackId,
      { qualityTier: 'high', ...options },
    ).world,
  })),
];

const summary = {};
let branchIntrudersWithoutZones = 0;

for (const map of MAPS) {
  const corridor = mainCorridor(map.curve);

  // 1. Default build: nothing but road furniture may touch the corridor.
  const world = map.build();
  const scan = scanWorld(world, [corridor]);
  assert.equal(
    scan.violations.length,
    0,
    `${map.id}: ${scan.violations.length} object(s) intrude into the driving corridor: `
    + JSON.stringify(scan.violations.slice(0, 6)),
  );
  // Guard against a vacuous pass: the map must still expose real scenery.
  assert.ok(
    scan.checkedInstances >= map.minimumChecked,
    `${map.id}: only ${scan.checkedInstances} scenery instances were checked`,
  );

  // 2. Determinism: same seed, same scene.
  assert.deepEqual(
    transformDigest(map.build()),
    transformDigest(map.build()),
    `${map.id}: two builds from the same seed must be identical`,
  );

  // 3. Guardrail openings.
  const baseline = guardrailSegments(world);
  assert.ok(baseline > 0, `${map.id}: map should build guardrails`);
  assert.equal(
    guardrailSegments(map.build({ shortcutZones: [] })),
    baseline,
    `${map.id}: an empty shortcutZones array must behave like the default`,
  );
  const opened = guardrailSegments(map.build({ shortcutZones: [{ start: 0.3, end: 0.36, side: 1 }] }));
  assert.ok(opened < baseline, `${map.id}: a shortcut zone must open the guardrail`);
  assert.ok(
    opened > baseline * 0.5,
    `${map.id}: a 6% zone on one side removed ${baseline - opened} of ${baseline} segments`,
  );
  // A zone that wraps past the start/finish line must open too.
  const wrapped = guardrailSegments(map.build({ shortcutZones: [{ start: 0.97, end: 0.03, side: -1 }] }));
  assert.ok(wrapped < baseline, `${map.id}: a wrapping shortcut zone must open the guardrail`);

  // 4. Real shortcut branches: scenery must clear the branch corridor too.
  const features = computeTrackFeatures(map.curve, { trackId: map.id });
  const zones = featureZonesForPhysics(features).shortcuts;
  assert.ok(zones.length > 0, `${map.id}: expected generated shortcut zones`);
  for (const zone of zones) {
    assert.ok(zone.points.length >= 2, `${map.id}: shortcut zone must carry a polyline`);
    assert.ok(zone.halfWidth > 0, `${map.id}: shortcut zone must carry a half width`);
  }
  const branchCorridors = shortcutCorridors(zones);
  // The branch leaves the centre line by up to ~48m, well past the props that
  // line the road, so the default build does put scenery in its way. Counting
  // those keeps the reservation honest: if this ever drops to zero on every map
  // the corridor check below would be passing for free.
  const unreserved = scanWorld(world, branchCorridors);
  branchIntrudersWithoutZones += unreserved.violations.length;
  const branchWorld = map.build({ shortcutZones: zones });
  const branchScan = scanWorld(branchWorld, [corridor, ...branchCorridors]);
  assert.equal(
    branchScan.violations.length,
    0,
    `${map.id}: ${branchScan.violations.length} object(s) intrude into a corridor with shortcuts: `
    + JSON.stringify(branchScan.violations.slice(0, 6)),
  );
  // Reserving the branch must not empty the map out.
  assert.ok(
    branchScan.checkedInstances >= scan.checkedInstances * 0.9,
    `${map.id}: shortcut corridors dropped too much scenery `
    + `(${branchScan.checkedInstances} of ${scan.checkedInstances})`,
  );
  assert.ok(
    guardrailSegments(branchWorld) < baseline,
    `${map.id}: the generated shortcut must open the guardrail`,
  );

  summary[map.id] = {
    checkedInstances: scan.checkedInstances,
    exemptInstances: scan.exemptInstances,
    clearanceMargin: Number(scan.worstMargin.toFixed(2)),
    guardrailSegments: baseline,
    guardrailWithZone: opened,
    guardrailWithShortcut: guardrailSegments(branchWorld),
    shortcutCorridors: branchCorridors.length,
    checkedWithShortcuts: branchScan.checkedInstances,
    shortcutMargin: Number(branchScan.worstMargin.toFixed(2)),
    branchIntrudersWithoutZones: unreserved.violations.length,
  };
}

assert.ok(
  branchIntrudersWithoutZones > 0,
  'shortcut corridors must actually move scenery: no map placed anything in a branch',
);

// Scenic maps also ship a reduced detail tier, which draws a different number of
// props and therefore a different random stream - it has to stay clear as well.
for (const trackId of ['alpine', 'canyon', 'coast']) {
  const world = createScenicWorld(new THREE.Scene(), trackId, { qualityTier: 'balanced' }).world;
  const scan = scanWorld(world, [mainCorridor(SCENIC_TRACK_CURVES[trackId])]);
  assert.equal(
    scan.violations.length,
    0,
    `${trackId} (balanced): ${scan.violations.length} object(s) intrude: `
    + JSON.stringify(scan.violations.slice(0, 6)),
  );
  summary[`${trackId}-balanced`] = {
    checkedInstances: scan.checkedInstances,
    clearanceMargin: Number(scan.worstMargin.toFixed(2)),
  };
}

console.log(JSON.stringify({
  corridor: { trackHalfWidth: TRACK_HALF_WIDTH, testMargin: TEST_MARGIN, curveSamples: CURVE_SAMPLES },
  maps: summary,
}));
