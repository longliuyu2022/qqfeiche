import {
  createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual,
} from 'node:crypto';
import {
  chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const scrypt = promisify(scryptCallback);
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;
const SESSION_BYTES = 32;
const PASSWORD_KEY_BYTES = 64;
const DEFAULT_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_USERS = 100000;
const DEFAULT_MAX_SESSIONS_PER_USER = 5;
const DUMMY_SALT = Buffer.from('neon-apex-auth-dummy-salt').toString('base64');

export const AUTH_STORE_VERSION = 1;

export class AuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

export function usernameKey(value) {
  return normalizeUsername(value).toLocaleLowerCase('und');
}

export function validateUsername(value) {
  const username = normalizeUsername(value);
  const length = [...username].length;
  if (length < 2 || length > 20 || !USERNAME_PATTERN.test(username)) {
    throw new AuthError('INVALID_USERNAME', '用户名需为 2–20 位中文、字母、数字、下划线或短横线');
  }
  return username;
}

export function validatePassword(value) {
  if (typeof value !== 'string') throw new AuthError('INVALID_PASSWORD', '请输入密码');
  const length = [...value].length;
  if (length < 8 || length > 72 || Buffer.byteLength(value, 'utf8') > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AuthError('INVALID_PASSWORD', '密码需为 8–72 位且不能包含控制字符');
  }
  return value;
}

export function defaultAuthFilePath() {
  return process.env.NEON_APEX_AUTH_FILE
    || fileURLToPath(new URL('./data/accounts.json', import.meta.url));
}

function tokenDigest(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

async function passwordDigest(password, salt) {
  return scrypt(password, Buffer.from(salt, 'base64'), PASSWORD_KEY_BYTES, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 32 * 1024 * 1024,
  });
}

function publicUser(user) {
  return user ? { id: user.id, username: user.username, createdAt: user.createdAt } : null;
}

function loadSnapshot(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (parsed?.version !== AUTH_STORE_VERSION) return { users: new Map(), sessions: new Map() };
    const users = new Map();
    for (const [key, user] of Object.entries(parsed.users || {})) {
      if (!user?.id || !user?.username || !user?.passwordSalt || !user?.passwordHash) continue;
      users.set(key, {
        id: String(user.id),
        username: String(user.username),
        passwordSalt: String(user.passwordSalt),
        passwordHash: String(user.passwordHash),
        createdAt: Number(user.createdAt) || Date.now(),
      });
    }
    const sessions = new Map();
    for (const [digest, session] of Object.entries(parsed.sessions || {})) {
      if (!/^[a-f0-9]{64}$/.test(digest) || !session?.userId || !Number.isFinite(session?.expiresAt)) continue;
      sessions.set(digest, { userId: String(session.userId), expiresAt: Number(session.expiresAt) });
    }
    return { users, sessions };
  } catch {
    return { users: new Map(), sessions: new Map() };
  }
}

export function createAuthStore({
  filePath = defaultAuthFilePath(),
  sessionMs = DEFAULT_SESSION_MS,
  maxUsers = DEFAULT_MAX_USERS,
  maxSessionsPerUser = DEFAULT_MAX_SESSIONS_PER_USER,
  now = () => Date.now(),
} = {}) {
  const snapshot = loadSnapshot(filePath);
  const users = snapshot.users;
  const usersById = new Map([...users.values()].map((user) => [user.id, user]));
  const sessions = snapshot.sessions;
  let closed = false;

  function serialize() {
    const storedUsers = {};
    for (const [key, user] of users) storedUsers[key] = { ...user };
    const storedSessions = {};
    for (const [digest, session] of sessions) storedSessions[digest] = { ...session };
    return {
      version: AUTH_STORE_VERSION,
      updatedAt: now(),
      users: storedUsers,
      sessions: storedSessions,
    };
  }

  function flush() {
    if (closed) return false;
    const temporaryPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(temporaryPath, JSON.stringify(serialize()), { encoding: 'utf8', mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, filePath);
      return true;
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // The temporary file has already gone away.
      }
      console.error('[auth-store] flush failed', error?.message || error);
      return false;
    }
  }

  function cleanupSessions() {
    const timestamp = now();
    let changed = false;
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= timestamp || !usersById.has(session.userId)) {
        sessions.delete(digest);
        changed = true;
      }
    }
    return changed;
  }

  function findUserById(id) {
    return usersById.get(id) || null;
  }

  async function register(usernameValue, passwordValue) {
    if (closed) throw new AuthError('STORE_CLOSED', '账号服务暂不可用', 503);
    const username = validateUsername(usernameValue);
    const password = validatePassword(passwordValue);
    const key = usernameKey(username);
    if (users.has(key)) throw new AuthError('USERNAME_TAKEN', '该用户名已被注册', 409);
    if (users.size >= maxUsers) throw new AuthError('USER_LIMIT', '注册人数已达上限', 503);
    const passwordSalt = randomBytes(16).toString('base64');
    const passwordHash = (await passwordDigest(password, passwordSalt)).toString('base64');
    // A second request may have completed while scrypt was running.
    if (users.has(key)) throw new AuthError('USERNAME_TAKEN', '该用户名已被注册', 409);
    const user = { id: randomUUID(), username, passwordSalt, passwordHash, createdAt: now() };
    users.set(key, user);
    usersById.set(user.id, user);
    if (!flush()) {
      users.delete(key);
      usersById.delete(user.id);
      throw new AuthError('PERSIST_FAILED', '账号保存失败，请稍后重试', 503);
    }
    return publicUser(user);
  }

  async function verify(usernameValue, passwordValue) {
    const username = normalizeUsername(usernameValue);
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const user = users.get(usernameKey(username));
    const salt = user?.passwordSalt || DUMMY_SALT;
    const actual = await passwordDigest(password, salt);
    const expected = user
      ? Buffer.from(user.passwordHash, 'base64')
      : Buffer.alloc(PASSWORD_KEY_BYTES);
    const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!valid) throw new AuthError('INVALID_CREDENTIALS', '用户名或密码错误', 401);
    return publicUser(user);
  }

  function createSession(userId) {
    const user = findUserById(userId);
    if (!user) throw new AuthError('INVALID_USER', '账号不存在', 404);
    cleanupSessions();
    const userSessions = [...sessions.entries()]
      .filter(([, session]) => session.userId === user.id)
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    while (userSessions.length >= maxSessionsPerUser) {
      const [digest] = userSessions.shift();
      sessions.delete(digest);
    }
    const token = randomBytes(SESSION_BYTES).toString('base64url');
    const expiresAt = now() + sessionMs;
    sessions.set(tokenDigest(token), { userId: user.id, expiresAt });
    if (!flush()) {
      sessions.delete(tokenDigest(token));
      throw new AuthError('PERSIST_FAILED', '登录状态保存失败，请稍后重试', 503);
    }
    return { token, expiresAt, user: publicUser(user) };
  }

  function authenticate(token) {
    if (!token) return null;
    const digest = tokenDigest(token);
    const session = sessions.get(digest);
    if (!session) return null;
    if (session.expiresAt <= now()) {
      sessions.delete(digest);
      flush();
      return null;
    }
    return publicUser(findUserById(session.userId));
  }

  function revoke(token) {
    if (!token) return false;
    const removed = sessions.delete(tokenDigest(token));
    if (removed) flush();
    return removed;
  }

  function close() {
    if (closed) return;
    cleanupSessions();
    flush();
    closed = true;
  }

  return {
    filePath,
    register,
    verify,
    createSession,
    authenticate,
    revoke,
    flush,
    close,
    snapshot: serialize,
    get size() { return users.size; },
  };
}
