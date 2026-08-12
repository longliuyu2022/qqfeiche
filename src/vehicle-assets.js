import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHeroCar } from './world.js';

const baseUrl = import.meta.env?.BASE_URL ?? '/';

export const VEHICLE_ASSET_META = Object.freeze({
  name: 'Car Concept',
  author: 'Eric Chadwick, Darmstadt Graphics Group GmbH',
  license: 'CC-BY-4.0',
  source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept',
  sha256: 'c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b',
});

export const DEFAULT_VEHICLE_ASSET_URL = `${baseUrl.replace(/\/$/, '')}/assets/CarConcept.glb`;

const gltfPromises = new Map();
const wheelNames = ['WheelRearL', 'WheelRearR', 'WheelFrontL', 'WheelFrontR'];

function getGLTF(url, onProgress) {
  if (!gltfPromises.has(url)) {
    const loader = new GLTFLoader();
    const request = loader.loadAsync(url, onProgress).catch((error) => {
      gltfPromises.delete(url);
      throw error;
    });
    gltfPromises.set(url, request);
  }
  return gltfPromises.get(url);
}

function removeNonVisualNodes(root) {
  const removals = [];
  root.traverse((object) => {
    if (object.isCamera || object.isLight) removals.push(object);
  });
  removals.forEach((object) => object.removeFromParent());
}

function tuneMaterials(root, maxAnisotropy) {
  const visited = new Set();
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      if (!material || visited.has(material)) return;
      visited.add(material);
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
        if (material[key] && Number.isFinite(maxAnisotropy)) {
          material[key].anisotropy = maxAnisotropy;
        }
      }
      if (material.clearcoat !== undefined) material.clearcoat = Math.max(material.clearcoat, 0.38);
      if (material.clearcoatRoughness !== undefined) {
        material.clearcoatRoughness = Math.max(material.clearcoatRoughness, 0.18);
      }
      if (material.envMapIntensity !== undefined) material.envMapIntensity = Math.min(material.envMapIntensity, 0.68);
      if (material.name === 'Paint 2 Carmine') {
        material.color.setHex(0x24090e);
        material.roughness = 0.52;
        material.metalness = 0.12;
        material.clearcoat = 0.22;
        material.clearcoatRoughness = 0.48;
        material.envMapIntensity = 0.08;
      }
      if (material.name === 'Paint 1 Carmine') {
        material.color.setHex(0xa90d29);
        material.roughness = Math.max(material.roughness, 0.34);
        material.clearcoat = Math.min(material.clearcoat, 0.68);
        material.clearcoatRoughness = Math.max(material.clearcoatRoughness, 0.24);
        material.envMapIntensity = Math.min(material.envMapIntensity, 0.38);
      }
      if (material.name === 'Glass') {
        material.color.setHex(0x020609);
        material.roughness = Math.max(material.roughness, 0.42);
        material.metalness = 0;
        material.transmission = 0;
        material.clearcoat = 0;
        material.clearcoatRoughness = 1;
        material.specularIntensity = 0.08;
        material.specularColor?.setHex(0x0a1820);
        material.reflectivity = 0.04;
        material.ior = 1.1;
        material.envMapIntensity = 0.04;
        material.transparent = false;
        material.opacity = 1;
        material.side = THREE.FrontSide;
      }
      if (/^Tire(side|tread)$/i.test(material.name)) {
        material.color.setHex(material.name.toLowerCase().includes('tread') ? 0x111315 : 0x191c1f);
        material.roughness = material.name.toLowerCase().includes('tread') ? 0.82 : 0.68;
        material.metalness = 0.02;
        material.envMapIntensity = 0.24;
      }
      if (/^(Rim1|Rim2|Disc)$/i.test(material.name)) {
        material.color.setHex(material.name === 'Disc' ? 0x596168 : 0x88939b);
        material.roughness = material.name === 'Disc' ? 0.31 : 0.24;
        material.metalness = 0.88;
        material.envMapIntensity = 0.62;
      }
      if (/^(Mechanical|Hardware)$/i.test(material.name)) {
        material.color.setHex(0x252b30);
        material.roughness = 0.43;
        material.metalness = 0.7;
        material.envMapIntensity = 0.5;
      }
      if (material.name === 'Brake') {
        material.color.setHex(0x8f1526);
        material.roughness = 0.36;
        material.metalness = 0.52;
      }
      if (material.name === 'Brakelight') {
        material.color.setHex(0x650715);
        material.emissive?.setHex(0xff1238);
        material.emissiveIntensity = 1.15;
        material.roughness = 0.22;
        material.envMapIntensity = 0.38;
      }
      if (material.name === 'Signallight') {
        material.color.setHex(0x7c2507);
        material.emissive?.setHex(0xff6a16);
        material.emissiveIntensity = 0.55;
      }
      material.needsUpdate = true;
    });
  });
}

function createWheelPivots(source) {
  source.updateMatrixWorld(true);
  return wheelNames.map((name, index) => {
    const wheel = source.getObjectByName(name);
    if (!wheel?.parent) {
      const suspensionRoot = new THREE.Group();
      suspensionRoot.name = `${name}FallbackSuspension`;
      const steeringKnuckle = new THREE.Group();
      steeringKnuckle.name = `${name}FallbackKnuckle`;
      const wheelPivot = new THREE.Group();
      wheelPivot.name = `${name}FallbackPivot`;
      steeringKnuckle.add(wheelPivot);
      suspensionRoot.add(steeringKnuckle);
      source.add(suspensionRoot);
      return {
        suspensionRoot,
        steeringKnuckle,
        wheel: wheelPivot,
        restPosition: suspensionRoot.position.clone(),
        index,
      };
    }

    const parent = wheel.parent;
    const center = new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3());
    const suspensionRoot = new THREE.Group();
    suspensionRoot.name = `${name}Suspension`;
    const steeringKnuckle = new THREE.Group();
    steeringKnuckle.name = `${name}Knuckle`;
    const wheelPivot = new THREE.Group();
    wheelPivot.name = `${name}Pivot`;
    parent.add(suspensionRoot);
    parent.updateMatrixWorld(true);
    suspensionRoot.position.copy(parent.worldToLocal(center.clone()));
    suspensionRoot.add(steeringKnuckle);
    steeringKnuckle.add(wheelPivot);
    wheelPivot.updateMatrixWorld(true);
    wheelPivot.attach(wheel);
    return {
      suspensionRoot,
      steeringKnuckle,
      wheel: wheelPivot,
      restPosition: suspensionRoot.position.clone(),
      index,
    };
  });
}

function normalizeModel(source, targetLength, rideClearance) {
  const frame = new THREE.Group();
  frame.name = 'CarConceptCoordinateFrame';
  // GLTFLoader applies the asset's authored transforms to yield Y-up, +Z forward.
  frame.add(source);
  frame.updateMatrixWorld(true);

  const initialBounds = new THREE.Box3().setFromObject(frame);
  const initialSize = initialBounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(initialSize.z) || initialSize.z < 0.001) {
    throw new Error('CarConcept has invalid or empty geometry bounds.');
  }

  const uniformScale = targetLength / initialSize.z;
  frame.scale.setScalar(uniformScale);
  frame.updateMatrixWorld(true);

  const scaledBounds = new THREE.Box3().setFromObject(frame);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  frame.position.set(-center.x, rideClearance - scaledBounds.min.y, -center.z);
  frame.updateMatrixWorld(true);
  return frame;
}

function createRuntimeEffects(car, bounds, hero = true, poseRoot = car, wheels = [], modelScale = 1) {
  const size = bounds.getSize(new THREE.Vector3());
  const rearZ = bounds.min.z - 0.035;
  const frontZ = bounds.max.z + 0.02;
  const wheelHeight = bounds.min.y + size.y * 0.27;
  const halfWidth = size.x * 0.5;

  const headLight = new THREE.MeshBasicMaterial({ color: 0xc8fbff, toneMapped: false });
  const brakeLights = [];
  const tailLightMaterials = [];

  const headGeometry = new THREE.BoxGeometry(size.x * 0.2, 0.045, 0.035);
  [-1, 1].forEach((side) => {
    const light = new THREE.Mesh(headGeometry, headLight);
    light.position.set(side * halfWidth * 0.61, wheelHeight + size.y * 0.23, frontZ);
    poseRoot.add(light);
  });

  const tailCavityMaterial = new THREE.MeshStandardMaterial({
    color: 0x08090b,
    roughness: 0.38,
    metalness: 0.72,
  });
  const tailLensMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x36030b,
    emissive: 0x8c061b,
    emissiveIntensity: 0.16,
    roughness: 0.28,
    metalness: 0.12,
    clearcoat: 0.72,
    clearcoatRoughness: 0.24,
  });
  tailLensMaterial.userData.idleEmissive = 0.16;
  tailLensMaterial.userData.brakeEmissive = 0.42;
  const tailLedMaterial = new THREE.MeshStandardMaterial({
    color: 0x7d0a1d,
    emissive: 0xff1839,
    emissiveIntensity: 0.58,
    roughness: 0.3,
    metalness: 0.08,
  });
  tailLedMaterial.userData.idleEmissive = 0.58;
  tailLedMaterial.userData.brakeEmissive = 1.15;
  tailLightMaterials.push(tailLensMaterial, tailLedMaterial);
  const tailWidth = size.x * 0.15;
  const tailHeight = Math.max(0.052, size.y * 0.062);
  [-1, 1].forEach((side) => {
    const lamp = new THREE.Group();
    lamp.position.set(side * halfWidth * 0.49, wheelHeight + size.y * 0.235, rearZ + 0.045);
    const cavity = new THREE.Mesh(new THREE.BoxGeometry(tailWidth * 1.14, tailHeight * 1.34, 0.04), tailCavityMaterial);
    const lens = new THREE.Mesh(new THREE.BoxGeometry(tailWidth, tailHeight, 0.018), tailLensMaterial);
    lens.position.z = -0.026;
    lamp.add(cavity, lens);
    for (let segment = -1; segment <= 1; segment += 1) {
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(tailWidth * 0.2, tailHeight * 0.3, 0.01),
        tailLedMaterial,
      );
      led.position.set(segment * tailWidth * 0.3, 0, -0.039);
      lamp.add(led);
    }
    poseRoot.add(lamp);
    brakeLights.push(lamp);
  });

  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0x48efff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const flameGeometry = new THREE.ConeGeometry(0.115, 0.92, 12, 1, true);
  flameGeometry.rotateX(-Math.PI / 2);
  const nitroFlames = [-1, 1].map((side) => {
    const flame = new THREE.Mesh(flameGeometry, flameMaterial);
    flame.position.set(side * halfWidth * 0.31, wheelHeight - size.y * 0.08, rearZ - 0.36);
    flame.visible = false;
    poseRoot.add(flame);
    return flame;
  });

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64;
  glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext('2d');
  const glowGradient = glowContext.createRadialGradient(32, 64, 2, 32, 64, 60);
  glowGradient.addColorStop(0, 'rgba(120,245,255,.72)');
  glowGradient.addColorStop(0.52, 'rgba(34,223,246,.32)');
  glowGradient.addColorStop(1, 'rgba(0,120,150,0)');
  glowContext.fillStyle = glowGradient;
  glowContext.fillRect(0, 0, 64, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);

  const underglow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.08, size.z * 0.82),
    new THREE.MeshBasicMaterial({
      color: hero ? 0x7af5ff : 0xff2d78,
      map: glowTexture,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = bounds.min.y + 0.018;
  car.add(underglow);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 64;
  shadowCanvas.height = 128;
  const shadowContext = shadowCanvas.getContext('2d');
  const shadowGradient = shadowContext.createRadialGradient(32, 64, 4, 32, 64, 58);
  shadowGradient.addColorStop(0, 'rgba(0,0,0,.78)');
  shadowGradient.addColorStop(0.58, 'rgba(0,0,0,.52)');
  shadowGradient.addColorStop(1, 'rgba(0,0,0,0)');
  shadowContext.fillStyle = shadowGradient;
  shadowContext.fillRect(0, 0, 64, 128);
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x * 1.14, size.z * 1.04),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
      toneMapped: false,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = bounds.min.y + 0.006;
  car.add(contactShadow);

  const wheelShadowMaterial = new THREE.MeshBasicMaterial({
    map: contactShadow.material.map,
    color: 0x000000,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    toneMapped: false,
  });
  const wheelContactShadows = new THREE.Group();
  for (const x of [-halfWidth * 0.78, halfWidth * 0.78]) {
    for (const z of [-size.z * 0.29, size.z * 0.29]) {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.24, size.z * 0.19), wheelShadowMaterial);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, bounds.min.y + 0.009, z);
      wheelContactShadows.add(patch);
    }
  }
  car.add(wheelContactShadows);

  const diffuserMaterial = new THREE.MeshStandardMaterial({
    color: 0x030507,
    roughness: 0.56,
    metalness: 0.68,
    envMapIntensity: 0.14,
  });
  const rearDiffuser = new THREE.Group();
  const diffuserDeck = new THREE.Mesh(
    new THREE.BoxGeometry(size.x * 0.56, Math.max(0.026, size.y * 0.022), size.z * 0.065),
    diffuserMaterial,
  );
  diffuserDeck.position.set(0, bounds.min.y + size.y * 0.17, rearZ + size.z * 0.06);
  rearDiffuser.add(diffuserDeck);
  for (const side of [-0.56, 0, 0.56]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, size.y * 0.075, size.z * 0.08),
      diffuserMaterial,
    );
    fin.position.set(side * halfWidth, bounds.min.y + size.y * 0.145, rearZ + size.z * 0.055);
    rearDiffuser.add(fin);
  }
  poseRoot.add(rearDiffuser);

  const wheelAccentMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9c4cb,
    emissive: 0x26333a,
    emissiveIntensity: 0.35,
    roughness: 0.26,
    metalness: 0.88,
  });
  const wheelAccents = [];
  const wheelMotionBands = [];
  const wheelRadius = size.y * 0.205 / Math.max(modelScale, 0.001);
  const spokeGeometry = new THREE.BoxGeometry(
    0.025 / Math.max(modelScale, 0.001),
    wheelRadius * 1.36,
    0.034 / Math.max(modelScale, 0.001),
  );
  const wheelBandMaterial = new THREE.MeshBasicMaterial({
    color: 0x81959d,
    transparent: true,
    opacity: 0.04,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wheelBandGeometry = new THREE.TorusGeometry(
    wheelRadius * 0.82,
    0.018 / Math.max(modelScale, 0.001),
    5,
    20,
    Math.PI * 1.34,
  );
  wheelBandGeometry.rotateY(Math.PI / 2);
  wheels.forEach((wheel, index) => {
    if (!wheel) return;
    const outward = index % 2 === 0 ? -1 : 1;
    for (let spokeIndex = 0; spokeIndex < 2; spokeIndex += 1) {
      const spoke = new THREE.Mesh(spokeGeometry, wheelAccentMaterial);
      spoke.position.x = outward * size.x * 0.075 / Math.max(modelScale, 0.001);
      spoke.position.y = wheelRadius * 0.08;
      spoke.rotation.x = index * 0.63 + spokeIndex * Math.PI * 0.5;
      wheel.add(spoke);
      wheelAccents.push(spoke);
    }
    const band = new THREE.Mesh(wheelBandGeometry, wheelBandMaterial);
    band.position.x = outward * size.x * 0.077 / Math.max(modelScale, 0.001);
    band.position.y = wheelRadius * 0.08;
    band.rotation.x = index * 0.71;
    band.renderOrder = 4;
    wheel.add(band);
    wheelMotionBands.push(band);
  });

  const headGlow = new THREE.SpotLight(0xc8fbff, 34, 72, Math.PI / 6, 0.56, 1.5);
  headGlow.position.set(0, wheelHeight + size.y * 0.26, bounds.max.z - 0.18);
  headGlow.target.position.set(0, bounds.min.y + 0.25, bounds.max.z + 30);
  poseRoot.add(headGlow, headGlow.target);

  const rimLight = new THREE.PointLight(0x9befff, 0.12, 8, 2);
  rimLight.position.set(0, bounds.max.y + 1.8, -0.8);
  poseRoot.add(rimLight);

  return {
    brakeLights,
    tailLightMaterials,
    nitroFlames,
    flameMaterial,
    underglow,
    contactShadow,
    wheelContactShadows,
    rearDiffuser,
    wheelAccents,
    wheelMotionBands,
    rimLight,
  };
}

function useFallback(error, options) {
  if (options.fallback === false) throw error;
  console.warn('Detailed vehicle asset failed to load; using procedural hero car.', error);
  const fallbackFactory = options.fallbackFactory ?? createHeroCar;
  const fallback = fallbackFactory();
  fallback.userData.assetSource = 'procedural-fallback';
  fallback.userData.assetError = error;
  return fallback;
}

/**
 * Loads and prepares the Khronos Car Concept asset for the game runtime.
 * Resolves to the existing procedural hero car if loading fails, unless
 * `fallback: false` is passed.
 */
export async function createDetailedHeroCar(options = {}) {
  const {
    url = DEFAULT_VEHICLE_ASSET_URL,
    length = 4.85,
    rideClearance = 0.035,
    maxAnisotropy = 8,
    onProgress,
  } = options;

  try {
    const gltf = await getGLTF(url, onProgress);
    const source = gltf.scene.clone(true);
    source.name = 'CarConceptSource';
    removeNonVisualNodes(source);
    tuneMaterials(source, maxAnisotropy);
    const wheelRigs = createWheelPivots(source);
    const wheels = wheelRigs.map((rig) => rig.wheel);
    const modelFrame = normalizeModel(source, length, rideClearance);

    const car = new THREE.Group();
    car.name = 'CarConceptHero';
    const poseRoot = new THREE.Group();
    poseRoot.name = 'CarConceptPoseRoot';
    poseRoot.add(modelFrame);
    car.add(poseRoot);
    car.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(modelFrame);
    // Wheels stay in the vehicle frame while the sprung body pitches, rolls
    // and heaves. Object3D.attach preserves the asset-authored wheel transform.
    wheelRigs.forEach((rig) => {
      car.attach(rig.suspensionRoot);
      rig.restPosition.copy(rig.suspensionRoot.position);
    });
    const effects = createRuntimeEffects(car, bounds, true, poseRoot, wheels, modelFrame.scale.x);

    car.userData = {
      ...effects,
      wheels,
      wheelRigs,
      poseRoot,
      modelFrame,
      assetRoot: source,
      assetSource: url,
      assetMeta: VEHICLE_ASSET_META,
      detailed: true,
      dimensions: bounds.getSize(new THREE.Vector3()),
    };
    return car;
  } catch (error) {
    options.onError?.(error, options.url ?? DEFAULT_VEHICLE_ASSET_URL);
    return useFallback(error, options);
  }
}

export async function preloadDetailedHeroCar(options = {}) {
  return getGLTF(options.url ?? DEFAULT_VEHICLE_ASSET_URL, options.onProgress);
}
