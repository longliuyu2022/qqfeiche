import * as THREE from 'three';

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
});

const _up = new THREE.Vector3(0, 1, 0);

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function damp(current, target, response, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-response * delta));
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
      return Object.assign(source, {
        id: source.id ?? `rival-${index + 1}`,
        name: source.name ?? `APEX ${String(index + 2).padStart(2, '0')}`,
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
        aggression: THREE.MathUtils.clamp(source.aggression ?? 0.42 + (index % 3) * 0.16, 0.25, 0.9),
      });
    });
    this.activeRivalCount = THREE.MathUtils.clamp(
      Math.floor(options.activeRivalCount ?? this.rivals.length),
      0,
      this.rivals.length,
    );

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

  configure({ totalLaps = this.totalLaps, rivalCount = this.activeRivalCount } = {}) {
    this.totalLaps = Math.max(1, Math.floor(totalLaps));
    this.activeRivalCount = THREE.MathUtils.clamp(
      Math.floor(rivalCount),
      0,
      this.rivals.length,
    );
    this.state.entrantCount = this.activeRivalCount + 1;
    this.reset();
    return this;
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
    const playerProgress = this._playerRaceProgress();
    const currentProgress = wrap01(this.startProgress + rival.raceProgress);
    this.trackCurve.getTangentAt(currentProgress, this._tangent).setY(0).normalize();
    this.trackCurve.getTangentAt(wrap01(currentProgress + 0.014), this._aheadTangent).setY(0).normalize();
    const bendAngle = Math.acos(THREE.MathUtils.clamp(this._tangent.dot(this._aheadTangent), -1, 1));
    const cornerLoad = THREE.MathUtils.smoothstep(bendAngle, 0.06, 0.42);
    const gapToPlayer = (playerProgress - rival.raceProgress) * this.trackLength;
    const rubberBand = THREE.MathUtils.clamp(gapToPlayer / 170, -1, 1) * this.config.rubberBandStrength;

    if (rival.maneuverTime <= 0) {
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

    rival.lane = damp(rival.lane, rival.targetLane, this.config.laneResponse, delta);
    let targetSpeed = rival.baseSpeed * rival.skill * (1 - cornerLoad * 0.18) + rubberBand;
    if (rival.maneuver === 'overtake') targetSpeed += 2.2 + rival.aggression * 1.8;
    if (rival.maneuver === 'defend') targetSpeed += 0.7;
    targetSpeed = THREE.MathUtils.clamp(targetSpeed, rival.baseSpeed * 0.72, rival.baseSpeed * 1.13 + 4);
    const speedDelta = THREE.MathUtils.clamp(
      targetSpeed - rival.speed,
      -this.config.aiBraking * delta,
      this.config.aiAcceleration * delta,
    );
    rival.speed += speedDelta;
    rival.raceProgress += (rival.speed / this.trackLength) * delta;
    rival.totalProgress = rival.raceProgress;
    rival.progress = wrap01(this.startProgress + rival.raceProgress);
    this._separateFromPlayer(rival, delta);

    if (!rival.finished && rival.raceProgress >= this.totalLaps) {
      rival.finished = true;
      rival.finishTime = this.state.raceTime;
      this._emit('rivalFinish', { rival, time: rival.finishTime });
    }
    this._placeRival(rival, delta);
  }

  _separateFromPlayer(rival, delta) {
    if (!this.player.state.started || this.player.state.finished) return;
    const playerProgress = this._playerRaceProgress();
    const longitudinalGap = Math.abs(rival.raceProgress - playerProgress) * this.trackLength;
    const playerLane = this.player.state.roadOffset;
    if (longitudinalGap >= 8 || Math.abs(rival.lane - playerLane) >= 4.15) return;

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
    rival.lane = longitudinalGap < 4.6
      ? escapeLane
      : damp(rival.lane, escapeLane, 7, delta);

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
    this.trackCurve.getPointAt(rival.progress, this._point);
    this.trackCurve.getTangentAt(rival.progress, this._tangent).normalize();
    this._side.crossVectors(_up, this._tangent).normalize();
    rival.object.position.copy(this._point).addScaledVector(this._side, rival.lane);
    rival.object.position.y += 0.04;
    this._matrix.makeBasis(this._side, _up, this._tangent);
    this._quaternion.setFromRotationMatrix(this._matrix);
    rival.object.quaternion.slerp(this._quaternion, delta >= 1 ? 1 : 1 - Math.exp(-10 * delta));
    for (const wheel of rival.object.userData?.wheels ?? []) {
      wheel.rotation.x += (rival.speed * Math.min(delta, 0.05)) / 0.43;
    }
    const flameOn = this.state.status === 'racing'
      && (rival.maneuver === 'overtake' || Math.sin(this.state.raceTime * 1.7 + rival.aggression * 9) > 0.9);
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
