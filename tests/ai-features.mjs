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

function makeRivals(count, { lanes, overrides } = {}) {
  return Array.from({ length: count }, (unused, index) => ({
    object: makeRivalObject(),
    progress: -0.0038 * (index + 1),
    totalProgress: -0.0038 * (index + 1),
    speed: 62 + index * 1.9,
    lane: lanes?.[index] ?? ((index % 2) * 2 - 1) * (1.7 + Math.floor(index / 2) * 0.35),
    ...(overrides?.[index] ?? {}),
  }));
}

/** Race with the player parked far ahead so rival-vs-player logic stays inert. */
function makeRace({ rivalCount = 1, lanes, overrides, ...options } = {}) {
  const player = new ArcadeVehicle({ trackCurve: curve, trackWidth: 16, totalLaps: 20 });
  const race = new RaceSystem({
    player,
    rivals: makeRivals(rivalCount, { lanes, overrides }),
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

const UP = new THREE.Vector3(0, 1, 0);

/** One side of a candidate branch, mirroring `traceShortcut()` in track-features.js. */
function traceBranch(start, end, sign, samples, edgeOffset, peak) {
  const points = [];
  for (let index = 0; index < samples; index += 1) {
    const u = index / (samples - 1);
    const point = curve.getPointAt(start + (end - start) * u);
    const tangent = curve.getTangentAt(start + (end - start) * u).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(UP, tangent).normalize();
    points.push(point.addScaledVector(side, sign * (edgeOffset + (peak - edgeOffset) * Math.sin(Math.PI * u))));
  }
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].z - points[index - 1].z);
  }
  return { points, length };
}

/**
 * Synthetic `featureZonesForPhysics().shortcuts` entry: a sine-bulged branch off
 * the shoulder, on whichever side actually shortens the lap.
 */
function makeShortcut({ id, start, end, samples = 15, edgeOffset = 6, peak = 40, halfWidth = 5.44 }) {
  const spanMeters = (end - start) * trackLength;
  const outward = traceBranch(start, end, 1, samples, edgeOffset, peak);
  const inward = traceBranch(start, end, -1, samples, edgeOffset, peak);
  const side = outward.length <= inward.length ? 1 : -1;
  const traced = side === 1 ? outward : inward;
  return {
    id,
    start,
    end,
    side,
    halfWidth,
    savedMeters: spanMeters - traced.length,
    points: traced.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
    spanMeters,
    pathLength: traced.length,
  };
}

/** How far off the main centre line a rival's car body actually sits, in meters. */
function lateralFromCentre(race, rival) {
  const centre = curve.getPointAt(rival.progress);
  return Math.hypot(rival.object.position.x - centre.x, rival.object.position.z - centre.z);
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

// ---------------------------------------------------------------------------
// 7. Shortcuts, personality: some rivals fork off, some stay on the main line.
// ---------------------------------------------------------------------------
const SC = makeShortcut({ id: 'sc-1', start: 0.2, end: 0.5 });
assert.ok(SC.savedMeters > 15, `the test branch should be a real shortcut (${SC.savedMeters.toFixed(1)} m)`);

const moodRace = makeRace({ rivalCount: 5, speedCompensation: 1, trackFeatures: { shortcuts: [SC] } });
assert.equal(moodRace.hasTrackFeatures, true, 'a shortcut-only layout still counts as track features');
assert.equal(moodRace.getTrackFeatures().shortcuts.length, 1);
assert.ok(
  moodRace.rivals.every((rival) => rival.shortcutBias > 0 && rival.shortcutBias < 1),
  'the default shortcut taste should leave room for both answers',
);
const moodEnters = new Set();
moodRace.on('rivalShortcutEnter', ({ rival, shortcutId }) => moodEnters.add(`${rival.id}:${shortcutId}`));
const maxLateral = moodRace.rivals.map(() => 0);
stepRace(moodRace, 1400, () => {
  for (const [index, rival] of moodRace.rivals.entries()) {
    maxLateral[index] = Math.max(maxLateral[index], lateralFromCentre(moodRace, rival));
  }
  return true;
});

const branchRunners = maxLateral.filter((lateral) => lateral > 12).length;
const lineRunners = maxLateral.filter((lateral) => lateral < 9).length;
assert.ok(branchRunners >= 1, `at least one rival should drive the branch (${maxLateral.map((v) => v.toFixed(1))})`);
assert.ok(lineRunners >= 1, `at least one rival should stay on the main line (${maxLateral.map((v) => v.toFixed(1))})`);
assert.equal(branchRunners + lineRunners, 5, 'every rival should be clearly on one side of the choice');
assert.equal(moodEnters.size, branchRunners, 'the enter events should match the cars seen off the racing line');
assert.ok(
  moodRace.rivals.every((rival) => rival.activeShortcut === null || rival.shortcutId === rival.activeShortcut.id),
  'shortcutId must track the active branch',
);

// ---------------------------------------------------------------------------
// 8. Shortcuts, payoff: shorter road, same speed, so the section goes quicker.
// ---------------------------------------------------------------------------
/** Drives one lone rival through the branch span and reports what it cost. */
function runSection(bias, shortcut = SC) {
  const race = makeRace({
    rivalCount: 1,
    speedCompensation: 1,
    overrides: [{ shortcutBias: bias, lane: 0 }],
    trackFeatures: { shortcuts: [shortcut] },
  });
  const rival = race.rivals[0];
  let entryTime = null;
  let exitTime = null;
  let meters = 0;
  let topSpeed = 0;
  let forked = false;
  stepRace(race, 1200, () => {
    if (entryTime === null && rival.raceProgress >= shortcut.start) entryTime = race.state.raceTime;
    if (entryTime !== null && exitTime === null) meters += rival.speed * FRAME;
    if (exitTime === null && rival.raceProgress >= shortcut.end) exitTime = race.state.raceTime;
    if (rival.activeShortcut) forked = true;
    topSpeed = Math.max(topSpeed, rival.speed);
    return exitTime === null;
  });
  return { seconds: exitTime - entryTime, meters, topSpeed, forked, rival };
}

const cutter = runSection(1);
const cruiser = runSection(0);
assert.equal(cutter.forked, true, 'a rival with full shortcut taste should take the branch');
assert.equal(cruiser.forked, false, 'a rival with zero shortcut taste should ignore the branch');
assert.ok(
  cutter.seconds < cruiser.seconds - 0.2,
  `the branch should be quicker (${cutter.seconds.toFixed(2)}s vs ${cruiser.seconds.toFixed(2)}s)`,
);
assert.ok(
  Math.abs((cruiser.meters - cutter.meters) - SC.savedMeters) < 4,
  `distance saved (${(cruiser.meters - cutter.meters).toFixed(1)} m) should match savedMeters (${SC.savedMeters.toFixed(1)} m)`,
);
assert.ok(
  cutter.topSpeed <= cruiser.topSpeed + 1e-9,
  'the branch must pay in distance only, never in a speed bonus',
);
assert.ok(cutter.rival.activeShortcut === null, 'the branch releases the rival at its exit');
assert.ok(
  Math.abs(cutter.rival.raceProgress - SC.end) < 0.01,
  'the rival should rejoin the main line right at the branch exit progress',
);

// ---------------------------------------------------------------------------
// 9. Shortcuts, determinism: same grid, same choices, every single run.
// ---------------------------------------------------------------------------
function shortcutLog(seed = {}) {
  const race = makeRace({ rivalCount: 5, speedCompensation: 1, trackFeatures: { shortcuts: [SC] }, ...seed });
  const log = [];
  race.on('rivalShortcutEnter', ({ rival, shortcutId }) => {
    log.push(`in ${rival.id} ${shortcutId} @${race.state.raceTime.toFixed(3)}`);
  });
  race.on('rivalShortcutExit', ({ rival, shortcutId }) => {
    log.push(`out ${rival.id} ${shortcutId} @${race.state.raceTime.toFixed(3)}`);
  });
  stepRace(race, 1400);
  return { log, progress: race.rivals.map((rival) => rival.raceProgress) };
}
const runA = shortcutLog();
const runB = shortcutLog();
assert.ok(runA.log.length >= 4, `the deterministic run should log several branch passes (${runA.log.length})`);
assert.deepEqual(runB.log, runA.log, 'shortcut choices must be reproducible run to run');
assert.deepEqual(runB.progress, runA.progress, 'a reproducible run must land on identical progress');

// ---------------------------------------------------------------------------
// 10. Two disjoint branches on one lap: both usable, never mixed up.
// ---------------------------------------------------------------------------
const SC_A = makeShortcut({ id: 'sc-a', start: 0.08, end: 0.34, peak: 38 });
const SC_B = makeShortcut({ id: 'sc-b', start: 0.52, end: 0.8, peak: 40 });
const pairRace = makeRace({
  rivalCount: 2,
  speedCompensation: 1,
  overrides: [{ shortcutBias: 1, lane: 0 }, { shortcutBias: 0, lane: 0 }],
  trackFeatures: { shortcuts: [SC_B, SC_A] },
});
assert.deepEqual(
  pairRace.getTrackFeatures().shortcuts.map((shortcut) => shortcut.id),
  ['sc-a', 'sc-b'],
  'branches are stored in lap order regardless of input order',
);
const pairRival = pairRace.rivals[0];
const soloRival = pairRace.rivals[1];
const pairLog = [];
pairRace.on('rivalShortcutEnter', ({ rival, shortcutId }) => pairLog.push({ kind: 'in', id: rival.id, shortcutId }));
pairRace.on('rivalShortcutExit', ({ rival, shortcutId }) => pairLog.push({ kind: 'out', id: rival.id, shortcutId }));
stepRace(pairRace, 1500, () => {
  const active = pairRival.activeShortcut;
  if (active) {
    const zone = active.id === 'sc-a' ? SC_A : SC_B;
    assert.ok(
      pairRival.progress >= zone.start - 1e-6 && pairRival.progress <= zone.end + 1e-6,
      `${active.id} must only own lap progress inside its own span (${pairRival.progress.toFixed(3)})`,
    );
    assert.equal(pairRival.shortcutId, active.id);
  }
  assert.equal(soloRival.activeShortcut, null, 'the zero-taste rival must never fork off');
  return true;
});

const enteredIds = pairLog.filter((entry) => entry.kind === 'in').map((entry) => entry.shortcutId);
assert.ok(enteredIds.includes('sc-a') && enteredIds.includes('sc-b'), 'both branches should get used');
assert.ok(pairLog.every((entry) => entry.id === 'rival-1'), 'only the committed rival should fork');
for (let index = 0; index + 1 < pairLog.length; index += 2) {
  assert.equal(pairLog[index].kind, 'in');
  assert.equal(pairLog[index + 1].kind, 'out', 'every entry must be closed before the next one opens');
  assert.equal(pairLog[index + 1].shortcutId, pairLog[index].shortcutId, 'a branch must exit where it was entered');
}
assert.ok(
  pairRival.raceProgress > soloRival.raceProgress,
  `the branch runner should be up the road (${pairRival.raceProgress.toFixed(3)} vs ${soloRival.raceProgress.toFixed(3)})`,
);

// ---------------------------------------------------------------------------
// 11. A pad bypassed by a branch must not fire for the car on the branch.
// ---------------------------------------------------------------------------
const bypassRace = makeRace({
  rivalCount: 2,
  speedCompensation: 1,
  overrides: [{ shortcutBias: 1, lane: 0 }, { shortcutBias: 0, lane: 0 }],
  trackFeatures: {
    pads: [
      { id: 'pad-bypassed', start: 0.35, end: 0.35 + metersToProgress(14), halfWidth: 4.4 },
      { id: 'pad-open', start: 0.6, end: 0.6 + metersToProgress(14), halfWidth: 4.4 },
    ],
    shortcuts: [SC],
  },
});
const bypassHits = new Map();
bypassRace.on('rivalPadBoost', ({ rival, padId }) => {
  const key = `${rival.id}:${padId}`;
  bypassHits.set(key, (bypassHits.get(key) ?? 0) + 1);
});
stepRace(bypassRace, 1500, () => {
  for (const rival of bypassRace.rivals) {
    if (rival.activeShortcut) {
      assert.equal(rival.featureTarget, null, 'a car on a branch must not chase main-line pads');
      assert.equal(rival.padBoostTime, 0, 'a car on a branch must not be riding a pad boost');
    }
  }
  return true;
});
assert.equal(
  bypassHits.get('rival-1:pad-bypassed') ?? 0,
  0,
  'the branch runner drives past the pad the branch bypasses, so it must never fire',
);
assert.ok((bypassHits.get('rival-2:pad-bypassed') ?? 0) >= 2, 'the main-line rival still collects that pad');
assert.ok((bypassHits.get('rival-1:pad-open') ?? 0) >= 2, 'pads outside the branch still work after a fork');

// ---------------------------------------------------------------------------
// 12. Full soak with pads, ramps and two branches: finite, monotonic, finishing.
// ---------------------------------------------------------------------------
const mixedFeatures = {
  pads: [0.36, 0.44].map((start, index) => ({
    id: `pad-${index + 1}`,
    start,
    end: start + metersToProgress(14),
    halfWidth: 4.4,
  })),
  ramps: [{ id: 'ramp-1', start: 0.82, end: 0.82 + metersToProgress(16), height: 2.4, halfWidth: 4.96 }],
  shortcuts: [SC_A, SC_B],
};
const mixedRace = makeRace({ rivalCount: 5, totalLaps: 4, trackFeatures: mixedFeatures });
const mixedEnters = new Map();
const mixedExits = new Map();
mixedRace.on('rivalShortcutEnter', ({ rival }) => mixedEnters.set(rival.id, (mixedEnters.get(rival.id) ?? 0) + 1));
mixedRace.on('rivalShortcutExit', ({ rival }) => mixedExits.set(rival.id, (mixedExits.get(rival.id) ?? 0) + 1));

const mixedLast = mixedRace.rivals.map((rival) => rival.raceProgress);
stepRace(mixedRace, 3000, () => {
  for (const [index, rival] of mixedRace.rivals.entries()) {
    assert.ok(Number.isFinite(rival.raceProgress), `rival ${index} progress must stay finite`);
    assert.ok(Number.isFinite(rival.speed), `rival ${index} speed must stay finite`);
    assert.ok(Number.isFinite(rival.lane), `rival ${index} lane must stay finite`);
    assert.ok(Number.isFinite(rival.shortcutLocal), `rival ${index} branch progress must stay finite`);
    assert.ok(rival.raceProgress >= mixedLast[index], `rival ${index} progress must not go backwards`);
    assert.ok(
      rival.speed > rival.baseSpeed * 0.5 && rival.speed < rival.baseSpeed * 1.6,
      `rival ${index} speed must stay in a plausible band`,
    );
    assert.ok(Number.isFinite(rival.object.position.x + rival.object.position.y + rival.object.position.z));
    assert.ok(rival.object.position.y >= 0.039, `rival ${index} must never drop through the road`);
    const lateral = lateralFromCentre(mixedRace, rival);
    assert.ok(
      rival.activeShortcut ? lateral <= 44 : lateral <= 7,
      `rival ${index} must be on the road or inside a branch corridor (${lateral.toFixed(2)} m)`,
    );
    mixedLast[index] = rival.raceProgress;
  }
  return true;
});

assert.ok(mixedRace.rivals.every((rival) => rival.finished), 'every rival should finish a four lap race');
assert.ok(
  mixedRace.rivals.every((rival) => Number.isFinite(rival.finishTime) && rival.finishTime > 0),
  'every finisher needs a finite finish time',
);
assert.ok(mixedRace.rivals.every((rival) => rival.activeShortcut === null), 'nobody may be stuck inside a branch');
assert.ok(mixedEnters.size >= 1, 'the mixed layout should still see branch traffic');
for (const [id, enters] of mixedEnters) {
  assert.ok((mixedExits.get(id) ?? 0) >= enters - 1, `${id} must leave every branch it enters`);
}
assert.equal(mixedRace.state.standings.length, 6);
assert.ok(mixedRace.state.standings.every((entry) => Number.isFinite(entry.progress)));

// Clearing features also clears the branches.
mixedRace.configure({ trackFeatures: null });
assert.equal(mixedRace.hasTrackFeatures, false);
assert.equal(mixedRace.getTrackFeatures().shortcuts.length, 0);
assert.ok(mixedRace.rivals.every((rival) => rival.activeShortcut === null && rival.shortcutId === null));

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
  shortcutSavedMeters: Number(SC.savedMeters.toFixed(1)),
  shortcutBias: moodRace.rivals.map((rival) => Number(rival.shortcutBias.toFixed(3))),
  shortcutTakers: branchRunners,
  shortcutSkippers: lineRunners,
  shortcutMaxLateral: maxLateral.map((lateral) => Number(lateral.toFixed(1))),
  sectionSecondsOnBranch: Number(cutter.seconds.toFixed(3)),
  sectionSecondsOnLine: Number(cruiser.seconds.toFixed(3)),
  sectionMetersSaved: Number((cruiser.meters - cutter.meters).toFixed(2)),
  shortcutDeterministic: true,
  twoBranchPasses: enteredIds.length,
  mixedShortcutEnters: [...mixedEnters.values()],
}));
