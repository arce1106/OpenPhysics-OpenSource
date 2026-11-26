import { expect, test } from '@playwright/test';

for (const width of [1440, 390]) {
  test(`saved credentials keep a white input surface at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/student/auth/capabilities', route => route.fulfill({
      json: { self_registration_enabled: true, sms_login_enabled: true },
    }));
    await page.goto('/login');
    await page.getByLabel('账号', { exact: true }).fill('autofill-test');
    await page.getByLabel('密码', { exact: true }).fill('synthetic-password');
    // Force the browser's autofill pseudo-state without using stored credentials.
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument');
    for (const id of ['login-account', 'login-password']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#' + id });
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['autofill'] });
      const input = page.locator('#' + id);
      expect(await input.evaluate(element => element.matches(':autofill'))).toBe(true);
      for (const focused of [false, true]) {
        if (focused) await input.focus();
        else await input.blur();
        await expect(input).toHaveCSS('box-shadow', 'rgb(255, 255, 255) 0px 0px 0px 1000px inset');
        await expect(input).toHaveCSS('-webkit-text-fill-color', 'rgb(26, 29, 35)');
      }
    }
    await page.getByLabel('密码', { exact: true }).blur();
    await expect(page.getByRole('button', { name: '登录', exact: true })).toBeEnabled();
    await expect(page.getByLabel('账号', { exact: true })).toHaveAttribute('autocomplete', 'username');
    await expect(page.getByLabel('密码', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
    await page.locator('form').screenshot({ path: `/tmp/openphysics-login-autofill-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await cdp.detach();
  });
}
