import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE_URL = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '');
const ASSET_ROOT = `${BASE_URL}/assets/environment/models`;
const cache = new Map();

export const ENVIRONMENT_ASSETS = Object.freeze({
  mountainside: Object.freeze({ near: 'mountainside/mountainside-near.glb', mid: 'mountainside/mountainside-mid.glb', far: 'mountainside/mountainside-far.glb', nearDistance: 210, midDistance: 620 }),
  boulder: Object.freeze({ near: 'boulder/boulder-near.glb', mid: 'boulder/boulder-mid.glb', far: 'boulder/boulder-far.glb', nearDistance: 95, midDistance: 260 }),
  apartment: Object.freeze({ near: 'apartment/apartment-near.glb', mid: 'apartment/apartment-mid.glb', far: 'apartment/apartment-far.glb', nearDistance: 240, midDistance: 620 }),
  factory: Object.freeze({ near: 'factory/factory-near.glb', mid: 'factory/factory-mid.glb', far: 'factory/factory-far.glb', nearDistance: 260, midDistance: 680 }),
  fir: Object.freeze({ near: 'fir/fir-near.glb', mid: 'fir/fir-mid.glb', far: 'fir/fir-far.glb', nearDistance: 130, midDistance: 360 }),
});

function load(url) {
  if (!cache.has(url)) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    cache.set(url, loader.loadAsync(url).then((gltf) => gltf.scene).catch((error) => {
      cache.delete(url);
      throw error;
    }));
  }
  return cache.get(url);
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
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) continue;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        if (material[key]) material[key].anisotropy = options.anisotropy ?? 8;
      }
      if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
      if (material.aoMap && object.geometry.hasAttribute('uv2') === false && object.geometry.hasAttribute('uv')) {
        object.geometry.setAttribute('uv2', object.geometry.getAttribute('uv'));
      }
    }
  });
  return root;
}

function cloneTemplate(template, options) {
  const pivot = new THREE.Group();
  pivot.add(normalizeGroundPivot(prepare(template.clone(true), options)));
  return pivot;
}

/** Load an environment model with an explicit near/mid/far HLOD chain. */
export async function loadEnvironmentLOD(kind, options = {}) {
  const definition = ENVIRONMENT_ASSETS[kind];
  if (!definition) throw new Error(`Unknown environment asset: ${kind}`);
  const [near, mid, far] = await Promise.all([
    load(`${ASSET_ROOT}/${definition.near}`),
    load(`${ASSET_ROOT}/${definition.mid}`),
    load(`${ASSET_ROOT}/${definition.far}`),
  ]);
  const lod = new THREE.LOD();
  lod.name = `HLOD_${kind}`;
  lod.addLevel(cloneTemplate(near, options), 0);
  lod.addLevel(cloneTemplate(mid, options), definition.nearDistance);
  lod.addLevel(cloneTemplate(far, { ...options, castShadow: false }), definition.midDistance);
  lod.userData = { assetKind: kind, lod: true, bakedLighting: options.bakedLighting !== false, source: 'Poly Haven CC0' };
  return lod;
}

/** Start loading one HLOD chain in the background; errors are reported once. */
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

/**
 * Attach a small set of authored props in the background. Procedural meshes
 * remain in place as the immediate fallback, so map creation and collision
 * clearance never depend on a network request succeeding.
 */
export function attachEnvironmentHLOD(root, qualityTier, placements = [], options = {}) {
  if (!root || qualityTier === 'balanced' || typeof window === 'undefined' || !placements.length) {
    return Promise.resolve(null);
  }
  const group = new THREE.Group();
  group.name = options.name ?? 'EnvironmentHLOD';
  group.userData = {
    ...group.userData,
    hlod: true,
    qualityTier,
    fallback: 'procedural',
    bakedLighting: options.bakedLighting !== false,
    source: 'Poly Haven CC0',
  };
  root.add(group);
  const tasks = placements.map(async (placement) => {
    const lod = await loadEnvironmentLODGracefully(placement.kind, {
      anisotropy: qualityTier === 'ultra' ? 16 : 8,
      bakedLighting: options.bakedLighting,
      onError: options.onError,
    });
    if (!lod) return null;
    lod.position.fromArray(placement.position ?? [0, 0, 0]);
    lod.scale.fromArray(placement.scale ?? [1, 1, 1]);
    if (placement.rotation) lod.rotation.set(...placement.rotation);
    lod.userData.anchor = placement.anchor ?? null;
    group.add(lod);
    return lod;
  });
  return Promise.all(tasks).then(() => group);
}
