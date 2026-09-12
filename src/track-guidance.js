import * as THREE from 'three';
import { turnDirection } from './route-navigator.js';
import { createClearanceField, createShortcutMask, markClearanceExempt, CLEARANCE_EXEMPT } from './scenic-worlds.js';

const UP = new THREE.Vector3(0, 1, 0);
const wrap = (value) => THREE.MathUtils.euclideanModulo(value, 1);

export function planCornerMarkers(curve, { shortcutZones = [] } = {}) {
  const length = curve.getLength();
  const samples = Math.ceil(length / 8);
  const candidates = [];
  const clearance = createClearanceField(curve, { shortcutZones });
  const openings = createShortcutMask(shortcutZones);
  for (let i = 0; i < samples; i += 1) {
    const t = i / samples;
    const before = curve.getTangentAt(wrap(t - 22 / length));
    const after = curve.getTangentAt(wrap(t + 22 / length));
    const delta = Math.atan2(after.x, after.z) - Math.atan2(before.x, before.z);
    const angle = Math.atan2(Math.sin(delta), Math.cos(delta));
    if (Math.abs(angle) > 0.28) candidates.push({ progress: t, angle });
  }
  candidates.sort((a, b) => Math.abs(b.angle) - Math.abs(a.angle));
  const corners = [];
  for (const candidate of candidates) {
    if (corners.some((corner) => Math.min(wrap(corner.progress - candidate.progress), wrap(candidate.progress - corner.progress)) * length < 100)) continue;
    corners.push(candidate);
  }
  return corners.sort((a, b) => a.progress - b.progress).flatMap((corner) => {
    const side = -Math.sign(corner.angle);
    return [-16, 0, 16].flatMap((offset) => {
      const progress = wrap(corner.progress + offset / length);
      if (openings.isOpen(progress, side)) return [];
      const point = curve.getPointAt(progress);
      const tangent = curve.getTangentAt(progress).setY(0).normalize();
      const lateral = new THREE.Vector3().crossVectors(UP, tangent).normalize();
      const position = point.clone().addScaledVector(lateral, side * 11.7);
      if (!clearance.clears(position.x, position.z, 1.6, 0.6)) return [];
      return [{ progress, position, tangent, side, direction: turnDirection(corner.angle), angle: corner.angle }];
    });
  });
}

export function buildCornerMarkers(curve, options = {}) {
  const placements = planCornerMarkers(curve, options);
  const group = new THREE.Group();
  group.name = 'CornerGuidance';
  group.userData.placements = placements;
  const dark = new THREE.MeshStandardMaterial({ color: 0x202a2b, metalness: 0.3, roughness: 0.7 });
  const colors = { night: 0x62e9ee, alpine: 0x8fe8ef, candy: 0xffe695, candyland: 0xffe695 };
  const accent = colors[options.theme] ?? 0xffd469;
  const reflective = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.32, roughness: 0.5 });
  const boards = new THREE.InstancedMesh(new THREE.BoxGeometry(2.65, 1.65, 0.14), dark, placements.length);
  boards.name = 'CornerSignBoards';
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), dark, placements.length);
  posts.name = 'CornerSignPosts';
  const groundSurfaces = [];
  options.ground?.updateWorldMatrix(true, true);
  options.ground?.traverse((object) => {
    if (object.isMesh && !object.isInstancedMesh
      && (object === options.ground || object.userData.clearanceExempt === CLEARANCE_EXEMPT.TERRAIN)) {
      groundSurfaces.push(object);
    }
  });
  const groundRay = new THREE.Raycaster();
  groundRay.ray.direction.set(0, -1, 0);
  const shape = new THREE.Shape([
    new THREE.Vector2(-0.67, -0.63), new THREE.Vector2(-0.1, -0.63),
    new THREE.Vector2(0.65, 0), new THREE.Vector2(-0.1, 0.63),
    new THREE.Vector2(-0.67, 0.63), new THREE.Vector2(0.08, 0),
  ]);
  const arrows = new THREE.InstancedMesh(new THREE.ShapeGeometry(shape), reflective, placements.length);
  arrows.name = 'CornerDirectionArrows';
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3(1, 1, 1);
  for (const [index, marker] of placements.entries()) {
    quaternion.setFromAxisAngle(UP, Math.atan2(-marker.tangent.x, -marker.tangent.z));
    position.copy(marker.position).addScaledVector(UP, 2.7);
    matrix.compose(position, quaternion, scale.set(1, 1, 1));
    boards.setMatrixAt(index, matrix);
    position.addScaledVector(marker.tangent, -0.085);
    // Rotate in the board plane; negative instance scales invert face winding.
    const arrowRotation = quaternion.clone();
    if (marker.direction === 'left') arrowRotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    matrix.compose(position, arrowRotation, scale);
    arrows.setMatrixAt(index, matrix);
    // Sample the rendered surface, including mirrored worlds, once at build time.
    // Road height alone leaves the posts floating above sloped verges.
    groundRay.ray.origin.copy(marker.position).addScaledVector(UP, 0.1);
    const groundHit = groundRay.intersectObjects(groundSurfaces, false)[0];
    const bottom = (groundHit?.point.y ?? marker.position.y) - 0.15;
    const top = marker.position.y + 2.25;
    position.copy(marker.position).setY((bottom + top) * 0.5);
    matrix.compose(position, quaternion, scale.set(1, top - bottom, 1));
    posts.setMatrixAt(index, matrix);
  }
  boards.castShadow = options.qualityTier !== 'balanced';
  group.add(boards, posts, arrows);
  markClearanceExempt(group, CLEARANCE_EXEMPT.FURNITURE);
  return group;
}
