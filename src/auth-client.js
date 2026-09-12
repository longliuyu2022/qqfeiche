import { apiRoot, isCrossOrigin } from './server-origin.js';

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(`${apiRoot()}/${path}`, {
      method,
      signal: controller.signal,
      // Android 版从 appassets.androidplatform.net 打到线上服务端属于跨源，
      // 'same-origin' 会让会话 Cookie 不被携带，登录态永远建立不起来。
      credentials: isCrossOrigin() ? 'include' : 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthClientError('无法连接账号服务，请稍后重试', 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeout);
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
export async function mergeAccountWallet(wallet, accountId) {
  return authRequest('wallet/merge', { method: 'POST', body: { wallet, accountId } });
}

export async function syncAccountWallet(batch) {
  return authRequest('wallet/sync', { method: 'POST', body: batch });
}
