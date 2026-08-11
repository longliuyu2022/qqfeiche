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

const boostCar = new ArcadeVehicle({ driftMinSpeed: 7 });
boostCar.startRace();
let miniBoosts = 0;
let doubleBoosts = 0;
boostCar.on('miniBoost', () => { miniBoosts += 1; });
boostCar.on('doubleBoost', () => { doubleBoosts += 1; });
for (let step = 0; step < 180; step += 1) boostCar.update(1 / 60, { throttle: 1 });
for (let step = 0; step < 60; step += 1) {
  boostCar.update(1 / 60, { throttle: 1, steer: 0.6, drift: 1 });
}
assert.ok(boostCar.state.chargeLevel >= 1, 'a sustained drift should raise the spark charge tier');
boostCar.update(1 / 60, { throttle: 1, steer: 0, drift: 0 });
assert.equal(miniBoosts, 1, 'releasing a scored drift should fire an instant mini boost');
assert.ok(boostCar.state.miniBoostTime > 0, 'the mini boost should stay active after the drift release');
assert.equal(boostCar.state.miniBoostLevel, 1);
assert.equal(boostCar.state.boostChain, 1);
boostCar.nitro = 60;
boostCar.update(1 / 60, { throttle: 1, nitro: 1 });
assert.equal(doubleBoosts, 1, 'firing nitro during a mini boost should upgrade it to a double boost');
assert.equal(boostCar.state.miniBoostLevel, 2);
for (let step = 0; step < 40; step += 1) {
  boostCar.update(1 / 60, { throttle: 1, steer: -0.6, drift: 1 });
}
boostCar.update(1 / 60, { throttle: 1, steer: 0, drift: 0 });
assert.equal(boostCar.state.boostChain, 2, 'a second drift inside the combo window should extend the boost chain');

const launchCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
launchCar.startRace();
let launchEvents = 0;
launchCar.on('launchBoost', () => { launchEvents += 1; });
assert.equal(launchCar.primeLaunchBoost('perfect'), true);
assert.equal(launchEvents, 1);
assert.equal(launchCar.state.launchQuality, 'perfect');
assert.ok(launchCar.speed >= 8.5, 'a perfect launch should add an immediate speed impulse');
assert.equal(launchCar.state.miniBoostLevel, 2, 'a perfect launch should grant a double-grade boost');
assert.equal(launchCar.primeLaunchBoost('invalid'), false);

function chaseCenterline(vehicle) {
  const sample = vehicle.sampleTrack();
  if (!sample) return 0;
  const aheadX = sample.point.x + sample.tangent.x * 10 - vehicle.position.x;
  const aheadZ = sample.point.z + sample.tangent.z * 10 - vehicle.position.z;
  const desired = Math.atan2(aheadX, aheadZ);
  const error = ((desired - vehicle.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return THREE.MathUtils.clamp(error * 2.5, -1, 1);
}

const padCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
padCar.startRace();
padCar.setTrackFeatures({ pads: [{ id: 'pad-1', start: 0.02, end: 0.05, halfWidth: 6 }] });
let padBoosts = 0;
let padSpeedJump = 0;
let previousPadSpeed = 0;
padCar.on('padBoost', ({ state }) => {
  padBoosts += 1;
  padSpeedJump = state.speedMps - previousPadSpeed;
});
for (let step = 0; step < 420 && padCar.state.trackProgress < 0.09; step += 1) {
  previousPadSpeed = padCar.state.speedMps;
  padCar.update(1 / 60, { throttle: 1, steer: chaseCenterline(padCar) });
}
assert.equal(padBoosts, 1, 'driving across a boost pad should trigger it exactly once');
assert.ok(padSpeedJump > 3, 'a boost pad should add an immediate speed impulse');

const rampCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16 });
rampCar.startRace();
rampCar.setTrackFeatures({ ramps: [{ id: 'ramp-1', start: 0.12, end: 0.15, height: 2.6, halfWidth: 6 }] });
let rampLaunches = 0;
let rampLandings = 0;
let maxAirHeight = 0;
rampCar.on('rampLaunch', () => { rampLaunches += 1; });
rampCar.on('landingBoost', () => { rampLandings += 1; });
for (let step = 0; step < 1200 && rampLandings === 0; step += 1) {
  rampCar.update(1 / 60, { throttle: 1, steer: chaseCenterline(rampCar) });
  if (rampCar.state.airborne) {
    const rampSample = rampCar.sampleTrack();
    if (rampSample) maxAirHeight = Math.max(maxAirHeight, rampCar.position.y - rampSample.point.y);
  }
}
assert.equal(rampLaunches, 1, 'crossing the ramp lip at speed should launch the car');
assert.ok(maxAirHeight > 2, 'the launch should climb above the ramp lip');
assert.equal(rampLandings, 1, 'landing with throttle held should grant a landing boost');
assert.ok(rampCar.state.miniBoostTime > 0, 'the landing boost should be active right after touchdown');
assert.equal(rampCar.state.airborne, false);
assert.equal(rampCar.state.shortcutStrikes, 0, 'flying over the ramp should not be flagged as a shortcut');

// A shortcut corridor that cuts the corner between t=0.10 and t=0.30.
const shortcutPoints = [];
const shortcutStart = 0.1;
const shortcutEnd = 0.3;
for (let sample = 0; sample <= 14; sample += 1) {
  const u = sample / 14;
  const arcPoint = curve.getPointAt(shortcutStart + (shortcutEnd - shortcutStart) * u);
  const chordPoint = curve.getPointAt(shortcutStart).clone().lerp(curve.getPointAt(shortcutEnd), u);
  shortcutPoints.push(arcPoint.clone().lerp(chordPoint, 0.86 * Math.sin(Math.PI * u)));
}
const branchSide = (() => {
  const mid = shortcutPoints[7];
  const arcMid = curve.getPointAt((shortcutStart + shortcutEnd) / 2);
  const tangent = curve.getTangentAt((shortcutStart + shortcutEnd) / 2).setY(0).normalize();
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tangent).normalize();
  return Math.sign(mid.clone().sub(arcMid).dot(side)) || 1;
})();
const shortcutZone = {
  id: 'sc-1',
  start: shortcutStart,
  end: shortcutEnd,
  side: branchSide,
  halfWidth: 5.4,
  savedMeters: 18,
  points: shortcutPoints.map((point) => ({ x: point.x, y: point.y, z: point.z })),
};

const branchCar = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16, checkpointCount: 12 });
branchCar.setTrackFeatures({ shortcuts: [shortcutZone] });
branchCar.startRace();
let shortcutEnters = 0;
let shortcutExits = 0;
branchCar.on('shortcutEnter', () => { shortcutEnters += 1; });
branchCar.on('shortcutExit', () => { shortcutExits += 1; });
// Enter the branch at its mouth, already committed to the shortcut side.
const mouth = shortcutPoints[0];
const mouthTangent = curve.getTangentAt(shortcutStart).setY(0).normalize();
const towardBranch = shortcutPoints[2].clone().sub(shortcutPoints[0]).setY(0).normalize();
branchCar.position.copy(mouth).addScaledVector(
  new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), mouthTangent).normalize(),
  branchSide * 5.2,
);
branchCar.heading = Math.atan2(towardBranch.x, towardBranch.z);
branchCar.velocity.copy(towardBranch).multiplyScalar(42);

function steerAlongBranch(car) {
  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < shortcutPoints.length; index += 1) {
    const point = shortcutPoints[index];
    const distance = Math.hypot(point.x - car.position.x, point.z - car.position.z);
    if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
  }
  const next = shortcutPoints[Math.min(shortcutPoints.length - 1, closestIndex + 2)];
  const desired = Math.atan2(next.x - car.position.x, next.z - car.position.z);
  const error = ((desired - car.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return THREE.MathUtils.clamp(error * 2.6, -1, 1);
}

let maxLateralFromLine = 0;
for (let step = 0; step < 900 && shortcutExits === 0; step += 1) {
  branchCar.update(1 / 60, { throttle: 1, steer: steerAlongBranch(branchCar) });
  if (branchCar.state.onShortcut) {
    maxLateralFromLine = Math.max(maxLateralFromLine, Math.abs(branchCar.sampleTrack().offset));
  }
}
assert.equal(shortcutEnters, 1, 'driving into the branch mouth should enter the shortcut');
assert.equal(shortcutExits, 1, 'reaching the end of the branch should rejoin the racing line');
assert.ok(maxLateralFromLine > 12, 'the shortcut should carry the car well off the racing line');
assert.equal(branchCar.state.onShortcut, false, 'the shortcut should be released after rejoining');
assert.equal(branchCar.state.shortcutStrikes, 0, 'a legal shortcut must not be judged as a cut course');
assert.equal(branchCar.state.respawnCount, 0, 'a legal shortcut must not force a respawn');
assert.ok(
  branchCar.state.checkpointsPassed >= 2,
  'checkpoints bypassed by the branch should still be credited',
);
assert.equal(branchCar.state.wrongWay, false, 'the branch direction must not read as wrong way');

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
  miniBoosts,
  doubleBoosts,
  boostChain: boostCar.state.boostChain,
  padBoosts,
  rampLaunches,
  rampLandings,
  shortcutEnters,
  shortcutExits,
  shortcutLateral: Number(maxLateralFromLine.toFixed(1)),
}));
