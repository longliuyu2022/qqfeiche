import * as THREE from 'three';
import { rampHeightAt } from './track-features.js';

const DEFAULTS = Object.freeze({
  totalLaps: 3,
  trackWidth: 16,
  maxDelta: 0.1,
  overtakeDistance: 28,
  defendDistance: 24,
  laneChangeDistance: 2.8,
  laneResponse: 2.1,
  aiAcceleration: 4.8,
  aiBraking: 7.5,
  rubberBandStrength: 4.2,
  // Track feature driving. Mirrors the player numbers in driving.js so AI cars
  // gain the same amount of time from pads and ramps that a human does.
  padApproachDistance: 40,
  padLineBlend: 0.3,
  padBoostDuration: 0.9,
  padBoostImpulse: 6,
  padBoostSpeedMultiplier: 1.2,
  padCooldown: 1.2,
  gravity: 30,
  rampLaunchSlopeGain: 1.15,
  rampMinLaunchSpeed: 3.5,
  rampMaxLaunchSpeed: 12,
  rampAirLaneResponse: 0.28,
  landingMinAirTime: 0.28,
  landingBoostDuration: 0.55,
  landingBoostImpulse: 2.5,
  // Shortcut branches. The AI commits to a fork about a car-length-per-second
  // before the mouth, hugs the shoulder it forks from, then drives the branch
  // polyline. All gains come from the branch being shorter, never from speed.
  shortcutApproachDistance: 52,
  shortcutEntryDistance: 16,
  shortcutEntryOffset: 2.4,
  shortcutBlendIn: 0.05,
  shortcutMaxGain: 2.5,
  shortcutBiasBase: 0.14,
  shortcutBiasGain: 0.78,
  // A pad only outranks a fork when the car can still clear the strip and slide
  // back to the shoulder in time; otherwise a 3 m boost would veto a 30 m cut.
  shortcutPadYieldDistance: 30,
  // Applied to every rival base speed while track features are supplied: the
  // grid speeds were raised to offset player-only pads, so hand that back once
  // the AI actually uses them. 62 * 0.952 ~= 59, the pre-feature grid speed.
  featureSpeedCompensation: 0.952,
});

const _up = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-6;

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function damp(current, target, response, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
}

/**
 * Plain, validated, start-ascending copy of one `featureZonesForPhysics()` list.
 * Zones never wrap across t = 0, which lets the per-rival cursor stay monotonic.
 */
function normalizeZones(zones, key, fallbackHalfWidth) {
  const source = Array.isArray(zones?.[key]) ? zones[key] : [];
  return source
    .filter((zone) => Number.isFinite(zone?.start) && Number.isFinite(zone?.end) && zone.end > zone.start)
    .map((zone, index) => Object.freeze({
      id: zone.id ?? `${key}-${index + 1}`,
      start: zone.start,
      end: zone.end,
      halfWidth: Number.isFinite(zone.halfWidth) ? Math.abs(zone.halfWidth) : fallbackHalfWidth,
      height: Number.isFinite(zone.height) ? zone.height : 0,
    }))
    .sort((a, b) => a.start - b.start);
}

/**
 * FNV-1a folded into [0, 1). Used to pin a rival's shortcut taste to its id so
 * the same grid always makes the same choices, without touching Math.random().
 */
function hashUnit(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 1000003) / 1000003;
}

/**
 * Validated copy of a `featureZonesForPhysics().shortcuts` list, with the branch
 * polyline pre-measured so driving it is a cursor walk instead of a full scan.
 * Overlapping (or wrapping) branches are dropped: the per-rival cursor assumes a
 * strictly ascending, disjoint list, and two branches sharing road is not a line.
 */
function normalizeShortcuts(zones, trackLength, maxGain) {
  const source = Array.isArray(zones?.shortcuts) ? zones.shortcuts : [];
  const parsed = [];
  for (const [index, zone] of source.entries()) {
    if (!Number.isFinite(zone?.start) || !Number.isFinite(zone?.end)) continue;
    if (zone.end <= zone.start || zone.start < 0 || zone.end > 1) continue;
    const points = (Array.isArray(zone.points) ? zone.points : [])
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.z))
      .map((point) => new THREE.Vector3(point.x, Number.isFinite(point.y) ? point.y : 0, point.z));
    if (points.length < 2) continue;

    const cumulative = [0];
    for (let step = 1; step < points.length; step += 1) {
      const previous = points[step - 1];
      const current = points[step];
      cumulative.push(cumulative[step - 1] + Math.hypot(current.x - previous.x, current.z - previous.z));
    }
    const pathLength = cumulative[cumulative.length - 1];
    if (!(pathLength > 1)) continue;

    const span = zone.end - zone.start;
    const spanMeters = span * trackLength;
    // The branch may never be a wormhole: cap how much lap the AI can buy with
    // one corridor, and drive the capped length so the cap is actually honoured.
    const gain = THREE.MathUtils.clamp(spanMeters / pathLength, 1, maxGain);
    parsed.push(Object.freeze({
      id: zone.id ?? `shortcut-${index + 1}`,
      start: zone.start,
      end: zone.end,
      span,
      side: Math.sign(zone.side) || 1,
      halfWidth: Number.isFinite(zone.halfWidth) ? Math.abs(zone.halfWidth) : 5,
      savedMeters: Number.isFinite(zone.savedMeters) ? zone.savedMeters : spanMeters - pathLength,
      points: Object.freeze(points),
      cumulative: Object.freeze(cumulative),
      pathLength,
      spanMeters,
      gain,
      driveLength: spanMeters / gain,
    }));
  }

  parsed.sort((a, b) => a.start - b.start);
  const disjoint = [];
  for (const shortcut of parsed) {
    const previous = disjoint[disjoint.length - 1];
    if (previous && shortcut.start < previous.end) continue;
    disjoint.push(shortcut);
  }
  return disjoint;
}

/** Coordinates AI opponents, live standings and the authoritative race result. */
export class RaceSystem {
  constructor(options = {}) {
    if (!options.trackCurve?.getPointAt || !options.trackCurve?.getTangentAt) {
      throw new Error('RaceSystem requires a Three.js trackCurve.');
    }
    if (!options.player) throw new Error('RaceSystem requires a player ArcadeVehicle.');

    this.config = { ...DEFAULTS, ...options };
    this.trackCurve = options.trackCurve;
    this.trackLength = this.trackCurve.getLength();
    this.player = options.player;
    this.startProgress = wrap01(options.startProgress ?? this.player.progress ?? 0);
    this.totalLaps = Math.max(1, Math.floor(options.totalLaps ?? this.player.state.totalLaps));
    this._listeners = new Map();
    this._point = new THREE.Vector3();
    this._tangent = new THREE.Vector3();
    this._aheadTangent = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
    this._matrix = new THREE.Matrix4();

    this.rivals = (options.rivals ?? []).map((source, index) => {
      const suppliedProgress = Number.isFinite(source.totalProgress)
        ? source.totalProgress
        : this.startProgress - 0.0038 * (index + 1);
      const gridOffset = Number.isFinite(source.gridOffset)
        ? source.gridOffset
        : suppliedProgress - this.startProgress;
      const baseLane = Number.isFinite(source.lane)
        ? source.lane
        : ((index % 2) * 2 - 1) * (1.7 + Math.floor(index / 2) * 0.35);
      const rawBaseSpeed = source.rawBaseSpeed ?? source.baseSpeed ?? source.speed ?? 60;
      const aggression = THREE.MathUtils.clamp(source.aggression ?? 0.42 + (index % 3) * 0.16, 0.25, 0.9);
      return Object.assign(source, {
        id: source.id ?? `rival-${index + 1}`,
        name: source.name ?? `APEX ${String(index + 2).padStart(2, '0')}`,
        rawBaseSpeed,
        baseSpeed: source.baseSpeed ?? source.speed ?? 60,
        speed: source.speed ?? source.baseSpeed ?? 60,
        baseLane,
        lane: baseLane,
        targetLane: baseLane,
        gridOffset,
        raceProgress: gridOffset,
        totalProgress: gridOffset,
        progress: wrap01(this.startProgress + gridOffset),
        maneuver: 'line',
        maneuverTime: 0,
        maneuverCooldown: index * 0.22,
        finished: false,
        finishTime: null,
        skill: THREE.MathUtils.clamp(source.skill ?? 0.96 + index * 0.012, 0.88, 1.04),
        aggression,
        // Taste for cutting corners: pushy drivers take more forks. Combined
        // with a per-(rival, branch) hash it decides each fork exactly once.
        shortcutBias: THREE.MathUtils.clamp(
          Number.isFinite(source.shortcutBias)
            ? source.shortcutBias
            : this.config.shortcutBiasBase + aggression * this.config.shortcutBiasGain,
          0,
          1,
        ),
      });
    });
    this.activeRivalCount = THREE.MathUtils.clamp(
      Math.floor(options.activeRivalCount ?? this.rivals.length),
      0,
      this.rivals.length,
    );

    this._featurePads = [];
    this._featureRamps = [];
    this._featureShortcuts = [];
    this._shortcutPoint = new THREE.Vector3();
    this._shortcutTangent = new THREE.Vector3(0, 0, 1);
    this._laneAnchor = new THREE.Vector3();
    this._scratch = new THREE.Vector3();
    this._speedCompensationOverride = Number.isFinite(options.speedCompensation)
      ? options.speedCompensation
      : null;
    this.speedCompensation = 1;
    this.setTrackFeatures(options.trackFeatures ?? null);

    this.state = {
      status: 'idle',
      paused: false,
      raceTime: 0,
      playerPosition: 1,
      entrantCount: this.activeRivalCount + 1,
      standings: [],
      result: null,
    };
    this.reset();
  }

  start({ reset = false } = {}) {
    if (reset) this.reset();
    this.state.status = 'racing';
    this.state.paused = false;
    this.state.result = null;
    if (!this.player.state.started) this.player.startRace({ totalLaps: this.totalLaps });
    this._updateStandings();
    this._emit('start', this.getSnapshot());
    return this;
  }

  /**
   * `trackFeatures` accepts a `featureZonesForPhysics()` payload
   * (`{ pads, ramps, shortcuts }`) and `speedCompensation` overrides the
   * automatic rival speed scaling.
   * Both keys are optional; omitting them leaves the current setup untouched.
   */
  configure(options = {}) {
    const { totalLaps = this.totalLaps, rivalCount = this.activeRivalCount } = options;
    this.totalLaps = Math.max(1, Math.floor(totalLaps));
    this.activeRivalCount = THREE.MathUtils.clamp(
      Math.floor(rivalCount),
      0,
      this.rivals.length,
    );
    this.state.entrantCount = this.activeRivalCount + 1;
    if ('speedCompensation' in options) {
      this._speedCompensationOverride = Number.isFinite(options.speedCompensation)
        ? options.speedCompensation
        : null;
    }
    if ('trackFeatures' in options) this.setTrackFeatures(options.trackFeatures);
    else if ('speedCompensation' in options) this._applySpeedCompensation();
    this.reset();
    return this;
  }

  /**
   * Boost pads / jump ramps / shortcut branches the AI should use. Pass null to
   * clear them.
   */
  setTrackFeatures(zones = null) {
    const fallbackHalfWidth = Math.max(1, this.config.trackWidth * 0.5);
    this._featurePads = normalizeZones(zones, 'pads', fallbackHalfWidth);
    this._featureRamps = normalizeZones(zones, 'ramps', fallbackHalfWidth);
    this._featureShortcuts = normalizeShortcuts(zones, this.trackLength, this.config.shortcutMaxGain);
    this._applySpeedCompensation();
    for (const rival of this.rivals) this._resetRivalFeatureState(rival);
    return this;
  }

  get hasTrackFeatures() {
    return this._featurePads.length > 0
      || this._featureRamps.length > 0
      || this._featureShortcuts.length > 0;
  }

  getTrackFeatures() {
    return {
      pads: this._featurePads.slice(),
      ramps: this._featureRamps.slice(),
      shortcuts: this._featureShortcuts.slice(),
    };
  }

  _applySpeedCompensation() {
    const auto = this.hasTrackFeatures ? this.config.featureSpeedCompensation : 1;
    const factor = Number.isFinite(this._speedCompensationOverride)
      ? this._speedCompensationOverride
      : auto;
    this.speedCompensation = THREE.MathUtils.clamp(factor, 0.5, 1.5);
    for (const rival of this.rivals) {
      rival.baseSpeed = rival.rawBaseSpeed * this.speedCompensation;
    }
  }

  _resetRivalFeatureState(rival) {
    rival.padBoostTime = 0;
    rival.padCooldownTime = 0;
    rival.padCooldownId = null;
    rival.padCursor = 0;
    rival.rampCursor = 0;
    rival.featureCursorProgress = -1;
    rival.featureTarget = null;
    rival.landingBoostTime = 0;
    rival.heightOffset = 0;
    rival.verticalVelocity = 0;
    rival.airborne = false;
    rival.airTime = 0;
    rival.activeRamp = null;
    rival.shortcutCursor = 0;
    rival.activeShortcut = null;
    rival.shortcutId = null;
    rival.shortcutCommitId = null;
    rival.shortcutLocal = 0;
    rival.shortcutBase = 0;
    rival.shortcutSegment = 0;
    rival.shortcutEntryLane = 0;
  }

  reset() {
    this.state.status = 'idle';
    this.state.paused = false;
    this.state.raceTime = 0;
    this.state.result = null;
    for (const rival of this.rivals) {
      rival.raceProgress = rival.gridOffset;
      rival.totalProgress = rival.gridOffset;
      rival.progress = wrap01(this.startProgress + rival.gridOffset);
      rival.speed = rival.baseSpeed;
      rival.lane = rival.baseLane;
      rival.targetLane = rival.baseLane;
      rival.maneuver = 'line';
      rival.maneuverTime = 0;
      rival.maneuverCooldown = 0.25;
      rival.finished = false;
      rival.finishTime = null;
      this._resetRivalFeatureState(rival);
      this._placeRival(rival, 1);
    }
    this._updateStandings();
    return this;
  }

  setPaused(paused = true) {
    this.state.paused = Boolean(paused);
    return this;
  }

  update(deltaSeconds) {
    const delta = THREE.MathUtils.clamp(Number(deltaSeconds) || 0, 0, this.config.maxDelta);
    if (delta <= 0 || this.state.paused) {
      this._updateStandings();
      return this.state;
    }

    if (this.state.status === 'racing') {
      this.state.raceTime += delta;
      for (const rival of this._activeRivals()) this._updateRival(rival, delta);
    } else {
      for (const rival of this._activeRivals()) this._placeRival(rival, delta);
    }

    this._updateStandings();
    if (this.player.state.finished && !this.state.result) this._finalizePlayer();
    return this.state;
  }

  getStandings() {
    return this.state.standings.map((entry) => ({ ...entry }));
  }

  getSnapshot() {
    return {
      ...this.state,
      standings: this.getStandings(),
      result: this.state.result ? { ...this.state.result } : null,
    };
  }

  on(eventName, listener) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(listener);
    return () => this.off(eventName, listener);
  }

  off(eventName, listener) {
    this._listeners.get(eventName)?.delete(listener);
    return this;
  }

  destroy() {
    this._listeners.clear();
  }

  _emit(eventName, payload) {
    for (const listener of this._listeners.get(eventName) ?? []) listener(payload, this);
  }

  _activeRivals() {
    return this.rivals.slice(0, this.activeRivalCount);
  }

  _playerRaceProgress() {
    return this.player.state.finished
      ? this.totalLaps
      : this.player.state.lapsCompleted + this.player.state.lapProgress;
  }

  _updateRival(rival, delta) {
    rival.maneuverTime = Math.max(0, rival.maneuverTime - delta);
    rival.maneuverCooldown = Math.max(0, rival.maneuverCooldown - delta);
    rival.padBoostTime = Math.max(0, rival.padBoostTime - delta);
    rival.landingBoostTime = Math.max(0, rival.landingBoostTime - delta);
    rival.padCooldownTime = Math.max(0, rival.padCooldownTime - delta);
    if (rival.padCooldownTime <= 0) rival.padCooldownId = null;
    const playerProgress = this._playerRaceProgress();
    const currentProgress = wrap01(this.startProgress + rival.raceProgress);
    this.trackCurve.getTangentAt(currentProgress, this._tangent).setY(0).normalize();
    this.trackCurve.getTangentAt(wrap01(currentProgress + 0.014), this._aheadTangent).setY(0).normalize();
    const bendAngle = Math.acos(THREE.MathUtils.clamp(this._tangent.dot(this._aheadTangent), -1, 1));
    const cornerLoad = THREE.MathUtils.smoothstep(bendAngle, 0.06, 0.42);
    const gapToPlayer = (playerProgress - rival.raceProgress) * this.trackLength;
    const rubberBand = THREE.MathUtils.clamp(gapToPlayer / 170, -1, 1) * this.config.rubberBandStrength;

    if (rival.activeShortcut) {
      // A branch corridor owns the line until it rejoins: there is nowhere to
      // swerve to, so defending and overtaking sit this stretch out.
      rival.maneuver = 'shortcut';
      rival.maneuverTime = 0;
    } else if (rival.maneuverTime <= 0) {
      rival.maneuver = 'line';
      rival.targetLane = rival.baseLane;
      const threatDistance = (rival.raceProgress - playerProgress) * this.trackLength;
      const playerThreat = threatDistance > 0
        && threatDistance < this.config.defendDistance
        && this.player.speed > rival.speed - 2;
      const targetAhead = this._findTargetAhead(rival);

      if (playerThreat && rival.maneuverCooldown <= 0 && rival.aggression > 0.48) {
        rival.maneuver = 'defend';
        rival.maneuverTime = 1.05 + rival.aggression * 0.55;
        rival.maneuverCooldown = 2.4;
        rival.targetLane = this._clampLane(this.player.state.roadOffset * 0.78);
        this._emit('defend', { rival, gap: threatDistance });
      } else if (targetAhead && rival.maneuverCooldown <= 0) {
        rival.maneuver = 'overtake';
        rival.maneuverTime = 1.4 + rival.aggression * 0.8;
        rival.maneuverCooldown = 1.9;
        const passDirection = targetAhead.lane >= 0 ? -1 : 1;
        rival.targetLane = this._clampLane(targetAhead.lane + passDirection * this.config.laneChangeDistance);
        this._emit('overtake', { rival, target: targetAhead });
      }
    }

    // Feature line sits below collision avoidance (applied in _separateFromPlayer)
    // and above plain cruising, so it only bends the racing line while on 'line'.
    if (rival.maneuver === 'line') {
      this._applyFeatureLine(rival);
      this._applyShortcutLine(rival);
    } else rival.featureTarget = null;

    const laneResponse = rival.airborne
      ? this.config.laneResponse * this.config.rampAirLaneResponse
      : this.config.laneResponse;
    rival.lane = damp(rival.lane, rival.targetLane, laneResponse, delta);
    let targetSpeed = rival.baseSpeed * rival.skill * (1 - cornerLoad * 0.18) + rubberBand;
    if (rival.maneuver === 'overtake') targetSpeed += 2.2 + rival.aggression * 1.8;
    if (rival.maneuver === 'defend') targetSpeed += 0.7;
    let speedCeiling = rival.baseSpeed * 1.13 + 4;
    if (rival.padBoostTime > 0) {
      targetSpeed += this.config.padBoostImpulse;
      speedCeiling *= this.config.padBoostSpeedMultiplier;
    }
    if (rival.landingBoostTime > 0) targetSpeed += this.config.landingBoostImpulse;
    targetSpeed = THREE.MathUtils.clamp(targetSpeed, rival.baseSpeed * 0.72, speedCeiling);
    const speedDelta = THREE.MathUtils.clamp(
      targetSpeed - rival.speed,
      -this.config.aiBraking * delta,
      this.config.aiAcceleration * delta,
    );
    rival.speed += speedDelta;
    this._advanceProgress(rival, delta);
    this._triggerPadBoost(rival);
    this._separateFromPlayer(rival, delta);
    this._updateRivalHeight(rival, delta);

    if (!rival.finished && rival.raceProgress >= this.totalLaps) {
      rival.finished = true;
      rival.finishTime = this.state.raceTime;
      this._emit('rivalFinish', { rival, time: rival.finishTime });
    }
    this._placeRival(rival, delta);
  }

  /**
   * Advances the per-rival zone cursor to the first zone that has not been
   * passed yet. Amortized O(1) per frame: the cursor only walks forward, and
   * resets to 0 when lap progress wraps (or a nudge pushes the car backwards).
   */
  _advanceCursor(rival, zones, cursorKey) {
    const progress = rival.progress;
    if (progress < rival.featureCursorProgress) {
      rival.padCursor = 0;
      rival.rampCursor = 0;
      rival.shortcutCursor = 0;
    }
    rival.featureCursorProgress = progress;
    let cursor = rival[cursorKey];
    while (cursor < zones.length && zones[cursor].end < progress) cursor += 1;
    rival[cursorKey] = cursor;
    return cursor < zones.length ? zones[cursor] : null;
  }

  /** Next pad on the racing line plus its signed distance in meters (<= 0 means inside). */
  _nextPad(rival) {
    const pads = this._featurePads;
    if (pads.length === 0) return null;
    const pad = this._advanceCursor(rival, pads, 'padCursor');
    if (pad) return { pad, distance: (pad.start - rival.progress) * this.trackLength };
    const wrapped = pads[0];
    return { pad: wrapped, distance: (1 - rival.progress + wrapped.start) * this.trackLength };
  }

  /**
   * Lateral position the rival aims for to stay on a pad. The cruising lane is
   * blended toward the pad centre (pads sit on the road centreline) and then
   * clamped inside the strip, so cars keep their left/right ordering instead of
   * all piling onto the same line.
   */
  _padTargetLane(rival, pad) {
    const laneLimit = this.config.trackWidth * 0.32;
    const inner = Math.min(pad.halfWidth * 0.8, laneLimit);
    return THREE.MathUtils.clamp(rival.baseLane * this.config.padLineBlend, -inner, inner);
  }

  _applyFeatureLine(rival) {
    rival.featureTarget = null;
    if (this._featurePads.length === 0 || rival.airborne || rival.activeShortcut) return;
    const upcoming = this._nextPad(rival);
    if (!upcoming || upcoming.distance > this.config.padApproachDistance) return;
    rival.featureTarget = upcoming.pad.id;
    rival.targetLane = this._padTargetLane(rival, upcoming.pad);
  }

  // -- Shortcut branches ----------------------------------------------------

  /**
   * Whether this rival drives that branch. Pure and stable: a per-rival taste
   * value against a hash of `rivalId::shortcutId`, so a grid makes the same
   * calls every run and never flickers mid-approach.
   */
  _takesShortcut(rival, shortcut) {
    const bias = THREE.MathUtils.clamp(rival.shortcutBias ?? 0, 0, 1);
    if (bias <= 0) return false;
    if (bias >= 1) return true;
    return hashUnit(`${rival.id}::${shortcut.id}`) < bias;
  }

  /** Next branch on the lap plus its signed distance in meters (<= 0 means inside). */
  _nextShortcut(rival) {
    const shortcuts = this._featureShortcuts;
    if (shortcuts.length === 0) return null;
    const shortcut = this._advanceCursor(rival, shortcuts, 'shortcutCursor');
    if (shortcut) return { shortcut, distance: (shortcut.start - rival.progress) * this.trackLength };
    const wrapped = shortcuts[0];
    return { shortcut: wrapped, distance: (1 - rival.progress + wrapped.start) * this.trackLength };
  }

  /**
   * Approach line for a branch the rival intends to take: commit ~50 m out and
   * slide onto the shoulder the fork peels off from. A pad keeps priority only
   * while it can be taken and still left with room to reach that shoulder: a
   * boost strip is worth a few meters, a branch is worth tens of them.
   */
  _applyShortcutLine(rival) {
    if (this._featureShortcuts.length === 0 || rival.airborne || rival.activeShortcut) return;
    const upcoming = this._nextShortcut(rival);
    if (!upcoming) return;
    const { shortcut, distance } = upcoming;
    if (distance > this.config.shortcutApproachDistance || distance < -this.config.shortcutEntryDistance) {
      rival.shortcutCommitId = null;
      return;
    }
    if (!this._takesShortcut(rival, shortcut)) {
      rival.shortcutCommitId = null;
      return;
    }
    if (rival.featureTarget) {
      const upcomingPad = this._nextPad(rival);
      const padExit = upcomingPad
        ? (upcomingPad.pad.end - rival.progress) * this.trackLength
        : Infinity;
      if (padExit + this.config.shortcutPadYieldDistance < distance) return;
    }
    rival.shortcutCommitId = shortcut.id;
    rival.featureTarget = null;
    rival.targetLane = this._clampLane(shortcut.side * this.config.trackWidth * 0.32);
  }

  /**
   * Takes the fork if the rival committed to it and actually arrived on the
   * right shoulder. Getting shoved off that line by avoidance simply means the
   * branch is missed this lap, which keeps collision handling on top.
   */
  _tryEnterShortcut(rival) {
    if (rival.airborne || rival.activeShortcut) return;
    const upcoming = this._nextShortcut(rival);
    if (!upcoming) return;
    const { shortcut, distance } = upcoming;
    if (distance > 0 || -distance > this.config.shortcutEntryDistance) return;
    if (rival.shortcutCommitId !== shortcut.id) return;
    if (Math.sign(rival.lane) !== shortcut.side) return;
    if (Math.abs(rival.lane) < this.config.shortcutEntryOffset) return;

    // Enter where the car actually is, so lap progress never jumps at the mouth.
    const overshoot = THREE.MathUtils.clamp((rival.progress - shortcut.start) / shortcut.span, 0, 0.5);
    rival.activeShortcut = shortcut;
    rival.shortcutId = shortcut.id;
    rival.shortcutLocal = overshoot;
    rival.shortcutBase = rival.raceProgress - shortcut.span * overshoot;
    rival.shortcutSegment = 0;
    rival.shortcutEntryLane = rival.lane;
    rival.maneuver = 'shortcut';
    rival.maneuverTime = 0;
    rival.featureTarget = null;
    this._updateShortcutPose(rival);
    this._emit('rivalShortcutEnter', { rival, shortcutId: shortcut.id, savedMeters: shortcut.savedMeters });
  }

  _exitShortcut(rival, shortcut) {
    rival.activeShortcut = null;
    rival.shortcutId = null;
    rival.shortcutCommitId = null;
    rival.shortcutLocal = 0;
    rival.shortcutSegment = 0;
    rival.maneuver = 'line';
    rival.maneuverTime = 0;
    rival.targetLane = rival.baseLane;
    this._emit('rivalShortcutExit', { rival, shortcutId: shortcut.id, savedMeters: shortcut.savedMeters });
  }

  /**
   * Point and heading at `u` (0..1 of branch arc length) into `_shortcutPoint` /
   * `_shortcutTangent`. The per-rival segment index only walks forward, so a
   * pass costs one or two segment tests instead of scanning the polyline.
   */
  _sampleShortcutPath(shortcut, u, rival = null) {
    const { points, cumulative, pathLength } = shortcut;
    const distance = THREE.MathUtils.clamp(u, 0, 1) * pathLength;
    const last = points.length - 2;
    let index = THREE.MathUtils.clamp(rival?.shortcutSegment ?? 0, 0, last);
    if (cumulative[index] > distance) index = 0;
    while (index < last && cumulative[index + 1] <= distance) index += 1;
    if (rival) rival.shortcutSegment = index;

    const from = points[index];
    const to = points[index + 1];
    const segmentLength = cumulative[index + 1] - cumulative[index];
    const t = segmentLength > EPSILON
      ? THREE.MathUtils.clamp((distance - cumulative[index]) / segmentLength, 0, 1)
      : 0;
    this._shortcutPoint.copy(from).lerp(to, t);
    this._shortcutTangent.subVectors(to, from).setY(0);
    if (this._shortcutTangent.lengthSq() < EPSILON) this._shortcutTangent.set(0, 0, 1);
    else this._shortcutTangent.normalize();
    return index;
  }

  /**
   * World pose while on a branch. `lane` keeps reporting the signed distance
   * from the main centre line, which is what the avoidance and overtake checks
   * read, so a car out on a corridor simply reads as unreachably wide.
   */
  _updateShortcutPose(rival) {
    const shortcut = rival.activeShortcut;
    if (!shortcut) return;
    this._sampleShortcutPath(shortcut, rival.shortcutLocal, rival);
    this.trackCurve.getPointAt(rival.progress, this._point);
    this.trackCurve.getTangentAt(rival.progress, this._tangent).setY(0).normalize();
    this._side.crossVectors(_up, this._tangent).normalize();

    // The branch mouth sits just outside the drivable strip; ease across that
    // last metre instead of snapping the car sideways on the entry frame.
    const blend = THREE.MathUtils.clamp(rival.shortcutLocal / this.config.shortcutBlendIn, 0, 1);
    if (blend < 1) {
      this._scratch.copy(this._shortcutPoint);
      this._laneAnchor.copy(this._point).addScaledVector(this._side, rival.shortcutEntryLane);
      this._shortcutPoint.copy(this._laneAnchor).lerp(this._scratch, blend);
    }

    rival.shortcutWorld = (rival.shortcutWorld ?? new THREE.Vector3()).copy(this._shortcutPoint);
    rival.shortcutHeading = (rival.shortcutHeading ?? new THREE.Vector3()).copy(this._shortcutTangent);
    const lateral = this._scratch.subVectors(this._shortcutPoint, this._point).dot(this._side);
    rival.lane = lateral;
    rival.targetLane = lateral;
  }

  /**
   * Lap progress for one frame. On a branch the car covers `driveLength` meters
   * of tarmac for a full `span` of lap, so the same speed buys more track — the
   * whole shortcut payoff, with no speed bonus anywhere.
   */
  _advanceProgress(rival, delta) {
    const shortcut = rival.activeShortcut;
    if (shortcut) {
      rival.shortcutLocal += (rival.speed * delta) / shortcut.driveLength;
      if (rival.shortcutLocal >= 1) {
        const leftover = (rival.shortcutLocal - 1) * shortcut.driveLength;
        rival.shortcutLocal = 1;
        rival.raceProgress = rival.shortcutBase + shortcut.span + leftover / this.trackLength;
        this._syncRivalProgress(rival);
        this._exitShortcut(rival, shortcut);
        return;
      }
      rival.raceProgress = rival.shortcutBase + shortcut.span * rival.shortcutLocal;
      this._syncRivalProgress(rival);
      this._updateShortcutPose(rival);
      return;
    }
    rival.raceProgress += (rival.speed / this.trackLength) * delta;
    this._syncRivalProgress(rival);
    if (this._featureShortcuts.length > 0) this._tryEnterShortcut(rival);
  }

  _syncRivalProgress(rival) {
    rival.totalProgress = rival.raceProgress;
    rival.progress = wrap01(this.startProgress + rival.raceProgress);
  }

  _boostCeiling(rival) {
    return rival.baseSpeed * rival.skill * this.config.padBoostSpeedMultiplier;
  }

  _triggerPadBoost(rival) {
    if (this._featurePads.length === 0 || rival.airborne || rival.activeShortcut) return;
    const upcoming = this._nextPad(rival);
    if (!upcoming || upcoming.distance > 0) return;
    const { pad } = upcoming;
    if (rival.progress < pad.start || rival.progress > pad.end) return;
    if (Math.abs(rival.lane) > pad.halfWidth) return;
    if (rival.padCooldownId === pad.id && rival.padCooldownTime > 0) return;
    rival.padCooldownId = pad.id;
    rival.padCooldownTime = this.config.padCooldown;
    rival.padBoostTime = this.config.padBoostDuration;
    const impulse = Math.min(
      this.config.padBoostImpulse,
      Math.max(0, this._boostCeiling(rival) - rival.speed),
    );
    rival.speed += impulse;
    this._emit('rivalPadBoost', { rival, padId: pad.id, impulse });
  }

  /**
   * Kinematic ramp height for a rival: ride the ramp surface, launch off the lip
   * into a short parabola, then land back on the road with a small kick.
   */
  _updateRivalHeight(rival, delta) {
    if (this._featureRamps.length === 0) return;
    if (rival.activeShortcut) {
      // Branch corridors are bare tarmac: no ramp on the main line can be
      // straddled from out there, so settle flat and leave the cursor alone.
      rival.activeRamp = null;
      rival.heightOffset = rival.heightOffset > 0.001 ? damp(rival.heightOffset, 0, 12, delta) : 0;
      return;
    }
    const candidate = this._advanceCursor(rival, this._featureRamps, 'rampCursor');
    const onRamp = Boolean(candidate)
      && rival.progress >= candidate.start
      && rival.progress <= candidate.end
      && Math.abs(rival.lane) <= candidate.halfWidth;
    const surface = onRamp ? rampHeightAt(candidate, rival.progress) : 0;

    if (rival.airborne) {
      rival.verticalVelocity -= this.config.gravity * delta;
      rival.heightOffset += rival.verticalVelocity * delta;
      rival.airTime += delta;
      if (rival.heightOffset <= surface) {
        const airTime = rival.airTime;
        rival.heightOffset = surface;
        rival.verticalVelocity = 0;
        rival.airborne = false;
        rival.airTime = 0;
        rival.activeRamp = onRamp ? candidate : null;
        if (airTime >= this.config.landingMinAirTime) {
          rival.landingBoostTime = this.config.landingBoostDuration;
          rival.speed = Math.min(
            rival.speed + this.config.landingBoostImpulse,
            this._boostCeiling(rival),
          );
          this._emit('rivalLanding', { rival, airTime });
        }
      }
      return;
    }

    if (onRamp) {
      rival.activeRamp = candidate;
      rival.heightOffset = surface;
      return;
    }

    const previous = rival.activeRamp;
    if (previous) {
      rival.activeRamp = null;
      const clearedLip = rival.progress >= previous.end - EPSILON
        && rival.heightOffset > previous.height * 0.5;
      if (clearedLip) {
        const rampLength = Math.max(4, (previous.end - previous.start) * this.trackLength);
        const slope = previous.height / rampLength;
        rival.verticalVelocity = THREE.MathUtils.clamp(
          rival.speed * slope * this.config.rampLaunchSlopeGain,
          this.config.rampMinLaunchSpeed,
          this.config.rampMaxLaunchSpeed,
        );
        rival.airborne = true;
        rival.airTime = 0;
        this._emit('rivalRampLaunch', { rival, rampId: previous.id, speed: rival.speed });
        return;
      }
    }
    // Left a ramp sideways (or never launched): settle back onto the road.
    rival.heightOffset = rival.heightOffset > 0.001 ? damp(rival.heightOffset, 0, 12, delta) : 0;
  }

  _separateFromPlayer(rival, delta) {
    if (!this.player.state.started || this.player.state.finished) return;
    const playerProgress = this._playerRaceProgress();
    const longitudinalGap = Math.abs(rival.raceProgress - playerProgress) * this.trackLength;
    const playerLane = this.player.state.roadOffset;
    if (longitudinalGap >= 8 || Math.abs(rival.lane - playerLane) >= 4.15) return;

    if (rival.activeShortcut) {
      // Out on a branch there is no line to swerve to and no shared tarmac to
      // be shoved along, so the only sane answer is to lift off the throttle.
      if (rival.raceProgress < playerProgress) {
        rival.speed = Math.min(rival.speed, Math.max(10, this.player.speed - 1.5));
      }
      return;
    }

    const side = Math.abs(rival.lane - playerLane) > 0.2
      ? Math.sign(rival.lane - playerLane)
      : rival.aggression > 0.58 ? 1 : -1;
    const escapeLane = this._clampLane(playerLane + side * 4.35);
    const startingAvoidance = rival.maneuver !== 'overtake';
    rival.targetLane = escapeLane;
    rival.maneuver = 'overtake';
    rival.maneuverTime = Math.max(rival.maneuverTime, 0.8);
    if (startingAvoidance) {
      this._emit('overtake', {
        rival,
        target: { source: this.player, progress: playerProgress, lane: playerLane, distance: longitudinalGap },
        avoidance: true,
      });
    }
    rival.lane = longitudinalGap < 4.6 && !rival.airborne
      ? escapeLane
      : damp(rival.lane, escapeLane, rival.airborne ? 2.5 : 7, delta);

    if (longitudinalGap < 5.8) {
      const direction = rival.raceProgress >= playerProgress ? 1 : -1;
      rival.raceProgress = playerProgress + direction * (7.2 / this.trackLength);
      rival.totalProgress = rival.raceProgress;
      rival.progress = wrap01(this.startProgress + rival.raceProgress);
    }

    if (rival.raceProgress < playerProgress && longitudinalGap < 6.5) {
      rival.speed = Math.min(rival.speed, Math.max(10, this.player.speed - 1.5));
    }
  }

  _findTargetAhead(rival) {
    let nearest = null;
    let nearestDistance = Infinity;
    const candidates = this._activeRivals()
      .filter((other) => other !== rival)
      .map((other) => ({ source: other, progress: other.raceProgress, lane: other.lane }));
    candidates.push({
      source: this.player,
      progress: this._playerRaceProgress(),
      lane: this.player.state.roadOffset,
    });

    for (const candidate of candidates) {
      const distance = (candidate.progress - rival.raceProgress) * this.trackLength;
      if (
        distance <= 2.5
        || distance >= this.config.overtakeDistance
        || Math.abs(candidate.lane - rival.lane) > 2.4
        || distance >= nearestDistance
      ) continue;
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest ? { ...nearest, distance: nearestDistance } : null;
  }

  _clampLane(lane) {
    return THREE.MathUtils.clamp(lane, -this.config.trackWidth * 0.32, this.config.trackWidth * 0.32);
  }

  _placeRival(rival, delta) {
    if (!rival.object) return;
    const shortcut = rival.activeShortcut;
    if (shortcut) {
      this._point.copy(rival.shortcutWorld);
      this._tangent.copy(rival.shortcutHeading);
    } else {
      this.trackCurve.getPointAt(rival.progress, this._point);
      this.trackCurve.getTangentAt(rival.progress, this._tangent).normalize();
    }
    this._side.crossVectors(_up, this._tangent).normalize();
    rival.object.position.copy(this._point);
    if (!shortcut) rival.object.position.addScaledVector(this._side, rival.lane);
    rival.object.position.y += 0.04 + Math.max(0, rival.heightOffset ?? 0);
    this._matrix.makeBasis(this._side, _up, this._tangent);
    this._quaternion.setFromRotationMatrix(this._matrix);
    rival.object.quaternion.slerp(this._quaternion, delta >= 1 ? 1 : 1 - Math.exp(-10 * delta));
    for (const wheel of rival.object.userData?.wheels ?? []) {
      wheel.rotation.x += (rival.speed * Math.min(delta, 0.05)) / 0.43;
    }
    const flameOn = this.state.status === 'racing'
      && (rival.maneuver === 'overtake'
        || rival.padBoostTime > 0
        || rival.landingBoostTime > 0
        || Math.sin(this.state.raceTime * 1.7 + rival.aggression * 9) > 0.9);
    for (const flame of rival.object.userData?.nitroFlames ?? []) {
      flame.visible = flameOn;
      flame.scale.y = 0.9 + Math.sin(this.state.raceTime * 28 + rival.aggression) * 0.24;
    }
  }

  _updateStandings() {
    const playerEntry = {
      id: 'player',
      name: 'YOU',
      isPlayer: true,
      progress: this._playerRaceProgress(),
      finished: this.player.state.finished,
      finishTime: this.player.state.result?.finalTime ?? null,
    };
    const entries = [playerEntry, ...this._activeRivals().map((rival) => ({
      id: rival.id,
      name: rival.name,
      isPlayer: false,
      progress: rival.raceProgress,
      finished: rival.finished,
      finishTime: rival.finishTime,
    }))];

    entries.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    this.state.standings = entries.map((entry, index) => ({ ...entry, position: index + 1 }));
    this.state.playerPosition = this.state.standings.find((entry) => entry.isPlayer)?.position ?? 1;
  }

  _finalizePlayer() {
    this._updateStandings();
    const baseResult = this.player.state.result ?? {};
    const result = {
      ...baseResult,
      status: 'finished',
      position: this.state.playerPosition,
      entrants: this.state.entrantCount,
      standings: this.getStandings(),
    };
    this.state.status = 'finished';
    this.state.result = result;
    this.player.state.result = result;
    this._emit('finish', result);
  }
}

export default RaceSystem;
