import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const smoothstep = THREE.MathUtils.smoothstep;

// A shared height field keeps the road, vegetation and streamed landmarks on
// the same surface. Include branch corridors so a hillside cannot bury a shortcut.
export function createScenicTerrain(curve, { groundBase = -5, shortcutZones = [], qualityTier = 'high' } = {}) {
  const segments = [];
  const append = (points, closed, halfWidth) => {
    for (let i = 0; i < points.length - (closed ? 0 : 1); i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      segments.push({ a, dx, dz, dy: b.y - a.y, lengthSq: dx * dx + dz * dz, halfWidth });
    }
  };
  append(Array.from({ length: 480 }, (_, i) => curve.getPointAt(i / 480)), true, 8);
  for (const zone of shortcutZones) {
    if (zone.points?.length > 1) append(zone.points, false, zone.halfWidth ?? (zone.width ?? 11) * 0.5);
  }
  const baseHeightAt = (x, z) => groundBase
    + Math.sin(x * 0.013) * 3.2 + Math.cos(z * 0.016) * 2.7
    + Math.sin((x - z) * 0.006) * Math.min(12, Math.hypot(x, z) * 0.015);

  function heightAt(x, z) {
    let nearestSq = Infinity;
    let roadHeight = groundBase;
    let halfWidth = 8;
    let ceiling = Infinity;
    for (const segment of segments) {
      const u = clamp(((x - segment.a.x) * segment.dx + (z - segment.a.z) * segment.dz) / (segment.lengthSq || 1), 0, 1);
      const px = x - segment.a.x - segment.dx * u;
      const pz = z - segment.a.z - segment.dz * u;
      const distanceSq = px * px + pz * pz;
      const y = segment.a.y + segment.dy * u;
      if (distanceSq < nearestSq) {
        nearestSq = distanceSq;
        roadHeight = y;
        halfWidth = segment.halfWidth;
      }
      if (distanceSq < (segment.halfWidth + 15) ** 2) ceiling = Math.min(ceiling, y - 2.4);
    }
    const distance = Math.sqrt(nearestSq);
    const base = baseHeightAt(x, z);
    const blend = smoothstep(distance, halfWidth + 15, 125);
    const relief = Math.sin(x * 0.041 + z * 0.023) * Math.cos(z * 0.047) * 3 * blend * (1 - blend);
    return Math.min(ceiling, THREE.MathUtils.lerp(roadHeight - 2.4, base, blend) + relief);
  }

  const size = 1450;
  const divisions = qualityTier === 'balanced' ? 144 : qualityTier === 'ultra' ? 240 : 192;
  const geometry = new THREE.PlaneGeometry(size, size, divisions, divisions);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)));
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // Match the triangles of PlaneGeometry, rather than rooting props on an
  // analytic surface that can sit above the actual low-quality terrain mesh.
  function surfaceHeightAt(x, z) {
    const gx = clamp((x + size / 2) / size * divisions, 0, divisions - 1e-7);
    const gz = clamp((z + size / 2) / size * divisions, 0, divisions - 1e-7);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const u = gx - ix;
    const v = gz - iz;
    const a = iz * (divisions + 1) + ix;
    const b = a + divisions + 1;
    return u + v <= 1
      ? positions.getY(a) * (1 - u - v) + positions.getY(a + 1) * u + positions.getY(b) * v
      : positions.getY(b + 1) * (u + v - 1) + positions.getY(b) * (1 - u) + positions.getY(a + 1) * (1 - v);
  }
  return { geometry, heightAt: surfaceHeightAt, baseHeightAt };
}

const RELIEF_COLORS = {
  alpine: [0x576875, 0x84959c, 0xe4f1f3],
  canyon: [0x784339, 0xc08058, 0xe3b67e],
  coast: [0x788e88, 0xbcc4b3, 0x557d4b],
};

export function createReliefGeometry(kind, { variant = 0, qualityTier = 'high' } = {}) {
  const segments = qualityTier === 'balanced' ? 24 : 40;
  const rings = qualityTier === 'balanced' ? 14 : 22;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  const palette = RELIEF_COLORS[kind].map((color) => new THREE.Color(color));
  const color = new THREE.Color();
  const phase = variant * 2.37;
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = segment / segments * Math.PI * 2;
      const ridge = Math.sin(angle * 3 + phase) * 0.1 + Math.cos(angle * 7 - phase) * 0.065;
      let radius;
      let y;
      if (kind === 'alpine') {
        radius = Math.pow(1 - t, 0.78) * (1 + ridge * (0.8 + t));
        y = t * (0.83 + Math.sin(angle * 3 + phase + t * 2) * 0.14 * Math.sin(Math.PI * t));
      } else {
        const top = kind === 'canyon' ? 0.78 : 0.65;
        const wall = Math.min(t / top, 1);
        const cap = Math.max(0, (t - top) / (1 - top));
        const strata = Math.sin(wall * Math.PI * 10 + phase) * 0.025;
        radius = (1 - wall * (kind === 'canyon' ? 0.3 : 0.4) + strata + ridge * 0.75) * (1 - cap);
        y = Math.min(t / top, 1) * (0.88 + Math.sin(angle * 3 + phase) * 0.065) + cap * 0.04;
      }
      if (ring === rings) { radius = 0; y = kind === 'alpine' ? 0.98 : 0.94; }
      const x = Math.cos(angle) * radius + Math.sin(t * 2.3 + phase) * t * 0.12;
      const z = Math.sin(angle) * radius + Math.cos(t * 3 + phase) * t * 0.09;
      positions.push(x, y, z);
      uvs.push(segment / segments * 3, t * 2);
      if (kind === 'alpine') {
        const snow = smoothstep(t + ridge * 0.75, 0.49, 0.78);
        color.copy(palette[0]).lerp(palette[1], t * 0.5).lerp(palette[2], snow);
      } else if (kind === 'canyon') {
        const band = Math.sin(t * 48 + Math.sin(angle * 3 + phase) * 0.9);
        color.copy(palette[0]).lerp(palette[1], 0.48 + band * 0.27);
        color.lerp(palette[2], smoothstep(band, 0.65, 0.93) * 0.65);
      } else {
        color.copy(palette[0]).lerp(palette[1], smoothstep(t, 0.04, 0.4));
        color.lerp(palette[2], smoothstep(t, 0.65, 0.85));
      }
      color.multiplyScalar(0.93 + Math.sin(angle * 11 + t * 27 + phase) * 0.07);
      colors.push(color.r, color.g, color.b);
      if (ring < rings && segment < segments) {
        const a = ring * (segments + 1) + segment;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Close the UV seam in the lighting as well as in the positions.
  const normals = geometry.attributes.normal;
  const normal = new THREE.Vector3();
  for (let ring = 0; ring <= rings; ring += 1) {
    const a = ring * (segments + 1);
    const b = a + segments;
    normal.set(normals.getX(a) + normals.getX(b), normals.getY(a) + normals.getY(b), normals.getZ(a) + normals.getZ(b)).normalize();
    normals.setXYZ(a, normal.x, normal.y, normal.z);
    normals.setXYZ(b, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPalmCrownGeometry() {
  const positions = [];
  const indices = [];
  for (let leaf = 0; leaf < 9; leaf += 1) {
    const angle = leaf / 9 * Math.PI * 2;
    const start = positions.length / 3;
    for (let step = 0; step <= 8; step += 1) {
      const u = step / 8;
      const radius = u * (0.86 + (leaf % 3) * 0.07);
      const width = Math.sin(Math.PI * u) * 0.14;
      const y = Math.sin(u * Math.PI) * 0.38 - u * u * 0.3;
      for (const side of [-1, 1]) {
        positions.push(Math.cos(angle) * radius - Math.sin(angle) * width * side, y, Math.sin(angle) * radius + Math.cos(angle) * width * side);
      }
      if (step < 8) {
        const a = start + step * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
