import assert from 'node:assert/strict';
import { computeVehicleAnimationPose } from '../src/vehicle-animation.js';

const canvasContext = {
  createRadialGradient: () => ({ addColorStop() {} }),
  fillRect() {},
  fillStyle: '',
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas'
    ? { width: 0, height: 0, getContext: () => canvasContext }
    : {}),
};
const { createHeroCar, createHeroCarVariant } = await import('../src/procedural-vehicle.js');

const idle = computeVehicleAnimationPose();
assert.equal(idle.wheels.length, 4, 'vehicle pose should always contain four wheels');
assert.deepEqual(idle.wheels.map((wheel) => wheel.steerAngle), [0, 0, 0, 0]);
assert.ok(idle.wheels.every((wheel) => Number.isFinite(wheel.suspensionTravel)));

const accelerating = computeVehicleAnimationPose({ longitudinalLoad: 1 });
const rearAverage = (accelerating.wheels[0].suspensionTravel + accelerating.wheels[1].suspensionTravel) / 2;
const frontAverage = (accelerating.wheels[2].suspensionTravel + accelerating.wheels[3].suspensionTravel) / 2;
assert.ok(rearAverage > frontAverage, 'acceleration should compress the rear axle more than the front');

const cornering = computeVehicleAnimationPose({ steering: 0.8, lateralLoad: 1, speedPose: 1, distance: 15 });
assert.equal(cornering.wheels[0].steerAngle, 0, 'rear-left wheel should not steer');
assert.equal(cornering.wheels[1].steerAngle, 0, 'rear-right wheel should not steer');
assert.ok(cornering.wheels[2].steerAngle > 0 && cornering.wheels[3].steerAngle > 0);
assert.notEqual(cornering.wheels[2].steerAngle, cornering.wheels[3].steerAngle, 'front wheels should use Ackermann angles');
assert.ok(
  cornering.wheels[1].suspensionTravel > cornering.wheels[0].suspensionTravel,
  'cornering should transfer suspension load across the car',
);

const impact = computeVehicleAnimationPose({
  distance: Number.MAX_SAFE_INTEGER,
  speedPose: 99,
  steering: -99,
  longitudinalLoad: 99,
  lateralLoad: -99,
  collisionImpact: 99,
});
for (const wheel of impact.wheels) {
  assert.ok(Number.isFinite(wheel.suspensionTravel));
  assert.ok(wheel.suspensionTravel >= -0.042 && wheel.suspensionTravel <= 0.052);
}
assert.ok(impact.heave >= -0.018 && impact.heave <= 0.038);

const cars = [
  createHeroCar(),
  createHeroCarVariant({ id: 'raiden' }),
  createHeroCarVariant({ id: 'nimbus' }),
  createHeroCarVariant({ id: 'goliath' }),
];
for (const car of cars) {
  assert.equal(car.userData.wheels.length, 4, `${car.name} should retain four spin pivots`);
  assert.equal(car.userData.wheelRigs.length, 4, `${car.name} should expose four independent suspension rigs`);
  assert.ok(car.userData.poseRoot?.isGroup, `${car.name} should expose a sprung body pose root`);
  assert.ok(car.userData.wheelRigs.every((rig) => (
    rig.suspensionRoot.parent === car
      && rig.steeringKnuckle.parent === rig.suspensionRoot
      && rig.wheel.parent === rig.steeringKnuckle
  )), `${car.name} should use suspension > knuckle > spin hierarchy`);
  assert.ok(!car.userData.poseRoot.children.includes(car.userData.underglow), 'underglow should stay road-aligned');
}

console.log('vehicle animation tests passed');
