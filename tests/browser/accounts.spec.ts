import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => {
    const hostname = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(hostname) ? route.continue() : route.abort('blockedbyclient');
  });
});

async function syntheticPhoto(page: Page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ba54d2'; context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'synthetic-profile.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') };
}

async function uploadSyntheticPhoto(page: Page) {
  await page.getByLabel('Profile photo', { exact: true }).setInputFiles(await syntheticPhoto(page));
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
}

async function saveWaveform(page: Page, owner: 'A' | 'B', name: string, prompt: string, voice = 'marin') {
  await page.goto('/account');
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  await expect(page.getByRole('heading', { name: 'My waveform', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading your account' })).toHaveCount(0);
  if (await signOut.isVisible()) await signOut.click();
  await page.getByRole('button', { name: `Use test owner ${owner}`, exact: true }).click();
  await page.getByLabel('Waveform name', { exact: true }).fill(name);
  await page.getByLabel('Voice', { exact: true }).selectOption(voice);
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill(prompt);
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved. Your settings will apply to your next conversation.');
  const address = await page.getByRole('link', { name: 'Open waveform', exact: true }).getAttribute('href');
  expect(address).toMatch(/^\/w\/[a-f0-9-]+$/);
  return address!;
}

test('one local test account saves one waveform and recovers it after signing out', async ({ page }) => {
  const name = 'Tom’s private assistant';
  const prompt = 'You are Tom’s assistant. Speak warmly and keep answers concise.';
  const address = await saveWaveform(page, 'A', name, prompt, 'meridian');
  await expect(page.getByLabel('Waveform color', { exact: true })).toHaveAttribute('type', 'color');
  await page.getByLabel('Color hex code', { exact: true }).fill('#5B8DEF');
  await uploadSyntheticPhoto(page);
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  const savedPhoto = await page.getByRole('img', { name: 'Profile photo preview', exact: true }).getAttribute('src');
  expect(savedPhoto).toMatch(/^data:image\/webp;base64,/);
  await page.reload();
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue(name);
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('meridian');
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#5b8def');
  await expect(page.getByLabel('Waveform color', { exact: true })).toHaveValue('#5b8def');
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', savedPhoto!);
  await expect(page.locator('#voice-help')).toContainText('North American English');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(prompt);
  await expect(page.getByRole('link', { name: 'Open waveform', exact: true })).toHaveAttribute('href', address);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: 'test-results/account-settings-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/account-settings-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('Waveform name', { exact: true }).fill('Tom’s updated assistant');
  await page.getByLabel('Voice', { exact: true }).selectOption('marin');
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
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('marin');
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#5b8def');
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', savedPhoto!);
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(prompt);
  await page.getByRole('link', { name: 'Open waveform', exact: true }).click();
  await expect(page.locator('.voice-navigation')).toContainText('Tom’s updated assistant');
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Live voice is paused for this local preview.');
});

test('another account cannot load the owner’s settings or private waveform', async ({ page }) => {
  const addressA = await saveWaveform(page, 'A', 'Owner A private name', 'Owner A private instructions.');
  await page.getByLabel('Color hex code', { exact: true }).fill('#7e30c6');
  await uploadSyntheticPhoto(page);
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  const privatePhoto = await page.getByRole('img', { name: 'Profile photo preview', exact: true }).getAttribute('src');
  const addressB = await saveWaveform(page, 'B', 'Owner B assistant', 'Owner B instructions.');
  expect(addressA).not.toBe(addressB);
  const denied = await page.request.get(`/api/waveform?id=${addressA.slice(3)}`);
  expect(denied.status()).toBe(404);
  const deniedBody = await denied.text();
  expect(deniedBody).not.toContain('Owner A private');
  expect(deniedBody).not.toContain('#7e30c6');
  expect(deniedBody).not.toContain(privatePhoto!);
  await page.goto(addressA);
  await expect(page.getByRole('status')).toContainText('This waveform is private.');
  await expect(page.getByText('Owner A private name', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toHaveCount(0);
  await expect(page.locator('img')).toHaveCount(0);
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
  await page.getByLabel('Voice', { exact: true }).selectOption('meridian');
  await page.getByLabel('Color hex code', { exact: true }).fill('#6f84e8');
  await uploadSyntheticPhoto(page);
  const unsavedPhoto = await page.getByRole('img', { name: 'Profile photo preview', exact: true }).getAttribute('src');
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your waveform could not be saved.');
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('These are my unsaved changes.');
  await expect(page.getByLabel('Voice', { exact: true })).toHaveValue('meridian');
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#6f84e8');
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', unsavedPhoto!);
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeEnabled();
});

test('an invalid color keeps the draft and removing a photo persists without changing the waveform address', async ({ page }) => {
  const address = await saveWaveform(page, 'A', 'Appearance settings', 'A synthetic prompt for appearance tests.');
  await page.getByLabel('Color hex code', { exact: true }).fill('36a489');
  await uploadSyntheticPhoto(page);
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#36a489');
  const savedPhoto = await page.getByRole('img', { name: 'Profile photo preview', exact: true }).getAttribute('src');
  await page.getByLabel('Waveform name', { exact: true }).fill('Unsaved appearance name');
  await page.getByLabel('Color hex code', { exact: true }).fill('#nope');
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue('Unsaved appearance name');
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#nope');
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', savedPhoto!);
  const persisted = await page.request.get('/api/waveform');
  const { waveform } = await persisted.json();
  expect(waveform.name).toBe('Appearance settings');
  expect(waveform.accentColor).toBe('#36a489');
  expect(waveform.profilePhoto).toBe(savedPhoto);
  await page.getByLabel('Color hex code', { exact: true }).fill('#36a489');
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Color hex code', { exact: true })).toHaveValue('#36a489');
  await expect(page.getByRole('link', { name: 'Open waveform', exact: true })).toHaveAttribute('href', address);
});

test('an invalid photo keeps the previous preview and settings available', async ({ page }) => {
  await saveWaveform(page, 'B', 'Photo validation', 'A synthetic prompt for photo validation.');
  await uploadSyntheticPhoto(page);
  const previousPhoto = await page.getByRole('img', { name: 'Profile photo preview', exact: true }).getAttribute('src');
  await page.getByLabel('Profile photo', { exact: true }).setInputFiles({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('Not image pixels') });
  await expect(page.getByRole('main').getByRole('alert')).toContainText('That photo could not be opened. Try another image.');
  await expect(page.getByRole('img', { name: 'Profile photo preview', exact: true })).toHaveAttribute('src', previousPhoto!);
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveValue('Photo validation');
});

test('long prompt drafts stay intact past 8,000 characters and saving the full allowed prompt preserves its ending', async ({ page }) => {
  const address = await saveWaveform(page, 'A', 'Long prompt fixture', 'L'.repeat(4000));
  await page.reload();
  const prompt = page.getByLabel('What should your voice know about itself?', { exact: true });
  await expect(page.getByText('This saved prompt reaches the previous 4,000-character limit.', { exact: false })).toBeVisible();
  await expect(prompt).not.toHaveAttribute('maxlength', /.+/);
  const tooLong = `${'x'.repeat(8493)}THE END`;
  await prompt.fill(tooLong);
  await expect(prompt).toHaveValue(tooLong);
  await expect(prompt).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#prompt-count')).toHaveText('8,500 / 8,000 characters');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your full text is preserved');
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeDisabled();
  const complete = `${'y'.repeat(7993)}THE END`;
  await prompt.fill(complete);
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(prompt).toHaveValue(complete);
  await expect(page.locator('#prompt-count')).toHaveText('8,000 / 8,000 characters');
  await expect(page.getByRole('link', { name: 'Open waveform', exact: true })).toHaveAttribute('href', address);
  await expect(page.getByText('This saved prompt reaches the previous 4,000-character limit.', { exact: false })).toHaveCount(0);
});

test('admin-only testing switch saves on and off across reloads while regular accounts never see it', async ({ page }) => {
  await saveWaveform(page, 'A', 'Admin settings fixture', 'Keep the saved persona intact.');
  await expect(page.getByRole('switch', { name: 'Admin testing', exact: true })).toHaveCount(0);
  let waveform = (await (await page.request.get('/api/waveform')).json()).waveform;
  let admin = true;
  await page.route('**/api/account', async route => {
    const response = await route.fetch();
    const account = await response.json();
    return route.fulfill({ json: { ...account, user: { ...account.user, ...(admin ? { role: 'admin' } : {}) } } });
  });
  await page.route('**/api/waveform', async route => {
    if (route.request().method() === 'PUT') waveform = { ...waveform, ...route.request().postDataJSON() };
    await route.fulfill({ json: { waveform } });
  });
  await page.reload();
  const mode = page.getByRole('switch', { name: 'Admin testing', exact: true });
  await expect(mode).not.toBeChecked();
  await mode.check();
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(mode).toBeChecked();
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue('Keep the saved persona intact.');
  await mode.uncheck();
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Saved.');
  await page.reload();
  await expect(mode).not.toBeChecked();
  admin = false;
  await page.reload();
  await expect(mode).toHaveCount(0);
});
