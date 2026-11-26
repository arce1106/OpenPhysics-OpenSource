import { expect, test } from '@playwright/test';

test('guest can download the signed native Android app from the public page', async ({ page }) => {
  const browserErrors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto('/login');

  await expect(page).toHaveTitle(/OpenPhysics/);
  await expect(page.getByRole('heading', { name: 'OpenPhysics' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'OpenPhysics平板端学习界面' })).toBeVisible();
  await page.getByRole('button', { name: '获取 APP', exact: true }).click();
  await expect(page.getByRole('img', { name: 'OpenPhysics安卓应用下载二维码' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '从理解到复盘，一次完成' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载OpenPhysics安卓 APP' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('YuanzhiPhysics-Android.apk');
  expect(await download.failure()).toBeNull();
  expect(browserErrors).toEqual([]);
});

test.describe('download navigation with the PWA installed', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a scanned or pasted APK URL downloads instead of opening the homepage', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (navigator.serviceWorker.controller) return;
      await new Promise<void>(resolve => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
      });
    });

    // Navigation (rather than a link with download=) reproduces a QR scanner or
    // a URL pasted into a browser that already uses our offline app shell.
    const downloadPromise = page.waitForEvent('download');
    await page.goto('/downloads/openphysics-android.apk').catch(error => {
      if (!String(error).match(/ERR_ABORTED|Download is starting/)) throw error;
    });
    const download = await downloadPromise;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(/\.apk$/);
  });
});
