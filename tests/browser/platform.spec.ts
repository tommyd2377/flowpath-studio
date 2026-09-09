import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { KnowledgeCatalog, PresentationPlan } from '@thevoice/platform-ui/contracts';
import { textPdf } from '../knowledge-fixtures';

const slug = `platform-browser-${Date.now()}`;
let siteId = '';
let originalSnapshot = '';
const visitorPosts: string[] = [];
let externalRequests: string[] = [];

async function screenshot(page: Page, path: string) {
  await page.waitForFunction(() => !document.querySelector('.platform-explorer [inert]')
    && [...document.querySelectorAll('.platform-slot')].every(element => Number(getComputedStyle(element).opacity) >= 0.999)
    && document.getAnimations().every(animation => animation.effect?.getComputedTiming().iterations === Infinity || animation.playState !== 'running'));
  await page.screenshot({ path, fullPage: true });
}

async function isolate(context: BrowserContext) {
  await context.route(/^https?:\/\//, route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:3225') return route.continue();
    externalRequests.push(`${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    const target = window as typeof window & { __microphoneAttempts: number };
    target.__microphoneAttempts = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      target.__microphoneAttempts++;
      throw new Error('Microphone access is disabled in this offline browser fixture.');
    };
  });
  context.on('request', request => {
    if (request.method() === 'POST' && /^\/api\/visitor\/[^/]+$/.test(new URL(request.url()).pathname)) visitorPosts.push(request.url());
  });
}

async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
  if (siteId) {
    const picker = page.getByRole('combobox', { name: 'Current site', exact: true });
    if (await picker.inputValue() !== siteId) {
      const changed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/sites/${siteId}` && response.request().method() === 'GET');
      await picker.selectOption(siteId); const response = await changed;
      expect(response.ok()).toBeTruthy();
      await expect(page.locator('.breadcrumbs strong')).toHaveText((await response.json()).site.draft.name);
    }
    await expect(picker).toHaveValue(siteId); await expect(picker).toBeEnabled();
  }
}

async function panel(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name, exact: true }).click();
}

async function knowledgeAction(page: Page, name: string) {
  const response = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}/knowledge`) && response.request().method() === 'POST');
  await page.getByRole('button', { name, exact: true }).click();
  const result = await response;
  const body = await result.json();
  expect(result.ok(), JSON.stringify(body)).toBeTruthy();
  return body;
}

async function currentSite(page: Page) {
  const response = await page.request.get(`/api/sites/${siteId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).site;
}

async function publicCatalog(page: Page): Promise<KnowledgeCatalog> {
  const site = await currentSite(page);
  const response = await page.request.get(`/api/sites/${siteId}/knowledge?revisionId=${site.published.knowledgeRevisionId}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).catalog;
}

async function manualProof(page: Page, firstName: string, secondName: string) {
  const explorer = page.locator('.platform-explorer');
  const before = visitorPosts.length;
  await explorer.getByRole('spinbutton', { name: /Price/ }).fill('50');
  await expect(explorer.locator('.platform-item')).toHaveCount(2);
  await explorer.getByRole('button', { name: `Select ${firstName} for comparison`, exact: true }).click();
  await explorer.getByRole('button', { name: `Select ${secondName} for comparison`, exact: true }).click();
  await explorer.getByRole('button', { name: 'Compare selections', exact: true }).click();
  await expect(explorer.getByRole('region', { name: 'Compare published attributes' })).toBeVisible();
  await expect(explorer.getByRole('row', { name: /Price/ })).toContainText('$39.00');
  await explorer.getByRole('table').getByRole('button', { name: firstName, exact: true }).click();
  await expect(explorer.getByRole('region', { name: `Details of ${firstName}`, exact: true })).toBeVisible();
  await explorer.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(explorer.getByRole('region', { name: 'Compare published attributes' })).toBeVisible();
  await explorer.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(explorer.locator('.platform-item')).toHaveCount(2);
  await expect(explorer.getByRole('region', { name: 'Selected for comparison' })).toContainText('2/6');
  expect(visitorPosts.length).toBe(before);
}

test.describe.serial('offline publisher-to-visitor proof', () => {
  test.beforeEach(async ({ context }) => { externalRequests = []; await isolate(context); });
  test.afterEach(async ({ page }) => {
    expect(externalRequests, 'The browser must not attempt requests to external hosts.').toEqual([]);
    expect(await page.evaluate(() => (window as typeof window & { __microphoneAttempts?: number }).__microphoneAttempts ?? 0), 'The browser must not attempt microphone access.').toBe(0);
  });

  test('real CSV ingestion, direct and conversational correction, approval and public manual exploration', async ({ page }, info) => {
    await page.goto('/');
    const create = page.getByRole('button', { name: 'Create a site', exact: true });
    if (await create.isVisible()) await create.click();
    else await page.getByRole('button', { name: 'Create your first site', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Site name', { exact: true }).fill('Offline Catalog Proof');
    await dialog.getByLabel(/^Site address/).fill(slug);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sites' && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create site', exact: true }).click();
    const creation = await created;
    expect(creation.ok()).toBeTruthy();
    siteId = (await creation.json()).site.id;
    await panel(page, 'Content');
    await expect(page.getByLabel('How visitors interact')).toHaveValue('voice');
    await panel(page, 'Files');
    const uploaded = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}/files`) && response.request().method() === 'POST');
    await page.getByLabel('Upload source files', { exact: true }).setInputFiles(resolve('fixtures/source-packs/tequila.csv'));
    expect((await uploaded).ok()).toBeTruthy();
    await panel(page, 'Knowledge');
    await knowledgeAction(page, 'Interpret source');
    const proposal = page.getByRole('region', { name: 'Knowledge proposal' });
    await expect(proposal.getByRole('heading', { name: 'Review the interpretation' })).toBeVisible();
    const first = proposal.locator('.knowledge-item').filter({ has: page.locator('summary', { hasText: 'Example Blanco' }) });
    await first.locator(':scope > summary').click();
    await first.getByLabel('Name', { exact: true }).fill('Example Blanco Reviewed');
    await first.getByRole('spinbutton', { name: /Price/ }).fill('39');
    await knowledgeAction(page, 'Save corrections');
    await proposal.getByLabel('Correct the interpretation').fill('Rename "Example Reposado" to "Example Reposado Selected"');
    await knowledgeAction(page, 'Propose correction');
    await expect(proposal.locator('.knowledge-item > summary', { hasText: 'Example Reposado Selected' })).toBeVisible();
    await screenshot(page, info.outputPath('publisher-correction.png'));
    await knowledgeAction(page, 'Apply to draft');
    await expect(page.getByRole('region', { name: 'Website preview' }).locator('.platform-explorer')).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const published = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
    expect((await published).ok()).toBeTruthy();
    originalSnapshot = (await currentSite(page)).published.knowledgeRevisionId;
    await page.goto(`/s/${slug}`);
    await expect(page.locator('.platform-explorer')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Conversation mode' })).toHaveCount(0);
    await manualProof(page, 'Example Blanco Reviewed', 'Example Reposado Selected');
    await screenshot(page, info.outputPath('published-filter-shortlist.png'));
    expect(await page.evaluate(() => (window as typeof window & { __microphoneAttempts: number }).__microphoneAttempts)).toBe(0);
  });

  test('a corrected draft does not alter its published semantic snapshot', async ({ page }, info) => {
    await openWorkspace(page);
    await panel(page, 'Knowledge');
    await knowledgeAction(page, 'Review draft knowledge');
    const proposal = page.getByRole('region', { name: 'Knowledge proposal' });
    await proposal.getByLabel('Correct the interpretation').fill('Rename "Example Blanco Reviewed" to "Draft-only Blanco"');
    await knowledgeAction(page, 'Propose correction');
    await knowledgeAction(page, 'Apply to draft');
    const site = await currentSite(page);
    expect(site.draft.knowledgeRevisionId).not.toBe(originalSnapshot);
    expect(site.published.knowledgeRevisionId).toBe(originalSnapshot);
    await page.goto(`/s/${slug}`);
    await expect(page.locator('.platform-explorer')).toHaveAttribute('data-platform-catalog', originalSnapshot);
    await expect(page.getByRole('button', { name: 'Example Blanco Reviewed', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Draft-only Blanco', exact: true })).toHaveCount(0);
    await screenshot(page, info.outputPath('published-snapshot-preserved.png'));
  });

  test('malformed and stale visitor plans retain the useful view; manual navigation cancels a late reply', async ({ page }, info) => {
    await openWorkspace(page);
    await panel(page, 'Content');
    await page.getByLabel('How visitors interact').selectOption('chat');
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}`) && response.request().method() === 'POST');
    await page.locator('.save-bar').getByRole('button', { name: 'Save draft', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const published = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
    expect((await published).ok()).toBeTruthy();
    const catalog = await publicCatalog(page);
    const first = catalog.entities[0];
    const second = catalog.entities[1];
    const valid: PresentationPlan = { schemaVersion: 1, snapshotId: catalog.id, operation: 'understand', components: [{ id: 'detail', type: 'detail', variant: 'expanded', entityIds: [first.id], attributeIds: catalog.attributes.map(attribute => attribute.id) }], transition: { type: 'focus', targetComponentId: 'detail' } };
    const availability = { enabled: true, mode: 'chat', live: false, chatRemaining: 24, voiceRemaining: 5, resetsAt: new Date(Date.now() + 86400000).toISOString() };
    let scenario: 'malformed' | 'stale' | 'late' = 'malformed';
    let release: (() => void) | undefined;
    let observed: (() => void) | undefined;
    await page.route(`**/api/visitor/${slug}`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      observed?.();
      if (scenario === 'late') await new Promise<void>(resolve => { release = resolve; });
      const plan = scenario === 'malformed' ? { ...valid, components: [{ ...valid.components[0], entityIds: ['fabricated-entity'] }] }
        : scenario === 'stale' ? { ...valid, snapshotId: 'obsolete-snapshot' } : valid;
      await route.fulfill({ json: { text: 'Offline mocked plan.', catalogPlan: plan, availability } }).catch(() => {});
    });
    await page.goto(`/s/${slug}`);
    const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
    await expect(composer).toBeEnabled();
    for (const kind of ['malformed', 'stale'] as const) {
      scenario = kind;
      await composer.fill(`Test ${kind} response`);
      await page.getByRole('button', { name: 'Show me', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'current view is still available' })).toBeVisible();
      await expect(page.locator('.platform-item')).toHaveCount(4);
    }
    scenario = 'late';
    const started = new Promise<void>(resolve => { observed = resolve; });
    await composer.fill('Show first item');
    await page.getByRole('button', { name: 'Show me', exact: true }).click();
    await started;
    await page.locator('.platform-explorer').getByRole('button', { name: second.name, exact: true }).click();
    await expect(page.getByRole('region', { name: `Details of ${second.name}`, exact: true })).toBeVisible();
    release?.();
    await expect(page.getByRole('button', { name: 'Show me', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: `Details of ${first.name}`, exact: true })).toHaveCount(0);
    await screenshot(page, info.outputPath('late-plan-preserves-manual-view.png'));
    expect(await page.evaluate(() => (window as typeof window & { __microphoneAttempts: number }).__microphoneAttempts)).toBe(0);
  });

  test('mobile manual browsing stays usable with reduced motion and no AI request', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const before = visitorPosts.length;
    await page.goto(`/s/${slug}`);
    const explorer = page.locator('.platform-explorer');
    await expect(explorer.locator('.platform-item')).toHaveCount(4);
    await explorer.getByRole('spinbutton', { name: /Price/ }).fill('50');
    await expect(explorer.locator('.platform-item')).toHaveCount(2);
    await explorer.locator('.platform-item-open').first().click();
    await expect(explorer.locator('.platform-detail')).toBeVisible();
    await explorer.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(explorer.locator('.platform-item')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    expect(visitorPosts.length).toBe(before);
    await screenshot(page, info.outputPath('mobile-reduced-motion.png'));
  });

  test('three structurally different galleries render and expose useful attribute and relationship views', async ({ page }, info) => {
    const before = visitorPosts.length;
    await page.goto('/lab');
    await expect(page.getByRole('heading', { name: 'Example Agave Collection', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select Example Blanco for comparison', exact: true }).click();
    await page.getByRole('button', { name: 'Select Example Reposado for comparison', exact: true }).click();
    await page.getByRole('button', { name: 'Compare selections', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Compare published attributes' })).toBeVisible();
    const viewport = page.viewportSize()!;
    await page.setViewportSize({ ...viewport, height: 1600 });
    await screenshot(page, info.outputPath('gallery-agave-comparison.png'));
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Bookstore', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Example Reading Room', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'The Imaginary Harbor — hardcover', exact: true }).click();
    await expect(page.locator('.platform-related')).toContainText('Written by');
    await screenshot(page, info.outputPath('gallery-bookstore-relationships.png'));
    await page.getByRole('button', { name: 'Classes & experiences', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Example Learning Studio', exact: true })).toBeVisible();
    await page.getByLabel('Experience level', { exact: true }).selectOption('beginner');
    await expect(page.locator('.platform-item')).toHaveCount(2);
    await screenshot(page, info.outputPath('gallery-classes-narrowing.png'));
    expect(visitorPosts.length).toBe(before);
  });

  test('a stale semantic request is rejected before spending a visitor attempt', async ({ page }) => {
    const headers = { Origin: 'http://127.0.0.1:3225' };
    const before = await page.request.get(`/api/visitor/${slug}`, { headers });
    expect(before.ok()).toBeTruthy();
    const availability = (await before.json()).availability;
    const rejected = await page.request.post(`/api/visitor/${slug}`, { headers, data: {
      kind: 'chat', requestId: randomUUID(), text: 'Show published items', history: [],
      catalogState: { snapshotId: 'obsolete-snapshot', filters: [], selectedIds: [], focusedId: null, entityIds: [] },
    } });
    expect(rejected.status()).toBe(409);
    const after = await page.request.get(`/api/visitor/${slug}`, { headers });
    expect(after.ok()).toBeTruthy();
    expect((await after.json()).availability).toEqual(availability);
  });

  test('the production server extracts a real text-bearing PDF into a reviewable catalog', async ({ page }) => {
    const headers = { Origin: 'http://127.0.0.1:3225' };
    const created = await page.request.post('/api/sites', { headers, data: { name: 'Offline PDF Proof', slug: `pdf-proof-${Date.now()}`, kind: 'general' } });
    expect(created.ok(), await created.text()).toBeTruthy();
    let site = (await created.json()).site;
    const bytes = textPdf([['ID: pdf-workshop', 'Name: Example PDF Workshop', 'Kind: session', 'Summary: Fictional workshop for offline verification.', 'Price [USD]: 24', 'Duration: 60']]);
    const uploaded = await page.request.post(`/api/sites/${site.id}/files`, { headers: { ...headers, 'Content-Type': 'application/pdf', 'X-File-Name': 'offline-proof.pdf', 'X-Site-Revision': String(site.revision) }, data: Buffer.from(bytes) });
    expect(uploaded.ok(), await uploaded.text()).toBeTruthy();
    site = (await uploaded.json()).site;
    const interpreted = await page.request.post(`/api/sites/${site.id}/knowledge`, { headers, data: { action: 'analyze', revision: site.revision, fileId: site.files[0].id, requestId: randomUUID() } });
    expect(interpreted.ok(), await interpreted.text()).toBeTruthy();
    const state = await interpreted.json();
    expect(state.jobs[0].status, JSON.stringify(state.jobs)).toBe('needs_review');
    expect(state.candidates).toHaveLength(1);
    const catalog = state.candidates[0].catalog as KnowledgeCatalog;
    expect(catalog.entities).toHaveLength(1);
    expect(catalog.entities[0].name).toBe('Example PDF Workshop');
    const price = catalog.attributes.find(attribute => attribute.type === 'money' && attribute.currency === 'USD');
    expect(price).toBeTruthy();
    expect(catalog.entities[0].attributes[price!.id]).toBe(24);
    expect(state.candidates[0].notes.join(' ')).toContain('1 PDF pages');
    expect(state.catalog).toBeNull();
  });

  test('publishers configure non-blocking highlights, featured items and an explicit safe destination', async ({ page }, info) => {
    await openWorkspace(page);
    await panel(page, 'Knowledge');
    await knowledgeAction(page, 'Review draft knowledge');
    const proposal = page.getByRole('region', { name: 'Knowledge proposal' });
    await proposal.getByRole('button', { name: 'Add a publisher link', exact: true }).click();
    await proposal.getByLabel('Link label', { exact: true }).fill('Example information page');
    await proposal.getByLabel('HTTPS destination', { exact: true }).fill('https://example.com/offline-catalog');
    await knowledgeAction(page, 'Save corrections');
    await knowledgeAction(page, 'Apply to draft');
    await panel(page, 'Content');
    const opening = page.locator('.opening-settings');
    await opening.getByLabel(/^Highlights/).fill('Start with our two featured examples.\nCompare the published details at your own pace.');
    await opening.getByRole('combobox', { name: 'Tone', exact: true }).selectOption('direct');
    await opening.getByRole('checkbox', { name: 'Draft-only Blanco', exact: true }).check();
    await opening.getByRole('checkbox', { name: 'Example Reposado Selected', exact: true }).check();
    await opening.getByRole('checkbox', { name: 'Example information page', exact: true }).check();
    const saved = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}`) && response.request().method() === 'POST');
    await page.locator('.save-bar').getByRole('button', { name: 'Save draft', exact: true }).click();
    expect((await saved).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const published = page.waitForResponse(response => response.url().endsWith(`/api/sites/${siteId}`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
    expect((await published).ok()).toBeTruthy();
    const site = await currentSite(page);
    expect(site.published.opening).toMatchObject({ highlights: ['Start with our two featured examples.', 'Compare the published details at your own pace.'], tone: 'direct' });
    expect(site.published.opening.featuredEntityIds).toHaveLength(2);
    expect(site.published.opening.capabilityIds).toHaveLength(1);
    const before = visitorPosts.length;
    await page.goto(`/s/${slug}`);
    await expect(page.locator('.site-opening-highlights')).toContainText('Start with our two featured examples.');
    await expect(page.locator('.platform-item')).toHaveCount(2);
    await expect(page.locator('.platform-explorer').getByRole('link', { name: 'Example information page' })).toHaveAttribute('href', 'https://example.com/offline-catalog');
    await screenshot(page, info.outputPath('configured-opening-and-publisher-link.png'));
    await page.getByRole('button', { name: 'Explore the site', exact: true }).click();
    await expect(page.locator('.site-opening-highlights')).toHaveCount(0);
    await expect(page.locator('.platform-explorer')).toBeVisible();
    await page.locator('.platform-view-toolbar').getByRole('button', { name: 'All items', exact: true }).click();
    await expect(page.locator('.platform-item')).toHaveCount(4);
    expect(visitorPosts.length).toBe(before);
  });
});
