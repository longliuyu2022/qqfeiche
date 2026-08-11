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
const trackLength = curve.getLength();
const FRAME = 1 / 60;
const metersToProgress = (meters) => meters / trackLength;

function makeRivalObject() {
  const object = new THREE.Group();
  object.userData.wheels = [new THREE.Group()];
  object.userData.nitroFlames = [new THREE.Group()];
  return object;
}

function makeRivals(count, { lanes } = {}) {
  return Array.from({ length: count }, (unused, index) => ({
    object: makeRivalObject(),
    progress: -0.0038 * (index + 1),
    totalProgress: -0.0038 * (index + 1),
    speed: 62 + index * 1.9,
    lane: lanes?.[index] ?? ((index % 2) * 2 - 1) * (1.7 + Math.floor(index / 2) * 0.35),
  }));
}

/** Race with the player parked far ahead so rival-vs-player logic stays inert. */
function makeRace({ rivalCount = 1, lanes, ...options } = {}) {
  const player = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16, totalLaps: 20 });
  const race = new RaceSystem({
    player,
    rivals: makeRivals(rivalCount, { lanes }),
    trackCurve: curve,
    startProgress: 0,
    trackWidth: 16,
    totalLaps: 20,
    ...options,
  });
  player.startRace({ totalLaps: 20 });
  race.start();
  return race;
}

function stepRace(race, frames, onFrame) {
  for (let frame = 0; frame < frames; frame += 1) {
    let leader = 0;
    for (const rival of race.rivals) leader = Math.max(leader, rival.raceProgress);
    // Keep the human half a lap up the road: rubber banding saturates, and the
    // separation / defend / overtake branches that involve the player stay off.
    race.player.state.lapsCompleted = Math.ceil(leader) + 1;
    race.player.state.lapProgress = 0.5;
    race.update(FRAME);
    if (onFrame?.(frame) === false) return frame + 1;
  }
  return frames;
}

const snapshot = (race) => race.rivals.map((rival) => ({
  raceProgress: rival.raceProgress,
  speed: rival.speed,
  lane: rival.lane,
  maneuver: rival.maneuver,
}));

// ---------------------------------------------------------------------------
// 1. No trackFeatures => byte-identical behaviour to the pre-feature system.
// ---------------------------------------------------------------------------
const baseline = makeRace({ rivalCount: 5 });
assert.equal(baseline.hasTrackFeatures, false);
assert.equal(baseline.speedCompensation, 1);
assert.equal(baseline.rivals[0].baseSpeed, 62, 'grid speed must be untouched without features');

// Same system after features were configured and then cleared again.
const cleared = makeRace({
  rivalCount: 5,
  trackFeatures: {
    pads: [{ id: 'pad-1', start: 0.3, end: 0.3 + metersToProgress(14), halfWidth: 4.4 }],
    ramps: [{ id: 'ramp-1', start: 0.6, end: 0.6 + metersToProgress(16), height: 2.6, halfWidth: 4.96 }],
  },
});
assert.equal(cleared.hasTrackFeatures, true);
cleared.configure({ trackFeatures: null });
cleared.start({ reset: true });
assert.equal(cleared.hasTrackFeatures, false);
assert.equal(cleared.rivals[0].baseSpeed, 62, 'clearing features must restore the raw grid speed');

stepRace(baseline, 600);
stepRace(cleared, 600);
const baselineSnapshot = snapshot(baseline);
const clearedSnapshot = snapshot(cleared);
for (const [index, entry] of baselineSnapshot.entries()) {
  assert.deepEqual(clearedSnapshot[index], entry, `rival ${index} must match the featureless baseline exactly`);
}
assert.ok(baselineSnapshot[0].raceProgress > 0.9, '600 frames should cover most of a lap');

// ---------------------------------------------------------------------------
// 2. Boost pads: real speed gain, one trigger per pass, per-pad cooldown.
// ---------------------------------------------------------------------------
const PAD_START = 0.3;
const PAD_END = PAD_START + metersToProgress(14);
const padRace = makeRace({
  speedCompensation: 1,
  trackFeatures: { pads: [{ id: 'pad-1', start: PAD_START, end: PAD_END, halfWidth: 4.4 }] },
});
const padControl = makeRace({ speedCompensation: 1 });
assert.equal(padRace.rivals[0].baseSpeed, 62, 'an explicit speedCompensation of 1 disables the handicap');

const padEvents = [];
padRace.on('rivalPadBoost', ({ padId, impulse }) => {
  padEvents.push({ padId, impulse, time: padRace.state.raceTime, speed: padRace.rivals[0].speed });
});
const padRival = padRace.rivals[0];
const controlRival = padControl.rivals[0];
let speedBeforePad = 0;
stepRace(padRace, 900, () => {
  if (padEvents.length === 0) speedBeforePad = padRival.speed;
  return padRival.raceProgress < PAD_END + metersToProgress(20);
});
stepRace(padControl, 900, () => controlRival.raceProgress < padRival.raceProgress);

assert.equal(padEvents.length, 1, 'one pass over a pad should boost exactly once');
assert.equal(padEvents[0].padId, 'pad-1');
assert.ok(padEvents[0].impulse > 5.9, `pad impulse should match the player (~6 m/s), got ${padEvents[0].impulse}`);
assert.ok(
  padEvents[0].speed - speedBeforePad > 5,
  'the pad should visibly jump rival speed in a single frame',
);
assert.ok(
  padRival.speed > controlRival.speed + 2,
  `boosted rival (${padRival.speed.toFixed(2)}) should stay clear of the control (${controlRival.speed.toFixed(2)})`,
);
assert.ok(padRival.padBoostTime > 0, 'the 0.9 s pad window should still be running just after the strip');

// Rewinding onto the same pad inside the cooldown must not re-trigger.
padRival.raceProgress = PAD_START - metersToProgress(1);
padRival.progress = padRival.raceProgress;
stepRace(padRace, 12);
assert.equal(padEvents.length, 1, 'the 1.2 s per-pad cooldown should swallow an immediate re-entry');

// A later lap fires again, so the cooldown expires instead of latching.
stepRace(padRace, 1200, () => padEvents.length < 2);
assert.equal(padEvents.length, 2, 'the pad should trigger again on the next lap');
assert.ok(
  padEvents[1].time - padEvents[0].time >= 1.2,
  'consecutive triggers on the same pad must be at least the cooldown apart',
);

// ---------------------------------------------------------------------------
// 3. Jump ramps: climb the ramp, hop, land back on the road with a kick.
// ---------------------------------------------------------------------------
const RAMP_START = 0.3;
const RAMP_END = RAMP_START + metersToProgress(16);
const RAMP_HEIGHT = 2.6;
const rampRace = makeRace({
  speedCompensation: 1,
  trackFeatures: {
    ramps: [{ id: 'ramp-1', start: RAMP_START, end: RAMP_END, height: RAMP_HEIGHT, halfWidth: 4.96 }],
  },
});
const rampRival = rampRace.rivals[0];
let launches = 0;
let landings = 0;
let landingAirTime = 0;
let speedBeforeLanding = 0;
let speedAfterLanding = 0;
rampRace.on('rivalRampLaunch', () => { launches += 1; });
rampRace.on('rivalLanding', ({ airTime }) => {
  landings += 1;
  landingAirTime = airTime;
  speedAfterLanding = rampRival.speed;
});

let heightOnRampLip = 0;
let peakAirHeight = 0;
let heightSamples = 0;
let minHeight = Infinity;
let wasAirborne = false;
stepRace(rampRace, 1800, () => {
  const height = rampRival.object.position.y - curve.getPointAt(rampRival.progress).y - 0.04;
  minHeight = Math.min(minHeight, height);
  if (rampRival.progress >= RAMP_START && rampRival.progress <= RAMP_END) {
    heightSamples += 1;
    heightOnRampLip = height;
  }
  if (rampRival.airborne) {
    peakAirHeight = Math.max(peakAirHeight, height);
    wasAirborne = true;
    speedBeforeLanding = rampRival.speed;
  }
  return landings === 0;
});

assert.ok(heightSamples > 3, 'the rival should spend several frames on the ramp');
assert.ok(
  heightOnRampLip > RAMP_HEIGHT * 0.8,
  `ramp surface should lift the car to ~${RAMP_HEIGHT} m, got ${heightOnRampLip.toFixed(2)}`,
);
assert.equal(launches, 1, 'crossing the ramp lip should launch exactly once');
assert.equal(wasAirborne, true, 'the rival should actually leave the ramp');
assert.ok(peakAirHeight > RAMP_HEIGHT, 'the hop should arc above the ramp lip');
assert.ok(peakAirHeight < 12, 'the hop should stay a short arc, not a moon shot');
assert.equal(landings, 1, 'the rival should come back down exactly once');
assert.ok(landingAirTime > 0.28 && landingAirTime < 2.5, `air time ${landingAirTime.toFixed(2)}s should be brief`);
assert.ok(speedAfterLanding > speedBeforeLanding, 'landing should hand out a small speed kick');
assert.ok(minHeight > -1e-6, 'the rival must never sink below the road surface');

stepRace(rampRace, 240);
assert.equal(rampRival.airborne, false, 'the rival must not stay stuck in the air');
assert.ok(
  Math.abs(rampRival.object.position.y - curve.getPointAt(rampRival.progress).y - 0.04) < 1e-6,
  'after the jump the rival should sit back on the road height',
);

// ---------------------------------------------------------------------------
// 4. Racing line: AI aims at the pad while approaching, then relaxes back.
// ---------------------------------------------------------------------------
const LINE_PAD_START = 0.35;
const LINE_PAD_END = LINE_PAD_START + metersToProgress(14);
const lineRace = makeRace({
  lanes: [3.2],
  speedCompensation: 1,
  trackFeatures: { pads: [{ id: 'pad-1', start: LINE_PAD_START, end: LINE_PAD_END, halfWidth: 4.4 }] },
});
const lineRival = lineRace.rivals[0];
assert.equal(lineRival.baseLane, 3.2);

let laneBeforeApproach = null;
let laneInsidePad = null;
let commitDistance = null;
stepRace(lineRace, 900, () => {
  const toPad = (LINE_PAD_START - lineRival.raceProgress) * trackLength;
  if (laneBeforeApproach === null && toPad <= 46 && toPad > 42) laneBeforeApproach = lineRival.lane;
  if (commitDistance === null && lineRival.featureTarget === 'pad-1') commitDistance = toPad;
  if (lineRival.raceProgress >= LINE_PAD_START && lineRival.raceProgress <= LINE_PAD_END) {
    laneInsidePad = lineRival.lane;
  }
  return lineRival.raceProgress < LINE_PAD_END;
});

assert.notEqual(commitDistance, null, 'the rival should commit to the pad before reaching it');
assert.ok(
  commitDistance <= 41 && commitDistance > 30,
  `the pad line should engage ~40 m out, engaged at ${commitDistance?.toFixed(1)} m`,
);
assert.notEqual(laneBeforeApproach, null);
assert.notEqual(laneInsidePad, null);
assert.ok(
  Math.abs(laneInsidePad) < Math.abs(laneBeforeApproach),
  `lane should move toward the pad centre (${laneBeforeApproach?.toFixed(2)} -> ${laneInsidePad?.toFixed(2)})`,
);
assert.ok(Math.abs(laneInsidePad) <= 4.4, 'the rival should be inside the pad half width when crossing it');
assert.ok(
  Math.abs(laneInsidePad) < Math.abs(laneBeforeApproach) * 0.6,
  'the rival should have moved substantially toward the pad centre line',
);
assert.ok(
  Math.sign(laneInsidePad) === Math.sign(laneBeforeApproach),
  'the pad line should keep the rival on its own side of the road',
);

stepRace(lineRace, 180);
assert.equal(lineRival.featureTarget, null, 'past the pad the rival stops chasing it');
assert.ok(
  Math.abs(lineRival.lane - lineRival.baseLane) < 0.4,
  'after the pad the rival should return to its cruising lane',
);

// ---------------------------------------------------------------------------
// 5. Long run with a full feature set stays finite, monotonic and grounded.
// ---------------------------------------------------------------------------
const fullFeatures = {
  pads: [0.08, 0.22, 0.4, 0.55, 0.7, 0.86].map((start, index) => ({
    id: `pad-${index + 1}`,
    start,
    end: start + metersToProgress(14),
    halfWidth: 4.4,
  })),
  ramps: [0.16, 0.63].map((start, index) => ({
    id: `ramp-${index + 1}`,
    start,
    end: start + metersToProgress(16),
    height: 2.4 + index * 0.3,
    halfWidth: 4.96,
  })),
};
const soakRace = makeRace({ rivalCount: 5, trackFeatures: fullFeatures });
const padHits = new Map();
const launchCount = new Map();
const landingCount = new Map();
soakRace.on('rivalPadBoost', ({ rival }) => padHits.set(rival.id, (padHits.get(rival.id) ?? 0) + 1));
soakRace.on('rivalRampLaunch', ({ rival }) => launchCount.set(rival.id, (launchCount.get(rival.id) ?? 0) + 1));
soakRace.on('rivalLanding', ({ rival }) => landingCount.set(rival.id, (landingCount.get(rival.id) ?? 0) + 1));

const lastProgress = soakRace.rivals.map((rival) => rival.raceProgress);
const airStreak = soakRace.rivals.map(() => 0);
const maxAirStreak = soakRace.rivals.map(() => 0);
stepRace(soakRace, 3000, () => {
  for (const [index, rival] of soakRace.rivals.entries()) {
    assert.ok(Number.isFinite(rival.raceProgress), `rival ${index} progress must stay finite`);
    assert.ok(Number.isFinite(rival.speed), `rival ${index} speed must stay finite`);
    assert.ok(Number.isFinite(rival.lane), `rival ${index} lane must stay finite`);
    assert.ok(Number.isFinite(rival.heightOffset), `rival ${index} height must stay finite`);
    assert.ok(rival.raceProgress >= lastProgress[index], `rival ${index} progress must not go backwards`);
    assert.ok(rival.heightOffset >= 0 && rival.heightOffset < 12, `rival ${index} height must stay sane`);
    assert.ok(
      rival.speed > rival.baseSpeed * 0.5 && rival.speed < rival.baseSpeed * 1.6,
      `rival ${index} speed must stay in a plausible band`,
    );
    assert.ok(Number.isFinite(rival.object.position.x + rival.object.position.y + rival.object.position.z));
    assert.ok(rival.object.position.y >= 0.039, `rival ${index} must never drop through the road`);
    assert.ok(Math.abs(rival.lane) <= 5.13, `rival ${index} must stay on the road`);
    lastProgress[index] = rival.raceProgress;
    airStreak[index] = rival.airborne ? airStreak[index] + FRAME : 0;
    maxAirStreak[index] = Math.max(maxAirStreak[index], airStreak[index]);
  }
  return true;
});

for (const [index, rival] of soakRace.rivals.entries()) {
  const launches = launchCount.get(rival.id) ?? 0;
  const landings = landingCount.get(rival.id) ?? 0;
  assert.ok((padHits.get(rival.id) ?? 0) >= 8, `${rival.id} should be collecting pads every lap`);
  assert.ok(launches >= 8, `${rival.id} should be launching off both ramps every lap`);
  assert.ok(
    launches <= Math.ceil(rival.raceProgress) * fullFeatures.ramps.length,
    `${rival.id} must launch at most once per ramp per lap (${launches} launches)`,
  );
  assert.ok(landings >= launches - 1, `${rival.id} must land after every launch (${launches} up, ${landings} down)`);
  assert.ok(maxAirStreak[index] < 2, `${rival.id} must not float (longest hop ${maxAirStreak[index].toFixed(2)}s)`);
}
assert.ok(soakRace.rivals.every((rival) => rival.raceProgress > 4), 'the field should cover several laps');
assert.equal(soakRace.state.standings.length, 6);
assert.ok(soakRace.state.standings.every((entry) => Number.isFinite(entry.progress)));

// ---------------------------------------------------------------------------
// 6. Difficulty handicap: features on => rivals hand back the compensation.
// ---------------------------------------------------------------------------
const handicapped = makeRace({ rivalCount: 5, trackFeatures: fullFeatures });
assert.ok(Math.abs(handicapped.speedCompensation - 0.952) < 1e-9);
assert.ok(
  Math.abs(handicapped.rivals[0].baseSpeed - 62 * 0.952) < 1e-9,
  'rival 1 should drop from 62 to ~59 m/s when it gets the pads',
);
assert.ok(Math.abs(handicapped.rivals[0].baseSpeed - 59) < 0.1);
assert.equal(handicapped.rivals[0].rawBaseSpeed, 62, 'the raw grid speed stays available for re-scaling');
handicapped.configure({ speedCompensation: 1 });
assert.equal(handicapped.rivals[0].baseSpeed, 62, 'an explicit compensation wins over the automatic one');
handicapped.configure({ speedCompensation: null });
assert.ok(Math.abs(handicapped.rivals[0].baseSpeed - 62 * 0.952) < 1e-9, 'null restores automatic scaling');

// Backwards compatible configure signature.
handicapped.configure({ totalLaps: 2, rivalCount: 3 });
assert.equal(handicapped.totalLaps, 2);
assert.equal(handicapped.state.entrantCount, 4);
assert.equal(handicapped.hasTrackFeatures, true, 'configure without trackFeatures keeps the current zones');

console.log(JSON.stringify({
  baselineParity: true,
  padBoosts: padEvents.length,
  padImpulse: Number(padEvents[0].impulse.toFixed(2)),
  rampLaunches: launches,
  rampLandings: landings,
  peakAirHeight: Number(peakAirHeight.toFixed(2)),
  airTime: Number(landingAirTime.toFixed(2)),
  laneApproach: Number(laneBeforeApproach.toFixed(2)),
  laneOnPad: Number(laneInsidePad.toFixed(2)),
  padLineCommitMeters: Number(commitDistance.toFixed(1)),
  soakPadHits: [...padHits.values()],
  soakLaunches: [...launchCount.values()],
  soakMaxAirTime: Number(Math.max(...maxAirStreak).toFixed(2)),
  speedCompensation: handicapped.speedCompensation,
}));
