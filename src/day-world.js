import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DAY_COLORS = Object.freeze({
  road: 0x333a3c,
  shoulder: 0xd6d0bd,
  grass: 0x477a3c,
  field: 0x8ba84f,
  curbRed: 0xd64b3f,
  curbWhite: 0xf2ead8,
});

export const DAY_TRACK_POINTS = Object.freeze([
  [8, 2, 12], [122, 3, 38], [236, 7, -42], [264, 11, -164],
  [174, 16, -276], [34, 13, -318], [-104, 8, -272], [-226, 4, -168],
  [-258, 6, -28], [-196, 11, 126], [-82, 15, 226], [74, 10, 254],
  [202, 5, 178], [244, 2, 72],
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

function createGround(root, random) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1300, 1300, 1, 1),
    new THREE.MeshStandardMaterial({ color: DAY_COLORS.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.5;
  ground.receiveShadow = true;
  root.add(ground);

  const fieldMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x789b43, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0xb0aa55, roughness: 1 }),
    new THREE.MeshStandardMaterial({ color: 0x5d8f47, roughness: 1 }),
  ];
  for (let i = 0; i < 22; i += 1) {
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(55 + random() * 75, 42 + random() * 82),
      fieldMaterials[i % fieldMaterials.length],
    );
    const angle = random() * Math.PI * 2;
    const radius = 300 + random() * 260;
    field.position.set(Math.cos(angle) * radius, -1.42, Math.sin(angle) * radius);
    field.rotation.set(-Math.PI / 2, 0, random() * 0.8);
    field.receiveShadow = true;
    root.add(field);
  }

  const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x527a48, roughness: 0.96 });
  const hills = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 9), hillMaterial, 34);
  const hillMatrix = new THREE.Matrix4();
  const hillQuaternion = new THREE.Quaternion();
  for (let i = 0; i < 34; i += 1) {
    const angle = (i / 34) * Math.PI * 2 + random() * 0.12;
    const radius = 470 + random() * 115;
    const width = 55 + random() * 75;
    const height = 70 + random() * 115;
    hillQuaternion.setFromAxisAngle(UP, random() * Math.PI);
    hillMatrix.compose(
      new THREE.Vector3(Math.cos(angle) * radius, height * 0.5 - 1.5, Math.sin(angle) * radius),
      hillQuaternion,
      new THREE.Vector3(width, height, width * (0.7 + random() * 0.75)),
    );
    hills.setMatrixAt(i, hillMatrix);
  }
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
  root.add(shoulder);

  const road = new THREE.Mesh(
    ribbonGeometry(DAY_TRACK_CURVE, 8, 0.1),
    new THREE.MeshStandardMaterial({ color: DAY_COLORS.road, roughness: 0.78, metalness: 0.04 }),
  );
  road.receiveShadow = true;
  road.name = 'DayCircuitRoad';
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
  root.add(lines);
  return road;
}

function createCurbsAndBarriers(root) {
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
    matrix.compose(point.clone().addScaledVector(side, -10.6).add(new THREE.Vector3(0, 0.48, 0)), quaternion, scale);
    barriers.setMatrixAt(i * 2, matrix);
    matrix.compose(point.clone().addScaledVector(side, 10.6).add(new THREE.Vector3(0, 0.48, 0)), quaternion, scale);
    barriers.setMatrixAt(i * 2 + 1, matrix);
  }
  leftCurbs.receiveShadow = true;
  rightCurbs.receiveShadow = true;
  root.add(leftCurbs, rightCurbs, barriers);
}

function createTrees(root, random) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 1 });
  const leafMaterials = [0x2f713c, 0x3e8448, 0x568f42].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 }),
  );
  const trunkGeometry = new THREE.CylinderGeometry(0.25, 0.38, 3.5, 7);
  const crownGeometry = new THREE.ConeGeometry(2.2, 5.8, 8);
  const count = 145;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  const crowns = leafMaterials.map((material) => new THREE.InstancedMesh(crownGeometry, material, Math.ceil(count / 3)));
  const materialIndices = [0, 0, 0];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  for (let i = 0; i < count; i += 1) {
    const t = random();
    const point = DAY_TRACK_CURVE.getPointAt(t);
    const tangent = DAY_TRACK_CURVE.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
    const offset = (13 + random() * 42) * (random() > 0.5 ? 1 : -1);
    const position = point.clone().addScaledVector(side, offset);
    position.y = Math.max(-1.2, point.y - Math.min(3.5, Math.abs(offset) * 0.07));
    const scale = 0.72 + random() * 0.75;
    quaternion.setFromAxisAngle(UP, random() * Math.PI);
    matrix.compose(
      position.clone().add(new THREE.Vector3(0, 1.75 * scale, 0)),
      quaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(i, matrix);
    const materialIndex = i % leafMaterials.length;
    matrix.compose(
      position.clone().add(new THREE.Vector3(0, 5.7 * scale, 0)),
      quaternion,
      new THREE.Vector3(scale, scale, scale),
    );
    crowns[materialIndex].setMatrixAt(materialIndices[materialIndex], matrix);
    materialIndices[materialIndex] += 1;
  }
  trunks.castShadow = true;
  crowns.forEach((crown) => { crown.castShadow = true; });
  root.add(trunks, ...crowns);
}

function createLandmarks(root) {
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(88, 48),
    new THREE.MeshPhysicalMaterial({ color: 0x4f9db2, roughness: 0.18, metalness: 0.05, transmission: 0.08 }),
  );
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(-30, -1.25, -36);
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
  root.add(stand);

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
  root.add(arch);

  const startLine = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 2.4),
    new THREE.MeshBasicMaterial({ color: 0xf6f2e5, side: THREE.DoubleSide }),
  );
  startLine.rotation.x = -Math.PI / 2;
  startLine.rotation.z = -Math.atan2(tangent.x, tangent.z);
  startLine.position.copy(start);
  startLine.position.y += 0.21;
  root.add(startLine);
  return startLine;
}

function createClouds(root, random) {
  const clouds = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false });
  const geometry = new THREE.SphereGeometry(1, 12, 8);
  const cloudMesh = new THREE.InstancedMesh(geometry, material, 90);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  let instance = 0;
  for (let i = 0; i < 18; i += 1) {
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
  root.add(clouds);
  return clouds;
}

export function createDayWorld(scene) {
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
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -230;
  sun.shadow.camera.right = 230;
  sun.shadow.camera.top = 230;
  sun.shadow.camera.bottom = -230;
  sun.shadow.camera.near = 20;
  sun.shadow.camera.far = 780;
  sun.shadow.bias = -0.00025;
  world.add(hemisphere, sun);

  const ground = createGround(world, random);
  const road = createRoad(world);
  createCurbsAndBarriers(world);
  createTrees(world, random);
  const startLine = createLandmarks(world);
  const clouds = createClouds(world, random);

  return {
    world,
    road,
    ground,
    startLine,
    districts: { valley: world, lake: world.getObjectByName('SunvaleLake') },
    animated: { clouds },
    update(elapsed = 0) {
      clouds.rotation.y = elapsed * 0.0014;
    },
  };
}
