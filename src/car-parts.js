// 商店装备件的 3D 挂件与喇叭音效合成。
// 与 shop.js 一样保持"纯模块"：顶层不碰 window / document，node 里可以直接 import
// （只有 attach 时才真正建网格，几何与材质全部自建，不加载任何外部资源）。
//
// 尺寸基准取自 procedural-vehicle.js 的主车：轴距 ±1.38、轮距 ±1.02、轮径 0.43、
// 胎宽 0.30，车尾在 z ≈ -2.2。glTF 主车（vehicle-assets.js）的 wheels 位于一个被
// 整体缩放过的 modelFrame 里，attach 时会按世界缩放反向补偿，保证挂件在车身坐标系
// 下始终是同一个物理尺寸。

import * as THREE from 'three';

export const WHEEL_STYLES = Object.freeze(['spoke', 'mesh', 'blade', 'turbine']);
export const SPOILER_STYLES = Object.freeze(['ducktail', 'gt-wing', 'swan', 'diffuser']);
export const HORN_TONES = Object.freeze(['classic', 'siren', 'chiptune', 'airhorn']);

const WHEEL_CAP_NAME = 'ShopWheelCap';
const SPOILER_NAME = 'ShopSpoiler';

const DEFAULT_COLOR = '#c8d6df';
const DEFAULT_ACCENT = '#2ce8f5';

// ---------------------------------------------------------------------------
// 几何工具：把一堆小零件烘成一个 BufferGeometry，一件挂件因此只有 2 个 draw call
// （主体 + 发光饰条），远小于契约要求的 3 个。
// ---------------------------------------------------------------------------

const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3(1, 1, 1);

function placement({ position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 } = {}) {
  scratchPosition.set(position[0], position[1], position[2]);
  scratchEuler.set(rotation[0], rotation[1], rotation[2]);
  scratchQuaternion.setFromEuler(scratchEuler);
  if (Array.isArray(scale)) scratchScale.set(scale[0], scale[1], scale[2]);
  else scratchScale.set(scale, scale, scale);
  return scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale).clone();
}

// pieces: [{ geometry, matrix }]。输入几何一律被消费掉（合并后立即 dispose）。
function bakeGeometry(pieces) {
  const positions = [];
  const normals = [];
  for (const piece of pieces) {
    const source = piece.geometry;
    const flat = source.index ? source.toNonIndexed() : source.clone();
    if (piece.matrix) flat.applyMatrix4(piece.matrix);
    const position = flat.getAttribute('position');
    const normal = flat.getAttribute('normal');
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (normal) normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    flat.dispose();
    source.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function box(width, height, depth, transform) {
  return { geometry: new THREE.BoxGeometry(width, height, depth), matrix: placement(transform) };
}

function cylinder(radiusTop, radiusBottom, height, segments, transform) {
  return {
    geometry: new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments, 1),
    matrix: placement(transform),
  };
}

function ring(radius, tube, segments, transform) {
  return { geometry: new THREE.TorusGeometry(radius, tube, 6, segments), matrix: placement(transform) };
}

// 沿 +Y 轴均分放置零件，callback 拿到角度与序号。
function radial(count, build) {
  const pieces = [];
  for (let i = 0; i < count; i += 1) pieces.push(...build((i / count) * Math.PI * 2, i));
  return pieces;
}

function bodyMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color ?? DEFAULT_COLOR),
    metalness: 0.86,
    roughness: 0.26,
  });
}

function accentMaterial(color) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color ?? DEFAULT_ACCENT), toneMapped: false });
}

// ---------------------------------------------------------------------------
// 轮毂盖
// ---------------------------------------------------------------------------

const WHEEL_RADIUS = 0.43;
const CAP_RADIUS = WHEEL_RADIUS * 0.7; // 0.301，正好盖住轮辋不越过胎面
const CAP_OFFSET = 0.168; // 胎宽 0.30 的一半再往外挪一点点

// 轮毂盖统一建在"轴向 = +Y"的坐标系里，attach 时整体绕 Z 旋 ±90° 贴到左右轮外侧。
const WHEEL_BUILDERS = Object.freeze({
  // 五辐锻造：宽扁辐条 + 外圈轮辋。
  spoke() {
    const body = [
      ring(CAP_RADIUS * 0.94, 0.026, 24, { rotation: [Math.PI / 2, 0, 0] }),
      cylinder(CAP_RADIUS * 0.3, CAP_RADIUS * 0.3, 0.05, 16, { position: [0, 0.01, 0] }),
      ...radial(5, (angle) => [
        box(0.062, 0.034, CAP_RADIUS * 0.78, {
          position: [Math.sin(angle) * CAP_RADIUS * 0.5, 0.005, Math.cos(angle) * CAP_RADIUS * 0.5],
          rotation: [0, angle, 0],
        }),
      ]),
    ];
    const accent = [
      cylinder(CAP_RADIUS * 0.15, CAP_RADIUS * 0.15, 0.062, 12, { position: [0, 0.02, 0] }),
      ring(CAP_RADIUS * 0.99, 0.012, 24, { position: [0, 0.026, 0], rotation: [Math.PI / 2, 0, 0] }),
    ];
    return { body, accent };
  },
  // 蜂巢网轮：两层交错细辐 + 六边中心盖，密到转起来是一片网。
  mesh() {
    const body = [
      ring(CAP_RADIUS * 0.95, 0.024, 26, { rotation: [Math.PI / 2, 0, 0] }),
      ring(CAP_RADIUS * 0.56, 0.02, 22, { position: [0, 0.006, 0], rotation: [Math.PI / 2, 0, 0] }),
      ...radial(10, (angle) => [
        box(0.024, 0.026, CAP_RADIUS * 0.9, {
          position: [Math.sin(angle) * CAP_RADIUS * 0.47, 0, Math.cos(angle) * CAP_RADIUS * 0.47],
          rotation: [0, angle, 0],
        }),
      ]),
      ...radial(10, (angle) => [
        box(0.02, 0.02, CAP_RADIUS * 0.52, {
          position: [Math.sin(angle + 0.31) * CAP_RADIUS * 0.72, 0.014, Math.cos(angle + 0.31) * CAP_RADIUS * 0.72],
          rotation: [0, angle + 0.31, 0.42],
        }),
      ]),
    ];
    const accent = [
      cylinder(CAP_RADIUS * 0.26, CAP_RADIUS * 0.26, 0.05, 6, { position: [0, 0.026, 0] }),
      ring(CAP_RADIUS * 0.78, 0.011, 24, { position: [0, 0.024, 0], rotation: [Math.PI / 2, 0, 0] }),
    ];
    return { body, accent };
  },
  // 刀锋：三片带迎角的大叶片，中心是一枚尖锥。
  blade() {
    const body = [
      ring(CAP_RADIUS * 0.93, 0.03, 22, { rotation: [Math.PI / 2, 0, 0] }),
      ...radial(3, (angle) => [
        box(0.13, 0.03, CAP_RADIUS * 0.86, {
          position: [Math.sin(angle) * CAP_RADIUS * 0.46, 0.012, Math.cos(angle) * CAP_RADIUS * 0.46],
          rotation: [0, angle, 0.34],
        }),
      ]),
      ...radial(3, (angle) => [
        box(0.05, 0.055, CAP_RADIUS * 0.34, {
          position: [Math.sin(angle + 1.05) * CAP_RADIUS * 0.74, 0, Math.cos(angle + 1.05) * CAP_RADIUS * 0.74],
          rotation: [0, angle + 1.05, 0],
        }),
      ]),
    ];
    const accent = [
      cylinder(0.001, CAP_RADIUS * 0.24, 0.13, 12, { position: [0, 0.062, 0] }),
      ...radial(3, (angle) => [
        box(0.14, 0.012, 0.05, {
          position: [Math.sin(angle) * CAP_RADIUS * 0.82, 0.03, Math.cos(angle) * CAP_RADIUS * 0.82],
          rotation: [0, angle, 0.34],
        }),
      ]),
    ];
    return { body, accent };
  },
  // 涡轮：八片扭转导风叶 + 深盘，中心一圈发光导流环。
  turbine() {
    const body = [
      ring(CAP_RADIUS * 0.96, 0.028, 26, { rotation: [Math.PI / 2, 0, 0] }),
      cylinder(CAP_RADIUS * 0.42, CAP_RADIUS * 0.5, 0.09, 18, { position: [-0.028, 0, 0], rotation: [0, 0, 0] }),
      ...radial(8, (angle) => [
        box(0.018, 0.11, CAP_RADIUS * 0.82, {
          position: [Math.sin(angle) * CAP_RADIUS * 0.52, -0.008, Math.cos(angle) * CAP_RADIUS * 0.52],
          rotation: [0, angle, 0.62],
        }),
      ]),
    ];
    const accent = [
      cylinder(CAP_RADIUS * 0.2, CAP_RADIUS * 0.28, 0.07, 16, { position: [0, 0.03, 0] }),
      ring(CAP_RADIUS * 0.62, 0.016, 24, { position: [0, 0.012, 0], rotation: [Math.PI / 2, 0, 0] }),
    ];
    return { body, accent };
  },
});

function wheelOutward(wheel, index) {
  const x = Number(wheel?.position?.x) || 0;
  if (x !== 0) return Math.sign(x);
  return index % 2 === 0 ? -1 : 1;
}

// glTF 主车的 wheels 挂在被缩放过的 modelFrame 下；把挂件缩回车身坐标系的尺度，
// 这样同一份几何在程序化车和 glTF 车上看起来一样大。
function scaleCompensation(hero, wheel) {
  try {
    hero.updateMatrixWorld?.(true);
    const heroScale = hero.getWorldScale?.(new THREE.Vector3());
    const wheelScale = wheel.getWorldScale?.(new THREE.Vector3());
    if (!heroScale || !wheelScale || !wheelScale.x) return 1;
    const ratio = heroScale.x / wheelScale.x;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  } catch {
    return 1;
  }
}

/**
 * 四只轮毂盖，attach 后作为 hero.userData.wheels 每个 Group 的子对象，
 * 跟着原有的 wheel.rotation.x 一起转、跟着前轮 rotation.y 一起打方向。
 *
 * @param {'spoke'|'mesh'|'blade'|'turbine'} style
 * @param {{ color?: string, accentColor?: string }} [colors]
 * @returns {{ attach(hero): boolean, detach(hero?): boolean, dispose(): void, style: string }}
 */
export function createWheelSet(style, { color, accentColor } = {}) {
  const key = WHEEL_STYLES.includes(style) ? style : WHEEL_STYLES[0];
  const { body, accent } = WHEEL_BUILDERS[key]();
  const bodyGeometry = bakeGeometry(body);
  const accentGeometry = bakeGeometry(accent);
  const materials = [bodyMaterial(color), accentMaterial(accentColor)];
  const geometries = [bodyGeometry, accentGeometry];
  let mounted = [];
  let disposed = false;

  function detach() {
    for (const cap of mounted) cap.removeFromParent();
    const had = mounted.length > 0;
    mounted = [];
    return had;
  }

  function attach(hero) {
    detach();
    if (disposed) return false;
    const wheels = hero?.userData?.wheels;
    if (!Array.isArray(wheels) || wheels.length === 0) return false;
    wheels.forEach((wheel, index) => {
      if (!wheel?.add) return;
      const outward = wheelOutward(wheel, index);
      const compensation = scaleCompensation(hero, wheel);
      const cap = new THREE.Group();
      cap.name = WHEEL_CAP_NAME;
      const shell = new THREE.Mesh(bodyGeometry, materials[0]);
      const glow = new THREE.Mesh(accentGeometry, materials[1]);
      shell.castShadow = true;
      cap.add(shell, glow);
      // 建模坐标轴是 +Y，绕 Z 转 ∓90° 后指向车外侧的 ±X。
      cap.rotation.z = outward > 0 ? -Math.PI / 2 : Math.PI / 2;
      cap.position.x = outward * CAP_OFFSET * compensation;
      cap.scale.setScalar(compensation);
      wheel.add(cap);
      mounted.push(cap);
    });
    return mounted.length > 0;
  }

  function dispose() {
    if (disposed) return;
    detach();
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  return { attach, detach, dispose, style: key };
}

// ---------------------------------------------------------------------------
// 尾翼
// ---------------------------------------------------------------------------

// 每种尾翼的挂点：车尾 z ≈ -1.9，高度落在 0.75–1.05 之间。
const SPOILER_ANCHORS = Object.freeze({
  ducktail: Object.freeze({ y: 0.78, z: -1.92 }),
  'gt-wing': Object.freeze({ y: 1.05, z: -1.9 }),
  swan: Object.freeze({ y: 1.0, z: -1.9 }),
  diffuser: Object.freeze({ y: 0.75, z: -1.96 }),
});

const SPOILER_BUILDERS = Object.freeze({
  // 鸭尾：贴着尾箱翘起的一道短唇 + 两片小侧鳍。
  ducktail() {
    const body = [
      box(1.42, 0.06, 0.34, { position: [0, 0, -0.06], rotation: [0.36, 0, 0] }),
      box(1.3, 0.05, 0.2, { position: [0, -0.11, 0.16], rotation: [0.1, 0, 0] }),
      ...[-1, 1].map((side) => box(0.05, 0.13, 0.3, {
        position: [side * 0.71, 0.02, -0.04],
        rotation: [0.36, 0, side * 0.12],
      })),
    ];
    const accent = [
      box(1.44, 0.022, 0.035, { position: [0, 0.055, -0.19], rotation: [0.36, 0, 0] }),
      box(0.36, 0.018, 0.03, { position: [0, -0.12, 0.25] }),
    ];
    return { body, accent };
  },
  // GT 大尾翼：双立柱 + 大翼面 + 端板，最张扬的一套。
  'gt-wing'() {
    const body = [
      box(1.96, 0.075, 0.46, { position: [0, 0, 0], rotation: [0.16, 0, 0] }),
      box(1.7, 0.05, 0.16, { position: [0, -0.06, -0.26], rotation: [0.42, 0, 0] }),
      ...[-1, 1].map((side) => box(0.085, 0.5, 0.15, { position: [side * 0.66, -0.27, 0.06] })),
      ...[-1, 1].map((side) => box(0.05, 0.3, 0.54, { position: [side * 0.98, -0.02, 0] })),
    ];
    const accent = [
      box(1.98, 0.026, 0.05, { position: [0, 0.05, -0.21], rotation: [0.16, 0, 0] }),
      ...[-1, 1].map((side) => box(0.058, 0.05, 0.46, { position: [side * 0.98, -0.14, 0] })),
    ];
    return { body, accent };
  },
  // 天鹅颈：支架从翼面上方吊下来，翼下气流不被立柱打断。
  swan() {
    const body = [
      box(1.9, 0.07, 0.44, { position: [0, 0, 0], rotation: [0.14, 0, 0] }),
      ...[-1, 1].flatMap((side) => [
        box(0.07, 0.2, 0.09, { position: [side * 0.6, 0.11, 0.2], rotation: [-0.5, 0, 0] }),
        box(0.07, 0.26, 0.09, { position: [side * 0.6, 0.16, 0.42], rotation: [0.62, 0, 0] }),
        box(0.07, 0.34, 0.09, { position: [side * 0.6, -0.06, 0.56], rotation: [0.1, 0, 0] }),
      ]),
      ...[-1, 1].map((side) => box(0.045, 0.28, 0.5, { position: [side * 0.95, 0.01, 0] })),
    ];
    const accent = [
      box(1.92, 0.024, 0.045, { position: [0, 0.048, -0.2], rotation: [0.14, 0, 0] }),
      ...[-1, 1].map((side) => box(0.052, 0.2, 0.026, { position: [side * 0.6, 0.16, 0.47], rotation: [0.62, 0, 0] })),
    ];
    return { body, accent };
  },
  // 扩散器：挂点下方一块带竖鳍的底板，压低尾部气流。
  diffuser() {
    const body = [
      box(1.78, 0.08, 0.52, { position: [0, -0.4, -0.02], rotation: [-0.26, 0, 0] }),
      box(1.8, 0.14, 0.08, { position: [0, -0.3, -0.24] }),
      ...[-2, -1, 0, 1, 2].map((slot) => box(0.045, 0.2, 0.5, {
        position: [slot * 0.36, -0.34, -0.02],
        rotation: [-0.26, 0, 0],
      })),
    ];
    const accent = [
      box(1.82, 0.03, 0.04, { position: [0, -0.22, -0.26] }),
      ...[-1, 1].map((side) => box(0.06, 0.03, 0.44, { position: [side * 0.72, -0.24, -0.02], rotation: [-0.26, 0, 0] })),
    ];
    return { body, accent };
  },
});

/**
 * 车尾扰流件。attach 直接把一个 Group 挂到 hero 下（hero 局部坐标 z ≈ -1.9）。
 *
 * @param {'ducktail'|'gt-wing'|'swan'|'diffuser'} style
 * @param {{ color?: string, accentColor?: string }} [colors]
 * @returns {{ attach(hero): boolean, detach(hero?): boolean, dispose(): void, style: string }}
 */
export function createSpoiler(style, { color, accentColor } = {}) {
  const key = SPOILER_STYLES.includes(style) ? style : SPOILER_STYLES[0];
  const { body, accent } = SPOILER_BUILDERS[key]();
  const bodyGeometry = bakeGeometry(body);
  const accentGeometry = bakeGeometry(accent);
  const materials = [bodyMaterial(color ?? '#161d24'), accentMaterial(accentColor)];
  const geometries = [bodyGeometry, accentGeometry];
  const anchor = SPOILER_ANCHORS[key];
  let group = null;
  let disposed = false;

  function detach() {
    if (!group) return false;
    group.removeFromParent();
    group = null;
    return true;
  }

  function attach(hero) {
    detach();
    if (disposed || !hero?.add) return false;
    group = new THREE.Group();
    group.name = SPOILER_NAME;
    const shell = new THREE.Mesh(bodyGeometry, materials[0]);
    const glow = new THREE.Mesh(accentGeometry, materials[1]);
    shell.castShadow = true;
    group.add(shell, glow);
    group.position.set(0, anchor.y, anchor.z);
    hero.add(group);
    return true;
  }

  function dispose() {
    if (disposed) return;
    detach();
    disposed = true;
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  return { attach, detach, dispose, style: key };
}

// ---------------------------------------------------------------------------
// 喇叭音效（Web Audio 合成，不加载任何采样）
// ---------------------------------------------------------------------------

const HORN_BUS_GAIN = 0.32;

function envelope(context, target, start, attack, hold, release, peak) {
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + attack);
  gain.gain.setValueAtTime(peak, start + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
  gain.connect(target);
  return gain;
}

function stopAt(oscillator, time) {
  try {
    oscillator.stop(time);
  } catch {
    // 某些实现对已停止的振荡器会抛错，忽略即可。
  }
}

// 每个配方都必须在 1.2 秒内收尾。
const HORN_RECIPES = Object.freeze({
  // 街车双音喇叭：大三度的两只锯齿波，过低通去掉毛刺。
  classic(context, bus, now) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, now);
    const gain = envelope(context, filter, now, 0.02, 0.4, 0.14, 0.5);
    filter.connect(bus);
    for (const frequency of [440, 554.4]) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency, now);
      osc.connect(gain);
      osc.start(now);
      stopAt(osc, now + 0.62);
    }
    return 0.62;
  },
  // 警笛：一只锯齿波来回扫两趟，带共振低通增加"呜"的质感。
  siren(context, bus, now) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.Q.value = 4;
    const gain = envelope(context, filter, now, 0.05, 0.9, 0.14, 0.42);
    filter.connect(bus);
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(620, now);
    for (let i = 0; i < 2; i += 1) {
      const base = now + i * 0.55;
      osc.frequency.exponentialRampToValueAtTime(1380, base + 0.28);
      osc.frequency.exponentialRampToValueAtTime(620, base + 0.55);
    }
    osc.connect(gain);
    osc.start(now);
    stopAt(osc, now + 1.14);
    return 1.14;
  },
  // 芯片音：方波五连音小旋律，八位机超车提示的感觉。
  chiptune(context, bus, now) {
    const notes = [660, 880, 990, 1320, 1760];
    const step = 0.1;
    notes.forEach((frequency, index) => {
      const start = now + index * step;
      const gain = envelope(context, bus, start, 0.006, 0.05, 0.038, 0.24);
      const osc = context.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(frequency, start);
      osc.connect(gain);
      osc.start(start);
      stopAt(osc, start + 0.1);
    });
    return notes.length * step + 0.1;
  },
  // 气笛：三只失谐锯齿波叠成的低频柱，起音有一点点上扬的"充气"。
  airhorn(context, bus, now) {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, now);
    filter.frequency.linearRampToValueAtTime(1800, now + 0.12);
    const gain = envelope(context, filter, now, 0.05, 0.6, 0.22, 0.46);
    filter.connect(bus);
    for (const frequency of [138, 185, 277]) {
      const osc = context.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(frequency * 0.94, now);
      osc.frequency.linearRampToValueAtTime(frequency, now + 0.09);
      osc.connect(gain);
      osc.start(now);
      stopAt(osc, now + 0.92);
    }
    return 0.92;
  },
});

/**
 * 喇叭播放器。audioContext 为空（或不是可用的 Web Audio 上下文）时 play 静默返回 false，
 * 这样 node 测试与"用户还没交互、音频没启动"的情况都不会抛错。
 *
 * @param {AudioContext|null} audioContext
 * @param {AudioNode} [destination] 默认接 audioContext.destination；传 RaceAudio 的 master 即可跟随总音量。
 * @returns {{ play(tone?: string): boolean, dispose(): void }}
 */
export function createHornPlayer(audioContext, destination) {
  const context = audioContext ?? null;
  let bus = null;
  let disposed = false;

  function usable() {
    return Boolean(
      !disposed
      && context
      && typeof context.createGain === 'function'
      && typeof context.createOscillator === 'function',
    );
  }

  function ensureBus() {
    if (!usable()) return null;
    if (!bus) {
      bus = context.createGain();
      bus.gain.value = HORN_BUS_GAIN;
      bus.connect(destination ?? context.destination);
    }
    return bus;
  }

  function play(tone = 'classic') {
    if (!usable()) return false;
    const target = ensureBus();
    if (!target) return false;
    const recipe = HORN_RECIPES[tone] ?? HORN_RECIPES.classic;
    try {
      recipe(context, target, Number(context.currentTime) || 0);
    } catch {
      return false;
    }
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      bus?.disconnect();
    } catch {
      // 已断开
    }
    bus = null;
  }

  return { play, dispose };
}
