import { expect, test } from '@playwright/test';

test('guest can reach login without exposing disabled registration', async ({ page }) => {
  const browserErrors: string[] = [];
  const registrationRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/auth/') && request.method() !== 'GET') registrationRequests.push(request.url());
  });
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.route('**/api/student/auth/capabilities', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ self_registration_enabled: false }),
  }));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: '学生登录', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '登录' }).first().click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '手机验证码登录', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '登录 / 注册', exact: true })).toHaveCount(0);
  expect(registrationRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
