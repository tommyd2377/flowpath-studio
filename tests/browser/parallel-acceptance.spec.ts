import { settingsSection } from './settings-navigation';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort('blockedbyclient'));
});
async function openHistoryCase(page: import('@playwright/test').Page, name: string) {
  const queue = page.getByRole('region', { name: 'Creation review queue' });
  const history = queue.locator('summary').filter({ hasText: /^Review history/ });
  await history.click();
  const summary = queue.locator('summary').filter({ hasText: `${name} ·` });
  const group = summary.locator('..');
  await summary.click();
  await group.getByRole('button', { name: 'View version 1', exact: true }).click();
}
test('homepage completes loading its optimized logo in the clean fixture server', async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.locator('.wordmark img').evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
});
test('background approval is reused on save; available Text Box stays absent before a request', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  let reviews = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/creation-review' && request.method() === 'POST') reviews++; });
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Safe panel');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic instructions.');
  await settingsSection(page, 'plugins');
  await page.getByRole('button', { name: 'Install Text Box', exact: true }).click();
  await expect(page.getByLabel('Text below the waveform (optional)', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  const before = reviews;
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('#draft-save-state')).toHaveText('Draft saved');
  expect(reviews).toBe(before);
  const address = await page.getByRole('link', { name: 'Preview draft', exact: true }).getAttribute('href');
  await page.goto(address!);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Text Box content', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Copy text', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'News', exact: true })).toHaveCount(0);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.goto(address!);
  await expect(page.getByRole('region', { name: 'Text Box content', exact: true })).toHaveCount(0);
});
test('blocked content cannot save through the UI or direct API, including after material edits', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('[fixture:blocked]');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic blocked review.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'blocked');
  await expect(page.locator('[data-creation-safety]')).toContainText('Nazi or extremist character');
  await page.locator('[data-creation-safety] summary').click();
  await expect(page.locator('[data-creation-safety]')).toContainText('Nazi personas and extremist leaders or roleplay are prohibited.');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  const denied = await page.request.put('/api/waveform', { headers: { origin: 'http://127.0.0.1:3225' }, data: { name: '[fixture:blocked]', initialPrompt: 'Synthetic blocked review.' } });
  expect(denied.status()).toBe(409);
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Allowed changed name');
  await expect(page.locator('[data-creation-safety]')).not.toContainText('extremist-impersonation');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
});
test('automatic blocks appear in the admin queue without decision controls', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Blocked queue visibility [fixture:blocked]');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic blocked submission for queue inspection.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'blocked');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  await settingsSection(page, 'account');
  await openHistoryCase(page, 'Blocked queue visibility [fixture:blocked]');
  const entry = page.locator('.creation-review-queue article').filter({ has: page.getByRole('heading', { name: 'Blocked queue visibility [fixture:blocked]', exact: true }) });
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('This version was automatically blocked.');
  await expect(entry).toContainText('Nazi or extremist character');
  await expect(entry.getByRole('button', { name: 'Approve reviewed version', exact: true })).toHaveCount(0);
});

test('manual review queue requires an explicit admin decision for the reviewed version', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('[fixture:manual]');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Synthetic ambiguous content.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'manual-review');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  await settingsSection(page, 'account');
  await expect(page.getByRole('heading', { name: 'Creation review queue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Approve reviewed version', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Approve reviewed version', exact: true })).toHaveCount(0);
  await expect(page.locator('.creation-review-queue').getByText('The reviewed version was approved.')).toBeVisible();
  await expect(page.getByText('Nothing needs a decision.')).toBeVisible();
  await openHistoryCase(page, '[fixture:manual]');
  await page.getByRole('button', { name: 'Reject waveform', exact: true }).click();
  await expect(page.locator('.creation-review-queue').getByText('The reviewed version was rejected.')).toBeVisible();
});

test('one case at a time supports keyboard evidence and advances only after a confirmed decision', async ({ page }) => {
  const portrait = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2V8AAAAASUVORK5CYII=';
  const proof = { ownerUid: 'fixture-owner', reviewId: 'held-case', digest: 'fixture-digest', policyVersion: 'fixture-policy', policyDigest: 'fixture-policy-digest' };
  const held = { ...proof, status: 'manual-review', categories: ['fraud-impersonation'], policyCurrent: true,
    candidate: { name: 'Held fixture', initialPrompt: 'Full synthetic instructions.', profilePhoto: portrait, textPanel: null } };
  const followup = { ...held, reviewId: 'followup-case', status: 'allowed', categories: ['portrait-provenance'],
    candidate: { ...held.candidate, name: 'Follow-up fixture' } };
  const older = { ...held, reviewId: 'older-case', status: 'blocked', policyCurrent: false,
    candidate: { ...held.candidate, name: 'Older blocked fixture' } };
  let records = [older, followup, held];
  let rejectAttempts = 0;
  await page.route('**/api/creation-review/admin', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { reviews: records } });
    expect(route.request().postDataJSON()).toEqual({ ...proof, decision: 'blocked', item: 'portrait' });
    rejectAttempts++;
    if (rejectAttempts === 1) return route.fulfill({ status: 409, json: {} });
    records = [older, followup];
    return route.fulfill({ json: { review: { ...proof, status: 'blocked' } } });
  });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  await settingsSection(page, 'account');
  const queue = page.getByRole('region', { name: 'Creation review queue' });
  const card = queue.getByRole('article');
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('heading', { name: 'Held fixture' })).toBeVisible();
  await expect(card.getByText('Use held')).toBeVisible();
  await expect(card.getByText('Possible identity deception', { exact: true })).toBeVisible();
  await expect(card.getByText('Full synthetic instructions.')).toBeHidden();
  await expect(card.getByRole('img', { name: 'Portrait submitted for review', includeHidden: true })).toBeHidden();
  await card.locator('summary').filter({ hasText: 'View reviewed portrait' }).press('Enter');
  await expect(card.getByRole('img', { name: 'Portrait submitted for review' })).toHaveAttribute('src', portrait);
  await card.locator('summary').filter({ hasText: 'Read full instructions' }).press('Space');
  await expect(card.getByText('Full synthetic instructions.')).toBeVisible();

  await card.getByLabel('Item to reject').selectOption('portrait');
  const reject = card.getByRole('button', { name: 'Reject item', exact: true });
  await reject.press('Enter');
  await expect(queue.getByText(/This review changed/)).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Held fixture' })).toBeVisible();
  await reject.press('Enter');
  await expect(queue.getByText('Nothing needs a decision.')).toBeFocused();
  await expect(card).toHaveCount(0);
  await openHistoryCase(page, 'Follow-up fixture');
  await expect(card.getByRole('heading', { name: 'Follow-up fixture' })).toBeFocused();
  await expect(card.getByText('Use allowed')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Reject waveform' })).toBeVisible();
  await expect(card.getByText('Full synthetic instructions.')).toBeHidden();
});

test('low-risk content saves immediately and the founder can revoke that exact version', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Historical guide [fixture:followup]');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('A safe historical simulation for conversation.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('#draft-save-state')).toHaveText('Draft saved');
  const saved = (await (await page.request.get('/api/waveform')).json()).waveform;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  await settingsSection(page, 'account');
  await openHistoryCase(page, saved.name);
  const entry = page.locator('.creation-review-queue article').filter({ has: page.getByRole('heading', { name: saved.name, exact: true }) });
  await expect(entry).toContainText('This version is usable.');
  await entry.getByRole('button', { name: 'Reject waveform', exact: true }).click();
  await expect(entry).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'revoked');
  await expect(page.locator('.settings-review-notice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toHaveCount(0);
  const denied = await page.request.get(`/api/session?waveformId=${saved.id}`);
  expect(denied.status()).toBe(409);
  expect((await denied.json()).reviewRequired).toBe(true);
  expect((await (await page.request.get('/api/waveform')).json()).waveform).toEqual(saved);
});

test('discarding a blocked draft restores the identical saved approval without changing settings', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Discard draft authority');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Original fictional guide for a discard test.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  const saved = await (await page.request.get('/api/waveform')).json();
  const original = await (await page.request.get('/api/creation-review')).json();
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('[fixture:blocked] Synthetic rejected instructions.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'blocked');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'stale');
  await page.getByRole('button', { name: 'Review this version', exact: true }).click();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  expect((await (await page.request.get('/api/creation-review')).json()).review.reviewId).toBe(original.review.reviewId);
  expect(await (await page.request.get('/api/waveform')).json()).toEqual(saved);
});

test('saved settings load without paid review; a portrait edit is reviewed before save and normalized proof survives reload', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Portrait version check');
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('An original fictional guide.');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  let reviews = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/creation-review' && request.method() === 'POST') reviews++; });
  await page.reload();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  expect(reviews).toBe(0);
  for (const section of ['instructions', 'plugins', 'sharing', 'account', 'appearance'] as const) await settingsSection(page, section);
  expect(reviews).toBe(0);
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 12;
    const context = canvas.getContext('2d')!; context.fillStyle = '#129a99'; context.fillRect(0, 0, 12, 12);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await settingsSection(page, 'appearance');
  await page.getByLabel('Profile photo', { exact: true }).setInputFiles({ name: 'abstract.png', mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') });
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  expect(reviews).toBe(1);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  expect(reviews).toBe(1);
  await page.reload();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  expect(reviews).toBe(1);
});

test('a completed background review refreshes the open founder queue without a refresh click', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test safety admin', exact: true }).click();
  const name = 'Automatic queue refresh [fixture:followup]';
  const prompt = 'Synthetic historical conversation for automatic queue refresh.';
  let release!: () => void;
  let received!: () => void;
  const submitted = new Promise<void>(resolve => { received = resolve; });
  const proceed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/creation-review{,?*}', async route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    if (body?.candidate?.name === name && body.candidate.initialPrompt === prompt) {
      received(); await proceed;
    }
    await route.continue();
  });
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill(name);
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill(prompt);
  await submitted;
  await settingsSection(page, 'account');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'pending');
  release();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  const entry = page.locator('.creation-review-queue article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await openHistoryCase(page, name);
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('This version is usable.');
  await expect(entry).toContainText('Portrait source or permission');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
});

for (const width of [390, 1280]) test(`review explanations remain usable at ${width}px without losing the draft`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner B', exact: true }).click();
  await settingsSection(page, 'appearance');
  const name = `Historical character ${width} [fixture:manual]`;
  const instructions = 'Synthetic ambiguous identity wording for responsive guidance.';
  await page.getByLabel('Waveform name', { exact: true }).fill(name);
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill(instructions);
  const status = page.locator('[data-creation-safety]');
  await expect(status).toHaveAttribute('data-creation-safety', 'manual-review');
  await expect(status).toContainText('Founder review required. This version is on hold.');
  await status.locator('summary').click();
  await expect(status.getByText('Possible identity deception', { exact: true })).toBeVisible();
  await expect(status).toContainText('Historical roleplay can stay in character and answer truthfully');
  await expect(page.locator('.settings-savebar')).toHaveCSS('position', 'static');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const reviewButton = page.getByRole('button', { name: 'Review this version', exact: true });
  await reviewButton.scrollIntoViewIfNeeded();
  await expect(reviewButton).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(instructions);
  await page.screenshot({ path: testInfo.outputPath(`review-explanations-${width}.png`), fullPage: true });
  await status.locator('summary').click();
  await expect(page.locator('.settings-savebar')).toHaveCSS('position', 'sticky');
});

test('a safety rejection on Save clears the displayed approval and preserves the draft without a paid retry', async ({ page }) => {
  await page.goto('/account');
  await page.getByRole('button', { name: 'Use test owner A', exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill('Save authority mismatch');
  await settingsSection(page, 'instructions');
  const prompt = 'Preserve these synthetic draft instructions after a safety rejection.';
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill(prompt);
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  let reviews = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/creation-review' && request.method() === 'POST') reviews++; });
  let reject = true;
  await page.route('**/api/waveform{,?*}', route => {
    if (reject && ['PUT', 'POST'].includes(route.request().method())) return route.fulfill({ status: 409,
      json: { error: 'This exact content needs an allowed safety review before continuing.', reviewRequired: true } });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.settings-savebar [role="alert"]')).toContainText('This exact content needs an allowed safety review');
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'stale');
  await expect(page.locator('[data-creation-safety]')).not.toContainText('passed the safety review');
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled();
  await expect(page.getByLabel('What should your voice know about itself?', { exact: true })).toHaveValue(prompt);
  expect(reviews, 'rejection does not launch a paid review').toBe(0);
  reject = false;
  await page.getByRole('button', { name: 'Review this version', exact: true }).click();
  await expect(page.locator('[data-creation-safety]')).toHaveAttribute('data-creation-safety', 'allowed');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  const saved = (await (await page.request.get('/api/waveform')).json()).waveform;
  expect(saved.initialPrompt).toBe(prompt);
  expect(reviews, 'only the explicit Review requested the existing proof').toBe(1);
});
