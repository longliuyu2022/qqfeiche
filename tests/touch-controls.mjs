import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';

class TouchTarget extends EventTarget {
  setPointerCapture() {}
}

function pointerEvent(type, pointerId) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

const chaseCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
chaseCamera.position.set(0, 6, -14);
chaseCamera.lookAt(0, 0, 20);
chaseCamera.updateMatrixWorld(true);
const projectedScreenX = (position) => position.clone().project(chaseCamera).x;

const vehicle = new ArcadeVehicle();
const controls = Object.fromEntries(
  ['left', 'right', 'throttle', 'brake', 'drift', 'nitro'].map((name) => [name, new TouchTarget()]),
);
vehicle.bindTouchControls(controls);

for (const [controlName, expectedScreenDirection] of [['left', -1], ['right', 1]]) {
  const headingCar = new ArcadeVehicle();
  headingCar.reset({ heading: 0 });
  headingCar.velocity.set(0, 0, 20);
  headingCar.startRace();
  const headingControl = new TouchTarget();
  headingCar.bindTouchControls({ [controlName]: headingControl });
  headingControl.dispatchEvent(pointerEvent('pointerdown', 21 + expectedScreenDirection));
  for (let frame = 0; frame < 10; frame += 1) headingCar.update(0.05);
  assert.equal(
    Math.sign(projectedScreenX(headingCar.position)),
    expectedScreenDirection,
    `touch ${controlName} must move the car toward the ${controlName} side of the screen`,
  );
}

for (const [name, pointerId] of [['throttle', 11], ['left', 12], ['drift', 13], ['nitro', 14]]) {
  controls[name].dispatchEvent(pointerEvent('pointerdown', pointerId));
}
vehicle.update(0.01);
assert.deepEqual(vehicle.input, {
  throttle: 1,
  brake: 0,
  steer: 1,
  drift: 1,
  nitro: 1,
});

controls.right.dispatchEvent(pointerEvent('pointerdown', 15));
vehicle.update(0.01);
assert.equal(vehicle.input.steer, 0, 'opposite steering touches should cancel');

controls.throttle.dispatchEvent(pointerEvent('pointerup', 11));
controls.brake.dispatchEvent(pointerEvent('pointerdown', 16));
vehicle.update(0.01);
assert.equal(vehicle.input.throttle, 0);
assert.equal(vehicle.input.brake, 1, 'touch brake should support braking and reverse');

for (const [name, pointerId] of [
  ['brake', 16], ['left', 12], ['drift', 13], ['nitro', 14], ['right', 15],
]) {
  controls[name].dispatchEvent(pointerEvent('pointercancel', pointerId));
}
vehicle.update(0.01);
assert.deepEqual(vehicle.input, {
  throttle: 0,
  brake: 0,
  steer: 0,
  drift: 0,
  nitro: 0,
});

console.log(JSON.stringify({
  mobileDirection: 'ok',
  multiTouch: 'ok',
  opposingSteer: 'ok',
  touchBrake: 'ok',
  pointercancel: 'ok',
}));
