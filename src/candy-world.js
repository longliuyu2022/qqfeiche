import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const CANDY_COLORS = Object.freeze({
  road: 0xe56ca8,
  roadStripe: 0xffe5a8,
  mint: 0x8ee8c2,
  sky: 0xbdefff,
  cloud: 0xffffff,
  pink: 0xff75b7,
  lemon: 0xffdc65,
  violet: 0xb394ff,
  blue: 0x78c9ff,
  grass: 0x72c983,
});

const TRACK_POINTS = Object.freeze([
  [250, 0, -40], [220, 2, -170], [88, 4, -260], [-70, 3, -245],
  [-230, 1, -155], [-270, 0, 0], [-218, 2, 160], [-60, 4, 248],
  [100, 3, 236], [238, 1, 145],
]);

export const CANDY_TRACK_CURVE = new THREE.CatmullRomCurve3(
  TRACK_POINTS.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
  true,
  'catmullrom',
  0.36,
);
CANDY_TRACK_CURVE.arcLengthDivisions = 1800;

function ribbonGeometry(curve, width, samples = 520) {
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
        point.y + 0.02,
        point.z + side.z * width * direction,
      );
      uvs.push(direction < 0 ? 0 : 1, progress * 36);
    }
    if (index < samples) {
      const a = index * 2;
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

function trackFrame(progress, lateral = 0, height = 0) {
  const point = CANDY_TRACK_CURVE.getPointAt(progress);
  const tangent = CANDY_TRACK_CURVE.getTangentAt(progress).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
  return {
    point: point.addScaledVector(side, lateral).setY(point.y + height),
    tangent,
    side,
  };
}

function createLollipop(progress, color, scale = 1) {
  const frame = trackFrame(progress, 13 + scale * 2.5, 0);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34 * scale, 0.48 * scale, 6 * scale, 10),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.mint, roughness: 0.76 }),
  );
  stem.position.y = 3 * scale;
  const candy = new THREE.Mesh(
    new THREE.SphereGeometry(2.15 * scale, 18, 14),
    new THREE.MeshStandardMaterial({ color, roughness: 0.26, metalness: 0.02 }),
  );
  candy.position.y = 6.35 * scale;
  candy.userData.baseY = candy.position.y;
  candy.userData.phase = progress * 20;
  group.add(stem, candy);
  group.userData.candy = candy;
  return group;
}

function createBalloon(progress, color, height = 10) {
  const frame = trackFrame(progress, -14.5, 0);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, height, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  string.position.y = height / 2;
  const balloon = new THREE.Mesh(
    new THREE.SphereGeometry(1.35, 14, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.03 }),
  );
  balloon.scale.set(0.86, 1.16, 0.86);
  balloon.position.y = height + 1.05;
  balloon.userData.baseY = balloon.position.y;
  balloon.userData.phase = progress * 17 + 1.4;
  group.add(string, balloon);
  group.userData.balloon = balloon;
  return group;
}

function createWindmill(progress, color) {
  const frame = trackFrame(progress, 14.5, 0);
  const group = new THREE.Group();
  group.position.copy(frame.point);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.62, 7, 10),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.lemon, roughness: 0.58 }),
  );
  pole.position.y = 3.5;
  const rotor = new THREE.Group();
  rotor.position.y = 7.3;
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), new THREE.MeshBasicMaterial({ color }));
  rotor.add(hub);
  for (let index = 0; index < 4; index += 1) {
    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 2.7, 0.12),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    blade.rotation.z = index * Math.PI / 2;
    blade.position.y = 1.28;
    rotor.add(blade);
  }
  group.add(pole, rotor);
  group.userData.rotor = rotor;
  return group;
}

function createStartArch(root) {
  const group = new THREE.Group();
  const frame = trackFrame(0.002, 0, 0);
  group.position.copy(frame.point);
  group.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
  const left = new THREE.Mesh(
    new THREE.CapsuleGeometry(1.4, 8, 6, 12),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.pink, roughness: 0.32 }),
  );
  const right = left.clone();
  left.position.set(-10, 4.2, -2);
  right.position.set(10, 4.2, -2);
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(23, 2.8, 0.9),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.lemon, roughness: 0.4 }),
  );
  banner.position.set(0, 8.5, -2);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(18, 0.3, 0.94),
    new THREE.MeshBasicMaterial({ color: CANDY_COLORS.violet, toneMapped: false }),
  );
  stripe.position.set(0, 8.5, -2.48);
  group.add(left, right, banner, stripe);
  root.add(group);
}

export function createCandyWorld(scene, options = {}) {
  const qualityTier = options.qualityTier ?? 'high';
  const root = new THREE.Group();
  root.name = 'SugarBayCandyWorld';
  scene.add(root);
  scene.background = new THREE.Color(CANDY_COLORS.sky);
  scene.fog = new THREE.FogExp2(0xaee6e0, 0.00135);

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x4a8c67, 1.55);
  const sun = new THREE.DirectionalLight(0xfff2c2, 2.35);
  sun.position.set(-180, 300, 140);
  sun.castShadow = qualityTier !== 'balanced';
  root.add(hemisphere, sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1200, 1200),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.grass, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.2;
  ground.receiveShadow = true;
  root.add(ground);

  const road = new THREE.Mesh(
    ribbonGeometry(CANDY_TRACK_CURVE, 8),
    new THREE.MeshStandardMaterial({ color: CANDY_COLORS.road, roughness: 0.5, metalness: 0.02 }),
  );
  road.name = 'CandyCircuitRoad';
  road.receiveShadow = true;
  root.add(road);

  const stripes = new THREE.Mesh(
    ribbonGeometry(CANDY_TRACK_CURVE, 5.65, 420),
    new THREE.MeshBasicMaterial({ color: CANDY_COLORS.roadStripe, transparent: true, opacity: 0.18 }),
  );
  stripes.position.y = 0.035;
  root.add(stripes);

  const curbGroup = new THREE.Group();
  for (let index = 0; index < 180; index += 1) {
    const progress = index / 180;
    for (const side of [-1, 1]) {
      const frame = trackFrame(progress, side * 8.45, 0.12);
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.78, 0.34, 2.25),
        new THREE.MeshStandardMaterial({
          color: (index + (side > 0 ? 1 : 0)) % 2 ? CANDY_COLORS.pink : CANDY_COLORS.cloud,
          roughness: 0.42,
        }),
      );
      curb.position.copy(frame.point);
      curb.rotation.y = Math.atan2(frame.tangent.x, frame.tangent.z);
      curbGroup.add(curb);
    }
  }
  root.add(curbGroup);
  createStartArch(root);

  const animated = { candies: [], balloons: [], rotors: [] };
  const lollipopColors = [CANDY_COLORS.pink, CANDY_COLORS.lemon, CANDY_COLORS.violet, CANDY_COLORS.blue];
  const decorationCount = qualityTier === 'balanced' ? 12 : 20;
  for (let index = 0; index < decorationCount; index += 1) {
    const progress = (index * 0.071 + 0.045) % 1;
    const lollipop = createLollipop(progress, lollipopColors[index % lollipopColors.length], 0.8 + (index % 3) * 0.16);
    root.add(lollipop);
    animated.candies.push(lollipop.userData.candy);
    if (index % 2 === 0) {
      const balloon = createBalloon((progress + 0.028) % 1, lollipopColors[(index + 1) % lollipopColors.length], 8 + (index % 4));
      root.add(balloon);
      animated.balloons.push(balloon.userData.balloon);
    }
    if (index % 4 === 1) {
      const windmill = createWindmill((progress + 0.035) % 1, lollipopColors[(index + 2) % lollipopColors.length]);
      root.add(windmill);
      animated.rotors.push(windmill.userData.rotor);
    }
  }

  const clouds = new THREE.Group();
  const cloudMaterial = new THREE.MeshStandardMaterial({ color: CANDY_COLORS.cloud, roughness: 0.9 });
  for (let index = 0; index < 8; index += 1) {
    const cloud = new THREE.Group();
    cloud.position.set(-360 + index * 102, 72 + (index % 3) * 8, -310 + (index % 2) * 280);
    for (let puff = 0; puff < 4; puff += 1) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(9 + (puff % 2) * 4, 12, 8), cloudMaterial);
      mesh.position.set((puff - 1.5) * 8, (puff % 2) * 3, (puff % 3) * 2);
      cloud.add(mesh);
    }
    clouds.add(cloud);
  }
  root.add(clouds);
  animated.clouds = clouds;

  return {
    world: root,
    road,
    ground,
    startLine: null,
    animated,
    environmentReady: Promise.resolve(null),
    update(elapsed = 0) {
      animated.candies.forEach((candy, index) => {
        candy.position.y = candy.userData.baseY + Math.sin(elapsed * 2.1 + candy.userData.phase) * 0.24;
        candy.rotation.y = elapsed * 0.45 + candy.userData.phase;
      });
      animated.balloons.forEach((balloon, index) => {
        balloon.position.y = balloon.userData.baseY + Math.sin(elapsed * 1.3 + balloon.userData.phase) * 0.7;
        balloon.rotation.z = Math.sin(elapsed * 1.7 + index) * 0.08;
      });
      animated.rotors.forEach((rotor, index) => { rotor.rotation.z = elapsed * (1.3 + index * 0.06); });
      clouds.position.x = Math.sin(elapsed * 0.012) * 18;
      clouds.rotation.y = elapsed * 0.003;
    },
  };
}
