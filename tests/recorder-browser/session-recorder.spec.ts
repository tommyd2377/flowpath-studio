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
  await carouselFixture(page, true);
  const before = await (await api(page, { action: 'list' })).json();
  const id = await start(page); await recorder(page).locator('summary').click();
  await ask(page, 'Show me your photos');
  await expect(page.locator('[data-ai-carousel]')).toContainText('9 matching items');
  await expect(page.locator('[data-ai-carousel]')).toHaveAttribute('aria-busy', 'false');
  await recorder(page).locator('summary').click();
  await recorder(page).getByLabel('Problem note (optional)').fill('Check the photograph selection');
  await recorder(page).getByRole('button', { name: 'Mark a problem' }).click();
  await expect(recorder(page).getByRole('status').last()).toContainText('Marked at');
  await recorder(page).getByRole('button', { name: 'Stop recording' }).click();
  await expect(recorder(page).getByRole('button', { name: 'Record test session', exact: true })).toBeEnabled();
  const events: TestEvent[] = (await (await api(page, { action: 'read', id })).json()).events;
  expect(events.some(event => event.type === 'chat.submitted')).toBe(true);
  expect(events.some(event => event.type === 'task.result')).toBe(true);
  expect(events.some(event => event.type === 'screen.observed')).toBe(true);
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
