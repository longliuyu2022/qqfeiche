import * as THREE from 'three';
import {
  ROAD_WIDTH,
  TRACK_SAMPLES,
  TRACK_DISTRICTS,
  TRACK_CURVE,
  tangentFrame,
  matrixOnTrack,
  ribbonGeometry,
} from './night-track.js';
import { addWorldLights, createAtmosphere, createRain, createSky } from './night-atmosphere.js';
import { createHarborDistrict, createMountainRoad } from './night-districts.js';
// Shared scenery-placement rules live in scenic-worlds.js so every map obeys the
// same "stay clear of the whole circuit" contract. See that file for details.
import {
  CLEARANCE_EXEMPT,
  PROP_CLEARANCE,
  TERRAIN_CLEARANCE,
  createClearanceField,
  createShortcutMask,
  horizontalRadius,
  markClearanceExempt,
} from './scenic-worlds.js';

export {
  ROAD_WIDTH,
  TRACK_SAMPLES,
  TRACK_DISTRICTS,
  TRACK_POINTS,
  TRACK_CURVE,
} from './night-track.js';
export { createHeroCar, createRivalCar } from './procedural-vehicle.js';

const COLORS = {
  asphalt: 0x252b2f,
  asphaltLight: 0x3c4448,
  cyan: 0x20e9ff,
  cyanDark: 0x087c9f,
  magenta: 0xff2d78,
  warm: 0xffb45b,
  concrete: 0x48515a,
  terrain: 0x101b1a,
};

const environmentTextureLoader = new THREE.TextureLoader();
const environmentBaseUrl = `${(import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')}/assets/environment/polyhaven`;
const environmentTexturePromises = new Map();

function loadEnvironmentTexture(asset, file, isColor, repeat) {
  const url = `${environmentBaseUrl}/${asset}/${file}`;
  if (!environmentTexturePromises.has(url)) {
    environmentTexturePromises.set(url, new Promise((resolve) => {
      environmentTextureLoader.load(
        url,
        (texture) => {
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(repeat[0], repeat[1]);
          texture.anisotropy = 8;
          if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
          resolve(texture);
        },
        undefined,
        () => resolve(null),
      );
    }));
  }
  return environmentTexturePromises.get(url);
}

function applyEnvironmentPbr(material, asset, options = {}) {
  const repeat = options.repeat ?? [1, 1];
  const assignments = [
    ['map', 'diffuse.jpg', true],
    ['normalMap', 'normal-gl.jpg', false],
    ['roughnessMap', 'roughness.jpg', false],
  ];
  assignments.forEach(([property, file, isColor]) => {
    if (property === 'map' && options.colorMap === false) return;
    if (property === 'normalMap' && options.normalMap === false) return;
    if (property === 'roughnessMap' && options.roughnessMap === false) return;
    loadEnvironmentTexture(asset, file, isColor, repeat).then(
      (texture) => {
        if (!texture) return;
        material[property] = texture;
        material.needsUpdate = true;
      },
    );
  });
  if (options.normalScale) material.normalScale.copy(options.normalScale);
  return material;
}

function seededRandom(seed = 0x4e454f4e) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createAsphaltTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  const random = seededRandom(0x41535048);
  for (let i = 0; i < image.data.length; i += 4) {
    const coarse = Math.floor(i / (canvas.width * 16)) % 2;
    const value = 108 + Math.floor(random() * 42) + coarse * 4;
    image.data[i] = value - 4;
    image.data[i + 1] = value;
    image.data[i + 2] = value + 2;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  for (let i = 0; i < 22; i += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 10 + random() * 25;
    const bright = random() > 0.64;
    const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, bright ? 'rgba(170,178,178,.16)' : 'rgba(19,24,26,.2)');
    gradient.addColorStop(0.55, bright ? 'rgba(145,153,153,.08)' : 'rgba(35,41,43,.1)');
    gradient.addColorStop(1, 'rgba(70,76,78,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  context.globalAlpha = 0.22;
  context.strokeStyle = '#252a2d';
  context.lineWidth = 1;
  for (let i = 0; i < 12; i += 1) {
    let x = random() * canvas.width;
    let y = random() * canvas.height;
    context.beginPath();
    context.moveTo(x, y);
    for (let j = 0; j < 5; j += 1) {
      x += (random() - 0.5) * 24;
      y += 8 + random() * 18;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  context.globalAlpha = 0.34;
  for (let i = 0; i < 900; i += 1) {
    const bright = random() > 0.58;
    context.fillStyle = bright ? '#a7adaf' : '#343a3d';
    const size = random() > 0.86 ? 2 : 1;
    context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
  }
  context.globalAlpha = 0.26;
  for (let i = 0; i < 140; i += 1) {
    const size = 2 + random() * 5;
    context.fillStyle = random() > 0.55 ? '#bac0c0' : '#202629';
    context.beginPath();
    context.ellipse(
      random() * canvas.width,
      random() * canvas.height,
      size,
      size * (0.35 + random() * 0.55),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createRoadRoughnessTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = '#d1d1d1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const random = seededRandom(0x57455421);

  // Dense aggregate grain reads at speed while the broad patches hold long wet highlights.
  for (let i = 0; i < 14000; i += 1) {
    const value = Math.floor(150 + random() * 98);
    context.fillStyle = `rgb(${value},${value},${value})`;
    const size = random() > 0.94 ? 2 : 1;
    context.fillRect(random() * canvas.width, random() * canvas.height, size, size);
  }
  for (let i = 0; i < 24; i += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 12 + random() * 42;
    const gradient = context.createRadialGradient(x, y, 1, x, y, radius);
    gradient.addColorStop(0, 'rgba(26,26,26,.88)');
    gradient.addColorStop(0.62, 'rgba(78,78,78,.46)');
    gradient.addColorStop(1, 'rgba(210,210,210,0)');
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  context.globalCompositeOperation = 'multiply';
  for (const x of [76, 180]) {
    const lane = context.createLinearGradient(x - 12, 0, x + 12, 0);
    lane.addColorStop(0, 'rgba(255,255,255,0)');
    lane.addColorStop(0.42, 'rgba(118,118,118,.26)');
    lane.addColorStop(0.58, 'rgba(118,118,118,.26)');
    lane.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = lane;
    context.fillRect(x - 12, 0, 24, canvas.height);
  }
  context.globalCompositeOperation = 'source-over';
  context.strokeStyle = 'rgba(92,92,92,.34)';
  context.lineWidth = 1;
  for (let i = 0; i < 18; i += 1) {
    let x = random() * canvas.width;
    let y = random() * canvas.height;
    context.beginPath();
    context.moveTo(x, y);
    for (let j = 0; j < 4; j += 1) {
      x += (random() - 0.5) * 20;
      y += 5 + random() * 18;
      context.lineTo(x, y);
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

function createRoadReflectionTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 98, 2, 32, 128, 124);
  gradient.addColorStop(0, 'rgba(255,255,255,.9)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,.48)');
  gradient.addColorStop(0.58, 'rgba(255,255,255,.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createFacadeTexture(variant = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const index = variant % 3;
  const random = seededRandom(0x46414345 + index * 0x10101);
  const columnWidth = [16, 12, 20][index];
  const rowHeight = [12, 16, 10][index];
  const bases = ['#111a21', '#151a20', '#101d20'];
  const mullions = ['#253039', '#303038', '#20353a'];
  context.fillStyle = bases[index];
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = mullions[index];
  for (let x = 0; x < canvas.width; x += columnWidth) context.fillRect(x, 0, index === 1 ? 1 : 2, canvas.height);
  for (let y = 0; y < canvas.height; y += rowHeight) context.fillRect(0, y, canvas.width, index === 2 ? 1 : 2);

  const litPalettes = [
    ['#9bdde4', '#d4eef0', '#f0b56d', '#e58b79'],
    ['#b6d5e1', '#f0d095', '#88b6c8', '#cf7e8d'],
    ['#82d7cf', '#d5e9df', '#e0a56f', '#839fb6'],
  ];
  for (let y = 4; y < canvas.height - 4; y += rowHeight) {
    for (let x = 4; x < canvas.width - 4; x += columnWidth) {
      const isLit = random() > [0.7, 0.62, 0.76][index];
      const lit = litPalettes[index];
      context.fillStyle = isLit ? lit[Math.floor(random() * lit.length)] : '#17252d';
      context.globalAlpha = isLit ? 0.72 + random() * 0.24 : 0.82;
      context.fillRect(x, y, Math.max(5, columnWidth - 8), Math.max(4, rowHeight - 7));
      if (isLit) {
        context.fillStyle = '#ffffff';
        context.globalAlpha = 0.16;
        context.fillRect(x, y, Math.max(5, columnWidth - 8), 1);
      }
    }
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createHarborSignTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#071116';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ea425f';
  context.fillRect(0, 0, 14, canvas.height);
  context.fillStyle = '#6deaf2';
  context.fillRect(28, 22, 3, 84);
  context.fillStyle = '#e9f8f8';
  context.font = '700 44px Arial';
  context.fillText('NORTH QUAY', 52, 60);
  context.fillStyle = '#72cbd2';
  context.font = '700 23px Arial';
  context.fillText('HARBOR 07  //  APEX LINE', 54, 94);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createContainerDecalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  const random = seededRandom(0x43415247);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(12,20,23,.82)';
  context.fillRect(18, 18, 476, 156);
  context.strokeStyle = 'rgba(218,229,224,.64)';
  context.lineWidth = 4;
  context.strokeRect(30, 30, 452, 132);
  context.fillStyle = 'rgba(225,238,232,.9)';
  context.font = '700 45px Arial';
  context.fillText('NAXU  4821', 50, 83);
  context.fillStyle = 'rgba(122,205,207,.88)';
  context.font = '700 24px Arial';
  context.fillText('45G1  //  MAX 30.4T  //  QY-07', 51, 126);
  for (let i = 0; i < 46; i += 1) {
    const radius = 2 + random() * 10;
    const x = 18 + random() * 476;
    const y = 18 + random() * 156;
    const rust = context.createRadialGradient(x, y, 0, x, y, radius);
    rust.addColorStop(0, 'rgba(133,54,27,.48)');
    rust.addColorStop(1, 'rgba(82,35,23,0)');
    context.fillStyle = rust;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createCityStreetTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#101c20';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#cf536f';
  context.fillRect(0, 0, 12, canvas.height);
  context.fillStyle = '#5eb4b8';
  context.fillRect(24, 18, 4, 92);
  context.fillStyle = '#dce9e6';
  context.font = '700 39px Arial';
  context.fillText('NEXUS 24', 48, 58);
  context.fillStyle = '#86b9b8';
  context.font = '700 21px Arial';
  context.fillText('METRO LINK  >  EAST DECK', 49, 94);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createCityGantryTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#081217';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#20dcec';
  context.fillRect(0, 0, 16, canvas.height);
  context.fillStyle = '#ff4f86';
  context.fillRect(16, 0, 7, canvas.height);
  context.fillStyle = '#e9f8f8';
  context.font = '700 42px Arial';
  context.fillText('CENTRAL LOOP', 47, 58);
  context.fillStyle = '#78ccd2';
  context.font = '700 22px Arial';
  context.fillText('NIGHT GRID  //  SECTOR 03', 49, 94);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createTunnelServiceTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = '#122126';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f25757';
  context.fillRect(0, 0, 13, canvas.height);
  context.strokeStyle = '#7ce7ec';
  context.lineWidth = 3;
  context.strokeRect(23, 17, 211, 92);
  context.fillStyle = '#eaf8f7';
  context.font = '700 43px Arial';
  context.fillText('E-07', 47, 66);
  context.fillStyle = '#76cbd0';
  context.font = '700 19px Arial';
  context.fillText('SOS  //  120m', 48, 94);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function createTunnelExitGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  const cool = context.createRadialGradient(128, 114, 8, 128, 118, 122);
  cool.addColorStop(0, 'rgba(205,240,235,.82)');
  cool.addColorStop(0.38, 'rgba(103,175,183,.48)');
  cool.addColorStop(0.74, 'rgba(31,84,98,.2)');
  cool.addColorStop(1, 'rgba(3,15,20,0)');
  context.fillStyle = cool;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const warm = context.createRadialGradient(139, 186, 3, 139, 186, 62);
  warm.addColorStop(0, 'rgba(255,179,92,.62)');
  warm.addColorStop(0.42, 'rgba(210,91,54,.22)');
  warm.addColorStop(1, 'rgba(90,30,20,0)');
  context.fillStyle = warm;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMountainGeometry(radialSegments = 11) {
  const heights = [0, 0.17, 0.4, 0.64, 0.83, 1];
  const radii = [1, 0.96, 0.76, 0.52, 0.27, 0.025];
  const positions = [];
  const indices = [];
  for (let ring = 0; ring < heights.length; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const angle = (segment / radialSegments) * Math.PI * 2;
      const wobble = 1
        + Math.sin(segment * 2.17 + ring * 1.31) * 0.11
        + Math.cos(segment * 0.73 - ring * 1.9) * 0.06;
      positions.push(
        Math.cos(angle) * radii[ring] * wobble,
        heights[ring] + Math.sin(segment * 1.7 + ring) * 0.015,
        Math.sin(angle) * radii[ring] * wobble,
      );
    }
  }
  for (let ring = 0; ring < heights.length - 1; ring += 1) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = (ring + 1) * radialSegments + segment;
      const d = (ring + 1) * radialSegments + next;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Tags every object a builder adds to `root` with the reason it is allowed to
 * sit inside the driving corridor - road ribbon, curbs, rails, lamps, tunnel
 * shell, start gantry and so on are meant to line the racing surface.
 * tests/terrain-clearance.mjs uses these tags as its whitelist; anything
 * untagged has to keep its distance from the circuit.
 */
function addTagged(root, reason, build) {
  const start = root.children.length;
  const result = build();
  for (let index = start; index < root.children.length; index += 1) {
    markClearanceExempt(root.children[index], reason);
  }
  return result;
}

function setShadow(object, cast = true, receive = true) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = cast;
    child.receiveShadow = receive;
  });
  return object;
}

const NIGHT_DISTRICT_HELPERS = Object.freeze({
  applyEnvironmentPbr,
  createContainerDecalTexture,
  createHarborSignTexture,
  createRoadReflectionTexture,
});


function createUrbanRoad(root, random, clearance) {
  const urban = new THREE.Group();
  urban.name = 'District_VerticalCity';
  const facadeTexture = createFacadeTexture(1);
  const towerCount = 78;
  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: facadeTexture,
      emissive: 0xc0e8eb,
      emissiveMap: facadeTexture,
      emissiveIntensity: 0.46,
      roughness: 0.48,
      metalness: 0.48,
    }),
    towerCount,
  );
  const windowBands = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.015, 0.16, 1.015),
    new THREE.MeshStandardMaterial({ color: 0x46606a, emissive: 0x16383e, emissiveIntensity: 0.55, roughness: 0.34, metalness: 0.7 }),
    towerCount * 3,
  );
  const roofCapCount = 26;
  const roofCaps = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1.18, 1, 8),
    new THREE.MeshStandardMaterial({ color: 0x283840, roughness: 0.32, metalness: 0.76 }),
    roofCapCount,
  );
  const dummy = new THREE.Object3D();
  const facadeColor = new THREE.Color();
  const facadePalette = [0x71878c, 0x637276, 0x8b8580, 0x57777a, 0x7d8d84, 0x72738a];
  const towerGeometry = towers.geometry;
  let placedTowers = 0;
  let placedCaps = 0;
  for (let i = 0; i < towerCount; i += 1) {
    const t = 0.285 + random() * 0.31;
    const track = tangentFrame(t);
    const sideSign = i % 2 ? 1 : -1;
    const height = 20 + random() * 76;
    const width = 7 + random() * 15;
    const depth = 8 + random() * 18;
    const spread = random();
    const towerRotation = Math.atan2(track.tangent.x, track.tangent.z) + (random() - 0.5) * 0.25;
    // Tower shells used to start 25m off the centre line, close enough for the
    // corner of a 22x26m block to overhang the road. They are now pushed out
    // until the whole footprint clears the circuit (and any shortcut branch).
    const radius = horizontalRadius(towerGeometry, new THREE.Vector3(width, height, depth));
    const candidate = clearance.place((attempt) => {
      const lateral = clearance.requiredDistance(radius, PROP_CLEARANCE) + spread * 34 + attempt * 16;
      const base = track.point.clone().addScaledVector(track.side, lateral * sideSign);
      return { x: base.x, z: base.z, radius, base };
    }, 6);
    if (!candidate) continue;
    const base = candidate.base;
    dummy.position.set(base.x, base.y + height * 0.5 - 2, base.z);
    dummy.scale.set(width, height, depth);
    dummy.rotation.y = towerRotation;
    dummy.updateMatrix();
    towers.setMatrixAt(placedTowers, dummy.matrix);
    facadeColor.setHex(facadePalette[i % facadePalette.length]).offsetHSL(
      (random() - 0.5) * 0.018,
      (random() - 0.5) * 0.035,
      (random() - 0.5) * 0.055,
    );
    towers.setColorAt(placedTowers, facadeColor);
    if (placedCaps < roofCapCount) {
      dummy.position.set(base.x, base.y + height - 0.2, base.z);
      dummy.scale.set(width * (0.24 + random() * 0.18), 2.2 + random() * 4.8, width * (0.24 + random() * 0.18));
      dummy.rotation.set(0, towerRotation, 0);
      dummy.updateMatrix();
      roofCaps.setMatrixAt(placedCaps, dummy.matrix);
      placedCaps += 1;
    }
    for (let band = 0; band < 3; band += 1) {
      dummy.position.y = base.y + height * (0.2 + band * 0.27);
      dummy.scale.set(width, Math.max(0.8, height * 0.02), depth);
      dummy.updateMatrix();
      const index = placedTowers * 3 + band;
      windowBands.setMatrixAt(index, dummy.matrix);
      windowBands.setColorAt(index, new THREE.Color((i + band) % 7 === 0 ? 0x8d5368 : 0x54747c));
    }
    placedTowers += 1;
  }
  // Trim the draw range so rejected instances never show up at the origin.
  towers.count = placedTowers;
  windowBands.count = placedTowers * 3;
  roofCaps.count = placedCaps;
  towers.castShadow = true;
  towers.receiveShadow = true;
  roofCaps.castShadow = true;
  urban.add(towers, windowBands, roofCaps);

  const barrierCount = 64;
  const barrierPanels = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.12, 2.7, 3.5),
    new THREE.MeshBasicMaterial({
      color: 0x183033,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      toneMapped: true,
    }),
    barrierCount,
  );
  for (let i = 0; i < barrierCount; i += 1) {
    const t = 0.31 + (i / barrierCount) * 0.24;
    const side = i % 2 ? 1 : -1;
    barrierPanels.setMatrixAt(i, matrixOnTrack(t, side * (ROAD_WIDTH / 2 + 2.05), 2.2));
  }
  urban.add(barrierPanels);

  const entranceCount = 24;
  const entranceStationCount = entranceCount / 2;
  const entranceShellMaterial = new THREE.MeshBasicMaterial({ color: 0x263234, toneMapped: true });
  const entranceShells = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    entranceShellMaterial,
    entranceCount,
  );
  const entranceDoors = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 2.9, 2.9),
    new THREE.MeshBasicMaterial({ color: 0x132426, toneMapped: true }),
    entranceCount,
  );
  const streetSigns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.24, 0.74, 4.9),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createCityStreetTexture(),
      toneMapped: true,
    }),
    entranceCount,
  );
  const entranceColumns = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.18, 0.22, 4.5, 8),
    new THREE.MeshBasicMaterial({ color: 0x334143, toneMapped: true }),
    entranceCount * 2,
  );
  for (let i = 0; i < entranceCount; i += 1) {
    const station = Math.floor(i / 2);
    const t = 0.302 + (station / (entranceStationCount - 1)) * 0.286;
    const side = i % 2 ? 1 : -1;
    entranceShells.setMatrixAt(
      i,
      matrixOnTrack(t, side * (ROAD_WIDTH / 2 + 6.2), 2.5, new THREE.Vector3(2.8, 5, 6.2)),
    );
    entranceDoors.setMatrixAt(i, matrixOnTrack(t, side * (ROAD_WIDTH / 2 + 4.75), 1.75));
    streetSigns.setMatrixAt(i, matrixOnTrack(t, side * (ROAD_WIDTH / 2 + 4.58), 4.65));
    streetSigns.setColorAt(i, new THREE.Color(i % 5 === 0 ? 0x9b4966 : i % 3 === 0 ? 0x9b713e : 0x488489));
    entranceColumns.setMatrixAt(
      i * 2,
      matrixOnTrack(t - 0.0008, side * (ROAD_WIDTH / 2 + 4.62), 2.25),
    );
    entranceColumns.setMatrixAt(
      i * 2 + 1,
      matrixOnTrack(t + 0.0008, side * (ROAD_WIDTH / 2 + 4.62), 2.25),
    );
  }
  entranceShells.castShadow = true;
  entranceColumns.castShadow = true;
  urban.add(entranceShells, entranceDoors, streetSigns, entranceColumns);

  const gantryProgress = [0.335, 0.405, 0.475, 0.545];
  const cityGantryMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x5d7076, roughness: 0.3, metalness: 0.82 }),
    'metal_plate',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.28, 0.28) },
  );
  const cityGantries = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    cityGantryMaterial,
    gantryProgress.length * 3,
  );
  const cityGantryTexture = createCityGantryTexture();
  const cityGantrySigns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(10.8, 2.15, 0.32),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: cityGantryTexture,
      emissive: 0x6edce5,
      emissiveMap: cityGantryTexture,
      emissiveIntensity: 0.56,
      roughness: 0.28,
      metalness: 0.5,
    }),
    gantryProgress.length,
  );
  const gantryUnderlights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.35, 0.12, 0.4),
    new THREE.MeshBasicMaterial({ color: 0x687575, toneMapped: true }),
    gantryProgress.length * 4,
  );
  gantryProgress.forEach((t, gantry) => {
    cityGantries.setMatrixAt(
      gantry * 3,
      matrixOnTrack(t, -10.15, 3.8, new THREE.Vector3(0.52, 7.6, 0.58)),
    );
    cityGantries.setMatrixAt(
      gantry * 3 + 1,
      matrixOnTrack(t, 10.15, 3.8, new THREE.Vector3(0.52, 7.6, 0.58)),
    );
    cityGantries.setMatrixAt(
      gantry * 3 + 2,
      matrixOnTrack(t, 0, 7.25, new THREE.Vector3(20.8, 0.7, 0.74)),
    );
    cityGantrySigns.setMatrixAt(gantry, matrixOnTrack(t, 0, 6.15));
    [-6, -2, 2, 6].forEach((lateral, lamp) => {
      const index = gantry * 4 + lamp;
      gantryUnderlights.setMatrixAt(index, matrixOnTrack(t, lateral, 6.82));
      gantryUnderlights.setColorAt(index, new THREE.Color(lamp === 0 || lamp === 3 ? 0x997044 : 0x4f8589));
    });
  });
  cityGantries.castShadow = true;
  urban.add(cityGantries, cityGantrySigns, gantryUnderlights);

  const cityLampStationCount = 14;
  const cityLampCount = cityLampStationCount * 2;
  const cityLampPoles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.12, 0.18, 1, 7),
    cityGantryMaterial,
    cityLampCount,
  );
  const cityLampHeads = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.2, 0.18, 0.42),
    new THREE.MeshBasicMaterial({ color: 0x667171, toneMapped: true }),
    cityLampCount,
  );
  const cityLampScale = new THREE.Vector3(1, 6.8, 1);
  for (let station = 0; station < cityLampStationCount; station += 1) {
    const t = 0.3 + (station / (cityLampStationCount - 1)) * 0.292;
    [-1, 1].forEach((side, sideIndex) => {
      const index = station * 2 + sideIndex;
      cityLampPoles.setMatrixAt(index, matrixOnTrack(t, side * 10.9, 3.4, cityLampScale));
      cityLampHeads.setMatrixAt(index, matrixOnTrack(t, side * 10.35, 6.78));
      cityLampHeads.setColorAt(index, new THREE.Color(station % 4 === 0 ? 0x9d693d : 0x5f898b));
    });
  }
  cityLampPoles.castShadow = true;
  urban.add(cityLampPoles, cityLampHeads);

  const utilitySegmentCount = 22;
  const utilitySegmentLength = TRACK_CURVE.getLength() * 0.0142;
  const utilityPipeGeometry = new THREE.CylinderGeometry(0.16, 0.16, utilitySegmentLength, 7);
  utilityPipeGeometry.rotateX(Math.PI / 2);
  const utilityPipes = new THREE.InstancedMesh(
    utilityPipeGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.72 }),
    utilitySegmentCount * 2,
  );
  for (let i = 0; i < utilitySegmentCount; i += 1) {
    const t = 0.303 + (i / (utilitySegmentCount - 1)) * 0.285;
    utilityPipes.setMatrixAt(i * 2, matrixOnTrack(t, -12.15, 5.25));
    utilityPipes.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 12.15, 5.25));
    utilityPipes.setColorAt(i * 2, new THREE.Color(i % 4 === 0 ? 0x7d5948 : 0x3d6064));
    utilityPipes.setColorAt(i * 2 + 1, new THREE.Color(i % 5 === 0 ? 0x725065 : 0x526464));
  }
  const utilitySupportCount = 22;
  const utilitySupports = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    cityGantryMaterial,
    utilitySupportCount,
  );
  for (let i = 0; i < utilitySupportCount / 2; i += 1) {
    const t = 0.306 + (i / (utilitySupportCount / 2 - 1)) * 0.278;
    utilitySupports.setMatrixAt(
      i * 2,
      matrixOnTrack(t, -12.15, 2.65, new THREE.Vector3(0.18, 5.2, 0.18)),
    );
    utilitySupports.setMatrixAt(
      i * 2 + 1,
      matrixOnTrack(t, 12.15, 2.65, new THREE.Vector3(0.18, 5.2, 0.18)),
    );
  }
  urban.add(utilityPipes, utilitySupports);

  const cityReflectionCount = 24;
  const cityReflectionGeometry = new THREE.PlaneGeometry(1, 1);
  cityReflectionGeometry.rotateX(-Math.PI / 2);
  const cityReflections = new THREE.InstancedMesh(
    cityReflectionGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createRoadReflectionTexture(),
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    cityReflectionCount,
  );
  for (let i = 0; i < cityReflectionCount; i += 1) {
    const t = 0.302 + (i / cityReflectionCount) * 0.29;
    const lateral = i % 2 ? 5.25 : -5.25;
    cityReflections.setMatrixAt(
      i,
      matrixOnTrack(t, lateral, 0.034, new THREE.Vector3(0.32 + (i % 3) * 0.09, 1, 3.8 + (i % 5) * 0.72)),
    );
    cityReflections.setColorAt(i, new THREE.Color(i % 6 === 0 ? 0xa94164 : i % 4 === 0 ? 0xa76c37 : 0x438a90));
  }
  cityReflections.renderOrder = 2;
  cityReflections.visible = false;
  urban.add(cityReflections);

  const portalCount = 4;
  const portalFrames = new THREE.InstancedMesh(
    new THREE.TorusGeometry(10.1, 0.14, 5, 16, Math.PI),
    new THREE.MeshBasicMaterial({ color: 0xff4b86, toneMapped: false }),
    portalCount,
  );
  for (let i = 0; i < portalCount; i += 1) {
    portalFrames.setMatrixAt(i, matrixOnTrack(0.34 + i * 0.042, 0, 0.1));
  }
  urban.add(portalFrames);

  const twinGate = new THREE.Group();
  twinGate.name = 'Landmark_CitySkybridge';
  const landmarkFacade = createFacadeTexture(2);
  landmarkFacade.wrapS = THREE.RepeatWrapping;
  landmarkFacade.wrapT = THREE.RepeatWrapping;
  landmarkFacade.repeat.set(3, 5);
  const landmarkTowerMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdce5e6,
    map: landmarkFacade,
    emissive: 0x85d9e0,
    emissiveMap: landmarkFacade,
    emissiveIntensity: 0.62,
    roughness: 0.34,
    metalness: 0.58,
    clearcoat: 0.42,
    clearcoatRoughness: 0.22,
    envMapIntensity: 0.85,
  });
  const landmarkTowers = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.16, 1, 10), landmarkTowerMaterial, 2);
  [-21, 21].forEach((x, index) => {
    dummy.position.set(x, 38, 0);
    dummy.scale.set(8.2, 76, 8.2);
    dummy.rotation.set(0, index ? 0.16 : -0.16, 0);
    dummy.updateMatrix();
    landmarkTowers.setMatrixAt(index, dummy.matrix);
  });
  landmarkTowers.castShadow = true;
  const crownBands = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1, 1, 0.65, 10),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    10,
  );
  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    for (let band = 0; band < 5; band += 1) {
      const index = sideIndex * 5 + band;
      dummy.position.set(sideIndex ? 21 : -21, 25 + band * 10.4, 0);
      dummy.scale.set(8.35, 1, 8.35);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      crownBands.setMatrixAt(index, dummy.matrix);
      crownBands.setColorAt(index, new THREE.Color(sideIndex ? 0xff4f91 : 0x62efff));
    }
  }
  const skybridge = new THREE.Mesh(
    new THREE.BoxGeometry(26, 4.2, 7.4),
    new THREE.MeshPhysicalMaterial({
      color: 0x1a3440,
      emissive: 0x174c5a,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.74,
      clearcoat: 0.55,
    }),
  );
  skybridge.position.y = 47;
  const bridgeRibbon = new THREE.Mesh(
    new THREE.BoxGeometry(21, 0.22, 7.6),
    new THREE.MeshBasicMaterial({ color: 0xff4f91, toneMapped: false }),
  );
  bridgeRibbon.position.y = 45.3;
  const bridgeBraces = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x40535a, roughness: 0.26, metalness: 0.84 }),
    16,
  );
  const braceTransforms = [
    [-15.7, 39.8, -3.15, 0.46, 12.4, 0.45, -0.66],
    [15.7, 39.8, -3.15, 0.46, 12.4, 0.45, 0.66],
    [-15.7, 39.8, 3.15, 0.46, 12.4, 0.45, -0.66],
    [15.7, 39.8, 3.15, 0.46, 12.4, 0.45, 0.66],
    [-12.7, 43.9, -3.2, 0.34, 8.5, 0.34, 0],
    [12.7, 43.9, -3.2, 0.34, 8.5, 0.34, 0],
    [-12.7, 43.9, 3.2, 0.34, 8.5, 0.34, 0],
    [12.7, 43.9, 3.2, 0.34, 8.5, 0.34, 0],
    [-8.3, 47, -3.35, 7.8, 0.26, 0.28, 0],
    [8.3, 47, -3.35, 7.8, 0.26, 0.28, 0],
    [-8.3, 47, 3.35, 7.8, 0.26, 0.28, 0],
    [8.3, 47, 3.35, 7.8, 0.26, 0.28, 0],
    [-13.4, 28.5, -3.25, 0.72, 32, 0.72, 0],
    [13.4, 28.5, -3.25, 0.72, 32, 0.72, 0],
    [-13.4, 28.5, 3.25, 0.72, 32, 0.72, 0],
    [13.4, 28.5, 3.25, 0.72, 32, 0.72, 0],
  ];
  braceTransforms.forEach(([x, y, z, sx, sy, sz, rz], index) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, 0, rz);
    dummy.updateMatrix();
    bridgeBraces.setMatrixAt(index, dummy.matrix);
  });
  bridgeBraces.castShadow = true;
  const spires = new THREE.InstancedMesh(
    new THREE.ConeGeometry(1.1, 13, 8),
    new THREE.MeshBasicMaterial({ color: 0x8df5ff, toneMapped: false }),
    2,
  );
  [-21, 21].forEach((x, index) => {
    dummy.position.set(x, 82.5, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    spires.setMatrixAt(index, dummy.matrix);
  });
  twinGate.add(landmarkTowers, crownBands, skybridge, bridgeRibbon, bridgeBraces, spires);
  twinGate.applyMatrix4(matrixOnTrack(0.515, 0, 0));
  urban.add(twinGate);
  // Everything in the city district is roadside furniture (barriers, gantries,
  // entrances, the skybridge gate that straddles the road) except the tower
  // shells, which are scenery and must satisfy the clearance rule.
  markClearanceExempt(urban, CLEARANCE_EXEMPT.FURNITURE);
  for (const scenery of [towers, windowBands, roofCaps]) delete scenery.userData.clearanceExempt;
  root.add(urban);
  return portalFrames.material;
}

function createRoadsideDetails(root) {
  const details = new THREE.Group();
  details.name = 'TracksideNearField';
  const curbCount = 220;
  const curbs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.48, 0.07, 1.65),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }),
    curbCount * 2,
  );
  const white = new THREE.Color(0x89979b);
  const dark = new THREE.Color(0x293137);
  const tunnelNeutral = new THREE.Color(0x53605f);
  const tunnelAmber = new THREE.Color(0x9b6b31);
  const hiddenCurbScale = new THREE.Vector3(0.001, 0.001, 0.001);
  for (let i = 0; i < curbCount; i += 1) {
    const t = i / curbCount;
    const inMountain = t >= TRACK_DISTRICTS.mountain.start && t < TRACK_DISTRICTS.mountain.end;
    const curbScale = inMountain ? hiddenCurbScale : undefined;
    curbs.setMatrixAt(i, matrixOnTrack(t, -ROAD_WIDTH / 2 - 0.38, 0.03, curbScale));
    curbs.setMatrixAt(i + curbCount, matrixOnTrack(t, ROAD_WIDTH / 2 + 0.38, 0.03, curbScale));
    const color = inMountain
      ? (i % 2 ? tunnelAmber : tunnelNeutral)
      : (i % 2 ? dark : white);
    curbs.setColorAt(i, color);
    curbs.setColorAt(i + curbCount, color);
  }
  curbs.receiveShadow = true;
  details.add(curbs);

  const reflectorCount = 150;
  const reflectors = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.13, 0.48, 0.13),
    new THREE.MeshBasicMaterial({ color: 0xa8c5c6, toneMapped: true }),
    reflectorCount * 2,
  );
  for (let i = 0; i < reflectorCount; i += 1) {
    const t = i / reflectorCount;
    reflectors.setMatrixAt(i, matrixOnTrack(t, -ROAD_WIDTH / 2 - 1.02, 0.42));
    reflectors.setMatrixAt(i + reflectorCount, matrixOnTrack(t, ROAD_WIDTH / 2 + 1.02, 0.42));
  }
  details.add(reflectors);

  const transitionTs = [0.265, 0.615, 0.915];
  const warningLights = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.32, 8, 5),
    new THREE.MeshBasicMaterial({ color: 0xff9d3e, toneMapped: false }),
    transitionTs.length * 2,
  );
  transitionTs.forEach((t, i) => {
    warningLights.setMatrixAt(i * 2, matrixOnTrack(t, -ROAD_WIDTH / 2 - 1.8, 1.1));
    warningLights.setMatrixAt(i * 2 + 1, matrixOnTrack(t, ROAD_WIDTH / 2 + 1.8, 1.1));
  });
  details.add(warningLights);
  root.add(details);
}

function createTerrain(root, random, clearance) {
  const seaMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x07151d,
    roughness: 0.22,
    metalness: 0.15,
    clearcoat: 0.7,
    clearcoatRoughness: 0.18,
  });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500), seaMaterial);
  sea.name = 'RainHarborWater';
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -7.5;
  sea.receiveShadow = true;
  markClearanceExempt(sea, CLEARANCE_EXEMPT.TERRAIN);
  root.add(sea);

  const terrainGeometry = new THREE.PlaneGeometry(1450, 1450, 96, 96);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.attributes.position;
  const corridorSamples = TRACK_CURVE.getSpacedPoints(360);
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const radius = Math.hypot(x, z);
    const edgeRise = Math.max(0, radius - 350) * 0.075;
    const ridge = Math.sin(x * 0.025) * 4 + Math.cos(z * 0.018) * 5;
    const coast = Math.max(0, (x + 165) / 280) * 2;
    const naturalHeight = -5 + edgeRise + ridge + coast + (random() - 0.5) * 2.5;
    let nearestDistanceSquared = Infinity;
    let trackHeight = 0;
    for (const sample of corridorSamples) {
      const dx = sample.x - x;
      const dz = sample.z - z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared >= nearestDistanceSquared) continue;
      nearestDistanceSquared = distanceSquared;
      trackHeight = sample.y;
    }
    const trackDistance = Math.sqrt(nearestDistanceSquared);
    const naturalBlend = THREE.MathUtils.smoothstep(trackDistance, 15, 48);
    positions.setY(i, THREE.MathUtils.lerp(trackHeight - 2.6, naturalHeight, naturalBlend));
  }
  terrainGeometry.computeVertexNormals();
  const terrain = new THREE.Mesh(terrainGeometry, new THREE.MeshStandardMaterial({
    color: 0x172a27,
    emissive: 0x07110f,
    emissiveIntensity: 0.34,
    roughness: 0.98,
    metalness: 0.02,
    flatShading: true,
  }));
  terrain.receiveShadow = true;
  markClearanceExempt(terrain, CLEARANCE_EXEMPT.TERRAIN);
  root.add(terrain);

  const mountainGeometry = createMountainGeometry();
  const mountainMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({
      color: 0xa2aaa6,
      emissive: 0x050b0a,
      emissiveIntensity: 0.18,
      roughness: 0.92,
      flatShading: true,
    }),
    'dark_rock',
    { repeat: [1.5, 1.5], normalScale: new THREE.Vector2(0.52, 0.52) },
  );
  const mountains = new THREE.InstancedMesh(mountainGeometry, mountainMaterial, 36);
  const dummy = new THREE.Object3D();
  const mountainColor = new THREE.Color();
  const point = new THREE.Vector3();
  let placed = 0;
  for (let i = 0; i < 36; i += 1) {
    // Laid out along the circuit (like the scenic maps) instead of on a ring
    // around the world origin, so the ridge can never reach the road.
    const t = ((i + 0.5) / 36 + (random() - 0.5) * 0.008 + 1) % 1;
    const frame = tangentFrame(t);
    point.copy(frame.point);
    const outward = clearance.outwardSign(point, frame.side);
    const height = 70 + random() * 95;
    const width = 78 + random() * 76;
    const scale = new THREE.Vector3(width, height, width * (0.65 + random() * 0.45));
    const radius = horizontalRadius(mountainGeometry, scale);
    const spread = random();
    const rotation = random() * Math.PI;
    const candidate = clearance.place((attempt) => {
      const distance = clearance.requiredDistance(radius, TERRAIN_CLEARANCE) + spread * 120 + attempt * 45;
      return {
        x: point.x + frame.side.x * outward * distance,
        z: point.z + frame.side.z * outward * distance,
        radius,
        clearance: TERRAIN_CLEARANCE,
      };
    }, 5);
    if (!candidate) continue;
    dummy.position.set(candidate.x, height * 0.5 - 6, candidate.z);
    dummy.scale.copy(scale);
    dummy.rotation.y = rotation;
    dummy.updateMatrix();
    mountains.setMatrixAt(placed, dummy.matrix);
    mountainColor.setHSL(0.48 + random() * 0.04, 0.1, 0.36 + random() * 0.1);
    mountains.setColorAt(placed, mountainColor);
    placed += 1;
  }
  mountains.count = placed;
  mountains.receiveShadow = true;
  root.add(mountains);
  return sea;
}

function createRoad(root, shortcuts) {
  const roadMaterial = applyEnvironmentPbr(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: createAsphaltTexture(),
      vertexColors: true,
      roughness: 0.64,
      roughnessMap: createRoadRoughnessTexture(),
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 1.2,
    }),
    'asphalt_02',
    {
      repeat: [4, 1],
      normalScale: new THREE.Vector2(0.88, 0.88),
      colorMap: false,
      roughnessMap: false,
    },
  );
  roadMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      float roadMacro = sin(vMapUv.y * 1.73 + sin(vMapUv.x * 13.0) * 1.2) * 0.5 + 0.5;
      float roadPatch = sin(vMapUv.y * 0.21 + vMapUv.x * 5.4)
        * cos(vMapUv.y * 0.085 - vMapUv.x * 8.2) * 0.5 + 0.5;
      roadPatch = smoothstep(0.26, 0.84, roadPatch);
      float roadGrain = sin(vMapUv.x * 93.0 + vMapUv.y * 61.0)
        * sin(vMapUv.x * 47.0 - vMapUv.y * 79.0) * 0.5 + 0.5;
      float leftTrack = 1.0 - smoothstep(0.018, 0.06, abs(vMapUv.x - 0.32));
      float rightTrack = 1.0 - smoothstep(0.018, 0.06, abs(vMapUv.x - 0.68));
      float tirePair = clamp(leftTrack + rightTrack, 0.0, 1.0);
      float wetVariation = smoothstep(
        0.63,
        0.93,
        sin(vMapUv.y * 0.86 + sin(vMapUv.x * 8.0)) * 0.5 + 0.5
      );
      diffuseColor.rgb *= 0.68 + roadMacro * 0.29 + roadPatch * 0.18 + roadGrain * 0.08;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.61, 0.61), tirePair * 0.48);
      diffuseColor.rgb += vec3(0.018, 0.023, 0.022) * wetVariation;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor *= 0.76 + roadGrain * 0.27 + roadPatch * 0.08;
      roughnessFactor *= 1.0 - tirePair * 0.27;
      roughnessFactor *= 1.0 - wetVariation * 0.31;`,
    );
  };
  roadMaterial.customProgramCacheKey = () => 'neon-apex-road-surface-v3';
  const road = new THREE.Mesh(
    ribbonGeometry(-ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0, TRACK_SAMPLES, [0xc3c8c3, 0xa0aaa6]),
    roadMaterial,
  );
  road.receiveShadow = true;
  root.add(road);

  const shoulderMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.67,
    metalness: 0.15,
  });
  const leftShoulder = new THREE.Mesh(
    ribbonGeometry(-ROAD_WIDTH / 2 - 1.55, -ROAD_WIDTH / 2, -0.035, TRACK_SAMPLES, [0x5e6870, 0x20272d]),
    shoulderMaterial,
  );
  const rightShoulder = new THREE.Mesh(
    ribbonGeometry(ROAD_WIDTH / 2, ROAD_WIDTH / 2 + 1.55, -0.035, TRACK_SAMPLES, [0x20272d, 0x5e6870]),
    shoulderMaterial,
  );
  leftShoulder.receiveShadow = true;
  rightShoulder.receiveShadow = true;
  root.add(leftShoulder, rightShoulder);

  const underRoad = new THREE.Mesh(
    ribbonGeometry(-ROAD_WIDTH / 2 - 1.7, ROAD_WIDTH / 2 + 1.7, -1.35, TRACK_SAMPLES, [0x080b0e, 0x080b0e]),
    new THREE.MeshStandardMaterial({ color: 0x101317, roughness: 0.95, vertexColors: true }),
  );
  root.add(underRoad);

  const dashGeometry = new THREE.BoxGeometry(0.12, 0.025, 2.7);
  const dashMaterial = new THREE.MeshBasicMaterial({ color: 0xa5bdbe, toneMapped: true });
  const dashCount = 176;
  const dashes = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashCount * 2);
  const scale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < dashCount; i += 1) {
    const t = i / dashCount;
    dashes.setMatrixAt(i, matrixOnTrack(t, -ROAD_WIDTH / 4, 0.03, scale));
    dashes.setMatrixAt(i + dashCount, matrixOnTrack(t, ROAD_WIDTH / 4, 0.03, scale));
  }
  root.add(dashes);

  const railSamples = 286;
  const segmentLength = TRACK_CURVE.getLength() / railSamples * 1.075;
  const railGeometry = new THREE.BoxGeometry(0.18, 0.19, segmentLength);
  const railMaterial = new THREE.MeshBasicMaterial({ color: 0x354143, toneMapped: true });
  const rails = new THREE.InstancedMesh(railGeometry, railMaterial, railSamples * 4);
  rails.userData.guardrail = true;
  // Rail rows are written through a running index so a shortcut mouth can drop
  // its segments; without zones every slot is filled exactly as before.
  let railIndex = 0;
  for (let i = 0; i < railSamples; i += 1) {
    const t = i / railSamples;
    for (const direction of [-1, 1]) {
      if (shortcuts.isOpen(t, direction)) continue;
      for (const vertical of [0.62, 1.05]) {
        rails.setMatrixAt(railIndex, matrixOnTrack(t, direction * (ROAD_WIDTH / 2 + 1.35), vertical, scale));
        railIndex += 1;
      }
    }
  }
  rails.count = railIndex;
  rails.castShadow = true;
  rails.receiveShadow = true;
  root.add(rails);

  const capGeometry = new THREE.CylinderGeometry(0.105, 0.105, segmentLength, 7, 1);
  capGeometry.rotateX(Math.PI / 2);
  const railCaps = new THREE.InstancedMesh(
    capGeometry,
    railMaterial,
    railSamples * 2,
  );
  railCaps.userData.guardrail = true;
  let capIndex = 0;
  for (let i = 0; i < railSamples; i += 1) {
    const t = i / railSamples;
    for (const direction of [-1, 1]) {
      if (shortcuts.isOpen(t, direction)) continue;
      railCaps.setMatrixAt(capIndex, matrixOnTrack(t, direction * (ROAD_WIDTH / 2 + 1.35), 1.18, scale));
      capIndex += 1;
    }
  }
  railCaps.count = capIndex;
  railCaps.castShadow = true;
  root.add(railCaps);

  const postGeometry = new THREE.BoxGeometry(0.18, 1.2, 0.18);
  const posts = new THREE.InstancedMesh(postGeometry, railMaterial, railSamples);
  posts.userData.guardrail = true;
  let postIndex = 0;
  for (let i = 0; i < railSamples / 2; i += 1) {
    const t = (i * 2) / railSamples;
    for (const direction of [-1, 1]) {
      if (shortcuts.isOpen(t, direction)) continue;
      posts.setMatrixAt(postIndex, matrixOnTrack(t, direction * (ROAD_WIDTH / 2 + 1.35), 0.36, scale));
      postIndex += 1;
    }
  }
  posts.count = postIndex;
  root.add(posts);

  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x274f57, toneMapped: true });
  const edgeMaterialAlt = new THREE.MeshBasicMaterial({ color: 0x522434, toneMapped: true });
  const edgeLeft = new THREE.Mesh(
    ribbonGeometry(-ROAD_WIDTH / 2 - 1.42, -ROAD_WIDTH / 2 - 1.27, 1.18, 360, [COLORS.magenta, COLORS.magenta]),
    edgeMaterialAlt,
  );
  const edgeRight = new THREE.Mesh(
    ribbonGeometry(ROAD_WIDTH / 2 + 1.27, ROAD_WIDTH / 2 + 1.42, 1.18, 360, [COLORS.cyan, COLORS.cyan]),
    edgeMaterial,
  );
  root.add(edgeLeft, edgeRight);

  return road;
}

function createWetPatches(root, random) {
  const count = 40;
  const patchPlacements = Array.from({ length: count }, () => ({
    t: random(),
    lateral: (random() - 0.5) * (ROAD_WIDTH - 4),
    scale: new THREE.Vector3(0.38 + random() * 0.82, 1, 1.1 + random() * 2.3),
  }));
  const visiblePatchPlacements = patchPlacements.filter(
    ({ t }) => t < TRACK_DISTRICTS.mountain.start || t >= TRACK_DISTRICTS.mountain.end,
  );
  const geometry = new THREE.CircleGeometry(1, 24);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x50676b,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.68,
    clearcoatRoughness: 0.12,
    transparent: true,
    opacity: 0.052,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const patches = new THREE.InstancedMesh(geometry, material, visiblePatchPlacements.length);
  visiblePatchPlacements.forEach(({ t, lateral, scale }, index) => {
    patches.setMatrixAt(index, matrixOnTrack(t, lateral, 0.018, scale));
  });
  patches.renderOrder = 2;
  root.add(patches);

  const wheelSheenMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.18,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const wheelSheen = new THREE.Mesh(
    ribbonGeometry(-3.05, -2.25, 0.012, TRACK_SAMPLES, [0x789092, 0x405557]),
    wheelSheenMaterial,
  );
  const rightWheelSheen = new THREE.Mesh(
    ribbonGeometry(2.25, 3.05, 0.012, TRACK_SAMPLES, [0x405557, 0x789092]),
    wheelSheenMaterial,
  );
  wheelSheen.renderOrder = 1;
  rightWheelSheen.renderOrder = 1;
  root.add(wheelSheen, rightWheelSheen);

  const tireMarkMaterial = new THREE.MeshBasicMaterial({
    color: 0x111719,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const leftTireMarks = new THREE.Mesh(
    ribbonGeometry(-2.92, -2.5, 0.017, TRACK_SAMPLES),
    tireMarkMaterial,
  );
  const rightTireMarks = new THREE.Mesh(
    ribbonGeometry(2.5, 2.92, 0.017, TRACK_SAMPLES),
    tireMarkMaterial,
  );
  leftTireMarks.renderOrder = 1;
  rightTireMarks.renderOrder = 1;
  root.add(leftTireMarks, rightTireMarks);

  const skidStationCount = 32;
  const skidGeometry = new THREE.PlaneGeometry(1, 1);
  skidGeometry.rotateX(-Math.PI / 2);
  const skidMarks = new THREE.InstancedMesh(
    skidGeometry,
    new THREE.MeshBasicMaterial({
      color: 0x050708,
      map: createRoadReflectionTexture(),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    }),
    skidStationCount * 2,
  );
  for (let station = 0; station < skidStationCount; station += 1) {
    const t = (0.012 + station / skidStationCount) % 1;
    const spread = 2.48 + Math.sin(station * 1.73) * 0.17;
    const markScale = new THREE.Vector3(0.34 + (station % 3) * 0.06, 1, 4.8 + (station % 5) * 0.9);
    skidMarks.setMatrixAt(station * 2, matrixOnTrack(t, -spread, 0.02, markScale));
    skidMarks.setMatrixAt(station * 2 + 1, matrixOnTrack(t + 0.00035, spread, 0.02, markScale));
  }
  skidMarks.renderOrder = 1;
  root.add(skidMarks);

  const reflectionStationCount = 48;
  const visibleReflectionCount = Array.from(
    { length: reflectionStationCount },
    (_, index) => index / reflectionStationCount,
  ).filter((t) => t < TRACK_DISTRICTS.mountain.start || t >= TRACK_DISTRICTS.mountain.end).length;
  const reflectionGeometry = new THREE.PlaneGeometry(1, 1);
  reflectionGeometry.rotateX(-Math.PI / 2);
  const reflectionMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: createRoadReflectionTexture(),
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  const reflections = new THREE.InstancedMesh(
    reflectionGeometry,
    reflectionMaterial,
    visibleReflectionCount * 2,
  );
  const reflectionColor = new THREE.Color();
  const reflectionScale = new THREE.Vector3();
  let reflectionIndex = 0;
  for (let i = 0; i < reflectionStationCount; i += 1) {
    const t = i / reflectionStationCount;
    const length = 4.5 + random() * 6.5;
    const width = 0.32 + random() * 0.44;
    if (t >= TRACK_DISTRICTS.mountain.start && t < TRACK_DISTRICTS.mountain.end) continue;
    const color = t < 0.27 || t >= 0.92
      ? 0xd58b4e
      : t < 0.62
        ? (i % 5 === 0 ? 0xc75b84 : 0x66c9d3)
        : 0x9fc5ca;
    reflectionColor.setHex(color);
    reflectionScale.set(width, 1, length);
    reflections.setMatrixAt(reflectionIndex * 2, matrixOnTrack(t, -5.35, 0.026, reflectionScale));
    reflections.setMatrixAt(reflectionIndex * 2 + 1, matrixOnTrack(t, 5.35, 0.026, reflectionScale));
    reflections.setColorAt(reflectionIndex * 2, reflectionColor);
    reflections.setColorAt(reflectionIndex * 2 + 1, reflectionColor);
    reflectionIndex += 1;
  }
  reflections.renderOrder = 1;
  root.add(reflections);
}

function createStartLine(root) {
  const start = new THREE.Group();
  start.name = 'StartGantry';
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x1e2a31,
    roughness: 0.28,
    metalness: 0.9,
  });
  const cyan = new THREE.MeshBasicMaterial({ color: COLORS.cyan, toneMapped: false });
  const magenta = new THREE.MeshBasicMaterial({ color: COLORS.magenta, toneMapped: false });
  const signMaterial = new THREE.MeshStandardMaterial({
    color: 0x091119,
    emissive: 0x092f38,
    emissiveIntensity: 1.4,
    metalness: 0.65,
    roughness: 0.28,
  });

  const left = new THREE.Mesh(new THREE.BoxGeometry(0.48, 7.5, 0.62), frameMaterial);
  const right = left.clone();
  left.position.set(-10.2, 3.35, 0);
  right.position.set(10.2, 3.35, 0);
  const top = new THREE.Mesh(new THREE.BoxGeometry(20.8, 0.55, 0.74), frameMaterial);
  top.position.y = 7;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1.4, 0.24), signMaterial);
  sign.position.set(0, 6.6, 0.48);
  const slashGeometry = new THREE.BoxGeometry(1.7, 0.16, 0.07);
  const cyanSlashes = new THREE.InstancedMesh(slashGeometry, cyan, 3);
  const magentaSlashes = new THREE.InstancedMesh(slashGeometry, magenta, 2);
  const dummy = new THREE.Object3D();
  let cyanIndex = 0;
  let magentaIndex = 0;
  for (let i = -2; i <= 2; i += 1) {
    dummy.position.set(i * 1.55, 6.6, 0.64);
    dummy.rotation.set(0, 0, -0.68);
    dummy.updateMatrix();
    if (i % 2) {
      magentaSlashes.setMatrixAt(magentaIndex, dummy.matrix);
      magentaIndex += 1;
    } else {
      cyanSlashes.setMatrixAt(cyanIndex, dummy.matrix);
      cyanIndex += 1;
    }
  }
  start.add(left, right, top, sign, cyanSlashes, magentaSlashes);
  start.applyMatrix4(matrixOnTrack(0, 0, 0));
  setShadow(start);
  root.add(start);

  const line = new THREE.Group();
  const tileGeometry = new THREE.BoxGeometry(1, 0.025, 1.25);
  const white = new THREE.MeshStandardMaterial({ color: 0xe7eef0, roughness: 0.72 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101317, roughness: 0.84 });
  const whiteTiles = new THREE.InstancedMesh(tileGeometry, white, 16);
  const darkTiles = new THREE.InstancedMesh(tileGeometry, dark, 16);
  let whiteIndex = 0;
  let darkIndex = 0;
  for (let x = 0; x < 16; x += 1) {
    for (let z = 0; z < 2; z += 1) {
      dummy.position.set(x - 7.5, 0.035, z - 0.5);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      if ((x + z) % 2) {
        whiteTiles.setMatrixAt(whiteIndex, dummy.matrix);
        whiteIndex += 1;
      } else {
        darkTiles.setMatrixAt(darkIndex, dummy.matrix);
        darkIndex += 1;
      }
    }
  }
  line.add(whiteTiles, darkTiles);
  line.applyMatrix4(matrixOnTrack(0.014, 0, 0.02));
  root.add(line);
  return start;
}

function createTunnel(root) {
  const group = new THREE.Group();
  group.name = 'MountainStormTunnel';
  const archGeometry = new THREE.TorusGeometry(10.2, 0.28, 7, 24, Math.PI);
  const darkMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x89969a, roughness: 0.3, metalness: 0.9 }),
    'metal_plate',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.26, 0.26) },
  );
  const neonMaterial = new THREE.MeshBasicMaterial({ color: 0x9eefff, toneMapped: false });
  const archCount = 14;
  const litArchCount = 6;
  const frames = new THREE.InstancedMesh(archGeometry, darkMaterial, archCount);
  const neon = new THREE.InstancedMesh(
    new THREE.TorusGeometry(9.82, 0.085, 5, 24, Math.PI),
    neonMaterial,
    litArchCount + 2,
  );
  let neonIndex = 0;
  for (let i = 0; i < archCount; i += 1) {
    const t = 0.744 + i * 0.00615;
    const maintenanceGap = i % 5 === 3;
    const archScale = 0.985 + (i % 4) * 0.012;
    const frame = matrixOnTrack(
      t,
      0,
      0.1 + (i % 3) * 0.05,
      maintenanceGap
        ? new THREE.Vector3(0.001, 0.001, 0.001)
        : new THREE.Vector3(archScale, 1 + (i % 2) * 0.018, 1),
    );
    frames.setMatrixAt(i, frame);
    frames.setColorAt(i, new THREE.Color(i % 3 === 0 ? 0xb2b8b5 : i % 3 === 1 ? 0x7e9192 : 0x96928b));
    if (i % 2 === 0 && !maintenanceGap) {
      neon.setMatrixAt(neonIndex, frame);
      neon.setColorAt(neonIndex, new THREE.Color(i % 6 === 0 ? 0xffc27a : 0xa7f4f1));
      neonIndex += 1;
    }
  }
  neon.setMatrixAt(neonIndex, matrixOnTrack(0.831, 0, 0.15));
  neon.setColorAt(neonIndex, new THREE.Color(0x9bf1ee));
  neon.setMatrixAt(neonIndex + 1, matrixOnTrack(0.837, 0, 0.15, new THREE.Vector3(1.055, 1.055, 1.055)));
  neon.setColorAt(neonIndex + 1, new THREE.Color(0xffb96c));

  const panelCount = 18;
  const panelLength = TRACK_CURVE.getLength() * 0.0049;
  const tunnelShellMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({
      color: 0x667472,
      emissive: 0x081416,
      emissiveIntensity: 0.16,
      roughness: 0.76,
      metalness: 0.08,
    }),
    'concrete_wall_008',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.58, 0.58) },
  );
  const wallPanels = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.58, 8.1, panelLength),
    tunnelShellMaterial,
    panelCount * 2,
  );
  const roofPanels = new THREE.InstancedMesh(
    new THREE.BoxGeometry(19.4, 0.58, panelLength),
    tunnelShellMaterial,
    panelCount,
  );
  const guideStrips = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.14, 0.2, panelLength * 0.82),
    new THREE.MeshBasicMaterial({ color: 0x3e7379, toneMapped: true }),
    panelCount * 2,
  );
  const serviceWalkways = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.09, panelLength),
    new THREE.MeshBasicMaterial({ color: 0x202d2e, toneMapped: true }),
    panelCount * 2,
  );
  for (let i = 0; i < panelCount; i += 1) {
    const t = 0.743 + i * 0.00475;
    wallPanels.setMatrixAt(i * 2, matrixOnTrack(t, -9.62, 4.15));
    wallPanels.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 9.62, 4.15));
    roofPanels.setMatrixAt(i, matrixOnTrack(t, 0, 9.55));
    wallPanels.setColorAt(i * 2, new THREE.Color(i % 3 === 0 ? 0x889591 : 0x74827f));
    wallPanels.setColorAt(i * 2 + 1, new THREE.Color(i % 4 === 0 ? 0x8f8176 : 0x788683));
    roofPanels.setColorAt(i, new THREE.Color(i % 3 === 1 ? 0x3f4948 : 0x515a58));
    guideStrips.setMatrixAt(i * 2, matrixOnTrack(t, -9.28, 1.45));
    guideStrips.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 9.28, 1.45));
    serviceWalkways.setMatrixAt(i * 2, matrixOnTrack(t, -8.78, 0.055));
    serviceWalkways.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 8.78, 0.055));
  }
  wallPanels.receiveShadow = true;
  roofPanels.receiveShadow = true;

  const portalMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x9aa19d, roughness: 0.88, metalness: 0.04 }),
    'concrete_wall_008',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.7, 0.7) },
  );
  const stonePortals = new THREE.InstancedMesh(
    new THREE.TorusGeometry(10.15, 1.05, 8, 28, Math.PI),
    portalMaterial,
    3,
  );
  stonePortals.setMatrixAt(0, matrixOnTrack(0.739, 0, 0.08));
  stonePortals.setMatrixAt(1, matrixOnTrack(0.831, 0, 0.08));
  stonePortals.setMatrixAt(2, matrixOnTrack(0.837, 0, 0.08, new THREE.Vector3(1.08, 1.08, 1.08)));
  stonePortals.castShadow = true;
  const tunnelLights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.36, 0.15, 1.1),
    new THREE.MeshBasicMaterial({ color: 0x526f70, toneMapped: true }),
    18,
  );
  for (let i = 0; i < 18; i += 1) {
    const t = 0.746 + i * 0.00435;
    tunnelLights.setMatrixAt(i, matrixOnTrack(t, i % 2 ? -6.7 : 6.7, 5.7));
  }

  const tunnelPipeGeometry = new THREE.CylinderGeometry(0.14, 0.14, panelLength * 0.94, 7);
  tunnelPipeGeometry.rotateX(Math.PI / 2);
  const tunnelPipes = new THREE.InstancedMesh(
    tunnelPipeGeometry,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.68 }),
    panelCount * 2,
  );
  for (let i = 0; i < panelCount; i += 1) {
    const t = 0.743 + i * 0.00475;
    tunnelPipes.setMatrixAt(i * 2, matrixOnTrack(t, -9.02, 6.75));
    tunnelPipes.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 9.02, 6.75));
    tunnelPipes.setColorAt(i * 2, new THREE.Color(i % 4 === 0 ? 0x805d47 : 0x40595c));
    tunnelPipes.setColorAt(i * 2 + 1, new THREE.Color(i % 3 === 0 ? 0x6e4d56 : 0x4e5d5d));
  }
  const pipeClampCount = 18;
  const pipeClamps = new THREE.InstancedMesh(
    new THREE.TorusGeometry(0.23, 0.035, 5, 10),
    new THREE.MeshStandardMaterial({ color: 0x829092, roughness: 0.36, metalness: 0.82 }),
    pipeClampCount,
  );
  for (let i = 0; i < pipeClampCount / 2; i += 1) {
    const t = 0.746 + i * 0.00925;
    pipeClamps.setMatrixAt(i * 2, matrixOnTrack(t, -9.02, 6.75));
    pipeClamps.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 9.02, 6.75));
  }
  const serviceSignCount = 8;
  const tunnelServiceTexture = createTunnelServiceTexture();
  const tunnelServiceSigns = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.16, 1.35, 2.75),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tunnelServiceTexture,
      emissive: 0x8cebf0,
      emissiveMap: tunnelServiceTexture,
      emissiveIntensity: 0.46,
      roughness: 0.34,
      metalness: 0.42,
    }),
    serviceSignCount,
  );
  const emergencyCabinets = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.32, 2.1, 1.05),
    new THREE.MeshStandardMaterial({
      color: 0xb73134,
      emissive: 0x4f0708,
      emissiveIntensity: 0.85,
      roughness: 0.42,
      metalness: 0.5,
    }),
    serviceSignCount,
  );
  for (let i = 0; i < serviceSignCount; i += 1) {
    const t = 0.75 + i * 0.00925;
    const side = i % 2 ? 1 : -1;
    tunnelServiceSigns.setMatrixAt(i, matrixOnTrack(t, side * 9.2, 4.1));
    emergencyCabinets.setMatrixAt(i, matrixOnTrack(t + 0.0015, side * 9.14, 2.05));
  }

  const exitGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(18.2, 10.4),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createTunnelExitGlowTexture(),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: true,
      side: THREE.DoubleSide,
    }),
  );
  exitGlow.applyMatrix4(matrixOnTrack(0.846, 0, 5.1));
  exitGlow.renderOrder = 1;

  const exitReflectionCount = 8;
  const exitReflectionGeometry = new THREE.PlaneGeometry(1, 1);
  exitReflectionGeometry.rotateX(-Math.PI / 2);
  const exitReflections = new THREE.InstancedMesh(
    exitReflectionGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createRoadReflectionTexture(),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: true,
    }),
    exitReflectionCount,
  );
  for (let i = 0; i < exitReflectionCount; i += 1) {
    const t = 0.813 + i * 0.0035;
    exitReflections.setMatrixAt(
      i,
      matrixOnTrack(t, i % 2 ? 3.3 : -3.3, 0.035, new THREE.Vector3(0.55, 1, 5.6 + i * 0.42)),
    );
    exitReflections.setColorAt(i, new THREE.Color(i < 4 ? 0x456f72 : 0x85603e));
  }
  exitReflections.renderOrder = 2;

  const exitSilhouette = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x263235, roughness: 0.88, metalness: 0.08 }),
    3,
  );
  exitSilhouette.setMatrixAt(0, matrixOnTrack(0.849, -9.35, 5, new THREE.Vector3(1.25, 10, 2.2)));
  exitSilhouette.setMatrixAt(1, matrixOnTrack(0.849, 9.35, 5, new THREE.Vector3(1.25, 10, 2.2)));
  exitSilhouette.setMatrixAt(2, matrixOnTrack(0.849, 0, 9.45, new THREE.Vector3(19.4, 1.1, 2.2)));
  exitSilhouette.castShadow = true;

  const seamCount = panelCount + 1;
  const seamMaterial = new THREE.MeshStandardMaterial({
    color: 0x536266,
    roughness: 0.56,
    metalness: 0.46,
  });
  const wallSeams = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.08, 7.8, 0.12),
    seamMaterial,
    seamCount * 2,
  );
  const roofSeams = new THREE.InstancedMesh(
    new THREE.BoxGeometry(18.8, 0.08, 0.12),
    seamMaterial,
    seamCount,
  );
  for (let i = 0; i < seamCount; i += 1) {
    const t = 0.741 + i * 0.00475;
    wallSeams.setMatrixAt(i * 2, matrixOnTrack(t, -9.27, 4.2));
    wallSeams.setMatrixAt(i * 2 + 1, matrixOnTrack(t, 9.27, 4.2));
    roofSeams.setMatrixAt(i, matrixOnTrack(t, 0, 9.22));
  }

  const serviceMaterial = new THREE.MeshStandardMaterial({
    color: 0x253237,
    roughness: 0.34,
    metalness: 0.82,
  });
  const ventCount = 9;
  const serviceFixtureCount = ventCount + ventCount * 2 + 4;
  const serviceFixtures = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    serviceMaterial,
    serviceFixtureCount,
  );
  const ventilationFans = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(1.15, 1.15, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0x10181b, roughness: 0.52, metalness: 0.72 }),
    ventCount,
  );
  let fixtureIndex = 0;
  for (let i = 0; i < ventCount; i += 1) {
    const t = 0.749 + i * 0.00845;
    const lateral = i % 2 ? -2.35 : 2.35;
    serviceFixtures.setMatrixAt(
      fixtureIndex,
      matrixOnTrack(t, lateral, 8.92, new THREE.Vector3(3.5, 0.42, 2.8)),
    );
    fixtureIndex += 1;
    ventilationFans.setMatrixAt(i, matrixOnTrack(t, lateral, 8.66));
    for (const bracketLateral of [-6.7, 6.7]) {
      serviceFixtures.setMatrixAt(
        fixtureIndex,
        matrixOnTrack(t, bracketLateral, 6.25, new THREE.Vector3(0.16, 1.25, 0.22)),
      );
      fixtureIndex += 1;
    }
  }
  for (let i = 0; i < 4; i += 1) {
    const t = i < 2 ? 0.834 : 0.839;
    const lateral = i % 2 ? 13.2 : -13.2;
    serviceFixtures.setMatrixAt(
      fixtureIndex,
      matrixOnTrack(t, lateral, 4.1, new THREE.Vector3(5.6, 8.2, 2.8)),
    );
    fixtureIndex += 1;
  }
  wallSeams.castShadow = true;
  roofSeams.castShadow = true;
  serviceFixtures.castShadow = true;
  frames.castShadow = true;
  group.add(
    wallPanels,
    roofPanels,
    wallSeams,
    roofSeams,
    serviceWalkways,
    guideStrips,
    stonePortals,
    frames,
    neon,
    tunnelLights,
    tunnelPipes,
    pipeClamps,
    tunnelServiceSigns,
    emergencyCabinets,
    serviceFixtures,
    ventilationFans,
    exitGlow,
    exitReflections,
    exitSilhouette,
  );
  root.add(group);
  return neonMaterial;
}

function createCity(root, random, clearance) {
  const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
  const facadeTexture = createFacadeTexture();
  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: facadeTexture,
    emissive: 0xb8dce0,
    emissiveMap: facadeTexture,
    emissiveIntensity: 0.38,
    roughness: 0.48,
    metalness: 0.46,
  });
  const windowGeometry = new THREE.BoxGeometry(1.015, 0.78, 1.015);
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x3e5861,
    emissive: 0x16353a,
    emissiveIntensity: 0.42,
    roughness: 0.32,
    metalness: 0.5,
  });
  const count = 118;
  const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, count);
  const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, count * 3);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 40) {
    attempts += 1;
    const x = (random() - 0.5) * 360;
    const z = (random() - 0.5) * 310;
    const distance = Math.hypot(x, z);
    const height = Math.max(10, 70 - distance * 0.12) + random() * 58;
    const width = 8 + random() * 15;
    const depth = 8 + random() * 16;
    // Was a 52m check against 80 samples of the curve; now the shared field
    // (720 samples plus any shortcut branch) validates the real footprint.
    const radius = horizontalRadius(buildingGeometry, new THREE.Vector3(width, height, depth));
    if (!clearance.clears(x, z, radius, PROP_CLEARANCE)) continue;
    dummy.position.set(x, height * 0.5 - 3.5, z);
    dummy.scale.set(width, height, depth);
    dummy.rotation.y = (Math.round(random() * 4) * Math.PI) / 2;
    dummy.updateMatrix();
    buildings.setMatrixAt(placed, dummy.matrix);
    color.setHSL(0.56 + random() * 0.06, 0.06 + random() * 0.07, 0.45 + random() * 0.12);
    buildings.setColorAt(placed, color);

    const lightColor = random() > 0.22 ? new THREE.Color(0x53747c) : new THREE.Color(0x805866);
    for (let band = 0; band < 3; band += 1) {
      dummy.position.set(x, -3.5 + height * (0.22 + band * 0.27), z);
      dummy.scale.set(width, Math.max(1.1, height * 0.026), depth);
      dummy.updateMatrix();
      const instance = placed * 3 + band;
      windows.setMatrixAt(instance, dummy.matrix);
      windows.setColorAt(instance, lightColor);
    }
    placed += 1;
  }
  // Bounded retries: if the infield ever gets too tight the block count drops
  // rather than the loop spinning forever, and the draw range follows.
  buildings.count = placed;
  windows.count = placed * 3;
  buildings.castShadow = true;
  buildings.receiveShadow = true;
  root.add(buildings, windows);

  const beaconGeometry = new THREE.CylinderGeometry(0.18, 0.18, 34, 6);
  const beaconMaterial = new THREE.MeshBasicMaterial({ color: COLORS.magenta, toneMapped: false });
  const beacons = new THREE.InstancedMesh(beaconGeometry, beaconMaterial, 18);
  for (let i = 0; i < 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    dummy.position.set(Math.cos(angle) * (110 + random() * 70), 18, Math.sin(angle) * (90 + random() * 55));
    dummy.scale.set(1, 0.25 + random() * 0.9, 1);
    dummy.updateMatrix();
    beacons.setMatrixAt(i, dummy.matrix);
  }
  root.add(beacons);
}

function createTracksideNature(root, random, clearance) {
  const trunkGeometry = new THREE.CylinderGeometry(0.14, 0.24, 2.5, 5);
  const crownGeometry = new THREE.ConeGeometry(1.35, 4.8, 7, 2);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x24251f, roughness: 1 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: 0x123127, roughness: 0.9, flatShading: true });
  const treeCount = 220;
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treeCount);
  const dummy = new THREE.Object3D();
  const green = new THREE.Color();
  let placedTrees = 0;
  for (let i = 0; i < treeCount; i += 1) {
    const t = 0.62 + random() * 0.3;
    const direction = random() > 0.5 ? 1 : -1;
    const spread = random();
    const { point, side: sideVector } = tangentFrame(t);
    const heightScale = 0.7 + random() * 1.25;
    const widthScale = 0.8 + random() * 0.5;
    const rotation = random() * Math.PI;
    const radius = horizontalRadius(crownGeometry, new THREE.Vector3(widthScale, heightScale, widthScale));
    const candidate = clearance.place((attempt) => {
      const lateral = clearance.requiredDistance(radius, PROP_CLEARANCE) + spread * 40 + attempt * 12;
      const base = point.clone().addScaledVector(sideVector, lateral * direction);
      return { x: base.x, z: base.z, radius, base };
    }, 6);
    if (!candidate) continue;
    const base = candidate.base;
    dummy.position.set(base.x, base.y + 1.2 * heightScale - 1.2, base.z);
    dummy.scale.set(widthScale, heightScale, widthScale);
    dummy.rotation.y = rotation;
    dummy.updateMatrix();
    trunks.setMatrixAt(placedTrees, dummy.matrix);
    dummy.position.y += 2.6 * heightScale;
    dummy.updateMatrix();
    crowns.setMatrixAt(placedTrees, dummy.matrix);
    green.setHSL(0.42 + random() * 0.06, 0.32 + random() * 0.22, 0.09 + random() * 0.045);
    crowns.setColorAt(placedTrees, green);
    placedTrees += 1;
  }
  trunks.count = placedTrees;
  crowns.count = placedTrees;
  trunks.castShadow = true;
  crowns.castShadow = true;
  root.add(trunks, crowns);

  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0xa5aaa6, roughness: 0.96, flatShading: true }),
    'dark_rock',
    { repeat: [1.5, 1.5], normalScale: new THREE.Vector2(0.7, 0.7) },
  );
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 76);
  const rockColor = new THREE.Color();
  let placedRocks = 0;
  for (let i = 0; i < 76; i += 1) {
    const t = 0.62 + random() * 0.3;
    const direction = random() > 0.5 ? 1 : -1;
    const spread = random();
    const { point, side } = tangentFrame(t);
    const size = 1 + random() * 4;
    const lift = random();
    const scale = new THREE.Vector3(size * (0.7 + random()), size, size * (0.6 + random()));
    const spinX = random() * Math.PI;
    const spinY = random() * Math.PI;
    const spinZ = random() * Math.PI;
    // Boulders started 18m out with a radius of up to 8.5m - well inside the
    // corridor. They are now pushed out until the whole rock clears the road.
    const radius = horizontalRadius(rockGeometry, scale);
    const candidate = clearance.place((attempt) => {
      const lateral = clearance.requiredDistance(radius, PROP_CLEARANCE) + spread * 42 + attempt * 14;
      const base = point.clone().addScaledVector(side, lateral * direction);
      return { x: base.x, z: base.z, radius, base };
    }, 6);
    if (!candidate) continue;
    const base = candidate.base;
    dummy.position.set(base.x, base.y - 0.6 + lift, base.z);
    dummy.scale.copy(scale);
    dummy.rotation.set(spinX, spinY, spinZ);
    dummy.updateMatrix();
    rocks.setMatrixAt(placedRocks, dummy.matrix);
    rockColor.setHSL(0.48, 0.04, 0.4 + random() * 0.13);
    rocks.setColorAt(placedRocks, rockColor);
    placedRocks += 1;
  }
  rocks.count = placedRocks;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  root.add(rocks);
}

function createLamps(root) {
  const spacing = 42;
  const count = Math.floor(TRACK_CURVE.getLength() / spacing);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x39434b, roughness: 0.3, metalness: 0.86 });
  const poleGeometry = new THREE.CylinderGeometry(0.08, 0.13, 5.8, 6);
  const lampGeometry = new THREE.BoxGeometry(0.32, 0.2, 1.25);
  const poleCount = count * 2;
  const poles = new THREE.InstancedMesh(poleGeometry, poleMaterial, poleCount);
  const lamps = new THREE.InstancedMesh(
    lampGeometry,
    new THREE.MeshBasicMaterial({ color: 0x5e6d6e, toneMapped: true }),
    poleCount,
  );
  const scale = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i += 1) {
    const t = i / count;
    poles.setMatrixAt(i * 2, matrixOnTrack(t, -ROAD_WIDTH / 2 - 6, 2.65, scale));
    poles.setMatrixAt(i * 2 + 1, matrixOnTrack(t, ROAD_WIDTH / 2 + 6, 2.65, scale));
    lamps.setMatrixAt(i * 2, matrixOnTrack(t, -ROAD_WIDTH / 2 - 5.5, 5.55, scale));
    lamps.setMatrixAt(i * 2 + 1, matrixOnTrack(t, ROAD_WIDTH / 2 + 5.5, 5.55, scale));
    let lightColor;
    if (t < 0.27 || t >= 0.92) {
      lightColor = new THREE.Color(i % 3 === 0 ? 0x9d7149 : 0x8a5435);
    } else if (t < 0.62) {
      lightColor = new THREE.Color(i % 5 === 0 ? 0x774054 : 0x50767a);
    } else {
      lightColor = new THREE.Color(i % 4 === 0 ? 0x8e6842 : 0x697676);
    }
    lamps.setColorAt(i * 2, lightColor);
    lamps.setColorAt(i * 2 + 1, lightColor);
  }
  poles.castShadow = true;
  root.add(poles, lamps);
}

/**
 * Builds the Neon Apex night map.
 *
 * `options`:
 *   - `qualityTier`: accepted for API parity with the other maps; the night map
 *     has a single detail level, so it is currently unused.
 *   - `shortcutZones`: optional `[{ start, end, side, halfWidth, points }]`.
 *     `start`/`end`/`side` open the guardrail at a shortcut mouth (start > end
 *     wraps past the start/finish line, side 1 = positive lateral, i.e. along
 *     the `side` vector used by matrixOnTrack). `points` (the branch centre
 *     line, world space) plus `halfWidth` additionally reserve that branch as a
 *     no-scenery corridor. Omitting the option keeps the map exactly as it was.
 */
export function createWorld(scene, options = {}) {
  const shortcuts = createShortcutMask(options.shortcutZones);
  const clearance = createClearanceField(TRACK_CURVE, { shortcutZones: options.shortcutZones });
  const random = seededRandom();
  const world = new THREE.Group();
  world.name = 'NeonApexWorld';
  scene.background = new THREE.Color(0x041015);
  scene.fog = new THREE.FogExp2(0x0a1a1f, 0.00155);
  scene.add(world);

  addTagged(world, CLEARANCE_EXEMPT.BACKDROP, () => createSky(world));
  addWorldLights(world);
  const water = createTerrain(world, random, clearance);
  const road = addTagged(world, CLEARANCE_EXEMPT.ROAD, () => createRoad(world, shortcuts));
  addTagged(world, CLEARANCE_EXEMPT.ROAD, () => createWetPatches(world, random));
  const startLine = addTagged(world, CLEARANCE_EXEMPT.FURNITURE, () => createStartLine(world));
  const tunnelNeonMaterial = addTagged(world, CLEARANCE_EXEMPT.FURNITURE, () => createTunnel(world));
  const harbor = createHarborDistrict(world, random, NIGHT_DISTRICT_HELPERS);
  const mountain = createMountainRoad(world, random, NIGHT_DISTRICT_HELPERS, { clearance, shortcuts });
  createCity(world, random, clearance);
  const urbanPortalMaterial = createUrbanRoad(world, random, clearance);
  createTracksideNature(world, random, clearance);
  addTagged(world, CLEARANCE_EXEMPT.FURNITURE, () => createRoadsideDetails(world));
  addTagged(world, CLEARANCE_EXEMPT.FURNITURE, () => createLamps(world));
  const stars = addTagged(world, CLEARANCE_EXEMPT.BACKDROP, () => createAtmosphere(world, random));
  const rain = addTagged(world, CLEARANCE_EXEMPT.BACKDROP, () => createRain(world, random));

  const harborWaterMaterial = harbor.userData.waterMaterial;
  const animated = { stars, rain, water, harborWaterMaterial, tunnelNeonMaterial, urbanPortalMaterial };
  const update = (elapsed = 0) => {
    stars.rotation.y = elapsed * 0.003;
    rain.material.uniforms.time.value = elapsed;
    water.material.clearcoatRoughness = 0.14 + Math.sin(elapsed * 0.42) * 0.035;
    harborWaterMaterial.uniforms.time.value = elapsed;
    tunnelNeonMaterial.color.setHSL(0.515 + Math.sin(elapsed * 1.2) * 0.012, 0.82, 0.57);
    urbanPortalMaterial.color.setHSL(0.955 + Math.sin(elapsed * 0.8) * 0.018, 1, 0.62);
  };

  return {
    world,
    road,
    ground: world,
    startLine,
    districts: { harbor, mountain, city: world.getObjectByName('District_VerticalCity') },
    animated,
    update,
  };
}
