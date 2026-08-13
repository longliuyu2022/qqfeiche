const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_WINDOW_MS = 20000;
const PROBE_INTERVAL_MS = 4000;
export const PLAYER_ID_KEY = 'neon-apex:player-id:v1';

export function connectionQuality(latencyMs) {
  if (!Number.isFinite(latencyMs)) return 'unknown';
  if (latencyMs <= 60) return 'excellent';
  if (latencyMs <= 120) return 'good';
  if (latencyMs <= 220) return 'fair';
  return 'poor';
}

function defaultSocketUrl() {
  if (!location.host || location.protocol === 'file:') return 'wss://gaokao.aiimage.icu/multiplayer';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/multiplayer`;
}

function randomPlayerId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // Fall through to the manual generator below.
  }
  let id = '';
  for (let index = 0; index < 32; index += 1) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

// Anonymous, device-local identity used by the server to look up a stored rank.
// There are no accounts, so this id is all the continuity a guest gets.
export function resolvePlayerId(storage) {
  let target = storage;
  if (target === undefined) {
    try {
      target = globalThis.localStorage;
    } catch {
      target = null;
    }
  }
  if (!target?.getItem) return randomPlayerId();
  try {
    const stored = target.getItem(PLAYER_ID_KEY);
    if (typeof stored === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(stored)) return stored;
    const created = randomPlayerId();
    target.setItem(PLAYER_ID_KEY, created);
    return created;
  } catch {
    return randomPlayerId();
  }
}

export class MultiplayerClient extends EventTarget {
  constructor({ url = defaultSocketUrl(), storage, rankState = null } = {}) {
    super();
    this.url = url;
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.playerId = resolvePlayerId(storage);
    this.reconnectToken = null;
    this.intentionalClose = false;
    this.pending = null;
    this.reconnectStartedAt = 0;
    this.reconnectTimer = null;
    this.connectionState = 'idle';
    this.latencyMs = null;
    this.jitterMs = null;
    this.clockOffsetMs = 0;
    this.probeTimer = null;
    this.probeNonce = 0;
    this.probes = new Map();
    this.matching = false;
    this.matchStatus = null;
    this.rank = null;
    this.lastRankResult = null;
    this.lastRaceResult = null;
    this.seenSettlements = new Set();
    this.localRankState = rankState;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get isHost() {
    return Boolean(this.room && this.room.hostId === this.selfId);
  }

  get isRanked() {
    return Boolean(this.room?.ranked);
  }

  get networkQuality() {
    return connectionQuality(this.latencyMs);
  }

  get serverNow() {
    return Date.now() + this.clockOffsetMs;
  }

  // Rank rows for the current room, ready for lobby rendering.
  get roster() {
    return (this.room?.players ?? []).map((player) => ({
      ...player,
      self: player.id === this.selfId,
    }));
  }

  async createRoom({ name, map }) {
    return this._request('create', { name, map, ...this._identity() });
  }

  async joinRoom({ name, code }) {
    return this._request('join', { name, code: String(code || '').trim().toUpperCase(), ...this._identity() });
  }

  // Ranked matchmaking: the server picks the room, the map and the start time.
  async quickMatch({ name } = {}) {
    this.matching = true;
    try {
      const room = await this._request('quickMatch', { name, ...this._identity() });
      return room;
    } catch (error) {
      this.matching = false;
      throw error;
    }
  }

  cancelQuickMatch() {
    if (!this.connected) {
      this.matching = false;
      this.matchStatus = null;
      this.dispatchEvent(new CustomEvent('match-cancelled', { detail: { reason: 'offline' } }));
      return false;
    }
    return this.send('cancelQuickMatch');
  }

  // rankPoints is a courtesy hint for logging only; the server settles from
  // its own stored rank and ignores whatever we claim here.
  _identity() {
    const points = Number(this.localRankState?.points);
    return {
      playerId: this.playerId,
      ...(Number.isFinite(points) ? { rankPoints: points } : {}),
    };
  }

  startRace() {
    this.send('start');
  }

  markReady() {
    this.send('ready');
  }

  sendState(state) {
    this.send('state', state);
  }

  send(type, payload = {}) {
    if (!this.connected) return false;
    this.socket.send(JSON.stringify({ type, ...payload }));
    return true;
  }

  leave() {
    this.intentionalClose = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this._stopProbes();
    if (this.connected) this.send('leave');
    this.socket?.close(1000, 'leave');
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.reconnectToken = null;
    this.matching = false;
    this.matchStatus = null;
    this.connectionState = 'idle';
    this.dispatchEvent(new CustomEvent('left'));
  }

  async _request(type, payload) {
    if (this.pending) throw new Error('已有联机请求正在处理');
    this.intentionalClose = false;
    await this._connect();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending = null;
        reject(new Error('连接超时，请稍后重试'));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { resolve, reject, timeout };
      this.send(type, payload);
    });
  }

  _connect() {
    if (this.connected) return Promise.resolve();
    this.connectionState = this.reconnectStartedAt ? 'reconnecting' : 'connecting';
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('无法连接比赛服务器'));
      }, REQUEST_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        this.connectionState = 'connected';
        this._startProbes();
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('比赛服务器暂不可用'));
      }, { once: true });
      socket.addEventListener('message', (event) => this._handleMessage(event));
      socket.addEventListener('close', () => this._handleClose(socket));
    });
  }

  _handleMessage(event) {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'joined' || message.type === 'resumed') {
      this.selfId = message.selfId;
      this.reconnectToken = message.reconnectToken;
      this.room = message.room;
      this.matching = Boolean(message.room?.ranked && message.room?.phase === 'lobby');
      this.connectionState = 'connected';
      this.reconnectStartedAt = 0;
      if (message.rank) this.rank = message.rank;
      this._syncSelfRank();
      if (this.pending) {
        clearTimeout(this.pending.timeout);
        this.pending.resolve(message.room);
        this.pending = null;
      }
      this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
      return;
    }
    if (message.type === 'room') {
      this.room = message.room;
      this.matching = Boolean(message.room?.ranked && message.room?.phase === 'lobby');
      this._syncSelfRank();
    }
    if (message.type === 'match-status') {
      this.matchStatus = message;
      this.matching = true;
      this._syncServerClock(message.serverTime);
    }
    if (message.type === 'match-cancelled') {
      this.matching = false;
      this.matchStatus = null;
      this.room = null;
      this.selfId = null;
      this.reconnectToken = null;
    }
    if (message.type === 'prepare' || message.type === 'race-start') this.matching = false;
    if (message.type === 'race-start') {
      if (message.raceId && message.raceId !== this.lastRaceResult?.raceId) {
        this.lastRaceResult = null;
        this.lastRankResult = null;
      }
    }
    if (message.type === 'race-result') {
      if (this._isDuplicateSettlement(message)) return;
      this.lastRaceResult = message;
    }
    if (message.type === 'rankResult') {
      if (this._isDuplicateSettlement(message)) return;
      this.lastRankResult = message;
      if (message.rank) this.rank = message.rank;
    }
    if (message.type === 'pong') {
      this._recordPong(message);
      return;
    }
    if (message.type === 'error' && this.pending) {
      clearTimeout(this.pending.timeout);
      this.matching = false;
      this.pending.reject(new Error(message.message || '联机请求失败'));
      this.pending = null;
    }
    this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
  }

  _syncSelfRank() {
    const self = this.room?.players?.find((player) => player.id === this.selfId);
    if (self?.rank) this.rank = self.rank;
  }

  _handleClose(socket) {
    if (socket !== this.socket) return;
    this.socket = null;
    this._stopProbes();
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('连接已断开'));
      this.pending = null;
    }
    if (this.intentionalClose || !this.room || !this.reconnectToken) {
      this.connectionState = 'idle';
      return;
    }
    this.connectionState = 'reconnecting';
    this.dispatchEvent(new CustomEvent('reconnecting', { detail: this.connectionInfo() }));
    if (!this.reconnectStartedAt) this.reconnectStartedAt = Date.now();
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (Date.now() - this.reconnectStartedAt >= RECONNECT_WINDOW_MS) {
      this.connectionState = 'lost';
      this.dispatchEvent(new CustomEvent('connection-lost', { detail: this.connectionInfo() }));
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this._connect();
        this.send('resume', {
          code: this.room.code,
          playerId: this.selfId,
          reconnectToken: this.reconnectToken,
        });
      } catch {
        this._scheduleReconnect();
      }
    }, 1200);
  }

  connectionInfo() {
    return {
      state: this.connectionState,
      latencyMs: this.latencyMs,
      jitterMs: this.jitterMs,
      quality: this.networkQuality,
    };
  }

  waitForRankResult({ raceId = this.room?.raceId ?? null, timeoutMs = 15000 } = {}) {
    if (this.lastRankResult && (!raceId || this.lastRankResult.raceId === raceId)) {
      return Promise.resolve(this.lastRankResult);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removeEventListener('rankResult', onResult);
        reject(new Error('服务器结算超时'));
      }, timeoutMs);
      const onResult = (event) => {
        if (raceId && event.detail?.raceId !== raceId) return;
        clearTimeout(timeout);
        this.removeEventListener('rankResult', onResult);
        resolve(event.detail);
      };
      this.addEventListener('rankResult', onResult);
    });
  }

  _isDuplicateSettlement(message) {
    if (!message.settlementId) return false;
    const key = `${message.type}:${message.settlementId}`;
    if (this.seenSettlements.has(key)) return true;
    this.seenSettlements.add(key);
    if (this.seenSettlements.size > 16) this.seenSettlements.delete(this.seenSettlements.values().next().value);
    return false;
  }

  _startProbes() {
    this._stopProbes();
    this._sendProbe();
    this.probeTimer = setInterval(() => this._sendProbe(), PROBE_INTERVAL_MS);
    this.probeTimer?.unref?.();
  }

  _stopProbes() {
    clearInterval(this.probeTimer);
    this.probeTimer = null;
    this.probes.clear();
  }

  _sendProbe() {
    if (!this.connected) return;
    const nonce = ++this.probeNonce;
    const clientTime = Date.now();
    this.probes.set(nonce, clientTime);
    while (this.probes.size > 3) this.probes.delete(this.probes.keys().next().value);
    this.send('ping', { nonce, clientTime });
  }

  _recordPong(message) {
    const sentAt = this.probes.get(message.nonce) ?? Number(message.clientTime);
    if (!Number.isFinite(sentAt)) return;
    this.probes.delete(message.nonce);
    const receivedAt = Date.now();
    const sample = Math.max(0, receivedAt - sentAt);
    const previous = this.latencyMs;
    this.latencyMs = previous === null ? sample : Math.round(previous * 0.72 + sample * 0.28);
    const deviation = previous === null ? 0 : Math.abs(sample - previous);
    this.jitterMs = this.jitterMs === null ? deviation : Math.round(this.jitterMs * 0.7 + deviation * 0.3);
    this._syncServerClock(message.serverTime, sentAt, receivedAt);
    this.dispatchEvent(new CustomEvent('connection-quality', { detail: this.connectionInfo() }));
  }

  _syncServerClock(serverTime, sentAt = Date.now(), receivedAt = Date.now()) {
    const server = Number(serverTime);
    if (!Number.isFinite(server)) return;
    const sample = server - (sentAt + receivedAt) / 2;
    this.clockOffsetMs = Math.round(this.clockOffsetMs * 0.75 + sample * 0.25);
  }
}
