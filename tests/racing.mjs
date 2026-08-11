import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';
import { RaceSystem } from '../src/race-system.js';

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, 90),
  new THREE.Vector3(90, 0, 0),
  new THREE.Vector3(0, 0, -90),
  new THREE.Vector3(-90, 0, 0),
], true, 'catmullrom', 0.5);

function moveAlongCurve(vehicle, laps, stepsPerLap = 360) {
  for (let step = 1; step <= laps * stepsPerLap + 3; step += 1) {
    const progress = (step % stepsPerLap) / stepsPerLap;
    const tangent = curve.getTangentAt(progress).setY(0).normalize();
    vehicle.position.copy(curve.getPointAt(progress));
    vehicle.heading = Math.atan2(tangent.x, tangent.z);
    vehicle.velocity.copy(tangent).multiplyScalar(24);
    vehicle.update(0.001);
  }
}

const checkpointCar = new ArcadeVehicle({
  trackCurve: curve,
  trackWidth: 16,
  totalLaps: 2,
  checkpointCount: 12,
});
let checkpointEvents = 0;
let lapEvents = 0;
checkpointCar.on('checkpoint', () => { checkpointEvents += 1; });
checkpointCar.on('lap', () => { lapEvents += 1; });
checkpointCar.startRace();
moveAlongCurve(checkpointCar, 2);
assert.equal(checkpointEvents, 24, 'all continuous checkpoints should be crossed');
assert.equal(lapEvents, 2, 'each valid checkpoint sequence should complete one lap');
assert.equal(checkpointCar.state.raceStatus, 'finished');
assert.equal(checkpointCar.result.status, 'finished');

const shortcutCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16, checkpointCount: 12 });
shortcutCar.startRace();
shortcutCar.position.copy(curve.getPointAt(0.25));
shortcutCar.velocity.copy(curve.getTangentAt(0.25)).multiplyScalar(20);
shortcutCar.update(1 / 60);
assert.equal(shortcutCar.state.shortcutStrikes, 1, 'skipping a checkpoint should flag a shortcut');
for (let step = 0; step < 70; step += 1) shortcutCar.update(1 / 60);
assert.equal(shortcutCar.state.respawnCount, 1, 'a shortcut should respawn at the last valid gate');
assert.equal(shortcutCar.state.routeValid, true);

const collisionCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
collisionCar.startRace();
const collisionSample = collisionCar.sampleTrack();
collisionCar.position.copy(collisionSample.point).addScaledVector(collisionSample.normal, 12);
collisionCar.velocity.copy(collisionSample.normal).multiplyScalar(34);
collisionCar.update(1 / 60);
assert.equal(collisionCar.state.collisionCount, 1);
assert.ok(Math.abs(collisionCar.state.roadOffset) < 8.3, 'guardrail should contain the car body');
assert.ok(collisionCar.velocity.length() < 8, 'a head-on wall impact should significantly reduce speed');
assert.equal(collisionCar.state.respawnPending, true, 'a high-speed head-on impact should queue crash recovery');

const glancingCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
glancingCar.startRace();
const glancingSample = glancingCar.sampleTrack();
const glancingDirection = glancingSample.tangent.clone()
  .addScaledVector(glancingSample.normal, 2)
  .normalize();
glancingCar.position.copy(glancingSample.point).addScaledVector(glancingSample.normal, 12);
glancingCar.heading = Math.atan2(glancingDirection.x, glancingDirection.z);
glancingCar.velocity.copy(glancingDirection).multiplyScalar(30);
for (let frame = 0; frame < 180; frame += 1) {
  glancingCar.update(1 / 60, { throttle: 1 });
}
assert.ok(glancingCar.speed > 35, 'sustained throttle after an oblique wall contact should retain forward motion');
assert.ok(glancingCar.state.trackProgress > 0.1, 'an oblique wall contact should continue advancing around the track');
assert.equal(glancingCar.state.respawnPending, false, 'oblique wall contact should not trigger a crash respawn');
assert.equal(glancingCar.state.respawnCount, 0, 'an oblique wall contact should not stop and reset the car');

const skillCar = new ArcadeVehicle({ driftMinSpeed: 7 });
skillCar.startRace();
skillCar.nitro = 20;
let driftNitroReward = 0;
skillCar.on('driftEnd', ({ nitro }) => { driftNitroReward = nitro; });
for (let step = 0; step < 180; step += 1) skillCar.update(1 / 60, { throttle: 1 });
for (let step = 0; step < 60; step += 1) {
  skillCar.update(1 / 60, { throttle: 1, steer: 0.6, drift: 1 });
}
skillCar.update(1 / 60, { throttle: 1, steer: 0, drift: 0, nitro: 0 });
assert.ok(skillCar.score > 0, 'a sustained drift should bank skill points');
assert.ok(driftNitroReward >= 8, 'a sustained drift should visibly refill and bank nitro');
assert.ok(skillCar.nitro > 30, 'drifting should leave the car with more nitro than it started with');
assert.equal(skillCar.state.combo, 1);
skillCar.update(1 / 60, { throttle: 1, steer: 0, nitro: 1 });
assert.equal(skillCar.state.nitroChain, 1, 'boosting after a drift should consume a nitro link');

function makeRivalObject() {
  const object = new THREE.Group();
  object.userData.wheels = [new THREE.Group()];
  object.userData.nitroFlames = [new THREE.Group()];
  return object;
}

const racePlayer = new ArcadeVehicle({ trackCurve: curve, totalLaps: 1 });
const rivals = [
  { object: makeRivalObject(), speed: 58, lane: 0, totalProgress: -0.002, aggression: 0.8 },
  { object: makeRivalObject(), speed: 57, lane: 0.2, totalProgress: -0.006, aggression: 0.7 },
];
const race = new RaceSystem({
  player: racePlayer,
  rivals,
  trackCurve: curve,
  startProgress: 0,
  totalLaps: 1,
});
let overtakes = 0;
let defenses = 0;
race.on('overtake', () => { overtakes += 1; });
race.on('defend', () => { defenses += 1; });
racePlayer.startRace({ totalLaps: 1 });
race.start();
for (let step = 0; step < 240; step += 1) race.update(1 / 60);
assert.ok(overtakes > 0, 'AI should move off-line to overtake a slower nearby car');

const leader = rivals[0];
racePlayer.state.lapProgress = leader.raceProgress - 8 / race.trackLength;
racePlayer.state.speedMps = leader.speed + 8;
leader.maneuverTime = 0;
leader.maneuverCooldown = 0;
for (let step = 0; step < 5; step += 1) race.update(1 / 60);
assert.ok(defenses > 0, 'AI should cover the lane when the player closes from behind');

racePlayer.state.finished = true;
racePlayer.state.raceStatus = 'finished';
racePlayer.state.result = { status: 'finished', totalTime: 43, penaltyTime: 2, finalTime: 45 };
race.update(1 / 60);
assert.equal(race.state.result.entrants, 3);
assert.ok(race.state.result.position >= 1 && race.state.result.position <= 3);
assert.equal(race.state.result.standings.length, 3);
const resultPosition = race.state.result.position;

race.configure({ totalLaps: 1, rivalCount: 0 });
assert.equal(race.totalLaps, 1);
assert.equal(race.state.entrantCount, 1);
assert.equal(race.getStandings().length, 1);

console.log(JSON.stringify({
  checkpoints: checkpointEvents,
  laps: lapEvents,
  shortcutRespawns: shortcutCar.state.respawnCount,
  collisions: collisionCar.state.collisionCount,
  skillScore: skillCar.score,
  nitroChain: skillCar.state.nitroChain,
  driftNitroReward,
  aiOvertakes: overtakes,
  aiDefenses: defenses,
  resultPosition,
}));
