import { expect, test, type Page } from '@playwright/test';
import { settingsSection } from './settings-navigation';

async function workspace(page: Page) {
  let saved = { id: '00000000-0000-4000-8000-000000000077', name: 'Benjamin Franklin', voice: 'marin',
    initialPrompt: 'A fictional historical guide.', accentColor: '#3a66ff', profilePhoto: null,
    textPanel: null as null | { type: 'text'; version: 2 } };
  let writes = 0;
  let starts = 0;
  await page.context().route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', user: { uid: 'workspace-fixture', displayName: 'Creator', role: 'member' } } }));
  await page.route('**/api/billing', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/waveform', route => {
    if (route.request().method() === 'PUT') { saved = { ...saved, ...route.request().postDataJSON() }; writes++; }
    return route.fulfill({ json: { waveform: saved } });
  });
  page.on('request', request => { if (/\/api\/(paid-)?session/.test(new URL(request.url()).pathname) && request.method() === 'POST') starts++; });
  await page.goto('/account');
  await expect(page.getByRole('navigation', { name: 'Waveform settings' })).toBeVisible();
  return { writes: () => writes, starts: () => starts };
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 700 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`workspace preserves drafts and fits ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await workspace(page);
    await page.getByLabel('Waveform name', { exact: true }).fill('My historical guide');
    await page.getByLabel('Voice', { exact: true }).selectOption('meridian');
    await page.getByLabel('Color hex code', { exact: true }).fill('#36a489');
    await settingsSection(page, 'instructions');
    await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Keep this draft while I explore plugins.');
    await expect(page.getByLabel('Waveform name', { exact: true })).toBeHidden();
    await settingsSection(page, 'plugins');
    await expect(page.getByRole('link', { name: 'Manage documents', exact: true })).toHaveAttribute('href', '/account/knowledge');
    await expect(page.getByRole('article', { name: 'Knowledge', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Apply plugin', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Plugin applied', exact: true })).toBeDisabled();
    await page.screenshot({ path: `test-results/workspace-plugins-${viewport.width}.png` });
    await page.getByRole('link', { name: 'Manage documents', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/workspace-knowledge-${viewport.width}.png` });
    await settingsSection(page, 'sharing');
    await expect(page.getByText('Your personal waveform is private.', { exact: true })).toBeVisible();
    await settingsSection(page, 'account');
    await expect(page.getByRole('switch', { name: 'Admin testing', exact: true })).toHaveCount(0);
    await settingsSection(page, 'appearance');
    await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue('My historical guide');
    await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('meridian');
    await expect(page.getByRole('complementary', { name: 'Waveform appearance preview' })).toContainText('My historical guide');
    await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('Keep this draft while I explore plugins.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/workspace-appearance-${viewport.width}.png` });
    const save = page.getByRole('button', { name: 'Save draft', exact: true });
    await save.click();
    await expect(page.locator('.account-status')).toContainText('Saved.');
    expect(requests.writes()).toBe(1);
    expect(requests.starts()).toBe(0);
    await page.reload();
    await settingsSection(page, 'plugins');
    await expect(page.getByRole('button', { name: 'Plugin applied', exact: true })).toBeDisabled();
    await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('Keep this draft while I explore plugins.');
  });
}

test('discard restores the saved draft without a write, and hidden invalid fields receive focus', async ({ page }) => {
  const requests = await workspace(page);
  await page.getByLabel('Waveform name', { exact: true }).fill('Unsaved name');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Unsaved instructions');
  await settingsSection(page, 'plugins');
  await page.getByRole('button', { name: 'Apply plugin', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue('Benjamin Franklin');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('A fictional historical guide.');
  await expect(page.getByRole('button', { name: 'Apply plugin', exact: true })).toBeEnabled();
  expect(requests.writes()).toBe(0);
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('');
  await settingsSection(page, 'plugins');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toBeFocused();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Instructions', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(requests.writes()).toBe(0);
});

test('keyboard navigation reaches section controls and only the visible editor', async ({ page }) => {
  await workspace(page);
  const nav = page.getByRole('navigation', { name: 'Waveform settings' });
  await nav.getByRole('button', { name: 'Instructions', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Waveform name', { exact: true })).toBeHidden();
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('button', { name: 'Plugins', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toBeHidden();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Apply plugin', exact: true })).toBeFocused();
});
