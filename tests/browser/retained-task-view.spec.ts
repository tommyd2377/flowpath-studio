import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';
import type { Site } from '../../lib/site-model';
import type { VisitorContext } from '../../lib/visitor-request';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

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
async function harness(page: Page, kind: 'products' | 'services', count = 40) {
  const errors: string[] = [], failures: string[] = [];
  const requests: { text: string; context: VisitorContext; view: VisitorTaskView }[] = [];
  const restores: { bookmark: string }[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/tasks') && request.method() === 'POST') { const body = request.postDataJSON(); if (body.action === 'restore') restores.push(body); } });
  page.on('response', async response => {
    if (response.url().endsWith('/tasks') && !response.ok() && !await response.finished().catch(() => true)) failures.push(await response.text());
  });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  let site: Site = (await post(page, '/api/sites', { name: `Retained ${kind}`, slug: `retained-${kind}-${randomUUID().slice(0, 8)}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication, ...metadata } = websiteTaskFixture(kind, count);
  expect(publication.siteId).toBeTruthy();
  let { review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata });
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } }));
  ({ review } = await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision }));
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  const path = `/api/visitor/${site.slug}/tasks`;
  // Only model speech is mocked. Query execution, restore, and display receipts
  // use the real isolated demo server, including current generation validation.
  await page.route(`**/api/visitor/${site.slug}/session/control`, route => route.fulfill({ status: 204 }));
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { availability } });
    const body = route.request().postDataJSON() as { text: string; context: VisitorContext };
    const { view } = await post(page, path, { action: 'refresh', sessionId: body.context.taskSession!.sessionId });
    requests.push({ ...body, view });
    let target: unknown = { kind: 'answer', relationship: 'related', text: `A concise explanation of these published options: ${body.text}.` };
    if (body.text === 'Compare these options') {
      const ids = view.records.slice(0, 2).map((record: { id: string }) => record.id);
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'selection.compare', input: { records: records.filter(record => ids.includes(record.id)) } } });
      target = { kind: 'task', view: result.view };
    }
    if (body.text === 'Clarify the next step') {
      const result = await post(page, path, { action: 'execute', sessionId: view.sessionId, call: { operationId: randomUUID(), expectedRevision: view.revision, capabilityId: 'task.clarify', input: { question: 'Which published option would you like to compare?', options: ['First option', 'Second option'] } } });
      target = { kind: 'task', view: result.view };
    }
    await route.fulfill({ contentType: 'application/x-ndjson', body: [
      { type: 'control', control: { id: randomUUID(), token: 'a'.repeat(43) } },
      { type: 'navigation', id: randomUUID(), target },
      { type: 'done', text: 'Ready.', displaySatisfied: true, availability },
    ].map(event => JSON.stringify(event)).join('\n') + '\n' });
  });
  await page.goto(`/s/${site.slug}`);
  return { records, requests, restores, errors, failures, advanceGeneration: async () => post(page, path, { action: 'interrupt', sessionId: requests.at(-1)!.view.sessionId }) };
}

test('a clarification replaces old detail and accepts its own display receipt', async ({ page }) => {
  const h = await harness(page, 'products');
  await ask(page, 'Show me chocolate');
  await surface(page).getByRole('button', { name: /Read details/ }).first().click(); await settled(page);
  await ask(page, 'Clarify the next step');
  await expect(surface(page).getByRole('complementary', { name: 'Task clarification' })).toBeInViewport();
  await expect(surface(page).getByRole('region', { name: 'Record detail' })).toHaveCount(0);
  expect(h.errors).toEqual([]); expect(h.failures).toEqual([]);
});

test('a cancelled server generation restores the visible subset before the next question', async ({ page }) => {
  const h = await harness(page, 'services');
  await ask(page, 'Show me remote'); await ask(page, 'Explain these choices');
  const expected = await itemIds(page);
  await h.advanceGeneration();
  await ask(page, 'Explain those again');
  await expect.poll(() => itemIds(page)).toEqual(expected);
  expect(h.requests.at(-1)!.text).toBe('Explain those again');
  expect(h.restores.length).toBeGreaterThan(0);
  expect(h.errors).toEqual([]);
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
  const input = await compose(page, 'Explain those again');
  await expect(surface(page)).toHaveAttribute('data-carousel-active', 'true');
  await expect.poll(() => itemIds(page)).toEqual(expected);
  await expect(surface(page).getByRole('button', { name: 'Next page', exact: true })).toHaveCount(0);
  await input.press('Enter'); await expect(input).toHaveValue(''); await settled(page);
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
