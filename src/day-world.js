import * as THREE from 'three';
import { attachEnvironmentHLOD } from './environment-assets.js';
import {
  CLEARANCE_EXEMPT,
  PROP_CLEARANCE,
  TERRAIN_CLEARANCE,
  createClearanceField,
  createShortcutMask,
  horizontalRadius,
  markClearanceExempt,
} from './scenic-worlds.js';

const UP = new THREE.Vector3(0, 1, 0);
const DAY_COLORS = Object.freeze({
  road: 0x333a3c,
  shoulder: 0xd6d0bd,
  grass: 0x477a3c,
  field: 0x8ba84f,
  curbRed: 0xd64b3f,
  curbWhite: 0xf2ead8,
});
const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
const textureLoader = new THREE.TextureLoader();
const dayTexturePromises = new Map();

function createDayEnvironmentHLOD(root, qualityTier, clearance, options) {
  const placements = [];
  const addTrackside = (kind, progress, direction, radius, distance, scale, yOffset = 0, rotationOffset = 0) => {
    const point = DAY_TRACK_CURVE.getPointAt(progress);
    const tangent = DAY_TRACK_CURVE.getTangentAt(progress).normalize();
    const side = new THREE.Vector3().crossVectors(UP, tangent).setY(0).normalize();
    const outward = direction ?? clearance.outwardSign(point, side);
    const candidate = clearance.place((attempt) => ({
      x: point.x + side.x * outward * (clearance.requiredDistance(radius, TERRAIN_CLEARANCE) + distance + attempt * 24),
      z: point.z + side.z * outward * (clearance.requiredDistance(radius, TERRAIN_CLEARANCE) + distance + attempt * 24),
      radius,
      clearance: TERRAIN_CLEARANCE,
    }), 5);
    if (!candidate) return;
    placements.push({
      kind,
      position: [candidate.x, point.y + yOffset, candidate.z],
      rotation: [0, Math.atan2(-tangent.z, tangent.x) + rotationOffset, 0],
      scale,
      anchor: progress,
    });
  };

  // Authored terrain breaks up the procedural horizon; fir clusters replace
  // the most noticeable cone-tree silhouettes near the racing line.
  addTrackside('mountainside', 0.23, null, 65, 44, [11, 11, 11], -4);
  addTrackside('mountainside', 0.69, null, 56, 58, [9, 9, 9], -3, Math.PI);
  addTrackside('fir', 0.12, -1, 18, 12, [7, 7, 7], -1.2, 0.4);
  addTrackside('fir', 0.49, 1, 16, 15, [6.2, 6.2, 6.2], -1.1, -0.8);
  addTrackside('fir', 0.84, -1, 15, 18, [5.8, 5.8, 5.8], -1.1, 1.7);
  return attachEnvironmentHLOD(root, qualityTier, placements, {
    name: 'SunvaleEnvironmentHLOD',
    bakedLighting: true,
    onError: options.onEnvironmentAssetError,
  });
}

function loadDayTexture(file, isColor = false) {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const url = `${BASE_URL}/assets/environment/polyhaven/asphalt_02/${file}`;
  if (!dayTexturePromises.has(url)) {
    dayTexturePromises.set(url, new Promise((resolve) => {
      textureLoader.load(url, resolve, undefined, () => resolve(null));
    }));
  }
  return dayTexturePromises.get(url).then((source) => {
    if (!source) return null;
    const texture = source.clone();
    texture.needsUpdate = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.2, 48);
    texture.anisotropy = 8;
    if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  });
}

function createDayRoadMaterial() {
  const material = new THREE.MeshStandardMaterial({
    color: DAY_COLORS.road,
    roughness: 0.72,
    metalness: 0.04,
  });
  for (const [property, file, isColor] of [
    ['map', 'diffuse.jpg', true],
    ['normalMap', 'normal-gl.jpg', false],
    ['roughnessMap', 'roughness.jpg', false],
  ]) {
    loadDayTexture(file, isColor).then((texture) => {
      if (!texture) return;
      material[property] = texture;
      if (property === 'normalMap') material.normalScale.set(0.58, 0.58);
      material.needsUpdate = true;
    });
  }
  return material;
}

export const DAY_TRACK_POINTS = Object.freeze([
  [236, 7, -42], [264, 11, -164],
  [174, 16, -276], [34, 13, -318], [-104, 8, -272], [-226, 4, -168],
  [-258, 6, -28], [-196, 11, 126], [-82, 15, 226], [74, 10, 254],
  [202, 5, 178],
]);

export const DAY_TRACK_CURVE = new THREE.CatmullRomCurve3(
  DAY_TRACK_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  'catmullrom',
  0.34,
);
DAY_TRACK_CURVE.arcLengthDivisions = 1600;

function seededRandom(seed = 82471) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function ribbonGeometry(curve, width, yOffset = 0, samples = 520) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent).normalize();
    side.crossVectors(UP, tangent).setY(0).normalize();
    for (const direction of [-1, 1]) {
      positions.push(
        point.x + side.x * width * direction,
        point.y + yOffset,
        point.z + side.z * width * direction,
      );
      uvs.push(direction < 0 ? 0 : 1, t * 42);
    }
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createGround(root, random, clearance, qualityTier) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1300, 1300, 1, 1),
    new THREE.MeshStandardMaterial({ color: DAY_COLORS.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  ground.receiveShadow = true;
  markClearanceExempt(ground, CLEARANCE_EXEMPT.TERRAIN);
  root.add(ground);

  const fieldMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x789b43, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0xb0aa55, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x5d8f47, roughness: 1 }),
  ];
  const fieldCount = qualityTier === 'balanced' ? 16 : qualityTier === 'ultra' ? 34 : 22;
  for (let i = 0; i < fieldCount; i += 1) {
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(55 + random() * 75, 42 + random() * 82),
      fieldMaterials[i % fieldMaterials.length],
    );
    const angle = random() * Math.PI * 2;
    const radius = 300 + random() * 260;
    field.position.set(Math.cos(angle) * radius, -1.42, Math.sin(angle) * radius);
    field.rotation.set(-Math.PI / 2, 0, random() * 0.8);
    field.receiveShadow = true;
    // Crop fields are flat decals painted on the ground 5m+ below the road, so
    // they are ground surface rather than an obstacle.
    markClearanceExempt(field, CLEARANCE_EXEMPT.TERRAIN);
    root.add(field);
  }

  const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x527a48, roughness: 0.96 });
  const hillGeometry = new THREE.ConeGeometry(1, 1, 9);
  const hillCount = qualityTier === 'balanced' ? 24 : qualityTier === 'ultra' ? 50 : 34;
  const hills = new THREE.InstancedMesh(hillGeometry, hillMaterial, hillCount);
  const hillMatrix = new THREE.Matrix4();
  const hillQuaternion = new THREE.Quaternion();
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  let placedHills = 0;
  for (let i = 0; i < hillCount; i += 1) {
    // Hills ring the circuit rather than the world origin: the old ring
    // (radius 470-585) reached within a few metres of the road wherever the
    // circuit bulged out to radius 320.
    const progress = ((i + 0.5) / hillCount + (random() - 0.5) * 0.01 + 1) % 1;
    DAY_TRACK_CURVE.getPointAt(progress, point);
    DAY_TRACK_CURVE.getTangentAt(progress, tangent).normalize();
    side.crossVectors(UP, tangent).setY(0).normalize();
    const outward = clearance.outwardSign(point, side);
    const width = 55 + random() * 75;
    const height = 70 + random() * 115;
    const scale = new THREE.Vector3(width, height, width * (0.7 + random() * 0.75));
    const radius = horizontalRadius(hillGeometry, scale);
    const spread = random();
    hillQuaternion.setFromAxisAngle(UP, random() * Math.PI);
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius, TERRAIN_CLEARANCE) + spread * 90 + attempt * 40;
      return {
        x: point.x + side.x * outward * distance,
        z: point.z + side.z * outward * distance,
        radius,
        clearance: TERRAIN_CLEARANCE,
      };
    }, 5);
    if (!candidate) continue;
    hillMatrix.compose(
      new THREE.Vector3(candidate.x, height * 0.5 - 1.5, candidate.z),
      hillQuaternion,
      scale,
    );
    hills.setMatrixAt(placedHills, hillMatrix);
    placedHills += 1;
  }
  // Skipped instances are trimmed from the draw range so nothing is left
  // untransformed at the world origin.
  hills.count = placedHills;
  hills.receiveShadow = true;
  root.add(hills);
  return ground;
}

function createRoad(root) {
  const shoulder = new THREE.Mesh(
    ribbonGeometry(DAY_TRACK_CURVE, 11.3, 0.04),
    new THREE.MeshStandardMaterial({ color: DAY_COLORS.shoulder, roughness: 0.92 }),
  );
  shoulder.receiveShadow = true;
  markClearanceExempt(shoulder, CLEARANCE_EXEMPT.ROAD);
  root.add(shoulder);

  const road = new THREE.Mesh(
    ribbonGeometry(DAY_TRACK_CURVE, 8, 0.1),
    createDayRoadMaterial(),
  );
  road.receiveShadow = true;
  road.name = 'DayCircuitRoad';
  markClearanceExempt(road, CLEARANCE_EXEMPT.ROAD);
  root.add(road);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf7efd4 });
  const lineGeometry = new THREE.BoxGeometry(0.18, 0.025, 3.4);
  const lineCount = 120;
  const lines = new THREE.InstancedMesh(lineGeometry, lineMaterial, lineCount);
  const matrix = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i < lineCount; i += 1) {
    const t = i / lineCount;
    DAY_TRACK_CURVE.getPointAt(t, point);
    DAY_TRACK_CURVE.getTangentAt(t, tangent).normalize();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    matrix.compose(point.clone().add(new THREE.Vector3(0, 0.18, 0)), quaternion, new THREE.Vector3(1, 1, 1));
    lines.setMatrixAt(i, matrix);
  }
  markClearanceExempt(lines, CLEARANCE_EXEMPT.ROAD);
  root.add(lines);
  return road;
}

function createCurbsAndBarriers(root, shortcuts) {
  const curbGeometry = new THREE.BoxGeometry(0.72, 0.18, 3.6);
  const red = new THREE.MeshStandardMaterial({ color: DAY_COLORS.curbRed, roughness: 0.72 });
  const white = new THREE.MeshStandardMaterial({ color: DAY_COLORS.curbWhite, roughness: 0.74 });
  const barrierMaterial = new THREE.MeshStandardMaterial({ color: 0xcbd3cf, metalness: 0.55, roughness: 0.4 });
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const count = 190;
  const leftCurbs = new THREE.InstancedMesh(curbGeometry, red, count);
  const rightCurbs = new THREE.InstancedMesh(curbGeometry, white, count);
  const barrierGeometry = new THREE.BoxGeometry(0.14, 0.54, 3.8);
  const barriers = new THREE.InstancedMesh(barrierGeometry, barrierMaterial, count * 2);
  barriers.userData.guardrail = true;
  let barrierIndex = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / count;
    DAY_TRACK_CURVE.getPointAt(t, point);
    DAY_TRACK_CURVE.getTangentAt(t, tangent).normalize();
    side.crossVectors(UP, tangent).setY(0).normalize();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
    matrix.compose(point.clone().addScaledVector(side, -8.35).add(new THREE.Vector3(0, 0.2, 0)), quaternion, scale);
    leftCurbs.setMatrixAt(i, matrix);
    matrix.compose(point.clone().addScaledVector(side, 8.35).add(new THREE.Vector3(0, 0.2, 0)), quaternion, scale);
    rightCurbs.setMatrixAt(i, matrix);
    // A shortcut mouth leaves a gap in the barrier on the side it branches to.
    for (const direction of [-1, 1]) {
      if (shortcuts.isOpen(t, direction)) continue;
      matrix.compose(
        point.clone().addScaledVector(side, 10.6 * direction).add(new THREE.Vector3(0, 0.48, 0)),
        quaternion,
        scale,
      );
      barriers.setMatrixAt(barrierIndex, matrix);
      barrierIndex += 1;
    }
  }
  barriers.count = barrierIndex;
  leftCurbs.receiveShadow = true;
  rightCurbs.receiveShadow = true;
  markClearanceExempt(leftCurbs, CLEARANCE_EXEMPT.FURNITURE);
  markClearanceExempt(rightCurbs, CLEARANCE_EXEMPT.FURNITURE);
  markClearanceExempt(barriers, CLEARANCE_EXEMPT.FURNITURE);
  root.add(leftCurbs, rightCurbs, barriers);
}

function createTrees(root, random, clearance, qualityTier) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const leafMaterials = [0x2f713c, 0x3e8448, 0x568f42].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.38, 3.5, 7);
  const crownGeometry = new THREE.ConeGeometry(2.2, 5.8, 8);
  const count = qualityTier === 'balanced' ? 88 : qualityTier === 'ultra' ? 240 : 145;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  const crowns = leafMaterials.map((material) => new THREE.InstancedMesh(crownGeometry, material, Math.ceil(count / 3)));
  const materialIndices = [0, 0, 0];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  let placed = 0;
  for (let i = 0; i < count; i += 1) {
    const t = random();
    const point = DAY_TRACK_CURVE.getPointAt(t);
    const tangent = DAY_TRACK_CURVE.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
    const direction = random() > 0.5 ? 1 : -1;
    const spread = random();
    const scale = 0.72 + random() * 0.75;
    quaternion.setFromAxisAngle(UP, random() * Math.PI);
    // Trees used to start 13m from the centre line - closer than the road plus
    // its clearance, so crowns hung over the racing surface.
    const radius = horizontalRadius(crownGeometry, new THREE.Vector3(scale, scale, scale));
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius, PROP_CLEARANCE) + spread * 34 + attempt * 11;
      return {
        x: point.x + side.x * distance * direction,
        z: point.z + side.z * distance * direction,
        radius,
        offset: distance,
      };
    }, 6);
    if (!candidate) continue;
    const position = new THREE.Vector3(
      candidate.x,
      Math.max(-1.2, point.y - Math.min(3.5, candidate.offset * 0.07)),
      candidate.z,
    );
    matrix.compose(
      position.clone().add(new THREE.Vector3(0, 1.75 * scale, 0)),
      quaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(placed, matrix);
    const materialIndex = i % leafMaterials.length;
    matrix.compose(
      position.clone().add(new THREE.Vector3(0, 5.7 * scale, 0)),
      quaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    crowns[materialIndex].setMatrixAt(materialIndices[materialIndex], matrix);
    materialIndices[materialIndex] += 1;
    placed += 1;
  }
  trunks.count = placed;
  trunks.castShadow = true;
  crowns.forEach((crown, index) => {
    crown.count = materialIndices[index];
    crown.castShadow = true;
  });
  root.add(trunks, ...crowns);
}

function createLandmarks(root, clearance) {
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(88, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x4f9db2, roughness: 0.18, metalness: 0.05, transmission: 0.08 }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(-30, -1.25, -36);
  markClearanceExempt(lake, CLEARANCE_EXEMPT.TERRAIN);
  root.add(lake);

  const stand = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d3c5, roughness: 0.85 });
  const canopy = new THREE.MeshStandardMaterial({ color: 0x167c8f, roughness: 0.45, metalness: 0.2 });
  for (let i = 0; i < 6; i += 1) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(34, 1.4, 5.5), concrete);
    tier.position.set(0, i * 1.2, i * 2.8);
    stand.add(tier);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(38, 0.35, 13), canopy);
  roof.position.set(0, 9.5, 8);
  roof.rotation.x = -0.14;
  stand.add(roof);
  stand.position.set(27, 2.6, 41);
  stand.rotation.y = -1.34;
  // The grandstand is a fixed landmark; validated like any other prop so a
  // future route change cannot park it on the racing line.
  if (clearance.clears(stand.position.x, stand.position.z, 22, PROP_CLEARANCE)) root.add(stand);

  const arch = new THREE.Group();
  const archMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f0e6, metalness: 0.62, roughness: 0.28 });
  const headerMaterial = new THREE.MeshStandardMaterial({ color: 0x177f92, roughness: 0.35 });
  for (const x of [-10, 10]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 6, 0.8), archMaterial);
    pillar.position.set(x, 3, 0);
    arch.add(pillar);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(21.3, 1.25, 0.9), headerMaterial);
  header.position.y = 5.6;
  arch.add(header);
  const start = DAY_TRACK_CURVE.getPointAt(0.002);
  const tangent = DAY_TRACK_CURVE.getTangentAt(0.002).normalize();
  arch.position.copy(start);
  arch.rotation.y = Math.atan2(tangent.x, tangent.z);
  markClearanceExempt(arch, CLEARANCE_EXEMPT.FURNITURE);
  root.add(arch);

  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.4),
    new THREE.MeshBasicMaterial({ color: 0xf6f2e5, side: THREE.DoubleSide }),
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(tangent.x, tangent.z);
  startLine.position.copy(start);
  startLine.position.y += 0.21;
  markClearanceExempt(startLine, CLEARANCE_EXEMPT.ROAD);
  root.add(startLine);
  return startLine;
}

function createClouds(root, random, qualityTier) {
  const clouds = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const clusterCount = qualityTier === 'balanced' ? 11 : qualityTier === 'ultra' ? 26 : 18;
  const cloudMesh = new THREE.InstancedMesh(geometry, material, clusterCount * 5);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  let instance = 0;
  for (let i = 0; i < clusterCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 230 + random() * 350;
    const base = new THREE.Vector3(Math.cos(angle) * radius, 105 + random() * 75, Math.sin(angle) * radius);
    for (let puff = 0; puff < 5; puff += 1) {
      matrix.compose(
        base.clone().add(new THREE.Vector3((puff - 2) * 7, random() * 3, random() * 5)),
        quaternion,
        new THREE.Vector3(8 + random() * 6, 3 + random() * 2, 5 + random() * 3),
      );
      cloudMesh.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  clouds.add(cloudMesh);
  markClearanceExempt(clouds, CLEARANCE_EXEMPT.BACKDROP);
  root.add(clouds);
  return clouds;
}

/**
 * Builds the Sunvale day map.
 *
 * `options`:
 *   - `qualityTier`: 'balanced' | 'high' | 'ultra'; controls scene density and
 *     shadow resolution.
 *   - `shortcutZones`: optional `[{ start, end, side, halfWidth, points }]`.
 *     `start`/`end`/`side` open the barrier at a shortcut mouth (start > end
 *     wraps past the start/finish line, side 1 = positive lateral). `points`
 *     plus `halfWidth` reserve the branch itself as a no-scenery corridor.
 *     Omitting the option keeps the map exactly as it was.
 */
export function createDayWorld(scene, options = {}) {
  const qualityTier = options.qualityTier === 'balanced' ? 'balanced' : options.qualityTier === 'ultra' ? 'ultra' : 'high';
  const shortcuts = createShortcutMask(options.shortcutZones);
  const clearance = createClearanceField(DAY_TRACK_CURVE, { shortcutZones: options.shortcutZones });
  const random = seededRandom();
  const world = new THREE.Group();
  world.name = 'SunvaleDayWorld';
  scene.background = new THREE.Color(0x91cce4);
  scene.fog = new THREE.FogExp2(0xa8d2dc, 0.00085);
  scene.add(world);

  const hemisphere = new THREE.HemisphereLight(0xd9f2ff, 0x44633c, 2.7);
  const sun = new THREE.DirectionalLight(0xfff0cf, 4.1);
  sun.position.set(-210, 330, 110);
  sun.castShadow = true;
  const shadowSize = qualityTier === 'balanced' ? 1024 : qualityTier === 'ultra' ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 780;
  sun.shadow.bias = -0.00025;
  world.add(hemisphere, sun);

  const ground = createGround(world, random, clearance, qualityTier);
  const road = createRoad(world);
  createCurbsAndBarriers(world, shortcuts);
  createTrees(world, random, clearance, qualityTier);
  const startLine = createLandmarks(world, clearance);
  const clouds = createClouds(world, random, qualityTier);
  const environmentReady = createDayEnvironmentHLOD(world, qualityTier, clearance, options);

  return {
    world,
    road,
    ground,
    startLine,
    districts: { valley: world, lake: world.getObjectByName('SunvaleLake') },
    animated: { clouds },
    environmentReady,
    update(elapsed = 0) {
      clouds.rotation.y = elapsed * 0.0014;
    },
  };
}
