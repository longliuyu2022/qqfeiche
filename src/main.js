import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createWorld as createNightWorld, createRivalCar, TRACK_CURVE as NIGHT_TRACK_CURVE } from './world.js';
import { createDayWorld, DAY_TRACK_CURVE } from './day-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
  createScenicWorld,
} from './scenic-worlds.js';
import { createDetailedHeroCar } from './vehicle-assets.js';
import { ArcadeVehicle } from './driving.js';
import { RaceSystem } from './race-system.js';
import { RaceAudio } from './audio.js';
import { createRuntimeMonitor } from './telemetry.js';
import { createSpeedPostProcess } from './speed-postprocess.js';
import { loadRaceRecords, recordRaceResult } from './race-records.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { RACE_MODES } from './race-modes.js';
import { TRACK_CATALOG, normalizeTrackId } from './track-catalog.js';
import { ItemRaceSystem, ITEM_DEFINITIONS } from './item-race.js';

let preferences = loadPreferences();
const activeTrackId = normalizeTrackId(window.__NEON_APEX_TRACK__ || preferences.lastTrack);
const activeTrack = TRACK_CATALOG[activeTrackId];
const onlineSession = window.__NEON_APEX_ONLINE__ || null;
const isOnline = Boolean(onlineSession?.room);
const TRACK_RUNTIMES = Object.freeze({
  night: Object.freeze({
    curve: NIGHT_TRACK_CURVE,
    createWorld: (targetScene) => createNightWorld(targetScene),
  }),
  day: Object.freeze({
    curve: DAY_TRACK_CURVE,
    createWorld: (targetScene) => createDayWorld(targetScene),
  }),
  alpine: Object.freeze({
    curve: ALPINE_TRACK_CURVE,
    createWorld: (targetScene, options) => createScenicWorld(targetScene, 'alpine', options),
  }),
  canyon: Object.freeze({
    curve: CANYON_TRACK_CURVE,
    createWorld: (targetScene, options) => createScenicWorld(targetScene, 'canyon', options),
  }),
  coast: Object.freeze({
    curve: COAST_TRACK_CURVE,
    createWorld: (targetScene, options) => createScenicWorld(targetScene, 'coast', options),
  }),
});
const activeTrackRuntime = TRACK_RUNTIMES[activeTrackId] ?? TRACK_RUNTIMES.night;
const trackCurve = activeTrackRuntime.curve;
const STARTING_NITRO = 38;

function resolveQualityTier(detectedTier) {
  return preferences.quality === 'auto' ? detectedTier : preferences.quality;
}

const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = activeTrack.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const runtimeMonitor = createRuntimeMonitor({ renderer, canvas });
const detectedQualityTier = runtimeMonitor.snapshot().qualityTier;
let qualityTier = resolveQualityTier(detectedQualityTier);
renderer.shadowMap.enabled = qualityTier !== 'balanced';

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const fallbackEnvironment = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = fallbackEnvironment.texture;
scene.environmentIntensity = activeTrack.environmentIntensity;
pmrem.dispose();
if (activeTrackId === 'night') {
  new RGBELoader().load(
    '/assets/environment/polyhaven/modern_buildings_night/modern_buildings_night_1k.hdr',
    (texture) => {
      const hdriPmrem = new THREE.PMREMGenerator(renderer);
      const hdriEnvironment = hdriPmrem.fromEquirectangular(texture);
      scene.environment = hdriEnvironment.texture;
      scene.environmentIntensity = activeTrack.environmentIntensity;
      scene.environmentRotation.y = 1.1;
      texture.dispose();
      fallbackEnvironment.dispose();
      hdriPmrem.dispose();
    },
    undefined,
    (error) => runtimeMonitor.assetFailure('modern_buildings_night_1k.hdr', error),
  );
}
const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1900);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(1, 1),
  activeTrack.bloomStrength,
  activeTrack.bloomRadius,
  activeTrack.bloomThreshold,
);
composer.addPass(bloom);
const speedPost = createSpeedPostProcess({ qualityTier });
composer.addPass(speedPost.pass);
composer.addPass(new OutputPass());

const world = activeTrackRuntime.createWorld(scene, { qualityTier });
const hero = await createDetailedHeroCar({
  maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
  onError: (error, url) => runtimeMonitor.assetFailure(url, error),
  onProgress: (event) => {
    if (!event.total) return;
    const label = document.querySelector('.loading-screen small');
    if (label) label.textContent = `${activeTrack.loading} ${Math.round((event.loaded / event.total) * 100)}%`;
  },
});
scene.add(hero);

const vehicle = new ArcadeVehicle({
  object: hero,
  trackCurve,
  trackWidth: 16,
  trackSamples: 520,
  totalLaps: 3,
  rideHeight: 0.05,
  maxSpeed: 82,
  acceleration: 34,
  nitroSpeedMultiplier: 1.3,
});
vehicle.bindKeyboard(window);
vehicle.bindTouchControls({
  left: '[data-control="left"]',
  right: '[data-control="right"]',
  accelerate: '[data-control="accelerate"]',
  brake: '[data-control="brake"]',
  drift: '[data-control="drift"]',
  nitro: '[data-control="nitro"]',
});

const startT = 0.002;
const startPoint = trackCurve.getPointAt(startT);
const startTangent = trackCurve.getTangentAt(startT).normalize();
const startHeading = Math.atan2(startTangent.x, startTangent.z);
const onlinePlayerIndex = Math.max(0, onlineSession?.room?.players?.findIndex((entry) => entry.id === onlineSession.selfId) ?? 0);
const gridRow = Math.floor(onlinePlayerIndex / 2);
const gridProgress = THREE.MathUtils.euclideanModulo(startT - gridRow * 0.0042, 1);
const gridPoint = trackCurve.getPointAt(gridProgress);
const gridTangent = trackCurve.getTangentAt(gridProgress).normalize();
const gridSide = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), gridTangent).normalize();
const gridLane = isOnline ? (onlinePlayerIndex % 2 === 0 ? -1.8 : 1.8) : 0;
const playerStartPoint = gridPoint.clone().addScaledVector(gridSide, gridLane);
const playerStartHeading = Math.atan2(gridTangent.x, gridTangent.z);
vehicle.reset({
  position: playerStartPoint.clone().add(new THREE.Vector3(0, 0.05, 0)),
  heading: playerStartHeading,
  nitro: STARTING_NITRO,
});

const rivalColors = [0xa50e2d, 0xb97819, 0x563397, 0x167153, 0x8b989e];
const rivals = rivalColors.map((color, index) => {
  const object = createRivalCar(color);
  object.userData.underglow.visible = false;
  scene.add(object);
  return {
    object,
    progress: startT - 0.0038 * (index + 1),
    totalProgress: startT - 0.0038 * (index + 1),
    speed: 59 + index * 1.9,
    lane: ((index % 2) * 2 - 1) * (1.7 + Math.floor(index / 2) * 0.35),
    wheelPhase: Math.random() * Math.PI * 2,
  };
});

const raceSystem = new RaceSystem({
  player: vehicle,
  rivals,
  trackCurve,
  startProgress: startT,
  trackWidth: 16,
  totalLaps: 3,
});
const itemRace = new ItemRaceSystem({ scene, player: vehicle, rivals, trackCurve });

const remotePlayers = new Map();
for (const [index, player] of (onlineSession?.room?.players ?? []).entries()) {
  if (player.id === onlineSession.selfId) continue;
  const object = createRivalCar(player.color);
  object.userData.underglow.visible = false;
  scene.add(object);
  const row = Math.floor(index / 2);
  const progress = THREE.MathUtils.euclideanModulo(startT - row * 0.0042, 1);
  const point = trackCurve.getPointAt(progress);
  const tangent = trackCurve.getTangentAt(progress).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
  const lane = index % 2 === 0 ? -1.8 : 1.8;
  object.position.copy(point).addScaledVector(side, lane);
  object.position.y += 0.05;
  object.rotation.y = Math.atan2(tangent.x, tangent.z);
  remotePlayers.set(player.id, {
    id: player.id,
    name: player.name,
    object,
    targetPosition: object.position.clone(),
    targetYaw: object.rotation.y,
    speed: 0,
    progress: -row * 0.0042,
    lap: 1,
    finished: false,
    finishTime: null,
    receivedAt: performance.now(),
  });
}

const effects = createSpeedEffects(scene);
const windStreaks = createWindStreaks(camera);
const audio = new RaceAudio();
audio.setVolume(preferences.masterVolume);
audio.setMuted(!preferences.soundEnabled);
let raceRecords = loadRaceRecords();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const trackSide = new THREE.Vector3();
const tempPoint = new THREE.Vector3();
const tempTangent = new THREE.Vector3();
const tempQuaternion = new THREE.Quaternion();
const tempMatrix = new THREE.Matrix4();
const up = new THREE.Vector3(0, 1, 0);
const particleSpawn = new THREE.Vector3();
const particleVelocity = new THREE.Vector3();
const cameraShakeOffset = new THREE.Vector3();
const ui = collectUi();

let elapsed = 0;
let countdown = 3;
let raceStarted = false;
let homeVisible = true;
let selectedMode = isOnline ? 'race' : preferences.lastMode;
let activeMode = selectedMode;
let paused = false;
let lastDrifting = false;
let lastBoosting = false;
let calloutTimeout = 0;
let startDelay = 0;
let capturePaused = false;
let previousForwardSpeed = 0;
let waitingForOnlineStart = isOnline;
let lastNetworkSendAt = 0;
let networkSequence = 0;

function collectUi() {
  const ids = [
    'position', 'lap', 'time', 'sector', 'gear', 'speed', 'tachFill', 'nitroFill', 'nitroPct',
    'checkpoint', 'driftScore', 'combo', 'comboBlock', 'countdown', 'callout', 'loading',
    'pauseMenu', 'resultMenu', 'resultTitle', 'resultPosition', 'resultTime', 'bestLap', 'resultScore',
    'recordStatus', 'personalBest',
    'homeMenu', 'homeBest', 'homeBestLabel', 'homeRaces', 'homeWins',
    'homeEventMeta', 'homeEventTitle', 'homeEventRules', 'settingsMenu',
    'soundEnabled', 'masterVolume', 'volumeValue', 'qualitySetting',
    'vibrationEnabled', 'cameraShakeEnabled', 'hudTrackName', 'raceFeedTitle', 'raceFeedMeta',
    'itemHud', 'itemUse', 'itemIcon', 'itemName',
  ];
  return Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
}

function createSpeedEffects(targetScene) {
  const maxParticles = qualityTier === 'balanced' ? 180 : 280;
  const positions = new Float32Array(maxParticles * 3);
  const sizes = new Float32Array(maxParticles);
  const alphas = new Float32Array(maxParticles);
  const stretches = new Float32Array(maxParticles);
  positions.fill(5000);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('pointSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('pointAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('pointStretch', new THREE.BufferAttribute(stretches, 1));
  const material = new THREE.ShaderMaterial({
    size: 0.16,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      color: { value: new THREE.Color(0x8dcfd7) },
      opacity: { value: 0.68 },
      viewportScale: { value: 1 },
    },
    vertexShader: `
      attribute float pointSize;
      attribute float pointAlpha;
      attribute float pointStretch;
      uniform float viewportScale;
      varying float vAlpha;
      varying float vStretch;
      varying float vProjectedSize;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        float projectedSize = pointSize * viewportScale * (250.0 / max(1.0, -viewPosition.z));
        gl_PointSize = clamp(projectedSize, 1.0, 38.0);
        vAlpha = pointAlpha;
        vStretch = pointStretch;
        vProjectedSize = projectedSize;
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlpha;
      varying float vStretch;
      varying float vProjectedSize;
      void main() {
        if (vProjectedSize < 2.2) discard;
        vec2 point = gl_PointCoord - 0.5;
        float along = 1.0 - smoothstep(0.26, 0.5, abs(point.x));
        float crossWidth = mix(0.1, 0.18, vStretch);
        float cross = 1.0 - smoothstep(crossWidth * 0.38, crossWidth, abs(point.y));
        float taper = smoothstep(-0.5, -0.18, point.x) * (1.0 - smoothstep(0.12, 0.5, point.x));
        float core = 1.0 - smoothstep(0.0, crossWidth * 0.36, abs(point.y));
        gl_FragColor = vec4(color * (0.74 + core * 0.26), along * cross * taper * vAlpha * opacity);
      }
    `,
  });
  const particles = new THREE.Points(geometry, material);
  particles.frustumCulled = false;
  targetScene.add(particles);

  const ages = new Float32Array(maxParticles);
  const lifetimes = new Float32Array(maxParticles);
  const seeds = new Float32Array(maxParticles);
  const velocities = Array.from({ length: maxParticles }, () => new THREE.Vector3());
  let cursor = 0;
  return {
    particles,
    positions,
    sizes,
    alphas,
    stretches,
    ages,
    lifetimes,
    seeds,
    velocities,
    cursor,
    maxParticles,
    spawnCarry: 0,
  };
}

function createWindStreaks(targetCamera) {
  const count = qualityTier === 'balanced' ? 48 : 76;
  const verticesPerStreak = 6;
  const positions = new Float32Array(count * verticesPerStreak * 3);
  const alphas = new Float32Array(count * verticesPerStreak);
  const speeds = new Float32Array(count);
  const indices = [];
  const reset = (index, initial = false) => {
    const z = initial ? -10 - Math.random() * 112 : -116 - Math.random() * 28;
    const spread = 3.4 + Math.abs(z) * 0.102;
    const portrait = targetCamera.aspect < 0.8;
    const compactLandscape = targetCamera.aspect > 1.25 && innerHeight < 500;
    const horizontalScale = portrait ? 0.46 : compactLandscape ? 0.86 : 1;
    const groundPass = index % 4 === 0;
    const radialOffset = groundPass
      ? 0.44 + Math.random() * 0.5
      : 0.3 + Math.random() * 0.86;
    const x = (Math.random() > 0.5 ? 1 : -1) * spread * horizontalScale * radialOffset;
    const y = groundPass
      ? -spread * (0.12 + Math.random() * 0.16)
      : (Math.random() - 0.46) * spread * 0.52;
    const length = (groundPass ? 5.5 : 3.2) + Math.random() ** 0.65 * (groundPass ? 18 : 14);
    const widthScale = portrait ? 1.7 : compactLandscape ? 1.34 : 1;
    const width = (0.018 + Math.random() * 0.045) * widthScale;
    const inverseRadius = 1 / Math.max(0.01, Math.hypot(x, y));
    const perpendicularX = -y * inverseRadius * width;
    const perpendicularY = x * inverseRadius * width;
    const centerZ = [z - length, z - length * 0.22, z];
    const sectionWidth = [0.12, 1, 0.08];
    const alpha = 0.44 + Math.random() * 0.56;
    const sectionAlpha = [0, alpha, 0.04 + Math.random() * 0.08];
    const positionOffset = index * verticesPerStreak * 3;
    const alphaOffset = index * verticesPerStreak;
    for (let section = 0; section < 3; section += 1) {
      for (let edge = 0; edge < 2; edge += 1) {
        const sign = edge === 0 ? -1 : 1;
        const vertex = section * 2 + edge;
        const offset = positionOffset + vertex * 3;
        positions[offset] = x + perpendicularX * sectionWidth[section] * sign;
        positions[offset + 1] = y + perpendicularY * sectionWidth[section] * sign;
        positions[offset + 2] = centerZ[section];
        alphas[alphaOffset + vertex] = sectionAlpha[section];
      }
    }
    speeds[index] = 0.62 + Math.random() * 1.05;
  };
  for (let i = 0; i < count; i += 1) {
    const vertex = i * verticesPerStreak;
    indices.push(vertex, vertex + 1, vertex + 2, vertex + 2, vertex + 1, vertex + 3);
    indices.push(vertex + 2, vertex + 3, vertex + 4, vertex + 4, vertex + 3, vertex + 5);
    reset(i, true);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('streakAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: new THREE.Color(0x9af6ff) },
      opacity: { value: 0 },
    },
    vertexShader: `
      attribute float streakAlpha;
      varying float vAlpha;
      void main() {
        vAlpha = streakAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlpha;
      void main() {
        gl_FragColor = vec4(color, vAlpha * opacity);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  targetCamera.add(mesh);
  scene.add(targetCamera);
  return { mesh, positions, speeds, count, verticesPerStreak, reset };
}

function updateWindStreaks(dt) {
  const intensity = THREE.MathUtils.smoothstep(vehicle.speedKph, 115, 310);
  const portrait = camera.aspect < 0.8;
  const compactLandscape = camera.aspect > 1.25 && innerHeight < 500;
  const viewportBoost = portrait ? 1.55 : compactLandscape ? 1.38 : 1;
  const travel = (38 + vehicle.speed * 1.38) * dt;
  for (let i = 0; i < windStreaks.count; i += 1) {
    const offset = i * windStreaks.verticesPerStreak * 3;
    for (let vertex = 0; vertex < windStreaks.verticesPerStreak; vertex += 1) {
      windStreaks.positions[offset + vertex * 3 + 2] += travel * windStreaks.speeds[i];
    }
    if (windStreaks.positions[offset + 14] > -2.4) windStreaks.reset(i);
  }
  windStreaks.mesh.geometry.attributes.position.needsUpdate = true;
  windStreaks.mesh.geometry.attributes.streakAlpha.needsUpdate = true;
  windStreaks.mesh.material.uniforms.opacity.value = intensity * viewportBoost * (vehicle.boosting ? 0.7 : 0.42);
  document.documentElement.style.setProperty('--speed-fx', String(intensity * 0.3));
}

function spawnParticle(position, velocity, life = 0.5, size = 0.16, stretch = 0.5) {
  const index = effects.cursor;
  effects.cursor = (effects.cursor + 1) % effects.maxParticles;
  effects.positions[index * 3] = position.x;
  effects.positions[index * 3 + 1] = position.y;
  effects.positions[index * 3 + 2] = position.z;
  effects.velocities[index].copy(velocity);
  effects.ages[index] = life;
  effects.lifetimes[index] = life;
  effects.sizes[index] = size;
  effects.stretches[index] = stretch;
  effects.alphas[index] = 0;
  effects.seeds[index] = Math.random();
}

function updateParticles(dt) {
  const speedFactor = THREE.MathUtils.smoothstep(vehicle.speedKph, 65, 320);
  const particlesPerSecond = 82 * speedFactor ** 1.65 + (vehicle.boosting ? 190 : 0) + (vehicle.drifting ? 135 : 0);
  effects.spawnCarry += particlesPerSecond * dt;
  const spawnRate = Math.min(10, Math.floor(effects.spawnCarry));
  effects.spawnCarry -= spawnRate;
  vehicle.getForwardVector(forward);
  vehicle.getRightVector(right);
  for (let i = 0; i < spawnRate; i += 1) {
    const direction = i % 2 ? 1 : -1;
    const roadSkim = speedFactor > 0.34 && !vehicle.drifting && i % 3 === 0;
    if (roadSkim) {
      const side = direction * (2.5 + Math.random() * 2.4);
      particleSpawn.copy(vehicle.position)
        .addScaledVector(forward, 1 + Math.random() * 9)
        .addScaledVector(right, side);
      particleSpawn.y += 0.07 + Math.random() * 0.13;
      particleVelocity.copy(vehicle.velocity).multiplyScalar(-0.08)
        .addScaledVector(forward, -(10 + speedFactor * 13));
      spawnParticle(
        particleSpawn,
        particleVelocity,
        0.28 + Math.random() * 0.28,
        0.12 + Math.random() * 0.08,
        0.18 + Math.random() * 0.18,
      );
    } else {
      const side = direction * (0.68 + Math.random() * 0.28);
      particleSpawn.copy(vehicle.position)
        .addScaledVector(forward, -1.92 - Math.random() * 0.34)
        .addScaledVector(right, side);
      particleSpawn.y += 0.2 + Math.random() * 0.12;
      particleVelocity.copy(vehicle.velocity).multiplyScalar(-0.18)
        .addScaledVector(forward, -(4 + speedFactor * 8))
        .addScaledVector(right, side * (vehicle.drifting ? 2.8 : 0.5));
      particleVelocity.y += 0.42 + Math.random() * 1.15;
      spawnParticle(
        particleSpawn,
        particleVelocity,
        0.42 + Math.random() * 0.46,
        0.15 + Math.random() * 0.09,
        0.52 + Math.random() * 0.28,
      );
    }
  }

  for (let i = 0; i < effects.maxParticles; i += 1) {
    if (effects.ages[i] <= 0) continue;
    effects.ages[i] -= dt;
    const offset = i * 3;
    if (effects.ages[i] <= 0) {
      effects.positions[offset] = 5000;
      effects.positions[offset + 1] = 5000;
      effects.positions[offset + 2] = 5000;
      effects.alphas[i] = 0;
      continue;
    }
    effects.positions[offset] += effects.velocities[i].x * dt;
    effects.positions[offset + 1] += effects.velocities[i].y * dt;
    effects.positions[offset + 2] += effects.velocities[i].z * dt;
    const remaining = effects.ages[i] / Math.max(0.001, effects.lifetimes[i]);
    const progress = 1 - remaining;
    const fadeIn = Math.min(1, progress / 0.12);
    const flutter = 0.7 + effects.seeds[i] * 0.3 + Math.sin(elapsed * 31 + effects.seeds[i] * 19) * 0.08;
    effects.alphas[i] = Math.max(0, fadeIn * remaining ** 0.78 * flutter);
  }
  effects.particles.geometry.attributes.position.needsUpdate = true;
  effects.particles.geometry.attributes.pointSize.needsUpdate = true;
  effects.particles.geometry.attributes.pointAlpha.needsUpdate = true;
  effects.particles.material.uniforms.opacity.value = vehicle.drifting
    ? 0.78
    : vehicle.boosting
      ? 1
      : 0.36 + speedFactor * 0.42;
}

function updateCarVisuals(dt) {
  const safeDelta = Math.max(1 / 240, dt);
  const spin = vehicle.state.forwardSpeed * dt / 0.43;
  const wheelMotion = THREE.MathUtils.smoothstep(Math.abs(vehicle.speedKph), 35, 260);
  (hero.userData.wheels ?? []).forEach((wheel, index) => {
    wheel.rotation.x = THREE.MathUtils.euclideanModulo(wheel.rotation.x + spin, Math.PI * 2);
    if (index >= 2) wheel.rotation.y = vehicle.steering * 0.32;
  });
  for (const accent of hero.userData.wheelAccents ?? []) {
    accent.material.emissiveIntensity = 0.28 + wheelMotion * 0.58;
  }
  for (const band of hero.userData.wheelMotionBands ?? []) {
    band.material.opacity = 0.04 + wheelMotion * 0.2;
  }

  const speedPose = THREE.MathUtils.smoothstep(vehicle.speedKph, 80, 300);
  const longitudinalAcceleration = THREE.MathUtils.clamp(
    (vehicle.state.forwardSpeed - previousForwardSpeed) / safeDelta,
    -18,
    18,
  );
  previousForwardSpeed = vehicle.state.forwardSpeed;
  const poseRoot = hero.userData.poseRoot ?? hero;
  const lateralLoad = THREE.MathUtils.clamp(
    (vehicle.state.forwardSpeed * vehicle.state.yawRate) / 9.81,
    -1.5,
    1.5,
  );
  const pitchTarget = THREE.MathUtils.clamp(
    -(longitudinalAcceleration / 9.81) * 0.018
      - vehicle.input.throttle * speedPose * 0.012
      + vehicle.input.brake * 0.014,
    -0.05,
    0.046,
  );
  const rollTarget = THREE.MathUtils.clamp(
    -vehicle.steering * (0.024 + speedPose * 0.042)
      - vehicle.state.slipAngle * 0.07
      - lateralLoad * (0.012 + speedPose * 0.012),
    -0.09,
    0.09,
  );
  poseRoot.rotation.x = THREE.MathUtils.damp(poseRoot.rotation.x, pitchTarget, 7.5, dt);
  poseRoot.rotation.z = THREE.MathUtils.damp(poseRoot.rotation.z, rollTarget, 6.8, dt);
  const suspensionNoise = (
    Math.sin(elapsed * 13.5)
    + Math.sin(elapsed * 21.7 + 0.8) * 0.42
    + Math.sin(elapsed * 7.3 + 2.1) * 0.26
  ) * speedPose * 0.008;
  const suspensionOffset = suspensionNoise + vehicle.state.collisionImpact * 0.018;
  if (poseRoot === hero) {
    hero.position.y = vehicle.position.y + suspensionOffset;
  } else {
    poseRoot.position.y = THREE.MathUtils.damp(poseRoot.position.y, suspensionOffset, 10, dt);
  }

  (hero.userData.nitroFlames ?? []).forEach((flame, index) => {
    flame.visible = vehicle.boosting;
    const pulse = 0.82
      + Math.sin(elapsed * 37 + index * 1.7) * 0.13
      + Math.sin(elapsed * 61 + index * 2.4) * 0.06;
    flame.scale.set(0.72 + pulse * 0.32, 0.7 + pulse * 0.24, 1.05 + pulse * 1.28);
  });
  if (hero.userData.underglow?.material) {
    hero.userData.underglow.material.opacity = vehicle.boosting ? 0.27 : 0.12 + speedPose * 0.035;
  }
  const braking = vehicle.input.brake > 0.05;
  (hero.userData.brakeLights ?? []).forEach((light) => {
    const targetScale = braking ? 1.08 : 1;
    light.scale.setScalar(THREE.MathUtils.damp(light.scale.x, targetScale, 16, dt));
  });
  for (const material of hero.userData.tailLightMaterials ?? []) {
    if (!('emissiveIntensity' in material)) continue;
    const idle = material.userData.idleEmissive ?? 0.2;
    const brake = material.userData.brakeEmissive ?? 0.9;
    material.emissiveIntensity = braking ? brake : idle + speedPose * 0.06;
  }
  if (hero.userData.contactShadow?.material) {
    hero.userData.contactShadow.material.opacity = 0.74 + speedPose * 0.1;
    hero.userData.contactShadow.scale.set(1 + speedPose * 0.035, 1 + speedPose * 0.07, 1);
  }
  const wheelShadow = hero.userData.wheelContactShadows?.children?.[0]?.material;
  if (wheelShadow) wheelShadow.opacity = 0.55 + speedPose * 0.08;
  document.body.classList.toggle('boosting', vehicle.boosting);
}

function updateRivals(dt) {
  raceSystem.update(dt);
  if (!isOnline) return;
  const response = 1 - Math.exp(-12 * dt);
  for (const remote of remotePlayers.values()) {
    remote.object.position.lerp(remote.targetPosition, response);
    const angleDelta = Math.atan2(
      Math.sin(remote.targetYaw - remote.object.rotation.y),
      Math.cos(remote.targetYaw - remote.object.rotation.y),
    );
    remote.object.rotation.y += angleDelta * response;
    for (const wheel of remote.object.userData?.wheels ?? []) {
      wheel.rotation.x += (remote.speed * Math.min(dt, 0.05)) / 0.43;
    }
  }
}

function receiveOnlineSnapshot(message) {
  for (const state of message.players ?? []) {
    if (state.id === onlineSession?.selfId) continue;
    const remote = remotePlayers.get(state.id);
    if (!remote) continue;
    remote.targetPosition.set(state.x, state.y, state.z);
    remote.targetYaw = state.yaw;
    remote.speed = state.speed;
    remote.progress = state.progress;
    remote.lap = state.lap;
    remote.finished = state.finished;
    remote.finishTime = state.finishTime;
    remote.receivedAt = performance.now();
  }
}

function sendOnlineState(now = performance.now()) {
  if (!isOnline || !raceStarted || now - lastNetworkSendAt < 66) return;
  lastNetworkSendAt = now;
  networkSequence += 1;
  onlineSession.sendState({
    sequence: networkSequence,
    x: vehicle.position.x,
    y: vehicle.position.y,
    z: vehicle.position.z,
    yaw: vehicle.heading,
    speed: vehicle.state.forwardSpeed,
    progress: Math.min(vehicle.state.totalLaps, vehicle.state.lapsCompleted + vehicle.state.lapProgress),
    lap: vehicle.lap,
    finished: vehicle.state.finished,
    finishTime: vehicle.state.result?.finalTime ?? null,
  });
}

function getOnlineStandings() {
  const entries = [{
    id: onlineSession.selfId,
    progress: Math.min(vehicle.state.totalLaps, vehicle.state.lapsCompleted + vehicle.state.lapProgress),
    finished: vehicle.state.finished,
    finishTime: vehicle.state.result?.finalTime ?? Infinity,
    isPlayer: true,
  }];
  for (const remote of remotePlayers.values()) {
    entries.push({
      id: remote.id,
      progress: remote.progress,
      finished: remote.finished,
      finishTime: remote.finishTime ?? Infinity,
      isPlayer: false,
    });
  }
  entries.sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.progress - a.progress;
  });
  return entries.map((entry, index) => ({ ...entry, position: index + 1 }));
}

function updateCamera(dt) {
  vehicle.getForwardVector(forward);
  vehicle.getRightVector(right);
  const speedFactor = THREE.MathUtils.smoothstep(vehicle.speedKph, 50, 330);
  const portrait = camera.aspect < 0.8;
  const compactLandscape = camera.aspect > 1.25 && innerHeight < 500;
  const targetFov = portrait
    ? 52 + speedFactor * 7 + (vehicle.boosting ? 4 : 0)
    : compactLandscape
      ? 52.5 + speedFactor * 8.5 + (vehicle.boosting ? 4 : 0)
      : 54 + speedFactor * 10 + (vehicle.boosting ? 5 : 0);
  const desiredDistance = portrait
    ? 10.4 + speedFactor * 0.35 + (vehicle.boosting ? 0.12 : 0)
    : compactLandscape
      ? 6.65 + speedFactor * 0.3 + (vehicle.boosting ? 0.1 : 0)
      : 7.8 + speedFactor * 0.42 + (vehicle.boosting ? 0.15 : 0);
  const minShare = portrait ? 0.24 : 0.14;
  const vehicleWidth = hero.userData.dimensions?.x ?? 2.4;
  const maxDistance = (vehicleWidth * 0.94) / (
    2 * minShare * Math.tan(THREE.MathUtils.degToRad(targetFov * 0.5)) * camera.aspect
  );
  const distance = Math.min(desiredDistance, maxDistance);
  const height = portrait
    ? 3.75 + speedFactor * 0.2
    : compactLandscape
      ? 2.3 + speedFactor * 0.24
      : 2.55 + speedFactor * 0.28;
  desiredCamera.copy(vehicle.position)
    .addScaledVector(forward, -distance)
    .addScaledVector(right, -vehicle.state.slipAngle * 2.5 - vehicle.steering * speedFactor * 0.25);
  desiredCamera.y += height;
  const cameraResponse = raceStarted ? 1 - Math.exp(-5.8 * dt) : 1 - Math.exp(-3.4 * dt);
  camera.position.lerp(desiredCamera, cameraResponse);
  lookTarget.copy(vehicle.position).addScaledVector(
    forward,
    portrait ? 7.8 + speedFactor * 3.2 : compactLandscape ? 8 + speedFactor * 4.8 : 9 + speedFactor * 6,
  );
  lookTarget.addScaledVector(right, vehicle.steering * speedFactor * 0.45);
  lookTarget.y += portrait ? 0.2 : compactLandscape ? 0.82 : 1.05;
  cameraTarget.lerp(lookTarget, 1 - Math.exp(-7 * dt));
  camera.lookAt(cameraTarget);
  camera.rotation.z -= vehicle.steering * speedFactor * 0.018;
  const shake = preferences.cameraShake
    ? speedFactor ** 2 * 0.012 + (vehicle.boosting ? 0.024 : 0) + vehicle.state.collisionImpact * 0.14
    : 0;
  cameraShakeOffset.copy(right).multiplyScalar(Math.sin(elapsed * 43) * shake);
  cameraShakeOffset.y = Math.sin(elapsed * 59) * shake * 0.55;
  camera.position.add(cameraShakeOffset);
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, dt);
  camera.updateProjectionMatrix();
  const baseBloom = activeTrack.bloomStrength;
  bloom.strength = THREE.MathUtils.damp(bloom.strength, vehicle.boosting ? baseBloom + 0.22 : baseBloom, 4, dt);
  speedPost.update({ speedKph: vehicle.speedKph, boosting: vehicle.boosting, aspect: camera.aspect, delta: dt });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(3).padStart(6, '0')}`;
}

function formatScore(score) {
  return String(Math.max(0, Math.round(score || 0))).padStart(6, '0');
}

function getModeBest(modeId) {
  if (modeId === 'timeTrial') return raceRecords.timeTrialBest;
  if (modeId === 'drift') return raceRecords.driftBest;
  if (modeId === 'items') return raceRecords.itemBest;
  return raceRecords.bestTime;
}

function renderHomeRecords() {
  const best = getModeBest(selectedMode);
  ui.homeBestLabel.textContent = selectedMode === 'drift' ? 'HIGH SCORE' : 'PERSONAL BEST';
  ui.homeBest.textContent = selectedMode === 'drift'
    ? formatScore(best)
    : best === null
      ? '--:--.---'
      : formatTime(best);
  ui.homeRaces.textContent = String(raceRecords.modeRaces[selectedMode] ?? 0);
  ui.homeWins.textContent = String(raceRecords.wins);
}

function setRivalsVisible(count = 0) {
  rivals.forEach((rival, index) => { rival.object.visible = index < count; });
}

function selectMode(modeId, { persist = true } = {}) {
  if (!RACE_MODES[modeId]) return;
  selectedMode = modeId;
  const mode = RACE_MODES[modeId];
  for (const button of document.querySelectorAll('[data-race-mode]')) {
    const selected = button.dataset.raceMode === modeId;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  }
  ui.homeEventMeta.textContent = mode.meta;
  ui.homeEventTitle.textContent = mode.title;
  ui.homeEventRules.textContent = mode.rules;
  if (persist) {
    preferences = savePreferences({ ...preferences, lastMode: modeId });
  }
  renderHomeRecords();
}

function prepareRace(modeId = activeMode) {
  activeMode = RACE_MODES[modeId] ? modeId : 'race';
  const mode = RACE_MODES[activeMode];
  vehicle.clearInput();
  vehicle.reset({
    position: (isOnline ? playerStartPoint : startPoint).clone().add(new THREE.Vector3(0, 0.05, 0)),
    heading: isOnline ? playerStartHeading : startHeading,
    nitro: STARTING_NITRO,
  });
  previousForwardSpeed = 0;
  raceSystem.configure({ totalLaps: mode.laps, rivalCount: isOnline ? 0 : mode.rivals });
  setRivalsVisible(isOnline ? 0 : mode.rivals);
  itemRace.reset({ enabled: !isOnline && activeMode === 'items' });
  document.body.dataset.raceMode = activeMode;
}

function syncSettingsUi() {
  ui.soundEnabled.checked = preferences.soundEnabled;
  ui.masterVolume.value = String(preferences.masterVolume);
  ui.masterVolume.disabled = !preferences.soundEnabled;
  ui.volumeValue.textContent = `${Math.round(preferences.masterVolume * 100)}%`;
  ui.qualitySetting.value = preferences.quality;
  ui.vibrationEnabled.checked = preferences.vibration;
  ui.cameraShakeEnabled.checked = preferences.cameraShake;
}

function applyPreferences(changes) {
  preferences = savePreferences({ ...preferences, ...changes });
  audio.setVolume(preferences.masterVolume);
  audio.setMuted(!preferences.soundEnabled);
  qualityTier = resolveQualityTier(detectedQualityTier);
  renderer.shadowMap.enabled = qualityTier !== 'balanced';
  syncSettingsUi();
  resize();
}

function setSettingsVisible(visible) {
  ui.settingsMenu.hidden = !visible;
  if (visible) syncSettingsUi();
}

function haptic(pattern) {
  if (!preferences.vibration) return;
  navigator.vibrate?.(pattern);
}

function showCallout(text, duration = 1.1) {
  ui.callout.textContent = text;
  ui.callout.animate([
    { opacity: 0, transform: 'translateY(12px) scale(.85)' },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.2 },
    { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.75 },
    { opacity: 0, transform: 'translateY(-10px) scale(1.08)' },
  ], { duration: duration * 1000, easing: 'cubic-bezier(.2,.8,.2,1)' });
  clearTimeout(calloutTimeout);
  calloutTimeout = setTimeout(() => { ui.callout.textContent = ''; }, duration * 1000);
}

function updateUi() {
  const kph = Math.round(vehicle.speedKph);
  ui.speed.textContent = String(Math.min(kph, 999)).padStart(3, '0');
  ui.gear.textContent = kph < 2 ? 'N' : String(Math.min(7, Math.max(1, Math.floor(kph / 48) + 1)));
  ui.tachFill.style.width = `${Math.min(100, (kph / 350) * 100)}%`;
  ui.nitroFill.style.width = `${vehicle.state.nitroNormalized * 100}%`;
  ui.nitroPct.textContent = String(Math.round(vehicle.state.nitro));
  const item = itemRace.inventory ? ITEM_DEFINITIONS[itemRace.inventory] : null;
  ui.itemIcon.textContent = item?.icon ?? '?';
  ui.itemName.textContent = item?.label ?? '等待拾取';
  ui.itemUse.disabled = !item || !raceStarted || paused;
  ui.itemUse.classList.toggle('ready', Boolean(item && raceStarted && !paused));
  ui.itemUse.setAttribute('aria-label', item ? `使用${item.label}` : '尚未获得道具');
  ui.lap.innerHTML = `${vehicle.lap}<small>/ ${RACE_MODES[activeMode].laps}</small>`;
  ui.time.textContent = formatTime(vehicle.state.raceTime);
  ui.sector.textContent = String(Math.min(3, Math.floor(vehicle.progress * 3) + 1)).padStart(2, '0');
  ui.checkpoint.textContent = `${String(vehicle.state.nextCheckpoint).padStart(2, '0')} / ${vehicle.state.checkpointCount}`;
  const liveDriftScore = Math.round(vehicle.state.skillScore + vehicle.state.driftScore);
  ui.driftScore.textContent = String(liveDriftScore).padStart(6, '0');
  const chain = Math.max(vehicle.state.combo, vehicle.state.nitroChain, 1);
  ui.combo.textContent = `x${chain}`;
  ui.comboBlock.classList.toggle('active', chain > 1);

  const onlineStandings = isOnline ? getOnlineStandings() : null;
  const playerPosition = onlineStandings?.find((entry) => entry.isPlayer)?.position ?? raceSystem.state.playerPosition;
  const entrantCount = onlineStandings?.length ?? raceSystem.state.entrantCount;
  ui.position.innerHTML = `${playerPosition}<small>/ ${entrantCount}</small>`;
  drawMinimap();
}

const mapCanvas = document.querySelector('#minimap');
const mapContext = mapCanvas.getContext('2d');
const mapPoints = trackCurve.getSpacedPoints(180);
const bounds = mapPoints.reduce((box, point) => ({
  minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
  minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

function mapPosition(point) {
  const padding = 24;
  const width = mapCanvas.width - padding * 2;
  const height = mapCanvas.height - padding * 2;
  const scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxZ - bounds.minZ));
  return {
    x: mapCanvas.width / 2 + (point.x - (bounds.minX + bounds.maxX) / 2) * scale,
    y: mapCanvas.height / 2 + (point.z - (bounds.minZ + bounds.maxZ) / 2) * scale,
  };
}

function drawMinimap() {
  const ctx = mapContext;
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.fillStyle = 'rgba(3, 9, 13, .72)';
  ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  ctx.beginPath();
  mapPoints.forEach((point, i) => {
    const mapped = mapPosition(point);
    if (i === 0) ctx.moveTo(mapped.x, mapped.y); else ctx.lineTo(mapped.x, mapped.y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(115, 170, 182, .38)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(134, 239, 255, .88)';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#35e7ff';
  ctx.shadowBlur = 7;
  ctx.stroke();
  ctx.shadowBlur = 0;
  rivals.filter((rival) => rival.object.visible).forEach((rival) => {
    const mapped = mapPosition(trackCurve.getPointAt((rival.progress + 1) % 1));
    ctx.fillStyle = '#ff596c';
    ctx.beginPath(); ctx.arc(mapped.x, mapped.y, 2.3, 0, Math.PI * 2); ctx.fill();
  });
  for (const remote of remotePlayers.values()) {
    const mapped = mapPosition(remote.object.position);
    ctx.fillStyle = '#ffcf5a';
    ctx.beginPath(); ctx.arc(mapped.x, mapped.y, 2.8, 0, Math.PI * 2); ctx.fill();
  }
  const player = mapPosition(vehicle.position);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#35e7ff';
  ctx.shadowBlur = 9;
  ctx.beginPath(); ctx.arc(player.x, player.y, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

function updateCountdown(dt) {
  if (homeVisible || waitingForOnlineStart || raceStarted || paused) return;
  countdown -= dt;
  const value = Math.ceil(countdown);
  if (value > 0) {
    const nextText = String(value);
    if (ui.countdown.textContent !== nextText) {
      ui.countdown.textContent = nextText;
      ui.countdown.classList.remove('pulse');
      void ui.countdown.offsetWidth;
      ui.countdown.classList.add('pulse');
      audio.countdown(false);
    }
  } else {
    raceStarted = true;
    vehicle.startRace({ totalLaps: RACE_MODES[activeMode].laps });
    raceSystem.start();
    ui.countdown.textContent = 'GO!';
    ui.countdown.classList.remove('pulse');
    void ui.countdown.offsetWidth;
    ui.countdown.classList.add('pulse');
    audio.countdown(true);
    setTimeout(() => { ui.countdown.textContent = ''; }, 700);
  }
}

function resetRace() {
  if (isOnline) {
    showHome();
    return;
  }
  prepareRace(activeMode);
  homeVisible = false;
  document.body.classList.remove('menu-open');
  raceStarted = false;
  countdown = 3;
  paused = false;
  ui.pauseMenu.hidden = true;
  ui.resultMenu.hidden = true;
  ui.homeMenu.hidden = true;
  ui.countdown.textContent = '3';
  clock.getDelta();
}

function startRaceFromHome() {
  if (isOnline) return;
  audio.start();
  prepareRace(selectedMode);
  homeVisible = false;
  paused = false;
  raceStarted = false;
  countdown = 3;
  vehicle.setPaused(false);
  raceSystem.setPaused(false);
  document.body.classList.remove('menu-open');
  ui.homeMenu.hidden = true;
  ui.countdown.textContent = '3';
  clock.getDelta();
}

function showHome() {
  if (isOnline) {
    onlineSession.leave();
    location.reload();
    return;
  }
  vehicle.clearInput();
  vehicle.reset({
    position: startPoint.clone().add(new THREE.Vector3(0, 0.05, 0)),
    heading: startHeading,
    nitro: STARTING_NITRO,
  });
  previousForwardSpeed = 0;
  raceSystem.reset();
  itemRace.reset({ enabled: false });
  homeVisible = true;
  raceStarted = false;
  paused = false;
  countdown = 3;
  vehicle.setPaused(false);
  raceSystem.setPaused(false);
  setRivalsVisible(0);
  ui.pauseMenu.hidden = true;
  ui.resultMenu.hidden = true;
  ui.homeMenu.hidden = false;
  ui.countdown.textContent = '';
  document.body.classList.add('menu-open');
  selectMode(activeMode, { persist: false });
  renderHomeRecords();
  clock.getDelta();
}

function setPaused(value) {
  if (isOnline && value) {
    showCallout('联机比赛不能暂停', 1.1);
    return;
  }
  paused = value;
  vehicle.setPaused(value);
  raceSystem.setPaused(value);
  ui.pauseMenu.hidden = !value || vehicle.state.finished;
  if (!value) ui.resultMenu.hidden = true;
  if (!value) clock.getDelta();
}

document.querySelector('#pause').addEventListener('click', () => setPaused(true));
document.querySelector('#resume').addEventListener('click', () => setPaused(false));
document.querySelector('#restart').addEventListener('click', resetRace);
document.querySelector('#raceAgain').addEventListener('click', resetRace);
document.querySelector('#startRace').addEventListener('click', startRaceFromHome);
ui.itemUse.addEventListener('click', () => itemRace.useItem());
document.querySelector('#toHome').addEventListener('click', showHome);
document.querySelector('#resultHome').addEventListener('click', showHome);
document.querySelector('#openSettings').addEventListener('click', () => setSettingsVisible(true));
document.querySelector('#closeSettings').addEventListener('click', () => setSettingsVisible(false));
for (const button of document.querySelectorAll('[data-race-mode]')) {
  button.addEventListener('click', () => selectMode(button.dataset.raceMode));
}
ui.soundEnabled.addEventListener('change', () => applyPreferences({ soundEnabled: ui.soundEnabled.checked }));
ui.masterVolume.addEventListener('input', () => applyPreferences({ masterVolume: Number(ui.masterVolume.value) }));
ui.qualitySetting.addEventListener('change', () => applyPreferences({ quality: ui.qualitySetting.value }));
ui.vibrationEnabled.addEventListener('change', () => applyPreferences({ vibration: ui.vibrationEnabled.checked }));
ui.cameraShakeEnabled.addEventListener('change', () => applyPreferences({ cameraShake: ui.cameraShakeEnabled.checked }));
window.addEventListener('keydown', (event) => {
  audio.start();
  if (!ui.settingsMenu.hidden) {
    if (event.code === 'Escape') setSettingsVisible(false);
    return;
  }
  if (homeVisible && (event.code === 'Enter' || event.code === 'Space')) {
    event.preventDefault();
    startRaceFromHome();
    return;
  }
  if (homeVisible) return;
  if (event.code === 'KeyE' && activeMode === 'items' && raceStarted && !paused) {
    event.preventDefault();
    itemRace.useItem();
  }
  if (event.code === 'Escape') setPaused(!paused);
  if (event.code === 'KeyR' && raceStarted && !paused) vehicle.respawn('manual');
});
window.addEventListener('pointerdown', () => audio.start(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && raceStarted && !isOnline) setPaused(true);
});

function beginOnlineRace(startAt) {
  audio.start();
  prepareRace('race');
  homeVisible = false;
  paused = false;
  raceStarted = false;
  waitingForOnlineStart = false;
  countdown = Math.max(0.2, (Number(startAt) - Date.now()) / 1000);
  vehicle.setPaused(false);
  raceSystem.setPaused(false);
  document.body.classList.remove('menu-open');
  ui.homeMenu.hidden = true;
  ui.loading.classList.add('done');
  ui.countdown.textContent = String(Math.max(1, Math.ceil(countdown)));
  clock.getDelta();
}

if (isOnline) {
  onlineSession.addEventListener('snapshot', (event) => receiveOnlineSnapshot(event.detail));
  onlineSession.addEventListener('race-start', (event) => beginOnlineRace(event.detail.startAt));
  onlineSession.addEventListener('reconnecting', () => showCallout('正在恢复连接', 1.2));
  onlineSession.addEventListener('resumed', () => showCallout('连接已恢复', 1));
  onlineSession.addEventListener('connection-lost', () => showCallout('连接已断开', 2));
}

vehicle.on('lap', (state) => {
  haptic(25);
  showCallout(`第 ${state.lap} 圈`, 1.5);
});
vehicle.on('driftEnd', ({ points, combo, nitro }) => {
  haptic(18);
  showCallout(`DRIFT +${points}  N2O +${nitro}  x${combo}`, 1.15);
});
vehicle.on('nitroChain', ({ chain }) => {
  haptic([12, 24, 12]);
  showCallout(`NITRO CHAIN x${chain}`, 1.05);
});
vehicle.on('collision', () => haptic(35));
vehicle.on('shortcut', () => showCallout('CHECKPOINT MISSED', 1.2));
vehicle.on('respawn', ({ reason }) => showCallout(reason === 'manual' ? 'RESET' : 'TRACK RESET', 0.9));
itemRace.on('pickup', ({ definition }) => {
  haptic(16);
  showCallout(`${definition.label} 已就绪`, 1);
});
itemRace.on('use', ({ definition, affected }) => {
  haptic([10, 18, 10]);
  showCallout(affected > 0 ? `使用 ${definition.label}` : `${definition.label} 未命中`, 1);
});
itemRace.on('hit', ({ blocked }) => {
  haptic(blocked ? [8, 20, 8] : 45);
  showCallout(blocked ? '护盾抵消攻击' : '遭到道具攻击', 1.05);
});
raceSystem.on('finish', (result) => {
  const mode = RACE_MODES[activeMode];
  const onlineStandings = isOnline ? getOnlineStandings() : null;
  const onlinePosition = onlineStandings?.find((entry) => entry.isPlayer)?.position;
  const modeResult = {
    ...result,
    mode: activeMode,
    position: isOnline ? onlinePosition : mode.rivals === 0 ? 1 : result.position,
    entrants: isOnline ? onlineStandings.length : mode.rivals === 0 ? 1 : result.entrants,
  };
  const recordUpdate = recordRaceResult(modeResult);
  raceRecords = recordUpdate.records;
  showCallout(
    mode.rivals > 0
      ? `FINISH  P${modeResult.position}/${modeResult.entrants}`
      : mode.resultTitle.toUpperCase(),
    2.4,
  );
  setTimeout(() => {
    paused = true;
    vehicle.setPaused(true);
    raceSystem.setPaused(true);
    ui.pauseMenu.hidden = true;
    ui.resultTitle.textContent = activeMode === 'race' && modeResult.cleanRace ? '完美冲线' : mode.resultTitle;
    ui.resultPosition.textContent = String(modeResult.position);
    ui.resultPosition.nextElementSibling.textContent = `/ ${modeResult.entrants}`;
    ui.resultTime.textContent = formatTime(modeResult.finalTime);
    ui.bestLap.textContent = formatTime(modeResult.bestLapTime ?? modeResult.totalTime);
    ui.resultScore.textContent = formatScore(modeResult.skillScore);
    const modeBest = getModeBest(activeMode);
    ui.personalBest.textContent = activeMode === 'drift' ? formatScore(modeBest) : formatTime(modeBest ?? modeResult.finalTime);
    ui.recordStatus.textContent = activeMode === 'drift'
      ? recordUpdate.isNewModeBest ? 'NEW HIGH SCORE' : 'HIGH SCORE'
      : recordUpdate.isNewModeBest ? 'NEW PERSONAL BEST' : 'PERSONAL BEST';
    ui.recordStatus.classList.toggle('new-record', recordUpdate.isNewModeBest);
    ui.resultMenu.hidden = false;
  }, 1750);
});

syncSettingsUi();
selectMode(preferences.lastMode, { persist: false });
setRivalsVisible(0);
ui.hudTrackName.textContent = activeTrack.shortTitle;
ui.raceFeedTitle.textContent = activeTrack.title;
ui.raceFeedMeta.textContent = activeTrack.meta;
document.body.dataset.track = activeTrackId;
document.body.classList.toggle('online-race', isOnline);
for (const button of document.querySelectorAll('[data-track]')) {
  button.addEventListener('click', () => {
    const nextTrack = button.dataset.track;
    if (isOnline || !nextTrack || nextTrack === activeTrackId) return;
    preferences = savePreferences({ ...preferences, lastTrack: nextTrack });
    location.reload();
  });
}

window.__NEON_APEX_ANDROID_BACK__ = () => {
  if (!ui.settingsMenu.hidden) {
    setSettingsVisible(false);
    return true;
  }
  if (!ui.resultMenu.hidden) {
    showHome();
    return true;
  }
  if (homeVisible) return false;
  if (paused) showHome();
  else setPaused(true);
  return true;
};

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const mobile = width < 720 || matchMedia('(pointer: coarse)').matches;
  const tierLimit = qualityTier === 'balanced' ? 0.9 : qualityTier === 'ultra' ? 1.85 : 1.55;
  const ratio = Math.min(window.devicePixelRatio, mobile ? Math.min(1.25, tierLimit) : tierLimit);
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(ratio);
  composer.setSize(width, height);
  speedPost.resize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  effects.particles.material.uniforms.viewportScale.value = camera.aspect < 0.8
    ? 1.42
    : camera.aspect > 1.25 && height < 500
      ? 1.24
      : 1;
  for (let i = 0; i < windStreaks.count; i += 1) windStreaks.reset(i, true);
}
window.addEventListener('resize', resize);
resize();

function animate() {
  requestAnimationFrame(animate);
  if (capturePaused) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  runtimeMonitor.frame(dt);
  if (!paused) {
    elapsed += dt;
    startDelay += dt;
    updateCountdown(dt);
    vehicle.update(raceStarted ? dt : 0);
    updateRivals(dt);
    itemRace.update(dt, { racing: raceStarted });
    sendOnlineState();
    world.update(elapsed);
    updateParticles(dt);
    updateWindStreaks(dt);
    updateCarVisuals(dt);
    updateCamera(dt);
    updateUi();
    audio.update(vehicle.speedKph, vehicle.input.throttle, vehicle.boosting);

    if (vehicle.drifting && !lastDrifting) showCallout('PERFECT DRIFT', 1.05);
    if (vehicle.boosting && !lastBoosting) showCallout('NITRO BURST', 0.9);
    lastDrifting = vehicle.drifting;
    lastBoosting = vehicle.boosting;
  }
  composer.render();

  if (startDelay > 0.25 && !window.__NEON_APEX_READY__) {
    window.__NEON_APEX_READY__ = true;
    window.__NEON_APEX_LOADING__ = false;
    document.body.classList.remove('pre-game', 'game-loading');
    window.__NEON_APEX__ = {
      scene,
      camera,
      renderer,
      world,
      trackCurve,
      vehicle,
      rivals,
      remotePlayers,
      raceSystem,
      itemRace,
      runtimeMonitor,
      qaCaptureProgress(progress, speedMps = 64) {
        capturePaused = false;
        homeVisible = false;
        paused = false;
        raceStarted = true;
        setRivalsVisible(RACE_MODES[activeMode].rivals);
        document.body.classList.remove('menu-open');
        const t = THREE.MathUtils.euclideanModulo(Number(progress) || 0, 1);
        trackCurve.getPointAt(t, tempPoint);
        trackCurve.getTangentAt(t, tempTangent).normalize();
        const heading = Math.atan2(tempTangent.x, tempTangent.z);
        vehicle.reset({ position: tempPoint.clone().addScaledVector(up, 0.05), heading });
        vehicle.velocity.copy(tempTangent).multiplyScalar(speedMps);
        previousForwardSpeed = speedMps;
        vehicle.startRace({ totalLaps: RACE_MODES[activeMode].laps });
        raceSystem.start({ reset: true });
        ui.loading.classList.add('done');
        ui.loading.style.display = 'none';
        ui.pauseMenu.hidden = true;
        ui.resultMenu.hidden = true;
        ui.homeMenu.hidden = true;
        world.update(elapsed);
        updateRivals(0);
        for (let frame = 0; frame < 12; frame += 1) {
          updateParticles(1 / 30);
          updateWindStreaks(1 / 30);
        }
        updateCarVisuals(1 / 60);
        updateCamera(5);
        camera.position.copy(desiredCamera);
        cameraTarget.copy(lookTarget);
        camera.lookAt(cameraTarget);
        updateUi();
        composer.render();
        capturePaused = true;
        return canvas.toDataURL('image/png');
      },
      qaAdvance(seconds = 4, controls = { throttle: 1 }) {
        ui.loading.classList.add('done');
        ui.loading.style.display = 'none';
        homeVisible = false;
        document.body.classList.remove('menu-open');
        ui.homeMenu.hidden = true;
        setRivalsVisible(RACE_MODES[activeMode].rivals);
        if (!raceStarted) {
          raceStarted = true;
          countdown = 0;
          ui.countdown.textContent = '';
          vehicle.startRace({ totalLaps: RACE_MODES[activeMode].laps });
          raceSystem.start();
        }
        const frames = Math.ceil(Math.min(seconds, 12) * 60);
        for (let i = 0; i < frames; i += 1) {
          const step = 1 / 60;
          if (controls.autopilot) {
            const sample = vehicle.sampleTrack();
            const desiredHeading = Math.atan2(sample.tangent.x, sample.tangent.z);
            const angleError = Math.atan2(
              Math.sin(desiredHeading - vehicle.heading),
              Math.cos(desiredHeading - vehicle.heading),
            );
            const steer = THREE.MathUtils.clamp(angleError * 3 - sample.offset * 0.22, -1, 1);
            vehicle.setInput({ ...controls, steer });
          } else {
            vehicle.setInput(controls);
          }
          elapsed += step;
          vehicle.update(step);
          updateRivals(step);
          world.update(elapsed);
          updateParticles(step);
          updateWindStreaks(step);
          updateCarVisuals(step);
        }
        vehicle.setInput({ throttle: 0, brake: 0, steer: 0, drift: 0, nitro: 0 });
        updateCamera(5);
        camera.position.copy(desiredCamera);
        cameraTarget.copy(lookTarget);
        camera.lookAt(cameraTarget);
        updateUi();
        composer.render();
        capturePaused = true;
        return vehicle.getSnapshot();
      },
      get activeMode() { return activeMode; },
      get activeTrack() { return activeTrackId; },
      get online() { return isOnline; },
      get preferences() { return { ...preferences }; },
    };
    if (isOnline) {
      homeVisible = false;
      waitingForOnlineStart = true;
      ui.homeMenu.hidden = true;
      ui.countdown.textContent = '';
      document.body.classList.remove('menu-open');
      const loadingLabel = ui.loading.querySelector('small');
      if (loadingLabel) loadingLabel.textContent = '赛道已就绪，等待其他车手';
      onlineSession.markReady();
    } else {
      ui.loading.classList.add('done');
    }
  }
}

trackCurve.getPointAt((startT - 0.004 + 1) % 1, tempPoint);
trackCurve.getTangentAt(startT, tempTangent).normalize();
camera.position.copy(tempPoint).addScaledVector(tempTangent, -8);
camera.position.y += 4.4;
cameraTarget.copy(startPoint).addScaledVector(tempTangent, 12);
const autoStartMode = window.__NEON_APEX_AUTOSTART__;
delete window.__NEON_APEX_AUTOSTART__;
if (!isOnline && RACE_MODES[autoStartMode]) {
  selectMode(autoStartMode, { persist: false });
  startRaceFromHome();
}
animate();
