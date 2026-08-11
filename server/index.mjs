import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { validateRaceState } from './race-validation.mjs';

const HOST = process.env.NEON_APEX_HOST || '127.0.0.1';
const PORT = Number(process.env.NEON_APEX_PORT || 3010);
const MAX_PLAYERS = 6;
const RECONNECT_MS = 20000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const START_DELAY_MS = envInteger('NEON_APEX_START_DELAY_MS', 3500, 0, 10000);
const MAX_ROOMS = envInteger('NEON_APEX_MAX_ROOMS', 512, 1, 10000);
const MAX_CONNECTIONS = envInteger('NEON_APEX_MAX_CONNECTIONS', 1024, 2, 10000);
const MAX_CONNECTIONS_PER_IP = envInteger('NEON_APEX_MAX_CONNECTIONS_PER_IP', 12, 2, 100);
const LOBBY_ACTION_LIMIT = envInteger('NEON_APEX_LOBBY_ACTION_LIMIT', 12, 1, 100);
const LOBBY_ACTION_WINDOW_MS = envInteger('NEON_APEX_LOBBY_ACTION_WINDOW_MS', 10000, 1000, 60000);
const UNAUTHENTICATED_IDLE_MS = envInteger('NEON_APEX_UNAUTHENTICATED_IDLE_MS', 15000, 1000, 60000);
const MAX_INVALID_STATES = 8;
const MAP_IDS = new Set(['night', 'day', 'alpine', 'canyon', 'coast']);
const rooms = new Map();
const connectionsByIp = new Map();
const lobbyActionsByIp = new Map();

function envInteger(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

function send(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function clientIp(request) {
  const direct = request.socket.remoteAddress || 'unknown';
  const loopback = direct === '127.0.0.1' || direct === '::1' || direct === '::ffff:127.0.0.1';
  const forwarded = request.headers['x-forwarded-for'];
  if (!loopback || !forwarded) return direct;
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value).split(',')[0].trim().slice(0, 64) || direct;
}

function rejectUpgrade(socket, status = 429, message = 'Too Many Requests') {
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n`
      + 'Connection: close\r\n'
      + 'Content-Type: text/plain; charset=utf-8\r\n'
      + `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

function consumeLobbyAction(socket) {
  const now = Date.now();
  const key = socket.clientIp || 'unknown';
  let bucket = lobbyActionsByIp.get(key);
  if (!bucket || now - bucket.startedAt >= LOBBY_ACTION_WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    lobbyActionsByIp.set(key, bucket);
  }
  if (bucket.count >= LOBBY_ACTION_LIMIT) {
    send(socket, { type: 'error', code: 'RATE_LIMITED', message: '操作太频繁，请稍后重试' });
    return false;
  }
  bucket.count += 1;
  return true;
}

function sanitizeName(value) {
  const normalized = String(value || '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 12);
  return normalized || `车手${Math.floor(Math.random() * 900 + 100)}`;
}

function normalizeMap(value) {
  return MAP_IDS.has(value) ? value : 'night';
}

function generateRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i] % alphabet.length];
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to allocate room code');
}

function serializeRoom(room) {
  return {
    code: room.code,
    map: room.map,
    phase: room.phase,
    hostId: room.hostId,
    players: [...room.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      connected: Boolean(player.socket),
      ready: player.ready,
      finished: player.state?.finished ?? false,
    })),
  };
}

function broadcast(room, payload) {
  const message = JSON.stringify(payload);
  for (const player of room.players.values()) {
    if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(message);
  }
}

function broadcastRoom(room) {
  room.lastActiveAt = Date.now();
  broadcast(room, { type: 'room', room: serializeRoom(room) });
}

function socketPlayer(socket) {
  const room = socket.roomCode ? rooms.get(socket.roomCode) : null;
  const player = room?.players.get(socket.playerId);
  return room && player ? { room, player } : null;
}

function attachPlayer(socket, room, player) {
  socket.roomCode = room.code;
  socket.playerId = player.id;
  socket.messageWindowAt = Date.now();
  socket.messageCount = 0;
  clearTimeout(socket.unauthenticatedTimer);
  socket.unauthenticatedTimer = null;
  player.socket = socket;
  player.disconnectedAt = null;
}

function createPlayer(name, index) {
  const palette = [0x04cbe5, 0xff4f61, 0xf2b84b, 0x7d5cff, 0x30bd78, 0xe773d2];
  return {
    id: randomUUID(),
    reconnectToken: randomBytes(24).toString('hex'),
    name: sanitizeName(name),
    color: palette[index % palette.length],
    socket: null,
    disconnectedAt: null,
    ready: false,
    state: null,
    lastSequence: -1,
    lastStateAt: null,
    invalidStateCount: 0,
  };
}

function removePlayer(room, playerId) {
  const wasHost = room.hostId === playerId;
  room.players.delete(playerId);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (wasHost) room.hostId = room.players.keys().next().value;
  broadcastRoom(room);
}

function onCreate(socket, message) {
  if (socketPlayer(socket)) return;
  if (!consumeLobbyAction(socket)) return;
  if (rooms.size >= MAX_ROOMS) {
    return send(socket, { type: 'error', code: 'SERVER_BUSY', message: '比赛房间已满，请稍后重试' });
  }
  const code = generateRoomCode();
  const room = {
    code,
    map: normalizeMap(message.map),
    phase: 'lobby',
    hostId: null,
    players: new Map(),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    startAt: null,
  };
  const player = createPlayer(message.name, 0);
  room.hostId = player.id;
  room.players.set(player.id, player);
  rooms.set(code, room);
  attachPlayer(socket, room, player);
  send(socket, {
    type: 'joined', selfId: player.id, reconnectToken: player.reconnectToken, room: serializeRoom(room),
  });
  broadcastRoom(room);
}

function onJoin(socket, message) {
  if (socketPlayer(socket)) return;
  if (!consumeLobbyAction(socket)) return;
  const code = String(message.code || '').trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return send(socket, { type: 'error', code: 'ROOM_NOT_FOUND', message: '没有找到这个房间' });
  if (room.phase !== 'lobby') return send(socket, { type: 'error', code: 'RACE_STARTED', message: '比赛已经开始' });
  if (room.players.size >= MAX_PLAYERS) return send(socket, { type: 'error', code: 'ROOM_FULL', message: '房间已满（最多 6 人）' });
  const player = createPlayer(message.name, room.players.size);
  room.players.set(player.id, player);
  attachPlayer(socket, room, player);
  send(socket, {
    type: 'joined', selfId: player.id, reconnectToken: player.reconnectToken, room: serializeRoom(room),
  });
  broadcastRoom(room);
}

function onResume(socket, message) {
  if (!consumeLobbyAction(socket)) return;
  const room = rooms.get(String(message.code || '').toUpperCase());
  const player = room?.players.get(String(message.playerId || ''));
  if (!room || !player || player.reconnectToken !== message.reconnectToken) {
    return send(socket, { type: 'error', code: 'RESUME_FAILED', message: '无法恢复比赛连接' });
  }
  if (player.socket && player.socket !== socket) player.socket.close(4001, 'replaced');
  attachPlayer(socket, room, player);
  send(socket, {
    type: 'resumed', selfId: player.id, reconnectToken: player.reconnectToken, room: serializeRoom(room),
  });
  if (room.phase === 'racing') send(socket, { type: 'race-start', startAt: room.startAt, map: room.map });
  broadcastRoom(room);
}

function onStart(socket) {
  const context = socketPlayer(socket);
  if (!context) return;
  const { room, player } = context;
  if (room.hostId !== player.id) return send(socket, { type: 'error', code: 'HOST_ONLY', message: '只有房主可以开始比赛' });
  const connectedPlayers = [...room.players.values()].filter((entry) => entry.socket);
  if (connectedPlayers.length < 2) return send(socket, { type: 'error', code: 'NEED_PLAYERS', message: '至少需要 2 名车手' });
  if (room.phase !== 'lobby') return;
  room.phase = 'loading';
  for (const entry of room.players.values()) entry.ready = false;
  broadcastRoom(room);
  broadcast(room, { type: 'prepare', map: room.map });
}

function onReady(socket) {
  const context = socketPlayer(socket);
  if (!context || context.room.phase !== 'loading') return;
  context.player.ready = true;
  broadcastRoom(context.room);
  const connected = [...context.room.players.values()].filter((player) => player.socket);
  if (connected.length < 2 || !connected.every((player) => player.ready)) return;
  context.room.phase = 'racing';
  context.room.startAt = Date.now() + START_DELAY_MS;
  broadcastRoom(context.room);
  broadcast(context.room, { type: 'race-start', startAt: context.room.startAt, map: context.room.map });
}

function onState(socket, message) {
  const context = socketPlayer(socket);
  if (!context || context.room.phase !== 'racing') return;
  const sequence = Math.floor(Number(message.sequence) || 0);
  if (sequence <= context.player.lastSequence) return;
  context.player.lastSequence = sequence;
  const validation = validateRaceState({
    previous: context.player.state
      ? { ...context.player.state, acceptedAt: context.player.lastStateAt }
      : null,
    message: { ...message, sequence },
    map: context.room.map,
    startAt: context.room.startAt,
  });
  if (!validation.accepted) {
    context.player.invalidStateCount += 1;
    if (context.player.invalidStateCount >= MAX_INVALID_STATES) socket.close(1008, 'invalid race state');
    return;
  }
  context.player.invalidStateCount = Math.max(0, context.player.invalidStateCount - 1);
  context.player.lastStateAt = validation.acceptedAt;
  context.player.state = validation.state;
  context.room.lastActiveAt = Date.now();
}

function onMessage(socket, raw) {
  if (raw.length > 4096) return socket.close(1009, 'message too large');
  const now = Date.now();
  if (now - socket.messageWindowAt >= 1000) {
    socket.messageWindowAt = now;
    socket.messageCount = 0;
  }
  socket.messageCount += 1;
  if (socket.messageCount > 35) return socket.close(1008, 'rate limit');
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'create') onCreate(socket, message);
  else if (message.type === 'join') onJoin(socket, message);
  else if (message.type === 'resume') onResume(socket, message);
  else if (message.type === 'start') onStart(socket);
  else if (message.type === 'ready') onReady(socket);
  else if (message.type === 'state') onState(socket, message);
  else if (message.type === 'leave') {
    const context = socketPlayer(socket);
    if (context) removePlayer(context.room, context.player.id);
    socket.roomCode = null;
    socket.playerId = null;
  }
}

const httpServer = createServer((request, response) => {
  if (request.url === '/multiplayer/healthz' || request.url === '/healthz') {
    return json(response, 200, {
      status: 'ok', rooms: rooms.size, connections: webSocketServer.clients.size, uptime: Math.floor(process.uptime()),
    });
  }
  return json(response, 404, { error: 'not_found' });
});

const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 4096 });
httpServer.on('upgrade', (request, socket, head) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path !== '/multiplayer') return socket.destroy();
  request.clientIp = clientIp(request);
  const ipConnections = connectionsByIp.get(request.clientIp) ?? 0;
  if (webSocketServer.clients.size >= MAX_CONNECTIONS || ipConnections >= MAX_CONNECTIONS_PER_IP) {
    return rejectUpgrade(socket);
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => webSocketServer.emit('connection', client, request));
});

webSocketServer.on('connection', (socket, request) => {
  socket.clientIp = request.clientIp;
  connectionsByIp.set(socket.clientIp, (connectionsByIp.get(socket.clientIp) ?? 0) + 1);
  socket.messageWindowAt = Date.now();
  socket.messageCount = 0;
  socket.unauthenticatedTimer = setTimeout(() => {
    if (!socketPlayer(socket)) socket.close(1008, 'join timeout');
  }, UNAUTHENTICATED_IDLE_MS);
  socket.on('message', (raw) => onMessage(socket, raw));
  socket.on('close', () => {
    clearTimeout(socket.unauthenticatedTimer);
    const remaining = Math.max(0, (connectionsByIp.get(socket.clientIp) ?? 1) - 1);
    if (remaining) connectionsByIp.set(socket.clientIp, remaining);
    else connectionsByIp.delete(socket.clientIp);
    const context = socketPlayer(socket);
    if (!context || context.player.socket !== socket) return;
    context.player.socket = null;
    context.player.disconnectedAt = Date.now();
    broadcastRoom(context.room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of lobbyActionsByIp) {
    if (now - bucket.startedAt > LOBBY_ACTION_WINDOW_MS * 2) lobbyActionsByIp.delete(ip);
  }
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (player.disconnectedAt && now - player.disconnectedAt > RECONNECT_MS) removePlayer(room, player.id);
    }
    if (rooms.has(room.code) && now - room.lastActiveAt > ROOM_IDLE_MS) {
      for (const player of room.players.values()) player.socket?.close(1001, 'room expired');
      rooms.delete(room.code);
    }
  }
}, 3000).unref();

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.phase !== 'racing') continue;
    const players = [...room.players.values()]
      .filter((player) => player.state)
      .map((player) => ({ id: player.id, ...player.state }));
    if (players.length) broadcast(room, { type: 'snapshot', serverTime: Date.now(), players });
  }
}, 66).unref();

httpServer.listen(PORT, HOST, () => {
  console.log(`Neon Apex multiplayer listening on http://${HOST}:${PORT}`);
});
