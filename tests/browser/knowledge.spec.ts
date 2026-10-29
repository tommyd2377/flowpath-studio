import { settingsSection } from './settings-navigation';
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});
async function save(page: Page, owner: 'A' | 'B') {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'My waveform', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Loading your account' })).toHaveCount(0);
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true });
  if (await signOut.isVisible()) await signOut.click();
  await page.getByRole('button', { name: `Use test owner ${owner}`, exact: true }).click();
  await settingsSection(page, 'appearance');
  await page.getByLabel('Waveform name', { exact: true }).fill(`Knowledge fixture ${owner}`);
  await settingsSection(page, 'instructions');
  await page.getByLabel('What should your voice know about itself?', { exact: true }).fill('Be a helpful document guide.');
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Saved.');
  await settingsSection(page, 'plugins');
  await page.getByRole('link', { name: 'Manage documents', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible();
}

test('creator uploads, prepares, previews, disables and removes private documents through the actual routes', async ({ page, browser }) => {
  await save(page, 'A');
  await page.getByLabel('Add a document', { exact: true }).setInputFiles({ name: 'museum-guide.txt', mimeType: 'text/plain', buffer: Buffer.from('The synthetic museum opens at nine on Monday.') });
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'museum-guide.txt', exact: true })).toBeVisible();
  const selected = page.getByRole('checkbox', { name: 'Use in my waveform', exact: true });
  await expect(selected).toBeChecked({ timeout: 20_000 });
  await page.getByLabel('What would you like to find?', { exact: true }).fill('When does the museum open?');
  await page.getByRole('button', { name: 'Find passages', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Search results', exact: true })).toContainText('opens at nine');
  await expect(page.getByRole('region', { name: 'Search results', exact: true })).toContainText('museum-guide.txt');
  const visible = await page.locator('main').innerText();
  expect(visible).not.toMatch(/fixture-store|fileId|vector_store/);
  const view = await (await page.request.get('/api/knowledge')).json();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:3225' });
  try {
    expect((await other.request.get('/api/knowledge')).status()).toBe(401);
    const otherPage = await other.newPage(); await save(otherPage, 'B');
    expect((await (await other.request.get('/api/knowledge')).json()).documents).toEqual([]);
    expect((await other.request.post('/api/knowledge/search', { headers: { Origin: 'http://127.0.0.1:3225' }, data: { waveformId: view.waveformId, query: 'museum' } })).status()).toBe(400);
  } finally { await other.close(); }
  await selected.uncheck(); await expect(selected).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Find passages', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remove museum-guide.txt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'museum-guide.txt', exact: true })).toHaveCount(0);
  await expect(page.locator('.knowledge-empty')).toContainText('starts here');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) test(`hosted Knowledge upload explains retention and requires adult confirmation at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport);
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let uploads = 0;
  const view = { waveformId: id, revision: 0, documents: [] as object[], available: true, requiresAdultConsent: true,
    storage: { estimatedMonthlyMicroUsd: 4_200_000, budgetMicroUsd: 5_000_000, uploadCapacityAvailable: false } };
  await page.route('**/api/knowledge', async route => {
    if (route.request().method() === 'POST') {
      uploads++; expect(route.request().headers()['x-flowpath-adult']).toBe('1');
      view.revision++;
      view.documents = [{ id, filename: 'reference.txt', bytes: 100, status: 'ready', selected: true, createdAt: 1, message: 'Safety review passed.' }];
    }
    return route.fulfill({ json: view });
  });
  await page.goto('/account/knowledge');
  await expect(page.getByText(/Files stay until you remove them/)).toBeVisible();
  await expect(page.getByText(/Storage is approaching its budget/)).toBeVisible();
  const adult = page.getByRole('checkbox', { name: 'I am at least 18 and have permission to upload these documents.', exact: true });
  await page.getByLabel('Add a document', { exact: true }).setInputFiles({ name: 'reference.txt', mimeType: 'text/plain', buffer: Buffer.from('A synthetic adult-owned reference.') });
  await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  expect(uploads).toBe(0); await expect(adult).toBeFocused();
  await adult.check(); await page.getByRole('button', { name: 'Upload document', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'reference.txt', exact: true })).toBeVisible();
  expect(uploads).toBe(1);
  expect(await adult.evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
