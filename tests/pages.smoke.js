import {test, expect} from '@playwright/test';

test('project subpath serves the model, exercise photos, navigation, and attribution', async ({page, request, baseURL}) => {
  const appURL = new URL(baseURL);
  const errors = [];
  const failedRequests = [];
  const unexpectedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', request => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && (url.origin !== appURL.origin || !url.pathname.startsWith(appURL.pathname))) {
      unexpectedRequests.push(request.url());
    }
  });

  async function expectPhoto(image) {
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
    const url = new URL(await image.getAttribute('src'), baseURL);
    expect(url.origin).toBe(appURL.origin);
    expect(url.pathname.startsWith(`${appURL.pathname}assets/exercises/media/`)).toBe(true);
  }

  await page.goto(baseURL);
  await expect(page.locator('.body-stage')).toHaveClass(/is-ready/);
  await expect(page.locator('.anatomy-canvas')).toBeVisible();
  await expect(page.locator('#structure-count')).toHaveText('126 structures');
  await expect(page.locator('[data-muscle-button]')).toHaveCount(18);

  const home = page.getByRole('link', {name: 'Anatomy Atlas home'});
  expect(await home.evaluate(element => element.href)).toBe(baseURL);
  const credits = page.getByRole('link', {name: 'Credits & licence', exact: true});
  const noticeURL = new URL('assets/anatomy/NOTICE.txt', baseURL).href;
  expect(await credits.evaluate(element => element.href)).toBe(noticeURL);
  const notice = await request.get(noticeURL);
  expect(notice.ok()).toBe(true);
  expect(await notice.text()).toContain('Z-Anatomy');

  await page.locator('[data-muscle-button="chest"]').click();
  await expect(page.locator('#exercises-title')).toContainText('Pectorals');
  const card = page.locator('#exercise-panel [data-exercise-id]').first();
  await expect(card).toBeVisible();
  await expectPhoto(card.locator('img').first());
  const licence = page.getByRole('link', {name: 'MIT licence', exact: true});
  const licenceURL = new URL('assets/exercises/LICENSE.txt', baseURL).href;
  expect(await licence.evaluate(element => element.href)).toBe(licenceURL);
  const licenceResponse = await request.get(licenceURL);
  expect(licenceResponse.ok()).toBe(true);
  expect(await licenceResponse.text()).toContain('MIT License');

  await card.click();
  const dialog = page.locator('#exercise-dialog');
  await expect(dialog).toBeVisible();
  const photo = dialog.locator('.exercise-gallery-image');
  await expectPhoto(photo);
  const firstView = await photo.getAttribute('src');
  await dialog.locator('[data-image-index="1"]').click();
  await expect(photo).not.toHaveAttribute('src', firstView);
  await expectPhoto(photo);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.setViewportSize({width: 390, height: 844});
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await card.click();
  await expect(dialog).toBeVisible();
  await expectPhoto(photo);
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  expect(unexpectedRequests).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);
});
