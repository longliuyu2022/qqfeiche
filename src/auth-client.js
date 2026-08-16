const AUTH_ROOT = '/multiplayer/auth';

export class AuthClientError extends Error {
  constructor(message, code = 'AUTH_FAILED', status = 0) {
    super(message);
    this.name = 'AuthClientError';
    this.code = code;
    this.status = status;
  }
}

async function authRequest(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`${AUTH_ROOT}/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthClientError('无法连接账号服务，请稍后重试', 'NETWORK_ERROR');
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // A proxy error page is not useful to the account UI.
  }
  if (!response.ok) {
    throw new AuthClientError(
      payload?.message || '账号请求失败，请稍后重试',
      payload?.error || 'AUTH_FAILED',
      response.status,
    );
  }
  return payload || {};
}

export async function getAuthSession() {
  return authRequest('session');
}

export async function registerAccount({ username, password }) {
  return authRequest('register', { method: 'POST', body: { username, password } });
}

export async function loginAccount({ username, password }) {
  return authRequest('login', { method: 'POST', body: { username, password } });
}

export async function logoutAccount() {
  return authRequest('logout', { method: 'POST' });
}

export async function fetchAccountWallet() {
  return authRequest('wallet');
}

// 整份上传，服务端做字段校验后覆盖。
export async function pushAccountWallet(wallet) {
  return authRequest('wallet', { method: 'PUT', body: { wallet } });
}

// 本地游客钱包首次绑定账号时用：金币取大、道具取并集。
export async function mergeAccountWallet(wallet) {
  return authRequest('wallet/merge', { method: 'POST', body: { wallet } });
}
