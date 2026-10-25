import {test, expect} from '@playwright/test';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {cpus, platform, arch} from 'node:os';

test.use({deviceScaleFactor: 2});

const captures = resolve('test-results/visual-review');
async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
}
async function nextRender(page, action) {
  const before = await page.evaluate(() => window.__atlasDiagnostics.frames);
  await action();
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.frames)).toBeGreaterThan(before);
}
async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.screenshot({path: resolve(captures, `atlas-3d-${name}.png`), fullPage: true});
}

test('true mesh picking from all four directions and visual review captures', async ({page}) => {
  await mkdir(captures, {recursive: true});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await ready(page);
  const regions = await page.evaluate(() => fetch('/assets/anatomy/manifest.json').then(response => response.json()).then(manifest => manifest.regions));
  await capture(page, 'desktop');
  for (const view of ['front', 'back', 'left', 'right']) {
    await nextRender(page, () => page.locator(`[data-camera-view="${view}"]`).click());
    await capture(page, view);
    const hit = await page.evaluate(candidates => {
      for (const region of candidates) {
        const point = window.__atlasProjectRegion(region.id);
        if (point?.visible) return {id: region.id, label: region.label, point};
      }
      return null;
    }, regions);
    expect(hit, `No anatomically visible muscle could be picked from ${view}`).not.toBeNull();
    await page.mouse.click(hit.point.x, hit.point.y);
    await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.selection)).toBe(hit.id);
    await expect(page.locator('#selection-card h2')).toHaveText(hit.label);
    if (view === 'front') await capture(page, 'selected-region');
    await page.keyboard.press('Escape');
    await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  }
  await nextRender(page, () => page.locator('[data-camera-view="front"]').click());
  await nextRender(page, () => page.locator('[data-area-button="upper"]').click());
  await capture(page, 'upper');
  await nextRender(page, () => page.locator('[data-area-button="lower"]').click());
  await capture(page, 'lower');
  await nextRender(page, () => page.locator('[data-action="reset-view"]').click());
  await nextRender(page, () => page.locator('[data-action="theme"]').click());
  await capture(page, 'desktop-dark');
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('h1').scrollIntoViewIfNeeded();
  await capture(page, 'mobile-dark');
  await nextRender(page, () => page.locator('[data-action="theme"]').click());
  await capture(page, 'mobile');
});

test('renderer stops while idle and recovers a lost graphics context', async ({page}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await ready(page);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  const first = await page.evaluate(() => window.__atlasDiagnostics.frames);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__atlasDiagnostics.frames)).toBe(first);
  const canLose = await page.evaluate(() => {
    const extension = document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    window.__testContextRecovery = extension;
    extension.loseContext();
    return true;
  });
  expect(canLose, 'Browser must expose context-loss simulation for this test').toBe(true);
  await expect(page.locator('[data-action="retry"]')).toBeVisible();
  await page.evaluate(() => window.__testContextRecovery.restoreContext());
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('canvas')).toHaveCount(1);
  await page.locator('[data-muscle-button="chest"]').click();
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
});

test('records desktop and mobile-viewport orbit performance', async ({page, browser}) => {
  await ready(page);
  const measurements = [];
  for (const [name, viewport] of [['desktop', {width: 1440, height: 1100}], ['mobile viewport on desktop', {width: 390, height: 844}]]) {
    await page.setViewportSize(viewport);
    await page.locator('.anatomy-canvas').scrollIntoViewIfNeeded();
    await page.locator('[data-action="reset-view"]').click();
    const box = await page.locator('.anatomy-canvas').boundingBox();
    const origin = {x: box.x + box.width * .38, y: box.y + box.height * .45};
    await page.mouse.move(origin.x, origin.y);
    const before = await page.evaluate(() => ({time: performance.now(), ...window.__atlasDiagnostics}));
    await page.mouse.down();
    await page.mouse.move(origin.x + box.width * .25, origin.y + 20, {steps: 90});
    await page.mouse.move(origin.x - box.width * .12, origin.y - 10, {steps: 90});
    await page.mouse.up();
    const after = await page.evaluate(() => ({time: performance.now(), ...window.__atlasDiagnostics}));
    measurements.push({name, viewport, measuredFrames: after.frames - before.frames, elapsedMs: after.time - before.time, averageFramesPerSecond: (after.frames - before.frames) * 1000 / (after.time - before.time), diagnostics: after});
    expect(after.frames).toBeGreaterThan(before.frames + 10);
  }
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await mkdir(captures, {recursive: true});
  await writeFile(resolve(captures, 'performance.json'), JSON.stringify({note: 'Automated orbit in installed Google Chrome headless on the desktop host at device scale factor 2. Mobile figures use viewport emulation, not a physical mobile device. GPU renderer and quality tier are included per sample.', hardware: {platform: platform(), architecture: arch(), cpu: cpus()[0]?.model, gpu, browserVersion: browser.version()}, measurements}, null, 2));
  console.log('Orbit measurements:', JSON.stringify(measurements.map(({name, averageFramesPerSecond, diagnostics}) => ({name, averageFramesPerSecond, renderMs: diagnostics.averageFrameMs, quality: diagnostics.quality, renderer: diagnostics.renderer}))));
});
