import {test, expect} from '@playwright/test';

async function openAtlas(page) {
  await page.goto('/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('.anatomy-canvas')).toBeVisible();
}

test('one self-hosted 3D viewport, searchable groups, region inspection, and saved preferences', async ({page}) => {
  const failures = [];
  const externalRequests = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && !url.hostname.match(/^(127\.0\.0\.1|localhost)$/)) externalRequests.push(request.url());
  });
  await openAtlas(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('.map-grid,.mobile-view-picker,.model-picker')).toHaveCount(0);
  await expect(page.locator('[data-muscle-button]')).toHaveCount(18);
  await page.locator('[data-muscle-button="chest"]').click();
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
  await expect(page.locator('.structure-item')).not.toHaveCount(0);
  await page.locator('.structure-item').first().click();
  await expect(page.locator('#selection-card')).toContainText('Anatomical side');
  await expect(page.locator('#selection-card dt').filter({hasText: /^View$/})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  await page.locator('#muscle-search').fill('gastrocnemius');
  await expect(page.locator('[data-muscle-button="calves"]')).toBeVisible();
  await expect(page.locator('[data-muscle-button="chest"]')).toHaveCount(0);
  await page.locator('#muscle-search').fill('unfindable anatomy example');
  await expect(page.locator('.list-empty')).toBeVisible();
  await page.locator('#muscle-search').fill('');
  for (const toggle of ['detail', 'labels', 'joints']) {
    const control = page.locator(`[data-toggle="${toggle}"]`);
    const before = await control.getAttribute('aria-pressed');
    await control.click();
    await expect(control).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
  }
  await page.locator('[data-action="theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('[data-toggle="detail"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-toggle="labels"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-toggle="joints"]')).toHaveAttribute('aria-pressed', 'true');
  expect(externalRequests).toEqual([]);
  expect(failures).toEqual([]);
});

test('camera presets, framing, drag threshold, and keyboard selection keep one renderer', async ({page}) => {
  await openAtlas(page);
  for (const view of ['front', 'right', 'back', 'left']) {
    await page.locator(`[data-camera-view="${view}"]`).click();
    await expect(page.locator('canvas')).toHaveCount(1);
  }
  for (const area of ['upper', 'lower', 'full']) {
    await page.locator(`[data-area-button="${area}"]`).click();
    await expect(page.locator(`[data-area-button="${area}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.area)).toBe(area);
  }
  await page.locator('[data-action="zoom-in"]').click();
  await page.locator('[data-action="zoom-out"]').click();
  await page.locator('[data-action="reset-view"]').click();
  const canvas = page.locator('.anatomy-canvas');
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .5, {steps: 12});
  await page.mouse.up();
  await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  const calves = page.locator('[data-muscle-button="calves"]');
  await calves.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection-card h2')).toHaveText('Calf muscles');
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  await canvas.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await page.keyboard.press('Home');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('mobile layout and reduced motion retain accessible inspection', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.emulateMedia({reducedMotion: 'reduce'});
  await openAtlas(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('[data-muscle-button="quads"]').click();
  await expect(page.locator('#mobile-selection')).toBeVisible();
  await page.locator('[data-action="inspect"]').click();
  await expect(page.locator('#selection-card h2')).toHaveText('Quadriceps');
  await page.locator('#selection-card [data-action="clear"]').click();
  await expect(page.locator('#mobile-selection')).toBeHidden();
  await page.locator('[data-area-button="upper"]').click();
  await expect(page.locator('[data-area-button="upper"]')).toHaveAttribute('aria-pressed', 'true');
});

test('asset failures allow retry without duplicating the renderer', async ({page}) => {
  let fail = true;
  await page.route('**/assets/anatomy/male.glb', route => fail ? route.fulfill({status: 503, body: 'Temporarily unavailable'}) : route.continue());
  await page.goto('/');
  await expect(page.locator('[data-action="retry"]')).toBeVisible();
  await expect(page.locator('[data-muscle-button]')).toHaveCount(18);
  fail = false;
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('WebGL unavailable keeps the HTML muscle browser functional', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return String(type).startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('[data-action="retry"]')).toBeVisible();
  await page.locator('[data-muscle-button="biceps"]').click();
  await expect(page.locator('#selection-card h2')).toHaveText('Upper arm flexors');
  await page.locator('#muscle-search').fill('soleus');
  await expect(page.locator('[data-muscle-button="calves"]')).toBeVisible();
});

test('metadata failure preserves group descriptions and reconciles selection on retry', async ({page}) => {
  let fail = true;
  await page.route('**/assets/anatomy/manifest.json', route => fail ? route.fulfill({status: 503, body: 'Temporarily unavailable'}) : route.continue());
  await page.goto('/');
  await expect(page.locator('[data-action="retry"]')).toBeVisible();
  await page.locator('[data-muscle-button="chest"]').click();
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
  fail = false;
  await page.locator('[data-action="retry"]').click();
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
  await expect(page.locator('.structure-item')).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.selectedRegionIds.length)).toBeGreaterThan(1);
});

test('touch orbit and pinch gestures move the camera without selecting anatomy', async ({browser}) => {
  const context = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce'});
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4181/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  const box = await page.locator('.anatomy-canvas').boundingBox();
  const client = await context.newCDPSession(page);
  const center = {x: box.x + box.width / 2, y: box.y + box.height * .45};
  const before = await page.evaluate(() => window.__atlasDiagnostics.camera);
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 0, x: center.x, y: center.y}]});
  for (let step = 1; step <= 6; step++) await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 0, x: center.x + step * 10, y: center.y}]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.camera)).not.toEqual(before);
  const distance = () => page.evaluate(() => {const d = window.__atlasDiagnostics; return Math.hypot(...d.camera.map((n, i) => n - d.target[i]));});
  const beforePinch = await distance();
  await client.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{id: 0, x: center.x - 25, y: center.y}, {id: 1, x: center.x + 25, y: center.y}]});
  for (let step = 1; step <= 6; step++) await client.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{id: 0, x: center.x - 25 - step * 5, y: center.y}, {id: 1, x: center.x + 25 + step * 5, y: center.y}]});
  await client.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  await expect.poll(distance).toBeLessThan(beforePinch);
  await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  await context.close();
});

test('keyboard selection preserves focus through muscle and structure updates', async ({page}) => {
  await openAtlas(page);
  const pectorals = page.locator('[data-muscle-button="chest"]');
  await pectorals.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
  await expect(pectorals).toBeFocused();
  await page.locator('#selection-card [data-action="clear"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-side-button="left"]')).toBeFocused();
  await page.keyboard.press('Tab');
  const rightSide = page.locator('[data-side-button="right"]');
  await expect(rightSide).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(rightSide).toBeFocused();
  await expect(rightSide).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.selection)).toMatch(/-right$/);
  await page.keyboard.press('Tab');
  const firstStructure = page.locator('.structure-item').first();
  await expect(firstStructure).toBeFocused();
  const label = await firstStructure.getAttribute('data-structure');
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection-card h2')).toHaveText(label);
  await expect(page.locator('.structure-item').filter({hasText: label})).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.selection)).toMatch(/-right$/);
  await page.keyboard.press('Tab');
  await expect(page.locator('.structure-item').nth(1)).toBeFocused();
  const leftSide = page.locator('[data-side-button="left"]');
  await leftSide.focus();
  await page.keyboard.press('Enter');
  await expect(leftSide).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.__atlasDiagnostics.selection)).toMatch(/-left$/);
});

test('front-to-back camera transition orbits outside the body', async ({page}) => {
  await openAtlas(page);
  await page.locator('[data-camera-view="front"]').click();
  await expect.poll(() => page.evaluate(() => {const d = window.__atlasDiagnostics; return Math.abs(d.camera[0] - d.target[0]);})).toBeLessThan(.005);
  const initialRadius = await page.evaluate(() => {const d = window.__atlasDiagnostics; return Math.hypot(...d.camera.map((value, index) => value - d.target[index]));});
  await page.evaluate(() => {
    window.__testOrbitSamples = [];
    window.__testOrbitSampling = true;
    const sample = () => {
      if (!window.__testOrbitSampling) return;
      const d = window.__atlasDiagnostics;
      window.__testOrbitSamples.push(Math.hypot(...d.camera.map((value, index) => value - d.target[index])));
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.locator('[data-camera-view="back"]').click();
  await expect.poll(() => page.evaluate(() => {const d = window.__atlasDiagnostics; return d.camera[2] - d.target[2] < 0 && Math.abs(d.camera[0] - d.target[0]) < .005;})).toBe(true);
  const samples = await page.evaluate(() => {window.__testOrbitSampling = false; return window.__testOrbitSamples;});
  expect(samples.length).toBeGreaterThan(6);
  expect(Math.min(...samples)).toBeGreaterThanOrEqual(initialRadius * .8);
});

test('production serves binary assets correctly and rejects non-public paths', async ({request}) => {
  const model = await request.head('/assets/anatomy/male.glb');
  expect(model.status()).toBe(200);
  expect(model.headers()['content-type']).toBe('model/gltf-binary');
  expect(Number(model.headers()['content-length'])).toBeGreaterThan(100000);
  expect((await request.get('/assets/anatomy/manifest.json')).status()).toBe(200);
  expect((await request.get('/assets/anatomy/NOTICE.txt')).status()).toBe(200);
  for (const path of ['/unknown-page', '/package.json', '/server.mjs', '/src/app.js', '/assets/../package.json', '/assets/%2e%2e/%2e%2e/package.json', '/assets/maps/male-front.svg']) {
    expect((await request.get(path)).status(), path).toBe(404);
  }
  expect((await request.post('/')).status()).toBe(405);
});
