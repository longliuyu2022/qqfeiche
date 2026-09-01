import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { createKartCollisionSystem } from '../src/kart-collision.js';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 100),
  new THREE.Vector3(100, 0, 0),
  new THREE.Vector3(0, 0, -100),
  new THREE.Vector3(-100, 0, 0),
], true, 'catmullrom', 0.5);

function makePlayer() {
  const player = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
  player.position.set(0, 0, 0);
  player.heading = 0;
  player.velocity.set(0, 0, 32);
  player.startRace();
  return player;
}

function makeRival({ x = 0, z = 3.2, yaw = Math.PI, speed = 22 } = {}) {
  const object = new THREE.Group();
  object.position.set(x, 0, z);
  object.rotation.y = yaw;
  object.visible = true;
  return { id: 'rival-1', object, speed, lane: 0, targetLane: 0 };
}

const player = makePlayer();
const rival = makeRival();
let events = 0;
const collisions = createKartCollisionSystem({
  player,
  rivals: [rival],
  trackCurve: curve,
  onCollision: () => { events += 1; },
});
const beforeSpeed = player.velocity.length();
const hit = collisions.update(1 / 60);
assert.equal(hit.length, 1, 'overlapping karts should collide');
assert.ok(hit[0].headOnRatio > 0.9, 'opposing headings should register a head-on hit');
assert.equal(hit[0].collisionType, 'head-on');
assert.ok(player.velocity.length() < beforeSpeed, 'a head-on impact should reduce player speed');
assert.ok(rival.speed < 22, 'the AI kart should also lose speed');
assert.equal(player.state.collisionCount, 1);
assert.equal(events, 1);

player.position.set(0, 0, 0);
rival.object.position.set(0, 0, 3.2);
assert.equal(collisions.update(1 / 60).length, 0, 'contact cooldown should suppress repeated frame hits');
player.position.set(0, 0, 0);
rival.object.position.set(0, 0, 3.2);
assert.equal(collisions.update(0.35).length, 1, 'contact should be allowed again after cooldown');

const sidePlayer = makePlayer();
const sideRival = makeRival({ x: 3.1, z: 0, yaw: 0, speed: 15 });
const sideSystem = createKartCollisionSystem({ player: sidePlayer, rivals: [sideRival], trackCurve: curve });
const yawBefore = sidePlayer.yawRate;
const lateralBefore = sidePlayer.velocity.x;
const sideHits = sideSystem.update(1 / 60);
assert.equal(sideHits.length, 1);
assert.ok(Math.abs(sidePlayer.yawRate - yawBefore) > 0.01, 'side contact should disturb steering');
assert.ok(Math.abs(sidePlayer.velocity.x - lateralBefore) > 0.1, 'side contact should add lateral velocity');

const disabledPlayer = makePlayer();
const disabledRival = makeRival();
const disabled = createKartCollisionSystem({
  player: disabledPlayer,
  rivals: [disabledRival],
  isEnabled: () => false,
});
assert.deepEqual(disabled.update(1 / 60), [], 'normal race mode should leave kart contacts disabled');

console.log(JSON.stringify({ headOn: 'ok', sideImpact: 'ok', cooldown: 'ok', modeGate: 'ok' }));
