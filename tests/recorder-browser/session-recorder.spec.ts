import { test, expect, type Page } from '@playwright/test';
import { carouselFixture } from '../browser/helpers/carousel-fixture';
import { prepareCarouselVoice } from '../browser/helpers/carousel-voice';
import type { TestEvent } from '../../lib/visitor-test-events';

const recorder = (page: Page) => page.getByRole('complementary', { name: 'Local test recorder' });
const api = (page: Page, data: object) => page.request.post('/api/dev/recordings', { headers: { Origin: 'http://127.0.0.1:3225', 'x-flowpath-local-test': '1' }, data });
async function start(page: Page) {
  await recorder(page).locator('summary').click();
  await recorder(page).getByRole('button', { name: 'Record test session', exact: true }).click();
  await expect(recorder(page).getByRole('button', { name: 'Mark a problem' })).toBeVisible();
  const href = await recorder(page).getByRole('link', { name: 'Open test timeline' }).getAttribute('href');
  return new URL(href!, page.url()).searchParams.get('id')!;
}
async function ask(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  if (!await input.isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.fill(text); await input.press('Enter');
}

for (const mobile of [false, true]) test(`records real local chat navigation, problem markers and a durable searchable export${mobile ? ' on mobile' : ''}`, async ({ page }, info) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text()); });
  await carouselFixture(page, true);
  const before = await (await api(page, { action: 'list' })).json();
  const id = await start(page); await recorder(page).locator('summary').click();
  await ask(page, 'Show me your photos');
  const surface = page.locator('[data-information-surface]');
  await expect(surface).toContainText('9 matching items');
  await expect(surface).toHaveAttribute('aria-busy', 'false');
  await expect(surface).toHaveAttribute('data-workspace-transition', 'settled');
  const displayed = await surface.evaluate(node => {
    const reading = node.querySelector('[data-workspace-scroll]')!.getBoundingClientRect();
    return {
      stateId: node.getAttribute('data-surface-state'),
      regions: [...node.querySelectorAll<HTMLElement>('[data-surface-region]')].map(region => ({ id: region.dataset.surfaceRegion, role: region.dataset.role })),
      records: [...new Set([...node.querySelectorAll<HTMLElement>('[data-task-record]')].filter(record => {
        const box = record.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.bottom > Math.max(0, reading.top) && box.top < Math.min(innerHeight, reading.bottom) && box.right > Math.max(0, reading.left) && box.left < Math.min(innerWidth, reading.right);
      }).map(record => record.dataset.taskRecord))],
    };
  });
  // Geometry settles before the debounced viewport receipt is sent. Keep
  // capture active until that receipt is actually recorded; stopping earlier
  // cannot capture an event that has not happened yet.
  await expect.poll(async () => {
    const { events } = await (await api(page, { action: 'read', id })).json() as { events: TestEvent[] };
    const receipt = events.filter(event => event.type === 'http.request')
      .map(event => (event.data as { body?: { action?: string; ready?: boolean; recordIds?: string[] } }).body)
      .findLast(body => body?.action === 'ack' || body?.action === 'scene' && body.ready);
    return [...(receipt?.recordIds ?? [])].sort();
  }).toEqual([...displayed.records].sort());
  await recorder(page).locator('summary').click();
  await recorder(page).getByLabel('Problem note (optional)').fill('Check the photograph selection');
  await recorder(page).getByRole('button', { name: 'Mark a problem' }).click();
  await expect(recorder(page).getByRole('status').last()).toContainText('Marked at');
  await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
  await expect(recorder(page).getByRole('button', { name: 'Record test session', exact: true })).toBeEnabled();
  const events: TestEvent[] = (await (await api(page, { action: 'read', id })).json()).events;
  expect(events.some(event => event.type === 'chat.submitted')).toBe(true);
  expect(events.some(event => event.type === 'task.result')).toBe(true);
  const observed = events.filter(event => event.type === 'surface.observed').map(event => event.data as { stateId: string; requestId: string; pending?: string; regions: { id: string; role: string }[] }).findLast(event => event.stateId === displayed.stateId);
  expect(observed?.regions).toEqual(displayed.regions);
  expect(observed?.pending).toBeUndefined();
  expect(events.some(event => event.type === 'surface.request.committed' && (event.data as { stateId: string; requestId: string }).stateId === displayed.stateId && (event.data as { requestId: string }).requestId === observed?.requestId)).toBe(true);
  // Query surfaces confirm through the task ACK; workspace surfaces use
  // surface.confirmed. Assert the actual recorded visible records, not just
  // that an event with an old screen-event name exists.
  const receipts = events.filter(event => event.type === 'http.request').map(event => event.data as { body?: { action?: string; operationId?: string; ready?: boolean; recordIds?: string[] } });
  const acknowledgement = receipts.findLast(event => event.body?.action === 'ack')?.body;
  expect(acknowledgement?.recordIds?.length).toBeGreaterThan(0);
  // Responsive layout can settle after the initial ACK. Its subsequent ready
  // scene receipt must describe what is actually visible in the settled view.
  const receipt = receipts.findLast(event => event.body?.operationId === acknowledgement?.operationId && (event.body?.action === 'ack' || event.body?.action === 'scene' && event.body.ready))?.body;
  expect([...(receipt?.recordIds ?? [])].sort()).toEqual([...displayed.records].sort());
  expect(events.filter(event => event.type === 'problem.marked')).toHaveLength(1);
  expect(events.at(-1)?.type).toBe('recording.stopped');
  expect((await (await api(page, { action: 'list' })).json()).sessions.length).toBe(before.sessions.length + 1);
  await page.goto(`/dev/recordings?id=${id}`);
  await expect(page.getByRole('heading', { name: 'Local test timeline' })).toBeVisible();
  await page.getByLabel('Search time, text, request ID').fill('Check the photograph selection');
  await expect(page.getByRole('status')).toHaveText('1 matching events');
  await page.locator('main details summary').click();
  await expect(page.locator('main pre')).toContainText('Check the photograph selection');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`timeline-${mobile ? 'mobile' : 'desktop'}.png`) });
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export recording' }).click();
  expect((await download).suggestedFilename()).toBe(`flowpath-test-${id}.jsonl`);
  expect(errors).toEqual([]);
});

test('mocked voice captures transcripts and screen receipts, redacts control credentials, and keeps talking when recording stops', async ({ page }) => {
  await prepareCarouselVoice(page);
  const id = await start(page); await recorder(page).locator('summary').click();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'transcript', id: 'test-user', role: 'user', text: 'Show the published wedding information', revision: 1 });
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'recorded-navigation', revision: 1, target: { kind: 'source', id: 'section:weddings' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'recorded-navigation')?.navigationAck?.status)).toBe('applied');
  await recorder(page).locator('summary').click(); await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
  await expect(recorder(page).getByRole('button', { name: 'Record test session', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.stopped))).toBe(true);
  const events: TestEvent[] = (await (await api(page, { action: 'read', id })).json()).events;
  expect(events.some(event => event.type === 'voice.transcript')).toBe(true);
  expect(JSON.stringify(events)).toContain('recorded-navigation');
  expect(JSON.stringify(events)).not.toContain('a'.repeat(43));
  expect(JSON.stringify(events)).not.toContain('m=audio');
});

test('recording persistence failures leave the normal visitor controls usable', async ({ page }) => {
  await carouselFixture(page, true);
  await page.route('**/api/dev/recordings', route => route.request().postDataJSON().action === 'append' ? route.fulfill({ status: 503, json: { error: 'Synthetic disk failure' } }) : route.continue());
  await start(page);
  await expect(recorder(page).getByRole('alert')).toContainText('saving failed');
  await recorder(page).locator('summary').click();
  await ask(page, 'Show me your photos');
  await expect(page.locator('[data-ai-carousel]')).toContainText('9 matching items');
  await expect(page.locator('[data-ai-carousel]')).toHaveAttribute('aria-busy', 'false');
});

test('starting the recorder during voice requests attachment and reports success without reconnecting (mocked attachment)', async ({ page }) => {
  await prepareCarouselVoice(page);
  let attachments = 0;
  await page.route('**/api/dev/recordings', route => {
    if (route.request().postDataJSON().action !== 'attach-voice') return route.continue();
    attachments++;
    return route.fulfill({ json: { attached: true } });
  });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const before = await page.evaluate(() => window.__visitorVoice.calls);
  const id = await start(page);
  await expect(recorder(page).getByText('Voice server capture attached:', { exact: false })).toBeVisible();
  expect(attachments).toBe(1);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'transcript', id: 'phone-question', role: 'user', text: 'Repeat the number', revision: 1 });
    window.__visitorVoice.emit({ type: 'transcript', id: 'phone-answer', role: 'assistant', text: '212 555 0199', revision: 1 });
  });
  await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
  await expect(recorder(page).getByRole('button', { name: 'Record test session', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(before);
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.stopped))).toBe(true);
  const events = (await (await api(page, { action: 'read', id })).json()).events;
  expect(JSON.stringify(events)).toContain('Repeat the number');
  expect(JSON.stringify(events)).toContain('212 555 0199');
  expect(JSON.stringify(events)).not.toContain('a'.repeat(43));
});

test('an existing voice connection without a server observer shows incomplete capture', async ({ page }) => {
  await prepareCarouselVoice(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await start(page);
  await expect(recorder(page).getByText('Incomplete capture:', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
});
