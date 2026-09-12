import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createScenicWorld, SCENIC_TRACK_CURVES, createClearanceField } from '../src/scenic-worlds.js';
import { TRACK_CURVE } from '../src/world.js';
import { DAY_TRACK_CURVE } from '../src/day-world.js';
import { CANDY_TRACK_CURVE } from '../src/candy-world.js';
import { CANDY_KINGDOM_TRACK_CURVE } from '../src/candy-kingdom-world.js';
import { computeTrackFeatures, featureZonesForPhysics } from '../src/track-features.js';
import { buildCornerMarkers } from '../src/track-guidance.js';
import { createTrackVariantCurve } from '../src/track-variant.js';

const results = [];
for (const [id, curve] of Object.entries(SCENIC_TRACK_CURVES)) {
  const zones = featureZonesForPhysics(computeTrackFeatures(curve, { trackId: id }));
  for (const qualityTier of ['balanced', 'high']) {
    const scene = new THREE.Scene();
    const world = createScenicWorld(scene, id, { qualityTier, shortcutZones: zones.shortcuts });
    let minimumClearance = Infinity;
    for (let i = 0; i < 1000; i += 1) {
      const point = curve.getPointAt(i / 1000);
      const tangent = curve.getTangentAt(i / 1000);
      const side = new THREE.Vector3(tangent.z, 0, -tangent.x).normalize();
      for (const lateral of [-8, 0, 8]) {
        const p = point.clone().addScaledVector(side, lateral);
        const gap = p.y - world.terrain.heightAt(p.x, p.z);
        minimumClearance = Math.min(minimumClearance, gap);
        assert.ok(gap > 0.1, `${id}/${qualityTier}: terrain intersects the road at ${i / 1000}, offset ${lateral}: ${gap}`);
      }
    }
    for (const shortcut of zones.shortcuts) {
      for (let i = 1; i < shortcut.points.length; i += 1) {
        const a = shortcut.points[i - 1];
        const b = shortcut.points[i];
        const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize();
        for (let step = 0; step <= 8; step += 1) {
          for (const lateral of [-shortcut.halfWidth, 0, shortcut.halfWidth]) {
            const p = new THREE.Vector3().copy(a).lerp(b, step / 8).addScaledVector(side, lateral);
            assert.ok(world.terrain.heightAt(p.x, p.z) < p.y - 0.1, `${id}: terrain buries a shortcut`);
          }
        }
      }
    }
    scene.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    for (const [x, z] of [[63, 99], [-213, -148], [319, -237]]) {
      ray.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(world.ground)[0];
      assert.ok(hit && Math.abs(hit.point.y - world.terrain.heightAt(x, z)) < 0.001, 'prop height must match rendered triangles');
    }
    const trunks = world.world.getObjectByName('GroundedTreeTrunks');
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (let i = 0; i < trunks.count; i += 1) {
      trunks.getMatrixAt(i, matrix);
      position.setFromMatrixPosition(matrix);
      const gap = world.terrain.heightAt(position.x, position.z) - position.y;
      assert.ok(gap >= 0 && gap < 0.5, `${id}: tree trunk is not rooted in terrain`);
    }
    const rails = world.world.getObjectByName('ContinuousGuardrails');
    assert.ok(rails.count > 600 && rails.userData.segmentLength <= 4.01, 'guardrails must follow the road in short continuous sections');
    for (const variant of ['normal', 'mirror']) {
      world.world.scale.x = variant === 'mirror' ? -1 : 1;
      const signs = buildCornerMarkers(createTrackVariantCurve(curve, variant), { ground: world.ground });
      const posts = signs.getObjectByName('CornerSignPosts');
      for (let i = 0; i < posts.count; i += 1) {
        posts.getMatrixAt(i, matrix);
        const foot = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
        const groundY = world.terrain.heightAt(variant === 'mirror' ? -foot.x : foot.x, foot.z);
        assert.ok(Math.abs(groundY - foot.y - 0.15) < 0.002, `${id}/${variant}: sign post must reach the rendered terrain`);
      }
      signs.traverse((object) => object.geometry?.dispose());
    }
    world.world.scale.x = 1;
    let triangles = 0;
    world.world.traverse((object) => {
      if (!object.isMesh) return;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
    });
    assert.ok(triangles < (qualityTier === 'balanced' ? 190000 : 380000), `${id}/${qualityTier}: scenery triangle budget exceeded: ${triangles}`);
    results.push({ id, qualityTier, minimumClearance: Number(minimumClearance.toFixed(2)), triangles });
    world.world.traverse((object) => object.geometry?.dispose());
  }
}

const curves = { night: TRACK_CURVE, day: DAY_TRACK_CURVE, ...SCENIC_TRACK_CURVES, candy: CANDY_TRACK_CURVE, candyland: CANDY_KINGDOM_TRACK_CURVE };
for (const [id, source] of Object.entries(curves)) {
  for (const variant of ['normal', 'reverse', 'mirror']) {
    const curve = createTrackVariantCurve(source, variant);
    const zones = featureZonesForPhysics(computeTrackFeatures(curve, { trackId: id }));
    const clearance = createClearanceField(curve, { shortcutZones: zones.shortcuts });
    const markers = buildCornerMarkers(curve, { shortcutZones: zones.shortcuts });
    assert.ok(markers.userData.placements.length > 0, `${id}/${variant}: missing corner guidance`);
    const arrows = markers.getObjectByName('CornerDirectionArrows');
    for (const [index, placement] of markers.userData.placements.entries()) {
      assert.ok(clearance.clears(placement.position.x, placement.position.z, 1.6, 0.6), `${id}/${variant}: marker blocks a driving corridor`);
      const matrix = new THREE.Matrix4();
      arrows.getMatrixAt(index, matrix);
      const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
      assert.ok(normal.dot(placement.tangent) < -0.99, 'arrow face must point toward the approaching driver');
      const arrowTip = new THREE.Vector3(1, 0, 0).transformDirection(matrix);
      const screenRight = new THREE.Vector3().crossVectors(placement.tangent, new THREE.Vector3(0, 1, 0));
      assert.equal(arrowTip.dot(screenRight) > 0, placement.direction === 'right', '3D arrow must match the HUD direction');
    }
  }
}
console.log(JSON.stringify({ terrain: results, cornerGuidance: '7 maps x 3 directions passed' }, null, 2));
