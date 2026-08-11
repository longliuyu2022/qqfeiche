import * as THREE from 'three';

const CYAN = 0x20e9ff;
const MAGENTA = 0xff2d78;
let radialGlowTexture;

function getRadialGlowTexture() {
  if (radialGlowTexture) return radialGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 64, 3, 32, 64, 59);
  gradient.addColorStop(0, 'rgba(255,255,255,.8)');
  gradient.addColorStop(0.48, 'rgba(255,255,255,.28)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 128);
  radialGlowTexture = new THREE.CanvasTexture(canvas);
  return radialGlowTexture;
}

function setShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = cast;
    child.receiveShadow = receive;
  });
  return object;
}

function loftGeometry(rings) {
  const positions = [];
  const indices = [];
  for (const ring of rings) {
    const { z, lowerWidth, upperWidth, lowerY, upperY } = ring;
    positions.push(
      -lowerWidth, lowerY, z,
      lowerWidth, lowerY, z,
      upperWidth, upperY, z,
      -upperWidth, upperY, z,
    );
  }
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a = i * 4;
    const b = a + 4;
    for (let side = 0; side < 4; side += 1) {
      const next = (side + 1) % 4;
      indices.push(a + side, b + side, a + next, a + next, b + side, b + next);
    }
  }
  indices.push(0, 3, 2, 0, 2, 1);
  const last = (rings.length - 1) * 4;
  indices.push(last, last + 1, last + 2, last, last + 2, last + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createCar(color, hero = false) {
  const car = new THREE.Group();
  car.name = hero ? 'ApexR9Hero' : 'ApexR9Rival';

  const paintColor = new THREE.Color(color);
  const paint = new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.78,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.25,
    sheenColor: paintColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
  });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x090c0f, metalness: 0.72, roughness: 0.32 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x07131d,
    roughness: 0.08,
    metalness: 0.18,
    transmission: 0.32,
    thickness: 0.3,
    transparent: true,
    opacity: 0.84,
  });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.94, metalness: 0.05 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x7d8b91, roughness: 0.2, metalness: 0.95 });
  const cyanLight = new THREE.MeshBasicMaterial({ color: 0xb9fbff, toneMapped: false });
  const redLight = new THREE.MeshBasicMaterial({ color: 0xff174f, toneMapped: false });
  const accent = new THREE.MeshBasicMaterial({ color: hero ? CYAN : MAGENTA, toneMapped: false });

  const body = new THREE.Mesh(loftGeometry([
    { z: -2.22, lowerWidth: 0.72, upperWidth: 0.86, lowerY: 0.27, upperY: 0.78 },
    { z: -1.74, lowerWidth: 0.98, upperWidth: 1.01, lowerY: 0.2, upperY: 0.86 },
    { z: -0.62, lowerWidth: 1.04, upperWidth: 0.96, lowerY: 0.18, upperY: 0.88 },
    { z: 0.72, lowerWidth: 1.02, upperWidth: 0.9, lowerY: 0.2, upperY: 0.78 },
    { z: 1.72, lowerWidth: 0.94, upperWidth: 0.8, lowerY: 0.24, upperY: 0.7 },
    { z: 2.25, lowerWidth: 0.64, upperWidth: 0.48, lowerY: 0.32, upperY: 0.57 },
  ]), paint);
  car.add(body);

  const canopy = new THREE.Mesh(loftGeometry([
    { z: -0.92, lowerWidth: 0.76, upperWidth: 0.56, lowerY: 0.79, upperY: 1.18 },
    { z: -0.28, lowerWidth: 0.79, upperWidth: 0.62, lowerY: 0.84, upperY: 1.43 },
    { z: 0.55, lowerWidth: 0.72, upperWidth: 0.48, lowerY: 0.8, upperY: 1.28 },
    { z: 0.98, lowerWidth: 0.62, upperWidth: 0.4, lowerY: 0.75, upperY: 0.92 },
  ]), glass);
  car.add(canopy);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.09, 0.48), carbon);
  splitter.position.set(0, 0.2, 2.16);
  const rearDiffuser = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.12, 0.5), carbon);
  rearDiffuser.position.set(0, 0.22, -2.12);
  const leftSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 2.7), carbon);
  const rightSkirt = leftSkirt.clone();
  leftSkirt.position.set(-1.01, 0.24, -0.12);
  rightSkirt.position.set(1.01, 0.24, -0.12);
  car.add(splitter, rearDiffuser, leftSkirt, rightSkirt);

  const intakeGeometry = new THREE.BoxGeometry(0.42, 0.1, 0.7);
  const intakeL = new THREE.Mesh(intakeGeometry, carbon);
  const intakeR = intakeL.clone();
  intakeL.position.set(-0.62, 0.76, 1.3);
  intakeR.position.set(0.62, 0.76, 1.3);
  intakeL.rotation.x = -0.11;
  intakeR.rotation.x = -0.11;
  car.add(intakeL, intakeR);

  const headlightGeometry = new THREE.BoxGeometry(0.56, 0.11, 0.08);
  const headlights = [];
  for (const x of [-0.58, 0.58]) {
    const lamp = new THREE.Mesh(headlightGeometry, cyanLight);
    lamp.position.set(x, 0.61, 2.24);
    lamp.rotation.z = x < 0 ? -0.13 : 0.13;
    car.add(lamp);
    headlights.push(lamp);
  }
  const rearLightGeometry = new THREE.BoxGeometry(0.65, 0.09, 0.06);
  const brakeLights = [];
  for (const x of [-0.54, 0.54]) {
    const lamp = new THREE.Mesh(rearLightGeometry, redLight);
    lamp.position.set(x, 0.66, -2.235);
    lamp.rotation.z = x < 0 ? 0.09 : -0.09;
    car.add(lamp);
    brakeLights.push(lamp);
  }

  const accentStrip = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.035, 0.04), accent);
  accentStrip.position.set(0, 0.46, -2.27);
  car.add(accentStrip);

  const wheelGeometry = new THREE.CylinderGeometry(0.43, 0.43, 0.3, 18, 1);
  wheelGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(0.27, 0.27, 0.315, 12, 1);
  rimGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(0.07, 0.07, 0.33, 12);
  hubGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const z of [-1.38, 1.38]) {
    for (const x of [-1.02, 1.02]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.45, z);
      const tire = new THREE.Mesh(wheelGeometry, tireMaterial);
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      const hub = new THREE.Mesh(hubGeometry, accent);
      wheel.add(tire, rim, hub);
      car.add(wheel);
      wheels.push(wheel);
    }
  }

  const wing = new THREE.Group();
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.1, 0.38), carbon);
  wingBlade.position.y = 1.14;
  const supportGeometry = new THREE.BoxGeometry(0.08, 0.46, 0.12);
  for (const x of [-0.58, 0.58]) {
    const support = new THREE.Mesh(supportGeometry, carbon);
    support.position.set(x, 0.91, 0);
    wing.add(support);
  }
  wing.add(wingBlade);
  wing.position.z = -1.74;
  car.add(wing);

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: CYAN,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const flameGeometry = new THREE.ConeGeometry(0.12, 0.85, 10, 1, true);
  flameGeometry.rotateX(-Math.PI / 2);
  const nitroFlames = [];
  for (const x of [-0.42, 0.42]) {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(x, 0.36, -2.58);
    flame.visible = false;
    car.add(flame);
    nitroFlames.push(flame);
  }

  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 4.4),
    new THREE.MeshBasicMaterial({
      color: hero ? CYAN : MAGENTA,
      map: getRadialGlowTexture(),
      transparent: true,
      opacity: hero ? 0.18 : 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.08;
  car.add(underglow);

  if (hero) {
    const headGlow = new THREE.SpotLight(0xc6fbff, 34, 65, Math.PI / 6, 0.55, 1.5);
    headGlow.position.set(0, 0.68, 1.7);
    headGlow.target.position.set(0, 0, 34);
    car.add(headGlow, headGlow.target);
    const rimLight = new THREE.PointLight(0x42dfff, 16, 12, 2);
    rimLight.position.set(0, 3.2, -1.1);
    car.add(rimLight);
  }

  car.userData = {
    wheels,
    brakeLights,
    nitroFlames,
    flameMaterial,
    underglow,
    paint,
  };
  setShadow(car, true, false);
  car.scale.setScalar(hero ? 1 : 0.97);
  return car;
}

export function createHeroCar() {
  return createCar(0x04cbe5, true);
}

export function createRivalCar(color = 0xff315f) {
  return createCar(color, false);
}
