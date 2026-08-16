import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
for (const id of [
  'runtimeError', 'runtimeErrorDetail', 'runtimeErrorReload', 'runtimeErrorCopy',
  'runtimeBanner', 'runtimeBannerDetail', 'runtimeBannerCopy', 'runtimeBannerClose',
]) {
  assert.ok(html.includes(`id="${id}"`), `index.html 缺少 #${id}`);
}
assert.match(html, /id="runtimeError"[^>]*\shidden/, '错误面板必须默认隐藏');
assert.match(html, /id="runtimeBanner"[^>]*\shidden/, '错误横幅必须默认隐藏');

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NEON_APEX_CHROMIUM || '/usr/local/bin/chromium-browser',
});
const page = await browser.newPage();

// 用真实模块跑，而不是复刻一份逻辑：测的是发布出去的那份代码。
const source = readFileSync(new URL('../src/error-overlay.js', import.meta.url), 'utf8');
await page.setContent(`
  <div id="runtimeError" hidden><pre id="runtimeErrorDetail"></pre>
    <button id="runtimeErrorReload"></button><button id="runtimeErrorCopy">复制诊断信息</button></div>
  <div id="runtimeBanner" hidden><small id="runtimeBannerDetail"></small>
    <button id="runtimeBannerCopy">复制诊断</button><button id="runtimeBannerClose"></button></div>
  <canvas id="game"></canvas>
`);
await page.addScriptTag({ content: `${source.replace(/export /g, '')}\nwindow.__t = { installErrorOverlay, collectDiagnostics, reportFatal, recordHandled };` , type: 'module' });
await page.evaluate(() => window.__t.installErrorOverlay());

const visibility = () => page.evaluate(() => ({
  fatal: !document.querySelector('#runtimeError').hidden,
  banner: !document.querySelector('#runtimeBanner').hidden,
  fatalText: document.querySelector('#runtimeErrorDetail').textContent,
  bannerText: document.querySelector('#runtimeBannerDetail').textContent,
}));

// 1. 资源加载失败（img 404）绝不能弹面板：图片各有降级路径，弹了就是误伤。
await page.evaluate(() => {
  const img = document.createElement('img');
  img.src = '/definitely-missing-asset.png';
  document.body.append(img);
  return new Promise((resolve) => { img.onerror = () => resolve(); setTimeout(resolve, 500); });
});
assert.deepEqual(
  await visibility().then((v) => [v.fatal, v.banner]),
  [false, false],
  '资源 404 不应触发任何错误界面',
);

// 2. 良性噪声（ResizeObserver 循环告警）同样必须忽略。
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {
  error: new Error('ResizeObserver loop completed with undelivered notifications.'),
  message: 'ResizeObserver loop completed with undelivered notifications.',
})));
assert.deepEqual(
  await visibility().then((v) => [v.fatal, v.banner]),
  [false, false],
  'ResizeObserver 告警不应触发错误界面',
);

// 3. 游戏尚未就绪时的真实脚本错误 → 弹全屏面板（这正是"空屏"发生的时刻）。
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {
  error: new TypeError('boom during load'), message: 'boom during load',
})));
let seen = await visibility();
assert.equal(seen.fatal, true, '加载阶段的脚本错误应弹全屏面板');
assert.equal(seen.banner, false, '加载阶段不应同时弹横幅');
assert.match(seen.fatalText, /TypeError: boom during load/);

// 4. 已经在跑之后再出错 → 只弹角落横幅，绝不打断比赛。
await page.evaluate(() => {
  document.querySelector('#runtimeError').hidden = true;
  window.__NEON_APEX_READY__ = true;
  window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
    promise: Promise.reject(new Error('late failure')), reason: new Error('late failure'), cancelable: true,
  }));
});
await page.waitForTimeout(100);
seen = await visibility();
assert.equal(seen.fatal, false, '比赛进行中不应弹全屏面板');
assert.equal(seen.banner, true, '比赛进行中应弹角落横幅');
assert.match(seen.bannerText, /late failure/);

// 5. 横幅可关闭，且关掉后不再被后续错误反复弹出，避免刷屏。
await page.click('#runtimeBannerClose');
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', {
  error: new Error('another one'), message: 'another one',
})));
assert.equal((await visibility()).banner, false, '玩家关闭后不应再被反复弹出');

// 6. 诊断信息要带上排查渲染异常最关键的字段。
const diagnostics = await page.evaluate(() => window.__NEON_APEX_DIAGNOSTICS__);
for (const key of ['userAgent', 'gpu', 'viewport', 'ready', 'errors']) {
  assert.ok(key in diagnostics, `诊断信息缺少 ${key}`);
}
assert.ok(diagnostics.errors.length > 0, '诊断信息应包含已记录的错误');
assert.equal(diagnostics.ready, true);

// 7. recordHandled 只进诊断，不抢已有的降级界面。
await page.evaluate(() => {
  document.querySelector('#runtimeError').hidden = true;
  window.__t.recordHandled(new Error('track load failed'), '赛道加载失败');
});
seen = await visibility();
assert.equal(seen.fatal, false, 'recordHandled 不应弹面板');
const after = await page.evaluate(() => window.__NEON_APEX_DIAGNOSTICS__);
assert.ok(
  after.errors.some((e) => e.type === 'handled' && e.message.includes('track load failed')),
  'recordHandled 应写入诊断信息',
);

await browser.close();
console.log(JSON.stringify({
  markup: 'ok', resourceNoise: 'ok', benignNoise: 'ok',
  fatalWhileLoading: 'ok', bannerWhileRacing: 'ok', dismissible: 'ok',
  diagnostics: 'ok', handledRecording: 'ok',
}));
