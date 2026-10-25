import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {cpus, platform, arch} from 'node:os';

test.use({deviceScaleFactor: 2});

const phase = process.env.ATLAS_QUALITY_PHASE || 'after';
const output = resolve('test-results/quality');
async function rendered(page, action) {
  const frames = await page.evaluate(() => window.__atlasDiagnostics.frames);
  await action();
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.frames)).toBeGreaterThan(frames);
}
async function inspection(page) {
  if (phase === 'after') await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.inspectionReady)).toBe(true);
}
async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.locator('.anatomy-canvas').scrollIntoViewIfNeeded();
  await inspection(page);
  await page.locator('.anatomy-canvas').screenshot({path: resolve(output, `quality-${phase}-${name}.png`)});
}

test('muscle close-up clarity and full-resolution rendering', async ({page, browser}) => {
  await mkdir(output, {recursive: true});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  const measurements = [];
  for (const [name, viewport] of [['desktop', {width: 1440, height: 1100}], ['mobile', {width: 390, height: 844}]]) {
    await page.setViewportSize(viewport);
    await rendered(page, () => page.locator('[data-action="reset-view"]').click());
    await rendered(page, () => page.locator('[data-camera-view="front"]').click());
    await capture(page, `${name}-front`);
    await rendered(page, () => page.locator('[data-area-button="upper"]').click());
    await capture(page, `${name}-upper`);
    await page.locator('[data-muscle-button="chest"]').click();
    await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
    await page.keyboard.press('Escape');
    await rendered(page, () => page.locator('[data-camera-view="front"]').click());
    await capture(page, `${name}-chest`);
    const details = await page.evaluate(() => {
      const canvas = document.querySelector('.anatomy-canvas');
      const rect = canvas.getBoundingClientRect();
      const gl = canvas.getContext('webgl2');
      const gpuInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {canvas: {width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height}, diagnostics: window.__atlasDiagnostics, gpu: gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
    });
    expect(details.canvas.width).toBeGreaterThanOrEqual(Math.round(details.canvas.cssWidth * 1.9));
    expect(details.canvas.height).toBeGreaterThanOrEqual(Math.round(details.canvas.cssHeight * 1.9));
    if (phase === 'after') {
      const targets = details.diagnostics.renderTargets;
      expect(targets.beauty.width).toBe(details.canvas.width);
      expect(targets.beauty.height).toBe(details.canvas.height);
      expect(targets.output).toEqual(targets.beauty);
      expect(targets.ao).toEqual(targets.beauty);
      expect(details.diagnostics.inspectionReady).toBe(true);
      expect(details.diagnostics.materialTextures.some(texture => texture.width >= 2048 && texture.height >= 2048)).toBe(true);
    }
    let orbit = null;
    if (phase === 'after') {
      await rendered(page, () => page.locator('[data-action="reset-view"]').click());
      await inspection(page);
      await page.emulateMedia({reducedMotion: 'no-preference'});
      const box = await page.locator('.anatomy-canvas').boundingBox();
      const origin = {x: box.x + box.width * .38, y: box.y + box.height * .45};
      await page.mouse.move(origin.x, origin.y);
      const before = await page.evaluate(() => ({time: performance.now(), frames: window.__atlasDiagnostics.frames}));
      await page.mouse.down();
      await page.mouse.move(origin.x + box.width * .25, origin.y + 16, {steps: 90});
      await page.mouse.move(origin.x - box.width * .12, origin.y - 8, {steps: 90});
      await page.mouse.up();
      const after = await page.evaluate(() => ({time: performance.now(), ...window.__atlasDiagnostics}));
      orbit = {frames: after.frames - before.frames, elapsedMs: after.time - before.time, fps: (after.frames - before.frames) * 1000 / (after.time - before.time), quality: after.quality, renderMs: after.averageFrameMs};
      expect(orbit.frames).toBeGreaterThan(10);
      await page.emulateMedia({reducedMotion: 'reduce'});
      await inspection(page);
    }
    measurements.push({name, viewport, ...details, orbit});
  }
  await writeFile(resolve(output, `quality-${phase}-measurements.json`), JSON.stringify({phase, note: 'Deterministic front/upper/chest close-ups in installed Chrome at DPR 2. Mobile is viewport emulation on the same desktop GPU, not a physical phone.', hardware: {platform: platform(), arch: arch(), cpu: cpus()[0]?.model, browser: browser.version()}, asset: await page.evaluate(() => fetch('/assets/anatomy/manifest.json').then(response => response.json()).then(({stats, source}) => ({stats, source}))), measurements}, null, 2));
});

test('slow interaction returns to full inspection resolution', async ({page}) => {
  test.skip(phase === 'before', 'The baseline intentionally predates inspection-quality restoration.');
  await page.addInitScript(() => {
    // Exercise adaptation by slowing browser frame cadence without application
    // hooks or setters. Cancellation remains correct for context/page cleanup.
    const nativeRequest = window.requestAnimationFrame.bind(window);
    const nativeCancel = window.cancelAnimationFrame.bind(window);
    let nextId = 1;
    const pending = new Map();
    window.requestAnimationFrame = callback => {
      const id = nextId++;
      const timer = setTimeout(() => {
        const nativeId = nativeRequest(time => { pending.delete(id); callback(time); });
        pending.set(id, {nativeId});
      }, 42);
      pending.set(id, {timer});
      return id;
    };
    window.cancelAnimationFrame = id => {
      const job = pending.get(id);
      if (job?.timer !== undefined) clearTimeout(job.timer);
      if (job?.nativeId !== undefined) nativeCancel(job.nativeId);
      pending.delete(id);
    };
  });
  await page.goto('/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await inspection(page);
  await page.locator('.anatomy-canvas').scrollIntoViewIfNeeded();
  const box = await page.locator('.anatomy-canvas').boundingBox();
  const origin = {x: box.x + box.width * .4, y: box.y + box.height * .45};
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  let low = null;
  for (let i = 0; i < 320; i++) {
    await page.mouse.move(origin.x + Math.sin(i * .12) * box.width * .15, origin.y + Math.cos(i * .08) * 14);
    await page.waitForTimeout(45);
    low = await page.evaluate(() => window.__atlasDiagnostics);
    if (low.motionQuality >= 2) break;
  }
  expect(low.inspectionReady).toBe(false);
  expect(low.motionQuality).toBeGreaterThanOrEqual(2);
  expect(low.pixelRatio).toBeLessThan(2);
  await page.mouse.up();
  await inspection(page);
  const settled = await page.evaluate(() => ({diagnostics: window.__atlasDiagnostics, canvas: {width: document.querySelector('canvas').width, height: document.querySelector('canvas').height}}));
  expect(settled.diagnostics.quality).toBe('inspection');
  expect(settled.diagnostics.pixelRatio).toBe(2);
  expect(settled.diagnostics.renderTargets.beauty).toEqual(settled.canvas);
  expect(settled.diagnostics.renderTargets.ao).toEqual(settled.canvas);
  await page.waitForTimeout(500);
  const idleFrame = await page.evaluate(() => window.__atlasDiagnostics.frames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__atlasDiagnostics.frames)).toBe(idleFrame);
  await writeFile(resolve(output, 'quality-restoration-measurements.json'), JSON.stringify({note: 'Injected42ms requestAnimationFrame delay simulates a slow renderer without an application mutation hook.', duringMotion: low, settled}, null, 2));
});
