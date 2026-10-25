import {test, expect} from '@playwright/test';

const cards = page => page.locator('#exercise-panel [data-exercise-id]');

async function openAtlas(page) {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await page.goto('/');
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
}

async function expectImagesLoaded(images) {
  expect(await images.count()).toBeGreaterThan(0);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    await expect(image).toHaveAttribute('src', /^\/assets\/exercises\/media\//);
  }
}

async function selectGroup(page, group, name) {
  await page.locator(`[data-muscle-button="${group}"]`).click();
  await expect(page.locator('#exercises-title')).toContainText(name);
  await expect(cards(page).first()).toBeVisible();
}

test('selected muscles show local image cards, filters, gallery views, and accessible instructions', async ({page}) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname)) externalRequests.push(request.url());
  });
  await openAtlas(page);
  await selectGroup(page, 'chest', 'Pectorals');
  await expectImagesLoaded(cards(page).locator('img'));
  const mediaFrames = await page.locator('.exercise-card-media').evaluateAll(elements => elements.map(element => ({width: element.clientWidth, height: element.clientHeight})));
  expect(Math.max(...mediaFrames.map(frame => frame.height)) - Math.min(...mediaFrames.map(frame => frame.height))).toBeLessThanOrEqual(1);
  for (const frame of mediaFrames) expect(Math.abs(frame.width / frame.height - 4 / 3)).toBeLessThan(.02);
  const initialCount = await cards(page).count();
  await page.locator('[data-exercise-action="more"]').click();
  await expect.poll(() => cards(page).count()).toBeGreaterThan(initialCount);

  const search = page.locator('#exercise-search');
  await search.fill('bench');
  await expect(search).toBeFocused();
  await expect(cards(page).first()).toContainText(/bench/i);
  await page.locator('#exercise-equipment').selectOption({label: 'Barbell'});
  await page.locator('#exercise-relationship').selectOption({label: 'Primary target'});
  await expect(cards(page).first()).toBeVisible();
  for (const card of await page.locator('.exercise-card').all()) {
    await expect(card).toContainText(/bench/i);
    await expect(card).toContainText(/barbell/i);
    await expect(card).toContainText('Primary target');
  }

  const visibleIds = await cards(page).evaluateAll(elements => elements.map(element => element.dataset.exerciseId));
  await page.locator('[data-side-button="left"]').click();
  await expect(search).toHaveValue('bench');
  expect(await cards(page).evaluateAll(elements => elements.map(element => element.dataset.exerciseId))).toEqual(visibleIds);
  const trigger = cards(page).first();
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#exercise-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2')).toContainText(/bench/i);
  const gallery = dialog.locator('.exercise-gallery-image');
  await expectImagesLoaded(gallery);
  const firstSource = await gallery.getAttribute('src');
  await dialog.locator('[data-image-index="1"]').click();
  await expectImagesLoaded(gallery);
  await expect(gallery).not.toHaveAttribute('src', firstSource);
  await expect(dialog.locator('[data-image-index="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('ol li').first()).toBeHidden();
  await dialog.locator('details summary').click();
  await expect(dialog.locator('ol li').first()).toBeVisible();
  await expect.poll(() => dialog.locator('ol li').count()).toBeGreaterThan(1);
  await expect(dialog.getByRole('button', {name: 'Close exercise', exact: true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('#selection-card')).not.toHaveClass(/is-empty/);

  await search.fill('zzzz-no-exercise');
  await expect(cards(page)).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.locator('[data-exercise-action="reset"]').click();
  await expect(search).toHaveValue('');
  await expect(cards(page).first()).toBeVisible();
  await expectImagesLoaded(cards(page).locator('img'));
  await page.locator('#exercise-panel').screenshot({path: test.info().outputPath('exercises-desktop.png')});
  await page.keyboard.press('Escape');
  await expect(page.locator('#selection-card')).toHaveClass(/is-empty/);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test('new muscle selections reset filters and supporting-muscle matches are labelled', async ({page}) => {
  await openAtlas(page);
  await selectGroup(page, 'chest', 'Pectorals');
  await page.locator('#exercise-search').fill('bench');
  await page.locator('#exercise-equipment').selectOption({label: 'Barbell'});
  await selectGroup(page, 'triceps', 'Triceps');
  await expect(page.locator('#exercise-search')).toHaveValue('');
  await expect(page.locator('#exercise-equipment')).toHaveValue('all');
  await page.locator('#exercise-relationship').selectOption({label: 'Supporting muscle'});
  await expect(cards(page).first()).toBeVisible();
  for (const card of await page.locator('.exercise-card').all()) await expect(card).toContainText('Supporting muscle');
  await cards(page).first().click();
  await expect(page.locator('#exercise-dialog')).toContainText('Supporting muscle');
});

test('exercise browsing and instructions fit a 390px touch viewport in dark mode', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await openAtlas(page);
  await selectGroup(page, 'quads', 'Quadriceps');
  await page.locator('[data-action="theme"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('#exercise-equipment').selectOption({label: 'Body Weight'});
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await cards(page).first().click();
  const dialog = page.locator('#exercise-dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expectImagesLoaded(dialog.locator('.exercise-gallery-image'));
  const galleryBounds = await dialog.locator('.exercise-gallery').boundingBox();
  const imageBounds = await dialog.locator('.exercise-gallery-image').boundingBox();
  expect(Math.abs(imageBounds.width - galleryBounds.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(imageBounds.height - galleryBounds.height)).toBeLessThanOrEqual(1);
  expect(galleryBounds.height).toBeLessThanOrEqual(390);
  await expect(dialog.locator('ol li').first()).toBeHidden();
  await page.screenshot({path: test.info().outputPath('exercises-mobile.png')});
  await dialog.getByRole('button', {name: 'Close exercise', exact: true}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#selection-card h2')).toHaveText('Quadriceps');
});

test('late catalog loading follows the newest muscle selection', async ({page}) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/assets/exercises/catalog.json', async route => { await gate; await route.continue(); });
  try {
    await openAtlas(page);
    const requested = page.waitForRequest('**/assets/exercises/catalog.json');
    await page.locator('[data-muscle-button="chest"]').click();
    await requested;
    await page.locator('[data-muscle-button="biceps"]').click();
    release();
    await expect(page.locator('#exercises-title')).toContainText('Upper arm flexors');
    await expect(cards(page).first()).toBeVisible();
    await page.locator('#exercise-search').fill('curl');
    await expect(cards(page).first()).toContainText(/curl/i);
    await expect(page.locator('#selection-card h2')).toHaveText('Upper arm flexors');
  } finally { release(); }
});

test('catalog errors are retryable without resetting anatomy', async ({page}) => {
  let fail = true;
  await page.route('**/assets/exercises/catalog.json', route => fail
    ? route.fulfill({status: 503, body: 'Temporarily unavailable'})
    : route.continue());
  await openAtlas(page);
  await page.locator('[data-muscle-button="calves"]').click();
  await expect(page.locator('[data-exercise-action="retry"]')).toBeVisible();
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  fail = false;
  await page.locator('[data-exercise-action="retry"]').click();
  await expect(cards(page).first()).toBeVisible();
  await expect(page.locator('#selection-card h2')).toHaveText('Calf muscles');
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('exercises remain available without WebGL and missing dataset targets are honest', async ({page}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return String(type).startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await page.goto('/');
  await expect(page.locator('[data-action="retry"]')).toBeVisible();
  await selectGroup(page, 'biceps', 'Upper arm flexors');
  await cards(page).first().click();
  await expectImagesLoaded(page.locator('#exercise-dialog .exercise-gallery-image'));
  await page.locator('#exercise-dialog details summary').click();
  await expect(page.locator('#exercise-dialog ol li').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-muscle-button="tibialis"]').click();
  await expect(page.locator('#exercises-title')).toContainText('Tibialis anterior');
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('#exercise-panel')).toContainText(/no.*(exercise|match)|not.*(list|include|tag)/i);
});


test('image-manifest failures are retryable while anatomy remains usable', async ({page}) => {
  let fail = true;
  await page.route('**/assets/exercises/media-manifest.json', route => fail
    ? route.fulfill({status: 503, body: 'Temporarily unavailable'})
    : route.continue());
  await openAtlas(page);
  await page.locator('[data-muscle-button="chest"]').click();
  await expect(page.locator('[data-exercise-action="retry"]')).toBeVisible();
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  fail = false;
  await page.locator('[data-exercise-action="retry"]').click();
  await expect(cards(page).first()).toBeVisible();
  await expectImagesLoaded(cards(page).locator('img'));
  await expect(page.locator('#selection-card h2')).toHaveText('Pectorals');
});

test('failed gallery images can be retried without closing the exercise', async ({page}) => {
  await openAtlas(page);
  await selectGroup(page, 'chest', 'Pectorals');
  await expectImagesLoaded(cards(page).locator('img'));
  let fail = true;
  // Install before opening so the gallery's second-view thumbnail cannot warm the cache.
  await page.route('**/assets/exercises/media/**/1.jpg*', route => fail
    ? route.fulfill({status: 503, body: 'Temporarily unavailable'})
    : route.continue());
  await cards(page).first().click();
  const dialog = page.locator('#exercise-dialog');
  const gallery = dialog.locator('.exercise-gallery-image');
  await expectImagesLoaded(gallery);
  await dialog.locator('[data-image-index="1"]').click();
  await expect(dialog.locator('[data-exercise-action="retry-image"]')).toBeVisible();
  fail = false;
  await dialog.locator('[data-exercise-action="retry-image"]').click();
  await expectImagesLoaded(gallery);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-exercise-action="retry-image"]')).toBeHidden();
  const activeView = dialog.locator('[data-image-index="1"]');
  await expect(activeView).toBeFocused();
  await expectImagesLoaded(activeView.locator('img'));
});
