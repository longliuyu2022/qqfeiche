import * as THREE from 'three';

export const WHEEL_LAYOUT = Object.freeze([
  Object.freeze({ axle: 'rear', side: -1, phase: 0.18 }),
  Object.freeze({ axle: 'rear', side: 1, phase: 2.46 }),
  Object.freeze({ axle: 'front', side: -1, phase: 4.12 }),
  Object.freeze({ axle: 'front', side: 1, phase: 1.37 }),
]);

/**
 * Calculates a compact arcade suspension pose in metres/radians. Road inputs
 * are spatial (distance based), so the wheels settle instead of vibrating when
 * the car is stopped or the frame rate changes.
 */
export function computeVehicleAnimationPose({
  distance = 0,
  speedPose = 0,
  steering = 0,
  longitudinalLoad = 0,
  lateralLoad = 0,
  collisionImpact = 0,
} = {}) {
  const speed = THREE.MathUtils.clamp(speedPose, 0, 1);
  const steer = THREE.MathUtils.clamp(steering, -1, 1);
  const longitudinal = THREE.MathUtils.clamp(longitudinalLoad, -1.5, 1.5);
  const lateral = THREE.MathUtils.clamp(lateralLoad, -1.5, 1.5);
  const impact = THREE.MathUtils.clamp(collisionImpact, 0, 1);
  const steerDirection = Math.sign(steer);

  const wheels = WHEEL_LAYOUT.map((layout, index) => {
    const frontFactor = layout.axle === 'front' ? 1 : -1;
    const roadWave = (
      Math.sin(distance * 2.9 + layout.phase)
      + Math.sin(distance * 7.7 + layout.phase * 1.9) * 0.36
      + Math.sin(distance * 13.1 + index * 1.73) * 0.14
    ) * speed * 0.0065;
    const pitchTransfer = -frontFactor * longitudinal * 0.012;
    const rollTransfer = layout.side * lateral * 0.0135;
    const impactKick = impact * (layout.axle === 'front' ? 0.024 : 0.016);
    const suspensionTravel = THREE.MathUtils.clamp(
      roadWave + pitchTransfer + rollTransfer + impactKick,
      -0.042,
      0.052,
    );

    const ackermann = layout.axle === 'front'
      ? 1 + (layout.side === steerDirection ? 0.11 : -0.055) * Math.abs(steer)
      : 0;
    const steerAngle = layout.axle === 'front' ? steer * 0.34 * ackermann : 0;
    const camberAngle = THREE.MathUtils.clamp(
      -layout.side * 0.012 - layout.side * Math.abs(lateral) * 0.009,
      -0.032,
      0.032,
    );

    return { ...layout, suspensionTravel, steerAngle, camberAngle };
  });

  const averageTravel = wheels.reduce((sum, wheel) => sum + wheel.suspensionTravel, 0) / wheels.length;
  const heave = THREE.MathUtils.clamp(averageTravel * 0.46 + impact * 0.011, -0.018, 0.038);
  return { wheels, heave };
}

