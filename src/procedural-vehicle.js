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

function createCar(color, hero = false, accentOverride = null) {
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
  const accent = new THREE.MeshBasicMaterial({ color: accentOverride ?? (hero ? CYAN : MAGENTA), toneMapped: false });

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
    color: accentOverride ?? CYAN,
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
      color: accentOverride ?? (hero ? CYAN : MAGENTA),
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

function createVariantPaint(color) {
  const paintColor = color?.isColor ? color.clone() : new THREE.Color(color);
  return new THREE.MeshPhysicalMaterial({
    color: paintColor,
    metalness: 0.78,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    sheen: 0.25,
    sheenColor: paintColor.clone().lerp(new THREE.Color(0xffffff), 0.35),
  });
}

function createVariantContext(entry) {
  const accentColor = new THREE.Color(entry.accentColor ?? '#2ce8f5');
  return {
    accentColor,
    paint: createVariantPaint(entry.color ?? '#ff3b30'),
    carbon: new THREE.MeshStandardMaterial({ color: 0x090c0f, metalness: 0.72, roughness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x07131d,
      roughness: 0.08,
      metalness: 0.18,
      transmission: 0.32,
      thickness: 0.3,
      transparent: true,
      opacity: 0.84,
    }),
    tire: new THREE.MeshStandardMaterial({ color: 0x08090a, roughness: 0.94, metalness: 0.05 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x7d8b91, roughness: 0.2, metalness: 0.95 }),
    cyanLight: new THREE.MeshBasicMaterial({ color: 0xb9fbff, toneMapped: false }),
    redLight: new THREE.MeshBasicMaterial({ color: 0xff174f, toneMapped: false }),
    accent: new THREE.MeshBasicMaterial({ color: accentColor.clone(), toneMapped: false }),
  };
}

// 与 createCar 相同的车轮顺序约定：先后轴一对、再前轴一对（main.js 只对 index >= 2 施加转向）。
function addVariantWheels(car, context, { track = 1.02, wheelbase = 1.38, radius = 0.43, width = 0.3, height = 0.45 } = {}) {
  const tireGeometry = new THREE.CylinderGeometry(radius, radius, width, 18, 1);
  tireGeometry.rotateZ(Math.PI / 2);
  const rimGeometry = new THREE.CylinderGeometry(radius * 0.63, radius * 0.63, width * 1.05, 12, 1);
  rimGeometry.rotateZ(Math.PI / 2);
  const hubGeometry = new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 1.1, 12);
  hubGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const z of [-wheelbase, wheelbase]) {
    for (const x of [-track, track]) {
      const wheel = new THREE.Group();
      wheel.position.set(x, height, z);
      wheel.add(
        new THREE.Mesh(tireGeometry, context.tire),
        new THREE.Mesh(rimGeometry, context.rim),
        new THREE.Mesh(hubGeometry, context.accent),
      );
      car.add(wheel);
      wheels.push(wheel);
    }
  }
  return wheels;
}

function addVariantNitroFlames(car, context, positions, scale = 1) {
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: context.accentColor.clone(),
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const flameGeometry = new THREE.ConeGeometry(0.12 * scale, 0.85 * scale, 10, 1, true);
  flameGeometry.rotateX(-Math.PI / 2);
  const nitroFlames = positions.map(([x, y, z]) => {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(x, y, z);
    flame.visible = false;
    car.add(flame);
    return flame;
  });
  return { nitroFlames, flameMaterial };
}

function addVariantUnderglow(car, context, { width = 2.4, length = 4.4, opacity = 0.18 } = {}) {
  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    new THREE.MeshBasicMaterial({
      color: context.accentColor.clone(),
      map: getRadialGlowTexture(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.08;
  car.add(underglow);
  return underglow;
}

function finalizeVariant(car, context, wheels, brakeLights, flames, underglow) {
  const headGlow = new THREE.SpotLight(0xc6fbff, 34, 65, Math.PI / 6, 0.55, 1.5);
  headGlow.position.set(0, 0.68, 1.7);
  headGlow.target.position.set(0, 0, 34);
  car.add(headGlow, headGlow.target);
  const rimLight = new THREE.PointLight(0x42dfff, 16, 12, 2);
  rimLight.position.set(0, 3.2, -1.1);
  car.add(rimLight);

  car.userData = {
    wheels,
    brakeLights,
    nitroFlames: flames.nitroFlames,
    flameMaterial: flames.flameMaterial,
    underglow,
    paint: context.paint,
  };
  setShadow(car, true, false);
  car.scale.setScalar(1);
  return car;
}

// 雷鸣 Raiden：低趴楔形车身 + 大尾翼 + 前后贯穿灯带。
function createRaidenVariant(entry) {
  const context = createVariantContext(entry);
  const car = new THREE.Group();
  car.name = 'HeroCarRaiden';

  const body = new THREE.Mesh(loftGeometry([
    { z: -2.3, lowerWidth: 0.78, upperWidth: 0.92, lowerY: 0.26, upperY: 0.72 },
    { z: -1.62, lowerWidth: 1.0, upperWidth: 1.04, lowerY: 0.19, upperY: 0.8 },
    { z: -0.5, lowerWidth: 1.06, upperWidth: 1.0, lowerY: 0.17, upperY: 0.82 },
    { z: 0.62, lowerWidth: 1.04, upperWidth: 0.92, lowerY: 0.17, upperY: 0.66 },
    { z: 1.65, lowerWidth: 0.9, upperWidth: 0.7, lowerY: 0.2, upperY: 0.46 },
    { z: 2.34, lowerWidth: 0.58, upperWidth: 0.44, lowerY: 0.26, upperY: 0.36 },
  ]), context.paint);
  const canopy = new THREE.Mesh(loftGeometry([
    { z: -1.16, lowerWidth: 0.72, upperWidth: 0.5, lowerY: 0.78, upperY: 1.0 },
    { z: -0.42, lowerWidth: 0.76, upperWidth: 0.54, lowerY: 0.8, upperY: 1.16 },
    { z: 0.48, lowerWidth: 0.66, upperWidth: 0.42, lowerY: 0.66, upperY: 0.98 },
    { z: 1.08, lowerWidth: 0.54, upperWidth: 0.3, lowerY: 0.48, upperY: 0.64 },
  ]), context.glass);
  car.add(body, canopy);

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.08, 0.56), context.carbon);
  splitter.position.set(0, 0.18, 2.24);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.52), context.carbon);
  diffuser.position.set(0, 0.2, -2.2);
  car.add(splitter, diffuser);
  for (const side of [-1, 1]) {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.13, 2.72), context.carbon);
    skirt.position.set(side * 1.03, 0.22, -0.1);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 2.5), context.accent);
    blade.position.set(side * 1.09, 0.3, -0.1);
    car.add(skirt, blade);
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.6), context.carbon);
    vent.position.set(side * 0.5, 0.53, 1.35);
    vent.rotation.x = -0.15;
    car.add(vent);
  }

  const wing = new THREE.Group();
  const wingBlade = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.09, 0.5), context.carbon);
  wingBlade.position.y = 1.32;
  wingBlade.rotation.x = 0.14;
  wing.add(wingBlade);
  for (const side of [-1, 1]) {
    const support = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.62, 0.14), context.carbon);
    support.position.set(side * 0.72, 1.0, 0.05);
    const endplate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 0.56), context.carbon);
    endplate.position.set(side, 1.3, 0);
    const glowEdge = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.04, 0.5), context.accent);
    glowEdge.position.set(side, 1.17, 0);
    wing.add(support, endplate, glowEdge);
  }
  wing.position.z = -1.9;
  car.add(wing);

  const frontBar = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.055, 0.07), context.cyanLight);
  frontBar.position.set(0, 0.33, 2.36);
  const frontAccent = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.03, 0.05), context.accent);
  frontAccent.position.set(0, 0.26, 2.35);
  car.add(frontBar, frontAccent);

  const brakeLights = [];
  const rearBar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 0.05), context.redLight);
  rearBar.position.set(0, 0.62, -2.32);
  car.add(rearBar);
  brakeLights.push(rearBar);

  const wheels = addVariantWheels(car, context, { track: 1.04, radius: 0.42, height: 0.44 });
  const flames = addVariantNitroFlames(car, context, [[-0.46, 0.34, -2.64], [0.46, 0.34, -2.64]]);
  const underglow = addVariantUnderglow(car, context, { width: 2.4, length: 4.6, opacity: 0.2 });
  return finalizeVariant(car, context, wheels, brakeLights, flames, underglow);
}

// 云雀 Nimbus：圆润溜背 + 小鸭尾 + 主色/珠光双色拼接。
function createNimbusVariant(entry) {
  const context = createVariantContext(entry);
  const duoPaint = createVariantPaint(context.accentColor);
  const car = new THREE.Group();
  car.name = 'HeroCarNimbus';

  const body = new THREE.Mesh(loftGeometry([
    { z: -2.12, lowerWidth: 0.66, upperWidth: 0.54, lowerY: 0.3, upperY: 0.66 },
    { z: -1.55, lowerWidth: 0.92, upperWidth: 0.84, lowerY: 0.22, upperY: 0.8 },
    { z: -0.6, lowerWidth: 1.0, upperWidth: 0.92, lowerY: 0.2, upperY: 0.88 },
    { z: 0.5, lowerWidth: 1.0, upperWidth: 0.88, lowerY: 0.2, upperY: 0.84 },
    { z: 1.45, lowerWidth: 0.9, upperWidth: 0.76, lowerY: 0.24, upperY: 0.68 },
    { z: 2.14, lowerWidth: 0.62, upperWidth: 0.46, lowerY: 0.3, upperY: 0.5 },
  ]), context.paint);
  const canopy = new THREE.Mesh(loftGeometry([
    { z: -1.9, lowerWidth: 0.5, upperWidth: 0.34, lowerY: 0.66, upperY: 0.78 },
    { z: -1.2, lowerWidth: 0.66, upperWidth: 0.5, lowerY: 0.78, upperY: 1.06 },
    { z: -0.3, lowerWidth: 0.72, upperWidth: 0.56, lowerY: 0.84, upperY: 1.34 },
    { z: 0.55, lowerWidth: 0.66, upperWidth: 0.44, lowerY: 0.8, upperY: 1.18 },
    { z: 1.0, lowerWidth: 0.56, upperWidth: 0.34, lowerY: 0.72, upperY: 0.86 },
  ]), context.glass);
  car.add(body, canopy);

  const bonnetStripe = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.04, 1.25), duoPaint);
  bonnetStripe.position.set(0, 0.7, 1.45);
  bonnetStripe.rotation.x = 0.2;
  const bumperBand = new THREE.Mesh(new THREE.BoxGeometry(1.26, 0.1, 0.06), duoPaint);
  bumperBand.position.set(0, 0.36, 2.12);
  car.add(bonnetStripe, bumperBand);
  for (const side of [-1, 1]) {
    const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.4), duoPaint);
    rocker.position.set(side * 0.97, 0.27, -0.05);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.08, 2.1), duoPaint);
    stripe.position.set(side * 0.985, 0.38, 0.05);
    car.add(rocker, stripe);
  }

  const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.4), context.carbon);
  splitter.position.set(0, 0.2, 2.05);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.1, 0.42), context.carbon);
  diffuser.position.set(0, 0.22, -2.0);
  car.add(splitter, diffuser);

  const ducktail = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.055, 0.3), context.carbon);
  ducktail.position.set(0, 0.71, -2.08);
  ducktail.rotation.x = 0.4;
  const tailAccent = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.025, 0.035), context.accent);
  tailAccent.position.set(0, 0.77, -2.2);
  tailAccent.rotation.x = 0.4;
  car.add(ducktail, tailAccent);

  const brakeLights = [];
  for (const side of [-1, 1]) {
    const headLamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.07), context.cyanLight);
    headLamp.position.set(side * 0.42, 0.42, 2.13);
    headLamp.rotation.z = side * 0.12;
    car.add(headLamp);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.06), context.redLight);
    tailLamp.position.set(side * 0.4, 0.56, -2.12);
    tailLamp.rotation.z = side * -0.08;
    car.add(tailLamp);
    brakeLights.push(tailLamp);
  }

  const wheels = addVariantWheels(car, context, { track: 1.0, radius: 0.42, height: 0.44 });
  const flames = addVariantNitroFlames(car, context, [[-0.36, 0.38, -2.42], [0.36, 0.38, -2.42]], 0.9);
  const underglow = addVariantUnderglow(car, context, { width: 2.3, length: 4.2, opacity: 0.16 });
  return finalizeVariant(car, context, wheels, brakeLights, flames, underglow);
}

// 磐石 Goliath：宽体高车肩 + 粗轮拱 + 车顶灯桥的越野姿态。
function createGoliathVariant(entry) {
  const context = createVariantContext(entry);
  const car = new THREE.Group();
  car.name = 'HeroCarGoliath';

  const body = new THREE.Mesh(loftGeometry([
    { z: -2.18, lowerWidth: 0.88, upperWidth: 0.9, lowerY: 0.38, upperY: 0.96 },
    { z: -1.5, lowerWidth: 1.04, upperWidth: 1.06, lowerY: 0.3, upperY: 1.04 },
    { z: -0.4, lowerWidth: 1.08, upperWidth: 1.06, lowerY: 0.28, upperY: 1.08 },
    { z: 0.7, lowerWidth: 1.08, upperWidth: 1.02, lowerY: 0.28, upperY: 1.02 },
    { z: 1.6, lowerWidth: 1.0, upperWidth: 0.94, lowerY: 0.32, upperY: 0.92 },
    { z: 2.2, lowerWidth: 0.8, upperWidth: 0.72, lowerY: 0.42, upperY: 0.76 },
  ]), context.paint);
  const canopy = new THREE.Mesh(loftGeometry([
    { z: -1.35, lowerWidth: 0.82, upperWidth: 0.6, lowerY: 0.98, upperY: 1.42 },
    { z: -0.45, lowerWidth: 0.86, upperWidth: 0.64, lowerY: 1.02, upperY: 1.5 },
    { z: 0.55, lowerWidth: 0.8, upperWidth: 0.56, lowerY: 0.98, upperY: 1.38 },
    { z: 1.2, lowerWidth: 0.68, upperWidth: 0.46, lowerY: 0.9, upperY: 1.08 },
  ]), context.glass);
  car.add(body, canopy);

  for (const z of [-1.38, 1.38]) {
    for (const side of [-1, 1]) {
      const flare = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 1.16), context.carbon);
      flare.position.set(side * 1.05, 0.98, z);
      car.add(flare);
    }
  }
  for (const side of [-1, 1]) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 2.2), context.carbon);
    step.position.set(side * 1.1, 0.34, 0);
    const beltStripe = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.04, 2.3), context.accent);
    beltStripe.position.set(side * 1.075, 0.72, -0.05);
    car.add(step, beltStripe);
  }

  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.07, 0.5), context.carbon);
  rack.position.set(0, 1.54, -0.2);
  const podBar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.09, 0.12), context.carbon);
  podBar.position.set(0, 1.62, 0.02);
  car.add(rack, podBar);
  for (const x of [-0.39, -0.13, 0.13, 0.39]) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05), context.cyanLight);
    pod.position.set(x, 1.62, 0.09);
    car.add(pod);
  }

  const bullBar = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.1, 0.12), context.carbon);
  bullBar.position.set(0, 0.62, 2.32);
  const skidPlate = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.05, 0.5), context.rim);
  skidPlate.position.set(0, 0.34, 2.18);
  skidPlate.rotation.x = 0.25;
  car.add(bullBar, skidPlate);

  const brakeLights = [];
  for (const side of [-1, 1]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.1), context.carbon);
    upright.position.set(side * 0.45, 0.5, 2.3);
    const headLamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.07), context.cyanLight);
    headLamp.position.set(side * 0.56, 0.68, 2.21);
    const tailLamp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.06), context.redLight);
    tailLamp.position.set(side * 0.72, 0.78, -2.19);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.12), context.accent);
    hook.position.set(side * 0.5, 0.42, -2.22);
    car.add(upright, headLamp, tailLamp, hook);
    brakeLights.push(tailLamp);
  }
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.035, 0.05), context.accent);
  tailBar.position.set(0, 0.92, -2.2);
  car.add(tailBar);

  const wheels = addVariantWheels(car, context, { track: 1.08, radius: 0.47, width: 0.36, height: 0.5 });
  const flames = addVariantNitroFlames(car, context, [[-0.52, 0.46, -2.56], [0.52, 0.46, -2.56]], 1.1);
  const underglow = addVariantUnderglow(car, context, { width: 2.6, length: 4.4, opacity: 0.18 });
  return finalizeVariant(car, context, wheels, brakeLights, flames, underglow);
}

/**
 * 按车辆目录条目构建程序化主车外观。userData 约定与 createHeroCar 完全一致
 * （wheels / brakeLights / nitroFlames / flameMaterial / underglow / paint），
 * main.js 的车轮、火焰、灯光动画可直接复用。
 */
export function createHeroCarVariant(car) {
  const entry = car ?? {};
  switch (entry.id) {
    case 'raiden':
      return createRaidenVariant(entry);
    case 'nimbus':
      return createNimbusVariant(entry);
    case 'goliath':
      return createGoliathVariant(entry);
    default: {
      const volt = createCar(entry.color ?? '#ff3b30', true, entry.accentColor ?? '#2ce8f5');
      volt.name = 'HeroCarVolt';
      return volt;
    }
  }
}
