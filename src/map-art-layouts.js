import * as THREE from 'three';
import { attachEnvironmentHLOD } from './environment-assets.js';

const DEFAULT_CLEARANCE = Object.freeze({ prop: 12, terrain: 20 });
const DEFAULT_ATTEMPT_STEP = 22;

function placement(id, name, sector, kind, progress, side, radius, distance, scale, options = {}) {
  return Object.freeze({
    id,
    name,
    sector,
    kind,
    progress,
    side,
    radius,
    distance,
    scale: Object.freeze(scale),
    yOffset: options.yOffset ?? 0,
    yaw: options.yaw ?? 0,
    clearance: options.clearance ?? (kind === 'mountainside' ? 'terrain' : 'prop'),
    landmarkTier: options.landmarkTier ?? 'supporting',
  });
}

/**
 * Authored art direction for all five circuits. The models are deliberately
 * reused across a map: one cached HLOD chain can populate several race sectors
 * while procedural scenery remains the immediate fallback and far backdrop.
 */
export const MAP_ART_LAYOUTS = Object.freeze({
  night: Object.freeze([
    placement('harbor-gateway', 'Harbor Gateway Lofts', 'harbor', 'apartment', 0.025, 1, 18, 10, [0.64, 0.76, 0.64], { yOffset: -2, yaw: Math.PI / 2, landmarkTier: 'signature' }),
    placement('container-works', 'Container Works', 'harbor', 'factory', 0.13, -1, 20, 13, [0.62, 0.68, 0.62], { yOffset: -2, yaw: -Math.PI / 2, landmarkTier: 'hero' }),
    placement('dockyard-annex', 'Dockyard Annex', 'harbor', 'factory', 0.235, 1, 18, 15, [0.54, 0.58, 0.54], { yOffset: -2, yaw: Math.PI / 2 }),
    placement('prism-residences', 'Prism Residences', 'vertical-city', 'apartment', 0.33, -1, 19, 9, [0.7, 0.86, 0.7], { yOffset: -2.5, yaw: -Math.PI / 2, landmarkTier: 'signature' }),
    placement('skyline-court', 'Skyline Court', 'vertical-city', 'apartment', 0.445, 1, 17, 13, [0.58, 0.7, 0.58], { yOffset: -2, yaw: Math.PI / 2 }),
    placement('neon-assembly', 'Neon Assembly Hall', 'industrial-loop', 'factory', 0.565, -1, 19, 15, [0.6, 0.66, 0.6], { yOffset: -2, yaw: -Math.PI / 2, landmarkTier: 'hero' }),
    placement('switchback-rock', 'Switchback Rock', 'mountain-ascent', 'boulder', 0.68, 1, 7, 12, [7.4, 7.4, 7.4], { yOffset: -2, yaw: 0.5 }),
    placement('summit-firs', 'Summit Fir Stand', 'mountain-ascent', 'fir', 0.77, -1, 15, 14, [6.4, 6.4, 6.4], { yOffset: -2.5, yaw: 1.1 }),
    placement('rainforest-cut', 'Rainforest Cut', 'mountain-descent', 'fir', 0.855, 1, 14, 17, [5.8, 5.8, 5.8], { yOffset: -2.2, yaw: -0.7 }),
    placement('breakwater-stone', 'Breakwater Stone', 'harbor-return', 'boulder', 0.945, -1, 6, 13, [6.6, 6.6, 6.6], { yOffset: -2.4, yaw: 2.2, landmarkTier: 'hero' }),
  ]),
  day: Object.freeze([
    placement('valley-welcome', 'Sunvale Welcome Grove', 'village-start', 'fir', 0.055, 1, 15, 14, [6.2, 6.2, 6.2], { yOffset: -1.2, yaw: -0.5, landmarkTier: 'hero' }),
    placement('orchard-lodge', 'Orchard Lodge', 'orchards', 'apartment', 0.145, -1, 17, 17, [0.46, 0.5, 0.46], { yOffset: -1.5, yaw: -Math.PI / 2 }),
    placement('north-ridge', 'North Ridge Escarpment', 'north-ridge', 'mountainside', 0.235, null, 66, 45, [11, 11, 11], { yOffset: -4, landmarkTier: 'signature' }),
    placement('quarry-boulder', 'Old Quarry Boulder', 'quarry-bend', 'boulder', 0.335, 1, 7, 15, [7.2, 7.2, 7.2], { yOffset: -1.5, yaw: 0.7 }),
    placement('lake-firs', 'Lakeview Fir Grove', 'lake-loop', 'fir', 0.445, -1, 16, 14, [6.5, 6.5, 6.5], { yOffset: -1.2, yaw: 1.3, landmarkTier: 'hero' }),
    placement('farm-workshop', 'Harvest Workshop', 'farmland', 'factory', 0.54, 1, 19, 21, [0.5, 0.54, 0.5], { yOffset: -1.8, yaw: Math.PI / 2 }),
    placement('south-ridge', 'South Ridge Panorama', 'south-ridge', 'mountainside', 0.66, null, 58, 58, [9.3, 9.3, 9.3], { yOffset: -3, yaw: Math.PI, landmarkTier: 'signature' }),
    placement('stone-pasture', 'Stone Pasture', 'pasture', 'boulder', 0.755, -1, 6, 18, [6.4, 6.4, 6.4], { yOffset: -1.6, yaw: 2.1 }),
    placement('cedar-approach', 'Cedar Approach', 'village-return', 'fir', 0.845, -1, 15, 18, [5.9, 5.9, 5.9], { yOffset: -1.1, yaw: 1.7 }),
    placement('finish-homestead', 'Finish Homestead', 'village-return', 'apartment', 0.935, 1, 16, 16, [0.43, 0.48, 0.43], { yOffset: -1.4, yaw: Math.PI / 2, landmarkTier: 'hero' }),
  ]),
  alpine: Object.freeze([
    placement('glacier-gate', 'Glacier Gate', 'base-camp', 'mountainside', 0.035, 1, 68, 54, [10.5, 10.5, 10.5], { yOffset: -7, yaw: 2.7, landmarkTier: 'hero' }),
    placement('north-face', 'Frostpeak North Face', 'north-face', 'mountainside', 0.17, null, 79, 43, [12, 12, 12], { yOffset: -7, landmarkTier: 'signature' }),
    placement('icefall-stone', 'Icefall Stone', 'icefall', 'boulder', 0.265, -1, 7, 15, [7.5, 7.5, 7.5], { yOffset: -4, yaw: 0.4 }),
    placement('whitepine-overlook', 'Whitepine Overlook', 'pine-overlook', 'fir', 0.355, 1, 15, 13, [6.2, 6.2, 6.2], { yOffset: -3, yaw: -0.6, landmarkTier: 'hero' }),
    placement('avalanche-shelf', 'Avalanche Shelf', 'summit-climb', 'mountainside', 0.455, -1, 61, 61, [9.5, 9.5, 9.5], { yOffset: -7, yaw: 1.4 }),
    placement('summit-lodge', 'Frostpeak Summit Lodge', 'summit', 'apartment', 0.545, 1, 18, 23, [0.47, 0.54, 0.47], { yOffset: -3, yaw: Math.PI / 2, landmarkTier: 'signature' }),
    placement('west-ridge', 'West Ridge Wall', 'west-ridge', 'mountainside', 0.64, null, 66, 55, [10, 10, 10], { yOffset: -6, yaw: Math.PI }),
    placement('frozen-talus', 'Frozen Talus', 'descent', 'boulder', 0.735, 1, 6, 17, [6.8, 6.8, 6.8], { yOffset: -4, yaw: 2.2 }),
    placement('descent-firs', 'Descent Fir Gallery', 'descent', 'fir', 0.825, -1, 15, 19, [6.5, 6.5, 6.5], { yOffset: -3, yaw: 1.4, landmarkTier: 'hero' }),
    placement('basecamp-works', 'Basecamp Service Hall', 'base-camp', 'factory', 0.925, 1, 18, 25, [0.48, 0.5, 0.48], { yOffset: -3.2, yaw: Math.PI / 2 }),
  ]),
  canyon: Object.freeze([
    placement('mesa-gateway', 'Mesa Gateway', 'desert-gate', 'mountainside', 0.035, 1, 65, 60, [9.7, 9.7, 9.7], { yOffset: -10, yaw: 2.5, landmarkTier: 'hero' }),
    placement('prospector-works', 'Prospector Works', 'mining-cut', 'factory', 0.135, -1, 19, 22, [0.52, 0.56, 0.52], { yOffset: -5, yaw: -Math.PI / 2 }),
    placement('sunspire-mesa', 'Sunspire Mesa', 'high-mesa', 'mountainside', 0.28, null, 73, 58, [11, 11, 11], { yOffset: -10, yaw: 0.6, landmarkTier: 'signature' }),
    placement('eagle-rock', 'Eagle Rock', 'rim-run', 'boulder', 0.37, 1, 7, 14, [7.6, 7.6, 7.6], { yOffset: -5, yaw: 1.1, landmarkTier: 'hero' }),
    placement('copper-ridge', 'Copper Ridge', 'copper-canyon', 'mountainside', 0.46, -1, 59, 64, [9, 9, 9], { yOffset: -9, yaw: 1.8 }),
    placement('thunder-boulder', 'Thunder Boulder', 'riverbed', 'boulder', 0.55, null, 8, 13, [8, 8, 8], { yOffset: -5, yaw: 0.3 }),
    placement('refinery-outpost', 'Red Mesa Refinery', 'outpost', 'factory', 0.655, 1, 20, 24, [0.58, 0.62, 0.58], { yOffset: -5, yaw: Math.PI / 2, landmarkTier: 'signature' }),
    placement('juniper-sentinel', 'Juniper Sentinel', 'dry-gulch', 'fir', 0.745, -1, 14, 20, [5.6, 5.6, 5.6], { yOffset: -4, yaw: -0.8 }),
    placement('twilight-bluff', 'Twilight Bluff', 'sunset-bluff', 'mountainside', 0.835, null, 55, 62, [8.5, 8.5, 8.5], { yOffset: -9, yaw: 2.9 }),
    placement('finish-monolith', 'Finish Monolith', 'desert-gate', 'boulder', 0.925, -1, 6, 17, [6.3, 6.3, 6.3], { yOffset: -4, yaw: 1.2, landmarkTier: 'hero' }),
  ]),
  coast: Object.freeze([
    placement('marina-hotel', 'Azure Marina Hotel', 'marina', 'apartment', 0.035, 1, 18, 18, [0.5, 0.57, 0.5], { yOffset: -4, yaw: Math.PI / 2, landmarkTier: 'signature' }),
    placement('breakwater-rock', 'Breakwater Rock', 'breakwater', 'boulder', 0.13, -1, 6, 15, [6.8, 6.8, 6.8], { yOffset: -4, yaw: 1.7 }),
    placement('cape-stacks', 'Cape Sea Stacks', 'outer-cape', 'boulder', 0.225, null, 6, 15, [7.2, 7.2, 7.2], { yOffset: -4, yaw: 0.7, landmarkTier: 'hero' }),
    placement('cliffside-villas', 'Cliffside Villas', 'villa-cliffs', 'apartment', 0.33, 1, 17, 20, [0.46, 0.52, 0.46], { yOffset: -4, yaw: Math.PI / 2 }),
    placement('emerald-grove', 'Emerald Grove', 'island-grove', 'fir', 0.43, -1, 14, 17, [5.8, 5.8, 5.8], { yOffset: -4, yaw: 0.4, landmarkTier: 'hero' }),
    placement('shipyard-hall', 'Azure Shipyard Hall', 'shipyard', 'factory', 0.535, 1, 19, 23, [0.54, 0.58, 0.54], { yOffset: -4, yaw: Math.PI / 2 }),
    placement('lighthouse-cliffs', 'Lighthouse Cliffs', 'lighthouse-cape', 'mountainside', 0.635, null, 55, 66, [8.4, 8.4, 8.4], { yOffset: -8, yaw: 2.5, landmarkTier: 'signature' }),
    placement('tidepool-boulder', 'Tidepool Boulder', 'tidepools', 'boulder', 0.72, -1, 6, 18, [6.5, 6.5, 6.5], { yOffset: -4, yaw: 2.1 }),
    placement('windward-firs', 'Windward Fir Stand', 'windward-rise', 'fir', 0.825, 1, 14, 19, [5.9, 5.9, 5.9], { yOffset: -4, yaw: -0.6 }),
    placement('marina-works', 'Marina Service Hall', 'marina-return', 'factory', 0.925, -1, 18, 22, [0.48, 0.52, 0.48], { yOffset: -4, yaw: -Math.PI / 2, landmarkTier: 'hero' }),
  ]),
});

export function getMapArtLayout(mapId) {
  const layout = MAP_ART_LAYOUTS[mapId];
  if (!layout) throw new Error(`Unknown map art layout: ${mapId}`);
  return layout;
}

/** Resolve authored track-relative anchors into clearance-validated transforms. */
export function buildMapArtPlacements(mapId, clearance, frameAt, options = {}) {
  const margins = { ...DEFAULT_CLEARANCE, ...options.clearanceMargins };
  return getMapArtLayout(mapId).flatMap((entry) => {
    const { point, tangent, side } = frameAt(entry.progress);
    const outward = entry.side ?? clearance.outwardSign(point, side);
    const margin = margins[entry.clearance];
    const candidate = clearance.place((attempt) => {
      const offset = clearance.requiredDistance(entry.radius, margin)
        + entry.distance + attempt * (options.attemptStep ?? DEFAULT_ATTEMPT_STEP);
      return {
        x: point.x + side.x * outward * offset,
        z: point.z + side.z * outward * offset,
        radius: entry.radius,
        clearance: margin,
      };
    }, options.attempts ?? 6);
    if (!candidate) return [];
    return [{
      kind: entry.kind,
      position: [candidate.x, options.groundHeightAt
        ? options.groundHeightAt(candidate.x, candidate.z) - (entry.kind === 'mountainside' ? 5 : 0.4)
        : point.y + entry.yOffset, candidate.z],
      rotation: [0, Math.atan2(-tangent.z, tangent.x) + entry.yaw, 0],
      scale: [...entry.scale],
      anchor: {
        mapId,
        id: entry.id,
        name: entry.name,
        sector: entry.sector,
        progress: entry.progress,
        landmarkTier: entry.landmarkTier,
        radius: entry.radius,
        clearance: entry.clearance,
      },
    }];
  });
}

function artSummary(mapId, placements) {
  const landmarkCount = placements.filter(({ anchor }) => anchor.landmarkTier !== 'supporting').length;
  return {
    mapId,
    placementCount: placements.length,
    landmarkCount,
    sectors: [...new Set(placements.map(({ anchor }) => anchor.sector))],
    assetKinds: [...new Set(placements.map(({ kind }) => kind))],
  };
}

/** Attach a map layout and enrich the asynchronous HLOD nodes with art metadata. */
export function attachMapArtLayout(root, mapId, qualityTier, clearance, frameAt, options = {}) {
  const placements = buildMapArtPlacements(mapId, clearance, frameAt, options);
  const summary = artSummary(mapId, placements);
  root.userData.environmentArt = summary;
  const ready = attachEnvironmentHLOD(root, qualityTier, placements, {
    name: options.name ?? `${mapId}EnvironmentHLOD`,
    bakedLighting: options.bakedLighting !== false,
    onError: options.onError,
  });
  const decorateGroup = (group) => {
    if (!group) return null;
    group.userData.environmentArt = summary;
    group.children.forEach((lod) => {
      const anchor = lod.userData.anchor;
      if (!anchor || typeof anchor !== 'object') return;
      lod.name = `Landmark_${mapId}_${anchor.id}`;
      Object.assign(lod.userData, {
        authoredPlacement: true,
        mapId,
        placementId: anchor.id,
        displayName: anchor.name,
        sector: anchor.sector,
        progress: anchor.progress,
        landmarkTier: anchor.landmarkTier,
      });
    });
    return group;
  };
  const environmentReady = ready.then(decorateGroup);
  environmentReady.environmentSettled = (ready.environmentSettled ?? ready).then(decorateGroup);
  environmentReady.metrics = ready.metrics;
  return environmentReady;
}

/** Frame helper for map builders and tests that use a Three.js curve directly. */
export function curveArtFrame(curve, progress) {
  const point = curve.getPointAt(progress);
  const tangent = curve.getTangentAt(progress).normalize();
  const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
  return { point, tangent, side };
}
