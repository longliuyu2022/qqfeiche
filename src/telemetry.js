const FRAME_WINDOW = 240;
const LONG_FRAME_MS = 33.4;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

function classifyDevice(renderer) {
  const gl = renderer.getContext();
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = debugInfo
    ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '')
    : '';
  const softwareRenderer = /swiftshader|llvmpipe|software/i.test(rendererName);
  const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 720;

  if (navigator.webdriver || softwareRenderer || mobile || cores <= 4 || memory <= 4 || maxTextureSize < 8192) return 'balanced';
  if (cores >= 8 && memory >= 8 && maxTextureSize >= 16384) return 'ultra';
  return 'high';
}

export function createRuntimeMonitor({ renderer, canvas = renderer.domElement } = {}) {
  if (!renderer || !canvas) throw new Error('Runtime monitor requires a Three.js renderer.');

  const state = {
    startedAt: performance.now(),
    qualityTier: classifyDevice(renderer),
    frames: [],
    frameCount: 0,
    longFrames: 0,
    contextLosses: 0,
    assetFailures: [],
    runtimeErrors: [],
  };

  const recordError = (type, message) => {
    state.runtimeErrors.push({ type, message: String(message).slice(0, 240), at: performance.now() });
    if (state.runtimeErrors.length > 12) state.runtimeErrors.shift();
  };

  const onError = (event) => recordError('error', event.message || event.error || 'Unknown runtime error');
  const onUnhandledRejection = (event) => recordError('promise', event.reason?.message || event.reason || 'Unhandled rejection');
  const onContextLost = (event) => {
    event.preventDefault();
    state.contextLosses += 1;
    recordError('webgl', 'WebGL context lost');
  };
  const onContextRestored = () => recordError('webgl', 'WebGL context restored');

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  const monitor = {
    frame(deltaSeconds) {
      const milliseconds = Math.min(1000, Math.max(0, deltaSeconds * 1000));
      state.frames.push(milliseconds);
      if (state.frames.length > FRAME_WINDOW) state.frames.shift();
      state.frameCount += 1;
      if (milliseconds > LONG_FRAME_MS) state.longFrames += 1;
    },

    assetFailure(url, error) {
      state.assetFailures.push({
        asset: String(url).split('?')[0].slice(-160),
        message: String(error?.message || error || 'Asset load failed').slice(0, 200),
        at: performance.now(),
      });
      if (state.assetFailures.length > 12) state.assetFailures.shift();
    },

    snapshot() {
      const frameTimes = state.frames;
      const averageMs = frameTimes.length
        ? frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length
        : 0;
      const recentLongFrames = frameTimes.filter((value) => value > LONG_FRAME_MS).length;
      return {
        qualityTier: state.qualityTier,
        fps: averageMs ? Math.round(1000 / averageMs) : 0,
        averageFrameMs: Number(averageMs.toFixed(2)),
        p95FrameMs: Number(percentile(frameTimes, 0.95).toFixed(2)),
        recentLongFrameRatio: Number((recentLongFrames / Math.max(1, frameTimes.length)).toFixed(3)),
        frameCount: state.frameCount,
        longFrames: state.longFrames,
        contextLosses: state.contextLosses,
        assetFailures: [...state.assetFailures],
        runtimeErrors: [...state.runtimeErrors],
        uptimeSeconds: Number(((performance.now() - state.startedAt) / 1000).toFixed(1)),
      };
    },

    destroy() {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    },
  };

  // Read-only local diagnostics for automated QA. No device identifiers or network requests.
  Object.defineProperty(window, '__NEON_APEX_METRICS__', {
    configurable: true,
    get: () => monitor.snapshot(),
  });

  return monitor;
}
