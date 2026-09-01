import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const COLORS = Object.freeze({
  sky: 0xc8f2ff,
  grass: 0x79cf8d,
  road: 0xcf6fa7,
  roadStripe: 0xfff0bd,
  frosting: 0xfffbf3,
  pink: 0xff72b6,
  rose: 0xe9528d,
  mint: 0x82e6bd,
  lemon: 0xffdc65,
  blueberry: 0x78bfff,
  violet: 0xaa8cff,
  chocolate: 0x70402f,
  gingerbread: 0xb86c42,
});

const TRACK_POINTS = Object.freeze([
  [720, 0, -100], [650, 2, -300], [470, 5, -460], [240, 8, -520],
  [40, 5, -410], [-190, 7, -540], [-430, 3, -470], [-620, 0, -300],
  [-500, 4, -120], [-700, 2, 20], [-550, 6, 210], [-680, 3, 400],
  [-470, 5, 560], [-210, 9, 510], [20, 5, 370], [190, 8, 540],
  [430, 4, 490], [640, 1, 330], [510, 5, 150], [700, 2, 60],
]);

export const CANDY_KINGDOM_TRACK_CURVE = new THREE.CatmullRomCurve3(
  TRACK_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  'catmullrom',
  0.5,
);
CANDY_KINGDOM_TRACK_CURVE.arcLengthDivisions = 4200;

const materials = new Map();
function standardMaterial(color, options = {}) {
  const key = `${color}:${options.emissive ?? 0}:${options.roughness ?? 0.55}`;
  if (!materials.has(key)) {
    materials.set(key, new THREE.MeshStandardMaterial({
      color,
      roughness: options.roughness ?? 0.55,
      metalness: options.metalness ?? 0.01,
      emissive: options.emissive ?? 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
    }));
  }
  return materials.get(key);
}

function ribbonGeometry(curve, width, samples) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let index = 0; index <= samples; index += 1) {
    const progress = index / samples;
    curve.getPointAt(progress, point);
    curve.getTangentAt(progress, tangent).setY(0).normalize();
    side.crossVectors(UP, tangent).normalize();
    for (const direction of [-1, 1]) {
      positions.push(
        point.x + side.x * width * direction,
        point.y + 0.03,
        point.z + side.z * width * direction,
      );
      uvs.push(direction < 0 ? 0 : 1, progress * 104);
    }
    if (index < samples) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function trackFrame(progress, lateral = 0, height = 0) {
  const point = CANDY_KINGDOM_TRACK_CURVE.getPointAt(progress);
  const tangent = CANDY_KINGDOM_TRACK_CURVE.getTangentAt(progress).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
  point.addScaledVector(side, lateral);
  point.y += height;
  return { point, tangent, side };
}

function faceTrack(group, frame, lateral) {
  const towardTrack = frame.side.clone().multiplyScalar(lateral > 0 ? -1 : 1);
  group.rotation.y = Math.atan2(towardTrack.x, towardTrack.z);
}

function createCandyCottage(progress, lateral, color, scale = 1) {
  const frame = trackFrame(progress, lateral);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  group.scale.setScalar(scale);
  faceTrack(group, frame, lateral);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(11, 8, 10),
    standardMaterial(color, { roughness: 0.68 }),
  );
  body.position.y = 4;
  const icingBand = new THREE.Mesh(
    new THREE.BoxGeometry(11.5, 1.1, 10.5),
    standardMaterial(COLORS.frosting, { roughness: 0.82 }),
  );
  icingBand.position.y = 7.25;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(9.1, 6.2, 4),
    standardMaterial(COLORS.rose, { roughness: 0.48 }),
  );
  roof.position.y = 11;
  roof.rotation.y = Math.PI / 4;
  const roofIcing = new THREE.Mesh(
    new THREE.SphereGeometry(2.15, 14, 9),
    standardMaterial(COLORS.frosting, { roughness: 0.86 }),
  );
  roofIcing.scale.set(2.9, 0.48, 1.8);
  roofIcing.position.y = 10.7;

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 4.5, 0.45),
    standardMaterial(COLORS.chocolate, { roughness: 0.76 }),
  );
  door.position.set(0, 2.25, 5.18);
  const windowMaterial = standardMaterial(COLORS.lemon, {
    roughness: 0.28,
    emissive: 0xffb52e,
    emissiveIntensity: 0.55,
  });
  for (const x of [-3.25, 3.25]) {
    const window = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.7, 0.35), windowMaterial);
    window.position.set(x, 4.55, 5.2);
    group.add(window);
  }
  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.85, 5, 10),
    standardMaterial(COLORS.mint, { roughness: 0.54 }),
  );
  chimney.position.set(3.3, 12.6, -1.2);
  chimney.rotation.z = -0.08;

  group.add(body, icingBand, roof, roofIcing, door, chimney);
  group.userData.landmarkType = 'candy-cottage';
  return group;
}

function createCandyCastle(progress, lateral) {
  const frame = trackFrame(progress, lateral);
  const group = new THREE.Group();
  group.name = 'FrostingCastle';
  group.position.copy(frame.point);
  faceTrack(group, frame, lateral);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(32, 13, 20),
    standardMaterial(COLORS.frosting, { roughness: 0.68 }),
  );
  base.position.y = 6.5;
  const entrance = new THREE.Mesh(
    new THREE.CapsuleGeometry(3.1, 6, 5, 12),
    standardMaterial(COLORS.chocolate, { roughness: 0.78 }),
  );
  entrance.position.set(0, 4, 10.3);
  group.add(base, entrance);

  const flags = [];
  for (const [index, x] of [-13, 0, 13].entries()) {
    const towerHeight = index === 1 ? 22 : 18;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(index === 1 ? 6 : 5, index === 1 ? 7 : 6, towerHeight, 12),
      standardMaterial(index === 1 ? COLORS.mint : COLORS.pink, { roughness: 0.52 }),
    );
    tower.position.set(x, towerHeight / 2, 0);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(index === 1 ? 8 : 7, 9, 12),
      standardMaterial(index === 1 ? COLORS.violet : COLORS.blueberry, { roughness: 0.42 }),
    );
    roof.position.set(x, towerHeight + 4.5, 0);
    const icing = new THREE.Mesh(
      new THREE.TorusGeometry(index === 1 ? 6.6 : 5.6, 0.7, 8, 18),
      standardMaterial(COLORS.frosting, { roughness: 0.84 }),
    );
    icing.position.set(x, towerHeight + 0.6, 0);
    icing.rotation.x = Math.PI / 2;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 5, 6),
      standardMaterial(COLORS.chocolate),
    );
    pole.position.set(x, towerHeight + 11, 0);
    const flag = new THREE.Mesh(
      new THREE.BoxGeometry(3.2, 1.55, 0.12),
      standardMaterial(index % 2 ? COLORS.lemon : COLORS.rose, {
        emissive: index % 2 ? 0xb27700 : 0x7b153f,
        emissiveIntensity: 0.2,
      }),
    );
    flag.position.set(x + 1.55, towerHeight + 12.4, 0);
    flag.userData.phase = index * 1.8;
    flags.push(flag);
    group.add(tower, roof, icing, pole, flag);
  }
  group.userData.flags = flags;
  return group;
}

function createDonutGate(progress, color) {
  const frame = trackFrame(progress, 0, 0);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6.1, 1.65, 12, 32),
    standardMaterial(color, { roughness: 0.38 }),
  );
  ring.position.y = 8.3;
  const innerIcing = new THREE.Mesh(
    new THREE.TorusGeometry(6.1, 0.58, 8, 32),
    standardMaterial(COLORS.frosting, { roughness: 0.7 }),
  );
  innerIcing.position.y = 8.3;
  innerIcing.position.z = 1.5;
  const supportGeometry = new THREE.CylinderGeometry(0.7, 0.95, 7, 10);
  for (const x of [-7.5, 7.5]) {
    const support = new THREE.Mesh(supportGeometry, standardMaterial(COLORS.mint, { roughness: 0.62 }));
    support.position.set(x, 3.5, 0);
    group.add(support);
  }
  group.add(ring, innerIcing);
  group.userData.ring = ring;
  group.userData.icing = innerIcing;
  return group;
}

function createLollipop(progress, lateral, color, scale = 1) {
  const frame = trackFrame(progress, lateral);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28 * scale, 0.38 * scale, 7 * scale, 8),
    standardMaterial(COLORS.frosting, { roughness: 0.8 }),
  );
  stem.position.y = 3.5 * scale;
  const candy = new THREE.Mesh(
    new THREE.TorusGeometry(2.15 * scale, 0.72 * scale, 10, 24),
    standardMaterial(color, { roughness: 0.34 }),
  );
  candy.position.y = 7.2 * scale;
  candy.userData.baseY = candy.position.y;
  candy.userData.phase = progress * 31;
  group.add(stem, candy);
  group.userData.candy = candy;
  return group;
}

function createGumdropForest(root, qualityTier) {
  const count = qualityTier === 'balanced' ? 52 : 92;
  const geometry = new THREE.ConeGeometry(2.4, 5.6, 12);
  const mesh = new THREE.InstancedMesh(
    geometry,
    standardMaterial(COLORS.pink, { roughness: 0.58 }),
    count,
  );
  mesh.name = 'GumdropForest';
  const dummy = new THREE.Object3D();
  const colors = [COLORS.pink, COLORS.mint, COLORS.lemon, COLORS.blueberry, COLORS.violet];
  for (let index = 0; index < count; index += 1) {
    const progress = (index * 0.087 + 0.021) % 1;
    const side = index % 2 ? -1 : 1;
    const frame = trackFrame(progress, side * (29 + (index % 5) * 7), 0);
    const scale = 0.8 + (index % 4) * 0.16;
    dummy.position.copy(frame.point).add(new THREE.Vector3(0, 2.8 * scale, 0));
    dummy.scale.set(scale, scale, scale);
    dummy.rotation.y = index * 1.73;
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, new THREE.Color(colors[index % colors.length]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  root.add(mesh);
}

function createCandyBeacons(root, qualityTier) {
  const countPerSide = qualityTier === 'balanced' ? 58 : 86;
  const stemMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.22, 0.32, 7.2, 8),
    standardMaterial(COLORS.frosting, { roughness: 0.72 }),
    countPerSide * 2,
  );
  const candyMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1.25, 10, 8),
    standardMaterial(COLORS.pink, { roughness: 0.36 }),
    countPerSide * 2,
  );
  stemMesh.name = 'CandyCaneBeacons';
  candyMesh.name = 'CandyBeaconLights';
  const dummy = new THREE.Object3D();
  const colors = [COLORS.pink, COLORS.lemon, COLORS.mint, COLORS.violet, COLORS.blueberry];
  let instance = 0;
  for (let index = 0; index < countPerSide; index += 1) {
    const progress = (index + 0.5) / countPerSide;
    for (const side of [-1, 1]) {
      const frame = trackFrame(progress, side * 13.7, 0);
      dummy.position.copy(frame.point).add(new THREE.Vector3(0, 3.6, 0));
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, side * 0.05);
      dummy.updateMatrix();
      stemMesh.setMatrixAt(instance, dummy.matrix);
      stemMesh.setColorAt(instance, new THREE.Color(index % 2 ? COLORS.frosting : COLORS.mint));
      dummy.position.copy(frame.point).add(new THREE.Vector3(0, 7.45, 0));
      dummy.scale.setScalar(0.86 + (index % 3) * 0.1);
      dummy.rotation.set(0, index * 0.7, 0);
      dummy.updateMatrix();
      candyMesh.setMatrixAt(instance, dummy.matrix);
      candyMesh.setColorAt(instance, new THREE.Color(colors[(index + (side > 0 ? 2 : 0)) % colors.length]));
      instance += 1;
    }
  }
  stemMesh.instanceMatrix.needsUpdate = true;
  candyMesh.instanceMatrix.needsUpdate = true;
  if (stemMesh.instanceColor) stemMesh.instanceColor.needsUpdate = true;
  if (candyMesh.instanceColor) candyMesh.instanceColor.needsUpdate = true;
  root.add(stemMesh, candyMesh);
}

function createLayerCakeTower(progress, lateral, color) {
  const frame = trackFrame(progress, lateral);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  faceTrack(group, frame, lateral);
  const tiers = [
    { radius: 10, height: 5.4, y: 2.7 },
    { radius: 7.2, height: 5.1, y: 7.95 },
    { radius: 4.6, height: 4.8, y: 12.9 },
  ];
  for (const [index, tier] of tiers.entries()) {
    const cake = new THREE.Mesh(
      new THREE.CylinderGeometry(tier.radius, tier.radius * 1.04, tier.height, 18),
      standardMaterial(index % 2 ? COLORS.gingerbread : color, { roughness: 0.56 }),
    );
    cake.position.y = tier.y;
    const icing = new THREE.Mesh(
      new THREE.TorusGeometry(tier.radius * 0.9, 0.65, 8, 24),
      standardMaterial(COLORS.frosting, { roughness: 0.84 }),
    );
    icing.position.y = tier.y + tier.height / 2;
    icing.rotation.x = Math.PI / 2;
    group.add(cake, icing);
  }
  const candle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.45, 5, 8),
    standardMaterial(COLORS.violet, { roughness: 0.46 }),
  );
  candle.position.y = 17.7;
  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.8, 10, 8),
    standardMaterial(COLORS.lemon, { emissive: 0xff8a00, emissiveIntensity: 0.9, roughness: 0.28 }),
  );
  flame.scale.set(0.7, 1.3, 0.7);
  flame.position.y = 20.7;
  group.add(candle, flame);
  group.userData.landmarkType = 'layer-cake-tower';
  return group;
}

function createCurbs(root) {
  const segmentCount = 360;
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.82, 0.34, 4.1),
    standardMaterial(COLORS.frosting, { roughness: 0.5 }),
    segmentCount * 2,
  );
  mesh.name = 'CandyKingdomCurbs';
  const dummy = new THREE.Object3D();
  let instance = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const progress = index / segmentCount;
    for (const side of [-1, 1]) {
      const frame = trackFrame(progress, side * 8.5, 0.12);
      dummy.position.copy(frame.point);
      dummy.rotation.set(0, Math.atan2(frame.tangent.x, frame.tangent.z), 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(instance, dummy.matrix);
      mesh.setColorAt(
        instance,
        new THREE.Color((index + (side > 0 ? 1 : 0)) % 2 ? COLORS.rose : COLORS.frosting),
      );
      instance += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  root.add(mesh);
}

function createStartArch(root) {
  const frame = trackFrame(0.002);
  const group = new THREE.Group();
  group.name = 'CandyKingdomStartArch';
  group.position.copy(frame.point);
  group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  const postGeometry = new THREE.CylinderGeometry(1.2, 1.45, 9, 12);
  for (const [index, x] of [-10, 10].entries()) {
    const post = new THREE.Mesh(
      postGeometry,
      standardMaterial(index ? COLORS.mint : COLORS.pink, { roughness: 0.46 }),
    );
    post.position.set(x, 4.5, 0);
    group.add(post);
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(23, 3.2, 1.1),
    standardMaterial(COLORS.lemon, { roughness: 0.4 }),
  );
  banner.position.y = 9.2;
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(3.4, 3.8, 5),
    standardMaterial(COLORS.violet, { roughness: 0.38 }),
  );
  crown.position.y = 12.4;
  group.add(banner, crown);
  root.add(group);
}

function createChocolateLake(root) {
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(46, 48),
    new THREE.MeshStandardMaterial({
      color: COLORS.chocolate,
      roughness: 0.24,
      metalness: 0.08,
    }),
  );
  lake.name = 'ChocolateLake';
  lake.rotation.x = -Math.PI / 2;
  lake.scale.set(2.6, 1.1, 1);
  lake.position.set(0, -0.75, -45);
  root.add(lake);

  for (let index = 0; index < 9; index += 1) {
    const marshmallow = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.7, 2.2, 12),
      standardMaterial(index % 2 ? COLORS.pink : COLORS.frosting, { roughness: 0.76 }),
    );
    marshmallow.position.set(-52 + index * 13, 0.2 + (index % 2) * 0.15, -45 + Math.sin(index) * 9);
    root.add(marshmallow);
  }
}

function createFrostingMountains(root) {
  const placements = [
    [-250, -90, 74, COLORS.violet], [250, -120, 62, COLORS.blueberry],
    [-140, 100, 55, COLORS.pink], [170, 120, 68, COLORS.mint],
  ];
  for (const [x, z, height, color] of placements) {
    const mountain = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.72, height, 12),
      standardMaterial(color, { roughness: 0.8 }),
    );
    mountain.position.set(x, height / 2 - 1, z);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.39, height * 0.34, 12),
      standardMaterial(COLORS.frosting, { roughness: 0.9 }),
    );
    cap.position.set(x, height * 0.83 - 1, z);
    root.add(mountain, cap);
  }
}

function createClouds(root, qualityTier) {
  const clouds = new THREE.Group();
  clouds.name = 'CandyKingdomClouds';
  const count = qualityTier === 'balanced' ? 8 : 13;
  const cloudMaterial = standardMaterial(COLORS.frosting, { roughness: 0.94 });
  for (let index = 0; index < count; index += 1) {
    const cloud = new THREE.Group();
    cloud.position.set(-760 + index * 125, 86 + (index % 4) * 10, -630 + (index % 3) * 520);
    for (let puff = 0; puff < 4; puff += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(10 + (puff % 2) * 4, 12, 8), cloudMaterial);
      mesh.position.set((puff - 1.5) * 9, (puff % 2) * 3, (puff % 3) * 2);
      cloud.add(mesh);
    }
    clouds.add(cloud);
  }
  root.add(clouds);
  return clouds;
}

export function createCandyKingdomWorld(scene, options = {}) {
  const qualityTier = options.qualityTier ?? 'high';
  const root = new THREE.Group();
  root.name = 'CandyKingdomGrandTourWorld';
  root.userData.route = {
    controlPoints: TRACK_POINTS.length,
    expectedTurnDirectionChanges: 10,
    theme: 'candy-house-kingdom',
  };
  scene.add(root);
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.FogExp2(0xbcebdc, 0.00078);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x4f9469, 1.6);
  const sun = new THREE.DirectionalLight(0xffefc2, 2.4);
  sun.position.set(-280, 420, 190);
  sun.castShadow = qualityTier !== 'balanced';
  root.add(hemisphere, sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1900, 1600),
    standardMaterial(COLORS.grass, { roughness: 0.96 }),
  );
  ground.name = 'CandyKingdomGround';
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  ground.receiveShadow = true;
  root.add(ground);

  const road = new THREE.Mesh(
    ribbonGeometry(CANDY_KINGDOM_TRACK_CURVE, 8, 1280),
    standardMaterial(COLORS.road, { roughness: 0.5 }),
  );
  road.name = 'CandyKingdomGrandTourRoad';
  road.receiveShadow = true;
  root.add(road);

  const roadHighlight = new THREE.Mesh(
    ribbonGeometry(CANDY_KINGDOM_TRACK_CURVE, 5.7, 960),
    new THREE.MeshBasicMaterial({ color: COLORS.roadStripe, transparent: true, opacity: 0.17 }),
  );
  roadHighlight.position.y = 0.04;
  root.add(roadHighlight);

  createCurbs(root);
  createStartArch(root);
  createChocolateLake(root);
  createFrostingMountains(root);
  createGumdropForest(root, qualityTier);
  createCandyBeacons(root, qualityTier);

  const animated = { candies: [], donutGates: [], flags: [], clouds: null };
  const cottagePlacements = [
    [0.025, 27, COLORS.lemon, 1.05], [0.072, -28, COLORS.mint, 0.9],
    [0.118, 29, COLORS.pink, 0.98], [0.17, -30, COLORS.blueberry, 1.15],
    [0.218, 27, COLORS.violet, 0.94], [0.268, -29, COLORS.pink, 0.96],
    [0.32, 30, COLORS.lemon, 1.08], [0.372, -31, COLORS.violet, 1.12],
    [0.425, 28, COLORS.blueberry, 0.98], [0.475, -29, COLORS.mint, 0.92],
    [0.57, 30, COLORS.blueberry, 1.16], [0.62, -28, COLORS.lemon, 0.96],
    [0.67, 31, COLORS.pink, 1.04], [0.72, -28, COLORS.lemon, 0.94],
    [0.775, 29, COLORS.mint, 1.06], [0.825, -30, COLORS.violet, 1.13],
    [0.875, 27, COLORS.pink, 0.96], [0.925, -31, COLORS.mint, 1.02],
  ];
  for (const placement of cottagePlacements) root.add(createCandyCottage(...placement));

  const castle = createCandyCastle(0.535, 44);
  root.add(castle);
  animated.flags.push(...castle.userData.flags);

  root.add(
    createLayerCakeTower(0.205, -45, COLORS.pink),
    createLayerCakeTower(0.695, 47, COLORS.mint),
    createLayerCakeTower(0.945, -43, COLORS.blueberry),
  );

  for (const [index, progress] of [0.135, 0.425, 0.765].entries()) {
    const gate = createDonutGate(progress, [COLORS.pink, COLORS.violet, COLORS.blueberry][index]);
    root.add(gate);
    animated.donutGates.push(gate.userData.ring, gate.userData.icing);
  }

  const lollipopColors = [COLORS.pink, COLORS.lemon, COLORS.violet, COLORS.blueberry, COLORS.mint];
  const lollipopCount = qualityTier === 'balanced' ? 18 : 30;
  for (let index = 0; index < lollipopCount; index += 1) {
    const progress = (index * 0.059 + 0.018) % 1;
    const side = index % 2 ? -1 : 1;
    const lollipop = createLollipop(
      progress,
      side * (17 + (index % 3) * 3),
      lollipopColors[index % lollipopColors.length],
      0.82 + (index % 4) * 0.12,
    );
    root.add(lollipop);
    animated.candies.push(lollipop.userData.candy);
  }
  animated.clouds = createClouds(root, qualityTier);

  return {
    world: root,
    road,
    ground,
    startLine: null,
    animated,
    environmentReady: Promise.resolve(null),
    update(elapsed = 0) {
      animated.candies.forEach((candy, index) => {
        candy.position.y = candy.userData.baseY + Math.sin(elapsed * 1.7 + candy.userData.phase) * 0.28;
        candy.rotation.z = elapsed * (0.28 + (index % 4) * 0.05);
      });
      animated.donutGates.forEach((ring, index) => {
        ring.rotation.z = Math.sin(elapsed * 0.65 + index * 0.9) * 0.12;
      });
      animated.flags.forEach((flag, index) => {
        flag.rotation.y = Math.sin(elapsed * 2.2 + flag.userData.phase + index) * 0.16;
      });
      animated.clouds.position.x = Math.sin(elapsed * 0.01) * 28;
      animated.clouds.rotation.y = elapsed * 0.0015;
    },
  };
}
