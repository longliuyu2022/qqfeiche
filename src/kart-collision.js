import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-6;

function horizontalDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function forwardFor(entry, target = new THREE.Vector3()) {
  const yaw = Number.isFinite(entry.heading) ? entry.heading : entry.object?.rotation?.y ?? 0;
  return target.set(Math.sin(yaw), 0, Math.cos(yaw));
}

function velocityFor(entry, target = new THREE.Vector3()) {
  if (entry.vehicle?.velocity) return target.copy(entry.vehicle.velocity);
  const speed = Number(entry.speed) || 0;
  return target.copy(forwardFor(entry)).multiplyScalar(speed);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Deterministic, lightweight contact racing response shared by offline AI and
 * online snapshots. The server still validates the resulting state; this
 * system only owns the short, readable bumper interaction on each client.
 */
export function createKartCollisionSystem(options = {}) {
  const radius = Number.isFinite(options.radius) ? options.radius : 2.05;
  const cooldownSeconds = Number.isFinite(options.cooldown) ? options.cooldown : 0.3;
  const trackCurve = options.trackCurve ?? null;
  const enabled = options.enabled !== false;
  const cooldowns = new Map();
  const scratch = {
    normal: new THREE.Vector3(),
    relativeVelocity: new THREE.Vector3(),
    impulse: new THREE.Vector3(),
    side: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
  };

  function listEntries() {
    const entries = [];
    if (options.player?.position) {
      entries.push({
        id: 'player',
        kind: 'player',
        object: options.player.object,
        position: options.player.position,
        vehicle: options.player,
        heading: options.player.heading,
        mass: Number(options.player.config?.collisionMass) || 1,
      });
    }
    for (const rival of options.rivals ?? []) {
      if (!rival.object?.visible) continue;
      entries.push({
        id: rival.id ?? `rival-${entries.length}`,
        kind: 'rival',
        object: rival.object,
        position: rival.object.position,
        rival,
        speed: rival.speed,
        heading: rival.object.rotation.y,
        mass: Number(rival.mass) || 1,
      });
    }
    for (const remote of options.remotePlayers?.values?.() ?? []) {
      if (!remote.object?.visible) continue;
      entries.push({
        id: remote.id,
        kind: 'remote',
        object: remote.object,
        position: remote.object.position,
        remote,
        speed: remote.speed,
        heading: remote.targetYaw ?? remote.object.rotation.y,
        mass: Number(remote.mass) || 1,
      });
    }
    return entries;
  }

  function applyEntryImpact(entry, impulse, impact, headOnRatio, sideSign, collisionType) {
    if (entry.vehicle?.applyKartImpact) {
      entry.vehicle.applyKartImpact({
        impulse,
        lateralImpulse: sideSign * Math.min(7, impact * 1.8),
        yawImpulse: sideSign * Math.min(1.2, impact * 0.22),
        impact,
        source: 'kart',
        collisionType,
      });
      return;
    }
    const target = entry.rival ?? entry.remote;
    if (!target) return;
    const retention = collisionType === 'head-on' ? 0.44 : collisionType === 'rear-end' ? 0.84 : 0.72;
    target.speed = Math.max(0, (Number(target.speed) || 0) * retention - impact * 0.38);
    target.collisionImpact = Math.max(target.collisionImpact ?? 0, impact);
    target.collisionSlowTime = Math.max(target.collisionSlowTime ?? 0, headOnRatio > 0.65 ? 0.54 : 0.32);
    if (entry.rival && trackCurve) {
      const sample = entry.rival.object.userData.kartSample ?? null;
      const nearest = sample || findTrackSample(entry.rival.object.position);
      if (nearest) {
        entry.rival.lane = clamp(nearest.offset + sideSign * Math.min(2.4, impact * 0.34), -5.2, 5.2);
        entry.rival.targetLane = entry.rival.lane;
      }
    }
    if (entry.remote) {
      entry.remote.targetPosition?.addScaledVector(impulse, 0.08);
      entry.remote.collisionOffset = entry.remote.collisionOffset || new THREE.Vector3();
      entry.remote.collisionOffset.addScaledVector(impulse, 0.08);
    }
  }

  function findTrackSample(position) {
    if (!trackCurve?.getPointAt || !trackCurve?.getTangentAt) return null;
    let best = null;
    let bestDistance = Infinity;
    const point = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (let index = 0; index < 120; index += 1) {
      const progress = index / 120;
      trackCurve.getPointAt(progress, point);
      const distance = horizontalDistanceSquared(position, point);
      if (distance >= bestDistance) continue;
      trackCurve.getTangentAt(progress, tangent).setY(0).normalize();
      side.crossVectors(UP, tangent).normalize();
      bestDistance = distance;
      best = { offset: new THREE.Vector3().subVectors(position, point).dot(side) };
    }
    return best;
  }

  function update(delta = 1 / 60) {
    if (!enabled || options.isEnabled?.() === false) return [];
    for (const [key, remaining] of cooldowns) {
      const next = remaining - delta;
      if (next <= 0) cooldowns.delete(key);
      else cooldowns.set(key, next);
    }
    const entries = listEntries();
    const collisions = [];
    const minDistance = radius * 2;
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      const left = entries[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const right = entries[rightIndex];
        const key = `${left.id}:${right.id}`;
        if (cooldowns.has(key)) continue;
        const distanceSquared = horizontalDistanceSquared(left.position, right.position);
        if (distanceSquared > minDistance * minDistance) continue;
        const distance = Math.sqrt(distanceSquared);
        const normal = scratch.normal.set(
          left.position.x - right.position.x,
          0,
          left.position.z - right.position.z,
        );
        if (normal.lengthSq() < EPSILON) normal.set(1, 0, 0);
        else normal.normalize();
        const relativeVelocity = scratch.relativeVelocity.copy(velocityFor(left));
        relativeVelocity.sub(velocityFor(right, scratch.impulse));
        const approach = Math.max(0, -relativeVelocity.dot(normal));
        const impact = clamp(approach * 0.12 + (minDistance - distance) * 1.5, 0.28, 2.2);
        const leftForward = forwardFor(left, scratch.side);
        const rightForward = forwardFor(right, scratch.tangent);
        const headOnRatio = clamp((1 - leftForward.dot(rightForward)) * 0.5, 0, 1);
        const relativeAlongLeft = relativeVelocity.dot(leftForward);
        const collisionType = headOnRatio > 0.65
          ? 'head-on'
          : Math.abs(relativeAlongLeft) > 3 ? 'rear-end' : 'side';
        const totalMass = Math.max(0.1, left.mass + right.mass);
        const leftSeparation = Math.max(0.15, (minDistance - distance) * (right.mass / totalMass));
        const rightSeparation = Math.max(0.15, (minDistance - distance) * (left.mass / totalMass));
        left.position.addScaledVector(normal, leftSeparation);
        right.position.addScaledVector(normal, -rightSeparation);
        const impulse = scratch.impulse.copy(normal).multiplyScalar(impact * (0.75 + headOnRatio * 0.65));
        const sideSign = Math.sign(normal.x * leftForward.z - normal.z * leftForward.x) || 1;
        applyEntryImpact(left, impulse.clone().multiplyScalar(right.mass / totalMass), impact, headOnRatio, sideSign, collisionType);
        applyEntryImpact(right, impulse.clone().multiplyScalar(-left.mass / totalMass), impact, headOnRatio, -sideSign, collisionType);
        cooldowns.set(key, cooldownSeconds);
        const event = { left, right, impact, headOnRatio, collisionType, side: sideSign < 0 ? 'left' : 'right' };
        collisions.push(event);
        options.onCollision?.(event);
      }
    }
    return collisions;
  }

  function reset() {
    cooldowns.clear();
  }

  return { update, reset, get enabled() { return enabled; } };
}
