import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import { PNG } from 'pngjs';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

await fs.mkdir('artifacts', { recursive: true });
const cases = [
  {
    name: 'desktop',
    viewport: {
      width: Number(process.env.VIEWPORT_WIDTH) || 1280,
      height: Number(process.env.VIEWPORT_HEIGHT) || 720,
    },
    mobile: false,
  },
  { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true },
  { name: 'landscape', viewport: { width: 640, height: 360 }, mobile: true },
].filter((testCase) => !process.env.CASE || process.env.CASE === testCase.name);
const results = [];
const modeByCase = { desktop: 'race', mobile: 'timeTrial', landscape: 'drift' };
const expectedMode = {
  race: { laps: 3, entrants: 6, title: '完美冲线', status: 'NEW PERSONAL BEST', recordKey: 'bestTime', recordValue: 63.25, display: '01:03.250' },
  timeTrial: { laps: 1, entrants: 1, title: '计时完成', status: 'NEW PERSONAL BEST', recordKey: 'timeTrialBest', recordValue: 63.25, display: '01:03.250' },
  drift: { laps: 1, entrants: 1, title: '漂移完成', status: 'NEW HIGH SCORE', recordKey: 'driftBest', recordValue: 1280, display: '001280' },
};

for (const testCase of cases) {
  const caseStartedAt = performance.now();
  const context = await browser.newContext({
    viewport: testCase.viewport,
    deviceScaleFactor: 1,
    isMobile: testCase.mobile,
    hasTouch: testCase.mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true, null, { timeout: 10000 });
  const homeReadyMs = Math.round(performance.now() - caseStartedAt);
  const selectedMode = modeByCase[testCase.name];
  await page.evaluate((mode) => document.querySelector(`[data-race-mode="${mode}"]`).click(), selectedMode);
  if (testCase.name === 'mobile') {
    await page.locator('[data-track="day"]').click();
  }

  let settingsState = null;
  if (testCase.name === 'desktop') {
    await page.evaluate(() => {
      document.querySelector('#openSettings').click();
      const update = (selector, property, value, eventName) => {
        const element = document.querySelector(selector);
        element[property] = value;
        element.dispatchEvent(new Event(eventName, { bubbles: true }));
      };
      update('#masterVolume', 'value', '0.4', 'input');
      update('#soundEnabled', 'checked', false, 'change');
      update('#difficultySetting', 'value', 'hard', 'change');
      update('#qualitySetting', 'value', 'balanced', 'change');
      update('#vibrationEnabled', 'checked', false, 'change');
      update('#cameraShakeEnabled', 'checked', false, 'change');
    });
    await page.waitForFunction(() => document.querySelector('#settingsMenu').hidden === false);
    settingsState = await page.evaluate(() => {
      const content = document.querySelector('#settingsMenu .modal-content').getBoundingClientRect();
      return {
        stored: JSON.parse(localStorage.getItem('neon-apex:preferences:v1')),
        inViewport: content.left >= 0 && content.top >= 0 && content.right <= innerWidth && content.bottom <= innerHeight,
      };
    });
    await page.screenshot({ path: 'artifacts/settings.png', animations: 'disabled', timeout: 120000 });
    settingsState.backHandled = await page.evaluate(() => window.__NEON_APEX_ANDROID_BACK__());
    settingsState.closedByBack = await page.evaluate(() => document.querySelector('#settingsMenu').hidden);
  }

  const homeState = await page.evaluate(() => {
    const menu = document.querySelector('#homeMenu');
    const rect = menu.getBoundingClientRect();
    return {
      visible: !menu.hidden && getComputedStyle(menu).display !== 'none',
      raceStarted: Boolean(window.__NEON_APEX__?.vehicle.state.started),
      runtimeLoaded: Boolean(window.__NEON_APEX__ || window.__NEON_APEX_READY__),
      heavyAssets: performance.getEntriesByType('resource')
        .map((entry) => entry.name)
        .filter((name) => /CarConcept\.glb|modern_buildings_night_1k\.hdr/.test(name)),
      selectedMode: document.querySelector('[data-race-mode].active')?.dataset.raceMode,
      selectedTrack: document.querySelector('[data-track].active')?.dataset.track,
      overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
    };
  });
  if (testCase.name !== 'landscape') {
    await page.screenshot({
      path: `artifacts/home-${testCase.name}.png`,
      animations: 'disabled',
      timeout: 120000,
    });
  }
  const gameLoadStartedAt = performance.now();
  await page.evaluate(() => document.querySelector('#startRace').click());
  await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('done'),
    null,
    { timeout: 5000 },
  );
  const gameReadyMs = Math.round(performance.now() - gameLoadStartedAt);
  const readyMs = homeReadyMs + gameReadyMs;
  await page.waitForFunction(() => document.querySelector('#homeMenu').hidden === true);
  const raceConfig = await page.evaluate(() => ({
    mode: window.__NEON_APEX__.activeMode,
    track: window.__NEON_APEX__.activeTrack,
    laps: window.__NEON_APEX__.raceSystem.totalLaps,
    entrants: window.__NEON_APEX__.raceSystem.state.entrantCount,
    difficulty: window.__NEON_APEX__.vehicle.state.difficulty,
  }));
  await page.evaluate(() => window.__NEON_APEX__.qaAdvance(7, { throttle: 1, nitro: 1, autopilot: true }));
  const simulationMs = Math.round(performance.now() - caseStartedAt - readyMs);

  if (testCase.mobile) {
    const throttle = page.locator('[data-control="accelerate"]');
    await throttle.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch' });
    await page.evaluate(() => window.__NEON_APEX__.vehicle.update(0.1));
    await throttle.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' });
  } else {
    await page.keyboard.down('w');
    await page.evaluate(() => window.__NEON_APEX__.vehicle.update(0.1));
    await page.keyboard.up('w');
  }
  await page.evaluate(() => window.__NEON_APEX__.qaAdvance(0.016, { autopilot: true }));

  const metrics = await page.evaluate(() => {
    const source = document.querySelector('#game');
    const rects = [...document.querySelectorAll('.topbar, .race-feed, .performance-strip > div, .minimap-wrap, .telemetry, .touch-controls button')]
      .filter((element) => getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.getAttribute('data-control') || element.className || element.getAttribute('aria-label'),
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      });
    const overlaps = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const width = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const height = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (width > 0.5 && height > 0.5) {
          overlaps.push({ a: a.className, b: b.className, width, height });
        }
      }
    }
    const overflow = document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight;
    return {
      overflow,
      overlaps,
      speed: window.__NEON_APEX__.vehicle.speedKph,
      cameraDistance: window.__NEON_APEX__.camera.position.distanceTo(window.__NEON_APEX__.vehicle.position),
      vehicleDimensions: window.__NEON_APEX__.vehicle.object.userData.dimensions?.toArray?.() ?? null,
      webgl: source.getContext('webgl2') !== null,
      runtime: window.__NEON_APEX_METRICS__,
      render: {
        calls: window.__NEON_APEX__.renderer.info.render.calls,
        triangles: window.__NEON_APEX__.renderer.info.render.triangles,
        points: window.__NEON_APEX__.renderer.info.render.points,
      },
      rects,
    };
  });
  if (testCase.mobile) {
    await page.evaluate(() => {
      const { vehicle, camera } = window.__NEON_APEX__;
      camera.updateMatrixWorld(true);
      const cameraMatrix = camera.matrixWorld.elements;
      const cameraRight = [cameraMatrix[0], cameraMatrix[1], cameraMatrix[2]];
      const initial = {
        position: vehicle.position.clone(),
        velocity: vehicle.velocity.clone(),
        heading: vehicle.heading,
        yawRate: vehicle.yawRate,
        steering: vehicle.steering,
      };
      const restore = () => {
        vehicle.clearInput();
        vehicle.position.copy(initial.position);
        vehicle.velocity.copy(initial.velocity);
        vehicle.heading = initial.heading;
        vehicle.yawRate = initial.yawRate;
        vehicle.steering = initial.steering;
        vehicle._refreshTrackSample();
        vehicle._updatePublicState();
        vehicle.syncObject();
      };
      window.__NEON_APEX_TOUCH_PROBE__ = {
        restore,
        start() {
          restore();
          this.startPosition = vehicle.position.clone();
        },
        finish() {
          const delta = vehicle.position.clone().sub(this.startPosition);
          return delta.x * cameraRight[0] + delta.y * cameraRight[1] + delta.z * cameraRight[2];
        },
      };
    });
    const measureTouch = async (control, pointerId) => {
      await page.evaluate(() => window.__NEON_APEX_TOUCH_PROBE__.start());
      const button = page.locator(`button[data-control="${control}"]`);
      await button.dispatchEvent('pointerdown', { pointerId, pointerType: 'touch' });
      await page.evaluate(() => {
        const { vehicle } = window.__NEON_APEX__;
        for (let frame = 0; frame < 12; frame += 1) vehicle.update(0.05);
      });
      await button.dispatchEvent('pointerup', { pointerId, pointerType: 'touch' });
      return page.evaluate(() => window.__NEON_APEX_TOUCH_PROBE__.finish());
    };
    metrics.touchSteering = {
      leftScreenDelta: await measureTouch('left', 41),
      rightScreenDelta: await measureTouch('right', 42),
    };
    await page.evaluate(() => {
      window.__NEON_APEX_TOUCH_PROBE__.restore();
      delete window.__NEON_APEX_TOUCH_PROBE__;
    });
  }

  const screenshot = await page.screenshot({
    path: `artifacts/${testCase.name}.png`,
    fullPage: true,
    animations: 'disabled',
    timeout: 120000,
  });
  metrics.timings = {
    homeReadyMs,
    gameReadyMs,
    readyMs,
    simulationMs,
    screenshotMs: Math.round(performance.now() - caseStartedAt - readyMs - simulationMs),
  };
  const png = PNG.sync.read(screenshot);
  let luminanceTotal = 0;
  let luminanceSquared = 0;
  let nonBlack = 0;
  const quadrants = [0, 0, 0, 0];
  const quadrantCounts = [0, 0, 0, 0];
  for (let y = 0; y < png.height; y += 3) {
    for (let x = 0; x < png.width; x += 3) {
      const offset = (y * png.width + x) * 4;
      const luminance = png.data[offset] * 0.2126 + png.data[offset + 1] * 0.7152 + png.data[offset + 2] * 0.0722;
      luminanceTotal += luminance;
      luminanceSquared += luminance * luminance;
      if (luminance > 4) nonBlack += 1;
      const quadrant = (x >= png.width / 2 ? 1 : 0) + (y >= png.height / 2 ? 2 : 0);
      quadrants[quadrant] += luminance;
      quadrantCounts[quadrant] += 1;
    }
  }
  const count = quadrantCounts.reduce((total, value) => total + value, 0);
  const mean = luminanceTotal / count;
  metrics.mean = Number(mean.toFixed(2));
  metrics.variance = Number((luminanceSquared / count - mean * mean).toFixed(2));
  metrics.nonBlackRatio = Number((nonBlack / count).toFixed(3));
  metrics.quadrantMean = quadrants.map((value, index) => Number((value / quadrantCounts[index]).toFixed(2)));
  metrics.androidBack = await page.evaluate(() => {
    const pausedHandled = window.__NEON_APEX_ANDROID_BACK__();
    const pauseVisible = document.querySelector('#pauseMenu').hidden === false;
    const homeHandled = window.__NEON_APEX_ANDROID_BACK__();
    const homeVisible = document.querySelector('#homeMenu').hidden === false;
    const startEnabled = document.querySelector('#startRace').disabled === false;
    return { pausedHandled, pauseVisible, homeHandled, homeVisible, startEnabled };
  });

  await page.evaluate(() => {
    localStorage.removeItem('neon-apex:race-records:v1');
    window.__NEON_APEX__.raceSystem._emit('finish', {
      position: 1,
      entrants: 6,
      finalTime: 63.25,
      totalTime: 63.25,
      bestLapTime: 20.5,
      skillScore: 1280,
      cleanRace: true,
    });
  });
  await page.locator('#resultMenu:not([hidden])').waitFor({ timeout: 5000 });
  metrics.resultScreen = await page.evaluate(() => {
    const content = document.querySelector('#resultMenu .modal-content').getBoundingClientRect();
    return {
      title: document.querySelector('#resultTitle').textContent,
      personalBest: document.querySelector('#personalBest').textContent,
      recordStatus: document.querySelector('#recordStatus').textContent,
      stored: JSON.parse(localStorage.getItem('neon-apex:race-records:v1')),
      inViewport: content.left >= 0 && content.top >= 0 && content.right <= innerWidth && content.bottom <= innerHeight,
    };
  });
  if (testCase.name === 'mobile') {
    await page.evaluate(() => window.__NEON_APEX_ANDROID_BACK__());
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.locator('[data-track="night"]').click(),
    ]);
    await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true);
    metrics.mapSwitch = await page.evaluate(() => ({
      storedTrack: JSON.parse(localStorage.getItem('neon-apex:preferences:v1')).lastTrack,
      selectedTrack: document.querySelector('[data-track].active')?.dataset.track,
      homeVisible: document.querySelector('#homeMenu').hidden === false,
      runtimeLoaded: Boolean(window.__NEON_APEX__ || window.__NEON_APEX_READY__),
    }));
  }
  if (testCase.name !== 'mobile') {
    await page.screenshot({
      path: `artifacts/result-${testCase.name}.png`,
      animations: 'disabled',
      timeout: 120000,
    });
  }

  results.push({ case: testCase.name, mode: selectedMode, errors, homeState, settingsState, raceConfig, metrics });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

for (const result of results) {
  if (result.errors.length) throw new Error(`${result.case}: browser errors: ${result.errors.join('; ')}`);
  if (!result.homeState.visible || result.homeState.raceStarted) throw new Error(`${result.case}: game should wait on the home screen`);
  if (result.homeState.runtimeLoaded || result.homeState.heavyAssets.length) throw new Error(`${result.case}: heavy game runtime loaded before start`);
  if (result.homeState.selectedMode !== result.mode) throw new Error(`${result.case}: selected mode was not reflected on the home screen`);
  if (result.case === 'mobile' && result.homeState.selectedTrack !== 'day') throw new Error('mobile: day track was not selected on the home screen');
  if (result.homeState.overflow || !result.homeState.inViewport) throw new Error(`${result.case}: home screen exceeds the viewport`);
  if (result.raceConfig.mode !== result.mode) throw new Error(`${result.case}: wrong active race mode`);
  if (result.case === 'mobile' && result.raceConfig.track !== 'day') throw new Error('mobile: day track was not loaded for the race');
  if (result.raceConfig.laps !== expectedMode[result.mode].laps) throw new Error(`${result.case}: wrong lap count`);
  if (result.raceConfig.entrants !== expectedMode[result.mode].entrants) throw new Error(`${result.case}: wrong entrant count`);
  if (!result.metrics.webgl) throw new Error(`${result.case}: WebGL2 context unavailable`);
  if (result.metrics.nonBlackRatio < 0.35 || result.metrics.variance < 30) throw new Error(`${result.case}: canvas appears blank`);
  if (result.metrics.overflow) throw new Error(`${result.case}: viewport overflow detected`);
  if (result.metrics.overlaps.length) throw new Error(`${result.case}: UI overlap detected: ${JSON.stringify(result.metrics.overlaps)}`);
  if (result.metrics.speed < 20) throw new Error(`${result.case}: controls did not accelerate vehicle`);
  if (result.case === 'mobile') {
    const telemetryRect = result.metrics.rects.find((rect) => rect.className === 'telemetry');
    if (!telemetryRect || telemetryRect.left < result.metrics.rects[0].right * 0.55) {
      throw new Error(`mobile: speed telemetry remains too central: ${JSON.stringify(telemetryRect)}`);
    }
  }
  if (result.case === 'mobile') {
    if (!(result.metrics.touchSteering?.leftScreenDelta < -0.1)) throw new Error(`mobile: left touch moved the wrong way: ${JSON.stringify(result.metrics.touchSteering)}`);
    if (!(result.metrics.touchSteering?.rightScreenDelta > 0.1)) throw new Error(`mobile: right touch moved the wrong way: ${JSON.stringify(result.metrics.touchSteering)}`);
  }
  const expectation = expectedMode[result.mode];
  if (result.metrics.resultScreen?.title !== expectation.title) throw new Error(`${result.case}: wrong result title`);
  if (result.metrics.resultScreen?.recordStatus !== expectation.status) throw new Error(`${result.case}: missing mode record feedback`);
  if (result.metrics.resultScreen?.personalBest !== expectation.display) throw new Error(`${result.case}: mode record display mismatch`);
  if (result.metrics.resultScreen?.stored?.[expectation.recordKey] !== expectation.recordValue) throw new Error(`${result.case}: mode record was not persisted`);
  if (!result.metrics.resultScreen?.inViewport) throw new Error(`${result.case}: result screen exceeds the viewport`);
  if (!result.metrics.androidBack?.pausedHandled || !result.metrics.androidBack?.pauseVisible) throw new Error(`${result.case}: Android back did not pause the race`);
  if (!result.metrics.androidBack?.homeHandled || !result.metrics.androidBack?.homeVisible) throw new Error(`${result.case}: Android back did not return home`);
  if (!result.metrics.androidBack?.startEnabled) throw new Error(`${result.case}: start button remained disabled after returning home`);
  if (result.case === 'mobile') {
    const mapSwitch = result.metrics.mapSwitch;
    if (mapSwitch?.storedTrack !== 'night' || mapSwitch.selectedTrack !== 'night' || !mapSwitch.homeVisible || mapSwitch.runtimeLoaded) {
      throw new Error(`mobile: day-to-night map switch failed: ${JSON.stringify(mapSwitch)}`);
    }
  }
  if (result.case === 'desktop') {
    if (!result.settingsState?.inViewport) throw new Error('desktop: settings screen exceeds the viewport');
    if (result.settingsState?.stored?.quality !== 'balanced') throw new Error('desktop: quality setting was not persisted');
    if (result.settingsState?.stored?.difficulty !== 'hard') throw new Error('desktop: difficulty setting was not persisted');
    if (result.raceConfig.difficulty !== 'hard') throw new Error('desktop: hard difficulty did not reach vehicle physics');
    if (result.settingsState?.stored?.soundEnabled !== false) throw new Error('desktop: sound setting was not persisted');
    if (result.settingsState?.stored?.cameraShake !== false) throw new Error('desktop: camera setting was not persisted');
    if (!result.settingsState?.backHandled || !result.settingsState?.closedByBack) throw new Error('desktop: Android back did not close settings');
  }
}
