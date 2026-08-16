/**
 * 全局错误兜底。
 *
 * bootstrap.js 只在 `await import('./main.js')` 那一瞬间有 try/catch，模块加载成功
 * 之后再抛出的异步错误（渲染循环、贴图解码、WebGL 上下文丢失）此前没有任何接管，
 * 玩家只会看到一片空屏，也拿不到任何可以反馈的信息。
 *
 * 分两档处理，避免"一报错就糊全屏"比空屏还烦人：
 *   - 游戏尚未跑起来（__NEON_APEX_READY__ 不为 true）：空屏就是此刻发生的，
 *     弹全屏面板并给重新加载入口。
 *   - 已经在跑：只弹一条可关闭的角落横幅，绝不打断正在进行的比赛。
 */

const NOISE = [
  // 布局抖动的良性告警，Chrome 会照常渲染下一帧。
  'ResizeObserver loop',
  // 浏览器扩展注入的脚本，与游戏无关。
  'chrome-extension://',
  'moz-extension://',
];

const MAX_RECORDS = 12;

const state = {
  installed: false,
  records: [],
  fatalShown: false,
  bannerShown: false,
};

function isNoise(message) {
  return NOISE.some((pattern) => message.includes(pattern));
}

function describe(reason) {
  if (!reason) return 'Unknown error';
  if (typeof reason === 'string') return reason;
  const name = reason.name ? `${reason.name}: ` : '';
  return `${name}${reason.message || String(reason)}`;
}

function gameReady() {
  return window.__NEON_APEX_READY__ === true;
}

/** 采集一份可直接粘给开发者的现场信息，GPU 型号是排查渲染异常的关键。 */
export function collectDiagnostics() {
  const metrics = (() => {
    try {
      return window.__NEON_APEX_METRICS__ || null;
    } catch {
      return null;
    }
  })();
  let gpu = 'unavailable';
  try {
    const canvas = document.querySelector('#game');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'masked';
    }
  } catch {
    // 取不到显卡信息不影响其余字段。
  }
  return {
    at: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}@${window.devicePixelRatio || 1}`,
    gpu,
    ready: gameReady(),
    qualityTier: metrics?.qualityTier ?? null,
    fps: metrics?.fps ?? null,
    contextLosses: metrics?.contextLosses ?? null,
    assetFailures: metrics?.assetFailures?.slice(-4) ?? [],
    errors: state.records.slice(-6),
  };
}

function renderFatal(message) {
  const overlay = document.querySelector('#runtimeError');
  if (!overlay) return;
  const detail = overlay.querySelector('#runtimeErrorDetail');
  if (detail) detail.textContent = message;
  overlay.hidden = false;
  state.fatalShown = true;
}

function renderBanner(message) {
  const banner = document.querySelector('#runtimeBanner');
  if (!banner) return;
  const detail = banner.querySelector('#runtimeBannerDetail');
  if (detail) detail.textContent = message;
  banner.hidden = false;
  state.bannerShown = true;
}

function record(type, message) {
  state.records.push({ type, message: message.slice(0, 240), at: Math.round(performance.now()) });
  if (state.records.length > MAX_RECORDS) state.records.shift();
}

/** 供 bootstrap/main 主动上报已捕获但确实致命的错误。 */
export function reportFatal(reason, context = '') {
  const message = `${context ? `${context}: ` : ''}${describe(reason)}`;
  record('fatal', message);
  renderFatal(message);
}

/**
 * 记录一个已经有专门降级界面的错误。只进诊断信息，不抢占那套界面
 * —— 例如赛道加载失败会退回首页让玩家换画质重试，比全屏面板更有用。
 */
export function recordHandled(reason, context = '') {
  record('handled', `${context ? `${context}: ` : ''}${describe(reason)}`);
}

function handle(type, reason, target) {
  // 图片/音频等资源加载失败会以 error 事件冒泡到 window，但它们各自有降级路径，
  // 不该把整局比赛判死。只有真正的脚本异常才带 error/reason。
  if (target && target !== window && target.nodeType === 1) return;
  const message = describe(reason);
  if (isNoise(message)) return;
  record(type, message);
  if (!gameReady()) {
    if (!state.fatalShown) renderFatal(message);
    return;
  }
  if (!state.bannerShown) renderBanner(message);
}

export function installErrorOverlay() {
  if (state.installed) return;
  state.installed = true;

  window.addEventListener('error', (event) => {
    handle('error', event.error || event.message, event.target);
  });
  window.addEventListener('unhandledrejection', (event) => {
    handle('promise', event.reason, null);
  });

  document.querySelector('#runtimeErrorReload')?.addEventListener('click', () => location.reload());
  document.querySelector('#runtimeBannerClose')?.addEventListener('click', () => {
    const banner = document.querySelector('#runtimeBanner');
    if (banner) banner.hidden = true;
  });

  for (const id of ['#runtimeErrorCopy', '#runtimeBannerCopy']) {
    document.querySelector(id)?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const text = JSON.stringify(collectDiagnostics(), null, 2);
      const label = button.textContent;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '已复制';
      } catch {
        // 非安全上下文或用户拒绝授权时，退回到让玩家自己选中复制。
        const detail = document.querySelector('#runtimeErrorDetail');
        if (detail) detail.textContent = text;
        button.textContent = '请手动复制';
      }
      setTimeout(() => { button.textContent = label; }, 2400);
    });
  }

  Object.defineProperty(window, '__NEON_APEX_DIAGNOSTICS__', {
    configurable: true,
    get: () => collectDiagnostics(),
  });
}
