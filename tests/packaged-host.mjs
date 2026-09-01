/**
 * 打包宿主（Android WebView）连线上服务端的链路。
 *
 * APK 用 WebViewAssetLoader 以 https://appassets.androidplatform.net 这个虚拟域名
 * 加载本地资源，它没有后端，所以联机与账号请求必须显式打到线上服务端，并且是跨源。
 * 这里同时守住两件事：该放行的放行，不该放行的一个都不能漏。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  ANDROID_ASSET_HOST, REMOTE_ORIGIN, apiRoot, isCrossOrigin, isPackagedHost, socketUrl,
} from '../src/server-origin.js';

// --- 客户端：地址解析 ---------------------------------------------------------
const web = { host: 'saiche.aiimage.icu', protocol: 'https:' };
const apk = { host: ANDROID_ASSET_HOST, protocol: 'https:' };
const dev = { host: 'localhost:5173', protocol: 'http:' };
const legacy = { host: '', protocol: 'file:' };

assert.equal(isPackagedHost(web), false);
assert.equal(isPackagedHost(apk), true, 'Android 资源宿主必须被识别为打包环境');
assert.equal(isPackagedHost(dev), false);
assert.equal(isPackagedHost(legacy), true, 'file: 宿主仍要走绝对地址');

assert.equal(socketUrl(web), 'wss://saiche.aiimage.icu/multiplayer', '网页版保持同源');
assert.equal(socketUrl(dev), 'ws://localhost:5173/multiplayer', 'dev 走 vite 代理，不能改成线上');
assert.equal(
  socketUrl(apk),
  'wss://saiche.aiimage.icu/multiplayer',
  'APK 必须连线上服务端，连虚拟域名会直接 DNS 失败',
);
assert.equal(socketUrl(legacy), 'wss://saiche.aiimage.icu/multiplayer');

assert.equal(apiRoot(web), '/multiplayer/auth', '网页版用相对路径');
assert.equal(apiRoot(apk), `${REMOTE_ORIGIN}/multiplayer/auth`);
assert.equal(isCrossOrigin(web), false);
assert.equal(isCrossOrigin(apk), true, 'APK 的账号请求跨源，fetch 必须带 credentials:include');

// --- 服务端：跨源放行边界 -----------------------------------------------------
const port = 14600 + Math.floor(Math.random() * 300);
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NEON_APEX_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('服务端启动超时')), 15000);
  server.stdout.on('data', (c) => { if (c.toString().includes('listening')) { clearTimeout(timer); resolve(); } });
});

const base = `http://127.0.0.1:${port}`;
const ANDROID_ORIGIN = `https://${ANDROID_ASSET_HOST}`;
const call = (path, { method = 'GET', origin, body } = {}) => fetch(`${base}${path}`, {
  method,
  headers: {
    ...(origin ? { origin } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}),
  },
  body: body ? JSON.stringify(body) : undefined,
  redirect: 'manual',
});

// 预检必须放行，否则带 credentials 的跨源请求根本发不出去。
const preflight = await call('/multiplayer/auth/session', { method: 'OPTIONS', origin: ANDROID_ORIGIN });
assert.equal(preflight.status, 204, 'Android 源的预检应放行');
assert.equal(preflight.headers.get('access-control-allow-origin'), ANDROID_ORIGIN);
assert.equal(preflight.headers.get('access-control-allow-credentials'), 'true');

// 陌生源的预检不能放行。
const hostilePreflight = await call('/multiplayer/auth/session', { method: 'OPTIONS', origin: 'https://evil.example' });
assert.equal(hostilePreflight.status, 403, '未知源的预检必须拒绝');
assert.equal(hostilePreflight.headers.get('access-control-allow-origin'), null);

// 陌生源的实际请求仍按 CSRF 拒绝 —— 放开 Android 不等于放开所有人。
const hostile = await call('/multiplayer/auth/session', { origin: 'https://evil.example' });
assert.equal(hostile.status, 403);
assert.equal((await hostile.json()).error, 'CROSS_ORIGIN');

// Android 源可以正常走账号流程，且响应带 CORS 头。
const session = await call('/multiplayer/auth/session', { origin: ANDROID_ORIGIN });
assert.equal(session.status, 200);
assert.equal(session.headers.get('access-control-allow-origin'), ANDROID_ORIGIN);

const username = `apk_${Date.now().toString().slice(-8)}`;
const registered = await call('/multiplayer/auth/register', {
  method: 'POST', origin: ANDROID_ORIGIN, body: { username, password: 'apk-check-9527' },
});
assert.equal(registered.status, 201, '打包宿主应能注册账号');
assert.equal(registered.headers.get('access-control-allow-origin'), ANDROID_ORIGIN);

// 跨源宿主拿到的会话 Cookie 必须是 SameSite=None，否则 WebView 不会回传。
// 明文 http 下浏览器会丢弃 None，所以此处仍应回退到 Strict —— 线上是 https，取 None。
const cookie = registered.headers.get('set-cookie') || '';
assert.match(cookie, /neon_apex_session=/);
assert.match(cookie, /HttpOnly/);
assert.match(cookie, /SameSite=Strict/, '明文请求下不能发出 SameSite=None（浏览器会丢弃）');

// 线上是 Caddy 终止 TLS 再转发，x-forwarded-proto=https 才是 APK 的真实条件：
// 此时必须发出 SameSite=None; Secure，否则 WebView 不会回传会话 Cookie，登录态建立不起来。
const forwarded = await fetch(`${base}/multiplayer/auth/register`, {
  method: 'POST',
  headers: { origin: ANDROID_ORIGIN, 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
  body: JSON.stringify({ username: `tls_${Date.now().toString().slice(-8)}`, password: 'apk-tls-9527' }),
});
assert.equal(forwarded.status, 201);
const tlsCookie = forwarded.headers.get('set-cookie') || '';
assert.match(tlsCookie, /SameSite=None/, 'https 下跨源宿主必须拿到 SameSite=None');
assert.match(tlsCookie, /Secure/, 'SameSite=None 必须同时带 Secure，否则浏览器丢弃');

// 同样是 https，但同源网页版仍必须是 Strict。
const webTls = await fetch(`${base}/multiplayer/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
  body: JSON.stringify({ username: `wtls_${Date.now().toString().slice(-8)}`, password: 'web-tls-9527' }),
});
assert.match(webTls.headers.get('set-cookie') || '', /SameSite=Strict/, 'https 下网页版仍须 Strict');

// 网页版（同源，无 Origin 或同 host）绝不能被改成 SameSite=None。
const webRegistered = await call('/multiplayer/auth/register', {
  method: 'POST', body: { username: `web_${Date.now().toString().slice(-8)}`, password: 'web-check-9527' },
});
assert.equal(webRegistered.status, 201);
assert.match(
  webRegistered.headers.get('set-cookie') || '',
  /SameSite=Strict/,
  '网页版必须保持 SameSite=Strict，不能为 APK 削弱 CSRF 防护',
);
assert.equal(webRegistered.headers.get('access-control-allow-origin'), null, '同源响应不该带 CORS 头');

// --- WebSocket：升级握手不校验 Origin，APK 才连得上 ---------------------------
const opened = await new Promise((resolve) => {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`, { headers: { Origin: ANDROID_ORIGIN } });
  socket.on('open', () => { socket.close(); resolve(true); });
  socket.on('error', () => resolve(false));
  setTimeout(() => resolve(false), 5000);
});
assert.equal(opened, true, 'Android 源应能建立联机 WebSocket');

server.kill('SIGTERM');
console.log(JSON.stringify({
  socketUrl: 'ok', apiRoot: 'ok', preflight: 'ok',
  hostileOriginRejected: 'ok', androidAllowed: 'ok',
  webCookieUnchanged: 'ok', websocket: 'ok',
}));
