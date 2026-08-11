import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { ItemRaceSystem } from '../src/item-race.js';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 60),
  new THREE.Vector3(60, 0, 0),
  new THREE.Vector3(0, 0, -60),
  new THREE.Vector3(-60, 0, 0),
], true, 'catmullrom', 0.5);
const scene = new THREE.Scene();
const player = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
const rival = {
  object: new THREE.Group(),
  baseSpeed: 60,
  speed: 60,
  raceProgress: 0.12,
  lane: 0,
  targetLane: 0,
  finished: false,
};
scene.add(rival.object);
const items = new ItemRaceSystem({
  scene,
  player,
  rivals: [rival],
  trackCurve: curve,
  pickups: [[0.08, 0]],
  random: () => 0,
});
items.reset({ enabled: true });

const pickup = items.pickups[0];
player.position.copy(pickup.object.position);
player.position.y = 0;
items.update(1 / 60, { racing: true });
assert.equal(items.inventory, 'turbo', 'driving through an item box should fill the item slot');
assert.equal(pickup.active, false, 'a collected box should enter its respawn cooldown');

player.nitro = 10;
assert.equal(items.useItem(), true);
assert.ok(player.nitro >= 52, 'nitro bottle should refill a meaningful amount');
assert.equal(items.inventory, null, 'using an item should clear the slot');

items.inventory = 'shield';
items.useItem();
assert.equal(items.shieldTime, 7, 'shield should become active immediately');
rival.itemInventory = 'emp';
rival.itemPickupTimer = 9;
rival.raceProgress = player.state.lapsCompleted + player.state.lapProgress - 0.05;
items.update(1 / 60, { racing: true });
assert.equal(items.playerSlowTime, 0, 'an active shield should block an AI attack');
assert.ok(items.shieldTime < 7, 'blocking an attack should consume shield energy');

items.inventory = 'emp';
rival.raceProgress = player.state.lapsCompleted + player.state.lapProgress + 0.05;
items.useItem();
assert.ok(rival.itemSlowTime > 3, 'EMP should slow the nearest rival ahead');

console.log(JSON.stringify({ pickup: 'ok', turbo: 'ok', shield: 'ok', emp: 'ok' }));
