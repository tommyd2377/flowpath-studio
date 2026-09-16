import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../../fixtures/visitor-tasks';
import type { Site } from '../../lib/site-model';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) { const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body; }
let largeSite: Site;
async function askWebsite(page: Page, text: string) {
  const chat = page.getByRole('button', { name: 'Chat', exact: true });
  if (await chat.count()) await chat.click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?' });
  await input.fill(text); await input.press('Enter');
}

test('10k records pass through streamed Studio import, paged review, Apply, Publish and bounded visitor browsing', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let site: Site = (await post(page, '/api/sites', { name: 'Large publisher', slug: `task-large-${Date.now()}`, kind: 'general' })).site;
  const space = taskFixture(undefined, 10000), { records, memberships, relationships, publication: _publication, ...metadata } = space;
  records.at(-1)!.blocks = [{ id: 'fulltext-tail', kind: 'paragraph', text: 'A published long-form sentinel beyond card summaries.' }];
  expect(_publication.siteId).toBe('site-article'); const lines = [JSON.stringify(metadata)];
  for (let offset = 0; offset < records.length; offset += 100) { const chunk = records.slice(offset, offset + 100), ids = new Set(chunk.map(record => record.id)); lines.push(JSON.stringify({ records: chunk, memberships: memberships.filter(member => ids.has(member.recordId)), relationships: offset === 0 ? relationships : [] })); }
  await page.goto('/'); const picker = page.getByRole('combobox', { name: 'Current site', exact: true }); await expect(picker).toBeEnabled(); await picker.selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Knowledge', exact: true }).click();
  await page.getByText('Advanced collection tools', { exact: true }).click();
  const review = page.getByRole('region', { name: 'Paged collection review' });
  await review.getByLabel('Import collection file', { exact: true }).setInputFiles({ name: 'synthetic-10000.jsonl', mimeType: 'application/x-ndjson', buffer: Buffer.from(lines.join('\n')) });
  await expect(review.getByRole('button', { name: 'Apply collections to draft' })).toBeEnabled({ timeout: 90000 });
  await expect(review.getByLabel('Collection record preview').locator('details')).toHaveCount(24);
  for (let i = 0; i < 5; i++) { await review.getByRole('button', { name: 'Next review page' }).click(); await expect(review).toHaveAttribute('aria-busy', 'false'); }
  await expect(review.getByLabel('Collection record preview')).toContainText('article 120');
  await review.getByRole('button', { name: 'Apply collections to draft' }).click(); await expect(review).toContainText('Applied to draft.');
  site = (await (await page.request.get(`/api/sites/${site.id}`)).json()).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site; largeSite = site;
  const html = await (await page.request.get(`/s/${site.slug}`)).text(); expect(html).not.toContain('record-09999'); expect(html).not.toContain('Synthetic Media archive record 0');
  let maxPayloadBytes = 0; const views: VisitorTaskView[] = [];
  page.on('response', async response => { if (response.url().endsWith('/tasks') && response.ok()) { const text = await response.text().catch(() => ''); if (text) { const data = JSON.parse(text); if (data.view) { maxPayloadBytes = Math.max(maxPayloadBytes, Buffer.byteLength(JSON.stringify(data.view))); views.push(data.view); } } } });
  await page.goto(`/s/${site.slug}`); await page.getByRole('button', { name: 'Browse published content' }).click();
  const results = page.getByRole('region', { name: 'Website content', exact: true }); await expect(results.getByRole('status')).toHaveText('10000 matching items');
  await expect(results.locator('[data-task-record]')).toHaveCount(24);
  await results.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await results.getByRole('button', { name: 'Select article 24', exact: true }).click(); await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await expect(results.getByRole('button', { name: 'Remove from selection article 24', exact: true })).toBeVisible();
  await expect(page.getByText('Filters and sorting', { exact: true })).toHaveCount(0);
  await askWebsite(page, 'Only reading minutes at least 9998');
  await expect(results.getByRole('status')).toHaveText('2 matching items'); await expect(results).toHaveAttribute('aria-busy', 'false'); await expect(results.locator('[data-task-record]')).toHaveCount(2); await expect(results).toContainText('article 9999');
  await askWebsite(page, 'Only reading minutes at least 9999');
  await expect(results.getByRole('status')).toHaveText('1 matching item'); await expect(results).toHaveAttribute('data-website-transition', 'settled'); await expect(results.locator('[data-task-record]')).toHaveCount(1); await expect(results.locator('[data-task-record]')).toHaveAttribute('data-task-record', 'record-09999');
  await askWebsite(page, 'Search for long-form sentinel');
  await expect(results.getByLabel('Active criteria')).toBeVisible(); await expect(results).toHaveAttribute('aria-busy', 'false');
  await expect(results.getByRole('status')).toHaveText('1 matching item');
  await page.screenshot({ path: info.outputPath('large-query.png'), fullPage: true });
  expect(maxPayloadBytes).toBeLessThan(150000); expect(views.length).toBeGreaterThan(3); expect(errors).toEqual([]);
  await info.attach('large-payload-measurement', { body: JSON.stringify({ maxPayloadBytes, mountedCards: await results.locator('[data-task-record]').count(), records: 10000 }), contentType: 'application/json' });
});

test('mobile no-AI criteria preserve focus, selections, artifacts and synthetic action state', async ({ page }, info) => {
  test.skip(!largeSite, 'Uses the publication created through Studio in the preceding test.');
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`/s/${largeSite.slug}`); await page.getByRole('button', { name: 'Browse published content' }).click();
  const results = page.getByRole('region', { name: 'Website content', exact: true }); await expect(results.getByRole('status')).toHaveText('10000 matching items');
  for (const i of [0, 1, 3]) { const button = results.getByRole('button', { name: `Select article ${i}`, exact: true }); await button.focus(); await page.keyboard.press('Enter'); await expect(results.getByRole('button', { name: `Remove from selection article ${i}`, exact: true })).toBeFocused(); }
  await results.getByRole('button', { name: 'Compare selection' }).click(); await expect(results.getByRole('region', { name: 'Selection comparison' }).locator('tbody tr')).toHaveCount(3); await expect(results.getByRole('region', { name: 'Selection comparison' })).toBeInViewport();
  await results.getByRole('button', { name: 'Create brief', exact: true }).click(); const brief = results.getByRole('region', { name: 'brief artifact', exact: true }); await expect(brief).toBeInViewport();
  await brief.getByLabel('Project objective', { exact: true }).fill('Review these three published examples.'); await brief.getByLabel('Keep this artifact in my visitor session').check(); await brief.getByRole('button', { name: 'Save artifact edits' }).click();
  await expect(brief.getByLabel('Project objective', { exact: true })).toHaveValue('Review these three published examples.');
  const download = page.waitForEvent('download'); await brief.getByRole('button', { name: 'Export saved version' }).click(); expect((await download).suggestedFilename()).toBe('brief.md');
  await results.getByText('Synthetic action demo', { exact: true }).click();
  for (const i of [0, 1, 3]) { await results.getByRole('button', { name: `Add article ${i} to demo cart`, exact: true }).click(); await expect(results).toHaveAttribute('aria-busy', 'false'); }
  await results.getByRole('button', { name: 'Get synthetic quote' }).click(); const quote = results.getByRole('region', { name: 'Synthetic quote review' }); await expect(quote).toContainText('$80.78');
  await quote.getByRole('button', { name: 'Confirm synthetic order for $80.78' }).dblclick(); await expect(results.getByRole('status').filter({ hasText: 'Synthetic order confirmed' })).toBeVisible();
  await results.getByRole('button', { name: 'Find synthetic appointments' }).click(); await results.getByRole('button', { name: /10\/15\/2030.*America\/New_York/ }).click();
  await results.getByRole('button', { name: 'Confirm this synthetic appointment' }).click(); await expect(results.getByRole('status').filter({ hasText: 'Synthetic booking confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(results).not.toBeVisible(); await page.getByRole('button', { name: 'Browse published content' }).click();
  await expect(results.getByRole('region', { name: 'brief artifact', exact: true }).getByLabel('Project objective', { exact: true })).toHaveValue('Review these three published examples.');
  await results.getByText('Synthetic action demo', { exact: true }).click();
  await expect(results.getByLabel('Synthetic cart', { exact: true }).getByLabel('Quantity record-00001')).toHaveValue('1');
  await expect(results.getByRole('status').filter({ hasText: 'Synthetic booking confirmed' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('mobile-task-review.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('current visible references follow scrolling, resizing, focus and query changes without replaying completion', async ({ page }) => {
  test.skip(!largeSite, 'Uses the publication created through Studio in the preceding test.');
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const path = `/api/visitor/${largeSite.slug}/tasks`;
  type Scene = { action: 'scene'; sessionId: string; operationId: string; generation: number; queryId: string; queryRevision: number; resultSetId: string; sceneRevision: number; recordIds: string[]; ready: boolean };
  const observations: Scene[] = [], acknowledgements: { operationId: string }[] = [], failures: string[] = [];
  let displayedOperation = '';
  page.on('response', async response => {
    if (!response.url().endsWith(path)) return;
    const input = response.request().postDataJSON();
    if (input.action === 'execute' && response.ok()) { displayedOperation = (await response.json()).view.operationId; return; }
    if (input.action !== 'scene' && input.action !== 'ack') return;
    if (await response.finished().catch(() => new Error('Request cancelled'))) return;
    if (!response.ok()) { failures.push(await response.text()); return; }
    if (input.action === 'scene') observations.push(input); else acknowledgements.push(input);
  });
  await page.goto(`/s/${largeSite.slug}`); await page.getByRole('button', { name: 'Browse published content' }).click();
  const results = page.getByRole('region', { name: 'Website content', exact: true });
  await expect(results.locator('[data-task-record]')).toHaveCount(24);
  const visibleIds = () => results.locator('[data-task-record]').evaluateAll(elements => [...new Set(elements.filter(element => {
    const box = element.getBoundingClientRect();
    return element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top || a.getBoundingClientRect().left - b.getBoundingClientRect().left).map(element => (element as HTMLElement).dataset.taskRecord!))]);
  const settledScene = async (after = 0) => {
    await expect(results).toHaveAttribute('aria-busy', 'false');
    await expect.poll(async () => {
      const latest = observations.at(-1);
      return !!latest?.ready && latest.operationId === displayedOperation && latest.sceneRevision > after && JSON.stringify(latest.recordIds) === JSON.stringify(await visibleIds());
    }).toBe(true);
    return observations.at(-1)!;
  };
  await results.locator('[data-task-record="record-00006"]').scrollIntoViewIfNeeded();
  const initial = await settledScene(), completed = acknowledgements.length;
  await results.locator('[data-task-record="record-00018"]').scrollIntoViewIfNeeded();
  const scrolled = await settledScene(initial.sceneRevision);
  expect(scrolled.recordIds).toContain('record-00018'); expect(scrolled.recordIds).not.toContain('record-00006');
  expect(observations.some(value => !value.ready && value.sceneRevision > initial.sceneRevision)).toBe(true);
  expect(acknowledgements).toHaveLength(completed);
  await page.setViewportSize({ width: 1100, height: 800 });
  await results.locator('[data-task-record="record-00018"]').scrollIntoViewIfNeeded();
  const resized = await settledScene(scrolled.sceneRevision); expect(resized.recordIds).not.toEqual(scrolled.recordIds);
  expect(acknowledgements).toHaveLength(completed);
  await results.getByRole('button', { name: 'Open article 18', exact: true }).click();
  await expect(results.getByRole('region', { name: 'Record detail' })).toBeInViewport();
  await expect(results.getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  const detail = await settledScene(resized.sceneRevision); expect(detail.recordIds).toContain('record-00018');
  await results.getByRole('button', { name: 'Back to results' }).click();
  for (const i of [1, 3]) { const before = observations.at(-1)!.sceneRevision; await results.getByRole('button', { name: `Select article ${i}`, exact: true }).click(); await settledScene(before); }
  await results.getByRole('button', { name: 'Compare selection' }).click();
  await expect(results.getByRole('region', { name: 'Selection comparison' })).toBeInViewport();
  await results.getByRole('region', { name: 'Selection comparison' }).scrollIntoViewIfNeeded();
  const compared = await settledScene(detail.sceneRevision); expect(compared.recordIds).toEqual(expect.arrayContaining(['record-00001', 'record-00003']));
  await results.getByRole('button', { name: 'Back to results' }).click();
  await expect(results.getByRole('region', { name: 'Selection comparison' })).toHaveCount(0);
  await settledScene(compared.sceneRevision);
  // Commit the page ACK on the server, but hold its response while a new chat
  // request interrupts it. Both sides must resume the server-confirmed page.
  let ackSaved!: () => void, releaseAck!: () => void, holdNextAck = true;
  const saved = new Promise<void>(resolve => { ackSaved = resolve; }), held = new Promise<void>(resolve => { releaseAck = resolve; });
  await page.route(`**${path}`, async route => {
    if (route.request().postDataJSON().action !== 'ack' || !holdNextAck) return route.continue();
    holdNextAck = false;
    const response = await route.fetch(); ackSaved(); await held;
    await route.fulfill({ response }).catch(() => undefined);
  });
  await results.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await saved;
  await askWebsite(page, 'Sort reading minutes descending');
  releaseAck();
  await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-09999');
  await results.locator('[data-task-record]').first().scrollIntoViewIfNeeded();
  const sorted = await settledScene(compared.sceneRevision);
  const { view } = await post(page, path, { action: 'refresh', sessionId: sorted.sessionId });
  const resolved = await post(page, path, { action: 'execute', sessionId: sorted.sessionId, call: { operationId: randomUUID(), capabilityId: 'reference.resolve', expectedRevision: view.revision, input: { visible: true, ordinal: 1, resultSetId: sorted.resultSetId, sceneRevision: sorted.sceneRevision } } });
  expect(resolved.data[0].id).toBe(sorted.recordIds[0]);
  const stale = await page.request.post(path, { headers: { Origin: origin }, data: { action: 'execute', sessionId: sorted.sessionId, call: { operationId: randomUUID(), capabilityId: 'reference.resolve', expectedRevision: resolved.view.revision, input: { visible: true, ordinal: 1, resultSetId: sorted.resultSetId, sceneRevision: initial.sceneRevision } } } });
  expect(stale.status()).toBe(409);
  expect(await stale.text()).toContain('scene changed');
  expect(failures).toEqual([]);
});

for (const kind of ['products', 'services'] as const) test(`${kind}: conversation transforms the website, recovers and restores the full composition`, async ({ page }, info) => {
  test.setTimeout(180_000);
  const { websiteTaskFixture } = await import('../../fixtures/visitor-tasks');
  const errors: string[] = [], calls: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/tasks') && request.method() === 'POST') calls.push(request.postDataJSON().action); });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  if (kind === 'services') { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  let site: Site = (await post(page, '/api/sites', { name: kind === 'products' ? 'Everyday celebrations' : 'Independent design', slug: `website-${kind}-${Date.now()}`, kind: 'general' })).site;
  const space = websiteTaskFixture(kind), { records, memberships, relationships, publication: _publication, ...metadata } = space;
  void _publication;
  let { review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata });
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } }));
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision }));
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, headline: 'Thoughtfully made for you.', description: 'Explore our published collection.', style: { entry: 'website', layout: 'editorial', palette: 'parchment' }, sections: [{ id: 'approach', title: 'Our approach', body: 'A synthetic publisher introduction with a distinct editorial voice.' }], visitor: { enabled: true, mode: 'chat', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  const website = page.locator('[data-published-website]'), results = website.getByRole('region', { name: 'Website content', exact: true });
  const count = (number: number) => expect(results.locator('[data-website-result-heading] [role="status"]')).toHaveText(`${number} matching items`);
  const settled = () => expect(results).toHaveAttribute('aria-busy', 'false');
  const ask = async (text: string) => { const input = page.getByRole('textbox', { name: 'What would you like to see?' }); await input.fill(text); await input.press('Enter'); };
  await count(40); await settled();
  await expect(page.getByRole('button', { name: 'Browse and filter collections' })).toHaveCount(0);
  await expect(page.locator('.platform-query-surface, .platform-task-browser, .platform-query-records, .platform-query-filters')).toHaveCount(0);
  await expect(website.locator('input, select, textarea')).toHaveCount(0);
  await expect(website.locator('.platform-website-hero')).toBeVisible();
  await website.locator('.platform-website-footer').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>('.platform-website-hero-frame')!, content = document.querySelector('[aria-label="Website content"]')!;
    const samples: number[] = [target.getBoundingClientRect().height];
    Object.assign(window, { websiteMotionSamples: samples });
    const observer = new MutationObserver(() => {
      if (content.getAttribute('data-filtered') !== 'true') return;
      observer.disconnect();
      const sample = () => { samples.push(target.isConnected ? target.getBoundingClientRect().height : 0); if (target.isConnected && samples.length < 180) requestAnimationFrame(sample); };
      requestAnimationFrame(sample);
    });
    observer.observe(content, { attributes: true, attributeFilter: ['data-filtered'] });
  });
  await ask(kind === 'products' ? 'Show me chocolate' : 'Show me remote'); await count(14); await settled();
  await expect(website.locator('.platform-website-hero')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Hide browser', exact: true })).toHaveCount(0);
  await expect(website.getByText('A synthetic publisher introduction with a distinct editorial voice.')).toHaveCount(0);
  await expect(results.locator('[data-website-result-heading]')).toBeInViewport();
  const heights = await page.evaluate(() => (window as typeof window & { websiteMotionSamples: number[] }).websiteMotionSamples);
  expect(heights.at(-1)).toBe(0);
  if (kind === 'products') expect(heights.some(height => height > 1 && height < heights[0] - 1)).toBe(true);
  else expect(heights.length).toBeLessThanOrEqual(4); // No travel; one frame can retain CSS padding before unmount.
  await info.attach('observed-hero-transition', { body: JSON.stringify({ reducedMotion: kind === 'services', heights }), contentType: 'application/json' });
  expect(await results.locator('[data-task-record]').count()).toBe(14);
  await ask('Only those under $40'); await count(6); await settled();
  await expect(results.getByLabel('Records needing information')).toContainText('1 item lacks confirmed information');
  await ask(kind === 'products' ? 'Include vanilla too' : 'Include studio too'); await count(13); await settled();
  await ask('Sort price descending'); await settled();
  await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00019');
  const ordered = await results.locator('[data-task-record]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.taskRecord));
  await results.locator('[data-task-record]').nth(1).click(); await expect(results.getByRole('region', { name: 'Record detail' })).toBeVisible(); await settled();
  await results.getByRole('button', { name: 'Back to results' }).focus(); await page.keyboard.press('Enter'); await settled();
  expect(await results.locator('[data-task-record]').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.taskRecord))).toEqual(ordered);
  await expect(results.locator(`[data-task-record="${ordered[1]}"]`)).toBeFocused();
  await results.locator('[data-task-record]').first().click(); await settled();
  await ask('Remove the price limit'); await count(27); await settled();
  await expect(results.getByRole('region', { name: 'Record detail' })).toHaveCount(0);
  await ask('Only those under $1'); await count(0); await settled();
  await expect(results.getByText('No published items match yet. Ask me to remove a constraint, try a broader search, or show everything again.')).toBeVisible();
  await ask('Remove the price limit'); await count(27); await settled();
  // Fail a local query without disturbing the acknowledged page; then recover explicitly.
  let fail = true;
  await page.route(`**/api/visitor/${site.slug}/tasks`, async route => {
    if (fail && route.request().postDataJSON().action === 'execute') { fail = false; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic query outage' }) }); }
    else await route.continue();
  });
  await results.getByRole('button', { name: 'Show everything again' }).click(); await expect(results.getByRole('alert')).toContainText('Synthetic query outage'); await count(27);
  await results.getByRole('button', { name: 'Show everything again' }).click(); await count(40); await settled();
  await expect(website.locator('.platform-website-hero')).toBeVisible();
  await expect(website.getByText('A synthetic publisher introduction with a distinct editorial voice.')).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${kind}-restored-website.png`), fullPage: true });
  await ask(kind === 'products' ? 'Show me vanilla' : 'Show me studio'); await count(13); await settled();
  expect(await results.locator('[data-task-record]').first().evaluate(element => element.getBoundingClientRect().top)).toBeLessThan((page.viewportSize()?.height ?? 844) * .85);
  await page.screenshot({ path: info.outputPath(`${kind}-filtered-website.png`) });
  await results.locator('[data-task-record]').first().scrollIntoViewIfNeeded();
  await ask('Open the second one'); await expect(results.getByRole('region', { name: 'Record detail' })).toBeVisible(); await settled();
  await ask('Go back to those results'); await count(13); await settled();
  if (kind === 'products') {
    // Hold an already-computed response. A newer conversation or Home must win.
    for (const replacement of ['conversation', 'home'] as const) {
      let release!: () => void, reached!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; }), computed = new Promise<void>(resolve => { reached = resolve; });
      let hold = true;
      const url = `**/api/visitor/${site.slug}/tasks`;
      const handler = async (route: import('@playwright/test').Route) => {
        if (hold && route.request().postDataJSON().action === 'execute') {
          hold = false; const response = await route.fetch(); reached(); await held;
          await route.fulfill({ response }).catch(() => undefined);
        } else await route.fallback();
      };
      await page.route(url, handler);
      await ask('Search for unmatched delayed search'); await computed;
      await expect(results).toHaveAttribute('aria-busy', 'true'); await expect(results.getByText('Updating the website…', { exact: true })).toBeVisible();
      await count(replacement === 'conversation' ? 13 : 14);
      if (replacement === 'conversation') { await ask('Show me chocolate'); await count(14); }
      else { await page.getByRole('button', { name: 'Home', exact: true }).first().click(); await count(40); await expect(website.locator('.platform-website-hero')).toBeVisible(); }
      await settled(); release(); await page.unroute(url, handler);
      await expect(results.getByText('No published items match yet. Ask me to remove a constraint, try a broader search, or show everything again.')).toHaveCount(0);
      await count(replacement === 'conversation' ? 14 : 40);
    }
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(calls.filter(action => action === 'ack').length).toBeGreaterThan(8); expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test(`long assistant answers remain readable above the website${mobile ? ' on mobile' : ''}`, async ({ page }, info) => {
  test.skip(!largeSite, 'Uses the isolated synthetic publication.');
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 10, voiceRemaining: 0, resetsAt: '' };
  let release!: () => void, reached!: () => void;
  const responseReady = new Promise<void>(resolve => { reached = resolve; }), hold = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/visitor/${largeSite.slug}`, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { availability } });
    reached(); await hold;
    await route.fulfill({ json: { availability, demo: true, text: `## Our approach\n\n**Published information** stays separate from unverified availability.\n\n${Array.from({ length: 12 }, (_, i) => `- Reading point ${i + 1}: a concise synthetic explanation.`).join('\n')}\n\nFinal answer marker.` } });
  });
  await page.goto(`/s/${largeSite.slug}`); await page.getByRole('button', { name: 'Browse published content' }).click();
  await askWebsite(page, 'Why is this collection organized this way?'); await responseReady;
  await page.locator('.platform-website-footer').scrollIntoViewIfNeeded(); release();
  const answer = page.getByRole('complementary', { name: 'Assistant answer' });
  await expect(answer).toBeInViewport(); await expect(answer.getByRole('heading', { name: 'Our approach' })).toBeInViewport();
  await expect(answer).not.toContainText('**');
  const rects = await page.evaluate(() => {
    const dock = document.querySelector('.platform-conversation-dock')!.getBoundingClientRect();
    const modes = document.querySelector('[data-visitor-conversation-controls]')?.getBoundingClientRect();
    const answer = document.querySelector('[aria-label="Assistant answer"]')!.getBoundingClientRect();
    return { dockBottom: Math.max(dock.bottom, modes?.bottom ?? 0), answerTop: answer.top, answerBottom: answer.bottom, height: innerHeight };
  });
  expect(rects.answerTop).toBeGreaterThanOrEqual(rects.dockBottom); expect(rects.answerBottom).toBeLessThan(rects.height);
  await answer.getByRole('button', { name: 'Dismiss answer' }).scrollIntoViewIfNeeded();
  await expect(answer.getByText('Final answer marker.')).toBeInViewport();
  await page.screenshot({ path: info.outputPath(`readable-answer-${mobile ? 'mobile' : 'desktop'}.png`) });
  await answer.getByRole('button', { name: 'Dismiss answer' }).click(); await expect(answer).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'What would you like to see?' })).toBeFocused();
});
