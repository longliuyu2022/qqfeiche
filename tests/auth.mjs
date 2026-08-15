import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createAuthStore } from '../server/auth-store.mjs';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'neon-apex-auth-'));
const authFile = path.join(temporaryDirectory, 'accounts.json');
const port = 14200 + Math.floor(Math.random() * 500);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    NEON_APEX_PORT: String(port),
    NEON_APEX_AUTH_FILE: authFile,
    NEON_APEX_AUTH_ACTION_LIMIT: '50',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function request(pathname, { method = 'GET', body, cookie, requestOrigin = origin } = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(requestOrigin ? { origin: requestOrigin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    body: await response.json(),
    setCookie: response.headers.get('set-cookie'),
  };
}

const waitForMessage = (socket, type, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), timeoutMs);
  socket.on('message', function handler(raw) {
    const message = JSON.parse(raw.toString());
    if (message.type !== type) return;
    clearTimeout(timeout);
    socket.off('message', handler);
    resolve(message);
  });
});

const username = '车手Alpha';
const password = 'custom-pass-42';
let sessionCookie;

try {
  await Promise.race([
    once(server.stdout, 'data'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('server startup timeout')), 5000)),
  ]);

  const guest = await request('/multiplayer/auth/session');
  assert.equal(guest.status, 200);
  assert.equal(guest.body.user, null);

  const invalidUsername = await request('/multiplayer/auth/register', {
    method: 'POST', body: { username: '!', password },
  });
  assert.equal(invalidUsername.status, 400);
  assert.equal(invalidUsername.body.error, 'INVALID_USERNAME');

  const weakPassword = await request('/multiplayer/auth/register', {
    method: 'POST', body: { username, password: 'short' },
  });
  assert.equal(weakPassword.status, 400);
  assert.equal(weakPassword.body.error, 'INVALID_PASSWORD');

  const registered = await request('/multiplayer/auth/register', {
    method: 'POST', body: { username, password },
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.username, username);
  assert.match(registered.body.user.id, /^[0-9a-f-]{36}$/);
  assert.match(registered.setCookie, /HttpOnly/);
  assert.match(registered.setCookie, /SameSite=Strict/);
  sessionCookie = registered.setCookie.split(';')[0];

  const current = await request('/multiplayer/auth/session', { cookie: sessionCookie });
  assert.equal(current.body.user.username, username);

  const duplicate = await request('/multiplayer/auth/register', {
    method: 'POST', body: { username: '车手alpha', password },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error, 'USERNAME_TAKEN');

  const wrongPassword = await request('/multiplayer/auth/login', {
    method: 'POST', body: { username, password: 'wrong-password' },
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.error, 'INVALID_CREDENTIALS');

  const crossOrigin = await request('/multiplayer/auth/login', {
    method: 'POST', body: { username, password }, requestOrigin: 'https://attacker.example',
  });
  assert.equal(crossOrigin.status, 403);

  const loggedOut = await request('/multiplayer/auth/logout', { method: 'POST', cookie: sessionCookie });
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.setCookie, /Max-Age=0/);
  const expired = await request('/multiplayer/auth/session', { cookie: sessionCookie });
  assert.equal(expired.body.user, null);

  const loggedIn = await request('/multiplayer/auth/login', {
    method: 'POST', body: { username, password },
  });
  assert.equal(loggedIn.status, 200);
  sessionCookie = loggedIn.setCookie.split(';')[0];

  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`, {
    headers: { cookie: sessionCookie },
  });
  await once(socket, 'open');
  const joinedPromise = waitForMessage(socket, 'joined');
  socket.send(JSON.stringify({ type: 'create', name: '伪造昵称', map: 'night', playerId: 'guest-player-id' }));
  const joined = await joinedPromise;
  assert.equal(joined.room.players[0].name, username);
  assert.equal(joined.room.players[0].registered, true);
  assert.equal(joined.room.players[0].hasRank, true);
  socket.close();

  const stored = await readFile(authFile, 'utf8');
  assert.equal(stored.includes(password), false, 'password plaintext must never reach disk');
  assert.equal(stored.includes(sessionCookie.split('=')[1]), false, 'raw session token must never reach disk');
  assert.match(stored, /"passwordHash":"[A-Za-z0-9+/=]+"/);

  server.kill('SIGTERM');
  await once(server, 'exit');
  const reopened = createAuthStore({ filePath: authFile });
  const persistedUser = await reopened.verify(username, password);
  assert.equal(persistedUser.username, username);
  reopened.close();

  console.log(JSON.stringify({
    registration: 'ok', login: 'ok', session: 'httpOnly-cookie', logout: 'ok',
    passwordStorage: 'scrypt', persistence: 'ok', rankedIdentity: 'account-bound',
  }));
} finally {
  if (server.exitCode === null) {
    server.kill('SIGTERM');
    await once(server, 'exit').catch(() => {});
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}
