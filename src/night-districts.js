import * as THREE from 'three';
import {
  ROAD_WIDTH,
  TRACK_CURVE,
  matrixOnTrack,
  tangentFrame,
} from './night-track.js';
import {
  CLEARANCE_EXEMPT,
  PROP_CLEARANCE,
  createShortcutMask,
  horizontalRadius,
  markClearanceExempt,
} from './scenic-worlds.js';

export function createHarborDistrict(root, random, helpers) {
  const { applyEnvironmentPbr, createContainerDecalTexture, createHarborSignTexture, createRoadReflectionTexture } = helpers;
  const harbor = new THREE.Group();
  harbor.name = 'District_HarborDocks';
  const concrete = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x8c9696, roughness: 0.82, metalness: 0.08 }),
    'concrete_wall_008',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.42, 0.42) },
  );
  const steel = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x819097, roughness: 0.38, metalness: 0.86 }),
    'metal_plate',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.3, 0.3) },
  );
  const sodium = new THREE.MeshBasicMaterial({ color: 0xb96e38, toneMapped: true });

  const quay = new THREE.Mesh(new THREE.BoxGeometry(520, 3.2, 82), concrete);
  quay.position.set(70, -5.4, -372);
  quay.receiveShadow = true;
  harbor.add(quay);

  const containerGeometry = new THREE.BoxGeometry(2.55, 2.65, 11.8, 1, 1, 1);
  const containerMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x11191a,
      emissiveIntensity: 0.3,
      roughness: 0.58,
      metalness: 0.46,
    }),
    'metal_plate',
    { repeat: [2.5, 1.5], normalScale: new THREE.Vector2(0.26, 0.26), colorMap: false },
  );
  const containerCount = 132;
  const containers = new THREE.InstancedMesh(containerGeometry, containerMaterial, containerCount);
  const dummy = new THREE.Object3D();
  const containerColor = new THREE.Color();
  const containerMatrices = [];
  const palette = [0x2d7b86, 0xb94b4d, 0xd28a35, 0x4b8666, 0x52638b, 0x9a968b];
  for (let i = 0; i < containerCount; i += 1) {
    const column = i % 22;
    const row = Math.floor(i / 22) % 3;
    const level = Math.floor(i / 66);
    const t = 0.035 + column * 0.0096 + (row % 2) * 0.0018;
    const lateral = 18.5 + row * 3.05;
    const vertical = 1.34 + level * 2.72;
    const scale = new THREE.Vector3(0.94 + random() * 0.1, 1, 0.94 + random() * 0.08);
    const containerMatrix = matrixOnTrack(t, lateral, vertical, scale);
    containerMatrices.push(containerMatrix);
    containers.setMatrixAt(i, containerMatrix);
    containerColor.setHex(palette[(i * 7 + row) % palette.length]).offsetHSL(0, 0, (random() - 0.5) * 0.05);
    containers.setColorAt(i, containerColor);
  }
  containers.castShadow = true;
  containers.receiveShadow = true;
  harbor.add(containers);

  const containerRibs = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.1, 2.42, 0.16),
    new THREE.MeshStandardMaterial({ color: 0x26343a, roughness: 0.42, metalness: 0.78 }),
    containerCount * 7,
  );
  const localDetail = new THREE.Object3D();
  const detailMatrix = new THREE.Matrix4();
  const ribPositions = [-4.62, -2.31, 0, 2.31, 4.62];
  for (let i = 0; i < containerCount; i += 1) {
    ribPositions.forEach((z, rib) => {
      localDetail.position.set(-1.31, 0, z);
      localDetail.rotation.set(0, 0, 0);
      localDetail.scale.set(1, 1, 1);
      localDetail.updateMatrix();
      detailMatrix.multiplyMatrices(containerMatrices[i], localDetail.matrix);
      containerRibs.setMatrixAt(i * 7 + rib, detailMatrix);
    });
    [-0.58, 0.58].forEach((x, lock) => {
      localDetail.position.set(x, 0, -5.96);
      localDetail.updateMatrix();
      detailMatrix.multiplyMatrices(containerMatrices[i], localDetail.matrix);
      containerRibs.setMatrixAt(i * 7 + 5 + lock, detailMatrix);
    });
  }
  harbor.add(containerRibs);

  const containerDecals = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.035, 1.35, 4.5),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createContainerDecalTexture(),
      transparent: true,
      opacity: 0.82,
      toneMapped: true,
    }),
    containerCount,
  );
  for (let i = 0; i < containerCount; i += 1) {
    localDetail.position.set(-1.365, 0.05, i % 2 ? 2.65 : -2.65);
    localDetail.rotation.set(0, 0, 0);
    localDetail.scale.set(1, 1, 1);
    localDetail.updateMatrix();
    detailMatrix.multiplyMatrices(containerMatrices[i], localDetail.matrix);
    containerDecals.setMatrixAt(i, detailMatrix);
    containerDecals.setColorAt(i, new THREE.Color(i % 5 === 0 ? 0xd7c5ae : 0xc6d5d2));
  }
  harbor.add(containerDecals);

  const waterSegmentCount = 52;
  const waterSegmentLength = TRACK_CURVE.getLength() * 0.0054;
  const harborWaterMaterial = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      deepColor: { value: new THREE.Color(0x070d0f) },
      shallowColor: { value: new THREE.Color(0x27393a) },
      lightColor: { value: new THREE.Color(0xa1c7c0) },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      uniform float time;
      void main() {
        vec3 displaced = position;
        vec4 baseWorldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
        float waveA = sin(baseWorldPosition.x * 0.16 + time * 0.92);
        float waveB = sin(baseWorldPosition.z * 0.23 - time * 0.68);
        float chop = sin((baseWorldPosition.x - baseWorldPosition.z) * 0.37 + time * 1.28);
        displaced.y += waveA * 0.23 + waveB * 0.15 + chop * 0.065;
        vec4 worldPosition = modelMatrix * instanceMatrix * vec4(displaced, 1.0);
        vWorldPosition = worldPosition.xyz;
        vLocalPosition = position;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform vec3 deepColor;
      uniform vec3 shallowColor;
      uniform vec3 lightColor;
      varying vec3 vWorldPosition;
      varying vec3 vLocalPosition;
      void main() {
        float phaseA = vWorldPosition.x * 0.16 + time * 0.92;
        float phaseB = vWorldPosition.z * 0.23 - time * 0.68;
        float phaseC = (vWorldPosition.x - vWorldPosition.z) * 0.37 + time * 1.28;
        float phaseFine = vWorldPosition.x * 1.08 + vWorldPosition.z * 0.74 - time * 1.64;
        float waveFine = sin(phaseFine) * sin(vWorldPosition.z * 1.43 + time * 0.7);
        float waves = sin(phaseA) * 0.44 + sin(phaseB) * 0.31 + sin(phaseC) * 0.16 + waveFine * 0.09;
        float dx = cos(phaseA) * 0.095 + cos(phaseC) * 0.052 + cos(phaseFine) * 0.043;
        float dz = cos(phaseB) * 0.078 - cos(phaseC) * 0.052 + cos(phaseFine) * 0.032;
        vec3 normal = normalize(vec3(-dx, 0.48, -dz));
        vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
        vec3 lightDirection = normalize(vec3(-0.34, 0.86, 0.26));
        float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.65);
        float specular = pow(max(dot(reflect(-lightDirection, normal), viewDirection), 0.0), 34.0);
        float shoreline = smoothstep(13.8, 16.85, vLocalPosition.x);
        float foamPattern = sin(vWorldPosition.z * 1.15 + time * 1.3) * 0.6
          + sin(vWorldPosition.x * 0.72 - time * 0.55) * 0.4;
        float foam = shoreline * smoothstep(0.61, 0.91, foamPattern * 0.5 + 0.5);
        float darkRidges = smoothstep(-0.72, 0.7, waves);
        float reflectedBand = smoothstep(0.58, 0.98, sin(vWorldPosition.x * 0.055 - vWorldPosition.z * 0.07) * 0.5 + 0.5);
        vec3 color = mix(deepColor, shallowColor, 0.22 + darkRidges * 0.34 + shoreline * 0.12);
        color *= 0.72 + darkRidges * 0.34;
        color += lightColor * (fresnel * (0.1 + reflectedBand * 0.19) + specular * 0.7 + foam * 0.19);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  const harborWater = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(34, waterSegmentLength, 12, 6),
    harborWaterMaterial,
    waterSegmentCount,
  );
  harborWater.geometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < waterSegmentCount; i += 1) {
    const t = 0.005 + i * 0.0052;
    harborWater.setMatrixAt(i, matrixOnTrack(t, -28, -2.25));
  }
  harborWater.receiveShadow = true;
  harbor.add(harborWater);
  harbor.userData.waterMaterial = harborWaterMaterial;

  const waterReflectionCount = 18;
  const waterReflectionGeometry = new THREE.PlaneGeometry(1, 1);
  waterReflectionGeometry.rotateX(-Math.PI / 2);
  const waterReflections = new THREE.InstancedMesh(
    waterReflectionGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: createRoadReflectionTexture(),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: true,
    }),
    waterReflectionCount,
  );
  for (let i = 0; i < waterReflectionCount; i += 1) {
    const t = 0.024 + i * 0.0124;
    const lateral = -24.5 - (i % 4) * 2.7;
    const width = 0.34 + (i % 3) * 0.18;
    const length = 7.5 + (i % 5) * 1.8;
    waterReflections.setMatrixAt(
      i,
      matrixOnTrack(t, lateral, -1.94, new THREE.Vector3(width, 1, length)),
    );
    waterReflections.setColorAt(i, new THREE.Color(i % 4 === 0 ? 0x8d633f : 0x476e70));
  }
  waterReflections.renderOrder = 1;
  harbor.add(waterReflections);

  const craneCount = 5;
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.35, 34, 1.35), steel, craneCount * 2);
  const booms = new THREE.InstancedMesh(new THREE.BoxGeometry(1.15, 1.15, 54), steel, craneCount);
  const crowns = new THREE.InstancedMesh(new THREE.BoxGeometry(17, 1.2, 1.5), steel, craneCount);
  const craneLamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 7, 5), sodium, craneCount * 2);
  for (let i = 0; i < craneCount; i += 1) {
    const x = -125 + i * 92;
    for (let side = 0; side < 2; side += 1) {
      dummy.position.set(x + (side ? 7 : -7), 11.5, -406);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      legs.setMatrixAt(i * 2 + side, dummy.matrix);
      dummy.position.set(x + (side ? 5.5 : -5.5), 28.3, -407);
      dummy.updateMatrix();
      craneLamps.setMatrixAt(i * 2 + side, dummy.matrix);
    }
    dummy.position.set(x, 28.5, -382);
    dummy.updateMatrix();
    booms.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 27.8, -406);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  }
  legs.castShadow = true;
  booms.castShadow = true;
  crowns.castShadow = true;
  harbor.add(legs, booms, crowns, craneLamps);

  const craneCables = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.075, 0.075, 18, 5),
    new THREE.MeshStandardMaterial({ color: 0x20292c, roughness: 0.36, metalness: 0.88 }),
    craneCount,
  );
  const craneHoists = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3.4, 1.5, 2.4),
    new THREE.MeshStandardMaterial({
      color: 0xd77b2e,
      emissive: 0x481902,
      emissiveIntensity: 0.72,
      roughness: 0.4,
      metalness: 0.7,
    }),
    craneCount,
  );
  for (let i = 0; i < craneCount; i += 1) {
    const x = -125 + i * 92;
    const z = -366 - (i % 2) * 5;
    dummy.position.set(x, 18.1, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    craneCables.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, 27.2, z);
    dummy.updateMatrix();
    craneHoists.setMatrixAt(i, dummy.matrix);
  }
  craneCables.castShadow = true;
  craneHoists.castShadow = true;
  harbor.add(craneCables, craneHoists);

  const dockPoleCount = 16;
  const dockPoles = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.14, 0.2, 1, 7),
    steel,
    dockPoleCount,
  );
  const dockFloodlights = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.25, 0.32, 0.58),
    sodium,
    dockPoleCount,
  );
  const poleScale = new THREE.Vector3(1, 7.4, 1);
  for (let i = 0; i < dockPoleCount; i += 1) {
    const t = 0.012 + i * 0.0154;
    const lateral = i % 2 ? 13.4 : -11.2;
    dockPoles.setMatrixAt(i, matrixOnTrack(t, lateral, 3.65, poleScale));
    dockFloodlights.setMatrixAt(i, matrixOnTrack(t, lateral, 7.35));
  }
  dockPoles.castShadow = true;
  harbor.add(dockPoles, dockFloodlights);

  const yardEquipmentCount = 18;
  const yardEquipment = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.58, metalness: 0.48 }),
    yardEquipmentCount,
  );
  for (let i = 0; i < yardEquipmentCount; i += 1) {
    const t = 0.026 + i * 0.0122;
    const lateral = 13.4 + (i % 3) * 1.75;
    yardEquipment.setMatrixAt(
      i,
      matrixOnTrack(t, lateral, 0.62, new THREE.Vector3(1.05, 1.25 + (i % 2) * 0.35, 1.55)),
    );
    yardEquipment.setColorAt(i, new THREE.Color(i % 4 === 0 ? 0xc38a39 : i % 3 === 0 ? 0x506d70 : 0x7f8780));
  }
  harbor.add(yardEquipment);

  const bollardCount = 28;
  const bollards = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.34, 0.46, 0.72, 8),
    new THREE.MeshStandardMaterial({ color: 0x242c2f, roughness: 0.38, metalness: 0.82 }),
    bollardCount,
  );
  for (let i = 0; i < bollardCount; i += 1) {
    bollards.setMatrixAt(i, matrixOnTrack(0.008 + i * 0.0091, -11.6, 0.18));
  }
  bollards.castShadow = true;
  harbor.add(bollards);

  const shipGeometry = new THREE.BoxGeometry(76, 8, 18);
  const ships = new THREE.InstancedMesh(shipGeometry, new THREE.MeshStandardMaterial({ color: 0x111c23, roughness: 0.48, metalness: 0.62 }), 3);
  for (let i = 0; i < 3; i += 1) {
    dummy.position.set(-190 + i * 195, -3.6, -470 - (i % 2) * 35);
    dummy.rotation.y = (i % 2 ? -0.08 : 0.06);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    ships.setMatrixAt(i, dummy.matrix);
  }
  harbor.add(ships);

  const harborSignTexture = createHarborSignTexture();
  const harborSignMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: harborSignTexture,
    emissive: 0x75dbe4,
    emissiveMap: harborSignTexture,
    emissiveIntensity: 0.75,
    roughness: 0.35,
    metalness: 0.48,
  });
  const signs = new THREE.InstancedMesh(new THREE.BoxGeometry(10, 1.7, 0.18), harborSignMaterial, 8);
  for (let i = 0; i < 8; i += 1) {
    signs.setMatrixAt(i, matrixOnTrack(0.015 + i * 0.026, ROAD_WIDTH / 2 + 5.1, 3.1));
  }
  harbor.add(signs);

  const quayGate = new THREE.Group();
  quayGate.name = 'Landmark_HarborQuayCrane';
  const quayGateMaterial = applyEnvironmentPbr(
    new THREE.MeshPhysicalMaterial({
      color: 0xd46d27,
      emissive: 0x4f1704,
      emissiveIntensity: 0.6,
      roughness: 0.34,
      metalness: 0.78,
      clearcoat: 0.4,
      clearcoatRoughness: 0.2,
    }),
    'metal_plate',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.3, 0.3) },
  );
  const gateMembers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), quayGateMaterial, 11);
  const memberTransforms = [
    [-11.7, 10.5, 0, 1.3, 21, 1.3, 0],
    [11.7, 10.5, 0, 1.3, 21, 1.3, 0],
    [-8.8, 11.1, 0, 0.7, 20.2, 0.7, -0.31],
    [8.8, 11.1, 0, 0.7, 20.2, 0.7, 0.31],
    [0, 21.2, 0, 26.2, 1.35, 1.65, 0],
    [0, 17.5, 0, 25, 0.28, 0.32, 0],
    [0, 23.4, 5.8, 1.1, 1.1, 14.5, 0],
    [5.2, 16.7, 5.8, 0.16, 10.1, 0.16, 0],
    [5.2, 11.55, 5.8, 8.4, 0.48, 1.15, 0],
    [2.15, 8.85, 5.8, 0.12, 5.2, 0.12, 0],
    [8.25, 8.85, 5.8, 0.12, 5.2, 0.12, 0],
  ];
  memberTransforms.forEach(([x, y, z, sx, sy, sz, rz], index) => {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(0, 0, rz);
    dummy.updateMatrix();
    gateMembers.setMatrixAt(index, dummy.matrix);
  });
  gateMembers.castShadow = true;
  const gateSign = new THREE.Mesh(new THREE.BoxGeometry(8.8, 2.05, 0.32), harborSignMaterial);
  gateSign.position.set(0, 19.4, 0.95);
  const hoist = new THREE.Mesh(
    new THREE.BoxGeometry(4.2, 2.4, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x182329, emissive: 0xff8f35, emissiveIntensity: 1.2, roughness: 0.38, metalness: 0.65 }),
  );
  hoist.position.set(5.2, 22.2, 5.8);
  const gateLamps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.16, 0.22),
    new THREE.MeshBasicMaterial({ color: 0xffbe63, toneMapped: false }),
    4,
  );
  [-8, -2.7, 2.7, 8].forEach((x, index) => {
    dummy.position.set(x, 18.1, 0.9);
    dummy.scale.set(1, 1, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    gateLamps.setMatrixAt(index, dummy.matrix);
  });
  quayGate.add(gateMembers, gateSign, hoist, gateLamps);
  quayGate.applyMatrix4(matrixOnTrack(0.163, 0, 0));
  quayGate.scale.multiplyScalar(1.22);
  harbor.add(quayGate);

  // The harbour is authored around the roadway: every prop here is placed with
  // matrixOnTrack (containers, bollards, poles, signage, the gate that straddles
  // the road) or sits out on the quay behind them. It is track furniture as far
  // as the scenery-clearance test is concerned.
  markClearanceExempt(harbor, CLEARANCE_EXEMPT.FURNITURE);
  root.add(harbor);
  return harbor;
}

export function createHarborBridge(root, helpers) {
  const { applyEnvironmentPbr } = helpers;
  const bridge = new THREE.Group();
  bridge.name = 'HarborViaduct';
  const concrete = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x949b98, roughness: 0.9, metalness: 0.04 }),
    'concrete_wall_008',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.5, 0.5) },
  );
  const samples = 30;
  const piers = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.8, 1.35, 1, 8), concrete, 20);
  const dummy = new THREE.Object3D();
  let pierIndex = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = 0.08 + i * 0.0062;
    if (i % 3 !== 0) continue;
    const { point, side } = tangentFrame(t);
    for (const lateral of [-5.8, 5.8]) {
      const position = point.clone().addScaledVector(side, lateral);
      const height = Math.max(4, point.y + 7.2);
      dummy.position.set(position.x, point.y - height * 0.5 - 0.7, position.z);
      dummy.scale.set(1, height, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      piers.setMatrixAt(pierIndex, dummy.matrix);
      pierIndex += 1;
    }
  }
  piers.castShadow = true;
  piers.receiveShadow = true;
  // The main road ribbon already forms the deck; piers provide depth without chord segments piercing bends.
  bridge.add(piers);
  markClearanceExempt(bridge, CLEARANCE_EXEMPT.FURNITURE);
  root.add(bridge);
}

/**
 * Mountain pass district.
 *
 * `options`:
 *   - `clearance`: shared clearance field (see scenic-worlds.js). Cliff boulders
 *     are only placed where they clear the circuit and any shortcut branch.
 *   - `shortcuts`: shortcut mask; the concrete wall and its chevrons leave a gap
 *     at a shortcut mouth. Both default to "no zones, validate against nothing
 *     extra", which reproduces the original layout rules.
 */
export function createMountainRoad(root, random, helpers, options = {}) {
  const { applyEnvironmentPbr } = helpers;
  const clearance = options.clearance ?? null;
  const shortcuts = options.shortcuts ?? createShortcutMask(null);
  const mountainRoad = new THREE.Group();
  mountainRoad.name = 'District_MountainPass';
  const wallMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0x939a96, roughness: 0.93, metalness: 0.04 }),
    'concrete_wall_008',
    { repeat: [2, 2], normalScale: new THREE.Vector2(0.62, 0.62) },
  );
  const wallCount = 90;
  const segmentLength = TRACK_CURVE.getLength() / 450 * 1.15;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(0.85, 4.4, segmentLength), wallMaterial, wallCount);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = applyEnvironmentPbr(
    new THREE.MeshStandardMaterial({ color: 0xa2aaa6, roughness: 0.98, flatShading: true }),
    'dark_rock',
    { repeat: [1.5, 1.5], normalScale: new THREE.Vector2(0.78, 0.78) },
  );
  const cliffCount = 120;
  const cliffs = new THREE.InstancedMesh(rockGeometry, rockMaterial, cliffCount);
  const dummy = new THREE.Object3D();
  const rockColor = new THREE.Color();
  let placedWalls = 0;
  let placedCliffs = 0;

  for (let i = 0; i < wallCount; i += 1) {
    const t = 0.63 + (i / wallCount) * 0.275;
    const outside = Math.sin(t * Math.PI * 18) > 0 ? 1 : -1;
    // A shortcut mouth on this side of the pass leaves the wall open.
    if (shortcuts.isOpen(t, outside)) continue;
    walls.setMatrixAt(placedWalls, matrixOnTrack(t, outside * (ROAD_WIDTH / 2 + 2.5), 1.45));
    placedWalls += 1;
  }
  walls.count = placedWalls;
  for (let i = 0; i < cliffCount; i += 1) {
    const t = 0.625 + random() * 0.29;
    const { point, side } = tangentFrame(t);
    const direction = random() > 0.46 ? 1 : -1;
    const spread = random();
    const size = 3 + random() * 9;
    const scale = new THREE.Vector3(size * (0.7 + random() * 0.6), size, size * (0.55 + random() * 0.65));
    const lift = random();
    const spinX = random() * Math.PI;
    const spinY = random() * Math.PI;
    const spinZ = random() * Math.PI;
    const shade = random();
    // Boulders used to start 24m out while measuring up to 15m across, so the
    // biggest ones bit into the pass. They now clear the whole circuit.
    const radius = horizontalRadius(rockGeometry, scale);
    const placement = clearance
      ? clearance.place((attempt) => {
        const distance = clearance.requiredDistance(radius, PROP_CLEARANCE) + spread * 35 + attempt * 13;
        const candidate = point.clone().addScaledVector(side, distance * direction);
        return { x: candidate.x, z: candidate.z, radius, base: candidate };
      }, 6)
      : { base: point.clone().addScaledVector(side, (24 + spread * 35) * direction) };
    if (!placement) continue;
    const base = placement.base;
    dummy.position.set(base.x, point.y + size * (0.15 + lift * 0.55), base.z);
    dummy.scale.copy(scale);
    dummy.rotation.set(spinX, spinY, spinZ);
    dummy.updateMatrix();
    cliffs.setMatrixAt(placedCliffs, dummy.matrix);
    rockColor.setHSL(0.47, 0.06 + shade * 0.07, 0.42 + random() * 0.13);
    cliffs.setColorAt(placedCliffs, rockColor);
    placedCliffs += 1;
  }
  cliffs.count = placedCliffs;
  walls.castShadow = true;
  walls.receiveShadow = true;
  cliffs.castShadow = true;
  cliffs.receiveShadow = true;
  walls.userData.guardrail = true;
  markClearanceExempt(walls, CLEARANCE_EXEMPT.FURNITURE);
  mountainRoad.add(walls, cliffs);

  const chevronCount = 54;
  const chevrons = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.25, 0.62, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffb045, toneMapped: false }),
    chevronCount,
  );
  let placedChevrons = 0;
  for (let i = 0; i < chevronCount; i += 1) {
    const t = 0.64 + (i / chevronCount) * 0.27;
    const outside = Math.sin(t * Math.PI * 18) > 0 ? 1 : -1;
    if (shortcuts.isOpen(t, outside)) continue;
    chevrons.setMatrixAt(placedChevrons, matrixOnTrack(t, outside * (ROAD_WIDTH / 2 + 1.75), 1.35));
    placedChevrons += 1;
  }
  chevrons.count = placedChevrons;
  markClearanceExempt(chevrons, CLEARANCE_EXEMPT.FURNITURE);
  mountainRoad.add(chevrons);
  root.add(mountainRoad);
}
