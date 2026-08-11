/**
 * Mobile frame-time and render-budget regression test.
 *
 * The v1.5.0 particle systems (skid marks / smoke / sparks), the track feature meshes and
 * the BGM synth are easy to add and hard to notice: they only surface as draw calls,
 * triangles and long frames. This test pins those numbers down.
 *
 * How to run (the test does NOT start a server, same convention as tests/visual.mjs):
 *
 *   npm run build                                        # dist/ must exist
 *   npx vite preview --port 4176 --host 127.0.0.1 &      # 4176 keeps it off the 4173 tests
 *   BASE_URL=http://127.0.0.1:4176 node tests/performance.mjs
 *   kill %1                                              # stop the preview server
 *
 * Environment:
 *   BASE_URL        preview origin, default http://127.0.0.1:4176
 *   CHROMIUM_PATH   chromium binary, default /usr/local/bin/chromium-browser
 *   CASE            run one viewport only (mobile-portrait | mobile-landscape | desktop)
 *   QUALITY         run one quality tier only (balanced | high)
 *   FRAME_SAMPLES   frames per state, default 120, split across three interleaved blocks.
 *                   Lower it only for a smoke run: 120 is the number this test is meant
 *                   to report on, and SwiftShader needs seconds per frame on a busy host.
 *
 * What it checks, per viewport (390x844, 844x390, 1280x720) and per quality tier:
 *   1. renderer.info budget: draw calls, triangles, resident geometries and textures.
 *   2. Frame time distribution, standing start versus flat out with drift and nitro.
 *   3. balanced really is cheaper than high, not just lower resolution.
 *   4. Five race restarts do not grow the resident geometry or texture count.
 *   5. No pageerror and no console.error anywhere in the run.
 *
 * Two things shape every assertion below:
 *
 * 1. Rendering is SwiftShader, so absolute FPS is meaningless. Nothing here asserts a
 *    frame budget in milliseconds. The frame-time check is a ratio between two states
 *    measured in the same run on the same machine; the hard numbers are resource counts.
 * 2. Headless SwiftShader barely schedules requestAnimationFrame (measured: 9 callbacks in
 *    40 seconds on a page that renders fine), so sampling the live loop yields noise.
 *    Instead every sample steps the game loop itself through qaAdvance(1/60), which runs
 *    exactly one simulation step plus one composer.render(), and fences each frame with a
 *    readPixels so the software rasteriser is drained before the clock is read. Idle and hot
 *    samples are interleaved in three blocks so a CPU spike from a neighbour process lands
 *    on both states instead of skewing the ratio.
 *
 * Budget on a software rasteriser: one sampled frame costs seconds, so the default 120
 * frames per state runs about 20 minutes per viewport/quality pair on a loaded 2 core host.
 */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY } from '../src/preferences.js';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4176';
const frameSamples = Number(process.env.FRAME_SAMPLES) || 120;
const BLOCKS = 3;
const BLOCK_FRAMES = Math.ceil(frameSamples / BLOCKS);
// Simulated seconds of flat-out driving before each hot block. The three values put the
// three blocks on three different stretches of the track, so the render budget is not
// measured at a single lucky spot. Simulation inside qaAdvance does not render, so this
// costs almost nothing.
const WARMUP_SECONDS = [4, 8, 12];
const LOAD_TIMEOUT = 480000;
const RESET_CYCLES = 5;
const HOT_CONTROLS = { throttle: 1, nitro: 1, drift: 1, autopilot: true };
const IDLE_CONTROLS = { throttle: 0, brake: 0, steer: 0, drift: 0, nitro: 0 };

// Hot/idle frame-time ratio. A particle system that scales badly shows up here long before
// it shows up in a resource count, and the ratio is immune to the absolute software speed.
// Measured on this build: 0.38 to 0.64, i.e. flat out is currently *cheaper* than the
// standing grid, where six rival cars sit right in front of the camera. The limit stays
// loose because the balance flips on a real GPU, where fill cost stops dominating.
const MAX_FRAME_RATIO_P50 = 3;
const MAX_FRAME_RATIO_P95 = 3.5;
// balanced has to cut real geometry work, not just resolution. Measured: 0.49 of the draw
// calls and 0.55 of the triangles of the high tier.
const QUALITY_SAVING = 0.9;
// Restart tolerance. Measured: every configuration holds its geometry and texture count
// exactly flat across five restarts, so this only absorbs a stray pooled buffer.
const LEAK_TOLERANCE = 2;

// Budgets are the peak measured on 2026-08-12 against the night track in race mode, rounded
// up by about 25%. Draw calls and triangles are viewport independent (they follow the scene,
// not the pixels); the high tier costs twice as much because the shadow pass redraws the
// scene. Measured peaks, for reference when these need re-fitting:
//   mobile-portrait  balanced 241 calls / 337722 tris / 245 geo / 54 tex
//   mobile-portrait  high     490 calls / 610848 tris / 301 geo / 55 tex
//   mobile-landscape balanced 251 calls / 352810 tris / 267 geo / 57 tex
//   mobile-landscape high     504 calls / 624036 tris / 317 geo / 58 tex
//   desktop          balanced 248 calls / 352770 tris / 265 geo / 56 tex
//   desktop          high     498 calls / 619056 tris / 315 geo / 57 tex
const cases = [
  {
    name: 'mobile-portrait',
    viewport: { width: 390, height: 844 },
    mobile: true,
    budgets: {
      balanced: { calls: 300, triangles: 425000, geometries: 310, textures: 70 },
      high: { calls: 615, triangles: 765000, geometries: 380, textures: 70 },
    },
  },
  {
    name: 'mobile-landscape',
    viewport: { width: 844, height: 390 },
    mobile: true,
    budgets: {
      balanced: { calls: 315, triangles: 445000, geometries: 335, textures: 75 },
      high: { calls: 630, triangles: 780000, geometries: 400, textures: 75 },
    },
  },
  {
    name: 'desktop',
    viewport: { width: 1280, height: 720 },
    mobile: false,
    budgets: {
      balanced: { calls: 310, triangles: 445000, geometries: 335, textures: 70 },
      high: { calls: 625, triangles: 775000, geometries: 395, textures: 75 },
    },
  },
].filter((testCase) => !process.env.CASE || process.env.CASE === testCase.name);
const qualities = ['balanced', 'high'].filter((quality) => !process.env.QUALITY || process.env.QUALITY === quality);

// Progress goes to stderr so stdout stays a single parseable JSON summary.
const startupAt = Date.now();
function log(message) {
  console.error(`[performance ${String(Math.round((Date.now() - startupAt) / 1000)).padStart(4)}s] ${message}`);
}

function statistics(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
  const round = (value) => Number(value.toFixed(2));
  return {
    frames: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((total, value) => total + value, 0) / sorted.length),
  };
}

/**
 * Steps the game loop `frames` times with a fixed 1/60 step and times each step.
 * qaAdvance() ends in a single composer.render(), so one call is one displayed frame.
 *
 * The one pixel readback is the clock's fence. Chrome pushes WebGL work to the GPU process
 * over a command buffer and gl.finish() returns long before SwiftShader has drained it
 * (measured: 30ms per "finished" frame against 7 seconds of wall clock), so without a
 * readback the samples only cover command submission. readPixels blocks until the frame is
 * actually rasterised.
 */
function stepFrames([frames, controls]) {
  const { qaAdvance, renderer, vehicle } = window.__NEON_APEX__;
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  const times = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const startedAt = performance.now();
    qaAdvance(1 / 60, controls);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    times.push(performance.now() - startedAt);
  }
  return {
    times,
    speedKph: Math.round(vehicle.speedKph),
    drifting: vehicle.drifting,
    boosting: vehicle.boosting,
    nitro: Math.round(vehicle.state.nitro),
  };
}

/**
 * One displayed frame worth of renderer.info. EffectComposer runs four passes and every
 * pass resets renderer.info, so the default autoReset only ever reports the last full
 * screen quad. Disabling autoReset around a single qaAdvance() makes the counters cover
 * the whole frame: shadow pass, scene pass, bloom chain and output pass.
 */
function captureRenderInfo(controls) {
  const { renderer, qaAdvance, scene } = window.__NEON_APEX__;
  renderer.info.autoReset = false;
  renderer.info.reset();
  qaAdvance(1 / 60, controls);
  const { render, memory, programs } = renderer.info;
  const sample = {
    calls: render.calls,
    triangles: render.triangles,
    points: render.points,
    lines: render.lines,
    geometries: memory.geometries,
    textures: memory.textures,
    programs: programs?.length ?? 0,
    sceneObjects: scene.children.length,
  };
  renderer.info.autoReset = true;
  return sample;
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: [
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
  ],
});

const results = [];

for (const testCase of cases) {
  for (const quality of qualities) {
    const label = `${testCase.name}/${quality}`;
    const startedAt = Date.now();
    const context = await browser.newContext({
      viewport: testCase.viewport,
      deviceScaleFactor: 1,
      isMobile: testCase.mobile,
      hasTouch: testCase.mobile,
    });
    await context.addInitScript(
      ([key, preferences]) => {
        try {
          window.localStorage.setItem(key, JSON.stringify(preferences));
        } catch {
          // about:blank has no accessible storage; the real document sets it on navigation.
        }
      },
      [PREFERENCES_KEY, { ...DEFAULT_PREFERENCES, quality, lastMode: 'race', lastTrack: 'night' }],
    );
    const page = await context.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    // Headless SwiftShader schedules requestAnimationFrame erratically, and that is what
    // waitForFunction polls on by default. Poll on a timer instead so the waits track the
    // game state rather than the compositor.
    await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true, null, { polling: 250, timeout: 60000 });
    await page.evaluate(() => document.querySelector('#startRace').click());
    await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { polling: 250, timeout: LOAD_TIMEOUT });
    const loadMs = Date.now() - startedAt;
    log(`${label}: race ready in ${Math.round(loadMs / 1000)}s`);
    const runtime = await page.evaluate(() => ({
      quality: window.__NEON_APEX__.preferences.quality,
      detectedTier: window.__NEON_APEX_METRICS__.qualityTier,
      mode: window.__NEON_APEX__.activeMode,
      track: window.__NEON_APEX__.activeTrack,
      entrants: window.__NEON_APEX__.raceSystem.state.entrantCount,
      shadowMap: window.__NEON_APEX__.renderer.shadowMap.enabled,
      pixelRatio: Number(window.__NEON_APEX__.renderer.getPixelRatio().toFixed(3)),
      drawingBuffer: [window.__NEON_APEX__.renderer.domElement.width, window.__NEON_APEX__.renderer.domElement.height],
    }));

    // Interleaved idle / hot blocks. Every block starts from a restart so the idle sample is
    // a genuine standstill (empty particle pools) and the hot sample always spins up the same way.
    const idleTimes = [];
    const hotTimes = [];
    const idleRenders = [];
    const hotRenders = [];
    let idleState = null;
    let hotState = null;
    for (let block = 0; block < BLOCKS; block += 1) {
      await page.evaluate(() => document.querySelector('#restart').click());
      const idle = await page.evaluate(stepFrames, [BLOCK_FRAMES, IDLE_CONTROLS]);
      idleTimes.push(...idle.times);
      idleState = idle;
      idleRenders.push(await page.evaluate(captureRenderInfo, IDLE_CONTROLS));
      // Spin up: simulated seconds of nitro + drift fill every particle pool and carry the
      // car to a different stretch of track for every block.
      await page.evaluate(
        ([seconds, controls]) => window.__NEON_APEX__.qaAdvance(seconds, controls),
        [WARMUP_SECONDS[block % WARMUP_SECONDS.length], HOT_CONTROLS],
      );
      const hot = await page.evaluate(stepFrames, [BLOCK_FRAMES, HOT_CONTROLS]);
      hotTimes.push(...hot.times);
      hotState = hot;
      hotRenders.push(await page.evaluate(captureRenderInfo, HOT_CONTROLS));
      log(`${label}: block ${block + 1}/${BLOCKS} sampled ${BLOCK_FRAMES} idle + ${BLOCK_FRAMES} hot frames`);
    }
    const idle = statistics(idleTimes);
    const hot = statistics(hotTimes);
    const worst = (samples, key) => samples.reduce((peak, sample) => Math.max(peak, sample[key]), 0);
    const render = {
      hot: {
        calls: worst(hotRenders, 'calls'),
        triangles: worst(hotRenders, 'triangles'),
        points: worst(hotRenders, 'points'),
        geometries: worst(hotRenders, 'geometries'),
        textures: worst(hotRenders, 'textures'),
        programs: worst(hotRenders, 'programs'),
        sceneObjects: worst(hotRenders, 'sceneObjects'),
        samples: hotRenders,
      },
      idle: {
        calls: worst(idleRenders, 'calls'),
        triangles: worst(idleRenders, 'triangles'),
        points: worst(idleRenders, 'points'),
        geometries: worst(idleRenders, 'geometries'),
        textures: worst(idleRenders, 'textures'),
        samples: idleRenders,
      },
    };
    // What the particle systems and the racing scenery add on top of the standing start.
    render.delta = {
      calls: render.hot.calls - render.idle.calls,
      triangles: render.hot.triangles - render.idle.triangles,
      points: render.hot.points - render.idle.points,
    };

    // Leak sentinel: restart the race five times and watch the resident GPU resources.
    const resetCycles = [];
    for (let cycle = 0; cycle < RESET_CYCLES; cycle += 1) {
      await page.evaluate(() => document.querySelector('#restart').click());
      resetCycles.push(await page.evaluate((controls) => {
        window.__NEON_APEX__.qaAdvance(2, controls);
        const { memory, programs } = window.__NEON_APEX__.renderer.info;
        return {
          geometries: memory.geometries,
          textures: memory.textures,
          programs: programs?.length ?? 0,
          sceneObjects: window.__NEON_APEX__.scene.children.length,
        };
      }, HOT_CONTROLS));
    }
    log(`${label}: ${RESET_CYCLES} restart cycles done`);

    // The budget tracks the worst frame of either state, plus the resident counts left
    // behind by the restart cycles. On the high tier the standing start is the expensive
    // frame: the shadow pass redraws the whole starting grid.
    render.peak = {
      calls: Math.max(render.hot.calls, render.idle.calls),
      triangles: Math.max(render.hot.triangles, render.idle.triangles),
      geometries: Math.max(render.hot.geometries, render.idle.geometries, ...resetCycles.map((cycle) => cycle.geometries)),
      textures: Math.max(render.hot.textures, render.idle.textures, ...resetCycles.map((cycle) => cycle.textures)),
    };

    const monitor = await page.evaluate(() => {
      const snapshot = window.__NEON_APEX_METRICS__;
      return {
        contextLosses: snapshot.contextLosses,
        assetFailures: snapshot.assetFailures.map((failure) => failure.asset),
        runtimeErrors: snapshot.runtimeErrors.map((failure) => failure.message),
      };
    });

    const result = {
      case: testCase.name,
      quality,
      viewport: testCase.viewport,
      budgets: testCase.budgets[quality],
      loadMs,
      runtime,
      render,
      frameTimeMs: {
        idle,
        hot,
        ratioP50: Number((hot.p50 / idle.p50).toFixed(2)),
        ratioP95: Number((hot.p95 / idle.p95).toFixed(2)),
      },
      idleState: { speedKph: idleState.speedKph, drifting: idleState.drifting },
      hotState: { speedKph: hotState.speedKph, drifting: hotState.drifting, boosting: hotState.boosting, nitro: hotState.nitro },
      resetCycles,
      monitor,
      errors,
      elapsedMs: Date.now() - startedAt,
    };
    results.push(result);
    log(
      `${label}: peak calls=${render.peak.calls} (hot ${render.hot.calls}, idle ${render.idle.calls})`
      + ` tris=${render.peak.triangles} points=${render.hot.points} geo=${render.peak.geometries}`
      + ` tex=${render.peak.textures} idleP50=${idle.p50}ms hotP50=${hot.p50}ms`
      + ` ratio=${result.frameTimeMs.ratioP50} in ${Math.round(result.elapsedMs / 1000)}s`,
    );
    await context.close();
  }
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

for (const result of results) {
  const label = `${result.case}/${result.quality}`;
  assert.deepEqual(result.errors, [], `${label}: browser errors: ${result.errors.join('; ')}`);
  assert.equal(result.monitor.contextLosses, 0, `${label}: WebGL context was lost`);
  assert.deepEqual(result.monitor.runtimeErrors, [], `${label}: telemetry recorded runtime errors`);
  assert.deepEqual(result.monitor.assetFailures, [], `${label}: telemetry recorded asset failures`);
  assert.equal(result.runtime.quality, result.quality, `${label}: quality preference was not applied`);
  assert.equal(result.runtime.mode, 'race', `${label}: expected the six car race mode`);
  assert.equal(
    result.runtime.shadowMap,
    result.quality !== 'balanced',
    `${label}: shadow map does not follow the quality tier`,
  );

  // 1. Render resource budget, taken from the worst sampled frame of either state.
  const budget = result.budgets;
  const peak = result.render.peak;
  assert.ok(peak.calls <= budget.calls, `${label}: ${peak.calls} draw calls exceed the ${budget.calls} budget`);
  assert.ok(peak.triangles <= budget.triangles, `${label}: ${peak.triangles} triangles exceed the ${budget.triangles} budget`);
  assert.ok(peak.geometries <= budget.geometries, `${label}: ${peak.geometries} geometries exceed the ${budget.geometries} budget`);
  assert.ok(peak.textures <= budget.textures, `${label}: ${peak.textures} textures exceed the ${budget.textures} budget`);
  // The night city draws ~5800 static point sprites on its own, so the raw points counter
  // says nothing. The hot minus idle difference is the drift smoke and sparks.
  assert.ok(
    result.render.delta.points > 0,
    `${label}: the hot sample drew no more points than the standing start (${result.render.hot.points} vs ${result.render.idle.points}),`
    + ' so the particle systems are not being measured',
  );

  // 2. Frame time distribution, idle versus flat out.
  assert.ok(result.idleState.speedKph <= 1, `${label}: the idle baseline was moving at ${result.idleState.speedKph} kph`);
  assert.ok(result.hotState.speedKph >= 80, `${label}: the hot sample never got up to speed (${result.hotState.speedKph} kph)`);
  assert.ok(result.hotState.drifting, `${label}: the hot sample was not drifting, the skid and smoke pools stayed empty`);
  const requestedFrames = BLOCK_FRAMES * BLOCKS;
  assert.ok(result.frameTimeMs.idle.frames >= requestedFrames, `${label}: only ${result.frameTimeMs.idle.frames} idle frames sampled`);
  assert.ok(result.frameTimeMs.hot.frames >= requestedFrames, `${label}: only ${result.frameTimeMs.hot.frames} hot frames sampled`);
  assert.ok(result.frameTimeMs.idle.p50 > 0, `${label}: idle frame time sampling failed`);
  assert.ok(
    result.frameTimeMs.ratioP50 <= MAX_FRAME_RATIO_P50,
    `${label}: hot/idle p50 frame time ratio ${result.frameTimeMs.ratioP50} exceeds ${MAX_FRAME_RATIO_P50}`
    + ` (idle ${result.frameTimeMs.idle.p50}ms, hot ${result.frameTimeMs.hot.p50}ms)`,
  );
  assert.ok(
    result.frameTimeMs.ratioP95 <= MAX_FRAME_RATIO_P95,
    `${label}: hot/idle p95 frame time ratio ${result.frameTimeMs.ratioP95} exceeds ${MAX_FRAME_RATIO_P95}`
    + ` (idle ${result.frameTimeMs.idle.p95}ms, hot ${result.frameTimeMs.hot.p95}ms)`,
  );

  // 4. Leak sentinel across five restarts.
  const cycles = result.resetCycles;
  const first = cycles[0];
  const last = cycles[cycles.length - 1];
  const climbing = (key) => cycles.every((cycle, index) => index === 0 || cycle[key] > cycles[index - 1][key]);
  assert.equal(climbing('geometries'), false, `${label}: geometries grow on every restart: ${JSON.stringify(cycles)}`);
  assert.equal(climbing('textures'), false, `${label}: textures grow on every restart: ${JSON.stringify(cycles)}`);
  assert.ok(
    last.geometries - first.geometries <= LEAK_TOLERANCE,
    `${label}: geometries leak across restarts: ${JSON.stringify(cycles)}`,
  );
  assert.ok(
    last.textures - first.textures <= LEAK_TOLERANCE,
    `${label}: textures leak across restarts: ${JSON.stringify(cycles)}`,
  );
}

// 3. The balanced tier has to buy something measurable over high.
for (const testCase of cases) {
  const balanced = results.find((result) => result.case === testCase.name && result.quality === 'balanced');
  const high = results.find((result) => result.case === testCase.name && result.quality === 'high');
  if (!balanced || !high) continue;
  assert.ok(
    balanced.render.peak.calls <= high.render.peak.calls * QUALITY_SAVING,
    `${testCase.name}: balanced draw calls (${balanced.render.peak.calls}) are not meaningfully below high (${high.render.peak.calls})`,
  );
  assert.ok(
    balanced.render.peak.triangles <= high.render.peak.triangles * QUALITY_SAVING,
    `${testCase.name}: balanced triangles (${balanced.render.peak.triangles}) are not meaningfully below high (${high.render.peak.triangles})`,
  );
}
