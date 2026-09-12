import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { createWorld as createNightWorld, createRivalCar, TRACK_CURVE as NIGHT_TRACK_CURVE } from './world.js';
import { createDayWorld, DAY_TRACK_CURVE } from './day-world.js';
import { createCandyWorld, CANDY_TRACK_CURVE } from './candy-world.js';
import { createCandyKingdomWorld, CANDY_KINGDOM_TRACK_CURVE } from './candy-kingdom-world.js';
import {
  ALPINE_TRACK_CURVE,
  CANYON_TRACK_CURVE,
  COAST_TRACK_CURVE,
  createScenicWorld,
} from './scenic-worlds.js';
import { createDetailedHeroCar } from './vehicle-assets.js';
import { ArcadeVehicle } from './driving.js';
import { createKartCollisionSystem } from './kart-collision.js';
import { RaceSystem } from './race-system.js';
import { RaceAudio, voicePackBaseUrl } from './audio.js';
import { createRacePlaylist } from './race-playlist.js';
import { createRuntimeMonitor } from './telemetry.js';
import { createSpeedPostProcess } from './speed-postprocess.js';
import {
  getModeBest as getDifficultyBest,
  loadRaceRecords,
  recordRaceResult,
  saveGhost,
  loadGhost,
} from './race-records.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { RACE_MODES } from './race-modes.js';
import { TRACK_CATALOG, normalizeTrackId } from './track-catalog.js';
import { ItemRaceSystem, ITEM_DEFINITIONS } from './item-race.js';
import { computeTrackFeatures, featureZonesForPhysics } from './track-features.js';import { buildTrackFeatureMeshes } from './track-feature-meshes.js';
import { createDriftEffects } from './drift-effects.js';
import { DEFAULT_CAR_ID, getCarById, applyCarPhysics } from './car-catalog.js';
import { createHeroCarVariant } from './procedural-vehicle.js';
import { computeVehicleAnimationPose } from './vehicle-animation.js';
import { createGhostPlayer, createGhostRecorder, serializeGhost, deserializeGhost } from './ghost.js';
import { earnCoins, getItemById, isOwned } from './shop.js';
import { getWalletSync } from './wallet-sync.js';
import { createShopUi } from './shop-ui.js';
import { createAchievementsUi } from './achievements-ui.js';
import {
  evaluateAchievements,
  loadAchievementState,
  saveAchievementState,
} from './achievements.js';
import { createLiveryTexture } from './decals.js';
import { createHornPlayer, createSpoiler, createWheelSet } from './car-parts.js';
import {
  applyRaceResult as applyRankResult,
  formatRank,
  getRankTier,
  loadRankState,
  rankStateFromServer,
  saveRankState,
} from './ranked.js';
import { difficultyRule, trackVariantRule } from './race-rules.js';
import { createTrackVariantCurve, variantWorldOptions, applyWorldVariant } from './track-variant.js';
import { buildCornerMarkers } from './track-guidance.js';
import { createRouteNavigator } from './route-navigator.js';
import { loadChallengeState, saveChallengeState, updateChallenges } from './challenges.js';
import { createTrainingCoach } from './training.js';

let preferences = loadPreferences();
const activeTrackId = normalizeTrackId(window.__NEON_APEX_TRACK__ || preferences.lastTrack);
const activeTrack = TRACK_CATALOG[activeTrackId];
const onlineSession = window.__NEON_APEX_ONLINE__ || null;
const isOnline = Boolean(onlineSession?.room);
const selfOnlinePlayer = onlineSession?.room?.players?.find((player) => player.id === onlineSession.selfId) ?? null;
const isSpectator = Boolean(selfOnlinePlayer?.spectator);
const activeTrackVariant = trackVariantRule(
  isOnline ? onlineSession.room.trackVariant : (window.__NEON_APEX_TRACK_VARIANT__ || preferences.trackVariant),
);
const TRACK_RUNTIMES = Object.freeze({
  night: Object.freeze({
    curve: NIGHT_TRACK_CURVE,
    createWorld: (targetScene, options) => createNightWorld(targetScene, options),
  }),
  day: Object.freeze({
    curve: DAY_TRACK_CURVE,
    createWorld: (targetScene, options) => createDayWorld(targetScene, options),
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
  candy: Object.freeze({
    curve: CANDY_TRACK_CURVE,
    createWorld: (targetScene, options) => createCandyWorld(targetScene, options),
  }),
  candyland: Object.freeze({
    curve: CANDY_KINGDOM_TRACK_CURVE,
    createWorld: (targetScene, options) => createCandyKingdomWorld(targetScene, options),
  }),
});
const activeTrackRuntime = TRACK_RUNTIMES[activeTrackId] ?? TRACK_RUNTIMES.night;
const baseTrackCurve = activeTrackRuntime.curve;
const trackCurve = createTrackVariantCurve(baseTrackCurve, activeTrackVariant.id);
const STARTING_NITRO = 38;

function resolveQualityTier(detectedTier) {
  return preferences.quality === 'auto' ? detectedTier : preferences.quality;
}

// Software/WebGL fallback devices can spend minutes compiling every unique
// Standard/Physical lighting permutation before the first frame. Balanced is
// intentionally a visual fallback tier: keep authored textures and colors,
// but use one cheap unlit shader family so the track becomes interactive first.
const canvas = document.querySelector('#game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
  stencil: false,
  depth: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = activeTrack.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const runtimeMonitor = createRuntimeMonitor({ renderer, canvas });
const detectedQualityTier = runtimeMonitor.snapshot().qualityTier;
let qualityTier = resolveQualityTier(detectedQualityTier);
renderer.shadowMap.enabled = qualityTier !== 'balanced';
renderer.shadowMap.type = qualityTier === 'ultra' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = true;
renderer.setClearColor(0x05080b, 1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.clear();
// Commit the loading UI and a deterministic dark canvas before synchronous
// world construction or shader compilation can occupy the main thread. Two
// frames are required: a single rAF resumes its promise before that frame is
// painted, whereas the second callback guarantees one composited frame.
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const [gtaoModule, smaaModule] = qualityTier === 'balanced'
  ? [{ GTAOPass: null }, { SMAAPass: null }]
  : await Promise.all([
    import('three/addons/postprocessing/GTAOPass.js'),
    import('three/addons/postprocessing/SMAAPass.js'),
  ]);
const GTAOPass = gtaoModule.GTAOPass;
const SMAAPass = smaaModule.SMAAPass;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const fallbackEnvironment = pmrem.fromScene(new RoomEnvironment(), 0.04);
scene.environment = fallbackEnvironment.texture;
scene.environmentIntensity = activeTrack.environmentIntensity;
pmrem.dispose();
if (activeTrack.environmentAsset) {
  const environmentUrl = `/assets/environment/polyhaven/${activeTrack.environmentAsset}`;
  new RGBELoader().load(
    environmentUrl,
    (texture) => {
      const hdriPmrem = new THREE.PMREMGenerator(renderer);
      const hdriEnvironment = hdriPmrem.fromEquirectangular(texture);
      scene.environment = hdriEnvironment.texture;
      scene.environmentIntensity = activeTrack.environmentIntensity;
      scene.environmentRotation.y = activeTrack.environmentRotation ?? 0;
      texture.dispose();
      fallbackEnvironment.dispose();
      hdriPmrem.dispose();
    },
    undefined,
    (error) => runtimeMonitor.assetFailure(activeTrack.environmentAsset, error),
  );
}
const camera = new THREE.PerspectiveCamera(57, 1, 0.1, 1900);
const composer = qualityTier === 'balanced' ? null : new EffectComposer(renderer);
composer?.addPass(new RenderPass(scene, camera));
// GTAO supplies the grounded contact shading that flat forward lighting cannot
// provide. It is kept off on balanced devices because its depth/normal buffer
// costs more than the mobile preset can afford.
const gtao = qualityTier === 'balanced' ? null : new GTAOPass(scene, camera, 1, 1);
if (gtao && composer) {
  // Default 才是"场景 + 遮蔽混合"。Denoise 会以 NoBlending 把降噪后的 AO 缓冲直接
  // 写出去，等于丢掉整帧画面只留一张 AO 图 —— 无遮蔽处是白的，整屏就白了，
  // 而且 blendIntensity 在那条分支里根本不参与。
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = qualityTier === 'ultra' ? 1.28 : 1.05;
  gtao.updateGtaoMaterial({
    radius: qualityTier === 'ultra' ? 3.5 : 2.6,
    distanceExponent: 1.35,
    thickness: qualityTier === 'ultra' ? 1.35 : 1.1,
    distanceFallOff: 1.1,
    scale: 1.15,
  });
  composer.addPass(gtao);
}
const bloom = new UnrealBloomPass(
  new THREE.Vector2(1, 1),
  activeTrack.bloomStrength,
  activeTrack.bloomRadius,
  activeTrack.bloomThreshold,
);
composer?.addPass(bloom);
const speedPost = createSpeedPostProcess({ qualityTier });
composer?.addPass(speedPost.pass);
const smaa = qualityTier === 'balanced' ? null : new SMAAPass();
if (smaa && composer) composer.addPass(smaa);
composer?.addPass(new OutputPass());

function renderFrame() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

const trackFeatures = computeTrackFeatures(trackCurve, { trackId: activeTrackId, roadWidth: 16 });
const featureZones = featureZonesForPhysics(trackFeatures);
const world = activeTrackRuntime.createWorld(scene, {
  qualityTier,
  shortcutZones: variantWorldOptions(featureZones, activeTrackVariant.id).shortcuts,
  onEnvironmentAssetError: (error, kind) => runtimeMonitor.assetFailure(`environment:${kind}`, error),
});
applyWorldVariant(world, activeTrackVariant.id);
const featureMeshes = buildTrackFeatureMeshes(trackFeatures, { theme: activeTrackId });
scene.add(featureMeshes);
scene.add(buildCornerMarkers(trackCurve, { theme: activeTrackId, qualityTier, shortcutZones: featureZones.shortcuts, ground: world.ground }));
const selectedCar = getCarById(preferences.carId);
const ownedCar = isOwned(getWalletSync().read(), selectedCar.id) ? selectedCar : getCarById(DEFAULT_CAR_ID);
// The detailed 12 MB car must never block the first rendered frame. Start with
// the matching procedural car and upgrade it after the game is interactive.
let hero = createHeroCarVariant(ownedCar);
hero.visible = !isSpectator;
scene.add(hero);

const vehicle = new ArcadeVehicle(applyCarPhysics({
  object: hero,
  trackCurve,
  trackWidth: 16,
  trackSamples: 520,
  totalLaps: 3,
  rideHeight: 0.05,
  maxSpeed: 82,
  acceleration: 34,
  nitroSpeedMultiplier: 1.3,
  steeringRate: 2.25,
  normalGrip: 10.5,
  nitroAcceleration: 25,
  nitroDrainRate: 25,
  driftNitroRate: 18,
  miniBoostAcceleration: 30,
  miniBoostDuration: 0.62,
  difficulty: preferences.difficulty,
}, ownedCar));
vehicle.setTrackFeatures(featureZones);
if (!isSpectator) {
  vehicle.bindKeyboard(window);
  vehicle.bindTouchControls({
    left: '[data-control="left"]',
    right: '[data-control="right"]',
    accelerate: '[data-control="accelerate"]',
    brake: '[data-control="brake"]',
    drift: '[data-control="drift"]',
    nitro: '[data-control="nitro"]',
  });
}

const startT = 0.002;
const startPoint = trackCurve.getPointAt(startT);
const startTangent = trackCurve.getTangentAt(startT).normalize();
const startHeading = Math.atan2(startTangent.x, startTangent.z);
const participantRoster = (onlineSession?.room?.players ?? []).filter((entry) => !entry.spectator);
const onlinePlayerIndex = Math.max(0, participantRoster.findIndex((entry) => entry.id === onlineSession.selfId));
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
    speed: 62 + index * 1.9,
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
  trackFeatures: featureZones,
  // Rivals now earn their pace from pads and ramps instead of a flat speed
  // bonus. 0.976 cancels the v1.5.0 hand-tuned bump so difficulty is unchanged.
  speedCompensation: 0.976,
  kartCollisions: Boolean(RACE_MODES[onlineSession?.room?.raceMode || window.__NEON_APEX_RACE_MODE__]?.kartCollisions),
});
const itemRace = new ItemRaceSystem({ scene, player: vehicle, rivals, trackCurve });

const remotePlayers = new Map();
for (const [index, player] of participantRoster.entries()) {
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
audio.setVoiceEnabled(preferences.voiceEnabled);
audio.loadVoiceBank(voicePackBaseUrl(preferences.voicePack));
const music = createRacePlaylist(audio);
music.setVolume(preferences.musicVolume);
music.setEnabled(preferences.musicEnabled);
const driftEffects = createDriftEffects({ scene });
driftEffects.setQuality(qualityTier === 'balanced' ? 'low' : qualityTier === 'ultra' ? 'high' : 'medium');
const ghostPlayer = createGhostPlayer();
let ghostRecorder = null;
let ghostCar = null;
let ghostData = null;
let rankState = loadRankState();
const walletSync = getWalletSync();
let wallet = walletSync.read();
let achievementState = loadAchievementState();
let challengeState = loadChallengeState();
const trainingCoach = createTrainingCoach();

// Per-race tallies feeding the achievement checks at the finish line.
const raceTally = {
  maxBoostChain: 0,
  perfectStart: false,
  landingBoosts: 0,
  // Pads are deduped by id: crossing the same strip on every lap is one pad.
  padIds: new Set(),
  shortcutRuns: 0,
  driftScore: 0,
};

function resetRaceTally() {
  raceTally.maxBoostChain = 0;
  raceTally.perfectStart = false;
  raceTally.landingBoosts = 0;
  raceTally.padIds.clear();
  raceTally.shortcutRuns = 0;
  raceTally.driftScore = 0;
}

let raceRecords = loadRaceRecords();
const clock = new THREE.Clock();
const cameraTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const tempPoint = new THREE.Vector3();
const tempTangent = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);
const particleSpawn = new THREE.Vector3();
const particleVelocity = new THREE.Vector3();
const cameraShakeOffset = new THREE.Vector3();
const ui = collectUi();

let elapsed = 0;
let countdown = 3;
let raceStarted = false;
let homeVisible = true;
let selectedMode = isOnline
  ? (RACE_MODES[onlineSession?.room?.raceMode] ? onlineSession.room.raceMode : 'race')
  : preferences.lastMode;
let activeMode = selectedMode;
let paused = false;
let lastDrifting = false;
let lastBoosting = false;
let calloutTimeout = 0;
let startDelay = 0;
let capturePaused = false;
let previousForwardSpeed = 0;
let wheelTravelDistance = 0;
let waitingForOnlineStart = isOnline;

const kartCollisions = createKartCollisionSystem({
  player: vehicle,
  rivals,
  remotePlayers,
  trackCurve,
  isEnabled: () => raceStarted && !paused && Boolean(RACE_MODES[activeMode]?.kartCollisions),
  onCollision: ({ impact, headOnRatio, collisionType }) => {
    const message = collisionType === 'head-on' || headOnRatio > 0.65
      ? '正面碰撞！'
      : collisionType === 'rear-end' ? '追尾减速！' : impact > 1.1 ? '猛烈侧撞！' : '车辆接触';
    showCallout(message, 0.65);
    haptic(impact > 1.1 ? [18, 28, 18] : 16);
    fovRush = Math.max(fovRush, Math.min(0.65, impact * 0.25));
  },
});
let lastNetworkSendAt = 0;
let networkSequence = 0;
let fovRush = 0;
let launchThrottleAt = null;
let lastPlayerPosition = null;
let overtakeCooldown = 0;
const driftFrame = {
  position: null,
  heading: 0,
  drifting: false,
  driftIntensity: 0,
  chargeLevel: 0,
  boosting: false,
  miniBoostActive: false,
  airborne: false,
  speedKph: 0,
  groundY: 0,
};

function announce(name, fallback) {
  if (!audio.voice(name)) fallback?.();
}

function collectUi() {
  const ids = [
    'position', 'lap', 'time', 'sector', 'gear', 'speed', 'tachFill', 'nitroFill', 'nitroPct',
    'checkpoint', 'driftScore', 'combo', 'comboBlock', 'countdown', 'callout', 'loading',
    'pauseMenu', 'resultMenu', 'resultTitle', 'resultPosition', 'resultTime', 'bestLap', 'resultScore',
    'recordStatus', 'personalBest', 'difficultyBadge', 'turnGuide', 'turnArrow', 'turnLabel', 'turnDistance', 'trainingGuide', 'trainingStepTitle', 'trainingStepDetail',
    'homeMenu', 'homeBest', 'homeBestLabel', 'homeRaces', 'homeWins', 'homeRank', 'homeCoins',
    'homeEventMeta', 'homeEventTitle', 'homeEventRules', 'settingsMenu', 'accountMenu',
    'soundEnabled', 'masterVolume', 'volumeValue', 'difficultySetting', 'trackVariantSetting', 'touchLayoutSetting', 'touchOpacitySetting', 'touchOpacityValue', 'qualitySetting',
    'musicEnabled', 'musicVolume', 'musicVolumeValue', 'voiceEnabled', 'voicePack', 'ghostEnabled',
    'vibrationEnabled', 'cameraShakeEnabled', 'hudTrackName', 'raceFeedTitle', 'raceFeedMeta',
    'itemHud', 'itemUse', 'itemIcon', 'itemName',
    'resultRankRow', 'resultRankLabel', 'resultRankDelta',
    'resultCoinsRow', 'resultCoins',
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
  const wheelRigs = hero.userData.wheelRigs ?? [];
  (hero.userData.wheels ?? []).forEach((wheel) => {
    wheel.rotation.x = THREE.MathUtils.euclideanModulo(wheel.rotation.x + spin, Math.PI * 2);
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
  wheelTravelDistance += Math.abs(vehicle.state.forwardSpeed) * dt;
  const suspensionPose = computeVehicleAnimationPose({
    distance: wheelTravelDistance,
    speedPose,
    steering: vehicle.steering,
    longitudinalLoad: longitudinalAcceleration / 9.81,
    lateralLoad,
    collisionImpact: vehicle.state.collisionImpact,
  });
  wheelRigs.forEach((rig, index) => {
    const wheelPose = suspensionPose.wheels[index];
    if (!wheelPose) return;
    rig.suspensionRoot.position.y = THREE.MathUtils.damp(
      rig.suspensionRoot.position.y,
      rig.restPosition.y + wheelPose.suspensionTravel,
      18,
      dt,
    );
    rig.steeringKnuckle.rotation.y = THREE.MathUtils.damp(
      rig.steeringKnuckle.rotation.y,
      wheelPose.steerAngle,
      16,
      dt,
    );
    rig.steeringKnuckle.rotation.z = THREE.MathUtils.damp(
      rig.steeringKnuckle.rotation.z,
      wheelPose.camberAngle,
      11,
      dt,
    );
    rig.suspensionRoot.userData.compression = wheelPose.suspensionTravel;
  });
  poseRoot.rotation.x = THREE.MathUtils.damp(poseRoot.rotation.x, pitchTarget, 7.5, dt);
  poseRoot.rotation.z = THREE.MathUtils.damp(poseRoot.rotation.z, rollTarget, 6.8, dt);
  const suspensionNoise = (
    Math.sin(elapsed * 13.5)
    + Math.sin(elapsed * 21.7 + 0.8) * 0.42
    + Math.sin(elapsed * 7.3 + 2.1) * 0.26
  ) * speedPose * 0.008;
  const suspensionOffset = suspensionNoise * 0.42 + suspensionPose.heave;
  if (poseRoot === hero) {
    hero.position.y = vehicle.position.y + suspensionOffset;
  } else {
    poseRoot.position.y = THREE.MathUtils.damp(poseRoot.position.y, suspensionOffset, 10, dt);
  }

  const miniActive = vehicle.state.miniBoostTime > 0;
  const doubleActive = miniActive && vehicle.state.miniBoostLevel >= 2;
  const flameActive = vehicle.boosting || miniActive;
  const flameScale = doubleActive ? 1.42 : vehicle.boosting ? 1.16 : miniActive ? 0.92 : 1;
  (hero.userData.nitroFlames ?? []).forEach((flame, index) => {
    flame.visible = flameActive;
    const pulse = 0.82
      + Math.sin(elapsed * 37 + index * 1.7) * 0.13
      + Math.sin(elapsed * 61 + index * 2.4) * 0.06;
    flame.scale.set(
      (0.72 + pulse * 0.32) * flameScale,
      (0.7 + pulse * 0.24) * flameScale,
      (1.05 + pulse * 1.28) * flameScale * (doubleActive ? 1.3 : 1),
    );
  });
  if (hero.userData.underglow?.material) {
    hero.userData.underglow.material.opacity = flameActive ? 0.27 : 0.12 + speedPose * 0.035;
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
  document.body.classList.toggle('boosting', flameActive);
}

function updateRivals(dt) {
  if (!isSpectator) raceSystem.update(dt);
  if (isOnline) {
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
  kartCollisions.update(dt);
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
  if (!isOnline || isSpectator || !raceStarted || now - lastNetworkSendAt < 66) return;
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
  const entries = isSpectator ? [] : [{
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

function spectatorFocus() {
  let focus = null;
  for (const remote of remotePlayers.values()) {
    if (!remote.object.visible) continue;
    if (!focus || (remote.finished && !focus.finished)
      || (remote.finished === focus.finished && remote.progress > focus.progress)) {
      focus = remote;
    }
  }
  return focus;
}

function updateSpectatorCamera(dt) {
  const focus = spectatorFocus();
  const position = focus?.object.position ?? startPoint;
  const heading = Number.isFinite(focus?.targetYaw) ? focus.targetYaw : startHeading;
  const speedKph = Math.min(999, Math.abs(Number(focus?.speed) || 0) * 3.6);
  const speedFactor = THREE.MathUtils.smoothstep(speedKph, 50, 330);
  forward.set(Math.sin(heading), 0, Math.cos(heading)).normalize();
  right.set(Math.cos(heading), 0, -Math.sin(heading)).normalize();
  const portrait = camera.aspect < 0.8;
  const compactLandscape = camera.aspect > 1.25 && innerHeight < 500;
  const targetFov = portrait ? 52 + speedFactor * 7 : compactLandscape ? 52.5 + speedFactor * 8.5 : 54 + speedFactor * 10;
  const desiredDistance = portrait ? 10.4 : compactLandscape ? 6.65 : 7.8;
  const vehicleWidth = hero.userData.dimensions?.x ?? 2.4;
  const minShare = portrait ? 0.24 : 0.14;
  const maxDistance = (vehicleWidth * 0.94) / (
    2 * minShare * Math.tan(THREE.MathUtils.degToRad(targetFov * 0.5)) * camera.aspect
  );
  const distance = Math.min(desiredDistance, maxDistance);
  const height = portrait ? 3.75 + speedFactor * 0.2 : compactLandscape ? 2.3 + speedFactor * 0.24 : 2.55 + speedFactor * 0.28;
  desiredCamera.copy(position).addScaledVector(forward, -distance);
  desiredCamera.y += height;
  camera.position.lerp(desiredCamera, 1 - Math.exp(-5.8 * dt));
  lookTarget.copy(position).addScaledVector(forward, portrait ? 7.8 + speedFactor * 3.2 : 9 + speedFactor * 6);
  lookTarget.y += portrait ? 0.2 : 1.05;
  cameraTarget.lerp(lookTarget, 1 - Math.exp(-7 * dt));
  camera.lookAt(cameraTarget);
  camera.rotation.z = 0;
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 5.5, dt);
  camera.updateProjectionMatrix();
  bloom.strength = THREE.MathUtils.damp(bloom.strength, activeTrack.bloomStrength, 4, dt);
  speedPost.update({ speedKph, boosting: false, rush: 0, aspect: camera.aspect, delta: dt });
}

function updateCamera(dt) {
  if (isSpectator) {
    updateSpectatorCamera(dt);
    return;
  }
  vehicle.getForwardVector(forward);
  vehicle.getRightVector(right);
  const speedFactor = THREE.MathUtils.smoothstep(vehicle.speedKph, 50, 330);
  const miniActive = vehicle.state.miniBoostTime > 0;
  const doubleActive = miniActive && vehicle.state.miniBoostLevel >= 2;
  const anyBoost = vehicle.boosting || miniActive;
  fovRush = Math.max(0, fovRush - dt * 1.9);
  const rushFov = fovRush * 6 + (doubleActive ? 3 : 0);
  const portrait = camera.aspect < 0.8;
  const compactLandscape = camera.aspect > 1.25 && innerHeight < 500;
  const targetFov = portrait
    ? 52 + speedFactor * 7 + (anyBoost ? 4 : 0) + rushFov * 0.8
    : compactLandscape
      ? 52.5 + speedFactor * 8.5 + (anyBoost ? 4 : 0) + rushFov * 0.9
      : 54 + speedFactor * 10 + (anyBoost ? 5 : 0) + rushFov;
  const desiredDistance = portrait
    ? 10.4 + speedFactor * 0.35 + (anyBoost ? 0.12 : 0)
    : compactLandscape
      ? 6.65 + speedFactor * 0.3 + (anyBoost ? 0.1 : 0)
      : 7.8 + speedFactor * 0.42 + (anyBoost ? 0.15 : 0);
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
    ? speedFactor ** 2 * 0.012
      + (vehicle.boosting ? 0.024 : 0)
      + (doubleActive ? 0.014 : 0)
      + vehicle.state.collisionImpact * 0.14
    : 0;
  cameraShakeOffset.copy(right).multiplyScalar(Math.sin(elapsed * 43) * shake);
  cameraShakeOffset.y = Math.sin(elapsed * 59) * shake * 0.55;
  camera.position.add(cameraShakeOffset);
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, targetFov > camera.fov ? 8.5 : 3.4, dt);
  camera.updateProjectionMatrix();
  const baseBloom = activeTrack.bloomStrength;
  bloom.strength = THREE.MathUtils.damp(
    bloom.strength,
    anyBoost ? baseBloom + (doubleActive ? 0.3 : 0.22) : baseBloom,
    4,
    dt,
  );
  speedPost.update({
    speedKph: vehicle.speedKph,
    boosting: anyBoost,
    rush: Math.min(1, fovRush + (anyBoost ? 0.18 : 0)),
    aspect: camera.aspect,
    delta: dt,
  });
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
  return getDifficultyBest(raceRecords, modeId, vehicle.state.difficulty, activeTrackId, activeTrackVariant.id);
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

function cloneGhostMaterial(material) {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = Math.min(0.38, clone.opacity || 1);
  clone.depthWrite = false;
  return clone;
}

function ensureGhostCar() {
  if (ghostCar) return ghostCar;
  ghostCar = createRivalCar(0x9fe8ff);
  ghostCar.traverse((node) => {
    if (node.isLight) node.visible = false;
    node.castShadow = false;
    node.receiveShadow = false;
    if (Array.isArray(node.material)) node.material = node.material.map(cloneGhostMaterial);
    else if (node.material) node.material = cloneGhostMaterial(node.material);
  });
  if (ghostCar.userData.underglow) ghostCar.userData.underglow.visible = false;
  ghostCar.visible = false;
  scene.add(ghostCar);
  return ghostCar;
}

function stopGhost() {
  ghostRecorder?.cancel();
  ghostRecorder = null;
  ghostPlayer.stop();
  ghostData = null;
  if (ghostCar) ghostCar.visible = false;
}

function updateGhost() {
  if (activeMode !== 'timeTrial' || isOnline) return;
  if (raceStarted && ghostRecorder?.recording && !vehicle.state.finished) {
    ghostRecorder.sample(vehicle.state.raceTime, {
      x: vehicle.position.x,
      y: vehicle.position.y,
      z: vehicle.position.z,
      heading: vehicle.heading,
      drifting: vehicle.drifting,
    });
  }
  if (!ghostPlayer.active || !ghostCar) return;
  const frame = raceStarted ? ghostPlayer.sampleAt(vehicle.state.raceTime) : null;
  if (!frame) {
    ghostCar.visible = false;
    return;
  }
  ghostCar.visible = true;
  ghostCar.position.set(frame.x, frame.y, frame.z);
  ghostCar.rotation.y = frame.heading;
}

function fillDriftFrame() {
  driftFrame.position = vehicle.position;
  driftFrame.heading = vehicle.heading;
  driftFrame.drifting = vehicle.drifting;
  driftFrame.driftIntensity = vehicle.state.driftIntensity;
  driftFrame.chargeLevel = vehicle.state.chargeLevel;
  driftFrame.boosting = vehicle.boosting;
  driftFrame.miniBoostActive = vehicle.state.miniBoostTime > 0;
  driftFrame.airborne = vehicle.state.airborne;
  driftFrame.speedKph = vehicle.speedKph;
  driftFrame.groundY = vehicle.position.y;
  return driftFrame;
}

function renderRankBadge() {
  if (!ui.homeRank) return;
  ui.homeRank.textContent = formatRank(rankState);
  ui.homeRank.dataset.tier = getRankTier(rankState).id;
}

function renderWallet() {
  if (ui.homeCoins) ui.homeCoins.textContent = Number(wallet.coins || 0).toLocaleString('en-US');
}

/**
 * Applies the equipped shop paint and decal to whichever hero car is in the
 * scene. The glTF car exposes its body material by name; procedural variants
 * hand theirs over through userData.paint.
 */
function applyEquippedPaint(target = hero, currentWallet = wallet) {
  const paintItem = currentWallet.equipped?.paint ? getItemById(currentWallet.equipped.paint) : null;
  const decalItem = currentWallet.equipped?.decal ? getItemById(currentWallet.equipped.decal) : null;
  const bodyColor = paintItem?.payload?.color ?? ownedCar.color;
  const accentColor = paintItem?.payload?.accentColor ?? ownedCar.accentColor;
  const livery = createLiveryTexture({
    baseColor: bodyColor,
    pattern: decalItem?.payload?.pattern,
    patternColor: decalItem?.payload?.color ?? '#ffffff',
  });

  const bodyMaterials = [];
  if (target.userData.paint) bodyMaterials.push(target.userData.paint);
  else {
    target.traverse((node) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (material?.name === 'Paint 1 Carmine') bodyMaterials.push(material);
      }
    });
  }
  for (const material of bodyMaterials) {
    material.map?.dispose?.();
    if (livery) {
      material.map = livery;
      material.color.set(0xffffff);
    } else {
      material.map = null;
      material.color.set(bodyColor);
    }
    material.needsUpdate = true;
  }

  for (const flame of target.userData.nitroFlames ?? []) {
    flame.material?.color?.set(accentColor);
  }
  if (target.userData.underglow?.material?.color) {
    target.userData.underglow.material.color.set(accentColor);
  }
}

const shopUi = createShopUi({
  getWallet: () => wallet,
  setWallet: (next) => { wallet = next; },
  onChange: (next) => {
    renderWallet();
    applyEquippedPaint(hero, next);
    applyEquippedGear(next);
  },
});

const achievementsUi = createAchievementsUi({ getState: () => achievementState });

// 账号钱包在别处（登录/登出/云端拉取）变化时，游戏内的金币与外观要跟着走。
walletSync.subscribe((next) => {
  wallet = next;
  renderWallet();
  applyEquippedPaint(hero, next);
  applyEquippedGear(next);
});

let mountedWheels = null;
let mountedSpoiler = null;
let hornPlayer = null;
let detailedHeroLoading = false;

/**
 * Local-space bounds of the hero body, measured with the car's race transform
 * temporarily cleared. Shop parts are authored against the procedural cars, so
 * the larger glTF body needs them scaled and re-seated onto its real deck.
 */
function measureHeroBounds() {
  const position = hero.position.clone();
  const rotation = hero.rotation.clone();
  hero.position.set(0, 0, 0);
  hero.rotation.set(0, 0, 0);
  hero.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(hero);
  hero.position.copy(position);
  hero.rotation.copy(rotation);
  hero.updateWorldMatrix(true, true);
  return bounds;
}

const DESIGN_CAR_WIDTH = 2.4;

function fitSpoilerToCar(group) {
  if (!group) return;
  // Box3.setFromObject walks hidden objects too, so detach rather than hide:
  // measuring with the wing still mounted would feed its own size back in.
  hero.remove(group);
  const bounds = measureHeroBounds();
  hero.add(group);
  const size = bounds.getSize(new THREE.Vector3());
  if (!Number.isFinite(size.x) || size.x <= 0) return;
  const scale = THREE.MathUtils.clamp(size.x / DESIGN_CAR_WIDTH, 0.75, 2.2);
  group.scale.setScalar(scale);
  // Sit on the rear deck, just proud of the roof line so the wing reads.
  group.position.set(0, bounds.max.y * 0.92, bounds.min.z + 0.35 * scale);
}

/** Mounts the equipped wheel caps and spoiler, swapping out anything stale. */
function applyEquippedGear(currentWallet = wallet) {
  const wheelItem = currentWallet.equipped?.wheel ? getItemById(currentWallet.equipped.wheel) : null;
  const spoilerItem = currentWallet.equipped?.spoiler ? getItemById(currentWallet.equipped.spoiler) : null;

  if (mountedWheels?.style !== wheelItem?.payload?.style) {
    mountedWheels?.dispose();
    mountedWheels = null;
    if (wheelItem) {
      mountedWheels = createWheelSet(wheelItem.payload.style, wheelItem.payload);
      mountedWheels.attach(hero);
    }
  }
  if (mountedSpoiler?.style !== spoilerItem?.payload?.style) {
    mountedSpoiler?.dispose();
    mountedSpoiler = null;
    if (spoilerItem) {
      mountedSpoiler = createSpoiler(spoilerItem.payload.style, spoilerItem.payload);
      mountedSpoiler.attach(hero);
      fitSpoilerToCar(hero.children.find((child) => child.name === 'ShopSpoiler'));
    }
  }
}

function loadDetailedHeroInBackground() {
  if (ownedCar.id !== DEFAULT_CAR_ID || detailedHeroLoading || hero.userData.detailed) return;
  detailedHeroLoading = true;
  createDetailedHeroCar({
    maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
    onError: (error, url) => runtimeMonitor.assetFailure(url, error),
  }).then((detailed) => {
    if (!detailed?.userData?.detailed || raceStarted || !homeVisible || isOnline) return;
    mountedWheels?.dispose();
    mountedSpoiler?.dispose();
    mountedWheels = null;
    mountedSpoiler = null;
    detailed.position.copy(hero.position);
    detailed.quaternion.copy(hero.quaternion);
    detailed.visible = hero.visible;
    scene.remove(hero);
    hero = detailed;
    vehicle.object = hero;
    scene.add(hero);
    applyEquippedPaint(hero, wallet);
    applyEquippedGear(wallet);
  }).finally(() => {
    detailedHeroLoading = false;
  });
}

function soundHorn() {
  const tone = wallet.equipped?.horn ? getItemById(wallet.equipped.horn)?.payload?.tone : null;
  if (!tone) return false;
  if (!hornPlayer && audio.context) hornPlayer = createHornPlayer(audio.context, audio.master);
  return Boolean(hornPlayer?.play(tone));
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
  trainingCoach.reset();
  vehicle.clearInput();
  vehicle.reset({
    position: (isOnline ? playerStartPoint : startPoint).clone().add(new THREE.Vector3(0, 0.05, 0)),
    heading: isOnline ? playerStartHeading : startHeading,
    nitro: STARTING_NITRO,
  });
  previousForwardSpeed = 0;
  wheelTravelDistance = 0;
  raceSystem.configure({
    totalLaps: mode.laps,
    rivalCount: isOnline ? 0 : mode.rivals,
    kartCollisions: Boolean(mode.kartCollisions),
  });
  kartCollisions.reset();
  setRivalsVisible(isOnline ? 0 : mode.rivals);
  itemRace.reset({ enabled: !isOnline && activeMode === 'items' });
  driftEffects.reset();
  stopGhost();
  if (activeMode === 'timeTrial' && !isOnline && preferences.ghostEnabled) {
    const stored = loadGhost(activeTrackId);
    ghostData = stored ? deserializeGhost(stored) : null;
  }
  resetRaceTally();
  lastPlayerPosition = null;
  overtakeCooldown = 0;
  launchThrottleAt = null;
  fovRush = 0;
  document.body.dataset.raceMode = activeMode;
}

function syncSettingsUi() {
  ui.soundEnabled.checked = preferences.soundEnabled;
  ui.masterVolume.value = String(preferences.masterVolume);
  ui.masterVolume.disabled = !preferences.soundEnabled;
  ui.volumeValue.textContent = `${Math.round(preferences.masterVolume * 100)}%`;
  ui.musicEnabled.checked = preferences.musicEnabled;
  ui.musicVolume.value = String(preferences.musicVolume);
  ui.musicVolume.disabled = !preferences.musicEnabled;
  ui.musicVolumeValue.textContent = `${Math.round(preferences.musicVolume * 100)}%`;
  ui.voiceEnabled.checked = preferences.voiceEnabled;
  ui.voicePack.value = preferences.voicePack;
  ui.ghostEnabled.checked = preferences.ghostEnabled;
  ui.difficultySetting.value = preferences.difficulty;
  ui.trackVariantSetting.value = preferences.trackVariant;
  ui.touchLayoutSetting.value = preferences.touchLayout;
  ui.touchOpacitySetting.value = String(preferences.touchOpacity);
  ui.touchOpacityValue.textContent = `${Math.round(preferences.touchOpacity * 100)}%`;
  document.body.dataset.touchLayout = preferences.touchLayout;
  document.body.style.setProperty('--touch-opacity', String(preferences.touchOpacity));
  ui.qualitySetting.value = preferences.quality;
  ui.vibrationEnabled.checked = preferences.vibration;
  ui.cameraShakeEnabled.checked = preferences.cameraShake;
  const difficulty = difficultyRule(preferences.difficulty);
  ui.difficultyBadge.textContent = difficulty.shortLabel;
  ui.difficultyBadge.dataset.difficulty = difficulty.id;
  document.body.dataset.difficulty = difficulty.id;
}

function applyPreferences(changes) {
  preferences = savePreferences({ ...preferences, ...changes });
  audio.setVolume(preferences.masterVolume);
  audio.setMuted(!preferences.soundEnabled);
  audio.setVoiceEnabled(preferences.voiceEnabled);
  // 同一个包会在 loadVoiceBank 内部原地返回，所以这里可以无脑调用。
  audio.loadVoiceBank(voicePackBaseUrl(preferences.voicePack));
  music.setVolume(preferences.musicVolume);
  music.setEnabled(preferences.musicEnabled && !paused);
  vehicle.setDifficulty(preferences.difficulty);
  qualityTier = resolveQualityTier(detectedQualityTier);
  renderer.shadowMap.enabled = qualityTier !== 'balanced';
  renderer.shadowMap.type = qualityTier === 'ultra' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
  if (gtao) {
    gtao.enabled = qualityTier !== 'balanced';
    gtao.blendIntensity = qualityTier === 'ultra' ? 1.28 : 1.05;
  }
  if (smaa) smaa.enabled = qualityTier !== 'balanced';
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
  const focus = isSpectator ? spectatorFocus() : null;
  const focusSpeedKph = Math.min(999, Math.round(Math.abs(Number(focus?.speed) || 0) * 3.6));
  const kph = isSpectator ? focusSpeedKph : Math.round(vehicle.speedKph);
  ui.speed.textContent = String(Math.min(kph, 999)).padStart(3, '0');
  ui.gear.textContent = kph < 2 ? 'N' : String(Math.min(7, Math.max(1, Math.floor(kph / 48) + 1)));
  ui.tachFill.style.width = `${Math.min(100, (kph / 350) * 100)}%`;
  ui.nitroFill.style.width = `${isSpectator ? 0 : vehicle.state.nitroNormalized * 100}%`;
  ui.nitroFill.dataset.charge = String(isSpectator ? 0 : vehicle.state.chargeLevel);
  ui.nitroPct.textContent = isSpectator ? '--' : String(Math.round(vehicle.state.nitro));
  const item = itemRace.inventory ? ITEM_DEFINITIONS[itemRace.inventory] : null;
  ui.itemIcon.textContent = item?.icon ?? '?';
  ui.itemName.textContent = item?.label ?? '等待拾取';
  ui.itemUse.disabled = !item || !raceStarted || paused;
  ui.itemUse.classList.toggle('ready', Boolean(item && raceStarted && !paused));
  ui.itemUse.setAttribute('aria-label', item ? `使用${item.label}` : '尚未获得道具');
  const focusProgress = focus ? THREE.MathUtils.euclideanModulo(focus.progress / Math.max(1, RACE_MODES[activeMode].laps), 1) : 0;
  ui.lap.innerHTML = `${isSpectator ? Math.max(1, focus?.lap ?? 1) : vehicle.lap}<small>/ ${RACE_MODES[activeMode].laps}</small>`;
  ui.time.textContent = isSpectator ? formatTime(Math.max(0, elapsed - Math.max(0, countdown))) : formatTime(vehicle.state.raceTime);
  const routeProgress = isSpectator ? focusProgress : vehicle.progress;
  ui.sector.textContent = String(Math.min(3, Math.floor(routeProgress * 3) + 1)).padStart(2, '0');
  const routeCue = routeNavigator.getCue(routeProgress);
  const primaryTurn = routeCue.primary;
  ui.turnArrow.textContent = primaryTurn
    ? primaryTurn.direction === 'left' ? '↰' : '↱'
    : '↑';
  ui.turnLabel.textContent = primaryTurn?.label ?? '保持路线';
  ui.turnDistance.textContent = primaryTurn
    ? `${primaryTurn.distance}m${routeCue.secondary ? ` · ${routeCue.secondary.label}` : ''}`
    : '前方无急弯';
  ui.turnGuide?.setAttribute('data-severity', primaryTurn?.severity ?? 'straight');
  if (activeMode === 'training' && !isSpectator) {
    const trainingState = trainingCoach.update(vehicle.getSnapshot());
    ui.trainingGuide.hidden = trainingState.completed;
    ui.trainingStepTitle.textContent = trainingState.completed ? '训练完成' : trainingState.step.title;
    ui.trainingStepDetail.textContent = trainingState.completed ? '现在可以挑战正式赛事' : trainingState.step.detail;
  } else {
    ui.trainingGuide.hidden = true;
  }
  ui.checkpoint.textContent = isSpectator ? '-- / --' : `${String(vehicle.state.nextCheckpoint).padStart(2, '0')} / ${vehicle.state.checkpointCount}`;
  const liveDriftScore = isSpectator ? 0 : Math.round(vehicle.state.skillScore + vehicle.state.driftScore);
  ui.driftScore.textContent = String(liveDriftScore).padStart(6, '0');
  const chain = isSpectator ? 1 : Math.max(vehicle.state.combo, vehicle.state.nitroChain, 1);
  ui.combo.textContent = `x${chain}`;
  ui.comboBlock.classList.toggle('active', chain > 1);

  const onlineStandings = isOnline ? getOnlineStandings() : null;
  const playerPosition = onlineStandings?.find((entry) => entry.isPlayer)?.position ?? raceSystem.state.playerPosition;
  const entrantCount = onlineStandings?.length ?? raceSystem.state.entrantCount;
  if (isSpectator) {
    ui.position.innerHTML = `观战<small>/ ${entrantCount}</small>`;
  } else if (raceStarted && !vehicle.state.finished && entrantCount > 1) {
    if (lastPlayerPosition !== null && playerPosition < lastPlayerPosition && overtakeCooldown <= 0) {
      showCallout('漂亮的超越！', 1.1);
      announce('overtake');
      overtakeCooldown = 2.6;
    }
    lastPlayerPosition = playerPosition;
  }
  if (!isSpectator) ui.position.innerHTML = `${playerPosition}<small>/ ${entrantCount}</small>`;
  drawMinimap();
}

const mapCanvas = document.querySelector('#minimap');
const mapContext = mapCanvas.getContext('2d');
const routeNavigator = createRouteNavigator(trackCurve, { maxLookAheadMeters: activeTrackId === 'candyland' ? 420 : 320 });
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
  for (const pad of trackFeatures.boostPads) {
    const mapped = mapPosition(pad.point);
    ctx.fillStyle = 'rgba(74, 255, 226, .9)';
    ctx.fillRect(mapped.x - 1.6, mapped.y - 1.6, 3.2, 3.2);
  }
  for (const ramp of trackFeatures.ramps) {
    const mapped = mapPosition(ramp.point);
    ctx.fillStyle = '#ffb84d';
    ctx.beginPath(); ctx.arc(mapped.x, mapped.y, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  for (const shortcut of trackFeatures.shortcuts) {
    ctx.beginPath();
    shortcut.points.forEach((point, index) => {
      const mapped = mapPosition(point);
      if (index === 0) ctx.moveTo(mapped.x, mapped.y); else ctx.lineTo(mapped.x, mapped.y);
    });
    ctx.strokeStyle = vehicle.state.onShortcut ? 'rgba(217,255,67,.95)' : 'rgba(217,255,67,.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
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
  const focus = isSpectator ? spectatorFocus() : null;
  const player = mapPosition(focus?.object.position ?? vehicle.position);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#35e7ff';
  ctx.shadowBlur = 9;
  if (isSpectator && !focus) return;
  ctx.beginPath(); ctx.arc(player.x, player.y, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
}

function updateCountdown(dt) {
  if (homeVisible || waitingForOnlineStart || raceStarted || paused) return;
  countdown -= dt;
  if (vehicle.input.throttle > 0.5) {
    if (launchThrottleAt === null) launchThrottleAt = countdown;
  } else {
    launchThrottleAt = null;
  }
  const value = Math.ceil(countdown);
  if (value > 0) {
    const nextText = String(value);
    if (ui.countdown.textContent !== nextText) {
      ui.countdown.textContent = nextText;
      ui.countdown.classList.remove('pulse');
      void ui.countdown.offsetWidth;
      ui.countdown.classList.add('pulse');
      if (!audio.voice(`countdown_${value}`)) audio.countdown(false);
    }
  } else {
    raceStarted = true;
    vehicle.startRace({ totalLaps: RACE_MODES[activeMode].laps });
    raceSystem.start();
    const launchQuality = launchThrottleAt !== null && vehicle.input.throttle > 0.5
      ? launchThrottleAt <= 0.36 ? 'perfect' : launchThrottleAt <= 0.85 ? 'good' : null
      : null;
    if (launchQuality) {
      vehicle.primeLaunchBoost(launchQuality);
      showCallout(launchQuality === 'perfect' ? '完美起步！' : '起步喷！', 1.25);
      if (launchQuality === 'perfect') announce('perfect_start');
      fovRush = 1;
      haptic([14, 30, 14]);
    }
    if (activeMode === 'timeTrial' && !isOnline) {
      ghostRecorder = createGhostRecorder();
      ghostRecorder.begin();
      if (ghostData && preferences.ghostEnabled) {
        ensureGhostCar();
        ghostPlayer.start(ghostData);
      }
    }
    ui.countdown.textContent = 'GO!';
    ui.countdown.classList.remove('pulse');
    void ui.countdown.offsetWidth;
    ui.countdown.classList.add('pulse');
    if (!audio.voice('go')) audio.countdown(true);
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
  music.start(activeTrackId);
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
  wheelTravelDistance = 0;
  raceSystem.reset();
  itemRace.reset({ enabled: false });
  driftEffects.reset();
  stopGhost();
  music.stop();
  renderRankBadge();
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
  music.setEnabled(preferences.musicEnabled && !value);
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
document.querySelector('#openShop')?.addEventListener('click', () => shopUi.open());
document.querySelector('#openAchievements')?.addEventListener('click', () => achievementsUi.open());
for (const button of document.querySelectorAll('[data-race-mode]')) {
  button.addEventListener('click', () => selectMode(button.dataset.raceMode));
}
ui.soundEnabled.addEventListener('change', () => applyPreferences({ soundEnabled: ui.soundEnabled.checked }));
ui.masterVolume.addEventListener('input', () => applyPreferences({ masterVolume: Number(ui.masterVolume.value) }));
ui.musicEnabled.addEventListener('change', () => applyPreferences({ musicEnabled: ui.musicEnabled.checked }));
ui.musicVolume.addEventListener('input', () => applyPreferences({ musicVolume: Number(ui.musicVolume.value) }));
ui.voiceEnabled.addEventListener('change', () => applyPreferences({ voiceEnabled: ui.voiceEnabled.checked }));
ui.voicePack.addEventListener('change', () => applyPreferences({ voicePack: ui.voicePack.value }));
ui.ghostEnabled.addEventListener('change', () => applyPreferences({ ghostEnabled: ui.ghostEnabled.checked }));
ui.difficultySetting.addEventListener('change', () => applyPreferences({ difficulty: ui.difficultySetting.value }));
ui.trackVariantSetting.addEventListener('change', () => {
  preferences = savePreferences({ ...preferences, trackVariant: ui.trackVariantSetting.value });
  location.reload();
});
ui.touchLayoutSetting.addEventListener('change', () => applyPreferences({ touchLayout: ui.touchLayoutSetting.value }));
ui.touchOpacitySetting.addEventListener('input', () => applyPreferences({ touchOpacity: Number(ui.touchOpacitySetting.value) }));
ui.qualitySetting.addEventListener('change', () => applyPreferences({ quality: ui.qualitySetting.value }));
ui.vibrationEnabled.addEventListener('change', () => applyPreferences({ vibration: ui.vibrationEnabled.checked }));
ui.cameraShakeEnabled.addEventListener('change', () => applyPreferences({ cameraShake: ui.cameraShakeEnabled.checked }));
window.addEventListener('keydown', (event) => {
  audio.start();
  music.resume();
  if (!ui.accountMenu.hidden) return;
  if (shopUi.visible) {
    if (event.code === 'Escape') shopUi.close();
    return;
  }
  if (achievementsUi.visible) {
    if (event.code === 'Escape') achievementsUi.close();
    return;
  }
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
  if (event.code === 'KeyH' && !paused) {
    event.preventDefault();
    if (soundHorn()) haptic(12);
  }
  if (event.code === 'KeyE' && activeMode === 'items' && raceStarted && !paused) {
    event.preventDefault();
    itemRace.useItem();
  }
  if (event.code === 'Escape') setPaused(!paused);
  if (event.code === 'KeyR' && raceStarted && !paused) vehicle.respawn('manual');
});
window.addEventListener('pointerdown', () => {
  audio.start();
  music.resume();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // A tab switch can skip keyup, leaving Space latched in the vehicle's
    // keyboard source when the race resumes.
    vehicle.clearInput();
    if (raceStarted && !isOnline) setPaused(true);
  }
});

function beginOnlineRace(startAt, raceMode = onlineSession?.room?.raceMode) {
  audio.start();
  music.start(activeTrackId);
  const mode = RACE_MODES[raceMode] ? raceMode : 'race';
  selectedMode = mode;
  prepareRace(mode);
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
  onlineSession.addEventListener('race-start', (event) => {
    beginOnlineRace(event.detail.startAt, event.detail.raceMode);
  });
  onlineSession.addEventListener('reconnecting', () => showCallout('正在恢复连接', 1.2));
  onlineSession.addEventListener('resumed', () => showCallout('连接已恢复', 1));
  onlineSession.addEventListener('connection-lost', () => showCallout('连接已断开', 2));
  onlineSession.addEventListener('race-result', (event) => {
    if (!isSpectator) return;
    const winner = event.detail?.standings?.[0];
    paused = true;
    ui.resultTitle.textContent = '比赛结束';
    ui.resultPosition.textContent = '观战';
    ui.resultPosition.nextElementSibling.textContent = `/ ${event.detail?.totalRacers ?? remotePlayers.size}`;
    ui.resultTime.textContent = '--:--.---';
    ui.bestLap.textContent = '--:--.---';
    ui.resultScore.textContent = '------';
    ui.recordStatus.textContent = winner?.name ? `${winner.name} 获得第一名` : '比赛已结束';
    ui.recordStatus.classList.remove('new-record');
    ui.resultRankRow.hidden = true;
    if (ui.resultCoinsRow) ui.resultCoinsRow.hidden = true;
    ui.resultMenu.hidden = false;
    showCallout(winner?.name ? `${winner.name} 冲线第一` : '比赛结束', 2.4);
  });
}

vehicle.on('lap', (state) => {
  haptic(25);
  if (!state.finished && state.totalLaps > 1 && state.lap === state.totalLaps) {
    showCallout('最后一圈！', 1.6);
    announce('final_lap');
  } else if (!state.finished) {
    showCallout(`第 ${state.lap} 圈`, 1.5);
  }
});
vehicle.on('miniBoost', ({ source, chain }) => {
  fovRush = Math.max(fovRush, source === 'launch' ? 1 : 0.55);
  if (source === 'drift') raceTally.maxBoostChain = Math.max(raceTally.maxBoostChain, chain || 0);
  if (source === 'drift' && chain > 1) {
    showCallout(`连喷 x${chain}`, 0.95);
    if (chain === 2) announce('chain_boost');
    haptic(14);
  }
});
vehicle.on('launchBoost', ({ quality }) => {
  if (quality === 'perfect') raceTally.perfectStart = true;
});
vehicle.on('doubleBoost', ({ technique }) => {
  fovRush = 1;
  showCallout(technique ? `${technique} 喷！` : '双喷！', 1);
  announce('double_boost');
  haptic([12, 26, 12]);
});
vehicle.on('landingBoost', ({ bonus }) => {
  if (bonus > 0) raceTally.landingBoosts += 1;
  fovRush = Math.max(fovRush, 0.7);
  showCallout('落地喷！', 1);
  announce('landing_boost');
  haptic(20);
});
vehicle.on('padBoost', ({ padId }) => {
  raceTally.padIds.add(padId);
  fovRush = Math.max(fovRush, 0.8);
  audio.tone(680, 0.22, 0.15, 'square');
  haptic(12);
});
vehicle.on('rampLaunch', () => haptic(10));
vehicle.on('shortcutEnter', ({ savedMeters }) => {
  raceTally.shortcutRuns += 1;
  fovRush = Math.max(fovRush, 0.5);
  showCallout(savedMeters >= 1 ? `近道！省 ${Math.round(savedMeters)}m` : '近道！', 1.2);
  audio.tone(520, 0.26, 0.13, 'triangle');
  haptic([10, 20, 10]);
});
vehicle.on('driftEnd', ({ points, combo, nitro }) => {
  raceTally.driftScore += points || 0;
  haptic(18);
  showCallout(`DRIFT +${points}  N2O +${nitro}  x${combo}`, 1.15);
});
vehicle.on('nitroChain', ({ chain }) => {
  haptic([12, 24, 12]);
  showCallout(`NITRO CHAIN x${chain}`, 1.05);
});
vehicle.on('collision', ({ driftNitroCancelled = false }) => {
  haptic(35);
  if (driftNitroCancelled) showCallout('撞墙：本次漂移集气作废', 1.05);
});
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
itemRace.on('strike', ({ blocked }) => {
  if (!blocked) haptic(14);
  showCallout(blocked ? '对手护盾抵消' : '命中对手！', 1);
});
itemRace.on('explosion', () => haptic(18));
raceSystem.on('finish', async (result) => {
  const mode = RACE_MODES[activeMode];
  const onlineStandings = isOnline ? getOnlineStandings() : null;
  const onlinePosition = onlineStandings?.find((entry) => entry.isPlayer)?.position;
  const modeResult = {
    ...result,
    mode: activeMode,
    position: isOnline ? onlinePosition : mode.rivals === 0 ? 1 : result.position,
    entrants: isOnline ? onlineStandings.length : mode.rivals === 0 ? 1 : result.entrants,
    difficulty: vehicle.state.difficulty,
    trackId: activeTrackId,
    trackVariant: activeTrackVariant.id,
  };
  const recordUpdate = activeMode === 'training'
    ? { records: raceRecords, isNewBestTime: false, isNewBestLap: false, isNewModeBest: false }
    : recordRaceResult(modeResult);
  raceRecords = recordUpdate.records;
  if (activeMode === 'timeTrial' && ghostRecorder) {
    const completedGhost = ghostRecorder.complete(modeResult.finalTime);
    ghostRecorder = null;
    if (completedGhost && recordUpdate.isNewModeBest) {
      const serialized = serializeGhost(completedGhost);
      if (serialized) saveGhost(activeTrackId, serialized);
    }
  }
  let rankOutcome = null;
  if (activeMode === 'race' && !isOnline) {
    rankOutcome = applyRankResult(rankState, {
      position: modeResult.position,
      totalRacers: modeResult.entrants,
    }, Date.now());
    rankState = rankOutcome.state;
    saveRankState(rankState);
    renderRankBadge();
  }
  // 联机金币由服务端按名次计算并直接入账，所有联机赛制都要等这份结算，
  // 不只是 race —— 卡丁车和道具赛同样发钱。段位回写仍然只对 race 生效。
  let onlineCoins = 0;
  let onlineCoinsReason = null;
  if (isOnline) {
    showCallout('等待服务器权威结算', 2.4);
    try {
      const authoritative = await onlineSession.waitForRankResult({ timeoutMs: 90000 });
      if (activeMode === 'race') {
        // 只有真正上分的结算才回写本地段位。好友房结算带的是
        // settled:false / reason:'unranked_room'，其 rank 字段是按空 rankedId 取到的
        // 默认段位，照搬会把玩家的本地段位洗成青铜。
        if (authoritative.settled) {
          const synchronized = rankStateFromServer(authoritative.rank, rankState);
          if (synchronized) {
            rankState = synchronized;
            saveRankState(rankState);
            renderRankBadge();
          }
        }
        rankOutcome = {
          label: formatRank(rankState),
          delta: Number(authoritative.delta) || 0,
          promoted: Boolean(authoritative.promoted),
          demoted: Boolean(authoritative.demoted),
          authoritative: true,
          settlementId: authoritative.settlementId,
        };
      }
      onlineCoins = Math.max(0, Math.floor(Number(authoritative.coinsAwarded) || 0));
      onlineCoinsReason = authoritative.coinsReason ?? null;
      modeResult.position = Number(authoritative.position) || modeResult.position;
      modeResult.entrants = Number(authoritative.totalRacers) || modeResult.entrants;
    } catch (error) {
      runtimeMonitor.assetFailure('online:rank-settlement', error);
      showCallout('服务器结算延迟，可稍后重连同步', 2.8);
    }
  }
  if (activeMode === 'race' || activeMode === 'items') {
    if (modeResult.position === 1 && modeResult.entrants > 1) announce('finish_first');
  } else if (recordUpdate.isNewModeBest) {
    announce('new_record');
  }
  const payout = isOnline || activeMode === 'training' ? null : earnCoins(wallet, {
    mode: activeMode,
    difficulty: modeResult.difficulty,
    position: modeResult.position,
    entrants: modeResult.entrants,
    finalTime: modeResult.finalTime,
    cleanRace: modeResult.cleanRace,
    skillScore: modeResult.skillScore,
    isNewRecord: recordUpdate.isNewModeBest,
    laps: mode.laps,
  }, Date.now());
  if (payout) {
    wallet = payout.wallet;
    walletSync.persist(wallet);
  }
  // 联机奖励已经由服务端记在账号上，这里只把本地钱包对齐，避免玩家要等下一次
  // 同步才看到金币；这笔钱不进入本地收入队列，避免被重复上传。
  if (onlineCoins > 0) {
    wallet = walletSync.creditFromServer(onlineCoins);
    wallet = await walletSync.refresh();
    renderWallet();
  }
  const achievementOutcome = isOnline || activeMode === 'training' ? null : evaluateAchievements(achievementState, {
    mode: activeMode,
    position: modeResult.position,
    entrants: modeResult.entrants,
    finished: true,
    cleanRace: modeResult.cleanRace,
    trackId: activeTrackId,
    skillScore: modeResult.skillScore,
    driftScore: raceTally.driftScore,
    maxBoostChain: raceTally.maxBoostChain,
    perfectStart: raceTally.perfectStart,
    landingBoosts: raceTally.landingBoosts,
    padBoosts: raceTally.padIds.size,
    shortcutRuns: raceTally.shortcutRuns,
    totalCoins: wallet.totalEarned,
    ownedCarCount: wallet.owned.filter((id) => getItemById(id)?.category === 'car').length,
    equippedPaint: wallet.equipped?.paint ?? null,
    rankTier: rankState.bestTierReached,
  }, Date.now());
  if (achievementOutcome) {
    achievementState = achievementOutcome.state;
    saveAchievementState(achievementState);
    if (achievementOutcome.coinReward > 0) {
      wallet = { ...wallet, coins: wallet.coins + achievementOutcome.coinReward };
      walletSync.persist(wallet);
    }
    for (const [index, unlocked] of (achievementOutcome.newlyUnlocked ?? []).entries()) {
      setTimeout(() => showCallout(`成就达成：${unlocked.name ?? unlocked.id}`, 1.6), 2600 + index * 1500);
    }
  }
  const challengeOutcome = isOnline || activeMode === 'training' ? null : updateChallenges(challengeState, {
    mode: activeMode,
    difficulty: modeResult.difficulty,
    position: modeResult.position,
    entrants: modeResult.entrants,
    finished: true,
    cleanRace: modeResult.cleanRace,
    driftScore: raceTally.driftScore,
    maxBoostChain: raceTally.maxBoostChain,
    shortcutRuns: raceTally.shortcutRuns,
  }, Date.now());
  if (challengeOutcome) {
    challengeState = challengeOutcome.state;
    saveChallengeState(challengeState);
    if (challengeOutcome.coinReward > 0) {
      wallet = {
        ...wallet,
        coins: Math.min(9_999_999, wallet.coins + challengeOutcome.coinReward),
        totalEarned: Math.min(9_999_999, wallet.totalEarned + challengeOutcome.coinReward),
        updatedAt: Date.now(),
      };
      walletSync.persist(wallet);
    }
    for (const [index, completed] of challengeOutcome.completed.entries()) {
      setTimeout(() => showCallout(`挑战完成：${completed.label} +${completed.reward}`, 1.7), 3300 + index * 1600);
    }
  }
  renderWallet();
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
    const modeBest = activeMode === 'training' ? modeResult.finalTime : getModeBest(activeMode);
    ui.personalBest.textContent = activeMode === 'drift' ? formatScore(modeBest) : formatTime(modeBest ?? modeResult.finalTime);
    ui.recordStatus.textContent = activeMode === 'drift'
      ? recordUpdate.isNewModeBest ? 'NEW HIGH SCORE' : 'HIGH SCORE'
      : recordUpdate.isNewModeBest ? 'NEW PERSONAL BEST' : 'PERSONAL BEST';
    ui.recordStatus.classList.toggle('new-record', recordUpdate.isNewModeBest);
    if (rankOutcome) {
      ui.resultRankRow.hidden = false;
      ui.resultRankLabel.textContent = rankOutcome.label;
      ui.resultRankDelta.textContent = `${rankOutcome.delta >= 0 ? '+' : ''}${rankOutcome.delta}`;
      ui.resultRankDelta.classList.toggle('negative', rankOutcome.delta < 0);
      if (rankOutcome.promoted) {
        announce('rank_up');
        showCallout(`晋级 ${rankOutcome.label}`, 2);
      }
    } else {
      ui.resultRankRow.hidden = true;
    }
    if (ui.resultCoinsRow) {
      const earned = payout ? payout.earned : onlineCoins;
      if (earned > 0) {
        ui.resultCoinsRow.hidden = false;
        ui.resultCoins.textContent = `+${earned}`;
      } else {
        ui.resultCoinsRow.hidden = true;
      }
    }
    // 游客打联机拿不到钱：服务端没有可记账的账号。说清楚原因，别让人以为是 bug。
    if (onlineCoinsReason === 'guest_no_account') {
      showCallout('登录账号后联机比赛才能获得金币', 3);
    }
    ui.resultMenu.hidden = false;
  }, 1750);
});

syncSettingsUi();
selectMode(preferences.lastMode, { persist: false });
setRivalsVisible(0);
renderRankBadge();
renderWallet();
applyEquippedPaint();
applyEquippedGear();
ui.hudTrackName.textContent = activeTrack.shortTitle;
ui.raceFeedTitle.textContent = activeTrack.title;
ui.raceFeedMeta.textContent = `${activeTrack.meta} // ${activeTrackVariant.label}`;
document.body.dataset.track = activeTrackId;
document.body.dataset.trackVariant = activeTrackVariant.id;
document.body.classList.toggle('online-race', isOnline);
document.body.classList.toggle('spectator', isSpectator);
for (const button of document.querySelectorAll('[data-track]')) {
  button.addEventListener('click', () => {
    const nextTrack = button.dataset.track;
    if (isOnline || !nextTrack || nextTrack === activeTrackId) return;
    preferences = savePreferences({ ...preferences, lastTrack: nextTrack });
    location.reload();
  });
}
for (const button of document.querySelectorAll('[data-car]')) {
  button.addEventListener('click', () => {
    const nextCar = button.dataset.car;
    if (isOnline || !nextCar || nextCar === ownedCar.id) return;
    preferences = savePreferences({ ...preferences, carId: nextCar });
    location.reload();
  });
}

window.__NEON_APEX_ANDROID_BACK__ = () => {
  if (!ui.accountMenu.hidden) {
    ui.accountMenu.hidden = true;
    return true;
  }
  if (shopUi.visible) {
    shopUi.close();
    return true;
  }
  if (achievementsUi.visible) {
    achievementsUi.close();
    return true;
  }
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
  const tierLimit = qualityTier === 'balanced' ? 0.9 : qualityTier === 'ultra' ? 2.0 : 1.55;
  const ratio = Math.min(window.devicePixelRatio, mobile ? Math.min(1.25, tierLimit) : tierLimit);
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  composer?.setPixelRatio(ratio);
  composer?.setSize(width, height);
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
    overtakeCooldown = Math.max(0, overtakeCooldown - dt);
    updateCountdown(dt);
    vehicle.update(!isSpectator && raceStarted ? dt : 0);
    updateRivals(dt);
    itemRace.update(dt, { racing: raceStarted });
    sendOnlineState();
    world.update(elapsed);
    featureMeshes.userData.update?.(elapsed);
    updateParticles(dt);
    updateWindStreaks(dt);
    updateCarVisuals(dt);
    driftEffects.update(dt, fillDriftFrame());
    updateGhost();
    updateCamera(dt);
    updateUi();
    audio.update(vehicle.speedKph, vehicle.input.throttle, vehicle.boosting);
    music.setIntensity(
      THREE.MathUtils.smoothstep(vehicle.speedKph, 60, 300) * 0.75 + (vehicle.boosting ? 0.25 : 0),
    );

    if (vehicle.drifting && !lastDrifting) showCallout('PERFECT DRIFT', 1.05);
    if (vehicle.boosting && !lastBoosting) showCallout('NITRO BURST', 0.9);
    lastDrifting = vehicle.drifting;
    lastBoosting = vehicle.boosting;
  }
  renderFrame();

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
        renderFrame();
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
          featureMeshes.userData.update?.(elapsed);
          updateParticles(step);
          updateWindStreaks(step);
          updateCarVisuals(step);
          driftEffects.update(step, fillDriftFrame());
        }
        vehicle.setInput({ throttle: 0, brake: 0, steer: 0, drift: 0, nitro: 0 });
        updateCamera(5);
        camera.position.copy(desiredCamera);
        cameraTarget.copy(lookTarget);
        camera.lookAt(cameraTarget);
        updateUi();
        renderFrame();
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
      const scheduleDetailedCar = () => loadDetailedHeroInBackground();
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(scheduleDetailedCar, { timeout: 4000 });
      } else {
        setTimeout(scheduleDetailedCar, 1200);
      }
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
