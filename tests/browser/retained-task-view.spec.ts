import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { websiteTaskFixture, recordedMenuFixture } from '../../fixtures/visitor-tasks';
import type { Site } from '../../lib/site-model';
import type { VisitorContext } from '../../lib/visitor-request';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { prepareCarouselVoice } from './helpers/carousel-voice';
import { visitorTaskCheckpoint } from '../../lib/visitor-task-checkpoint';

const origin = 'http://127.0.0.1:3225';
const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
const surface = (page: Page) => page.locator('[data-information-surface]');
const itemIds = (page: Page) => surface(page).locator('[data-task-record]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.taskRecord!));
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, { headers: { Origin: origin }, data });
  const result = await response.json(); expect(response.ok(), JSON.stringify(result)).toBe(true); return result;
}
async function settled(page: Page) {
  await expect(surface(page)).toHaveAttribute('data-pending-request', '');
  await expect(surface(page)).toHaveAttribute('aria-busy', 'false');
  await expect(surface(page)).toHaveAttribute('data-workspace-transition', 'settled');
}
async function compose(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  if (!await input.isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.click(); await input.fill(text); return input;
}
async function ask(page: Page, text: string) {
  const input = await compose(page, text); await input.press('Enter');
  await expect(input).toHaveValue(''); await settled(page);
}
async function harness(page: Page, kind: 'products' | 'services', count = 40, space = websiteTaskFixture(kind, count), options: { hideSyntheticControls?: boolean; checkpointAnswers?: boolean } = {}) {
  const errors: string[] = [], failures: string[] = [];
  const requests: { text: string; context: VisitorContext; view: VisitorTaskView }[] = [];
  const displays: { status: string; context: VisitorContext }[] = [];
  const restores: { bookmark: string }[] = [];
  const taskActions: string[] = [];
  let failNextAnswer = false;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/tasks') && request.method() === 'POST') { const body = request.postDataJSON(); taskActions.push(body.action); if (body.action === 'restore') restores.push(body); } });
  page.on('response', async response => {
    if (response.url().endsWith('/tasks') && !response.ok() && !await response.finished().catch(() => true)) failures.push(await response.text());
  });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  let site: Site = (await post(page, '/api/sites', { name: `Retained ${kind}`, slug: `retained-${kind}-${randomUUID().slice(0, 8)}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication, ...metadata } = space;
  expect(publication.siteId).toBeTruthy();
  let { review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata });
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } }));
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision }));
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const path = `/api/visitor/${site.slug}/tasks`;
  // Exercise the published surface without the local-only synthetic action
  // demo. Queries, generations, bookmarks and receipts still use the server.
  if (options.hideSyntheticControls) await page.route(`**${path}`, async route => {
    const response = await route.fetch(), result = await response.json();
    if (result.view) result.view.demoActions = false;
    await route.fulfill({ response, json: result });
  });
  // Only model speech is mocked. Query execution, restore, and display receipts
  // use the real isolated demo server, including current generation validation.
  await page.route(`**/api/visitor/${site.slug}/session/control`, route => {
    const update = route.request().postDataJSON().update;
    if (update?.navigationAck) displays.push({ status: update.navigationAck.status, context: update.context });
    return route.fulfill({ status: 204 });
  });
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const body = route.request().postDataJSON() as { text: string; context: VisitorContext };
    const { view }: { view: VisitorTaskView } = await post(page, path, { action: 'refresh', sessionId: body.context.taskSession!.sessionId });
    requests.push({ ...body, view });
    let target: unknown = { kind: 'answer', relationship: 'related', text: `A concise explanation of these published options: ${body.text}.` };
    if (body.text === 'Explain this empty result alongside it') target = { kind: 'answer', relationship: 'related', placement: 'supporting', text: 'This result has no matches. The published options remain available to browse.' };
    if (body.text === 'Compare these options') {
      const ids = view.records.slice(0, 2).map((record: { id: string }) => record.id);
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'selection.compare', input: { records: records.filter(record => ids.includes(record.id)) } } });
      target = { kind: 'task', view: result.view };
    }
    if (body.text === 'Clarify the next step') {
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'task.clarify', input: { question: 'Which published option would you like to compare?', options: ['First option', 'Second option'] } } });
      target = { kind: 'task', view: result.view };
    }
    if (body.text === 'Calculate a planning total for these services') {
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'estimate.update', input: {
        op: 'set', expectedRevision: view.estimate?.revision ?? 0, lines: records.slice(1, 3).map(record => ({ recordId: record.id, fieldId: 'price', quantity: 1 })),
      } } });
      target = { kind: 'task', view: result.view };
    }
    if (body.text === 'Use an illustrative five percent tax') {
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'estimate.tax', input: {
        expectedRevision: view.estimate!.revision, tax: { mode: 'hypothetical', jurisdiction: null, location: null, fulfillment: null, applicabilityNotes: ['This fixture is not a tax determination.'], visitorAssumption: 'For illustration, use 5%.',
          lines: view.estimate!.lines.map(line => ({ recordId: line.recordId, fieldId: line.fieldId, classification: 'Synthetic service', taxability: 'taxable', ratePercent: '5', taxabilityNotes: 'Illustrative assumption only.', evidence: [] })),
        },
      } } });
      target = { kind: 'task', view: result.view };
    }
    const taskCheckpoint = options.checkpointAnswers ? visitorTaskCheckpoint((await post(page, path, { action: 'interrupt', sessionId: view.sessionId })).view) : undefined;
    if (failNextAnswer) {
      failNextAnswer = false;
      return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'error', message: 'The synthetic answer could not finish.' }) + '\n' });
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target },
      { type: 'done', text: 'Ready.', displaySatisfied: true, availability, ...(taskCheckpoint ? { taskCheckpoint } : {}) },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto(`/s/${site.slug}`);
  return { records, requests, displays, restores, taskActions, errors, failures, failNextAnswer: () => { failNextAnswer = true; }, advanceGeneration: async () => post(page, path, { action: 'interrupt', sessionId: requests.at(-1)!.view.sessionId }) };
}

test('a model-only answer synchronizes its generation before the next local collection command', async ({ page }) => {
  const h = await harness(page, 'services', 9, undefined, { hideSyntheticControls: true, checkpointAnswers: true });
  await ask(page, 'Show me remote');
  const initial = await itemIds(page);
  expect(initial).toHaveLength(3);
  await ask(page, 'Explain these choices');
  expect(h.requests).toHaveLength(1);
  await ask(page, 'Only those under $27');
  expect(await itemIds(page)).toEqual(['record-00003', 'record-00006']);
  expect(h.requests).toHaveLength(1);
  h.failNextAnswer();
  const input = await compose(page, 'Explain the remaining options'); await input.press('Enter');
  await expect(page.getByText('The synthetic answer could not finish.', { exact: true })).toBeVisible(); await settled(page);
  await ask(page, 'Only those under $25');
  expect(await itemIds(page)).toEqual(['record-00003']); expect(h.requests).toHaveLength(2);
  expect(h.failures).toEqual([]); expect(h.errors).toEqual([]);
  await expect(page.getByText('A newer request replaced this command.', { exact: true })).toHaveCount(0);
});

test('a related answer replaces empty-result support while Back and Forward preserve the query', async ({ page }) => {
  const h = await harness(page, 'products', 6, undefined, { hideSyntheticControls: true });
  await ask(page, 'Search for zzzunpublished');
  await expect(surface(page)).toContainText('No matches yet');
  const emptyState = await surface(page).getAttribute('data-surface-state');
  const emptyResult = await surface(page).getAttribute('data-result-set');
  await ask(page, 'Explain what the published guide does cover');
  await expect(surface(page).locator('[data-surface-region="answer"]')).toBeVisible();
  await expect(surface(page).locator('[data-surface-region="collection:results"]')).toHaveCount(0);
  await expect(surface(page)).not.toContainText('No matches yet');
  await expect(surface(page)).not.toContainText('No published items match yet');
  const answerState = await surface(page).getAttribute('data-surface-state');
  expect(answerState).not.toBe(emptyState);
  expect(h.displays.at(-1)?.status).toBe('applied');
  expect(h.displays.at(-1)?.context.surface?.regions.map(region => [region.id, region.role])).toEqual([['answer', 'primary']]);
  expect(h.displays.at(-1)?.context.carousel?.cards.some(card => card.id === 'collection:results')).toBe(false);
  expect(h.requests.at(-1)?.view.records).toEqual([]);
  await expect(surface(page)).toHaveAttribute('data-result-set', emptyResult!);
  await surface(page).getByRole('button', { name: 'Back to previous information', exact: true }).click(); await settled(page);
  await expect(surface(page)).toHaveAttribute('data-surface-state', emptyState!);
  await expect(surface(page)).toContainText('No matches yet');
  await expect(surface(page).locator('[data-surface-region="answer"]')).toHaveCount(0);
  await surface(page).getByRole('button', { name: 'Forward to next information', exact: true }).click(); await settled(page);
  await expect(surface(page)).toHaveAttribute('data-surface-state', answerState!);
  await expect(surface(page)).not.toContainText('No matches yet');
  await expect(surface(page).locator('[data-surface-region="answer"]')).toBeVisible();
  await surface(page).getByRole('button', { name: 'Back to previous information', exact: true }).click(); await settled(page);
  await ask(page, 'Explain this empty result alongside it');
  await expect(surface(page)).toContainText('No matches yet');
  await expect(surface(page).locator('[data-surface-supplement]')).toContainText('This result has no matches.');
  expect(h.displays.at(-1)?.context.surface?.regions.map(region => [region.id, region.role])).toEqual([['collection:results', 'primary']]);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('related answers retain useful query results, clarification and an estimate beside an empty query', async ({ page }) => {
  const h = await harness(page, 'services', 6, undefined, { hideSyntheticControls: true });
  await ask(page, 'Show me remote');
  const expected = await itemIds(page); expect(expected.length).toBeGreaterThan(0);
  await ask(page, 'Explain these services');
  expect(await itemIds(page)).toEqual(expected);
  expect(h.displays.at(-1)?.context.surface?.regions.some(region => region.id === 'collection:results' && region.role === 'supporting')).toBe(true);
  await ask(page, 'Clarify the next step');
  await ask(page, 'Explain this clarification');
  await expect(surface(page).getByRole('complementary', { name: 'Task clarification' })).toBeVisible();
  expect(h.displays.at(-1)?.context.surface?.regions.some(region => region.id === 'clarification')).toBe(true);
  await ask(page, 'Calculate a planning total for these services');
  await ask(page, 'Search for zzzunpublished');
  await expect(surface(page)).toContainText('No matches yet');
  await expect(surface(page).getByRole('button', { name: 'View estimate', exact: true })).toBeVisible();
  await ask(page, 'Explain the saved planning total');
  await expect(surface(page).getByRole('button', { name: 'View estimate', exact: true })).toBeVisible();
  expect(h.displays.at(-1)?.context.surface?.regions.some(region => region.id === 'collection:results' && region.role === 'supporting')).toBe(true);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('a clarification replaces old detail and accepts its own display receipt', async ({ page }) => {
  const h = await harness(page, 'products');
  await ask(page, 'Show me chocolate');
  await surface(page).getByRole('button', { name: /Read details/ }).first().click();
  await expect(surface(page).getByRole('region', { name: 'Record detail' })).toBeInViewport(); await settled(page);
  await ask(page, 'Clarify the next step');
  await expect(surface(page).getByRole('complementary', { name: 'Task clarification' })).toBeInViewport();
  await expect(surface(page).getByRole('region', { name: 'Record detail' })).toHaveCount(0);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('assistant keyboard navigation reaches price and tax disclosures before wrapping to the composer', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const h = await harness(page, 'services', 3);
  await ask(page, 'Calculate a planning total for these services');
  await ask(page, 'Use an illustrative five percent tax');
  const estimate = surface(page).getByRole('region', { name: 'Published price estimate' });
  await expect(estimate).toContainText('Hypothetical tax estimate');
  const prices = estimate.locator('summary').filter({ hasText: 'Price details' });
  await expect(prices).toHaveCount(2);
  const tax = estimate.locator('summary').filter({ hasText: 'Tax assumptions & sources' });
  await surface(page).getByRole('button', { name: 'Close assistant', exact: true }).focus();
  for (let index = 0; index < 2; index++) {
    await page.keyboard.press('Tab'); await expect(prices.nth(index)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(prices.nth(index).locator('..')).toHaveAttribute('open', '');
    await expect(prices.nth(index).locator('..')).toContainText(h.records[index + 1].summary);
  }
  await page.keyboard.press('Tab'); await expect(tax).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(tax.locator('..')).toHaveAttribute('open', '');
  await expect(estimate.getByText('For illustration, use 5%.', { exact: true })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(tax).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(prices.nth(1)).toBeFocused();
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('recorded menu requests show offerings, open the named variant, and restore meaningful clarification history', async ({ page }, info) => {
  const h = await harness(page, 'products', 7, recordedMenuFixture());
  await ask(page, 'Can you bring up the menu');
  expect(await itemIds(page)).toHaveLength(7);
  await expect(surface(page)).not.toContainText('Our Dessert Menu');
  await expect(surface(page)).toContainText('Vanilla Cupcake');
  await ask(page, 'Show me velvet');
  const filtered = await itemIds(page); expect(filtered).toHaveLength(6);
  await ask(page, 'Open up the red-and-blue velvet');
  await expect(surface(page).getByRole('region', { name: 'Record detail' })).toContainText('Red & Blue Velvet');
  expect(await itemIds(page)).toEqual(['cake-0']);
  expect(h.requests, 'all three direct commands use real task execution without a model call').toHaveLength(0);
  await ask(page, 'Clarify the next step');
  const question = 'Which published option would you like to compare?';
  await expect(surface(page).getByText(question, { exact: true })).toHaveCount(1);
  await expect(surface(page).getByText(question, { exact: true })).toBeInViewport();
  await expect(surface(page).getByRole('complementary', { name: 'Task clarification' })).toContainText(question);
  const capture = info.outputPath('recorded-menu-clarification.png');
  await page.screenshot({ path: capture }); await info.attach('recorded-menu-clarification', { path: capture, contentType: 'image/png' });
  await surface(page).getByRole('button', { name: 'Back to previous information', exact: true }).click(); await settled(page);
  expect(await itemIds(page)).toEqual(['cake-0']);
  await surface(page).getByRole('button', { name: 'Back to previous information', exact: true }).click(); await settled(page);
  expect(await itemIds(page)).toEqual(filtered);
  await surface(page).getByRole('button', { name: 'Forward to next information', exact: true }).click(); await settled(page);
  expect(await itemIds(page)).toEqual(['cake-0']);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('a cancelled server generation restores the visible subset before the next question', async ({ page }) => {
  const h = await harness(page, 'services');
  await ask(page, 'Show me remote'); await ask(page, 'Explain these choices');
  const expected = await itemIds(page);
  await ask(page, 'Take me home');
  await h.advanceGeneration();
  const beforeReopen = h.taskActions.length;
  await ask(page, 'Explain those again');
  await expect.poll(() => itemIds(page)).toEqual(expected);
  expect(h.requests.at(-1)!.text).toBe('Explain those again');
  expect(h.taskActions.slice(beforeReopen).filter(action => action === 'restore')).toHaveLength(2);
  expect(h.taskActions.slice(beforeReopen).filter(action => action === 'refresh')).toHaveLength(1);
  expect(h.errors).toEqual([]);
});

test('voice startup shares hover, focus and activation synchronization without refreshing the retained view twice', async ({ page }) => {
  // Mock only voice/media; retained queries and synchronization use the real
  // isolated demo task server. No microphone permission or paid session is used.
  await prepareCarouselVoice(page);
  const h = await harness(page, 'services');
  await ask(page, 'Show me remote');
  const expected = await itemIds(page);
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await settled(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let refreshes = 0;
  await page.route('**/api/visitor/*/tasks', async route => {
    if (route.request().postDataJSON().action !== 'refresh') return route.continue();
    refreshes++;
    await gate;
    await route.continue();
  });
  const wave = page.getByRole('button', { name: 'Start conversation', exact: true });
  await wave.hover();
  await expect.poll(() => refreshes).toBe(1);
  await wave.focus();
  await wave.click();
  await expect(page.getByRole('button', { name: 'Cancel connection', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
  release();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  expect(refreshes).toBe(1);
  expect(await itemIds(page)).toEqual(expected);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  // Completed synchronization is not cached: a later focus checks again.
  await page.mouse.move(0, 0);
  await page.locator('.site-wave').evaluate(element => (element as HTMLElement).blur());
  await page.getByRole('button', { name: 'Start conversation', exact: true }).focus();
  await expect.poll(() => refreshes).toBe(2);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

for (const kind of ['products', 'services'] as const) test(`${kind}: retained results, details and comparisons keep their own content after Home`, async ({ page }) => {
  const h = await harness(page, kind);
  const subject = kind === 'products' ? 'chocolate' : 'remote';
  await ask(page, `Show me ${subject}`);
  await ask(page, 'Only those under $37');
  const expected = h.records.filter((_, index) => index > 0 && index < 17 && index % 3 === 0).map(record => record.id);
  await expect.poll(() => itemIds(page)).toEqual(expected);
  await expect(surface(page).getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  await ask(page, 'Explain these choices');
  await ask(page, 'Take me home');
  await expect(surface(page)).toHaveAttribute('data-carousel-active', 'false');

  // Reopening already paints the retained five, before request preparation.
  const beforeReopen = h.taskActions.length;
  const input = await compose(page, 'Explain those again');
  await expect(surface(page)).toHaveAttribute('data-carousel-active', 'true');
  await expect.poll(() => itemIds(page)).toEqual(expected);
  await expect(surface(page).getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  await input.press('Enter'); await expect(input).toHaveValue(''); await settled(page);
  expect(h.taskActions.slice(beforeReopen).filter(action => action === 'restore')).toHaveLength(1);
  expect(h.taskActions.slice(beforeReopen)).not.toContain('refresh');
  expect(h.requests.at(-1)!.view.records.map(record => record.id)).toEqual(expected);
  expect(h.requests.at(-1)!.view.result.nextCursor).toBeFalsy();
  expect(h.restores.length).toBeGreaterThan(0);

  await surface(page).getByRole('button', { name: /Read details/ }).first().click();
  const detail = surface(page).getByRole('region', { name: 'Record detail' });
  const first = h.records.find(record => record.id === expected[0])!;
  await expect(detail).toContainText(`Published detail for ${first.name}.`);
  await settled(page);
  await ask(page, 'Take me home');
  const detailInput = await compose(page, 'Explain this detail');
  await expect(detail).toContainText(`Published detail for ${first.name}.`);
  await detailInput.press('Enter'); await expect(detailInput).toHaveValue(''); await settled(page);
  expect(h.requests.at(-1)!.view.detail?.record.id).toBe(first.id);
  await expect(detail).toContainText(`Published detail for ${first.name}.`);

  await ask(page, 'Compare these options');
  const comparison = surface(page).getByRole('region', { name: 'Selection comparison' });
  const compared = h.records.filter(record => expected.slice(0, 2).includes(record.id));
  await expect(comparison).toBeVisible();
  await ask(page, 'Take me home');
  const comparisonInput = await compose(page, 'Explain this comparison');
  for (const record of compared) await expect(comparison).toContainText(record.name);
  await comparisonInput.press('Enter'); await expect(comparisonInput).toHaveValue(''); await settled(page);
  expect(h.requests.at(-1)!.view.comparison?.rows.map(row => row.id)).toEqual(compared.map(record => record.id));
  for (const record of compared) await expect(comparison).toContainText(record.name);

  // A dependent filter immediately after Home must start from the saved subset.
  await ask(page, 'Take me home'); await ask(page, 'Only those under $30');
  await expect.poll(() => itemIds(page)).toEqual(expected.slice(0, 3));
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('a retained paginated subset restores before its manual Next action', async ({ page }) => {
  const h = await harness(page, 'products', 90);
  await ask(page, 'Show me chocolate');
  const matching = h.records.filter((_, index) => index % 3 === 0).map(record => record.id);
  await expect.poll(() => itemIds(page)).toEqual(matching.slice(0, 24));
  await ask(page, 'Take me home');
  await compose(page, '');
  await expect(surface(page)).toHaveAttribute('data-carousel-active', 'true');
  await surface(page).getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => itemIds(page)).toEqual(matching.slice(24));
  await settled(page);
  expect(h.restores.length).toBeGreaterThan(0);
  await expect(surface(page).getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  await ask(page, 'Take me home');
  await compose(page, '');
  await expect(surface(page).getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  await surface(page).getByRole('button', { name: /Read details/ }).first().click();
  await expect(surface(page).getByRole('region', { name: 'Record detail' })).toHaveAttribute('data-task-record', matching[24]);
  await settled(page);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});
