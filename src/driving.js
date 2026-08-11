import * as THREE from 'three';

const EPSILON = 1e-6;
const DEFAULT_KEYBOARD_STEER_SCALE = 0.55;
const CONTROL_NAMES = ['throttle', 'brake', 'steer', 'drift', 'nitro'];

const DEFAULTS = Object.freeze({
  maxSpeed: 76,
  maxReverseSpeed: 12,
  acceleration: 31,
  reverseAcceleration: 13,
  brakeDeceleration: 46,
  rollingResistance: 0.65,
  aerodynamicDrag: 0.00145,
  steeringRate: 2.25,
  steeringResponse: 10,
  normalGrip: 10.5,
  driftGrip: 1.45,
  driftYawMultiplier: 1.42,
  driftMinSpeed: 11,
  nitroAcceleration: 25,
  nitroSpeedMultiplier: 1.28,
  nitroCapacity: 100,
  nitroDrainRate: 25,
  nitroRechargeRate: 1.4,
  driftNitroBaseRate: 5,
  driftNitroRate: 18,
  driftNitroBankRate: 3.5,
  trackWidth: 18,
  roadMargin: 1.1,
  offroadDrag: 8,
  boundarySpring: 28,
  boundaryGrip: 12,
  collisionRestitution: 0.12,
  collisionSpeedRetention: 0.72,
  collisionCooldown: 0.28,
  rideHeight: 0,
  totalLaps: 3,
  checkpointCount: 16,
  checkpointGatePadding: 1.8,
  shortcutTolerance: 0.018,
  shortcutRespawnDelay: 0.9,
  crashRespawnSpeed: 28,
  crashHeadOnRatio: 0.98,
  wrongWayRespawnTime: 4,
  stuckRespawnTime: 3.2,
  respawnPenalty: 2,
  respawnLaunchSpeed: 7,
  driftScoreRate: 125,
  minScoredDriftTime: 0.32,
  comboWindow: 3.2,
  maxCombo: 6,
  nitroChainWindow: 3.4,
  nitroChainDrainReduction: 0.07,
  nitroChainAccelerationBonus: 0.04,
  maxDelta: 0.1,
  maxSubstep: 1 / 90,
});

const DEFAULT_KEYS = Object.freeze({
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  drift: ['Space'],
  nitro: ['ShiftLeft', 'ShiftRight', 'KeyN'],
});

const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _outward = new THREE.Vector3();

function clamp01(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function damp(current, target, response, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function horizontalLength(vector) {
  return Math.hypot(vector.x, vector.z);
}

/**
 * Stable, kinematic arcade car controller for an XZ-oriented Three.js world.
 * Units are metres, seconds and radians. Heading 0 points along world +Z.
 */
export class ArcadeVehicle {
  constructor(options = {}) {
    this.config = { ...DEFAULTS, ...options };
    this.object = options.object ?? null;
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.heading = Number.isFinite(options.startHeading) ? options.startHeading : 0;
    this.yawRate = 0;
    this.steering = 0;

    this.input = { throttle: 0, brake: 0, steer: 0, drift: 0, nitro: 0 };
    this._manualInput = { ...this.input };
    this._keyboardInput = { ...this.input };
    this._touchInput = { ...this.input };
    this._pressedKeys = new Set();
    this._inputCleanup = [];
    this._listeners = new Map();

    this.centerline = [];
    this._segments = [];
    this.trackLength = 0;
    this.trackClosed = options.trackClosed !== false;
    this.trackWidth = options.trackWidth ?? DEFAULTS.trackWidth;
    this._trackSample = null;
    this._sampleScratch = this._createTrackSample();
    this._querySampleScratch = this._createTrackSample();
    this._lastTrackProgress = 0;
    this._courseProgress = 0;
    this._wrongWayTime = 0;
    this._raceCheckpoints = [];
    this._nextCheckpointNumber = 1;
    this._lastValidRespawn = null;
    this._previousRacePosition = new THREE.Vector3();
    this._missedCheckpointNumber = -1;
    this._collisionCooldown = 0;
    this._wrongWayRespawnTime = 0;
    this._stuckTime = 0;
    this._respawnTimer = 0;
    this._respawnReason = null;
    this._wasDrifting = false;
    this._wasBoosting = false;
    this._driftSessionScore = 0;
    this._driftSessionTime = 0;
    this._driftSessionNitro = 0;
    this._pendingNitroLinks = 0;

    this.state = {
      speedMps: 0,
      speedKph: 0,
      forwardSpeed: 0,
      normalizedSpeed: 0,
      heading: this.heading,
      yawRate: 0,
      steering: 0,
      slipAngle: 0,
      driftIntensity: 0,
      isDrifting: false,
      isBoosting: false,
      nitro: this.config.nitroCapacity,
      nitroNormalized: 1,
      roadOffset: 0,
      offroad: 0,
      trackProgress: 0,
      lapProgress: 0,
      raceProgress: 0,
      lap: 1,
      totalLaps: Math.max(1, Math.floor(this.config.totalLaps)),
      lapsCompleted: 0,
      raceTime: 0,
      currentLapTime: 0,
      lastLapTime: null,
      bestLapTime: null,
      started: false,
      paused: false,
      finished: false,
      wrongWay: false,
      checkpointIndex: 0,
      nextCheckpoint: 1,
      checkpointCount: Math.max(4, Math.floor(this.config.checkpointCount)),
      checkpointsPassed: 0,
      routeValid: true,
      missedCheckpoint: false,
      shortcutStrikes: 0,
      collisionImpact: 0,
      collisionCount: 0,
      respawnPending: false,
      respawnCount: 0,
      respawnPenalty: 0,
      driftScore: 0,
      lastDriftScore: 0,
      driftDuration: 0,
      driftNitroEarned: 0,
      lastDriftNitro: 0,
      skillScore: 0,
      combo: 0,
      comboMultiplier: 1,
      comboTime: 0,
      nitroChain: 0,
      nitroChainTime: 0,
      nitroLinks: 0,
      raceStatus: 'idle',
      result: null,
      position: this.position,
      velocity: this.velocity,
    };

    const initialCenterline = options.centerline ?? options.trackCurve;
    if (initialCenterline) {
      this.setCenterline(initialCenterline, options);
    }

    const defaultStart = this.centerline[0] ?? new THREE.Vector3();
    this.position.copy(options.startPosition ?? defaultStart);
    this.position.y += options.startPosition ? 0 : this.config.rideHeight;

    if (!Number.isFinite(options.startHeading) && this._segments[0]) {
      this.heading = Math.atan2(this._segments[0].tangent.x, this._segments[0].tangent.z);
    }

    this._refreshTrackSample();
    this._lastTrackProgress = this.state.trackProgress;
    this._previousRacePosition.copy(this.position);
    this._updatePublicState();
    this.syncObject();

    if (options.autoBindKeyboard && typeof window !== 'undefined') {
      this.bindKeyboard(window, options.keys);
    }
  }

  setCenterline(points, options = {}) {
    if (typeof points?.getSpacedPoints === 'function') {
      const samples = Math.max(24, Math.floor(options.trackSamples ?? options.samples ?? 360));
      points = points.getSpacedPoints(samples);
    }
    if (!Array.isArray(points) || points.length < 2) {
      throw new Error('ArcadeVehicle centerline requires a THREE.Curve or at least two points.');
    }

    this.trackClosed = options.closed ?? options.trackClosed ?? this.trackClosed;
    this.trackWidth = options.width ?? options.trackWidth ?? this.trackWidth;
    this.centerline = points.map((point) => {
      if (point?.isVector3) return point.clone();
      if (Array.isArray(point)) return new THREE.Vector3(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
      return new THREE.Vector3(point?.x ?? 0, point?.y ?? 0, point?.z ?? 0);
    });

    if (
      this.trackClosed &&
      this.centerline.length > 2 &&
      this.centerline[0].distanceToSquared(this.centerline.at(-1)) < EPSILON
    ) {
      this.centerline.pop();
    }

    this._segments.length = 0;
    this.trackLength = 0;
    const segmentCount = this.trackClosed ? this.centerline.length : this.centerline.length - 1;

    for (let index = 0; index < segmentCount; index += 1) {
      const start = this.centerline[index];
      const end = this.centerline[(index + 1) % this.centerline.length];
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const horizontalDistance = Math.hypot(dx, dz);
      if (horizontalDistance < EPSILON) continue;

      this._segments.push({
        start,
        end,
        length: horizontalDistance,
        distanceAtStart: this.trackLength,
        tangent: new THREE.Vector3(dx / horizontalDistance, 0, dz / horizontalDistance),
      });
      this.trackLength += horizontalDistance;
    }

    if (!this._segments.length) {
      throw new Error('ArcadeVehicle centerline has no usable horizontal segments.');
    }

    this._refreshTrackSample();
    return this;
  }

  /** Returns the nearest point/tangent/progress without exposing internal scratch vectors. */
  sampleTrack(worldPosition = this.position) {
    const sample = this._findTrackSample(worldPosition, this._querySampleScratch);
    if (!sample) return null;
    return {
      point: sample.point.clone(),
      tangent: sample.tangent.clone(),
      normal: sample.normal.clone(),
      offset: sample.offset,
      distance: sample.distance,
      progress: sample.progress,
      segmentIndex: sample.segmentIndex,
    };
  }

  setInput(values = {}) {
    for (const name of CONTROL_NAMES) {
      if (!(name in values)) continue;
      const value = Number(values[name]);
      this._manualInput[name] = name === 'steer'
        ? THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, -1, 1)
        : clamp01(value);
    }
    return this;
  }

  setControl(name, value) {
    return this.setInput({ [name]: value });
  }

  clearInput() {
    for (const source of [this._manualInput, this._keyboardInput, this._touchInput, this.input]) {
      for (const name of CONTROL_NAMES) source[name] = 0;
    }
    this._pressedKeys.clear();
    return this;
  }

  bindKeyboard(target = globalThis.window, mapping = {}) {
    if (!target?.addEventListener) return () => {};
    const keys = { ...DEFAULT_KEYS, ...mapping };
    const steerScale = THREE.MathUtils.clamp(
      Number.isFinite(Number(mapping.steerScale)) ? Number(mapping.steerScale) : DEFAULT_KEYBOARD_STEER_SCALE,
      0.1,
      1,
    );
    const asArray = (value) => Array.isArray(value) ? value : [value].filter(Boolean);
    const controlledCodes = new Set(
      ['throttle', 'brake', 'left', 'right', 'drift', 'nitro'].flatMap((name) => asArray(keys[name])),
    );

    const refresh = () => {
      const pressed = (codes = []) => asArray(codes).some((code) => this._pressedKeys.has(code));
      this._keyboardInput.throttle = pressed(keys.throttle) ? 1 : 0;
      this._keyboardInput.brake = pressed(keys.brake) ? 1 : 0;
      this._keyboardInput.steer = (
        (pressed(keys.left) ? 1 : 0) - (pressed(keys.right) ? 1 : 0)
      ) * steerScale;
      this._keyboardInput.drift = pressed(keys.drift) ? 1 : 0;
      this._keyboardInput.nitro = pressed(keys.nitro) ? 1 : 0;
    };
    const onKeyDown = (event) => {
      if (!controlledCodes.has(event.code)) return;
      this._pressedKeys.add(event.code);
      refresh();
      if (mapping.preventDefault !== false) event.preventDefault();
    };
    const onKeyUp = (event) => {
      if (!controlledCodes.has(event.code)) return;
      this._pressedKeys.delete(event.code);
      refresh();
      if (mapping.preventDefault !== false) event.preventDefault();
    };
    const onBlur = () => {
      this._pressedKeys.clear();
      refresh();
    };

    target.addEventListener('keydown', onKeyDown, { passive: false });
    target.addEventListener('keyup', onKeyUp, { passive: false });
    target.addEventListener('blur', onBlur);
    const cleanup = () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      onBlur();
    };
    this._inputCleanup.push(cleanup);
    return cleanup;
  }

  /**
   * Binds pointer-safe buttons. Values can be Elements or selectors.
   * Accepted keys: left, right, throttle/accelerate, brake, drift, nitro/boost.
   */
  bindTouchControls(controls = {}, root = globalThis.document) {
    const aliases = {
      left: ['steer', 1],
      right: ['steer', -1],
      throttle: ['throttle', 1],
      accelerate: ['throttle', 1],
      brake: ['brake', 1],
      drift: ['drift', 1],
      nitro: ['nitro', 1],
      boost: ['nitro', 1],
    };
    const active = new Map();
    const cleanups = [];

    const resolveElement = (value) => typeof value === 'string' ? root?.querySelector(value) : value;
    const refresh = () => {
      this._touchInput.throttle = 0;
      this._touchInput.brake = 0;
      this._touchInput.drift = 0;
      this._touchInput.nitro = 0;
      this._touchInput.steer = 0;
      for (const binding of active.values()) {
        const [name, value] = binding;
        if (name === 'steer') this._touchInput.steer += value;
        else this._touchInput[name] = Math.max(this._touchInput[name], value);
      }
      this._touchInput.steer = THREE.MathUtils.clamp(this._touchInput.steer, -1, 1);
    };

    for (const [controlName, target] of Object.entries(controls)) {
      const binding = aliases[controlName];
      const element = resolveElement(target);
      if (!binding || !element?.addEventListener) continue;

      const onDown = (event) => {
        active.set(`${controlName}:${event.pointerId}`, binding);
        element.setPointerCapture?.(event.pointerId);
        refresh();
        event.preventDefault();
      };
      const onUp = (event) => {
        active.delete(`${controlName}:${event.pointerId}`);
        refresh();
        event.preventDefault();
      };
      element.addEventListener('pointerdown', onDown, { passive: false });
      element.addEventListener('pointerup', onUp, { passive: false });
      element.addEventListener('pointercancel', onUp, { passive: false });
      element.addEventListener('lostpointercapture', onUp, { passive: false });
      cleanups.push(() => {
        element.removeEventListener('pointerdown', onDown);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onUp);
        element.removeEventListener('lostpointercapture', onUp);
      });
    }

    const cleanup = () => {
      for (const remove of cleanups) remove();
      active.clear();
      for (const name of CONTROL_NAMES) this._touchInput[name] = 0;
    };
    this._inputCleanup.push(cleanup);
    return cleanup;
  }

  startRace({ totalLaps = this.state.totalLaps, resetTimes = true } = {}) {
    this._refreshTrackSample();
    this.state.totalLaps = Math.max(1, Math.floor(totalLaps));
    this.state.started = true;
    this.state.paused = false;
    this.state.finished = false;
    this.state.lapsCompleted = 0;
    this.state.lap = 1;
    this.state.lapProgress = 0;
    this.state.raceProgress = 0;
    this.state.raceStatus = 'racing';
    this.state.result = null;
    this.state.checkpointIndex = 0;
    this.state.nextCheckpoint = 1;
    this.state.checkpointsPassed = 0;
    this.state.routeValid = true;
    this.state.missedCheckpoint = false;
    this.state.shortcutStrikes = 0;
    this.state.collisionImpact = 0;
    this.state.collisionCount = 0;
    this.state.respawnPending = false;
    this.state.respawnCount = 0;
    this.state.respawnPenalty = 0;
    this.state.driftScore = 0;
    this.state.lastDriftScore = 0;
    this.state.driftDuration = 0;
    this.state.driftNitroEarned = 0;
    this.state.lastDriftNitro = 0;
    this.state.skillScore = 0;
    this.state.combo = 0;
    this.state.comboMultiplier = 1;
    this.state.comboTime = 0;
    this.state.nitroChain = 0;
    this.state.nitroChainTime = 0;
    this.state.nitroLinks = 0;
    this._lastTrackProgress = this.state.trackProgress;
    this._courseProgress = 0;
    this._nextCheckpointNumber = 1;
    this._missedCheckpointNumber = -1;
    this._wrongWayTime = 0;
    this.state.wrongWay = false;
    this._wrongWayRespawnTime = 0;
    this._stuckTime = 0;
    this._respawnTimer = 0;
    this._respawnReason = null;
    this._wasDrifting = false;
    this._wasBoosting = false;
    this._driftSessionScore = 0;
    this._driftSessionTime = 0;
    this._driftSessionNitro = 0;
    this._pendingNitroLinks = 0;
    this._previousRacePosition.copy(this.position);
    this._buildRaceCheckpoints(this.state.trackProgress);
    this._setRespawnAnchor(
      this._trackSample?.point ?? this.position,
      this._trackSample?.tangent ?? this.getForwardVector(),
      0,
      0,
    );
    if (resetTimes) {
      this.state.raceTime = 0;
      this.state.currentLapTime = 0;
      this.state.lastLapTime = null;
      this.state.bestLapTime = null;
    }
    this._emit('raceStart', this.getSnapshot());
    return this;
  }

  setPaused(paused = true) {
    this.state.paused = Boolean(paused);
    return this;
  }

  reset(options = {}) {
    const start = options.position ?? options.startPosition ?? this.centerline[0] ?? new THREE.Vector3();
    this.position.copy(start);
    if (!options.position && !options.startPosition) this.position.y += this.config.rideHeight;
    this.velocity.set(0, 0, 0);
    this.yawRate = 0;
    this.steering = 0;
    this.state.driftIntensity = 0;
    this.state.isDrifting = false;
    this.state.isBoosting = false;
    this.nitro = options.nitro ?? this.config.nitroCapacity;
    this.state.collisionImpact = 0;
    this.state.respawnPending = false;
    this.state.wrongWay = false;
    this._wrongWayTime = 0;
    this._wrongWayRespawnTime = 0;
    this._stuckTime = 0;
    this._collisionCooldown = 0;

    if (Number.isFinite(options.heading ?? options.startHeading)) {
      this.heading = options.heading ?? options.startHeading;
    } else if (this._segments[0]) {
      this.heading = Math.atan2(this._segments[0].tangent.x, this._segments[0].tangent.z);
    }

    this._refreshTrackSample();
    this._lastTrackProgress = this.state.trackProgress;
    if (!options.preserveRace) {
      this._courseProgress = 0;
      this.state.started = false;
      this.state.paused = false;
      this.state.finished = false;
      this.state.lapsCompleted = 0;
      this.state.lap = 1;
      this.state.lapProgress = 0;
      this.state.raceProgress = 0;
      this.state.raceTime = 0;
      this.state.currentLapTime = 0;
      this.state.lastLapTime = null;
      this.state.bestLapTime = null;
      this.state.checkpointIndex = 0;
      this.state.nextCheckpoint = 1;
      this.state.checkpointsPassed = 0;
      this.state.routeValid = true;
      this.state.missedCheckpoint = false;
      this.state.shortcutStrikes = 0;
      this.state.collisionCount = 0;
      this.state.respawnCount = 0;
      this.state.respawnPenalty = 0;
      this.state.driftScore = 0;
      this.state.lastDriftScore = 0;
      this.state.driftDuration = 0;
      this.state.driftNitroEarned = 0;
      this.state.lastDriftNitro = 0;
      this.state.skillScore = 0;
      this.state.combo = 0;
      this.state.comboMultiplier = 1;
      this.state.comboTime = 0;
      this.state.nitroChain = 0;
      this.state.nitroChainTime = 0;
      this.state.nitroLinks = 0;
      this.state.raceStatus = 'idle';
      this.state.result = null;
      this._nextCheckpointNumber = 1;
      this._missedCheckpointNumber = -1;
      this._lastValidRespawn = null;
      this._respawnTimer = 0;
      this._respawnReason = null;
      this._wasDrifting = false;
      this._wasBoosting = false;
      this._driftSessionScore = 0;
      this._driftSessionTime = 0;
      this._driftSessionNitro = 0;
      this._pendingNitroLinks = 0;
    }
    this._previousRacePosition.copy(this.position);
    this._updatePublicState();
    this.syncObject();
    this._emit('reset', this.getSnapshot());
    return this;
  }

  respawn(reason = 'manual') {
    const anchor = this._lastValidRespawn ?? this._makeCurrentRespawnAnchor();
    if (!anchor) return false;

    this.position.copy(anchor.point).addScaledVector(anchor.tangent, 1.2);
    this.position.y = anchor.point.y + this.config.rideHeight;
    this.heading = Math.atan2(anchor.tangent.x, anchor.tangent.z);
    this.velocity.copy(anchor.tangent).multiplyScalar(this.config.respawnLaunchSpeed);
    this.yawRate = 0;
    this.steering = 0;
    this.state.isDrifting = false;
    this.state.isBoosting = false;
    this.state.driftIntensity = 0;
    this.state.routeValid = true;
    this.state.missedCheckpoint = false;
    this.state.respawnPending = false;
    this.state.wrongWay = false;
    if (this.state.started && !this.state.finished) {
      this.state.respawnCount += 1;
      this.state.respawnPenalty += this.config.respawnPenalty;
    }
    this._courseProgress = anchor.courseProgress;
    this._nextCheckpointNumber = Math.max(1, anchor.checkpointNumber + 1);
    this._missedCheckpointNumber = -1;
    this._respawnTimer = 0;
    this._respawnReason = null;
    this._wrongWayRespawnTime = 0;
    this._wrongWayTime = 0;
    this._stuckTime = 0;
    this._breakSkillChain('respawn');
    this._refreshTrackSample();
    this._lastTrackProgress = this.state.trackProgress;
    this._previousRacePosition.copy(this.position);
    this._updateRaceProgressState();
    this._updatePublicState();
    this.syncObject();
    this._emit('respawn', { reason, state: this.getSnapshot() });
    return true;
  }

  update(deltaSeconds, input) {
    if (input) this.setInput(input);
    const delta = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, this.config.maxDelta);
    this._resolveInput();
    if (delta <= 0 || this.state.paused) {
      this._updatePublicState();
      this.syncObject();
      return this.state;
    }

    const stepCount = Math.max(1, Math.ceil(delta / this.config.maxSubstep));
    const stepDelta = delta / stepCount;
    for (let step = 0; step < stepCount; step += 1) this._stepPhysics(stepDelta);

    this._refreshTrackSample();
    this._updateRace(delta);
    this._updateSkills(delta);
    this._updateRecovery(delta);
    this.state.collisionImpact = Math.max(0, this.state.collisionImpact - delta * 2.4);
    this._updatePublicState();
    this.syncObject();
    return this.state;
  }

  syncObject(object = this.object) {
    if (!object) return this;
    object.position.copy(this.position);
    object.rotation.order = 'YXZ';
    object.rotation.y = this.heading;
    return this;
  }

  getForwardVector(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  getRightVector(target = new THREE.Vector3()) {
    return target.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }

  get speed() { return this.state.speedMps; }
  get speedKph() { return this.state.speedKph; }
  get nitro() { return this.state.nitro; }
  set nitro(value) {
    this.state.nitro = THREE.MathUtils.clamp(Number(value) || 0, 0, this.config.nitroCapacity);
    this.state.nitroNormalized = this.config.nitroCapacity > 0
      ? this.state.nitro / this.config.nitroCapacity
      : 0;
  }
  get drifting() { return this.state.isDrifting; }
  get boosting() { return this.state.isBoosting; }
  get progress() { return this.state.trackProgress; }
  get lap() { return this.state.lap; }
  get score() { return this.state.skillScore; }
  get result() { return this.state.result; }

  on(eventName, listener) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(listener);
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    this._listeners.get(eventName)?.delete(listener);
    return this;
  }

  getSnapshot() {
    return {
      ...this.state,
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      input: { ...this.input },
    };
  }

  destroy() {
    for (const cleanup of this._inputCleanup.splice(0)) cleanup();
    this._listeners.clear();
    this.clearInput();
  }

  _emit(eventName, payload) {
    for (const listener of this._listeners.get(eventName) ?? []) listener(payload, this);
  }

  _resolveInput() {
    const maximum = (name) => Math.max(this._manualInput[name], this._keyboardInput[name], this._touchInput[name]);
    const touchDriftThrottle = this._touchInput.drift > 0.5
      && this._touchInput.brake < 0.5
      && this.state.forwardSpeed > this.config.driftMinSpeed * 0.75
      ? 1
      : 0;
    this.input.throttle = Math.max(maximum('throttle'), touchDriftThrottle);
    this.input.brake = maximum('brake');
    this.input.drift = maximum('drift');
    this.input.nitro = maximum('nitro');

    const manualSteer = this._manualInput.steer;
    const digitalSteer = this._keyboardInput.steer + this._touchInput.steer;
    this.input.steer = THREE.MathUtils.clamp(Math.abs(manualSteer) > EPSILON ? manualSteer : digitalSteer, -1, 1);
  }

  _stepPhysics(delta) {
    this._collisionCooldown = Math.max(0, this._collisionCooldown - delta);
    const speed = horizontalLength(this.velocity);
    const steerTarget = this.input.steer;
    const steerResponse = Math.abs(steerTarget) > Math.abs(this.steering)
      ? this.config.steeringResponse
      : this.config.steeringResponse * 1.35;
    this.steering = damp(this.steering, steerTarget, steerResponse, delta);

    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _right.set(_forward.z, 0, -_forward.x);
    let forwardSpeed = this.velocity.dot(_forward);
    const driftRequested = this.input.drift > 0.5 && speed > this.config.driftMinSpeed && Math.abs(this.steering) > 0.08;

    const speedAuthority = THREE.MathUtils.smoothstep(Math.abs(forwardSpeed), 0.5, 13);
    const highSpeedSteering = THREE.MathUtils.lerp(1, 0.58, clamp01(speed / this.config.maxSpeed));
    const reverseDirection = forwardSpeed < -0.35 ? -1 : 1;
    let targetYawRate = this.steering * this.config.steeringRate * speedAuthority * highSpeedSteering * reverseDirection;
    if (driftRequested) targetYawRate *= this.config.driftYawMultiplier;
    this.yawRate = damp(this.yawRate, targetYawRate, driftRequested ? 8 : 11, delta);
    this.heading = THREE.MathUtils.euclideanModulo(this.heading + this.yawRate * delta + Math.PI, Math.PI * 2) - Math.PI;

    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _right.set(_forward.z, 0, -_forward.x);
    forwardSpeed = this.velocity.dot(_forward);

    const boosting = this.input.nitro > 0.5 && this.input.throttle > 0.05 && forwardSpeed > 5 && this.state.nitro > 0;
    const chainLevel = Math.min(this.state.nitroChain, 5);
    const chainAcceleration = 1 + chainLevel * this.config.nitroChainAccelerationBonus;
    const surfacePower = THREE.MathUtils.lerp(1, 0.52, this.state.offroad);
    const speedLimit = this.config.maxSpeed * (boosting ? this.config.nitroSpeedMultiplier : 1);

    if (this.input.throttle > 0) {
      if (forwardSpeed < -0.5) {
        this._reduceHorizontalSpeed(this.config.brakeDeceleration * this.input.throttle * delta);
      } else {
        const speedRatio = clamp01(Math.max(0, forwardSpeed) / speedLimit);
        const engineFactor = Math.max(0.2, 1 - 0.78 * speedRatio ** 1.45);
        const acceleration = this.config.acceleration * engineFactor
          + (boosting ? this.config.nitroAcceleration * chainAcceleration : 0);
        this.velocity.addScaledVector(_forward, acceleration * surfacePower * this.input.throttle * delta);
      }
    }

    if (this.input.brake > 0) {
      if (forwardSpeed > 0.8) {
        this._reduceHorizontalSpeed(this.config.brakeDeceleration * this.input.brake * delta);
      } else {
        this.velocity.addScaledVector(_forward, -this.config.reverseAcceleration * this.input.brake * delta);
      }
    }

    const grip = driftRequested ? this.config.driftGrip : this.config.normalGrip;
    const lateralSpeed = this.velocity.dot(_right);
    this.velocity.addScaledVector(_right, -lateralSpeed * (1 - Math.exp(-grip * delta)));

    const currentSpeed = horizontalLength(this.velocity);
    const passiveDrag = this.config.rollingResistance + this.config.aerodynamicDrag * currentSpeed * currentSpeed;
    this._reduceHorizontalSpeed(passiveDrag * delta);
    if (this.state.offroad > 0) {
      this._reduceHorizontalSpeed(this.config.offroadDrag * this.state.offroad * delta);
    }

    const horizontalSpeed = horizontalLength(this.velocity);
    const finalForwardSpeed = this.velocity.dot(_forward);
    const activeLimit = finalForwardSpeed < 0 ? this.config.maxReverseSpeed : speedLimit;
    if (horizontalSpeed > activeLimit) {
      const limitedSpeed = damp(horizontalSpeed, activeLimit, boosting ? 2.5 : 5.5, delta);
      const scale = limitedSpeed / horizontalSpeed;
      this.velocity.x *= scale;
      this.velocity.z *= scale;
    }

    if (boosting) {
      const drainScale = Math.max(0.58, 1 - chainLevel * this.config.nitroChainDrainReduction);
      this.state.nitro -= this.config.nitroDrainRate * drainScale * delta;
    }
    else this.state.nitro += this.config.nitroRechargeRate * delta;
    if (driftRequested && !boosting) {
      const slipQuality = THREE.MathUtils.smoothstep(Math.abs(lateralSpeed), 0.4, 8);
      const steeringQuality = THREE.MathUtils.smoothstep(Math.abs(this.steering), 0.08, 0.72);
      const driftRate = this.config.driftNitroBaseRate
        + this.config.driftNitroRate * steeringQuality * (0.35 + slipQuality * 0.65);
      const before = this.state.nitro;
      this.state.nitro += driftRate * delta;
      const earned = Math.max(0, Math.min(this.state.nitro, this.config.nitroCapacity) - before);
      this._driftSessionNitro += earned;
      this.state.driftNitroEarned = this._driftSessionNitro;
    }
    this.state.nitro = THREE.MathUtils.clamp(this.state.nitro, 0, this.config.nitroCapacity);
    this.state.isBoosting = boosting;
    this.state.isDrifting = driftRequested;
    const driftTarget = driftRequested ? clamp01(Math.abs(lateralSpeed) / 10 + Math.abs(this.steering) * 0.45) : 0;
    this.state.driftIntensity = damp(this.state.driftIntensity, driftTarget, driftRequested ? 8 : 5, delta);

    this.position.addScaledVector(this.velocity, delta);
    this._applyTrackConstraint(delta);
  }

  _reduceHorizontalSpeed(amount) {
    const speed = horizontalLength(this.velocity);
    if (speed < EPSILON || amount <= 0) return;
    const scale = Math.max(0, speed - amount) / speed;
    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  _createTrackSample() {
    return {
      point: new THREE.Vector3(),
      tangent: new THREE.Vector3(),
      normal: new THREE.Vector3(),
      offset: 0,
      distance: 0,
      progress: 0,
      segmentIndex: 0,
    };
  }

  _findTrackSample(position, target = this._sampleScratch) {
    if (!this._segments.length || this.trackLength <= 0) return null;
    let bestIndex = -1;
    let bestT = 0;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let bestXDistance = 0;
    let bestZDistance = 0;
    let bestScore = Infinity;

    for (let index = 0; index < this._segments.length; index += 1) {
      const segment = this._segments[index];
      const dx = segment.end.x - segment.start.x;
      const dz = segment.end.z - segment.start.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = THREE.MathUtils.clamp(
        ((position.x - segment.start.x) * dx + (position.z - segment.start.z) * dz) / lengthSquared,
        0,
        1,
      );
      const x = segment.start.x + dx * t;
      const z = segment.start.z + dz * t;
      const y = THREE.MathUtils.lerp(segment.start.y, segment.end.y, t);
      const xDistance = position.x - x;
      const zDistance = position.z - z;
      const yDistance = position.y - y - this.config.rideHeight;
      const score = xDistance * xDistance + zDistance * zDistance + yDistance * yDistance * 2;
      if (score >= bestScore) continue;

      bestScore = score;
      bestIndex = index;
      bestT = t;
      bestX = x;
      bestY = y;
      bestZ = z;
      bestXDistance = xDistance;
      bestZDistance = zDistance;
    }
    if (bestIndex < 0) return null;

    const segment = this._segments[bestIndex];
    const normalX = segment.tangent.z;
    const normalZ = -segment.tangent.x;
    target.point.set(bestX, bestY, bestZ);
    target.tangent.copy(segment.tangent);
    target.normal.set(normalX, 0, normalZ);
    target.offset = bestXDistance * normalX + bestZDistance * normalZ;
    target.distance = Math.hypot(bestXDistance, bestZDistance);
    target.progress = (segment.distanceAtStart + segment.length * bestT) / this.trackLength;
    target.segmentIndex = bestIndex;
    return target;
  }

  _applyTrackConstraint(delta) {
    const sample = this._findTrackSample(this.position, this._sampleScratch);
    if (!sample) return;
    const halfWidth = Math.max(1, this.trackWidth * 0.5);
    const roadLimit = Math.max(0.5, halfWidth - this.config.roadMargin);
    const absoluteOffset = Math.abs(sample.offset);
    const outsideDistance = Math.max(0, absoluteOffset - roadLimit);

    this.state.roadOffset = sample.offset;
    this.state.offroad = clamp01(outsideDistance / Math.max(2, halfWidth * 0.45));

    if (outsideDistance > 0) {
      const sign = Math.sign(sample.offset) || 1;
      _outward.copy(sample.normal).multiplyScalar(sign);
      let outwardSpeed = this.velocity.dot(_outward);
      const collisionLimit = halfWidth + 0.12;

      if (absoluteOffset > collisionLimit) {
        this.position.x = sample.point.x + sample.normal.x * collisionLimit * sign;
        this.position.z = sample.point.z + sample.normal.z * collisionLimit * sign;
        const impact = Math.max(0, outwardSpeed);
        if (impact > 0) {
          const speedBeforeImpact = Math.max(horizontalLength(this.velocity), 1);
          const headOnRatio = clamp01(impact / speedBeforeImpact);
          const headOnThreshold = THREE.MathUtils.clamp(this.config.crashHeadOnRatio, 0.9, 1);
          const tangentSpeed = this.velocity.dot(sample.tangent);
          // Remove only the wall-normal component. The tangent component is the
          // forward motion that lets a car scrape along a barrier instead of
          // freezing after every oblique contact.
          this.velocity.addScaledVector(_outward, -outwardSpeed);
          const collisionSeverity = clamp01(headOnRatio / headOnThreshold);
          const tangentRetention = THREE.MathUtils.lerp(0.995, 0.88, collisionSeverity ** 3);
          this.velocity.multiplyScalar(tangentRetention);
          const directCrash = headOnRatio >= headOnThreshold && impact >= this.config.crashRespawnSpeed;
          const normalBounce = headOnRatio >= headOnThreshold
            ? impact * 0.035
            : impact * THREE.MathUtils.lerp(0.12, 0.03, collisionSeverity);
          this.velocity.addScaledVector(_outward, -normalBounce);
          outwardSpeed = this.velocity.dot(_outward);
          const collisionImpact = clamp01(impact / 28);
          if (directCrash) this._queueRespawn('heavy-crash', 0.65);
          else {
            // Keep sustained throttle from steering the car back into the same
            // barrier every frame. Non-head-on contact guides the nose along
            // the wall while retaining the existing direction of travel.
            const tangentDirection = Math.sign(tangentSpeed)
              || Math.sign(_forward.dot(sample.tangent))
              || 1;
            this.heading = Math.atan2(
              sample.tangent.x * tangentDirection,
              sample.tangent.z * tangentDirection,
            );
            this.yawRate *= 0.2;
          }

          if (impact > 0.8 && this._collisionCooldown <= 0) {
            this._collisionCooldown = this.config.collisionCooldown;
            this.state.collisionCount += 1;
            this.state.collisionImpact = Math.max(this.state.collisionImpact, collisionImpact);
            if (impact > 4) this._breakSkillChain('collision');
            this._emit('collision', {
              impact,
              normalizedImpact: collisionImpact,
              headOnRatio,
              side: sign < 0 ? 'left' : 'right',
              state: this.getSnapshot(),
            });
          }
          outwardSpeed = this.velocity.dot(_outward);
        }
      }

      if (outwardSpeed > 0) {
        this.velocity.addScaledVector(_outward, -outwardSpeed * (1 - Math.exp(-this.config.boundaryGrip * delta)));
      }
      this.velocity.addScaledVector(_outward, -this.config.boundarySpring * outsideDistance * delta);
    }

    const heightResponse = 1 - Math.exp(-14 * delta);
    this.position.y = THREE.MathUtils.lerp(this.position.y, sample.point.y + this.config.rideHeight, heightResponse);
  }

  _refreshTrackSample() {
    this._trackSample = this._findTrackSample(this.position, this._sampleScratch);
    if (!this._trackSample) return;
    this.state.trackProgress = this.trackClosed
      ? wrap01(this._trackSample.progress)
      : clamp01(this._trackSample.progress);
    this.state.roadOffset = this._trackSample.offset;
    const halfWidth = Math.max(1, this.trackWidth * 0.5);
    const roadLimit = Math.max(0.5, halfWidth - this.config.roadMargin);
    this.state.offroad = clamp01(
      Math.max(0, Math.abs(this._trackSample.offset) - roadLimit) / Math.max(2, halfWidth * 0.45),
    );
  }

  _sampleTrackProgress(progress) {
    if (!this._segments.length || this.trackLength <= 0) return null;
    const wrappedProgress = this.trackClosed ? wrap01(progress) : clamp01(progress);
    const targetDistance = wrappedProgress * this.trackLength;
    let segment = this._segments.at(-1);
    for (const candidate of this._segments) {
      if (targetDistance <= candidate.distanceAtStart + candidate.length + EPSILON) {
        segment = candidate;
        break;
      }
    }
    const localDistance = THREE.MathUtils.clamp(targetDistance - segment.distanceAtStart, 0, segment.length);
    const alpha = localDistance / segment.length;
    return {
      point: segment.start.clone().lerp(segment.end, alpha),
      tangent: segment.tangent.clone(),
      normal: new THREE.Vector3(segment.tangent.z, 0, -segment.tangent.x),
      progress: wrappedProgress,
    };
  }

  _buildRaceCheckpoints(startProgress) {
    const count = Math.max(4, Math.floor(this.config.checkpointCount));
    this.state.checkpointCount = count;
    this._raceCheckpoints = [];
    for (let index = 0; index < count; index += 1) {
      const courseProgress = (index + 1) / count;
      const sample = this._sampleTrackProgress(startProgress + courseProgress);
      if (!sample) continue;
      this._raceCheckpoints.push({
        ...sample,
        index,
        courseProgress,
      });
    }
  }

  _getExpectedCheckpoint() {
    const count = this._raceCheckpoints.length;
    if (!count) return null;
    const zeroBasedNumber = this._nextCheckpointNumber - 1;
    const checkpoint = this._raceCheckpoints[zeroBasedNumber % count];
    return {
      checkpoint,
      number: this._nextCheckpointNumber,
      expectedCourseProgress: Math.floor(zeroBasedNumber / count) + checkpoint.courseProgress,
    };
  }

  _crossedCheckpoint(checkpoint) {
    const previousX = this._previousRacePosition.x - checkpoint.point.x;
    const previousZ = this._previousRacePosition.z - checkpoint.point.z;
    const currentX = this.position.x - checkpoint.point.x;
    const currentZ = this.position.z - checkpoint.point.z;
    const previousPlane = previousX * checkpoint.tangent.x + previousZ * checkpoint.tangent.z;
    const currentPlane = currentX * checkpoint.tangent.x + currentZ * checkpoint.tangent.z;
    const forwardTravel = (this.position.x - this._previousRacePosition.x) * checkpoint.tangent.x
      + (this.position.z - this._previousRacePosition.z) * checkpoint.tangent.z;
    const lateralOffset = Math.abs(currentX * checkpoint.normal.x + currentZ * checkpoint.normal.z);
    const verticalOffset = Math.abs(this.position.y - checkpoint.point.y - this.config.rideHeight);
    const gateHalfWidth = this.trackWidth * 0.5 + this.config.checkpointGatePadding;
    return previousPlane <= 0
      && currentPlane >= 0
      && forwardTravel > 0
      && lateralOffset <= gateHalfWidth
      && verticalOffset < 5;
  }

  _passCheckpoint(expected) {
    const { checkpoint, number, expectedCourseProgress } = expected;
    this.state.checkpointsPassed += 1;
    this.state.checkpointIndex = number % this.state.checkpointCount;
    this.state.nextCheckpoint = (number % this.state.checkpointCount) + 1;
    this.state.routeValid = true;
    this.state.missedCheckpoint = false;
    this._missedCheckpointNumber = -1;
    this._respawnTimer = 0;
    this._respawnReason = null;
    this.state.respawnPending = false;
    this._setRespawnAnchor(checkpoint.point, checkpoint.tangent, expectedCourseProgress, number);
    this._nextCheckpointNumber += 1;
    this._emit('checkpoint', {
      index: checkpoint.index,
      number,
      totalPassed: this.state.checkpointsPassed,
      state: this.getSnapshot(),
    });

    if (number % this.state.checkpointCount === 0) this._completeLap();
  }

  _completeLap() {
    this.state.lapsCompleted += 1;
    this.state.lastLapTime = this.state.currentLapTime;
    this.state.bestLapTime = this.state.bestLapTime === null
      ? this.state.lastLapTime
      : Math.min(this.state.bestLapTime, this.state.lastLapTime);
    this.state.currentLapTime = 0;
    this.state.lap = Math.min(this.state.totalLaps, this.state.lapsCompleted + 1);
    this._emit('lap', this.getSnapshot());

    if (this.state.lapsCompleted < this.state.totalLaps) return;
    this.state.finished = true;
    this.state.raceStatus = 'finished';
    this.state.lap = this.state.totalLaps;
    this.state.lapProgress = 1;
    this.state.raceProgress = 1;
    this.state.result = {
      status: 'finished',
      position: null,
      totalTime: this.state.raceTime,
      penaltyTime: this.state.respawnPenalty,
      finalTime: this.state.raceTime + this.state.respawnPenalty,
      bestLapTime: this.state.bestLapTime,
      skillScore: Math.round(this.state.skillScore),
      respawns: this.state.respawnCount,
      collisions: this.state.collisionCount,
      shortcutStrikes: this.state.shortcutStrikes,
      cleanRace: this.state.respawnCount === 0 && this.state.collisionCount === 0 && this.state.shortcutStrikes === 0,
    };
    this._emit('finish', this.getSnapshot());
  }

  _markShortcut(reason = 'missed-checkpoint') {
    if (!this.state.routeValid && this._missedCheckpointNumber === this._nextCheckpointNumber) return;
    this.state.routeValid = false;
    this.state.missedCheckpoint = true;
    this.state.shortcutStrikes += 1;
    this._missedCheckpointNumber = this._nextCheckpointNumber;
    this._breakSkillChain('shortcut');
    this._queueRespawn(reason, this.config.shortcutRespawnDelay);
    this._emit('shortcut', {
      reason,
      expectedCheckpoint: this.state.nextCheckpoint,
      strikes: this.state.shortcutStrikes,
      state: this.getSnapshot(),
    });
  }

  _updateRaceProgressState() {
    if (this.state.finished) {
      this.state.lapProgress = 1;
      this.state.raceProgress = 1;
      return;
    }
    const lapBase = this.state.lapsCompleted;
    this.state.lapProgress = clamp01(this._courseProgress - lapBase);
    this.state.raceProgress = clamp01((lapBase + this.state.lapProgress) / this.state.totalLaps);
    this.state.lap = Math.min(this.state.totalLaps, lapBase + 1);
  }

  _updateRace(delta) {
    if (!this._trackSample) return;

    const tangentSpeed = this.velocity.dot(this._trackSample.tangent);
    this._wrongWayTime = tangentSpeed < -2
      ? Math.min(2, this._wrongWayTime + delta)
      : Math.max(0, this._wrongWayTime - delta * 2);
    this.state.wrongWay = this._wrongWayTime > 0.45;

    if (!this.state.started || this.state.finished || !this.trackClosed) {
      this._lastTrackProgress = this.state.trackProgress;
      this._previousRacePosition.copy(this.position);
      return;
    }

    this.state.raceTime += delta;
    this.state.currentLapTime += delta;
    let progressDelta = this.state.trackProgress - this._lastTrackProgress;
    if (progressDelta > 0.5) progressDelta -= 1;
    if (progressDelta < -0.5) progressDelta += 1;
    this._courseProgress += progressDelta;
    this._lastTrackProgress = this.state.trackProgress;

    const expected = this._getExpectedCheckpoint();
    if (expected && this._crossedCheckpoint(expected.checkpoint)) {
      this._passCheckpoint(expected);
    } else if (
      expected
      && this._courseProgress > expected.expectedCourseProgress + this.config.shortcutTolerance
    ) {
      this._markShortcut('missed-checkpoint');
    }
    this._updateRaceProgressState();
    this._previousRacePosition.copy(this.position);
  }

  _setRespawnAnchor(point, tangent, courseProgress, checkpointNumber) {
    this._lastValidRespawn = {
      point: point.clone(),
      tangent: tangent.clone().setY(0).normalize(),
      courseProgress,
      checkpointNumber,
    };
  }

  _makeCurrentRespawnAnchor() {
    const sample = this._trackSample ?? this._findTrackSample(this.position, this._sampleScratch);
    if (!sample) return null;
    return {
      point: sample.point.clone(),
      tangent: sample.tangent.clone(),
      courseProgress: Math.max(0, this._courseProgress),
      checkpointNumber: Math.max(0, this._nextCheckpointNumber - 1),
    };
  }

  _queueRespawn(reason, delay = 0) {
    if (this.state.respawnPending && this._respawnTimer <= delay) return;
    this.state.respawnPending = true;
    this._respawnReason = reason;
    this._respawnTimer = Math.max(0, delay);
  }

  _updateRecovery(delta) {
    if (!this.state.started || this.state.finished) return;
    this._wrongWayRespawnTime = this.state.wrongWay
      ? this._wrongWayRespawnTime + delta
      : Math.max(0, this._wrongWayRespawnTime - delta * 2);
    const tryingToMove = this.input.throttle > 0.45 || this.input.brake > 0.45;
    this._stuckTime = this.speed < 1.2 && tryingToMove
      ? this._stuckTime + delta
      : Math.max(0, this._stuckTime - delta * 2);

    if (this._wrongWayRespawnTime >= this.config.wrongWayRespawnTime) {
      this._queueRespawn('wrong-way', 0.25);
    } else if (this._stuckTime >= this.config.stuckRespawnTime) {
      this._queueRespawn('stuck', 0.25);
    }

    if (!this.state.respawnPending) return;
    this._respawnTimer -= delta;
    if (this._respawnTimer <= 0) this.respawn(this._respawnReason ?? 'recovery');
  }

  _updateSkills(delta) {
    if (!this.state.started || this.state.finished) {
      this._wasDrifting = this.state.isDrifting;
      this._wasBoosting = this.state.isBoosting;
      return;
    }

    const scoredDrift = this.state.isDrifting
      && this.speedKph > 45
      && this.state.driftIntensity > 0.08;
    if (scoredDrift) {
      this._driftSessionTime += delta;
      const speedQuality = THREE.MathUtils.clamp(this.speedKph / 240, 0.35, 1.45);
      const gain = this.config.driftScoreRate
        * speedQuality
        * (0.35 + this.state.driftIntensity)
        * delta;
      this._driftSessionScore += gain;
      this.state.driftScore = Math.round(this._driftSessionScore);
      this.state.driftDuration = this._driftSessionTime;
      this.state.comboTime = this.config.comboWindow;
      if (!this._wasDrifting) this._emit('driftStart', this.getSnapshot());
    } else if (this._wasDrifting) {
      this._bankDrift();
    } else if (this.state.comboTime > 0) {
      this.state.comboTime = Math.max(0, this.state.comboTime - delta);
      if (this.state.comboTime <= 0) this._breakSkillChain('timeout', false);
    }

    const boostStarted = this.state.isBoosting && !this._wasBoosting;
    if (boostStarted && this._pendingNitroLinks > 0 && this.state.comboTime > 0) {
      this._pendingNitroLinks -= 1;
      this.state.nitroChain = Math.min(this.config.maxCombo, this.state.nitroChain + 1);
      this.state.nitroChainTime = this.config.nitroChainWindow;
      this.state.nitroLinks += 1;
      const chainBonus = 180 * this.state.nitroChain * this.state.comboMultiplier;
      this.state.skillScore += chainBonus;
      this._emit('nitroChain', {
        chain: this.state.nitroChain,
        bonus: Math.round(chainBonus),
        state: this.getSnapshot(),
      });
    }

    if (this.state.nitroChain > 0) {
      this.state.nitroChainTime = this.state.isBoosting
        ? this.config.nitroChainWindow
        : Math.max(0, this.state.nitroChainTime - delta);
      if (this.state.nitroChainTime <= 0) this.state.nitroChain = 0;
    }
    this._wasDrifting = scoredDrift;
    this._wasBoosting = this.state.isBoosting;
  }

  _bankDrift() {
    if (
      this._driftSessionTime >= this.config.minScoredDriftTime
      && this._driftSessionScore >= 10
    ) {
      const beforeNitro = this.state.nitro;
      const bankBonus = Math.min(12, this._driftSessionTime * this.config.driftNitroBankRate);
      this.nitro += bankBonus;
      this._driftSessionNitro += Math.max(0, this.state.nitro - beforeNitro);
      this.state.lastDriftNitro = this._driftSessionNitro;
      this.state.combo = Math.min(this.config.maxCombo, this.state.combo + 1);
      this.state.comboMultiplier = 1 + (this.state.combo - 1) * 0.25;
      const banked = Math.round(this._driftSessionScore * this.state.comboMultiplier);
      this.state.lastDriftScore = banked;
      this.state.skillScore += banked;
      this.state.comboTime = this.config.comboWindow;
      this._pendingNitroLinks = Math.min(3, this._pendingNitroLinks + 1);
      this._emit('driftEnd', {
        points: banked,
        combo: this.state.combo,
        multiplier: this.state.comboMultiplier,
        nitro: Math.round(this._driftSessionNitro),
        state: this.getSnapshot(),
      });
    }
    this._driftSessionScore = 0;
    this._driftSessionTime = 0;
    this._driftSessionNitro = 0;
    this.state.driftScore = 0;
    this.state.driftDuration = 0;
    this.state.driftNitroEarned = 0;
  }

  _breakSkillChain(reason, emit = true) {
    const hadChain = this.state.combo > 0 || this.state.nitroChain > 0 || this._driftSessionScore > 0;
    this._driftSessionScore = 0;
    this._driftSessionTime = 0;
    this._driftSessionNitro = 0;
    this._pendingNitroLinks = 0;
    this.state.driftScore = 0;
    this.state.driftDuration = 0;
    this.state.driftNitroEarned = 0;
    this.state.combo = 0;
    this.state.comboMultiplier = 1;
    this.state.comboTime = 0;
    this.state.nitroChain = 0;
    this.state.nitroChainTime = 0;
    if (emit && hadChain) this._emit('comboBreak', { reason, state: this.getSnapshot() });
  }

  _updatePublicState() {
    _forward.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _right.set(_forward.z, 0, -_forward.x);
    const speed = horizontalLength(this.velocity);
    const forwardSpeed = this.velocity.dot(_forward);
    const lateralSpeed = this.velocity.dot(_right);
    this.state.speedMps = speed;
    this.state.speedKph = speed * 3.6;
    this.state.forwardSpeed = forwardSpeed;
    this.state.normalizedSpeed = clamp01(speed / this.config.maxSpeed);
    this.state.heading = this.heading;
    this.state.yawRate = this.yawRate;
    this.state.steering = this.steering;
    this.state.slipAngle = speed > 0.2 ? Math.atan2(lateralSpeed, Math.abs(forwardSpeed) + EPSILON) : 0;
    this.state.nitroNormalized = this.config.nitroCapacity > 0
      ? this.state.nitro / this.config.nitroCapacity
      : 0;
  }
}

export default ArcadeVehicle;
