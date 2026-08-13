import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
const ASSET_ROOT = `${BASE_URL}/assets/environment/models`;
const modelCache = new Map();
const textureCache = new Map();
const STREAM_ORDER = Object.freeze(['far', 'mid', 'near']);

export const ENVIRONMENT_STREAM_BUDGETS = Object.freeze({
  initialBytes: 3 * 1024 * 1024,
  totalBytes: 22 * 1024 * 1024,
});

export const ENVIRONMENT_ASSETS = Object.freeze({
  mountainside: Object.freeze({
    near: 'mountainside/mountainside-near.glb', mid: 'mountainside/mountainside-mid.glb', far: 'mountainside/mountainside-far.glb',
    nearDistance: 210, midDistance: 620,
    bytes: Object.freeze({ near: 1320632, mid: 422404, far: 118276 }),
    lightMaps: Object.freeze({ near: `${BASE_URL}/assets/environment/lightmaps/mountainside/mountainside-near.png`, mid: `${BASE_URL}/assets/environment/lightmaps/mountainside/mountainside-mid.png`, far: `${BASE_URL}/assets/environment/lightmaps/mountainside/mountainside-far.png` }),
    lightMapBytes: Object.freeze({ near: 5511, mid: 5229, far: 5123 }),
  }),
  boulder: Object.freeze({
    near: 'boulder/boulder-near.glb', mid: 'boulder/boulder-mid.glb', far: 'boulder/boulder-far.glb',
    nearDistance: 95, midDistance: 260,
    bytes: Object.freeze({ near: 1318752, mid: 533856, far: 403460 }),
    lightMaps: Object.freeze({ near: `${BASE_URL}/assets/environment/lightmaps/boulder/boulder-near.png`, mid: `${BASE_URL}/assets/environment/lightmaps/boulder/boulder-mid.png`, far: `${BASE_URL}/assets/environment/lightmaps/boulder/boulder-far.png` }),
    lightMapBytes: Object.freeze({ near: 5194, mid: 5323, far: 5347 }),
  }),
  apartment: Object.freeze({
    near: 'apartment/apartment-near.glb', mid: 'apartment/apartment-mid.glb', far: 'apartment/apartment-far.glb',
    nearDistance: 240, midDistance: 620,
    bytes: Object.freeze({ near: 2412772, mid: 1139440, far: 765084 }),
    lightMaps: Object.freeze({ near: `${BASE_URL}/assets/environment/lightmaps/apartment/apartment-near.png`, mid: `${BASE_URL}/assets/environment/lightmaps/apartment/apartment-mid.png`, far: `${BASE_URL}/assets/environment/lightmaps/apartment/apartment-far.png` }),
    lightMapBytes: Object.freeze({ near: 5619, mid: 5579, far: 5219 }),
  }),
  factory: Object.freeze({
    near: 'factory/factory-near.glb', mid: 'factory/factory-mid.glb', far: 'factory/factory-far.glb',
    nearDistance: 260, midDistance: 680,
    bytes: Object.freeze({ near: 3028916, mid: 1348104, far: 933168 }),
    lightMaps: Object.freeze({ near: `${BASE_URL}/assets/environment/lightmaps/factory/factory-near.png`, mid: `${BASE_URL}/assets/environment/lightmaps/factory/factory-mid.png`, far: `${BASE_URL}/assets/environment/lightmaps/factory/factory-far.png` }),
    lightMapBytes: Object.freeze({ near: 5134, mid: 5052, far: 5292 }),
  }),
  fir: Object.freeze({
    near: 'fir/fir-near.glb', mid: 'fir/fir-mid.glb', far: 'fir/fir-far.glb',
    nearDistance: 130, midDistance: 360,
    bytes: Object.freeze({ near: 3703528, mid: 1228756, far: 348224 }),
    lightMaps: Object.freeze({ near: `${BASE_URL}/assets/environment/lightmaps/fir/fir-near.png`, mid: `${BASE_URL}/assets/environment/lightmaps/fir/fir-mid.png`, far: `${BASE_URL}/assets/environment/lightmaps/fir/fir-far.png` }),
    lightMapBytes: Object.freeze({ near: 5802, mid: 5610, far: 5483 }),
  }),
});

function defaultModelLoader(url) {
  if (!modelCache.has(url)) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    modelCache.set(url, loader.loadAsync(url).then((gltf) => gltf.scene).catch((error) => {
      modelCache.delete(url);
      throw error;
    }));
  }
  return modelCache.get(url);
}

function defaultTextureLoader(url) {
  if (!textureCache.has(url)) {
    textureCache.set(url, new THREE.TextureLoader().loadAsync(url).catch((error) => {
      textureCache.delete(url);
      throw error;
    }));
  }
  return textureCache.get(url);
}

function waitForIdle(options) {
  if (options.idleScheduler) return Promise.resolve().then(() => options.idleScheduler());
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    return new Promise((resolve) => window.requestIdleCallback(resolve, {
      timeout: options.idleTimeout ?? 1200,
    }));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalizeGroundPivot(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  if (bounds.isEmpty()) return root;
  const center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  return root;
}

function prepare(root, options = {}) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = options.castShadow ?? true;
    object.receiveShadow = true;
    const materials = (Array.isArray(object.material) ? object.material : [object.material])
      .map((material) => material?.clone?.() ?? material);
    object.material = Array.isArray(object.material) ? materials : materials[0];
    for (const material of materials) {
      if (!material) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        if (material[key]) material[key].anisotropy = options.anisotropy ?? 8;
      }
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
  return root;
}

function cloneTemplate(template, options) {
  const pivot = new THREE.Group();
  pivot.add(normalizeGroundPivot(prepare(template.clone(true), options)));
  return pivot;
}

function resolveLightMapSource(options, kind, level) {
  let source = options.lightMap ?? options.lightMaps ?? ENVIRONMENT_ASSETS[kind]?.lightMaps ?? null;
  if (typeof source === 'function') source = source({ kind, level });
  if (source && !source.isTexture && typeof source === 'object') {
    source = source[kind] ?? source.default ?? source;
    if (typeof source === 'function') source = source({ kind, level });
  }
  if (source && !source.isTexture && typeof source === 'object') {
    source = source[level] ?? source.default ?? null;
  }
  return source;
}

function applyLightMap(root, texture, options) {
  texture.colorSpace = options.lightMapColorSpace ?? THREE.NoColorSpace;
  texture.flipY = options.lightMapFlipY ?? false;
  texture.channel = 1;
  texture.anisotropy = options.anisotropy ?? 8;
  texture.needsUpdate = true;
  let materialCount = 0;

  root.traverse((object) => {
    if (!object.isMesh || !object.geometry?.hasAttribute('uv')) return;
    if (!object.geometry.hasAttribute('uv1') || !object.geometry.hasAttribute('uv2')) {
      object.geometry = object.geometry.clone();
      const uv = object.geometry.getAttribute('uv');
      if (!object.geometry.hasAttribute('uv1')) object.geometry.setAttribute('uv1', uv.clone());
      if (!object.geometry.hasAttribute('uv2')) object.geometry.setAttribute('uv2', uv.clone());
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || !('lightMap' in material)) continue;
      material.lightMap = texture;
      material.lightMapIntensity = options.lightMapIntensity ?? 1;
      material.needsUpdate = true;
      materialCount += 1;
    }
  });
  return materialCount;
}

function replaceLODLevels(lod, available, definition) {
  for (const level of lod.levels) lod.remove(level.object);
  lod.levels.length = 0;
  if (available.has('near')) {
    lod.addLevel(available.get('near'), 0);
    if (available.has('mid')) lod.addLevel(available.get('mid'), definition.nearDistance);
    if (available.has('far')) lod.addLevel(available.get('far'), definition.midDistance);
  } else if (available.has('mid')) {
    lod.addLevel(available.get('mid'), 0);
    if (available.has('far')) lod.addLevel(available.get('far'), definition.midDistance);
  } else if (available.has('far')) {
    lod.addLevel(available.get('far'), 0);
  }
}

function createStreamMetrics(kind, definition) {
  return {
    kind,
    state: 'loading',
    startedAt: performance.now(),
    readyMs: null,
    settledMs: null,
    requestedLevels: [],
    loadedLevels: [],
    failedLevels: [],
    bytesRequested: 0,
    bytesLoaded: 0,
    initialBytes: definition.bytes.far + definition.lightMapBytes.far,
    totalBytes: Object.values(definition.bytes).reduce((sum, bytes) => sum + bytes, 0)
      + Object.values(definition.lightMapBytes).reduce((sum, bytes) => sum + bytes, 0),
    lightMapsApplied: 0,
    lightMapMaterials: 0,
    lightMapFailures: 0,
  };
}

/**
 * Start a far-first HLOD stream. `environmentReady` resolves as soon as one
 * usable level exists; `environmentSettled` covers all idle upgrades and maps.
 */
export function streamEnvironmentLOD(kind, options = {}) {
  const definition = ENVIRONMENT_ASSETS[kind];
  if (!definition) throw new Error(`Unknown environment asset: ${kind}`);

  const lod = new THREE.LOD();
  const available = new Map();
  const lightMapTasks = [];
  const metrics = createStreamMetrics(kind, definition);
  lod.name = `HLOD_${kind}`;
  lod.userData = {
    assetKind: kind,
    lod: true,
    bakedLighting: false,
    bakedLightingRequested: options.bakedLighting !== false,
    source: 'Poly Haven CC0',
    metrics,
  };

  const installLevel = async (level) => {
    metrics.requestedLevels.push(level);
    metrics.bytesRequested += definition.bytes[level];
    try {
      const url = `${ASSET_ROOT}/${definition[level]}`;
      const template = await (options.modelLoader ?? defaultModelLoader)(url, { kind, level });
      const clone = cloneTemplate(template, {
        ...options,
        castShadow: level === 'far' ? false : options.castShadow,
      });
      clone.name = `${kind}_${level}`;
      clone.userData.lodLevel = level;
      available.set(level, clone);
      metrics.loadedLevels.push(level);
      metrics.bytesLoaded += definition.bytes[level];
      replaceLODLevels(lod, available, definition);

      const source = options.bakedLighting === false
        ? null
        : resolveLightMapSource(options, kind, level);
      if (source) {
        const lightMapBytes = typeof source === 'string' ? definition.lightMapBytes[level] : 0;
        metrics.bytesRequested += lightMapBytes;
        const task = Promise.resolve(source.isTexture
          ? source
          : (options.textureLoader ?? defaultTextureLoader)(source, { kind, level }))
          .then((texture) => {
            metrics.bytesLoaded += lightMapBytes;
            const count = applyLightMap(clone, texture, options);
            if (count > 0) {
              metrics.lightMapsApplied += 1;
              metrics.lightMapMaterials += count;
              lod.userData.bakedLighting = true;
            }
          })
          .catch((error) => {
            metrics.lightMapFailures += 1;
            options.onError?.(error, kind, `${level}:lightMap`);
          });
        lightMapTasks.push(task);
      }
      return true;
    } catch (error) {
      metrics.failedLevels.push(level);
      options.onError?.(error, kind, level);
      return false;
    }
  };

  let initialIndex = -1;
  const environmentReady = (async () => {
    for (let index = 0; index < STREAM_ORDER.length; index += 1) {
      if (await installLevel(STREAM_ORDER[index])) {
        initialIndex = index;
        metrics.state = 'ready';
        metrics.readyMs = performance.now() - metrics.startedAt;
        return lod;
      }
    }
    metrics.state = 'failed';
    metrics.readyMs = performance.now() - metrics.startedAt;
    return null;
  })();

  const environmentSettled = environmentReady.then(async (result) => {
    if (result) {
      for (let index = initialIndex + 1; index < STREAM_ORDER.length; index += 1) {
        await waitForIdle(options);
        await installLevel(STREAM_ORDER[index]);
      }
    }
    await Promise.allSettled(lightMapTasks);
    metrics.state = result ? 'settled' : 'failed';
    metrics.settledMs = performance.now() - metrics.startedAt;
    return result;
  });

  lod.environmentSettled = environmentSettled;
  lod.metrics = metrics;
  return { environmentReady, environmentSettled, metrics };
}

/** Preserve the original API: direct loads wait for the complete HLOD chain. */
export async function loadEnvironmentLOD(kind, options = {}) {
  const stream = streamEnvironmentLOD(kind, options);
  const lod = await stream.environmentSettled;
  if (!lod) throw new Error(`No usable level loaded for environment asset: ${kind}`);
  return lod;
}

export function loadEnvironmentLODGracefully(kind, options = {}) {
  return loadEnvironmentLOD(kind, options).catch((error) => {
    options.onError?.(error, kind);
    return null;
  });
}

export function environmentAssetUrl(kind, level = 'near') {
  const definition = ENVIRONMENT_ASSETS[kind];
  return definition ? `${ASSET_ROOT}/${definition[level]}` : null;
}

function inactiveResult() {
  const environmentReady = Promise.resolve(null);
  const metrics = Object.freeze({
    state: 'disabled', placements: 0, requestedLevels: 0, loadedLevels: 0,
    failedLevels: 0, initialBytes: 0, totalBytes: 0, lightMapsApplied: 0,
  });
  environmentReady.environmentSettled = environmentReady;
  environmentReady.metrics = metrics;
  return environmentReady;
}

function createAggregateMetrics(streams) {
  const uniqueDefinitions = new Map();
  for (const stream of streams) {
    const definition = ENVIRONMENT_ASSETS[stream.metrics.kind];
    if (definition) uniqueDefinitions.set(stream.metrics.kind, definition);
  }
  const initialBytes = [...uniqueDefinitions.values()]
    .reduce((sum, definition) => sum + definition.bytes.far + definition.lightMapBytes.far, 0);
  const totalBytes = [...uniqueDefinitions.values()]
    .reduce((sum, definition) => sum + Object.values(definition.bytes)
      .reduce((assetSum, bytes) => assetSum + bytes, 0)
      + Object.values(definition.lightMapBytes).reduce((assetSum, bytes) => assetSum + bytes, 0), 0);
  const metrics = {
    state: 'loading',
    placements: streams.length,
    streams: streams.map((stream) => stream.metrics),
    requestedLevels: 0,
    loadedLevels: 0,
    failedLevels: 0,
    lightMapsApplied: 0,
    lightMapFailures: 0,
    initialBytes,
    totalBytes,
    budget: {
      ...ENVIRONMENT_STREAM_BUDGETS,
      initialWithinBudget: initialBytes <= ENVIRONMENT_STREAM_BUDGETS.initialBytes,
      totalWithinBudget: totalBytes <= ENVIRONMENT_STREAM_BUDGETS.totalBytes,
    },
  };
  metrics.refresh = () => {
    metrics.requestedLevels = metrics.streams.reduce((sum, item) => sum + item.requestedLevels.length, 0);
    metrics.loadedLevels = metrics.streams.reduce((sum, item) => sum + item.loadedLevels.length, 0);
    metrics.failedLevels = metrics.streams.reduce((sum, item) => sum + item.failedLevels.length, 0);
    metrics.lightMapsApplied = metrics.streams.reduce((sum, item) => sum + item.lightMapsApplied, 0);
    metrics.lightMapFailures = metrics.streams.reduce((sum, item) => sum + item.lightMapFailures, 0);
    return metrics;
  };
  return metrics;
}

/**
 * Attach authored props progressively. Procedural meshes remain the immediate
 * fallback while far GLBs load; mid and near upgrades use separate idle slots.
 */
export function attachEnvironmentHLOD(root, qualityTier, placements = [], options = {}) {
  if (!root || qualityTier === 'balanced' || typeof window === 'undefined' || !placements.length) {
    return inactiveResult();
  }

  const group = new THREE.Group();
  group.name = options.name ?? 'EnvironmentHLOD';
  group.userData = {
    hlod: true,
    qualityTier,
    fallback: 'procedural',
    bakedLighting: false,
    bakedLightingRequested: options.bakedLighting !== false,
    source: 'Poly Haven CC0',
  };
  root.add(group);

  const streams = placements.map((placement) => {
    try {
      const stream = streamEnvironmentLOD(placement.kind, {
        ...options,
        anisotropy: qualityTier === 'ultra' ? 16 : 8,
        lightMap: placement.lightMap ?? options.lightMap,
      });
      stream.environmentReady = stream.environmentReady.then((lod) => {
        if (!lod) return null;
        lod.position.fromArray(placement.position ?? [0, 0, 0]);
        lod.scale.fromArray(placement.scale ?? [1, 1, 1]);
        if (placement.rotation) lod.rotation.set(...placement.rotation);
        lod.userData.anchor = placement.anchor ?? null;
        group.add(lod);
        return lod;
      });
      return stream;
    } catch (error) {
      options.onError?.(error, placement.kind);
      const environmentReady = Promise.resolve(null);
      return {
        environmentReady,
        environmentSettled: environmentReady,
        metrics: {
          kind: placement.kind, state: 'failed', requestedLevels: [], loadedLevels: [],
          failedLevels: ['definition'], lightMapsApplied: 0, lightMapFailures: 0,
        },
      };
    }
  });
  const metrics = createAggregateMetrics(streams);
  group.metrics = metrics;
  group.userData.metrics = metrics;

  const environmentReady = Promise.all(streams.map((stream) => stream.environmentReady)).then(() => {
    metrics.state = 'ready';
    metrics.refresh();
    return group;
  });
  const environmentSettled = Promise.all(streams.map((stream) => stream.environmentSettled)).then(() => {
    metrics.state = 'settled';
    metrics.refresh();
    group.userData.bakedLighting = metrics.lightMapsApplied > 0;
    return group;
  });
  group.environmentSettled = environmentSettled;
  environmentReady.environmentSettled = environmentSettled;
  environmentReady.metrics = metrics;
  return environmentReady;
}
