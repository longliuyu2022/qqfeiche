/**
 * 服务端源的解析。
 *
 * 网页版由自家服务器托管，同源即可。但 Android 版把 dist 打进 APK，用
 * WebViewAssetLoader 以 https://appassets.androidplatform.net 这个**虚拟域名**加载
 * （见 MainActivity.java）。该域名只在 WebView 内部有效，DNS 解析不到，也没有任何
 * 后端；WebSocket 更不走 shouldInterceptRequest 拦截。所以打包环境必须显式指向线上
 * 服务端，否则联机、账号和钱包同步全部连不上。
 *
 * 旧代码只判断了 location.protocol === 'file:'，那是更早的 WebView 加载方式，
 * 换成 WebViewAssetLoader 之后这个判断就再也不会命中了。
 */

export const REMOTE_ORIGIN = 'https://gaokao.aiimage.icu';

// AndroidX WebViewAssetLoader 的固定虚拟域名，不是我们自己的服务器。
export const ANDROID_ASSET_HOST = 'appassets.androidplatform.net';

/** 当前页面是否来自"自带资源但没有后端"的宿主。 */
export function isPackagedHost(loc = globalThis.location) {
  if (!loc) return false;
  if (!loc.host) return true;
  if (loc.protocol === 'file:') return true;
  return loc.host === ANDROID_ASSET_HOST;
}

/**
 * 请求要打到的源。同源时返回空串，调用方直接用相对路径，
 * 保持网页版与本地 dev 代理原有的行为不变。
 */
export function serverOrigin(loc = globalThis.location) {
  const override = globalThis.__NEON_APEX_SERVER__;
  if (typeof override === 'string' && override) return override.replace(/\/$/, '');
  return isPackagedHost(loc) ? REMOTE_ORIGIN : '';
}

/** 请求是否会跨源 —— 决定 fetch 要不要带 credentials: 'include'。 */
export function isCrossOrigin(loc = globalThis.location) {
  return serverOrigin(loc) !== '';
}

/** 联机 WebSocket 地址。 */
export function socketUrl(loc = globalThis.location) {
  const origin = serverOrigin(loc);
  if (origin) return `${origin.replace(/^http/, 'ws')}/multiplayer`;
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}/multiplayer`;
}

/** 账号 / 钱包接口的前缀。 */
export function apiRoot(loc = globalThis.location) {
  return `${serverOrigin(loc)}/multiplayer/auth`;
}
