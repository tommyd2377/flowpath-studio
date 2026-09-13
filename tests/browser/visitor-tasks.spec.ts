import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../../fixtures/visitor-tasks';
import type { Site } from '../../lib/site-model';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

const origin = 'http://127.0.0.1:3225';
async function post(page: Page, path: string, data: unknown) { const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body; }
let largeSite: Site;
test('10k records pass through streamed Studio import, paged review, Apply, Publish and bounded visitor browsing', async ({ page }, info) => {
  test.setTimeout(180_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let site: Site = (await post(page, '/api/sites', { name: 'Large publisher', slug: `task-large-${Date.now()}`, kind: 'general' })).site;
  const space = taskFixture(undefined, 10000), { records, memberships, relationships, publication: _publication, ...metadata } = space;
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
  await page.goto(`/s/${site.slug}`); await page.getByRole('button', { name: 'Browse and filter collections' }).click();
  const results = page.getByRole('region', { name: 'Collection results', exact: true }); await expect(results.getByRole('status')).toHaveText('10000 matching records');
  await expect(results.locator('[data-task-record]')).toHaveCount(24);
  await results.getByRole('button', { name: 'Next page', exact: true }).click(); await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await results.getByRole('button', { name: 'Select article 24', exact: true }).click(); await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await expect(results.getByRole('button', { name: 'Remove from selection article 24', exact: true })).toBeVisible();
  await results.getByText('Edit filters and sorting', { exact: true }).click();
  await results.getByRole('combobox', { name: 'Field', exact: true }).selectOption('reading-minutes'); await results.getByRole('combobox', { name: 'Condition', exact: true }).selectOption('gte'); await results.getByLabel('Value', { exact: true }).fill('9998');
  await results.getByRole('button', { name: 'Add criterion' }).focus(); await page.keyboard.press('Enter');
  await expect(results.getByRole('status')).toHaveText('2 matching records'); await expect(results.locator('[data-task-record]')).toHaveCount(2); await expect(results).toContainText('article 9999');
  await results.getByRole('button', { name: 'Edit criterion reading-minutes' }).click(); await results.getByLabel('Value', { exact: true }).fill('9999'); await results.getByRole('button', { name: 'Update criterion' }).click();
  await expect(results.getByRole('status')).toHaveText('1 matching records'); await expect(results.locator('[data-task-record]')).toHaveAttribute('data-task-record', 'record-09999');
  await page.screenshot({ path: info.outputPath('large-query.png'), fullPage: true });
  expect(maxPayloadBytes).toBeLessThan(150000); expect(views.length).toBeGreaterThan(3); expect(errors).toEqual([]);
  await info.attach('large-payload-measurement', { body: JSON.stringify({ maxPayloadBytes, mountedCards: await results.locator('[data-task-record]').count(), records: 10000 }), contentType: 'application/json' });
});

test('mobile no-AI criteria preserve focus, selections, artifacts and synthetic action state', async ({ page }, info) => {
  test.skip(!largeSite, 'Uses the publication created through Studio in the preceding test.');
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(`/s/${largeSite.slug}`); await page.getByRole('button', { name: 'Browse and filter collections' }).click();
  const results = page.getByRole('region', { name: 'Collection results', exact: true }); await expect(results.getByRole('status')).toHaveText('10000 matching records');
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
  await expect(results).not.toBeVisible(); await page.getByRole('button', { name: 'Browse and filter collections' }).click();
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
    await response.finished();
    if (!response.ok()) { failures.push(await response.text()); return; }
    if (input.action === 'scene') observations.push(input); else acknowledgements.push(input);
  });
  await page.goto(`/s/${largeSite.slug}`); await page.getByRole('button', { name: 'Browse and filter collections' }).click();
  const results = page.getByRole('region', { name: 'Collection results', exact: true });
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
  await results.getByRole('button', { name: 'article 18', exact: true }).click();
  await expect(results.getByRole('region', { name: 'Record detail' })).toBeInViewport();
  const detail = await settledScene(resized.sceneRevision); expect(detail.recordIds).toContain('record-00018');
  for (const i of [1, 3]) { const before = observations.at(-1)!.sceneRevision; await results.getByRole('button', { name: `Select article ${i}`, exact: true }).click(); await settledScene(before); }
  await results.getByRole('button', { name: 'Compare selection' }).click();
  await expect(results.getByRole('region', { name: 'Selection comparison' })).toBeInViewport();
  await results.getByRole('region', { name: 'Selection comparison' }).scrollIntoViewIfNeeded();
  const compared = await settledScene(detail.sceneRevision); expect(compared.recordIds).toEqual(expect.arrayContaining(['record-00001', 'record-00003']));
  await results.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(results.locator('[data-task-record]').first()).toHaveAttribute('data-task-record', 'record-00024');
  await results.getByText('Edit filters and sorting', { exact: true }).click();
  await results.getByRole('combobox', { name: 'Sort', exact: true }).selectOption('reading-minutes:desc');
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
