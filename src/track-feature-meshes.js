import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

const CHEVRON_REPEATS = 3;
const RAMP_SEGMENTS = 8;
const RAMP_SKIRT_DROP = 0.9;
const RAIL_INSET = 0.55;
const RAIL_EDGE_MARGIN = 0.1;

// roadClearance = height of the drawn road surface above the raw curve points
// (night road sits at +0.012, day at +0.10, scenic worlds at +0.11), so pad
// decals stay ~0.06 above the visible asphalt instead of sinking into it.
const THEMES = Object.freeze({
  night: Object.freeze({ chevron: 0x2ae6ff, edge: 0x1fc9ef, rail: 0x36e7ff, glowBoost: 2.2, roadClearance: 0.05 }),
  day: Object.freeze({ chevron: 0x1fe9ae, edge: 0x18d49c, rail: 0x2df0b8, glowBoost: 1.5, roadClearance: 0.14 }),
  alpine: Object.freeze({ chevron: 0x9fdcff, edge: 0x7cc8f4, rail: 0xaee4ff, glowBoost: 2.0, roadClearance: 0.15 }),
  canyon: Object.freeze({ chevron: 0xff9a38, edge: 0xf4832a, rail: 0xffb054, glowBoost: 1.7, roadClearance: 0.15 }),
  coast: Object.freeze({ chevron: 0x2ce9d8, edge: 0x23d2c4, rail: 0x3df2e2, glowBoost: 1.7, roadClearance: 0.15 }),
});

const canUseCanvas = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

function createChevronTexture() {
  if (!canUseCanvas()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.lineWidth = 17;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Double arrow per cell; tips point toward canvas top which maps to +v
  // (flipY), i.e. the driving direction of the pad ribbon.
  for (const [centerY, alpha] of [[42, 0.95], [88, 0.6]]) {
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.moveTo(20, centerY + 15);
    ctx.lineTo(64, centerY - 15);
    ctx.lineTo(108, centerY + 15);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createRampTopTexture() {
  if (!canUseCanvas()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#272c31';
  ctx.fillRect(0, 0, 128, 256);
  // Subtle asphalt mottling.
  for (let index = 0; index < 90; index += 1) {
    const shade = 30 + ((index * 37) % 24);
    ctx.fillStyle = `rgba(${shade},${shade + 4},${shade + 7},0.35)`;
    ctx.fillRect((index * 53) % 124, (index * 91) % 252, 4, 4);
  }
  // White edge lines along both sides.
  ctx.fillStyle = 'rgba(242,240,228,0.88)';
  ctx.fillRect(5, 0, 6, 256);
  ctx.fillRect(117, 0, 6, 256);
  // Alternating white / yellow warning chevrons near the launch lip
  // (canvas top row maps to v = 1 = far end of the ramp).
  ctx.lineWidth = 11;
  ctx.lineJoin = 'round';
  const stripeColors = ['rgba(245,240,225,0.92)', 'rgba(255,205,70,0.92)'];
  for (let row = 0; row < 4; row += 1) {
    const baseY = 22 + row * 26;
    ctx.strokeStyle = stripeColors[row % 2];
    ctx.beginPath();
    ctx.moveTo(12, baseY + 13);
    ctx.lineTo(64, baseY - 13);
    ctx.lineTo(116, baseY + 13);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createBuilder() {
  return { positions: [], uvs: [], indices: [] };
}

/** rows: [{ left: Vector3, right: Vector3, v }] — appends a two-column strip. */
function appendStrip(builder, rows) {
  const base = builder.positions.length / 3;
  for (const row of rows) {
    builder.positions.push(row.left.x, row.left.y, row.left.z, row.right.x, row.right.y, row.right.z);
    builder.uvs.push(0, row.v, 1, row.v);
  }
  for (let index = 0; index < rows.length - 1; index += 1) {
    const n = base + index * 2;
    builder.indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
}

function buildGeometry(builder, computeNormals) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(builder.uvs, 2));
  geometry.setIndex(builder.indices);
  if (computeNormals) geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addStaticMesh(group, builder, material, name, computeNormals = false) {
  if (builder.positions.length === 0) return null;
  const mesh = new THREE.Mesh(buildGeometry(builder, computeNormals), material);
  mesh.name = name;
  mesh.matrixAutoUpdate = false;
  group.add(mesh);
  return mesh;
}

function padFrames(pad) {
  if (Array.isArray(pad.spine) && pad.spine.length >= 2) return pad.spine;
  const tangent = pad.tangent.clone().normalize();
  const normal = (pad.normal ?? UP).clone().normalize();
  const side = pad.side
    ? pad.side.clone().normalize()
    : new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const half = pad.length / 2;
  return [-half, 0, half].map((distance) => ({
    point: pad.point.clone().addScaledVector(tangent, distance),
    side,
    normal,
  }));
}

function strip(frames, offsetA, offsetB, lift, vScale = 1) {
  const lastIndex = frames.length - 1;
  return frames.map((frame, index) => ({
    left: frame.point.clone().addScaledVector(frame.side, offsetA).addScaledVector(frame.normal, lift),
    right: frame.point.clone().addScaledVector(frame.side, offsetB).addScaledVector(frame.normal, lift),
    v: (index / lastIndex) * vScale,
  }));
}

function buildBoostPads(group, pads, palette, dynamic) {
  if (!pads.length) return;
  const deckBuilder = createBuilder();
  const chevronBuilder = createBuilder();
  const edgeBuilder = createBuilder();
  const deckLift = palette.roadClearance + 0.01;
  const chevronLift = palette.roadClearance + 0.06;
  const edgeLift = palette.roadClearance + 0.045;

  for (const pad of pads) {
    const frames = padFrames(pad);
    const halfWidth = pad.width / 2;
    appendStrip(deckBuilder, strip(frames, -halfWidth - 0.85, halfWidth + 0.85, deckLift));
    appendStrip(chevronBuilder, strip(frames, -halfWidth, halfWidth, chevronLift, CHEVRON_REPEATS));
    appendStrip(edgeBuilder, strip(frames, -halfWidth - 0.72, -halfWidth - 0.4, edgeLift));
    appendStrip(edgeBuilder, strip(frames, halfWidth + 0.4, halfWidth + 0.72, edgeLift));
  }

  const deckMaterial = new THREE.MeshStandardMaterial({
    color: 0x11181e,
    roughness: 0.44,
    metalness: 0.52,
    emissive: new THREE.Color(palette.edge),
    emissiveIntensity: 0.08,
  });
  const chevronTexture = createChevronTexture();
  const chevronMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.chevron).multiplyScalar(palette.glowBoost),
    map: chevronTexture,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edgeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.edge).multiplyScalar(palette.glowBoost * 0.8),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  addStaticMesh(group, deckBuilder, deckMaterial, 'BoostPadDecks', true);
  addStaticMesh(group, chevronBuilder, chevronMaterial, 'BoostPadChevrons');
  addStaticMesh(group, edgeBuilder, edgeMaterial, 'BoostPadEdges');

  dynamic.chevronTexture = chevronTexture;
  dynamic.chevronMaterial = chevronMaterial;
  dynamic.edgeMaterial = edgeMaterial;
  dynamic.deckMaterial = deckMaterial;
}

const smoothstep01 = (u) => u * u * (3 - 2 * u);

function buildRamps(group, ramps, palette, dynamic) {
  if (!ramps.length) return;
  const bodyBuilder = createBuilder();
  const topBuilder = createBuilder();
  const railBuilder = createBuilder();
  const baseLift = palette.roadClearance + 0.02;

  for (const ramp of ramps) {
    const start = ramp.point;
    const end = ramp.endPoint ?? ramp.point.clone().addScaledVector(ramp.tangent, ramp.length);
    const axis = end.clone().sub(start);
    const chord = Math.max(axis.length(), 1e-3);
    axis.normalize();
    const side = new THREE.Vector3().crossVectors(UP, axis);
    if (side.lengthSq() < 1e-6) side.copy(ramp.side ?? new THREE.Vector3(1, 0, 0));
    side.normalize();
    const up = new THREE.Vector3().crossVectors(axis, side).normalize();
    const halfWidth = ramp.width / 2;

    const topRows = [];
    const leftWall = [];
    const rightWall = [];
    const railLeft = [];
    const railRight = [];
    for (let segment = 0; segment <= RAMP_SEGMENTS; segment += 1) {
      const u = segment / RAMP_SEGMENTS;
      const height = smoothstep01(u) * ramp.height + baseLift;
      const spine = start.clone().addScaledVector(axis, chord * u);
      const topLeft = spine.clone().addScaledVector(side, -halfWidth).addScaledVector(up, height);
      const topRight = spine.clone().addScaledVector(side, halfWidth).addScaledVector(up, height);
      const bottomY = spine.y - RAMP_SKIRT_DROP;
      topRows.push({ left: topLeft, right: topRight, v: u });
      leftWall.push({ left: topLeft, right: topLeft.clone().setY(bottomY), v: u });
      rightWall.push({ left: topRight.clone().setY(bottomY), right: topRight, v: u });
      const railHeight = height + 0.05;
      railLeft.push({
        left: spine.clone().addScaledVector(side, -halfWidth + RAIL_EDGE_MARGIN).addScaledVector(up, railHeight),
        right: spine.clone().addScaledVector(side, -halfWidth + RAIL_INSET).addScaledVector(up, railHeight),
        v: u,
      });
      railRight.push({
        left: spine.clone().addScaledVector(side, halfWidth - RAIL_INSET).addScaledVector(up, railHeight),
        right: spine.clone().addScaledVector(side, halfWidth - RAIL_EDGE_MARGIN).addScaledVector(up, railHeight),
        v: u,
      });
    }
    appendStrip(topBuilder, topRows);
    appendStrip(bodyBuilder, leftWall);
    appendStrip(bodyBuilder, rightWall);
    appendStrip(railBuilder, railLeft);
    appendStrip(railBuilder, railRight);

    // Tail face (launch lip) and nose lip close the wedge to the ground.
    const tail = topRows[RAMP_SEGMENTS];
    const tailBaseY = start.clone().addScaledVector(axis, chord).y - RAMP_SKIRT_DROP;
    appendStrip(bodyBuilder, [
      { left: tail.left, right: tail.right, v: 0 },
      { left: tail.left.clone().setY(tailBaseY), right: tail.right.clone().setY(tailBaseY), v: 1 },
    ]);
    const nose = topRows[0];
    appendStrip(bodyBuilder, [
      { left: nose.left.clone().setY(start.y - RAMP_SKIRT_DROP), right: nose.right.clone().setY(start.y - RAMP_SKIRT_DROP), v: 0 },
      { left: nose.left, right: nose.right, v: 1 },
    ]);
  }

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x1f252a,
    roughness: 0.92,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const topTexture = createRampTopTexture();
  const topMaterial = new THREE.MeshStandardMaterial({
    map: topTexture,
    color: topTexture ? 0xffffff : 0x2b3136,
    roughness: 0.86,
    metalness: 0.06,
  });
  const railMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(palette.rail).multiplyScalar(palette.glowBoost),
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const body = addStaticMesh(group, bodyBuilder, bodyMaterial, 'RampBodies', true);
  const top = addStaticMesh(group, topBuilder, topMaterial, 'RampTops', true);
  if (body) body.receiveShadow = true;
  if (top) top.receiveShadow = true;
  addStaticMesh(group, railBuilder, railMaterial, 'RampRails');

  dynamic.railMaterial = railMaterial;
}

/**
 * Builds every boost pad and jump ramp of a track as a handful of merged
 * meshes (6 draw calls max). `group.userData.update(elapsedSeconds)` animates
 * the chevron flow and neon pulses; pass the main loop's total elapsed time.
 */
export function buildTrackFeatureMeshes(features, { theme = 'night' } = {}) {
  const palette = THEMES[theme] ?? THEMES.night;
  const group = new THREE.Group();
  group.name = 'TrackFeatures';
  group.userData.theme = THEMES[theme] ? theme : 'night';

  const dynamic = {
    chevronTexture: null,
    chevronMaterial: null,
    edgeMaterial: null,
    deckMaterial: null,
    railMaterial: null,
  };
  buildBoostPads(group, features?.boostPads ?? [], palette, dynamic);
  buildRamps(group, features?.ramps ?? [], palette, dynamic);

  group.userData.update = (elapsedSeconds = 0) => {
    const time = Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0;
    if (dynamic.chevronTexture) dynamic.chevronTexture.offset.y = -((time * 1.35) % 1);
    if (dynamic.chevronMaterial) {
      dynamic.chevronMaterial.opacity = 0.68 + 0.28 * (0.5 + 0.5 * Math.sin(time * 5.1));
    }
    if (dynamic.edgeMaterial) {
      dynamic.edgeMaterial.opacity = 0.42 + 0.3 * (0.5 + 0.5 * Math.sin(time * 3.4 + 1.3));
    }
    if (dynamic.deckMaterial) {
      dynamic.deckMaterial.emissiveIntensity = 0.06 + 0.05 * (0.5 + 0.5 * Math.sin(time * 5.1));
    }
    if (dynamic.railMaterial) {
      dynamic.railMaterial.opacity = 0.6 + 0.3 * (0.5 + 0.5 * Math.sin(time * 4.2 + 0.5));
    }
  };
  return group;
}
