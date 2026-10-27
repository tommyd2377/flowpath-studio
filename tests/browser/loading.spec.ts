import { settingsSection } from './settings-navigation';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
});

test('startup shows the full logo before hydration and releases the page without a minimum wait', async ({ page }) => {
  let resume!: () => void;
  const scripts = new Promise<void>(resolve => { resume = resolve; });
  await page.route('**/_next/static/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('.js')) await scripts;
    await route.continue();
  });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const loader = page.locator('.app-startup .brand-loader--screen');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('Loading FlowPath…');
    await expect(loader.locator('img')).toHaveAttribute('src', /flowpath-logo-full/);
    await expect(page.locator('.app-content')).toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/loader-startup.png' });
  } finally { resume(); }
  await expect(page.locator('.app-startup')).toHaveCount(0);
  await expect(page.locator('.app-content')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
});

test('a page fetch uses the full logo, respects reduced motion, and clears on failure', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  let resume!: () => void;
  const response = new Promise<void>(resolve => { resume = resolve; });
  await page.route('**/api/waveform?*', async route => {
    await response;
    await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
  });
  try {
    await page.goto('/w/00000000-0000-4000-8000-000000000077');
    const loader = page.locator('.app-content .brand-loader--screen');
    await expect(loader).toBeVisible();
    await expect(loader).toContainText('Loading your waveform…');
    await expect(loader.locator('img')).toHaveCSS('animation-name', 'none');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/loader-page-mobile.png' });
  } finally { resume(); }
  await expect(page.locator('.brand-loader')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Your waveform could not be loaded.');
  await expect(page.getByRole('link', { name: 'Go to my account', exact: true })).toBeVisible();
});

test('only the saving button pulses and a failed save preserves the edited form', async ({ page }) => {
  const waveform = { id: '00000000-0000-4000-8000-000000000077', name: 'Loading fixture', voice: 'marin',
    initialPrompt: 'Synthetic saved instructions.', accentColor: '#3a66ff', profilePhoto: null };
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'local', user: { uid: 'loader-fixture', displayName: 'Test owner', role: 'member' } } }));
  await page.route('**/api/billing', route => route.fulfill({ json: { enabled: false } }));
  let resume!: () => void;
  const save = new Promise<void>(resolve => { resume = resolve; });
  await page.route('**/api/waveform', async route => {
    if (route.request().method() === 'PUT') {
      await save;
      await route.fulfill({ status: 503, json: { error: 'Save unavailable. Try again.' } });
    } else await route.fulfill({ json: { waveform } });
  });
  await page.goto('/account');
  const prompt = page.getByLabel('What should your voice know about itself?', { exact: true });
  await settingsSection(page, 'instructions');
  await prompt.fill('Keep these unsaved instructions.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  try {
    const saving = page.getByRole('button', { name: 'Saving…', exact: true });
    await expect(saving).toHaveAttribute('aria-busy', 'true');
    await expect(saving).toBeDisabled();
    await expect(saving.locator('.brand-loader--inline img')).toHaveAttribute('src', /flowpath-icon-square/);
    await expect(saving.locator('img')).toHaveCSS('animation-duration', '1s');
    await expect(page.getByRole('button', { name: 'Sign out', exact: true }).locator('.brand-loader')).toHaveCount(0);
    await expect(page.locator('.brand-loader--screen')).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await saving.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/loader-saving-mobile.png' });
  } finally { resume(); }
  await expect(page.locator('.account-error')).toContainText('Save unavailable.');
  await expect(prompt).toHaveValue('Keep these unsaved instructions.');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await expect(page.locator('.brand-loader')).toHaveCount(0);
});
