import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { ItemRaceSystem, ITEM_DEFINITIONS, ITEM_TUNING, rollItemForRank } from '../src/item-race.js';

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

// --- rank-weighted item distribution -----------------------------------------------------------
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function tally(rank, seed) {
  const random = makeLcg(seed);
  const counts = Object.fromEntries(Object.keys(ITEM_DEFINITIONS).map((id) => [id, 0]));
  for (let draw = 0; draw < 1000; draw += 1) {
    counts[rollItemForRank(rank, { entrantCount: 6, random })] += 1;
  }
  return counts;
}
const frontCounts = tally(1, 20260811);
const rearCounts = tally(6, 20260811);
for (const id of Object.keys(ITEM_DEFINITIONS)) {
  assert.ok(frontCounts[id] > 0 && rearCounts[id] > 0, `${id} should stay in both pools`);
}
assert.ok(
  rearCounts.missile > frontCounts.missile * 3,
  `P6 should draw far more missiles than P1 (${rearCounts.missile} vs ${frontCounts.missile})`,
);
assert.ok(rearCounts.missile / 1000 > 0.15, 'P6 missile rate should be high');
assert.ok(frontCounts.missile / 1000 < 0.1, 'P1 missile rate should be low');
assert.ok(
  frontCounts.shield + frontCounts.banana > rearCounts.shield + rearCounts.banana,
  'front-runners should lean defensive',
);

// shared event log for the combat scenarios below
const strikes = [];
const hits = [];
const explosions = [];
items.on('strike', (payload) => strikes.push(payload));
items.on('hit', (payload) => hits.push(payload));
items.on('explosion', (payload) => explosions.push(payload));
const wrapT = (value) => ((value % 1) + 1) % 1;
const playerRaceProgress = player.state.lapsCompleted + player.state.lapProgress;

// --- missile: chase and hit --------------------------------------------------------------------
rival.itemInventory = null;
rival.itemPickupTimer = 999;
rival.raceProgress = playerRaceProgress + 25 / items.trackLength;
rival.speed = 20;
rival.itemShieldTime = 0;
rival.itemSlowTime = 0;
rival.itemSpinTime = 0;
items.inventory = 'missile';
assert.equal(items.useItem(), true);
assert.equal(items.getProjectiles().length, 1, 'missile should be in flight after use');
assert.equal(items.getProjectiles()[0].type, 'missile');
assert.ok(Number.isFinite(items.getProjectiles()[0].position.x), 'projectiles expose world coordinates');
assert.ok(Number.isFinite(items.getProjectiles()[0].heading));
for (let step = 0; step < 240 && items.getProjectiles().length; step += 1) {
  items.update(1 / 60, { racing: true });
}
assert.equal(items.getProjectiles().length, 0, 'missile should resolve within its lifetime');
assert.equal(strikes.length, 1, 'missile hit should emit a strike event');
assert.equal(strikes[0].item, 'missile');
assert.equal(strikes[0].blocked, false);
assert.ok(rival.speed <= 20 * ITEM_TUNING.missile.slowFactor + 1e-6, 'missile should crush target speed');
assert.ok(rival.itemSpinTime > 0.9, 'missile hit should send the target spinning');

// --- missile: shield absorbs the hit -----------------------------------------------------------
rival.itemShieldTime = 5;
rival.itemSlowTime = 0;
rival.itemSpinTime = 0;
rival.speed = 40;
items.inventory = 'missile';
items.useItem();
for (let step = 0; step < 240 && items.getProjectiles().length; step += 1) {
  items.update(1 / 60, { racing: true });
}
assert.equal(strikes.length, 2);
assert.equal(strikes[1].blocked, true, 'shielded target should block the missile');
assert.equal(rival.itemShieldTime, 0, 'blocking a missile should consume the whole shield');
assert.equal(rival.speed, 40, 'a blocked missile should not slow the target');

// --- missile: no target ahead -> free flight, then self-destructs ------------------------------
const useEvents = [];
const offUse = items.on('use', (payload) => useEvents.push(payload));
rival.raceProgress = playerRaceProgress - 40 / items.trackLength;
items.inventory = 'missile';
items.useItem();
assert.equal(useEvents.at(-1).affected, 0, 'leader gets no lock when nobody is ahead');
assert.equal(items.getProjectiles().length, 1, 'unguided missile still launches');
let freeSteps = 0;
while (items.getProjectiles().length && freeSteps < 240) {
  items.update(1 / 60, { racing: true });
  freeSteps += 1;
}
assert.equal(items.getProjectiles().length, 0, 'unguided missile should self-destruct');
assert.ok(freeSteps >= 170, 'free flight should last about 3 seconds');
assert.equal(strikes.length, 2, 'free-flight missile hits nobody');
offUse();

// --- banana: placement, owner immunity, trigger ------------------------------------------------
items.shieldTime = 0;
items.playerSlowTime = 0;
items.playerSteerTime = 0;
items.inventory = 'banana';
items.useItem();
assert.equal(items.getHazards().length, 1, 'banana should be placed behind the player');
const bananaHazard = items.getHazards()[0];
assert.equal(bananaHazard.type, 'banana');
player.position.set(bananaHazard.position.x, bananaHazard.position.y, bananaHazard.position.z);
items.update(1 / 60, { racing: true });
assert.equal(items.getHazards().length, 1, 'placer should be immune for the first second');
assert.equal(items.playerSlowTime, 0, 'immune placer must not be slowed');
player.velocity.set(0, 0, 30);
let bananaSteps = 0;
while (items.getHazards().length && bananaSteps < 200) {
  items.update(1 / 60, { racing: true });
  bananaSteps += 1;
}
assert.equal(items.getHazards().length, 0, 'banana should disappear after triggering');
assert.equal(hits.length, 1);
assert.equal(hits[0].item, 'banana');
assert.equal(hits[0].blocked, false);
assert.ok(items.playerSlowTime >= 1.19, 'banana should slow the player for ~1.2s');
assert.ok(items.playerSteerTime > 0, 'banana should disturb the steering');
assert.ok(Math.abs(player.velocity.length() - 30 * ITEM_TUNING.banana.slowFactor) < 0.5);

// --- banana: a rival can slip on the player's banana immediately -------------------------------
items.inventory = 'banana';
items.useItem();
const secondBanana = items.getHazards()[0];
rival.itemShieldTime = 0;
rival.itemSlowTime = 0;
rival.itemSpinTime = 0;
rival.speed = 50;
rival.object.position.set(secondBanana.position.x, secondBanana.position.y, secondBanana.position.z);
items.update(1 / 60, { racing: true });
assert.equal(items.getHazards().length, 0, 'rival should trigger the banana');
assert.equal(strikes.length, 3);
assert.equal(strikes[2].item, 'banana');
assert.equal(strikes[2].blocked, false);
assert.ok(Math.abs(rival.speed - 50 * ITEM_TUNING.banana.slowFactor) < 1e-6, 'banana should slow the rival');

// --- bomb: area blast catches cars near the landing point only ---------------------------------
const landT = wrapT(player.progress + ITEM_TUNING.bomb.throwDistance / items.trackLength);
rival.object.position.copy(curve.getPointAt(landT));
rival.itemShieldTime = 0;
rival.itemSlowTime = 0;
rival.itemSpinTime = 0;
rival.speed = 50;
player.velocity.set(0, 0, 10);
items.inventory = 'bomb';
items.useItem();
assert.equal(items.getProjectiles().length, 1, 'bomb should fly to its landing point');
assert.equal(items.getProjectiles()[0].type, 'bomb');
let bombSteps = 0;
while (items.getProjectiles().length && bombSteps < 120) {
  items.update(1 / 60, { racing: true });
  bombSteps += 1;
}
assert.equal(explosions.length, 1, 'bomb should explode after its fuse');
assert.equal(explosions[0].item, 'bomb');
assert.equal(explosions[0].affected, 1, 'only the rival parked at the landing zone is in range');
assert.ok(Number.isFinite(explosions[0].position.x));
assert.ok(Math.abs(rival.speed - 50 * ITEM_TUNING.bomb.slowFactor) < 1e-6, 'bomb should halve rival speed');
assert.ok(rival.itemSlowTime >= 1.4, 'bomb slow should last ~1.5s');
assert.ok(Math.abs(player.velocity.length() - 10) < 1e-6, 'player far from the blast should be untouched');

// --- AI: fires a missile at a target ahead and the player spins out ----------------------------
rival.itemInventory = 'missile';
rival.itemPickupTimer = 999;
rival.itemSlowTime = 0;
rival.itemSpinTime = 0;
rival.itemBoostTime = 0;
rival.itemShieldTime = 0;
rival.speed = 40;
rival.raceProgress = playerRaceProgress - 30 / items.trackLength;
items.shieldTime = 0;
items.playerSlowTime = 0;
items.playerSpinTime = 0;
items.playerSteerTime = 0;
player.velocity.set(0, 0, 40);
const headingBefore = player.heading;
items.update(1 / 60, { racing: true });
assert.equal(rival.itemInventory, null, 'AI should launch the missile when a target is ahead');
assert.equal(items.getProjectiles().filter((entry) => entry.type === 'missile').length, 1);
let aiSteps = 0;
while (items.getProjectiles().length && aiSteps < 300) {
  items.update(1 / 60, { racing: true });
  aiSteps += 1;
}
assert.equal(hits.length, 2);
assert.equal(hits.at(-1).item, 'missile');
assert.equal(hits.at(-1).blocked, false);
assert.ok(items.playerSpinTime > 0.9, 'AI missile should spin the player out');
assert.ok(items.playerSlowTime >= 1.19);
assert.ok(player.velocity.length() < 40 * ITEM_TUNING.missile.slowFactor + 0.6);
items.update(1 / 60, { racing: true });
assert.notEqual(player.heading, headingBefore, 'spin state should rotate the player');

console.log(JSON.stringify({
  pickup: 'ok',
  turbo: 'ok',
  shield: 'ok',
  emp: 'ok',
  weights: 'ok',
  missile: 'ok',
  banana: 'ok',
  bomb: 'ok',
  aiMissile: 'ok',
}));
