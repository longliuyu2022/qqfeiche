import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:4173';
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || '/usr/local/bin/chromium-browser',
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: {
    width: Number(process.env.VIEWPORT_WIDTH) || 960,
    height: Number(process.env.VIEWPORT_HEIGHT) || 540,
  },
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

await fs.mkdir('artifacts/sections', { recursive: true });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__NEON_APEX_BOOTSTRAP_READY__ === true, null, { timeout: 10000 });
await page.evaluate(() => document.querySelector('#startRace').click());
await page.waitForFunction(() => window.__NEON_APEX_READY__ === true, null, { timeout: 120000 });

const sections = [
  { name: 'harbor', progress: 0.12 },
  { name: 'city', progress: 0.43 },
  { name: 'mountain', progress: 0.79 },
].filter((section) => !process.env.SECTION || process.env.SECTION === section.name);
const results = [];
for (const section of sections) {
  const startedAt = performance.now();
  const dataUrl = await page.evaluate(
    ({ progress }) => window.__NEON_APEX__.qaCaptureProgress(progress),
    section,
  );
  const image = Buffer.from(dataUrl.split(',')[1], 'base64');
  const path = `artifacts/sections/${section.name}.png`;
  await fs.writeFile(path, image);
  results.push({ ...section, path, bytes: image.length, renderMs: Math.round(performance.now() - startedAt) });
}

const metrics = await page.evaluate(() => window.__NEON_APEX_METRICS__);
await browser.close();
console.log(JSON.stringify({ errors, metrics, sections: results }, null, 2));
if (errors.length) throw new Error(errors.join('; '));
