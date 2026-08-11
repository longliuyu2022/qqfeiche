import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export const ROAD_WIDTH = 16;
export const TRACK_SAMPLES = 520;

export const TRACK_DISTRICTS = Object.freeze({
  harbor: Object.freeze({ start: 0.92, end: 0.27 }),
  city: Object.freeze({ start: 0.27, end: 0.62 }),
  mountain: Object.freeze({ start: 0.62, end: 0.92 }),
});

export const TRACK_POINTS = [
  new THREE.Vector3(-48, 2, -286),
  new THREE.Vector3(122, 6, -274),
  new THREE.Vector3(276, 14, -186),
  new THREE.Vector3(338, 22, -38),
  new THREE.Vector3(316, 12, 122),
  new THREE.Vector3(222, 18, 252),
  new THREE.Vector3(54, 9, 322),
  new THREE.Vector3(-126, 4, 306),
  new THREE.Vector3(-286, 16, 210),
  new THREE.Vector3(-346, 23, 58),
  new THREE.Vector3(-316, 10, -112),
  new THREE.Vector3(-206, 3, -246),
];

export const TRACK_CURVE = new THREE.CatmullRomCurve3(
  TRACK_POINTS,
  true,
  'catmullrom',
  0.42,
);
TRACK_CURVE.arcLengthDivisions = 1600;

export function tangentFrame(t) {
  const point = TRACK_CURVE.getPointAt(t);
  const tangent = TRACK_CURVE.getTangentAt(t).normalize();
  const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
  if (side.lengthSq() < 0.5) side.set(1, 0, 0);
  const up = new THREE.Vector3().crossVectors(tangent, side).normalize();
  return { point, tangent, side, up };
}

export function matrixOnTrack(t, lateral = 0, vertical = 0, scale = new THREE.Vector3(1, 1, 1)) {
  const { point, tangent, side, up } = tangentFrame(t);
  const position = point.clone().addScaledVector(side, lateral).addScaledVector(up, vertical);
  const basis = new THREE.Matrix4().makeBasis(side, up, tangent);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis);
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

export function ribbonGeometry(inner, outer, vertical = 0, samples = TRACK_SAMPLES, colors = null) {
  const positions = [];
  const uvs = [];
  const vertexColors = [];
  const indices = [];
  const colorA = new THREE.Color(colors?.[0] ?? 0xffffff);
  const colorB = new THREE.Color(colors?.[1] ?? colors?.[0] ?? 0xffffff);

  for (let i = 0; i <= samples; i += 1) {
    const t = (i % samples) / samples;
    const { point, side, up } = tangentFrame(t);
    const a = point.clone().addScaledVector(side, inner).addScaledVector(up, vertical);
    const b = point.clone().addScaledVector(side, outer).addScaledVector(up, vertical);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    uvs.push(0, i * 0.42, 1, i * 0.42);
    const shade = 0.94 + 0.06 * Math.sin(i * 0.37);
    vertexColors.push(
      colorA.r * shade, colorA.g * shade, colorA.b * shade,
      colorB.r * shade, colorB.g * shade, colorB.b * shade,
    );
    if (i < samples) {
      const n = i * 2;
      indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
