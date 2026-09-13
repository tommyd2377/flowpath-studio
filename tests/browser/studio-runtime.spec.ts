import { test, expect } from '@playwright/test';

for (const saved of ['light', 'dark', 'corrupt', 'blocked']) {
  test(`Studio theme and native importer survive reload and client navigation (${saved})`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(value => {
      if (value === 'blocked') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Fixture storage unavailable', 'SecurityError'); } });
      else if (localStorage.getItem('voice-studio-theme') === null) localStorage.setItem('voice-studio-theme', value);
    }, saved);
    await page.goto('/');
    const initial = saved === 'light' ? 'light' : 'dark';
    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await expect(toggle).toHaveAttribute('aria-checked', String(initial === 'dark'));
    await expect(page.locator('html')).toHaveAttribute('data-theme', initial);
    await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('button', { name: 'Knowledge', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Import a website' })).toBeVisible();
    await expect(page.locator('.website-import .lucide-globe')).toBeVisible();
    await toggle.click();
    const changed = initial === 'dark' ? 'light' : 'dark';
    await expect(page.locator('html')).toHaveAttribute('data-theme', changed);
    await page.reload();
    await expect(toggle).toHaveAttribute('aria-checked', String((saved === 'blocked' ? 'dark' : changed) === 'dark'));
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await page.getByRole('link', { name: 'Connect Firebase', exact: true }).click();
    await page.getByRole('link', { name: 'Open the local demo', exact: true }).click();
    await expect(toggle).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.locator('script[src="/studio-theme.js"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open issues overlay', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`theme-${saved}.png`) });
    expect(errors).toEqual([]);
  });
}
