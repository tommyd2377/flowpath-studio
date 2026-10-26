import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
});
test('homepage completes loading its optimized logo in the clean fixture server', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('.wordmark img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
});
test('background approval is reused on save; Text Box capability renders and resets after signout', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  let reviews = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/creation-review' && request.method() === 'POST') reviews++; });
  await page.getByLabel('Waveform name', { exact: true }).fill('Safe panel');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic instructions.');
  await page.getByLabel('Plugins', { exact: true }).selectOption('text');
  await page.getByRole('button', { name: 'Apply plugin', exact: true }).click();
  await expect(page.getByLabel('Text below the waveform (optional)', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  const before = reviews;
  await page.getByRole('button', { name: 'Save waveform', exact: true }).click();
  await expect(page.getByText('Saved. Your settings will apply to your next conversation.', { exact: true })).toBeVisible();
  expect(reviews).toBe(before);
  const address = await page.getByRole('link', { name: 'Open waveform', exact: true }).getAttribute('href');
  await page.goto(address!);
  await expect(page.getByRole('region', { name: 'Text Box content', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toBeDisabled();
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(address!);
  await expect(page.getByRole('region', { name: 'Text Box content', exact: true })).toHaveCount(0);
});
test('blocked content cannot save through the UI or direct API, including after material edits', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await page.getByLabel('Waveform name', { exact: true }).fill('[fixture:blocked]');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic blocked review.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'blocked');
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeDisabled();
  const denied = await page.request.put('/api/waveform', { headers: { origin: 'http://127.0.0.1:3225' }, data: { name: '[fixture:blocked]', initialPrompt: 'Synthetic blocked review.' } });
  expect(denied.status()).toBe(409);
  await page.getByLabel('Waveform name', { exact: true }).fill('Allowed changed name');
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeDisabled();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
});
test('manual review queue requires an explicit admin decision for the reviewed version', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await page.getByLabel('Waveform name', { exact: true }).fill('[fixture:manual]');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic ambiguous content.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'manual-review');
  await expect(page.getByRole('button', { name: 'Save waveform', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Creation review queue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve reviewed version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve reviewed version', exact: true })).toHaveCount(0);
});
