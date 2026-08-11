import * as THREE from 'three';

export const ITEM_DEFINITIONS = Object.freeze({
  turbo: Object.freeze({ id: 'turbo', label: '氮气瓶', icon: 'N2O', color: 0x35e7ff }),
  shield: Object.freeze({ id: 'shield', label: '能量盾', icon: 'DEF', color: 0xd9ff43 }),
  emp: Object.freeze({ id: 'emp', label: '电磁脉冲', icon: 'EMP', color: 0xffcf5a }),
  shockwave: Object.freeze({ id: 'shockwave', label: '冲击波', icon: 'WAVE', color: 0xff4f61 }),
  missile: Object.freeze({ id: 'missile', label: '追踪导弹', icon: 'MSL', color: 0xff7a2f }),
  banana: Object.freeze({ id: 'banana', label: '香蕉皮', icon: 'PEEL', color: 0xffe14a }),
  bomb: Object.freeze({ id: 'bomb', label: '水炸弹', icon: 'AQUA', color: 0x4f9bff }),
});

const ITEM_IDS = Object.keys(ITEM_DEFINITIONS);

/** Pickup odds per standings bracket: leaders draw defensive items, backmarkers draw offense. */
export const ITEM_WEIGHTS = Object.freeze({
  front: Object.freeze({ turbo: 2, shield: 4, emp: 1.5, shockwave: 1, missile: 0.5, banana: 4, bomb: 1.5 }),
  middle: Object.freeze({ turbo: 2.5, shield: 2, emp: 2, shockwave: 2, missile: 2.5, banana: 1.5, bomb: 2.5 }),
  rear: Object.freeze({ turbo: 4, shield: 1, emp: 2, shockwave: 3.5, missile: 4.5, banana: 0.5, bomb: 2 }),
});

export const ITEM_TUNING = Object.freeze({
  missile: Object.freeze({
    lockRange: 260,
    speedFactor: 1.5,
    minChaseSpeed: 22,
    freeFlightSpeed: 30,
    life: 6,
    freeLife: 3,
    slowFactor: 0.35,
    spinTime: 1.2,
  }),
  banana: Object.freeze({
    dropBack: 4,
    life: 45,
    radius: 1.8,
    ownerImmunity: 1,
    slowFactor: 0.55,
    effectTime: 1.2,
  }),
  bomb: Object.freeze({
    throwDistance: 35,
    fuse: 1.1,
    radius: 7,
    slowFactor: 0.5,
    effectTime: 1.5,
    arcHeight: 5.5,
  }),
});

/** Maps a standings position onto the front / middle / rear weight bracket (1-2 / 3-4 / 5-6 with six cars). */
export function rankBracket(rank, entrantCount = 6) {
  const entrants = Math.max(1, Math.floor(entrantCount) || 1);
  if (entrants <= 1) return 'middle';
  const clamped = THREE.MathUtils.clamp(Math.round(rank) || 1, 1, entrants);
  const ratio = (clamped - 1) / (entrants - 1);
  if (ratio < 1 / 3) return 'front';
  if (ratio < 2 / 3) return 'middle';
  return 'rear';
}

/** Draws an item id for the given standings position using the bracket weights and an injectable rng. */
export function rollItemForRank(rank, { entrantCount = 6, random = Math.random } = {}) {
  const weights = ITEM_WEIGHTS[rankBracket(rank, entrantCount)];
  let total = 0;
  for (const id of ITEM_IDS) total += weights[id] ?? 0;
  let roll = random() * total;
  for (const id of ITEM_IDS) {
    roll -= weights[id] ?? 0;
    if (roll < 0) return id;
  }
  return ITEM_IDS[ITEM_IDS.length - 1];
}

const DEFAULT_PICKUPS = Object.freeze([
  [0.075, -2.7], [0.145, 2.4], [0.225, 0], [0.305, -2.5],
  [0.385, 2.7], [0.465, -0.3], [0.555, -2.6], [0.635, 2.5],
  [0.715, 0.2], [0.795, -2.4], [0.875, 2.6], [0.945, 0],
]);
const UP = new THREE.Vector3(0, 1, 0);

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function createPickupMesh() {
  const group = new THREE.Group();
  const shellMaterial = new THREE.MeshStandardMaterial({
    color: 0x183844,
    emissive: 0x35e7ff,
    emissiveIntensity: 1.8,
    roughness: 0.28,
    metalness: 0.48,
    transparent: true,
    opacity: 0.78,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xf1fdff, toneMapped: false });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0x35e7ff,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 1.25), shellMaterial);
  shell.rotation.set(0.2, Math.PI / 4, 0.2);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.46), coreMaterial);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.055, 8, 28), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  group.add(shell, core, ring);
  group.userData.shell = shell;
  group.userData.ring = ring;
  return group;
}

function createMissileMesh() {
  const geometry = new THREE.ConeGeometry(0.3, 1.35, 10);
  geometry.rotateX(Math.PI / 2);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: ITEM_DEFINITIONS.missile.color, toneMapped: false }),
  );
}

function createBananaMesh() {
  const geometry = new THREE.SphereGeometry(0.5, 10, 8);
  geometry.scale(1, 0.42, 1);
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: ITEM_DEFINITIONS.banana.color, toneMapped: false }),
  );
}

function createBombMesh() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 10),
    new THREE.MeshBasicMaterial({
      color: ITEM_DEFINITIONS.bomb.color,
      transparent: true,
      opacity: 0.92,
      toneMapped: false,
    }),
  );
}

function disposeMesh(mesh) {
  mesh.removeFromParent();
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/** Single-player item-race rules and track-side pickup presentation. */
export class ItemRaceSystem {
  constructor(options = {}) {
    if (!options.scene || !options.player || !options.trackCurve) {
      throw new Error('ItemRaceSystem requires scene, player and trackCurve.');
    }
    this.scene = options.scene;
    this.player = options.player;
    this.rivals = options.rivals ?? [];
    this.trackCurve = options.trackCurve;
    this.trackLength = this.trackCurve.getLength();
    this.random = options.random ?? Math.random;
    this.enabled = false;
    this.inventory = null;
    this.shieldTime = 0;
    this.playerSlowTime = 0;
    this.playerSpinTime = 0;
    this.playerSteerTime = 0;
    this.elapsed = 0;
    this._listeners = new Map();
    this._point = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._tangent2 = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this.effects = [];
    this.projectiles = [];
    this.hazards = [];
    this._nextObjectId = 1;

    this.dynamicGroup = new THREE.Group();
    this.dynamicGroup.name = 'item-race-objects';
    this.scene.add(this.dynamicGroup);

    this.group = new THREE.Group();
    this.group.name = 'item-race-pickups';
    this.scene.add(this.group);
    this.pickups = (options.pickups ?? DEFAULT_PICKUPS).map(([progress, lane], index) => {
      const object = createPickupMesh();
      this.trackCurve.getPointAt(wrap01(progress), this._point);
      this.trackCurve.getTangentAt(wrap01(progress), this._tangent).setY(0).normalize();
      this._side.crossVectors(UP, this._tangent).normalize();
      object.position.copy(this._point).addScaledVector(this._side, lane);
      object.position.y += 1.05;
      this.group.add(object);
      return { index, progress: wrap01(progress), lane, object, active: true, cooldown: 0 };
    });

    this.shieldMesh = new THREE.Mesh(
      new THREE.SphereGeometry(2.25, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0xd9ff43,
        transparent: true,
        opacity: 0.13,
        wireframe: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.shieldMesh.visible = false;
    this.scene.add(this.shieldMesh);
    this.setEnabled(false);
  }

  on(eventName, listener) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(listener);
    return () => this._listeners.get(eventName)?.delete(listener);
  }

  _emit(eventName, payload = {}) {
    for (const listener of this._listeners.get(eventName) ?? []) listener(payload, this);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.group.visible = this.enabled;
    this.dynamicGroup.visible = this.enabled;
    if (!this.enabled) this.shieldMesh.visible = false;
    return this;
  }

  reset({ enabled = this.enabled } = {}) {
    this.inventory = null;
    this.shieldTime = 0;
    this.playerSlowTime = 0;
    this.playerSpinTime = 0;
    this.playerSteerTime = 0;
    this.elapsed = 0;
    for (const pickup of this.pickups) {
      pickup.active = true;
      pickup.cooldown = 0;
      pickup.object.visible = true;
    }
    for (const rival of this.rivals) {
      rival.itemInventory = null;
      rival.itemPickupTimer = 4.5 + this.random() * 4;
      rival.itemSlowTime = 0;
      rival.itemBoostTime = 0;
      rival.itemShieldTime = 0;
      rival.itemSpinTime = 0;
    }
    for (const effect of this.effects.splice(0)) {
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
    }
    for (const projectile of this.projectiles.splice(0)) disposeMesh(projectile.mesh);
    for (const hazard of this.hazards.splice(0)) disposeMesh(hazard.mesh);
    this.setEnabled(enabled);
    this._emit('inventory', { item: null });
    return this;
  }

  update(deltaSeconds, { racing = true } = {}) {
    const delta = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, 0.1);
    if (!this.enabled || delta <= 0) return;
    this.elapsed += delta;
    this._animatePickups(delta);
    this._updateEffects(delta);
    this.shieldMesh.position.copy(this.player.position);
    this.shieldMesh.position.y += 0.9;
    this.shieldMesh.rotation.y += delta * 0.9;
    this.shieldMesh.visible = this.shieldTime > 0;
    if (!racing) return;

    this.shieldTime = Math.max(0, this.shieldTime - delta);
    this.playerSlowTime = Math.max(0, this.playerSlowTime - delta);
    this.playerSpinTime = Math.max(0, this.playerSpinTime - delta);
    this.playerSteerTime = Math.max(0, this.playerSteerTime - delta);
    if (this.playerSlowTime > 0) {
      const speed = this.player.velocity.length();
      const limit = this.player.config.maxSpeed * (this.playerSpinTime > 0 ? 0.3 : 0.64);
      if (speed > limit) this.player.velocity.multiplyScalar(limit / speed);
    }
    if (this.playerSpinTime > 0) {
      this.player.heading += delta * 5.6;
    } else if (this.playerSteerTime > 0) {
      this.player.heading += Math.sin(this.elapsed * 22) * delta * 2.4;
    }
    this._checkPlayerPickup();
    this._updateAiItems(delta);
    this._updateProjectiles(delta);
    this._updateHazards(delta);
  }

  useItem() {
    if (!this.enabled || !this.inventory) return false;
    const item = this.inventory;
    this.inventory = null;
    let affected = 0;
    if (item === 'turbo') {
      this.player.nitro += 42;
      this.player.getForwardVector(this._forward);
      this.player.velocity.addScaledVector(this._forward, 8.5);
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.8);
      affected = 1;
    } else if (item === 'shield') {
      this.shieldTime = 7;
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.65);
      affected = 1;
    } else if (item === 'emp') {
      const target = this._nearestRivalAhead(105);
      if (target) {
        if (target.itemShieldTime > 0) target.itemShieldTime = 0;
        else {
          target.itemSlowTime = 3.2;
          target.speed *= 0.54;
        }
        affected = 1;
      }
      this._spawnWave(ITEM_DEFINITIONS[item].color, 1.15);
    } else if (item === 'shockwave') {
      const playerProgress = this._playerProgress();
      for (const rival of this._activeRivals()) {
        const distance = Math.abs(rival.raceProgress - playerProgress) * this.trackLength;
        if (distance > 30) continue;
        if (rival.itemShieldTime > 0) rival.itemShieldTime = 0;
        else {
          rival.itemSlowTime = Math.max(rival.itemSlowTime, 1.65);
          rival.speed *= 0.68;
          rival.targetLane = -rival.lane;
        }
        affected += 1;
      }
      this._spawnWave(ITEM_DEFINITIONS[item].color, 1.6);
    } else if (item === 'missile') {
      // No rival ahead: the missile still launches and flies straight for 3s before
      // self-destructing (matches the existing "consume on use, affected: 0 => miss" pattern).
      const target = this._nearestRivalAhead(ITEM_TUNING.missile.lockRange);
      this._launchMissile({
        ownerKind: 'player',
        raceProgress: this._playerProgress(),
        curveT: this.player.progress,
        lane: this.player.state.roadOffset,
        speed: this.player.speed,
        target: target ? { kind: 'rival', rival: target } : null,
      });
      affected = target ? 1 : 0;
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.7);
    } else if (item === 'banana') {
      this._dropBanana({
        ownerKind: 'player',
        curveT: this.player.progress - ITEM_TUNING.banana.dropBack / this.trackLength,
        lane: this.player.state.roadOffset,
      });
      affected = 1;
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.45);
    } else if (item === 'bomb') {
      this._throwBomb({
        ownerKind: 'player',
        curveT: this.player.progress,
        origin: this.player.position,
      });
      affected = 1;
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.55);
    }
    this._emit('inventory', { item: null });
    this._emit('use', { item, definition: ITEM_DEFINITIONS[item], affected });
    return true;
  }

  /** In-flight projectiles (missiles and thrown bombs) in world coordinates sampled from the track curve. */
  getProjectiles() {
    return this.projectiles.map((projectile) => ({
      id: projectile.id,
      type: projectile.type,
      position: {
        x: projectile.mesh.position.x,
        y: projectile.mesh.position.y,
        z: projectile.mesh.position.z,
      },
      heading: projectile.heading,
    }));
  }

  /** Track-side hazards (dropped bananas) in world coordinates. */
  getHazards() {
    return this.hazards.map((hazard) => ({
      id: hazard.id,
      type: hazard.type,
      position: {
        x: hazard.mesh.position.x,
        y: hazard.mesh.position.y,
        z: hazard.mesh.position.z,
      },
      age: hazard.age,
    }));
  }

  _animatePickups(delta) {
    for (const pickup of this.pickups) {
      if (!pickup.active) {
        pickup.cooldown = Math.max(0, pickup.cooldown - delta);
        if (pickup.cooldown <= 0) {
          pickup.active = true;
          pickup.object.visible = true;
        }
        continue;
      }
      pickup.object.rotation.y += delta * 1.65;
      pickup.object.userData.shell.rotation.x += delta * 0.72;
      pickup.object.userData.ring.rotation.z += delta * 0.58;
      pickup.object.position.y += Math.sin(this.elapsed * 3.4 + pickup.index) * delta * 0.08;
    }
  }

  _checkPlayerPickup() {
    if (this.inventory) return;
    for (const pickup of this.pickups) {
      if (!pickup.active || pickup.object.position.distanceToSquared(this.player.position) > 8.4) continue;
      pickup.active = false;
      pickup.cooldown = 7.5;
      pickup.object.visible = false;
      const item = rollItemForRank(this._rankForPlayer(), {
        entrantCount: this._entrantCount(),
        random: this.random,
      });
      this.inventory = item;
      this._spawnWave(ITEM_DEFINITIONS[item].color, 0.5);
      this._emit('pickup', { item, definition: ITEM_DEFINITIONS[item] });
      this._emit('inventory', { item });
      break;
    }
  }

  _updateAiItems(delta) {
    const playerProgress = this._playerProgress();
    for (const rival of this._activeRivals()) {
      rival.itemSlowTime = Math.max(0, (rival.itemSlowTime || 0) - delta);
      rival.itemBoostTime = Math.max(0, (rival.itemBoostTime || 0) - delta);
      rival.itemShieldTime = Math.max(0, (rival.itemShieldTime || 0) - delta);
      rival.itemSpinTime = Math.max(0, (rival.itemSpinTime || 0) - delta);
      rival.itemPickupTimer = Math.max(0, (rival.itemPickupTimer || 0) - delta);
      if (rival.itemSlowTime > 0) rival.speed = Math.min(rival.speed, rival.baseSpeed * 0.58);
      if (rival.itemBoostTime > 0) rival.speed = Math.max(rival.speed, rival.baseSpeed * 1.12 + 3);
      if (rival.itemSpinTime > 0) {
        rival.speed = Math.min(rival.speed, rival.baseSpeed * 0.3);
        rival.targetLane = (rival.baseLane ?? rival.lane ?? 0) + Math.sin(this.elapsed * 16) * 1.5;
      }
      if (!rival.itemInventory && rival.itemPickupTimer <= 0) {
        rival.itemInventory = rollItemForRank(this._rankForRival(rival), {
          entrantCount: this._entrantCount(),
          random: this.random,
        });
        rival.itemPickupTimer = 7 + this.random() * 5;
      }
      if (!rival.itemInventory) continue;

      const gapToPlayer = (playerProgress - rival.raceProgress) * this.trackLength;
      const missileTarget = rival.itemInventory === 'missile'
        ? this._nearestAheadOf(rival, ITEM_TUNING.missile.lockRange)
        : null;
      const shouldUse = rival.itemInventory === 'turbo'
        || (rival.itemInventory === 'shield' && gapToPlayer > -45 && gapToPlayer < 18)
        || (rival.itemInventory === 'emp' && gapToPlayer > 8 && gapToPlayer < 92)
        || (rival.itemInventory === 'shockwave' && Math.abs(gapToPlayer) < 25)
        || (rival.itemInventory === 'missile' && missileTarget
          && missileTarget.distance > 10 && missileTarget.distance < 190)
        || (rival.itemInventory === 'banana' && gapToPlayer < -8
          && this._isStraightAt(this._rivalCurveT(rival)))
        || (rival.itemInventory === 'bomb'
          && rankBracket(this._rankForRival(rival), this._entrantCount()) === 'middle');
      if (!shouldUse) continue;
      const item = rival.itemInventory;
      rival.itemInventory = null;
      if (item === 'turbo') rival.itemBoostTime = 2.8;
      else if (item === 'shield') rival.itemShieldTime = 6;
      else if (item === 'missile') {
        this._launchMissile({
          ownerKind: 'rival',
          owner: rival,
          raceProgress: rival.raceProgress,
          curveT: this._rivalCurveT(rival),
          lane: rival.lane ?? 0,
          speed: rival.speed,
          target: missileTarget,
        });
      } else if (item === 'banana') {
        this._dropBanana({
          ownerKind: 'rival',
          owner: rival,
          curveT: this._rivalCurveT(rival) - ITEM_TUNING.banana.dropBack / this.trackLength,
          lane: rival.lane ?? 0,
        });
      } else if (item === 'bomb') {
        this._throwBomb({
          ownerKind: 'rival',
          owner: rival,
          curveT: this._rivalCurveT(rival),
          origin: rival.object?.position
            ?? this._worldPointAt(this._rivalCurveT(rival), rival.lane ?? 0, new THREE.Vector3()),
        });
      } else if (this.shieldTime > 0) {
        this.shieldTime = Math.max(0, this.shieldTime - 3.5);
        this._emit('hit', { item, blocked: true, rival });
      } else {
        this.playerSlowTime = item === 'emp' ? 2.7 : 1.45;
        this.player.velocity.multiplyScalar(item === 'emp' ? 0.6 : 0.76);
        this._emit('hit', { item, blocked: false, rival });
      }
    }
  }

  _activeRivals() {
    return this.rivals.filter((rival) => rival.object?.visible !== false && !rival.finished);
  }

  _playerProgress() {
    return this.player.state.lapsCompleted + this.player.state.lapProgress;
  }

  _nearestRivalAhead(maxDistance) {
    const playerProgress = this._playerProgress();
    let target = null;
    let nearest = maxDistance;
    for (const rival of this._activeRivals()) {
      const distance = (rival.raceProgress - playerProgress) * this.trackLength;
      if (distance <= 0 || distance >= nearest) continue;
      target = rival;
      nearest = distance;
    }
    return target;
  }

  _entrantCount() {
    return this._activeRivals().length + 1;
  }

  _rankForPlayer() {
    const playerProgress = this._playerProgress();
    let rank = 1;
    for (const rival of this._activeRivals()) {
      if (rival.raceProgress > playerProgress) rank += 1;
    }
    return rank;
  }

  _rankForRival(rival) {
    let rank = this._playerProgress() > rival.raceProgress ? 2 : 1;
    for (const other of this._activeRivals()) {
      if (other !== rival && other.raceProgress > rival.raceProgress) rank += 1;
    }
    return rank;
  }

  _rivalCurveT(rival) {
    return wrap01(Number.isFinite(rival.progress) ? rival.progress : rival.raceProgress);
  }

  _nearestAheadOf(rival, maxDistance) {
    let best = null;
    let nearest = maxDistance;
    const consider = (kind, ref, progress) => {
      const distance = (progress - rival.raceProgress) * this.trackLength;
      if (distance <= 0 || distance >= nearest) return;
      best = { kind, rival: ref };
      nearest = distance;
    };
    consider('player', null, this._playerProgress());
    for (const other of this._activeRivals()) {
      if (other !== rival) consider('rival', other, other.raceProgress);
    }
    return best ? { ...best, distance: nearest } : null;
  }

  _isStraightAt(curveT) {
    this.trackCurve.getTangentAt(wrap01(curveT), this._tangent).setY(0).normalize();
    this.trackCurve.getTangentAt(wrap01(curveT + 0.012), this._tangent2).setY(0).normalize();
    return this._tangent.dot(this._tangent2) > 0.9945;
  }

  /** Samples the track at curveT plus a lateral lane offset. Leaves the flat tangent in this._tangent. */
  _worldPointAt(curveT, lane, target) {
    const t = wrap01(curveT);
    this.trackCurve.getPointAt(t, target);
    this.trackCurve.getTangentAt(t, this._tangent).setY(0).normalize();
    this._side.crossVectors(UP, this._tangent).normalize();
    return target.addScaledVector(this._side, lane);
  }

  _placeProjectileOnTrack(projectile) {
    this._worldPointAt(projectile.curveT, projectile.lane, this._point);
    projectile.mesh.position.copy(this._point);
    projectile.mesh.position.y += 0.85;
    projectile.heading = Math.atan2(this._tangent.x, this._tangent.z);
    projectile.mesh.rotation.y = projectile.heading;
  }

  _launchMissile({ ownerKind, owner = null, raceProgress, curveT, lane, speed, target }) {
    const tuning = ITEM_TUNING.missile;
    const mesh = createMissileMesh();
    this.dynamicGroup.add(mesh);
    const projectile = {
      id: `fx-${this._nextObjectId++}`,
      type: 'missile',
      ownerKind,
      owner,
      targetKind: target?.kind ?? null,
      target: target?.rival ?? null,
      raceProgress,
      curveT: wrap01(curveT),
      lane,
      age: 0,
      life: target ? tuning.life : tuning.freeLife,
      freeSpeed: Math.max(Number(speed) || 0, tuning.freeFlightSpeed),
      heading: 0,
      mesh,
    };
    this._placeProjectileOnTrack(projectile);
    this.projectiles.push(projectile);
    return projectile;
  }

  _dropBanana({ ownerKind, owner = null, curveT, lane }) {
    const mesh = createBananaMesh();
    this._worldPointAt(curveT, lane, mesh.position);
    mesh.position.y += 0.14;
    this.dynamicGroup.add(mesh);
    const hazard = {
      id: `fx-${this._nextObjectId++}`,
      type: 'banana',
      ownerKind,
      owner,
      age: 0,
      life: ITEM_TUNING.banana.life,
      mesh,
    };
    this.hazards.push(hazard);
    return hazard;
  }

  _throwBomb({ ownerKind, owner = null, curveT, origin }) {
    const tuning = ITEM_TUNING.bomb;
    const landPosition = this._worldPointAt(
      curveT + tuning.throwDistance / this.trackLength,
      0,
      new THREE.Vector3(),
    );
    landPosition.y += 0.35;
    const launchPosition = origin.clone();
    launchPosition.y += 0.8;
    const mesh = createBombMesh();
    mesh.position.copy(launchPosition);
    this.dynamicGroup.add(mesh);
    const projectile = {
      id: `fx-${this._nextObjectId++}`,
      type: 'bomb',
      ownerKind,
      owner,
      age: 0,
      launchPosition,
      landPosition,
      heading: Math.atan2(landPosition.x - launchPosition.x, landPosition.z - launchPosition.z),
      mesh,
    };
    this.projectiles.push(projectile);
    return projectile;
  }

  _updateProjectiles(delta) {
    const playerProgress = this._playerProgress();
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      projectile.age += delta;
      if (projectile.type === 'missile') {
        const tuning = ITEM_TUNING.missile;
        if (projectile.targetKind === 'rival'
          && (projectile.target?.finished || projectile.target?.object?.visible === false)) {
          projectile.targetKind = null;
          projectile.target = null;
          projectile.life = Math.min(projectile.life, projectile.age + tuning.freeLife);
        }
        const targetSpeed = projectile.targetKind === 'player'
          ? this.player.speed
          : projectile.targetKind === 'rival' ? projectile.target.speed : null;
        const chaseSpeed = targetSpeed === null
          ? projectile.freeSpeed * tuning.speedFactor
          : Math.max(targetSpeed, tuning.minChaseSpeed) * tuning.speedFactor;
        const advance = (chaseSpeed / this.trackLength) * delta;
        projectile.raceProgress += advance;
        projectile.curveT = wrap01(projectile.curveT + advance);
        const targetLane = projectile.targetKind === 'player'
          ? this.player.state.roadOffset
          : projectile.targetKind === 'rival' ? (projectile.target.lane ?? 0) : projectile.lane;
        projectile.lane = THREE.MathUtils.lerp(projectile.lane, targetLane, 1 - Math.exp(-4 * delta));
        this._placeProjectileOnTrack(projectile);
        const targetProgress = projectile.targetKind === 'player'
          ? playerProgress
          : projectile.targetKind === 'rival' ? projectile.target.raceProgress : null;
        if (targetProgress !== null && projectile.raceProgress >= targetProgress) {
          this._missileImpact(projectile);
          this._removeProjectileAt(index);
        } else if (projectile.age >= projectile.life) {
          this._removeProjectileAt(index);
        }
      } else if (projectile.type === 'bomb') {
        const tuning = ITEM_TUNING.bomb;
        const arc = Math.min(1, projectile.age / tuning.fuse);
        projectile.mesh.position.lerpVectors(projectile.launchPosition, projectile.landPosition, arc);
        projectile.mesh.position.y += Math.sin(arc * Math.PI) * tuning.arcHeight;
        if (projectile.age >= tuning.fuse) {
          this._explodeBomb(projectile);
          this._removeProjectileAt(index);
        }
      }
    }
  }

  _removeProjectileAt(index) {
    const [projectile] = this.projectiles.splice(index, 1);
    disposeMesh(projectile.mesh);
  }

  _missileImpact(projectile) {
    const tuning = ITEM_TUNING.missile;
    this._worldPointAt(projectile.curveT, projectile.lane, this._point);
    if (projectile.targetKind === 'player') {
      const blocked = this.shieldTime > 0;
      if (blocked) this.shieldTime = 0;
      else {
        this.player.velocity.multiplyScalar(tuning.slowFactor);
        this.playerSlowTime = Math.max(this.playerSlowTime, tuning.spinTime);
        this.playerSpinTime = Math.max(this.playerSpinTime, tuning.spinTime);
      }
      this._emit('hit', { item: 'missile', blocked, rival: projectile.owner });
    } else if (projectile.targetKind === 'rival') {
      const rival = projectile.target;
      const blocked = (rival.itemShieldTime || 0) > 0;
      if (blocked) rival.itemShieldTime = 0;
      else {
        rival.speed *= tuning.slowFactor;
        rival.itemSlowTime = Math.max(rival.itemSlowTime || 0, tuning.spinTime);
        rival.itemSpinTime = Math.max(rival.itemSpinTime || 0, tuning.spinTime);
      }
      this._emit('strike', { item: 'missile', rival, blocked, ownerKind: projectile.ownerKind });
    }
    this._spawnWave(ITEM_DEFINITIONS.missile.color, 1.05, this._point);
  }

  _explodeBomb(projectile) {
    const tuning = ITEM_TUNING.bomb;
    const center = projectile.landPosition;
    const radiusSq = tuning.radius * tuning.radius;
    let affected = 0;
    if (this.player.position.distanceToSquared(center) <= radiusSq) {
      const blocked = this.shieldTime > 0;
      if (blocked) this.shieldTime = Math.max(0, this.shieldTime - 3.5);
      else {
        this.player.velocity.multiplyScalar(tuning.slowFactor);
        this.playerSlowTime = Math.max(this.playerSlowTime, tuning.effectTime);
      }
      affected += 1;
      this._emit('hit', {
        item: 'bomb',
        blocked,
        rival: projectile.ownerKind === 'rival' ? projectile.owner : null,
      });
    }
    for (const rival of this._activeRivals()) {
      if (!rival.object || rival.object.position.distanceToSquared(center) > radiusSq) continue;
      const blocked = (rival.itemShieldTime || 0) > 0;
      if (blocked) rival.itemShieldTime = 0;
      else {
        rival.speed *= tuning.slowFactor;
        rival.itemSlowTime = Math.max(rival.itemSlowTime || 0, tuning.effectTime);
      }
      affected += 1;
      this._emit('strike', { item: 'bomb', rival, blocked, ownerKind: projectile.ownerKind });
    }
    this._emit('explosion', {
      item: 'bomb',
      ownerKind: projectile.ownerKind,
      affected,
      position: { x: center.x, y: center.y, z: center.z },
    });
    this._spawnWave(ITEM_DEFINITIONS.bomb.color, 1.7, center);
  }

  _updateHazards(delta) {
    const tuning = ITEM_TUNING.banana;
    const radiusSq = tuning.radius * tuning.radius;
    for (let index = this.hazards.length - 1; index >= 0; index -= 1) {
      const hazard = this.hazards[index];
      hazard.age += delta;
      if (hazard.age >= hazard.life) {
        disposeMesh(hazard.mesh);
        this.hazards.splice(index, 1);
        continue;
      }
      hazard.mesh.rotation.y += delta * 2.2;
      let consumed = false;
      const playerImmune = hazard.ownerKind === 'player' && hazard.age < tuning.ownerImmunity;
      if (!playerImmune && this.player.position.distanceToSquared(hazard.mesh.position) <= radiusSq) {
        const blocked = this.shieldTime > 0;
        if (blocked) this.shieldTime = Math.max(0, this.shieldTime - 3.5);
        else {
          this.player.velocity.multiplyScalar(tuning.slowFactor);
          this.playerSlowTime = Math.max(this.playerSlowTime, tuning.effectTime);
          this.playerSteerTime = Math.max(this.playerSteerTime, tuning.effectTime);
        }
        this._emit('hit', {
          item: 'banana',
          blocked,
          rival: hazard.ownerKind === 'rival' ? hazard.owner : null,
        });
        consumed = true;
      }
      if (!consumed) {
        for (const rival of this._activeRivals()) {
          if (!rival.object) continue;
          if (hazard.owner === rival && hazard.age < tuning.ownerImmunity) continue;
          if (rival.object.position.distanceToSquared(hazard.mesh.position) > radiusSq) continue;
          const blocked = (rival.itemShieldTime || 0) > 0;
          if (blocked) rival.itemShieldTime = 0;
          else {
            rival.speed *= tuning.slowFactor;
            rival.itemSlowTime = Math.max(rival.itemSlowTime || 0, tuning.effectTime);
            rival.targetLane = (rival.lane ?? 0) === 0 ? 1.6 : -(rival.lane ?? 0);
          }
          this._emit('strike', { item: 'banana', rival, blocked, ownerKind: hazard.ownerKind });
          consumed = true;
          break;
        }
      }
      if (consumed) {
        this._spawnWave(ITEM_DEFINITIONS.banana.color, 0.5, hazard.mesh.position);
        disposeMesh(hazard.mesh);
        this.hazards.splice(index, 1);
      }
    }
  }

  _spawnWave(color, strength = 1, position = this.player.position) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y += 0.18;
    this.scene.add(mesh);
    this.effects.push({ mesh, age: 0, life: 0.62, strength });
  }

  _updateEffects(delta) {
    for (let index = this.effects.length - 1; index >= 0; index -= 1) {
      const effect = this.effects[index];
      effect.age += delta;
      const progress = effect.age / effect.life;
      effect.mesh.scale.setScalar(1 + progress * 7 * effect.strength);
      effect.mesh.material.opacity = (1 - progress) * 0.72;
      if (progress < 1) continue;
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
      this.effects.splice(index, 1);
    }
  }
}

export default ItemRaceSystem;
