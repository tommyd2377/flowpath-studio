import { expect, test, type Page } from '@playwright/test';
import { settingsSection } from './settings-navigation';

async function workspace(page: Page, safety = false) {
  let saved = { id: '00000000-0000-4000-8000-000000000077', name: 'Benjamin Franklin', voice: 'marin',
    initialPrompt: 'A fictional historical guide.', accentColor: '#3a66ff', profilePhoto: null,
    textPanel: null as null | { type: 'text'; version: 2 } };
  let writes = 0;
  let starts = 0;
  let reviews = 0;
  await page.context().route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', creationSafetyEnabled: safety, user: { uid: 'workspace-fixture', displayName: 'Creator', role: 'member' } } }));
  if (safety) await page.route('**/api/creation-review*', route => {
    const submitting = route.request().method() === 'POST';
    if (submitting) reviews++;
    const candidate = submitting ? route.request().postDataJSON().candidate
      : { name: saved.name, initialPrompt: saved.initialPrompt, profilePhoto: null, textPanel: saved.textPanel, visualDisplay: null };
    const blocked = candidate.initialPrompt.includes('[blocked]');
    return route.fulfill({ json: { enabled: true, review: { reviewId: 'workspace-review', digest: 'synthetic-content',
      policyVersion: 'fixture-only', policyDigest: 'synthetic-policy', status: blocked ? 'blocked' : 'allowed', candidate,
      categories: blocked ? ['extremist-impersonation'] : [] } } });
  });
  await page.route('**/api/billing', route => route.fulfill({ json: { enabled: false } }));
  await page.route('**/api/waveform{,?*}', route => {
    if (route.request().method() === 'PUT') { saved = { ...saved, ...route.request().postDataJSON() }; writes++; }
    return route.fulfill({ json: { waveform: saved } });
  });
  page.on('request', request => { if (/\/api\/(paid-)?session/.test(new URL(request.url()).pathname) && request.method() === 'POST') starts++; });
  await page.goto('/account');
  await expect(page.getByRole('navigation', { name: 'Waveform settings' })).toBeVisible();
  return { writes: () => writes, starts: () => starts, reviews: () => reviews };
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 820, height: 700 }, { width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`save controls appear only for edits and keep review enforcement at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await workspace(page, true);
    const bar = page.locator('.settings-savebar');
    const saved = page.locator('#draft-save-state');
    await expect(saved).toHaveText('Draft saved');
    await expect(bar).toHaveCount(0);
    await page.screenshot({ path: `/private/tmp/flowpath-save-clean-${viewport.width}.png` });
    await settingsSection(page, 'instructions');
    const prompt = page.getByLabel('What should your voice know about itself?', { exact: true });
    await prompt.fill('Keep this revised, benign draft.');
    await expect(bar.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
    await expect(bar).toContainText('Ready to save');
    const box = (await bar.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(viewport.width <= 790 ? 120 : 80);
    for (const name of ['Save draft', 'Discard changes']) {
      const action = (await bar.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(action.height).toBeGreaterThanOrEqual(44);
      expect(action.y + action.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `/private/tmp/flowpath-save-editing-${viewport.width}.png` });
    const reviewed = requests.reviews();
    await bar.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(saved).toBeFocused();
    expect(requests.writes()).toBe(1); expect(requests.reviews()).toBe(reviewed);
    await prompt.fill('[blocked] Synthetic prohibited character.');
    await expect(bar.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'blocked');
    await expect(bar).toContainText('Blocked. Edit the flagged content before saving.');
    await expect(bar.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    await bar.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await expect(bar).toHaveCount(0);
    await expect(saved).toBeFocused();
    await expect(prompt).toHaveValue('Keep this revised, benign draft.');
    expect(requests.writes()).toBe(1); expect(requests.starts()).toBe(0);
  });

  test(`waveform picker has clear spacing and touch targets at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const requests = await workspace(page);
    const picker = page.getByRole('group', { name: 'Your waveforms', exact: true });
    const selection = picker.getByRole('combobox', { name: /Waveform ·/ });
    const create = picker.getByRole('button', { name: 'New waveform', exact: true });
    const navigation = page.getByRole('navigation', { name: 'Waveform settings', exact: true });
    const bounds = (await picker.boundingBox())!;
    for (const control of [selection, create]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThan(bounds.x);
      expect(box.x + box.width).toBeLessThan(bounds.x + bounds.width);
    }
    const selectBox = (await selection.boundingBox())!, createBox = (await create.boundingBox())!;
    if (viewport.width <= 600) expect(createBox.y - selectBox.y - selectBox.height).toBeGreaterThanOrEqual(12);
    else expect(createBox.x - selectBox.x - selectBox.width).toBeGreaterThanOrEqual(16);
    expect((await navigation.boundingBox())!.y - bounds.y - bounds.height).toBeGreaterThanOrEqual(20);
    await selection.focus();
    await expect(selection).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(create).toBeFocused();
    expect(requests.writes()).toBe(0); expect(requests.starts()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/private/tmp/flowpath-picker-${viewport.width}.png` });
  });

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
    await expect(page.getByRole('link', { name: 'Manage documents', exact: true })).toHaveAttribute('href', '/account/knowledge?id=00000000-0000-4000-8000-000000000077');
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

test('pending background review stays compact and cannot save before completion', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await workspace(page, true);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/creation-review*', async route => {
    if (route.request().method() === 'POST') await pending;
    return route.fallback();
  });
  try {
    await settingsSection(page, 'instructions');
    await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Wait for the exact current draft to pass review.');
    const bar = page.locator('.settings-savebar');
    await expect(bar.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'pending');
    await expect(bar).toContainText('Checking…');
    await expect(bar.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
    await expect(bar.getByRole('button', { name: 'Review this version', exact: true })).toHaveCount(0);
    expect((await bar.boundingBox())!.height).toBeLessThanOrEqual(120);
    expect(requests.writes()).toBe(0); expect(requests.starts()).toBe(0);
    await page.screenshot({ path: '/private/tmp/flowpath-save-pending-390.png' });
  } finally { release(); }
  await expect(page.locator('.settings-savebar [data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
});

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

for (const founder of [false, true]) test(`hosted beta explains ${founder ? 'founder ownership' : 'daily free demo'} without obsolete admin limits`, async ({ page }) => {
  await workspace(page);
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', hostedTesterDemo: true,
    user: { uid: 'workspace-fixture', displayName: 'Creator', ...(founder ? { role: 'admin' } : {}) } } }));
  await page.reload(); await settingsSection(page, 'account');
  await expect(page.getByRole('switch', { name: 'Admin testing', exact: true })).toHaveCount(0);
  await expect(page.getByText(founder ? 'Founder access: no personal time limit on your own waveform. The Studio introduction still has a three-minute daily limit.'
    : 'Your private waveform includes three minutes of voice per day during this free beta. Payments are disabled.', { exact: true })).toBeVisible();
});
