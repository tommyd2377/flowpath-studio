import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient');
  });
});

async function saveWaveform(page: Page, owner: 'A' | 'B', name: string, prompt: string) {
  await page.goto('/account');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await expect(page.getByRole('heading', { name: 'My waveform', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading your account' })).toHaveCount(0);
  if (await signOut.isVisible()) await signOut.click();
  await page.getByRole('button', { name: `Use test owner ${owner}`, exact: true }).click();
  await page.getByLabel('Waveform name', { exact: true }).fill(name);
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved. Your instructions will apply to your next conversation.');
  const address = await page.getByRole('link', { name: 'Open waveform', exact: true }).getAttribute('href');
  expect(address).toMatch(/^\/w\/[a-f0-9-]+$/);
  return address!;
}

test('one local test account saves one waveform and recovers it after signing out', async ({ page }) => {
  const name = 'Tom’s private assistant';
  const prompt = 'You are Tom’s assistant. Speak warmly and keep answers concise.';
  const address = await saveWaveform(page, 'A', name, prompt);
  await page.reload();
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue(name);
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(prompt);
  await expect(page.getByRole('link', { name: 'Open waveform', exact: true })).toHaveAttribute('href', address);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/account-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/account-settings-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('Waveform name', { exact: true }).fill('Tom’s updated assistant');
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(page.getByRole('link', { name: 'Open waveform', exact: true })).toHaveAttribute('href', address);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Use test owner A', exact: true })).toBeVisible();
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveCount(0);
  await page.goto(address);
  await expect(page.getByRole('status')).toContainText('Sign in to open your private waveform.');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Go to my account', exact: true }).click();
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue('Tom’s updated assistant');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(prompt);
  await page.getByRole('link', { name: 'Open waveform', exact: true }).click();
  await expect(page.locator('.voice-navigation')).toContainText('Tom’s updated assistant');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Live voice is paused for this local preview.');
});

test('another account cannot load the owner’s settings or private waveform', async ({ page }) => {
  const addressA = await saveWaveform(page, 'A', 'Owner A private name', 'Owner A private instructions.');
  const addressB = await saveWaveform(page, 'B', 'Owner B assistant', 'Owner B instructions.');
  expect(addressA).not.toBe(addressB);
  const denied = await page.request.get(`/api/waveform?id=${addressA.slice(3)}`);
  expect(denied.status()).toBe(404);
  const deniedBody = await denied.text();
  expect(deniedBody).not.toContain('Owner A private');
  await page.goto(addressA);
  await expect(page.getByRole('status')).toContainText('This waveform is private.');
  await expect(page.getByText('Owner A private name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await page.goto(addressB);
  await expect(page.locator('.voice-navigation')).toContainText('Owner B assistant');
});

test('switching accounts in another tab clears the old private view and settings', async ({ page, context }) => {
  const address = await saveWaveform(page, 'A', 'Private owner A', 'Only owner A’s instructions.');
  const settings = await context.newPage();
  await settings.goto('/account');
  await expect(settings.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('Only owner A’s instructions.');
  await page.goto(address);
  await expect(page.locator('.voice-navigation')).toContainText('Private owner A');
  const otherTab = await context.newPage();
  await otherTab.goto('/account');
  await otherTab.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Sign in to open your private waveform.');
  await expect(settings.getByRole('button', { name: 'Use test owner B', exact: true })).toBeVisible();
  await otherTab.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('This waveform is private.');
  await expect(settings.getByText('Signed in as Test owner B', { exact: true })).toBeVisible();
  await expect(settings.getByLabel('What should your voice know about itself?', { exact: true })).not.toHaveValue('Only owner A’s instructions.');
  await expect(page.locator('.voice-navigation')).toHaveCount(0);
  await settings.close(); await otherTab.close();
});

test('a failed save keeps the edited prompt available for retry', async ({ page }) => {
  await saveWaveform(page, 'A', 'Retry assistant', 'A saved starting prompt.');
  await page.route('**/api/waveform', route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, json: { error: 'Your waveform could not be saved. Please try again.' } }) : route.continue());
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('These are my unsaved changes.');
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your waveform could not be saved.');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('These are my unsaved changes.');
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeEnabled();
});
