const REQUEST_TIMEOUT_MS = 8000;
const RECONNECT_WINDOW_MS = 20000;

function defaultSocketUrl() {
  if (!location.host || location.protocol === 'file:') return 'wss://gaokao.aiimage.icu/multiplayer';
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/multiplayer`;
}

export class MultiplayerClient extends EventTarget {
  constructor({ url = defaultSocketUrl() } = {}) {
    super();
    this.url = url;
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.reconnectToken = null;
    this.intentionalClose = false;
    this.pending = null;
    this.reconnectStartedAt = 0;
    this.reconnectTimer = null;
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get isHost() {
    return Boolean(this.room && this.room.hostId === this.selfId);
  }

  async createRoom({ name, map }) {
    return this._request('create', { name, map });
  }

  async joinRoom({ name, code }) {
    return this._request('join', { name, code: String(code || '').trim().toUpperCase() });
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
    if (this.connected) this.send('leave');
    this.socket?.close(1000, 'leave');
    this.socket = null;
    this.room = null;
    this.selfId = null;
    this.reconnectToken = null;
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
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('无法连接比赛服务器'));
      }, REQUEST_TIMEOUT_MS);
      socket.addEventListener('open', () => {
        clearTimeout(timeout);
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
      if (this.pending) {
        clearTimeout(this.pending.timeout);
        this.pending.resolve(message.room);
        this.pending = null;
      }
      this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
      return;
    }
    if (message.type === 'room') this.room = message.room;
    if (message.type === 'error' && this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(new Error(message.message || '联机请求失败'));
      this.pending = null;
    }
    this.dispatchEvent(new CustomEvent(message.type, { detail: message }));
  }

  _handleClose(socket) {
    if (socket !== this.socket) return;
    this.socket = null;
    if (this.pending) {
      clearTimeout(this.pending.timeout);
      this.pending.reject(new Error('连接已断开'));
      this.pending = null;
    }
    if (this.intentionalClose || !this.room || !this.reconnectToken) return;
    this.dispatchEvent(new CustomEvent('reconnecting'));
    if (!this.reconnectStartedAt) this.reconnectStartedAt = Date.now();
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (Date.now() - this.reconnectStartedAt >= RECONNECT_WINDOW_MS) {
      this.dispatchEvent(new CustomEvent('connection-lost'));
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
        this.reconnectStartedAt = 0;
      } catch {
        this._scheduleReconnect();
      }
    }, 1200);
  }
}
