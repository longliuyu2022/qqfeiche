import * as THREE from 'three';

// QQ飞车-style drift feedback: skid marks, tire smoke, charge sparks.
// All world-space effects live on identity-transform objects; every buffer is
// preallocated at creation time and updated in place (no per-frame allocation).

const REAR_AXLE_OFFSET = -1.35;
const WHEEL_HALF_TRACK = 0.82;
const EXHAUST_OFFSET = -2.1;
const EXHAUST_HALF_SPACING = 0.42;
const EXHAUST_HEIGHT = 0.4;

const SKID_HALF_WIDTH = 0.17;
const SKID_Y_LIFT = 0.03;
const SKID_MIN_STEP = 0.12;
const SKID_BREAK_STEP = 6;
const SKID_FADE_TAU = 1.9;
const SKID_MIN_ALPHA = 0.012;
const SKID_MIN_SPEED_KPH = 12;
const SKID_COLOR_R = 0.045;
const SKID_COLOR_G = 0.047;
const SKID_COLOR_B = 0.052;
const SEGMENT_POSITION_FLOATS = 24; // 8 vertices * xyz (left quad + right quad)
const SEGMENT_COLOR_FLOATS = 32;    // 8 vertices * rgba

const SMOKE_DRAG = 1.55;
const SMOKE_RISE = 1.35;
const SMOKE_GROWTH = 2.4;
const SMOKE_MIN_SPEED_KPH = 15;

const SPARK_GRAVITY = 21;

const MAX_PENDING_UPDATE_RANGES = 128;

const QUALITY_PRESETS = {
  low: { emission: 0.5, capacity: 0.5 },
  medium: { emission: 0.78, capacity: 0.75 },
  high: { emission: 1, capacity: 1 },
};

const CHARGE_COLORS = [
  new THREE.Color(0xe4f1ff), // level 0: faint white motes
  new THREE.Color(0x4dd2ff), // level 1: cyan blue
  new THREE.Color(0xffb347), // level 2: golden orange
  new THREE.Color(0xff4df0), // level 3: magenta
];
const MINI_BOOST_COLOR_A = new THREE.Color(0x7df6ff);
const MINI_BOOST_COLOR_B = new THREE.Color(0xffffff);
const BOOST_COLORS = [new THREE.Color(0xffb066), new THREE.Color(0x52e8ff)];

const SMOKE_VERTEX_SHADER = `
  attribute float particleSize;
  attribute float particleAlpha;
  varying float vAlpha;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(particleSize * (300.0 / max(1.0, -viewPosition.z)), 1.0, 84.0);
    vAlpha = particleAlpha;
  }
`;

const SMOKE_FRAGMENT_SHADER = `
  uniform vec3 smokeColor;
  uniform float globalOpacity;
  varying float vAlpha;
  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float body = 1.0 - smoothstep(0.14, 0.5, length(offset));
    float alpha = vAlpha * body * globalOpacity;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(smokeColor, alpha);
  }
`;

const SPARK_VERTEX_SHADER = `
  attribute float particleSize;
  attribute vec4 particleColor;
  varying vec4 vColor;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = clamp(particleSize * (300.0 / max(1.0, -viewPosition.z)), 1.0, 42.0);
    vColor = particleColor;
  }
`;

const SPARK_FRAGMENT_SHADER = `
  varying vec4 vColor;
  void main() {
    vec2 offset = gl_PointCoord - 0.5;
    float distanceToCenter = length(offset);
    float glow = 1.0 - smoothstep(0.05, 0.5, distanceToCenter);
    float core = 1.0 - smoothstep(0.0, 0.18, distanceToCenter);
    float alpha = vColor.a * glow;
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(vColor.rgb * (1.0 + core * 1.5), alpha);
  }
`;

// Accumulates a partial-upload range; collapses to a full-array range if the
// renderer has not consumed pending ranges for a long time (headless updates).
function markDirtyRange(attribute, start, count) {
  if (attribute.updateRanges.length >= MAX_PENDING_UPDATE_RANGES) {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, attribute.array.length);
  } else {
    attribute.addUpdateRange(start, count);
  }
  attribute.needsUpdate = true;
}

function createSkidBuffer(segmentCount) {
  const vertexCount = segmentCount * 8;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const base = vertex * 4;
    colors[base] = SKID_COLOR_R;
    colors[base + 1] = SKID_COLOR_G;
    colors[base + 2] = SKID_COLOR_B;
    colors[base + 3] = 0;
  }
  const IndexArrayType = vertexCount > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArrayType(segmentCount * 12);
  let write = 0;
  for (let segment = 0; segment < segmentCount; segment += 1) {
    for (let quad = 0; quad < 2; quad += 1) {
      const vertexBase = segment * 8 + quad * 4;
      indices[write] = vertexBase;
      indices[write + 1] = vertexBase + 1;
      indices[write + 2] = vertexBase + 2;
      indices[write + 3] = vertexBase;
      indices[write + 4] = vertexBase + 2;
      indices[write + 5] = vertexBase + 3;
      write += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const colorAttribute = new THREE.BufferAttribute(colors, 4);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'DriftSkidMarks';
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 1;
  return {
    mesh,
    geometry,
    material,
    positions,
    colors,
    positionAttribute,
    colorAttribute,
    segmentAlpha: new Float32Array(segmentCount),
    prevEdges: new Float32Array(12),
    curEdges: new Float32Array(12),
  };
}

function createPointPool(capacity, material, extraAttributes) {
  const positions = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1);
  sizeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('particleSize', sizeAttribute);
  const attributes = { position: positionAttribute, particleSize: sizeAttribute };
  for (const [name, itemSize] of extraAttributes) {
    const attribute = new THREE.BufferAttribute(new Float32Array(capacity * itemSize), itemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    attributes[name] = attribute;
  }
  geometry.setDrawRange(0, 0);
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = false;
  return {
    points,
    geometry,
    material,
    attributes,
    positions,
    sizes,
    velocities: new Float32Array(capacity * 3),
    ages: new Float32Array(capacity),
    lifetimes: new Float32Array(capacity),
    baseSizes: new Float32Array(capacity),
    baseAlphas: new Float32Array(capacity),
  };
}

export function createDriftEffects({ scene, maxSkidSegments = 480, smokeCount = 220, sparkCount = 160 } = {}) {
  if (!scene) throw new Error('createDriftEffects requires a scene');

  // --- skid marks -----------------------------------------------------------
  const skid = createSkidBuffer(maxSkidSegments);
  scene.add(skid.mesh);
  let skidHead = 0;
  let skidHasPrev = false;
  let skidAnyAlive = false;
  let prevAxleX = 0;
  let prevAxleZ = 0;

  // --- tire smoke -----------------------------------------------------------
  const smokeMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      smokeColor: { value: new THREE.Color(0xcfd4d9) },
      globalOpacity: { value: 0.85 },
    },
    vertexShader: SMOKE_VERTEX_SHADER,
    fragmentShader: SMOKE_FRAGMENT_SHADER,
  });
  const smoke = createPointPool(smokeCount, smokeMaterial, [['particleAlpha', 1]]);
  smoke.points.name = 'DriftSmoke';
  smoke.points.renderOrder = 3;
  scene.add(smoke.points);
  const smokeAlphas = smoke.attributes.particleAlpha.array;
  let smokeAlive = 0;
  let smokeCarry = 0;
  let smokeWheelToggle = false;

  // --- charge / boost sparks ------------------------------------------------
  const sparkMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: SPARK_VERTEX_SHADER,
    fragmentShader: SPARK_FRAGMENT_SHADER,
  });
  const spark = createPointPool(sparkCount, sparkMaterial, [['particleColor', 4]]);
  spark.points.name = 'DriftSparks';
  spark.points.renderOrder = 4;
  scene.add(spark.points);
  const sparkColors = spark.attributes.particleColor.array;
  const sparkFloors = new Float32Array(sparkCount);
  let sparkAlive = 0;
  let sparkCarry = 0;
  let sparkWheelToggle = false;
  let sparkExhaustToggle = false;

  // --- quality --------------------------------------------------------------
  let emissionScale = 1;
  let skidCap = maxSkidSegments;
  let smokeCap = smokeCount;
  let sparkCap = sparkCount;
  let disposed = false;

  function writeSegmentAlpha(segment, alpha) {
    const base = segment * SEGMENT_COLOR_FLOATS;
    for (let vertex = 0; vertex < 8; vertex += 1) {
      skid.colors[base + vertex * 4 + 3] = alpha;
    }
  }

  function computeSkidEdges(target, axleX, axleZ, rightX, rightZ, groundY) {
    const y = groundY + SKID_Y_LIFT;
    for (let wheel = 0; wheel < 2; wheel += 1) {
      const sign = wheel === 0 ? -1 : 1;
      const wheelX = axleX + rightX * WHEEL_HALF_TRACK * sign;
      const wheelZ = axleZ + rightZ * WHEEL_HALF_TRACK * sign;
      const base = wheel * 6;
      target[base] = wheelX - rightX * SKID_HALF_WIDTH;
      target[base + 1] = y;
      target[base + 2] = wheelZ - rightZ * SKID_HALF_WIDTH;
      target[base + 3] = wheelX + rightX * SKID_HALF_WIDTH;
      target[base + 4] = y;
      target[base + 5] = wheelZ + rightZ * SKID_HALF_WIDTH;
    }
  }

  function writeSkidSegment(alpha) {
    const segment = skidHead;
    skidHead = (skidHead + 1) % skidCap;
    const positionBase = segment * SEGMENT_POSITION_FLOATS;
    const { positions, prevEdges, curEdges } = skid;
    for (let quad = 0; quad < 2; quad += 1) {
      const edge0 = quad * 6;
      const edge1 = edge0 + 3;
      const base = positionBase + quad * 12;
      positions[base] = prevEdges[edge0];
      positions[base + 1] = prevEdges[edge0 + 1];
      positions[base + 2] = prevEdges[edge0 + 2];
      positions[base + 3] = prevEdges[edge1];
      positions[base + 4] = prevEdges[edge1 + 1];
      positions[base + 5] = prevEdges[edge1 + 2];
      positions[base + 6] = curEdges[edge1];
      positions[base + 7] = curEdges[edge1 + 1];
      positions[base + 8] = curEdges[edge1 + 2];
      positions[base + 9] = curEdges[edge0];
      positions[base + 10] = curEdges[edge0 + 1];
      positions[base + 11] = curEdges[edge0 + 2];
    }
    skid.segmentAlpha[segment] = alpha;
    writeSegmentAlpha(segment, alpha);
    markDirtyRange(skid.positionAttribute, positionBase, SEGMENT_POSITION_FLOATS);
    skidAnyAlive = true;
  }

  function updateSkid(dt, pose) {
    let colorsDirty = false;
    if (skidAnyAlive && dt > 0) {
      const decay = Math.exp(-dt / SKID_FADE_TAU);
      let alive = false;
      for (let segment = 0; segment < maxSkidSegments; segment += 1) {
        const alpha = skid.segmentAlpha[segment];
        if (alpha <= 0) continue;
        const next = alpha * decay;
        if (next < SKID_MIN_ALPHA) {
          skid.segmentAlpha[segment] = 0;
          writeSegmentAlpha(segment, 0);
        } else {
          skid.segmentAlpha[segment] = next;
          writeSegmentAlpha(segment, next);
          alive = true;
        }
      }
      skidAnyAlive = alive;
      colorsDirty = true;
    }

    const active = !!pose && pose.drifting && !pose.airborne && pose.speedKph > SKID_MIN_SPEED_KPH;
    if (!active) {
      skidHasPrev = false;
    } else {
      computeSkidEdges(skid.curEdges, pose.axleX, pose.axleZ, pose.rightX, pose.rightZ, pose.groundY);
      if (!skidHasPrev) {
        skid.prevEdges.set(skid.curEdges);
        prevAxleX = pose.axleX;
        prevAxleZ = pose.axleZ;
        skidHasPrev = true;
      } else {
        const stepX = pose.axleX - prevAxleX;
        const stepZ = pose.axleZ - prevAxleZ;
        const step = Math.hypot(stepX, stepZ);
        if (step > SKID_BREAK_STEP) {
          skid.prevEdges.set(skid.curEdges);
          prevAxleX = pose.axleX;
          prevAxleZ = pose.axleZ;
        } else if (step >= SKID_MIN_STEP) {
          const alpha = Math.min(0.75, 0.3 + 0.42 * pose.driftIntensity);
          writeSkidSegment(alpha);
          skid.prevEdges.set(skid.curEdges);
          prevAxleX = pose.axleX;
          prevAxleZ = pose.axleZ;
          colorsDirty = true;
        }
      }
    }
    if (colorsDirty) skid.colorAttribute.needsUpdate = true;
  }

  function copySmoke(from, to) {
    if (from === to) return;
    const from3 = from * 3;
    const to3 = to * 3;
    smoke.positions[to3] = smoke.positions[from3];
    smoke.positions[to3 + 1] = smoke.positions[from3 + 1];
    smoke.positions[to3 + 2] = smoke.positions[from3 + 2];
    smoke.velocities[to3] = smoke.velocities[from3];
    smoke.velocities[to3 + 1] = smoke.velocities[from3 + 1];
    smoke.velocities[to3 + 2] = smoke.velocities[from3 + 2];
    smoke.ages[to] = smoke.ages[from];
    smoke.lifetimes[to] = smoke.lifetimes[from];
    smoke.baseSizes[to] = smoke.baseSizes[from];
    smoke.baseAlphas[to] = smoke.baseAlphas[from];
  }

  function spawnSmoke(x, y, z, velocityX, velocityY, velocityZ, baseAlpha) {
    const index = smokeAlive;
    smokeAlive += 1;
    const index3 = index * 3;
    smoke.positions[index3] = x;
    smoke.positions[index3 + 1] = y;
    smoke.positions[index3 + 2] = z;
    smoke.velocities[index3] = velocityX;
    smoke.velocities[index3 + 1] = velocityY;
    smoke.velocities[index3 + 2] = velocityZ;
    smoke.ages[index] = 0;
    smoke.lifetimes[index] = 0.7 + Math.random() * 0.4;
    smoke.baseSizes[index] = 0.5 + Math.random() * 0.5;
    smoke.baseAlphas[index] = baseAlpha;
    smoke.sizes[index] = smoke.baseSizes[index];
    smokeAlphas[index] = 0;
  }

  function updateSmoke(dt, pose) {
    if (pose && pose.drifting && !pose.airborne && pose.speedKph > SMOKE_MIN_SPEED_KPH && dt > 0) {
      smokeCarry += (26 + 62 * pose.driftIntensity) * emissionScale * dt;
      let spawnCount = Math.floor(smokeCarry);
      smokeCarry -= spawnCount;
      const baseAlpha = 0.3 + 0.32 * pose.driftIntensity;
      while (spawnCount > 0 && smokeAlive < smokeCap) {
        spawnCount -= 1;
        smokeWheelToggle = !smokeWheelToggle;
        const sign = smokeWheelToggle ? 1 : -1;
        const wheelX = pose.axleX + pose.rightX * WHEEL_HALF_TRACK * sign;
        const wheelZ = pose.axleZ + pose.rightZ * WHEEL_HALF_TRACK * sign;
        spawnSmoke(
          wheelX + (Math.random() - 0.5) * 0.3,
          pose.groundY + 0.2 + Math.random() * 0.14,
          wheelZ + (Math.random() - 0.5) * 0.3,
          pose.rightX * sign * (0.9 + Math.random() * 1.7) + pose.forwardX * (pose.forwardSpeed * 0.16 - 0.6 - Math.random() * 1.4),
          0.7 + Math.random() * 1.1,
          pose.rightZ * sign * (0.9 + Math.random() * 1.7) + pose.forwardZ * (pose.forwardSpeed * 0.16 - 0.6 - Math.random() * 1.4),
          baseAlpha + Math.random() * 0.08,
        );
      }
    } else {
      smokeCarry = 0;
    }

    const drag = Math.exp(-dt * SMOKE_DRAG);
    let index = 0;
    while (index < smokeAlive) {
      smoke.ages[index] += dt;
      const life = smoke.lifetimes[index];
      if (smoke.ages[index] >= life) {
        smokeAlive -= 1;
        copySmoke(smokeAlive, index);
        continue;
      }
      const t = smoke.ages[index] / life;
      const index3 = index * 3;
      smoke.velocities[index3] *= drag;
      smoke.velocities[index3 + 1] = smoke.velocities[index3 + 1] * drag + SMOKE_RISE * dt;
      smoke.velocities[index3 + 2] *= drag;
      smoke.positions[index3] += smoke.velocities[index3] * dt;
      smoke.positions[index3 + 1] += smoke.velocities[index3 + 1] * dt;
      smoke.positions[index3 + 2] += smoke.velocities[index3 + 2] * dt;
      smoke.sizes[index] = smoke.baseSizes[index] * (1 + t * SMOKE_GROWTH);
      smokeAlphas[index] = smoke.baseAlphas[index] * (1 - t) * Math.min(1, t * 6);
      index += 1;
    }
    smoke.geometry.setDrawRange(0, smokeAlive);
    if (smokeAlive > 0) {
      markDirtyRange(smoke.attributes.position, 0, smokeAlive * 3);
      markDirtyRange(smoke.attributes.particleSize, 0, smokeAlive);
      markDirtyRange(smoke.attributes.particleAlpha, 0, smokeAlive);
    }
  }

  function copySpark(from, to) {
    if (from === to) return;
    const from3 = from * 3;
    const to3 = to * 3;
    spark.positions[to3] = spark.positions[from3];
    spark.positions[to3 + 1] = spark.positions[from3 + 1];
    spark.positions[to3 + 2] = spark.positions[from3 + 2];
    spark.velocities[to3] = spark.velocities[from3];
    spark.velocities[to3 + 1] = spark.velocities[from3 + 1];
    spark.velocities[to3 + 2] = spark.velocities[from3 + 2];
    const from4 = from * 4;
    const to4 = to * 4;
    sparkColors[to4] = sparkColors[from4];
    sparkColors[to4 + 1] = sparkColors[from4 + 1];
    sparkColors[to4 + 2] = sparkColors[from4 + 2];
    sparkColors[to4 + 3] = sparkColors[from4 + 3];
    spark.ages[to] = spark.ages[from];
    spark.lifetimes[to] = spark.lifetimes[from];
    spark.baseSizes[to] = spark.baseSizes[from];
    spark.baseAlphas[to] = spark.baseAlphas[from];
    spark.sizes[to] = spark.sizes[from];
    sparkFloors[to] = sparkFloors[from];
  }

  function spawnSpark(x, y, z, velocityX, velocityY, velocityZ, r, g, b, baseAlpha, size, life, floorY) {
    const index = sparkAlive;
    sparkAlive += 1;
    const index3 = index * 3;
    spark.positions[index3] = x;
    spark.positions[index3 + 1] = y;
    spark.positions[index3 + 2] = z;
    spark.velocities[index3] = velocityX;
    spark.velocities[index3 + 1] = velocityY;
    spark.velocities[index3 + 2] = velocityZ;
    const index4 = index * 4;
    sparkColors[index4] = r;
    sparkColors[index4 + 1] = g;
    sparkColors[index4 + 2] = b;
    sparkColors[index4 + 3] = baseAlpha;
    spark.ages[index] = 0;
    spark.lifetimes[index] = life;
    spark.baseSizes[index] = size;
    spark.baseAlphas[index] = baseAlpha;
    spark.sizes[index] = size;
    sparkFloors[index] = floorY;
  }

  function emitBoostSparks(dt, pose) {
    sparkCarry += (pose.boosting ? 130 : 95) * emissionScale * dt;
    let spawnCount = Math.floor(sparkCarry);
    sparkCarry -= spawnCount;
    while (spawnCount > 0 && sparkAlive < sparkCap) {
      spawnCount -= 1;
      sparkExhaustToggle = !sparkExhaustToggle;
      const sign = sparkExhaustToggle ? 1 : -1;
      const exhaustX = pose.positionX + pose.forwardX * EXHAUST_OFFSET + pose.rightX * EXHAUST_HALF_SPACING * sign;
      const exhaustZ = pose.positionZ + pose.forwardZ * EXHAUST_OFFSET + pose.rightZ * EXHAUST_HALF_SPACING * sign;
      let r;
      let g;
      let b;
      if (pose.boosting) {
        const color = BOOST_COLORS[Math.random() < 0.5 ? 0 : 1];
        const brightness = 0.85 + Math.random() * 0.3;
        r = color.r * brightness;
        g = color.g * brightness;
        b = color.b * brightness;
      } else {
        const mix = Math.random();
        r = MINI_BOOST_COLOR_A.r + (MINI_BOOST_COLOR_B.r - MINI_BOOST_COLOR_A.r) * mix;
        g = MINI_BOOST_COLOR_A.g + (MINI_BOOST_COLOR_B.g - MINI_BOOST_COLOR_A.g) * mix;
        b = MINI_BOOST_COLOR_A.b + (MINI_BOOST_COLOR_B.b - MINI_BOOST_COLOR_A.b) * mix;
      }
      const thrust = 8 + Math.random() * 8;
      const lateral = (Math.random() - 0.5) * 2.6;
      spawnSpark(
        exhaustX + (Math.random() - 0.5) * 0.14,
        pose.groundY + EXHAUST_HEIGHT + (Math.random() - 0.5) * 0.12,
        exhaustZ + (Math.random() - 0.5) * 0.14,
        -pose.forwardX * thrust + pose.rightX * lateral,
        Math.random() * 1.4 - 0.2,
        -pose.forwardZ * thrust + pose.rightZ * lateral,
        r, g, b,
        0.85 + Math.random() * 0.15,
        0.18 + Math.random() * 0.16,
        0.22 + Math.random() * 0.18,
        pose.groundY + 0.04,
      );
    }
  }

  function emitDriftSparks(dt, pose) {
    const charge = pose.chargeLevel;
    const rate = (charge === 0 ? 16 : 30 + 27 * charge) * (0.45 + 0.55 * pose.driftIntensity) * emissionScale;
    sparkCarry += rate * dt;
    let spawnCount = Math.floor(sparkCarry);
    sparkCarry -= spawnCount;
    const color = CHARGE_COLORS[charge];
    while (spawnCount > 0 && sparkAlive < sparkCap) {
      spawnCount -= 1;
      sparkWheelToggle = !sparkWheelToggle;
      const sign = sparkWheelToggle ? 1 : -1;
      const wheelX = pose.axleX + pose.rightX * WHEEL_HALF_TRACK * sign;
      const wheelZ = pose.axleZ + pose.rightZ * WHEEL_HALF_TRACK * sign;
      const outward = (3 + Math.random() * 3.5) * sign;
      const backward = -(2.5 + Math.random() * 4.5);
      const brightness = 0.85 + Math.random() * 0.3;
      spawnSpark(
        wheelX + (Math.random() - 0.5) * 0.24,
        pose.groundY + 0.12,
        wheelZ + (Math.random() - 0.5) * 0.24,
        pose.rightX * outward + pose.forwardX * backward,
        1.2 + Math.random() * 2.2,
        pose.rightZ * outward + pose.forwardZ * backward,
        color.r * brightness,
        color.g * brightness,
        color.b * brightness,
        charge === 0 ? 0.55 : 0.95,
        charge === 0 ? 0.09 + Math.random() * 0.08 : 0.13 + Math.random() * 0.14,
        0.25 + Math.random() * 0.2,
        pose.groundY + 0.04,
      );
    }
  }

  function updateSparks(dt, pose) {
    if (pose && dt > 0) {
      if (pose.boosting || pose.miniBoostActive) emitBoostSparks(dt, pose);
      else if (pose.drifting && !pose.airborne && pose.speedKph > SMOKE_MIN_SPEED_KPH) emitDriftSparks(dt, pose);
      else sparkCarry = 0;
    } else {
      sparkCarry = 0;
    }

    let index = 0;
    while (index < sparkAlive) {
      spark.ages[index] += dt;
      const life = spark.lifetimes[index];
      if (spark.ages[index] >= life) {
        sparkAlive -= 1;
        copySpark(sparkAlive, index);
        continue;
      }
      const t = spark.ages[index] / life;
      const index3 = index * 3;
      spark.velocities[index3 + 1] -= SPARK_GRAVITY * dt;
      spark.positions[index3] += spark.velocities[index3] * dt;
      spark.positions[index3 + 1] += spark.velocities[index3 + 1] * dt;
      spark.positions[index3 + 2] += spark.velocities[index3 + 2] * dt;
      if (spark.positions[index3 + 1] < sparkFloors[index]) {
        spark.positions[index3 + 1] = sparkFloors[index];
        spark.velocities[index3 + 1] *= -0.4;
        spark.velocities[index3] *= 0.72;
        spark.velocities[index3 + 2] *= 0.72;
      }
      const fade = 1 - t;
      sparkColors[index * 4 + 3] = spark.baseAlphas[index] * fade * fade;
      spark.sizes[index] = spark.baseSizes[index] * (1 - t * 0.45);
      index += 1;
    }
    spark.geometry.setDrawRange(0, sparkAlive);
    if (sparkAlive > 0) {
      markDirtyRange(spark.attributes.position, 0, sparkAlive * 3);
      markDirtyRange(spark.attributes.particleSize, 0, sparkAlive);
      markDirtyRange(spark.attributes.particleColor, 0, sparkAlive * 4);
    }
  }

  // Reused per-frame pose scratch (kept across calls, never reallocated).
  const pose = {
    positionX: 0, positionZ: 0,
    forwardX: 0, forwardZ: 0,
    rightX: 0, rightZ: 0,
    axleX: 0, axleZ: 0,
    groundY: 0, forwardSpeed: 0, speedKph: 0,
    drifting: false, driftIntensity: 0, chargeLevel: 0,
    boosting: false, miniBoostActive: false, airborne: false,
  };

  function readFrame(frame) {
    if (!frame || !frame.position || !Number.isFinite(frame.position.x)) return null;
    const heading = frame.heading || 0;
    pose.positionX = frame.position.x;
    pose.positionZ = frame.position.z;
    pose.forwardX = Math.sin(heading);
    pose.forwardZ = Math.cos(heading);
    pose.rightX = pose.forwardZ;
    pose.rightZ = -pose.forwardX;
    pose.axleX = pose.positionX + pose.forwardX * REAR_AXLE_OFFSET;
    pose.axleZ = pose.positionZ + pose.forwardZ * REAR_AXLE_OFFSET;
    pose.groundY = Number.isFinite(frame.groundY) ? frame.groundY : frame.position.y - 0.45;
    pose.speedKph = frame.speedKph || 0;
    pose.forwardSpeed = pose.speedKph / 3.6;
    pose.drifting = !!frame.drifting;
    pose.driftIntensity = THREE.MathUtils.clamp(frame.driftIntensity || 0, 0, 1);
    pose.chargeLevel = Math.max(0, Math.min(3, frame.chargeLevel | 0));
    pose.boosting = !!frame.boosting;
    pose.miniBoostActive = !!frame.miniBoostActive;
    pose.airborne = !!frame.airborne;
    return pose;
  }

  function update(dt, frame) {
    if (disposed) return;
    const delta = THREE.MathUtils.clamp(dt || 0, 0, 0.1);
    const framePose = readFrame(frame);
    updateSkid(delta, framePose);
    updateSmoke(delta, framePose);
    updateSparks(delta, framePose);
  }

  function setQuality(level) {
    if (disposed) return;
    const preset = QUALITY_PRESETS[level] || QUALITY_PRESETS.high;
    emissionScale = preset.emission;
    skidCap = Math.max(16, Math.floor(maxSkidSegments * preset.capacity));
    smokeCap = Math.max(8, Math.floor(smokeCount * preset.capacity));
    sparkCap = Math.max(8, Math.floor(sparkCount * preset.capacity));
    if (skidHead >= skidCap) skidHead = 0;
    if (smokeAlive > smokeCap) {
      smokeAlive = smokeCap;
      smoke.geometry.setDrawRange(0, smokeAlive);
    }
    if (sparkAlive > sparkCap) {
      sparkAlive = sparkCap;
      spark.geometry.setDrawRange(0, sparkAlive);
    }
  }

  function reset() {
    if (disposed) return;
    skid.segmentAlpha.fill(0);
    for (let vertex = 0; vertex < maxSkidSegments * 8; vertex += 1) {
      skid.colors[vertex * 4 + 3] = 0;
    }
    skid.colorAttribute.needsUpdate = true;
    skidHead = 0;
    skidHasPrev = false;
    skidAnyAlive = false;
    smokeAlive = 0;
    smokeCarry = 0;
    smoke.geometry.setDrawRange(0, 0);
    sparkAlive = 0;
    sparkCarry = 0;
    spark.geometry.setDrawRange(0, 0);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(skid.mesh, smoke.points, spark.points);
    skid.geometry.dispose();
    skid.material.dispose();
    smoke.geometry.dispose();
    smoke.material.dispose();
    spark.geometry.dispose();
    spark.material.dispose();
  }

  return { update, setQuality, reset, dispose };
}
