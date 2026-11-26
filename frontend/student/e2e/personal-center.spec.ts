import { expect, test, type Page } from '@playwright/test';

const credentials = { username: '演示学习者', masked_phone: null as string | null, has_password: true,
  username_change_limit: 3, username_change_window_days: 365, username_changes_remaining: 3, username_next_change_at: null };
async function prepare(page: Page, phoneRegistered = false, name = '演示学习者') {
  const errors: string[] = [], writes: string[] = [];
  const profile = { id: 'synthetic-profile-test', username: name, display_name: name, status: 'active',
    phone: phoneRegistered ? '19999990001' : null, account_source: phoneRegistered ? 'self' : 'admin', subscription_active: false };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type()) && message.text() !== 'Service Worker registration blocked by Playwright') errors.push(message.text());
  });
  await page.route('**/api/**', route => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().url()); return route.abort();
    }
    return route.fulfill({ json: {} });
  });
  await page.addInitScript(student => {
    localStorage.setItem('openphysics.student_token', 'synthetic-profile-token');
    localStorage.setItem('openphysics.student_profile', JSON.stringify(student));
  }, profile);
  await page.route('**/api/student/auth/me', route => route.fulfill({ json: profile }));
  await page.route('**/api/student/auth/account-credentials', route => route.fulfill({ json: {
    ...credentials, username: name, has_password: !phoneRegistered, masked_phone: phoneRegistered ? '199****0001' : null,
  } }));
  await page.route('**/api/student/auth/captcha', route => route.fulfill({ json: {
    challenge_id: 'synthetic-captcha', image_base64: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="48"><text x="10" y="32">ABCD</text></svg>'),
  } }));
  return { errors, writes };
}

for (const width of [1440, 1024, 768, 390, 320]) test(`personal center and name menu at ${width}px`, async ({ page }) => {
  const { errors, writes } = await prepare(page);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/profile');
  await expect(page).toHaveTitle(/OpenPhysics/);
  await expect(page.getByRole('heading', { name: '个人中心', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '修改用户名', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: '演示学习者', exact: true });
  await expect(trigger).toBeVisible();
  await expect(page.locator('.student-account-chevron')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '退出', exact: true })).toHaveCount(0);
  await expect(page.locator('.navbar').getByRole('link', { name: '账号安全' })).toHaveCount(0);
  await trigger.click();
  const menu = page.getByRole('group', { name: '账户选项' });
  await expect(menu.getByRole('link', { name: '个人中心' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '退出' })).toBeVisible();
  const box = await menu.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= width).toBeTruthy();
  await page.screenshot({ path: `/tmp/openphysics-personal-center-menu-${width}.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await expect(menu).toHaveCount(0);
  await trigger.click();
  // The 320px menu can cover the heading; click the exposed page gutter.
  await page.locator('.personal-center-page').click({ position: { x: 2, y: 2 } });
  await expect(menu).toHaveCount(0);
  if (width <= 768) {
    await page.getByRole('button', { name: '菜单', exact: true }).click();
    await expect(page.getByRole('link', { name: '同步学习', exact: true })).toBeVisible();
    await trigger.click();
    await menu.getByRole('link', { name: '个人中心' }).click();
    await expect(page.locator('.navbar')).not.toHaveClass(/menu-open/);
  }
  await page.getByRole('button', { name: '修改用户名', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByLabel('新用户名', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByLabel('原密码', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('button', { name: '绑定手机号', exact: true })).toHaveCount(0);
  await expect(page.getByText('正在读取账号设置…', { exact: true })).toHaveCount(0);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/openphysics-personal-center-${width}.png`, fullPage: true });
  await trigger.click(); await menu.getByRole('button', { name: '退出' }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('openphysics.student_token'))).toBeNull();
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('long account names do not cover navigation or dropdown controls on narrow screens', async ({ page }) => {
  const name = '学校账号名称'.repeat(20);
  const { errors } = await prepare(page, false, name);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: '修改用户名', exact: true })).toBeVisible();
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('group', { name: '账户选项' }).getByRole('link', { name: '个人中心' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/openphysics-personal-center-long-name-320.png', fullPage: true });
  expect(errors).toEqual([]);
});
