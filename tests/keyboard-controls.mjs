import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ArcadeVehicle } from '../src/driving.js';

function keyboardEvent(type, code) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'code', { value: code });
  return event;
}

const chaseCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
chaseCamera.position.set(0, 6, -14);
chaseCamera.lookAt(0, 0, 20);
chaseCamera.updateMatrixWorld(true);
const projectedScreenX = (position) => position.clone().project(chaseCamera).x;

const target = new EventTarget();
const vehicle = new ArcadeVehicle();
vehicle.bindKeyboard(target);

const headingCar = new ArcadeVehicle();
headingCar.reset({ heading: 0 });
headingCar.velocity.set(0, 0, 20);
headingCar.startRace();
const headingTarget = new EventTarget();
headingCar.bindKeyboard(headingTarget);
headingTarget.dispatchEvent(keyboardEvent('keydown', 'KeyA'));
for (let frame = 0; frame < 10; frame += 1) headingCar.update(0.05);
assert.ok(projectedScreenX(headingCar.position) < 0, 'A must move the car toward the left side of the screen');
headingTarget.dispatchEvent(keyboardEvent('keyup', 'KeyA'));
headingCar.reset({ heading: 0 });
headingCar.velocity.set(0, 0, 20);
headingTarget.dispatchEvent(keyboardEvent('keydown', 'KeyD'));
for (let frame = 0; frame < 10; frame += 1) headingCar.update(0.05);
assert.ok(projectedScreenX(headingCar.position) > 0, 'D must move the car toward the right side of the screen');
headingTarget.dispatchEvent(keyboardEvent('keyup', 'KeyD'));

for (const code of ['KeyA', 'ArrowLeft']) {
  target.dispatchEvent(keyboardEvent('keydown', code));
  vehicle.update(0.01);
  assert.equal(vehicle.input.steer, 0.55, `${code} should steer left with reduced sensitivity`);
  target.dispatchEvent(keyboardEvent('keyup', code));
}

for (const code of ['KeyD', 'ArrowRight']) {
  target.dispatchEvent(keyboardEvent('keydown', code));
  vehicle.update(0.01);
  assert.equal(vehicle.input.steer, -0.55, `${code} should steer right with reduced sensitivity`);
  target.dispatchEvent(keyboardEvent('keyup', code));
}

target.dispatchEvent(keyboardEvent('keydown', 'KeyA'));
target.dispatchEvent(keyboardEvent('keydown', 'KeyD'));
vehicle.update(0.01);
assert.equal(vehicle.input.steer, 0, 'opposite keyboard steering inputs should cancel');

const driftCar = new ArcadeVehicle({ driftMinSpeed: 7 });
driftCar.velocity.set(0, 0, 20);
driftCar.startRace();
const driftTarget = new EventTarget();
driftCar.bindKeyboard(driftTarget);
driftTarget.dispatchEvent(keyboardEvent('keydown', 'Space'));
driftCar.update(1 / 60, { steer: 0.65 });
assert.equal(driftCar.state.isDrifting, true, 'Space should engage drift while held');
driftTarget.dispatchEvent(keyboardEvent('keyup', 'Space'));
driftCar.update(1 / 60, { steer: 0.65 });
assert.equal(driftCar.input.drift, 0, 'releasing Space should clear keyboard drift input');
assert.equal(driftCar.state.isDrifting, false, 'releasing Space should end the drift immediately');

driftTarget.dispatchEvent(keyboardEvent('keydown', 'Space'));
driftCar.update(1 / 60, { steer: 0.65 });
driftTarget.dispatchEvent(new Event('pagehide'));
driftCar.update(1 / 60, { steer: 0.65 });
assert.equal(driftCar.input.drift, 0, 'page navigation should clear a latched Space key');
assert.equal(driftCar.state.isDrifting, false, 'a latched Space key must not keep drifting after pagehide');

console.log(JSON.stringify({ aLeft: 'ok', dRight: 'ok', steerScale: 0.55, arrows: 'ok', opposingSteer: 'ok' }));
