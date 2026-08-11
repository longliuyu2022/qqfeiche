import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
const textureLoader = new THREE.TextureLoader();
const texturePromises = new Map();

const TRACK_POINTS = Object.freeze({
  alpine: Object.freeze([
    [222, 67, -118], [236, 94, -242],
    [128, 116, -336], [-18, 108, -354], [-150, 82, -292], [-246, 57, -178],
    [-278, 46, -34], [-218, 63, 118], [-104, 92, 222], [42, 105, 258],
    [180, 77, 192], [252, 52, 78],
  ]),
  canyon: Object.freeze([
    [262, 34, -58], [310, 58, -190],
    [232, 82, -316], [82, 76, -370], [-72, 52, -330], [-202, 28, -248],
    [-296, 24, -116], [-318, 44, 36], [-242, 76, 172], [-108, 92, 248],
    [44, 68, 274], [194, 38, 198],
  ]),
  coast: Object.freeze([
    [274, 31, -92], [326, 48, -224],
    [234, 64, -326], [78, 55, -302], [-24, 34, -186], [-156, 24, -242],
    [-292, 29, -146], [-326, 43, 24], [-246, 59, 164], [-102, 49, 238],
    [58, 39, 226], [202, 28, 138],
  ]),
});

function createCurve(points) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
    'catmullrom',
    0.38,
  );
  curve.arcLengthDivisions = 1800;
  return curve;
}

export const ALPINE_TRACK_CURVE = createCurve(TRACK_POINTS.alpine);
export const CANYON_TRACK_CURVE = createCurve(TRACK_POINTS.canyon);
export const COAST_TRACK_CURVE = createCurve(TRACK_POINTS.coast);

export const SCENIC_TRACK_CURVES = Object.freeze({
  alpine: ALPINE_TRACK_CURVE,
  canyon: CANYON_TRACK_CURVE,
  coast: COAST_TRACK_CURVE,
});

const THEMES = Object.freeze({
  alpine: Object.freeze({
    name: 'FrostpeakAlpineWorld', roadName: 'FrostpeakCircuitRoad', seed: 0xa17e2026,
    skyTop: 0x081523, skyHorizon: 0x6e93ad, fog: 0x9eb5c4, fogDensity: 0.00115,
    sun: 0xcce9ff, sunIntensity: 2.65, sunPosition: [-260, 360, -80],
    hemisphereSky: 0xcceaff, hemisphereGround: 0x253542, hemisphereIntensity: 1.75,
    ground: 0x81949b, shoulder: 0xcbd7da, rock: 0x495b67, accent: 0x5de7ff,
    curbA: 0x28b9d1, curbB: 0xecf7f7, foliage: [0x173c36, 0x215348, 0x2e6554],
    materialAsset: 'dark_rock', groundBase: -4, cloudColor: 0xd9e7ed,
  }),
  canyon: Object.freeze({
    name: 'RedMesaCanyonWorld', roadName: 'RedMesaCircuitRoad', seed: 0xca990026,
    skyTop: 0x17304a, skyHorizon: 0xf29a62, fog: 0xd99062, fogDensity: 0.00102,
    sun: 0xffd0a0, sunIntensity: 3.65, sunPosition: [-340, 190, 250],
    hemisphereSky: 0xffd5b0, hemisphereGround: 0x5d2f24, hemisphereIntensity: 1.7,
    ground: 0x9b4d32, shoulder: 0xc7794d, rock: 0x8b3f2d, accent: 0xffbd54,
    curbA: 0xf4d191, curbB: 0x552b2a, foliage: [0x526b3b, 0x6e7c43, 0x88914c],
    materialAsset: 'dark_rock', groundBase: -7, cloudColor: 0xffd8bd,
  }),
  coast: Object.freeze({
    name: 'AzureCoastWorld', roadName: 'AzureCoastCircuitRoad', seed: 0xc0457026,
    skyTop: 0x1974a5, skyHorizon: 0x9ee3ee, fog: 0xa7d9df, fogDensity: 0.00082,
    sun: 0xfff1ca, sunIntensity: 3.55, sunPosition: [-240, 330, 180],
    hemisphereSky: 0xd8f5ff, hemisphereGround: 0x315b4c, hemisphereIntensity: 1.95,
    ground: 0x49735b, shoulder: 0xd3cfb8, rock: 0x65716b, accent: 0x35e7ff,
    curbA: 0x168cb4, curbB: 0xf5f0dc, foliage: [0x174f46, 0x23715b, 0x3d8a63],
    materialAsset: 'dark_rock', groundBase: -5, cloudColor: 0xf4fbff,
  }),
});

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/* -------------------------------------------------------------------------- *
 * Shared scenery-placement helpers.
 *
 * Exported from here (instead of a new module) because every map builder -
 * day-world.js, world.js and night-districts.js - has to obey the same rule:
 * a prop may only be dropped where its horizontal footprint stays clear of the
 * WHOLE closed circuit. Measuring the distance to a single sample of the curve
 * is not enough: the tracks are loops, so the stretch that comes back around
 * later can run straight through scenery that looked fine next to its own
 * sample. That was the terrain clip-through bug - mountains were laid out on a
 * ring around the world origin (radius 430-675, half width up to 160) while the
 * circuits themselves live between radius 188 and 405.
 *
 * The placement rule used everywhere is
 *     distanceToCurve >= TRACK_HALF_WIDTH + objectRadius + clearance
 * with `clearance` = PROP_CLEARANCE for ordinary props and TERRAIN_CLEARANCE
 * for the big terrain shapes.
 * -------------------------------------------------------------------------- */

/** Half width of the racing surface; matches the road ribbon of every map. */
export const TRACK_HALF_WIDTH = 8;
/** Breathing room for ordinary props - cars get knocked off the road a lot. */
export const PROP_CLEARANCE = 12;
/** Extra room for mountains, hills and cliffs: unmissable if you hit one. */
export const TERRAIN_CLEARANCE = 20;

const footprintCache = new WeakMap();

/**
 * Convex hull of a geometry's vertices projected onto the XZ plane, cached per
 * geometry. A hull instead of a bounding box matters for the round shapes -
 * a mountain's box corner sits 25% further out than any actual vertex, which
 * would push scenery needlessly far from the circuit.
 */
export function geometryFootprint(geometry) {
  const cached = footprintCache.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position');
  const points = [];
  if (position) {
    for (let index = 0; index < position.count; index += 1) {
      points.push([position.getX(index), position.getZ(index)]);
    }
  }
  const hull = convexHull(points);
  footprintCache.set(geometry, hull);
  return hull;
}

/** Andrew's monotone chain; returns the hull in counter-clockwise order. */
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list) => {
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
  const hull = build(sorted).concat(build(sorted.slice().reverse()));
  return hull.length >= 3 ? hull : points.slice();
}

/**
 * Horizontal radius of `geometry` once scaled: the furthest any of its vertices
 * gets from the object origin in the XZ plane. Rotation about Y (the only
 * rotation scenery gets) cannot change it, so it is a safe bound to place with,
 * and it keeps callers free of magic numbers - the mountain shape, for example,
 * reaches 1.07x its scale, so a "width 150" mountain really stretches 160m out
 * from its centre before the extra Z stretch is applied.
 */
export function horizontalRadius(geometry, scale) {
  const scaleX = Math.abs(scale.x);
  const scaleZ = Math.abs(scale.z);
  let radius = 0;
  for (const [x, z] of geometryFootprint(geometry)) {
    radius = Math.max(radius, Math.hypot(x * scaleX, z * scaleZ));
  }
  return radius;
}

/**
 * Densely samples a closed track curve once and answers the placement queries.
 * `samples` defaults to 720 (the requirement is >= 360); at ~2km per lap that is
 * a sample every ~2.8m, far finer than any prop radius we test against.
 *
 * `shortcutZones` may carry a `points` polyline (the generated shortcut branch,
 * which leaves the main centre line by up to ~48m) plus its own `halfWidth`.
 * Those branches are treated as extra corridors: scenery has to clear
 * `halfWidth + radius + clearance` from every segment of the polyline, exactly
 * like it clears the main circuit. Zones without `points` only drive guardrail
 * openings and add no corridor.
 */
export function createClearanceField(curve, options = {}) {
  const samples = options.samples ?? 720;
  const points = [];
  const centroid = new THREE.Vector3();
  for (let index = 0; index < samples; index += 1) {
    const point = curve.getPointAt(index / samples);
    points.push(point);
    centroid.add(point);
  }
  centroid.divideScalar(points.length);

  // Corridor 0 is the circuit itself (closed); the rest are shortcut branches.
  const corridors = [{ halfWidth: TRACK_HALF_WIDTH, points, closed: true }];
  for (const zone of shortcutCorridors(options.shortcutZones)) corridors.push(zone);

  const distanceToPolyline = (corridor, x, z) => {
    const list = corridor.points;
    const last = corridor.closed ? list.length : list.length - 1;
    let closest = Infinity;
    for (let index = 0; index < last; index += 1) {
      const a = list[index];
      const b = list[(index + 1) % list.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSquared = dx * dx + dz * dz;
      let t = lengthSquared > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / lengthSquared : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = x - (a.x + dx * t);
      const pz = z - (a.z + dz * t);
      const distanceSquared = px * px + pz * pz;
      if (distanceSquared < closest) closest = distanceSquared;
    }
    return Math.sqrt(closest);
  };

  const distanceTo = (x, z) => distanceToPolyline(corridors[0], x, z);
  const clears = (x, z, radius, clearance = PROP_CLEARANCE) => corridors.every(
    (corridor) => distanceToPolyline(corridor, x, z) >= corridor.halfWidth + radius + clearance,
  );

  return {
    points,
    centroid,
    corridors,
    distanceTo,
    /** Minimum distance an object of `radius` must keep from the racing line. */
    requiredDistance(radius, clearance = PROP_CLEARANCE) {
      return TRACK_HALF_WIDTH + radius + clearance;
    },
    /**
     * True when an object of `radius` centred on (x, z) misses every corridor -
     * the main circuit and any shortcut branch.
     */
    clears,
    /**
     * Sign of the side vector that points away from the loop interior, so
     * scenery can be pushed outwards instead of into the infield.
     */
    outwardSign(point, side) {
      const dot = side.x * (point.x - centroid.x) + side.z * (point.z - centroid.z);
      return dot >= 0 ? 1 : -1;
    },
    /**
     * Deterministic rejection sampling. `propose(attempt)` must build a
     * candidate `{ x, z, radius, clearance, ... }` using only the caller's
     * seeded PRNG, so the same seed always yields the same scene. Returns the
     * first candidate that clears the circuit, or null after `attempts` tries -
     * callers then skip that instance instead of looping forever.
     */
    place(propose, attempts = 10) {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const candidate = propose(attempt);
        if (!candidate) continue;
        if (clears(candidate.x, candidate.z, candidate.radius, candidate.clearance)) return candidate;
      }
      return null;
    },
  };
}

/**
 * Normalises the `points` polylines of `shortcutZones` into extra corridors.
 * Zones without points (or with fewer than two) are ignored, which is what
 * keeps the guardrail-only form of the option working.
 */
function shortcutCorridors(shortcutZones) {
  if (!Array.isArray(shortcutZones)) return [];
  const corridors = [];
  for (const zone of shortcutZones) {
    const list = Array.isArray(zone?.points) ? zone.points : null;
    if (!list || list.length < 2) continue;
    corridors.push({
      halfWidth: Number.isFinite(zone.halfWidth) ? zone.halfWidth : TRACK_HALF_WIDTH,
      points: list.map((point) => ({ x: point.x, z: point.z })),
      closed: false,
    });
  }
  return corridors;
}

/**
 * Reasons an object is allowed inside the driving corridor. Used by
 * tests/terrain-clearance.mjs as the whitelist - anything without a reason has
 * to keep clear of the road.
 */
export const CLEARANCE_EXEMPT = Object.freeze({
  ROAD: 'road-surface', // drivable ribbon, shoulders, painted markings
  FURNITURE: 'track-furniture', // curbs, rails, gantries, lamps, start arch, dock props
  TERRAIN: 'terrain-surface', // ground/water planes the circuit sits on top of
  BACKDROP: 'backdrop', // sky dome, clouds, aurora - never reachable
});

/** Tags `object` (and its children) with the reason it may sit near the road. */
export function markClearanceExempt(object, reason) {
  object.traverse((child) => {
    child.userData.clearanceExempt = reason;
  });
  return object;
}

/**
 * Guardrail openings for the shortcut system.
 *
 * `shortcutZones`: `[{ start, end, side }]` where start/end are progress values
 * along the lap (start > end wraps past the start/finish line) and `side` is
 * 1 for the positive lateral direction (the `side` vector, UP x tangent),
 * -1 for the negative one and 0/undefined for both. Barrier builders ask
 * `isOpen(progress, side)` before emitting a segment.
 *
 * With no zones - the default - `isOpen()` always returns false, so every map
 * keeps exactly the geometry it had before the shortcut system existed.
 */
export function createShortcutMask(shortcutZones) {
  const zones = (Array.isArray(shortcutZones) ? shortcutZones : [])
    .filter((zone) => zone && Number.isFinite(zone.start) && Number.isFinite(zone.end))
    .map((zone) => ({
      start: ((zone.start % 1) + 1) % 1,
      end: ((zone.end % 1) + 1) % 1,
      side: Math.sign(zone.side ?? 0),
    }));
  const covers = (zone, progress) => (zone.start <= zone.end
    ? progress >= zone.start && progress <= zone.end
    : progress >= zone.start || progress <= zone.end);
  return {
    zones,
    /** True when the barrier at `progress` on `side` should be left out. */
    isOpen(progress, side = 0) {
      if (zones.length === 0) return false;
      const wrapped = ((progress % 1) + 1) % 1;
      return zones.some((zone) => (
        (zone.side === 0 || side === 0 || zone.side === Math.sign(side)) && covers(zone, wrapped)
      ));
    },
  };
}

function createMountainGeometry(segments = 16, rings = 8) {
  const positions = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const radius = ring === rings ? 0.045 : Math.pow(1 - t, 0.92) * (0.94 + Math.sin(ring * 2.7) * 0.06);
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const variation = 1 + Math.sin(angle * 3 + ring * 1.7) * 0.09 + Math.cos(angle * 5 - ring) * 0.045;
      positions.push(
        Math.cos(angle) * radius * variation,
        t,
        Math.sin(angle) * radius * variation,
      );
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function loadTexture(asset, file, isColor = false) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const url = `${BASE_URL}/assets/environment/polyhaven/${asset}/${file}`;
  if (!texturePromises.has(url)) {
    texturePromises.set(url, new Promise((resolve) => {
      textureLoader.load(url, resolve, undefined, () => resolve(null));
    }));
  }
  return texturePromises.get(url).then((source) => {
    if (!source) return null;
    const texture = source.clone();
    texture.needsUpdate = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

function applyPbr(material, asset, repeat = [1, 1]) {
  const files = [
    ['map', 'diffuse.jpg', true],
    ['normalMap', 'normal-gl.jpg', false],
    ['roughnessMap', 'roughness.jpg', false],
  ];
  for (const [property, file, isColor] of files) {
    loadTexture(asset, file, isColor).then((texture) => {
      if (!texture) return;
      texture.repeat.set(repeat[0], repeat[1]);
      material[property] = texture;
      material.needsUpdate = true;
    });
  }
  return material;
}

function trackFrame(curve, progress, point, tangent, side) {
  curve.getPointAt(progress, point);
  curve.getTangentAt(progress, tangent).normalize();
  side.crossVectors(UP, tangent).setY(0).normalize();
  if (side.lengthSq() < 0.5) side.set(1, 0, 0);
}

function ribbonGeometry(curve, width, yOffset = 0, samples = 620) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    trackFrame(curve, progress % 1, point, tangent, side);
    for (const direction of [-1, 1]) {
      positions.push(
        point.x + side.x * width * direction,
        point.y + yOffset,
        point.z + side.z * width * direction,
      );
      uvs.push(direction < 0 ? 0 : 1, progress * 68);
    }
    if (index < samples) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function embankmentGeometry(curve, direction, samples = 420) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    trackFrame(curve, progress % 1, point, tangent, side);
    positions.push(
      point.x + side.x * 10.4 * direction,
      point.y - 0.25,
      point.z + side.z * 10.4 * direction,
      point.x + side.x * 22 * direction,
      point.y - 10.5,
      point.z + side.z * 22 * direction,
    );
    uvs.push(0, progress * 26, 1, progress * 26);
    if (index < samples) {
      const offset = index * 2;
      indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createSky(root, theme) {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1050, 40, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(theme.skyTop) },
        horizonColor: { value: new THREE.Color(theme.skyHorizon) },
        sunColor: { value: new THREE.Color(theme.sun) },
        sunDirection: { value: new THREE.Vector3(...theme.sunPosition).normalize() },
      },
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(world.xyz - cameraPosition);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        varying vec3 vWorldDirection;
        void main() {
          float height = smoothstep(-0.12, 0.72, vWorldDirection.y);
          vec3 color = mix(horizonColor, topColor, height);
          float haze = pow(max(0.0, 1.0 - abs(vWorldDirection.y) * 3.8), 4.0);
          float sun = pow(max(0.0, dot(vWorldDirection, sunDirection)), 640.0);
          float halo = pow(max(0.0, dot(vWorldDirection, sunDirection)), 18.0);
          color += sunColor * (sun * 4.5 + halo * 0.28 + haze * 0.08);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  sky.renderOrder = -100;
  markClearanceExempt(sky, CLEARANCE_EXEMPT.BACKDROP);
  root.add(sky);
  return sky;
}

function createGround(root, theme, random, qualityTier, curve, clearance) {
  const segments = qualityTier === 'balanced' ? 44 : 72;
  const geometry = new THREE.PlaneGeometry(1450, 1450, segments, segments);
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const radial = Math.hypot(x, y);
    const height = theme.groundBase
      + Math.sin(x * 0.013) * 3.2
      + Math.cos(y * 0.016) * 2.7
      + Math.sin((x + y) * 0.006) * Math.min(12, radial * 0.015);
    positions.setZ(index, height);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.98, metalness: 0.01 });
  applyPbr(material, theme.materialAsset, [18, 18]);
  const ground = new THREE.Mesh(geometry, material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = `${theme.name}Terrain`;
  markClearanceExempt(ground, CLEARANCE_EXEMPT.TERRAIN);
  root.add(ground);

  const mountainCount = qualityTier === 'balanced' ? 32 : 54;
  const mountainGeometry = createMountainGeometry(qualityTier === 'balanced' ? 14 : 18, 8);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.94, flatShading: false });
  applyPbr(rockMaterial, 'dark_rock', [2, 3]);
  const mountains = new THREE.InstancedMesh(mountainGeometry, rockMaterial, mountainCount);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const mountainTransforms = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let index = 0; index < mountainCount; index += 1) {
    // Mountains follow the circuit instead of a ring around the world origin.
    // The old ring (radius 430-675, half width up to 160m) sliced straight
    // through every scenic track, which is what buried the road in rock.
    const progress = ((index + 0.5) / mountainCount + (random() - 0.5) * 0.006) % 1;
    trackFrame(curve, (progress + 1) % 1, point, tangent, side);
    const outward = clearance.outwardSign(point, side);
    const width = 58 + random() * 92;
    const height = 90 + random() * (theme.name.includes('Alpine') ? 210 : 145);
    const scale = new THREE.Vector3(width, height, width * (0.72 + random() * 0.6));
    const radius = horizontalRadius(mountainGeometry, scale);
    const spread = random();
    quaternion.setFromAxisAngle(UP, random() * Math.PI);
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius, TERRAIN_CLEARANCE)
        + spread * 110 + attempt * 42;
      return {
        x: point.x + side.x * outward * distance,
        z: point.z + side.z * outward * distance,
        radius,
        clearance: TERRAIN_CLEARANCE,
      };
    }, 5);
    if (!candidate) continue;
    const position = new THREE.Vector3(candidate.x, theme.groundBase - 4, candidate.z);
    matrix.compose(
      position,
      quaternion,
      scale,
    );
    mountains.setMatrixAt(mountainTransforms.length, matrix);
    mountainTransforms.push({ position: position.clone(), scale: scale.clone() });
  }
  // Instances that could not find a clear spot are dropped from the draw range
  // so no giant untransformed ghost is left sitting at the world origin.
  mountains.count = mountainTransforms.length;
  mountains.castShadow = qualityTier !== 'balanced';
  mountains.receiveShadow = true;
  root.add(mountains);

  if (theme.name.includes('Alpine')) {
    const capMaterial = new THREE.MeshStandardMaterial({ color: 0xb8cbd1, roughness: 0.94, metalness: 0.01 });
    const caps = new THREE.InstancedMesh(mountainGeometry, capMaterial, mountainTransforms.length);
    for (let index = 0; index < mountainTransforms.length; index += 1) {
      const source = mountainTransforms[index];
      const capScale = source.scale.clone().multiply(new THREE.Vector3(0.28, 0.12, 0.28));
      matrix.compose(
        source.position.clone().add(new THREE.Vector3(0, source.scale.y * 0.84, 0)),
        quaternion.identity(),
        capScale,
      );
      caps.setMatrixAt(index, matrix);
    }
    caps.receiveShadow = true;
    root.add(caps);
  }
  return ground;
}

function createRoad(root, curve, theme, qualityTier, shortcuts) {
  const rockMaterial = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.9 });
  applyPbr(rockMaterial, theme.materialAsset, [2, 20]);
  for (const direction of [-1, 1]) {
    const embankment = new THREE.Mesh(embankmentGeometry(curve, direction), rockMaterial);
    embankment.receiveShadow = true;
    markClearanceExempt(embankment, CLEARANCE_EXEMPT.ROAD);
    root.add(embankment);
  }

  const shoulder = new THREE.Mesh(
    ribbonGeometry(curve, 10.6, 0.02),
    new THREE.MeshStandardMaterial({ color: theme.shoulder, roughness: 0.9 }),
  );
  shoulder.receiveShadow = true;
  markClearanceExempt(shoulder, CLEARANCE_EXEMPT.ROAD);
  root.add(shoulder);

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: theme.name.includes('Canyon') ? 0x4b4542 : 0x343b3e,
    roughness: theme.name.includes('Coast') ? 0.68 : 0.76,
    metalness: 0.08,
  });
  applyPbr(roadMaterial, 'asphalt_02', [1.35, 64]);
  roadMaterial.normalScale.set(0.65, 0.65);
  const road = new THREE.Mesh(ribbonGeometry(curve, 8, 0.11), roadMaterial);
  road.receiveShadow = true;
  road.name = theme.roadName;
  markClearanceExempt(road, CLEARANCE_EXEMPT.ROAD);
  root.add(road);

  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const markerCount = qualityTier === 'balanced' ? 94 : 132;
  const markers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 0.035, 3.7),
    new THREE.MeshStandardMaterial({ color: 0xf3f0db, emissive: 0x6f6d61, emissiveIntensity: 0.08, roughness: 0.58 }),
    markerCount,
  );
  for (let index = 0; index < markerCount; index += 1) {
    const progress = index / markerCount;
    trackFrame(curve, progress, point, tangent, side);
    quaternion.setFromUnitVectors(FORWARD, tangent);
    matrix.compose(point.clone().add(new THREE.Vector3(0, 0.2, 0)), quaternion, new THREE.Vector3(1, 1, 1));
    markers.setMatrixAt(index, matrix);
  }
  markers.receiveShadow = true;
  markClearanceExempt(markers, CLEARANCE_EXEMPT.ROAD);
  root.add(markers);

  const curbCount = qualityTier === 'balanced' ? 154 : 220;
  const curbGeometry = new THREE.BoxGeometry(0.68, 0.18, 3.35);
  const curbMaterials = [theme.curbA, theme.curbB].map((color) => (
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.04 })
  ));
  const curbMeshes = [
    new THREE.InstancedMesh(curbGeometry, curbMaterials[0], curbCount),
    new THREE.InstancedMesh(curbGeometry, curbMaterials[1], curbCount),
  ];
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0xaebbc0, metalness: 0.72, roughness: 0.32 });
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.36, 3.45), railMaterial, curbCount * 2);
  rails.userData.guardrail = true;
  let railIndex = 0;
  for (let index = 0; index < curbCount; index += 1) {
    const progress = index / curbCount;
    trackFrame(curve, progress, point, tangent, side);
    quaternion.setFromUnitVectors(FORWARD, tangent);
    for (const [slot, direction] of [-1, 1].entries()) {
      const curbPoint = point.clone().addScaledVector(side, 8.3 * direction).add(new THREE.Vector3(0, 0.22, 0));
      matrix.compose(curbPoint, quaternion, new THREE.Vector3(1, 1, 1));
      curbMeshes[(index + slot) % 2].setMatrixAt(index, matrix);
      // Shortcut mouths get an opening in the rail so the branch is drivable.
      if (shortcuts.isOpen(progress, direction)) continue;
      const railPoint = point.clone().addScaledVector(side, 9.45 * direction).add(new THREE.Vector3(0, 0.68, 0));
      matrix.compose(railPoint, quaternion, new THREE.Vector3(1, 1, 1));
      rails.setMatrixAt(railIndex, matrix);
      railIndex += 1;
    }
  }
  for (const mesh of curbMeshes) {
    mesh.castShadow = qualityTier !== 'balanced';
    mesh.receiveShadow = true;
    markClearanceExempt(mesh, CLEARANCE_EXEMPT.FURNITURE);
    root.add(mesh);
  }
  rails.count = railIndex;
  rails.castShadow = qualityTier !== 'balanced';
  rails.receiveShadow = true;
  markClearanceExempt(rails, CLEARANCE_EXEMPT.FURNITURE);
  root.add(rails);
  return road;
}

function createTracksideVegetation(root, curve, theme, random, qualityTier, kind, clearance) {
  const count = qualityTier === 'balanced' ? 92 : 190;
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: kind === 'canyon' ? 0x4a3828 : 0x40372c, roughness: 1 });
  const trunkGeometry = new THREE.CylinderGeometry(kind === 'canyon' ? 0.55 : 0.32, kind === 'canyon' ? 0.7 : 0.5, 1, 7);
  trunkGeometry.translate(0, 0.5, 0);
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  const crownGeometry = kind === 'coast'
    ? new THREE.ConeGeometry(1, 0.22, 9)
    : new THREE.ConeGeometry(1, 2.4, kind === 'canyon' ? 7 : 9);
  const crownMaterials = theme.foliage.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92, flatShading: true }));
  const crowns = crownMaterials.map((material) => new THREE.InstancedMesh(crownGeometry, material, Math.ceil(count / crownMaterials.length)));
  const crownIndices = crowns.map(() => 0);
  let placedTrunks = 0;

  for (let index = 0; index < count; index += 1) {
    const progress = random();
    trackFrame(curve, progress, point, tangent, side);
    const direction = random() > 0.5 ? 1 : -1;
    const spread = random();
    const height = kind === 'canyon' ? 4 + random() * 7 : kind === 'coast' ? 7 + random() * 8 : 8 + random() * 12;
    const drop = 1.2 + random() * 4;
    quaternion.setFromAxisAngle(UP, random() * Math.PI * 2);
    const crownScale = kind === 'coast'
      ? new THREE.Vector3(5 + random() * 4, 1, 5 + random() * 4)
      : kind === 'canyon'
        ? new THREE.Vector3(1.3 + random(), 2 + random() * 1.5, 1.3 + random())
        : new THREE.Vector3(2.5 + random() * 2, height * 0.34, 2.5 + random() * 2);
    // A tree is as wide as its crown; coastal palms reach 9m, so the old fixed
    // "18m from the centre line" start was well inside the driving corridor.
    const radius = horizontalRadius(crownGeometry, crownScale);
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius)
        + spread * (kind === 'canyon' ? 44 : 58) + attempt * 12;
      return {
        x: point.x + side.x * distance * direction,
        z: point.z + side.z * distance * direction,
        radius,
      };
    }, 6);
    if (!candidate) continue;
    const position = new THREE.Vector3(candidate.x, point.y - drop, candidate.z);
    matrix.compose(position, quaternion, new THREE.Vector3(1, height, 1));
    trunks.setMatrixAt(placedTrunks, matrix);
    placedTrunks += 1;

    const crownSlot = index % crowns.length;
    const crownPosition = position.clone().add(new THREE.Vector3(0, height * (kind === 'coast' ? 0.9 : 0.7), 0));
    matrix.compose(crownPosition, quaternion, crownScale);
    crowns[crownSlot].setMatrixAt(crownIndices[crownSlot], matrix);
    crownIndices[crownSlot] += 1;
  }
  trunks.count = placedTrunks;
  trunks.castShadow = qualityTier !== 'balanced';
  trunks.receiveShadow = true;
  root.add(trunks);
  for (const [slot, crown] of crowns.entries()) {
    crown.count = crownIndices[slot];
    crown.castShadow = qualityTier !== 'balanced';
    crown.receiveShadow = true;
    root.add(crown);
  }
}

function createRockFormations(root, curve, theme, random, qualityTier, kind, clearance) {
  const count = qualityTier === 'balanced' ? 38 : 72;
  const geometry = kind === 'canyon'
    ? new THREE.CylinderGeometry(0.72, 1, 1, 9, 3)
    : new THREE.DodecahedronGeometry(1, 1);
  geometry.translate(0, kind === 'canyon' ? 0.5 : 0, 0);
  const material = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.88, flatShading: true });
  applyPbr(material, 'dark_rock', [1.6, 2.4]);
  const rocks = new THREE.InstancedMesh(geometry, material, count);
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  let placed = 0;
  for (let index = 0; index < count; index += 1) {
    const progress = random();
    trackFrame(curve, progress, point, tangent, side);
    const direction = random() > 0.5 ? 1 : -1;
    const spread = random();
    const drop = 10 + random() * 14;
    quaternion.setFromAxisAngle(UP, random() * Math.PI * 2);
    const width = 7 + random() * (kind === 'canyon' ? 20 : 13);
    const height = kind === 'canyon' ? 20 + random() * 62 : 8 + random() * 26;
    const scale = new THREE.Vector3(width, height, width * (0.7 + random() * 0.7));
    // Rocks used to be validated against a single point of the curve, so the
    // stretch of the loop that came back around could run straight through one.
    const radius = horizontalRadius(geometry, scale);
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius, TERRAIN_CLEARANCE) + spread * 92 + attempt * 24;
      return {
        x: point.x + side.x * direction * distance,
        z: point.z + side.z * direction * distance,
        radius,
        clearance: TERRAIN_CLEARANCE,
      };
    }, 6);
    if (!candidate) continue;
    const position = new THREE.Vector3(candidate.x, point.y - drop, candidate.z);
    matrix.compose(position, quaternion, scale);
    rocks.setMatrixAt(placed, matrix);
    placed += 1;
  }
  rocks.count = placed;
  rocks.castShadow = qualityTier !== 'balanced';
  rocks.receiveShadow = true;
  root.add(rocks);
  return rocks;
}

function createStartComplex(root, curve, theme) {
  const start = curve.getPointAt(0.002);
  const tangent = curve.getTangentAt(0.002).normalize();
  const arch = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xc8d3d4, roughness: 0.24, metalness: 0.86 });
  const accent = new THREE.MeshStandardMaterial({
    color: theme.accent,
    emissive: theme.accent,
    emissiveIntensity: 1.35,
    roughness: 0.3,
    metalness: 0.45,
  });
  for (const x of [-9.5, 9.5]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 6.6, 0.8), metal);
    pillar.position.set(x, 3.3, 0);
    pillar.castShadow = true;
    arch.add(pillar);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(20, 1.3, 0.9), accent);
  header.position.y = 6.1;
  arch.add(header);
  const lower = new THREE.Mesh(new THREE.BoxGeometry(15.5, 0.12, 0.18), accent);
  lower.position.y = 4.85;
  arch.add(lower);
  arch.position.copy(start);
  arch.rotation.y = Math.atan2(tangent.x, tangent.z);
  markClearanceExempt(arch, CLEARANCE_EXEMPT.FURNITURE);
  root.add(arch);

  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xf5f2df, roughness: 0.7, side: THREE.DoubleSide }),
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(tangent.x, tangent.z);
  startLine.position.copy(start);
  startLine.position.y += 0.22;
  startLine.name = `${theme.name}StartLine`;
  markClearanceExempt(startLine, CLEARANCE_EXEMPT.ROAD);
  root.add(startLine);
  return startLine;
}

function createClouds(root, theme, random, qualityTier) {
  const clusterCount = qualityTier === 'balanced' ? 10 : 18;
  const puffCount = clusterCount * 5;
  const material = new THREE.MeshBasicMaterial({
    color: theme.cloudColor,
    transparent: true,
    opacity: theme.name.includes('Canyon') ? 0.24 : 0.53,
    depthWrite: false,
  });
  const clouds = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 7), material, puffCount);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  let index = 0;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 260 + random() * 390;
    const base = new THREE.Vector3(Math.cos(angle) * radius, 150 + random() * 90, Math.sin(angle) * radius);
    for (let puff = 0; puff < 5; puff += 1) {
      matrix.compose(
        base.clone().add(new THREE.Vector3((puff - 2) * 10, random() * 5, (random() - 0.5) * 10)),
        quaternion,
        new THREE.Vector3(12 + random() * 11, 4 + random() * 4, 8 + random() * 7),
      );
      clouds.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  markClearanceExempt(clouds, CLEARANCE_EXEMPT.BACKDROP);
  root.add(clouds);
  return clouds;
}

function createWeather(root, kind, random, qualityTier) {
  const count = qualityTier === 'balanced' ? 520 : 1100;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 920;
    positions[index * 3 + 1] = kind === 'snow' ? 20 + random() * 210 : 5 + random() * 95;
    positions[index * 3 + 2] = (random() - 0.5) * 920;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: kind === 'snow' ? 0xeef9ff : 0xe9a56f,
    size: kind === 'snow' ? 0.8 : 1.25,
    transparent: true,
    opacity: kind === 'snow' ? 0.72 : 0.16,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const weather = new THREE.Points(geometry, material);
  weather.frustumCulled = false;
  root.add(weather);
  return weather;
}

function createAurora(root) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * 0.018 + time * 0.16) * 17.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec2 vUv;
      void main() {
        float curtain = sin(vUv.x * 34.0 + time * 0.3) * 0.5 + 0.5;
        float vertical = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.68, 1.0, vUv.y));
        vec3 color = mix(vec3(0.12, 0.85, 0.68), vec3(0.28, 0.54, 1.0), curtain);
        gl_FragColor = vec4(color, vertical * (0.08 + curtain * 0.1));
      }
    `,
  });
  const aurora = new THREE.Mesh(new THREE.PlaneGeometry(760, 250, 60, 12), material);
  aurora.position.set(0, 225, -390);
  markClearanceExempt(aurora, CLEARANCE_EXEMPT.BACKDROP);
  root.add(aurora);
  return aurora;
}

function createOcean(root) {
  const material = new THREE.ShaderMaterial({
    transparent: false,
    depthWrite: true,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      varying float vWave;
      varying vec3 vPosition;
      void main() {
        vec3 p = position;
        float wave = sin(p.x * 0.025 + time * 0.65) * 0.65 + cos(p.y * 0.032 - time * 0.52) * 0.42;
        p.z += wave;
        vWave = wave;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vPosition = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      varying float vWave;
      varying vec3 vPosition;
      void main() {
        float distanceFade = smoothstep(40.0, 720.0, distance(cameraPosition, vPosition));
        vec3 deep = vec3(0.015, 0.19, 0.27);
        vec3 crest = vec3(0.12, 0.58, 0.66);
        vec3 color = mix(deep, crest, 0.28 + vWave * 0.13);
        color = mix(color, vec3(0.38, 0.72, 0.77), distanceFade * 0.28);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500, 90, 90), material);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = 0;
  ocean.name = 'AzureDynamicOcean';
  markClearanceExempt(ocean, CLEARANCE_EXEMPT.TERRAIN);
  root.add(ocean);
  return ocean;
}

function createAlpineLandmark(root, curve, theme, clearance) {
  const ice = new THREE.Mesh(
    new THREE.CircleGeometry(86, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x83c9dd, roughness: 0.18, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.12 }),
  );
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(-40, 10, -35);
  ice.name = 'FrostpeakIceLake';
  markClearanceExempt(ice, CLEARANCE_EXEMPT.TERRAIN);
  root.add(ice);

  const towerMaterial = new THREE.MeshStandardMaterial({ color: 0xabb8bc, metalness: 0.8, roughness: 0.3 });
  const cableMaterial = new THREE.LineBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.5 });
  const cablePoints = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const towerRadius = Math.hypot(0.6, 0.6);
  for (let index = 0; index < 6; index += 1) {
    const progress = 0.18 + index * 0.09;
    // The pylons used to be offset by a fixed world-space +X of 28m, which drops
    // them onto the road wherever the circuit happens to run east-west. They now
    // step out along the track normal, away from the infield.
    trackFrame(curve, progress, point, tangent, side);
    const outward = clearance.outwardSign(point, side);
    const distance = clearance.requiredDistance(towerRadius) + 6;
    const x = point.x + side.x * outward * distance;
    const z = point.z + side.z * outward * distance;
    if (!clearance.clears(x, z, towerRadius)) continue;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 20, 1.2), towerMaterial);
    tower.position.set(x, point.y + 8, z);
    tower.castShadow = true;
    root.add(tower);
    cablePoints.push(tower.position.clone().add(new THREE.Vector3(0, 10, 0)));
  }
  if (cablePoints.length > 1) {
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(cablePoints), cableMaterial));
  }
}

function createCanyonLandmark(root, theme, clearance) {
  const material = new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.9, flatShading: true });
  applyPbr(material, 'dark_rock', [2, 2]);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(30, 9, 10, 36, Math.PI), material);
  arch.rotation.z = Math.PI;
  arch.position.set(-58, 62, 70);
  arch.scale.z = 0.64;
  arch.castShadow = true;
  // Hand-placed landmarks are validated too, so a future track edit that runs
  // the circuit past them fails the clearance test instead of the player.
  if (clearance.clears(arch.position.x, arch.position.z, 39, TERRAIN_CLEARANCE)) root.add(arch);

  const monolith = new THREE.Mesh(new THREE.CylinderGeometry(12, 23, 118, 8, 4), material);
  monolith.position.set(110, 48, -168);
  monolith.castShadow = true;
  monolith.receiveShadow = true;
  if (clearance.clears(monolith.position.x, monolith.position.z, 23, TERRAIN_CLEARANCE)) root.add(monolith);
}

function createCoastLandmark(root, theme, clearance) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efe3, roughness: 0.72 });
  const red = new THREE.MeshStandardMaterial({ color: 0xc74343, roughness: 0.55 });
  const glass = new THREE.MeshStandardMaterial({ color: theme.accent, emissive: theme.accent, emissiveIntensity: 2.2, roughness: 0.18 });
  const lighthouse = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6.5, 36, 16), white);
  tower.position.y = 18;
  tower.castShadow = true;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 5, 16), red);
  stripe.position.y = 20;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(4.8, 4.8, 5.5, 16), glass);
  lantern.position.y = 39;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 4, 16), red);
  roof.position.y = 43.5;
  lighthouse.add(tower, stripe, lantern, roof);
  lighthouse.position.set(-172, 34, -44);
  // Same validation as the other hand-placed landmarks: the lighthouse only
  // goes in if its footprint stays out of the driving corridor.
  if (clearance.clears(lighthouse.position.x, lighthouse.position.z, 6.5, TERRAIN_CLEARANCE)) {
    root.add(lighthouse);
  }

  const beam = new THREE.SpotLight(theme.accent, 115, 260, 0.13, 0.5, 1.3);
  beam.position.copy(lighthouse.position).add(new THREE.Vector3(0, 39, 0));
  beam.target.position.copy(lighthouse.position).add(new THREE.Vector3(170, 20, 0));
  root.add(beam, beam.target);
  return { lighthouse, beam };
}

function addLights(root, theme, qualityTier) {
  const hemisphere = new THREE.HemisphereLight(theme.hemisphereSky, theme.hemisphereGround, theme.hemisphereIntensity);
  const sun = new THREE.DirectionalLight(theme.sun, theme.sunIntensity);
  sun.position.set(...theme.sunPosition);
  sun.castShadow = qualityTier !== 'balanced';
  const shadowSize = qualityTier === 'balanced' ? 1024 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -260;
  sun.shadow.camera.right = 260;
  sun.shadow.camera.top = 260;
  sun.shadow.camera.bottom = -260;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 850;
  sun.shadow.bias = -0.00025;
  root.add(hemisphere, sun);
  return sun;
}

/**
 * Builds one of the three scenic maps.
 *
 * `options`:
 *   - `qualityTier`: 'balanced' | 'high' (unchanged).
 *   - `shortcutZones`: optional `[{ start, end, side, halfWidth, points }]`.
 *     `start`/`end`/`side` punch an opening in the guardrail for a shortcut
 *     mouth (start > end wraps past the start/finish line, side 1 = positive
 *     lateral). `points` (the shortcut centre line, world space) plus
 *     `halfWidth` additionally reserve that branch as a no-scenery corridor.
 *     Omitting the option keeps the map exactly as it was.
 */
export function createScenicWorld(scene, trackId, options = {}) {
  const curve = SCENIC_TRACK_CURVES[trackId];
  const theme = THEMES[trackId];
  if (!curve || !theme) throw new Error(`Unknown scenic track: ${trackId}`);
  const qualityTier = options.qualityTier === 'balanced' ? 'balanced' : 'high';
  const shortcuts = createShortcutMask(options.shortcutZones);
  const clearance = createClearanceField(curve, { shortcutZones: options.shortcutZones });
  const random = seededRandom(theme.seed);
  const world = new THREE.Group();
  world.name = theme.name;
  scene.background = new THREE.Color(theme.skyHorizon);
  scene.fog = new THREE.FogExp2(theme.fog, theme.fogDensity);
  scene.add(world);

  createSky(world, theme);
  addLights(world, theme, qualityTier);
  const ground = createGround(world, theme, random, qualityTier, curve, clearance);
  const road = createRoad(world, curve, theme, qualityTier, shortcuts);
  createRockFormations(world, curve, theme, random, qualityTier, trackId, clearance);
  createTracksideVegetation(world, curve, theme, random, qualityTier, trackId, clearance);
  const startLine = createStartComplex(world, curve, theme);
  const clouds = createClouds(world, theme, random, qualityTier);
  let weather = null;
  let aurora = null;
  let ocean = null;
  let coastLandmark = null;

  if (trackId === 'alpine') {
    weather = createWeather(world, 'snow', random, qualityTier);
    aurora = createAurora(world);
    createAlpineLandmark(world, curve, theme, clearance);
  } else if (trackId === 'canyon') {
    weather = createWeather(world, 'dust', random, qualityTier);
    createCanyonLandmark(world, theme, clearance);
  } else {
    ocean = createOcean(world);
    coastLandmark = createCoastLandmark(world, theme, clearance);
  }

  return {
    world,
    road,
    ground,
    startLine,
    districts: { scenic: world },
    animated: { clouds, weather, aurora, ocean },
    update(elapsed = 0) {
      clouds.rotation.y = elapsed * (trackId === 'canyon' ? 0.0005 : 0.0012);
      if (aurora) aurora.material.uniforms.time.value = elapsed;
      if (ocean) ocean.material.uniforms.time.value = elapsed;
      if (weather) {
        const positions = weather.geometry.attributes.position;
        const fallSpeed = trackId === 'alpine' ? 4.8 : 0.25;
        for (let index = 0; index < positions.count; index += 1) {
          let y = positions.getY(index) - fallSpeed * 0.016;
          if (y < 3) y = trackId === 'alpine' ? 225 : 80;
          positions.setY(index, y);
        }
        positions.needsUpdate = true;
        weather.rotation.y = elapsed * (trackId === 'alpine' ? 0.003 : 0.008);
      }
      if (coastLandmark) {
        coastLandmark.lighthouse.rotation.y = Math.sin(elapsed * 0.08) * 0.006;
        coastLandmark.beam.target.position.x = coastLandmark.lighthouse.position.x + Math.cos(elapsed * 0.42) * 180;
        coastLandmark.beam.target.position.z = coastLandmark.lighthouse.position.z + Math.sin(elapsed * 0.42) * 180;
      }
    },
  };
}

export default createScenicWorld;
