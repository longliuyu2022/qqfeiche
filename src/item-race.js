import * as THREE from 'three';

export const ITEM_DEFINITIONS = Object.freeze({
  turbo: Object.freeze({ id: 'turbo', label: '氮气瓶', icon: 'N2O', color: 0x35e7ff }),
  shield: Object.freeze({ id: 'shield', label: '能量盾', icon: 'DEF', color: 0xd9ff43 }),
  emp: Object.freeze({ id: 'emp', label: '电磁脉冲', icon: 'EMP', color: 0xffcf5a }),
  shockwave: Object.freeze({ id: 'shockwave', label: '冲击波', icon: 'WAVE', color: 0xff4f61 }),
});

const ITEM_IDS = Object.keys(ITEM_DEFINITIONS);
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
    this.elapsed = 0;
    this._listeners = new Map();
    this._point = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this.effects = [];

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
    if (!this.enabled) this.shieldMesh.visible = false;
    return this;
  }

  reset({ enabled = this.enabled } = {}) {
    this.inventory = null;
    this.shieldTime = 0;
    this.playerSlowTime = 0;
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
    }
    for (const effect of this.effects.splice(0)) {
      effect.mesh.removeFromParent();
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
    }
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
    if (this.playerSlowTime > 0) {
      const speed = this.player.velocity.length();
      const limit = this.player.config.maxSpeed * 0.64;
      if (speed > limit) this.player.velocity.multiplyScalar(limit / speed);
    }
    this._checkPlayerPickup();
    this._updateAiItems(delta);
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
    }
    this._emit('inventory', { item: null });
    this._emit('use', { item, definition: ITEM_DEFINITIONS[item], affected });
    return true;
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
      const item = ITEM_IDS[Math.min(ITEM_IDS.length - 1, Math.floor(this.random() * ITEM_IDS.length))];
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
      rival.itemPickupTimer = Math.max(0, (rival.itemPickupTimer || 0) - delta);
      if (rival.itemSlowTime > 0) rival.speed = Math.min(rival.speed, rival.baseSpeed * 0.58);
      if (rival.itemBoostTime > 0) rival.speed = Math.max(rival.speed, rival.baseSpeed * 1.12 + 3);
      if (!rival.itemInventory && rival.itemPickupTimer <= 0) {
        rival.itemInventory = ITEM_IDS[Math.floor(this.random() * ITEM_IDS.length)];
        rival.itemPickupTimer = 7 + this.random() * 5;
      }
      if (!rival.itemInventory) continue;

      const gapToPlayer = (playerProgress - rival.raceProgress) * this.trackLength;
      const shouldUse = rival.itemInventory === 'turbo'
        || (rival.itemInventory === 'shield' && gapToPlayer > -45 && gapToPlayer < 18)
        || (rival.itemInventory === 'emp' && gapToPlayer > 8 && gapToPlayer < 92)
        || (rival.itemInventory === 'shockwave' && Math.abs(gapToPlayer) < 25);
      if (!shouldUse) continue;
      const item = rival.itemInventory;
      rival.itemInventory = null;
      if (item === 'turbo') rival.itemBoostTime = 2.8;
      else if (item === 'shield') rival.itemShieldTime = 6;
      else if (this.shieldTime > 0) {
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

  _spawnWave(color, strength = 1) {
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
    mesh.position.copy(this.player.position);
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
