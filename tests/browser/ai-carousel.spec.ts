import { test, expect, type Page } from '@playwright/test';
import { carouselFixture } from './helpers/carousel-fixture';
import { prepareCarouselVoice } from './helpers/carousel-voice';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';
import type { Site } from '../../lib/site-model';

const origin = 'http://127.0.0.1:3225';
const carousel = (page: Page) => page.locator('[data-ai-carousel]');
async function ask(page: Page, question: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  if (!await input.isVisible()) await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.fill(question); await input.press('Enter');
  await expect(page.locator('.platform-conversation-dock')).toHaveAttribute('data-expanded', 'false');
}
async function post(page: Page, path: string, data: unknown) { const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBe(true); return body; }

for (const mobile of [false, true]) test(`carousel leaves the website intact, opens photos, expands, returns and dismisses${mobile ? ' on mobile with reduced motion' : ''}`, async ({ page }, info) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const taskRequests: string[] = []; page.on('request', request => { if (request.url().endsWith('/tasks')) taskRequests.push(request.postData() ?? ''); });
  await carouselFixture(page, true);
  const site = page.locator('[data-published-website]');
  const before = await site.innerText();
  await site.getByText('hello@harbor.example', { exact: true }).scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  expect(taskRequests).toEqual([]);
  await expect(page.getByText('Browse and filter collections', { exact: true })).toHaveCount(0);
  await ask(page, 'Show me your photos');
  await expect(carousel(page)).toContainText('9 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await expect(carousel(page).locator('[data-carousel-card]')).toHaveCount(1);
  await expect(carousel(page).locator('img')).toBeVisible();
  const first = await carousel(page).getAttribute('data-active-card');
  await carousel(page).getByRole('button', { name: 'Next card', exact: true }).click();
  await expect(carousel(page)).not.toHaveAttribute('data-active-card', first!);
  await expect(carousel(page).getByRole('button', { name: 'Next card', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(carousel(page).locator('footer')).toContainText('3 / 9');
  const second = await carousel(page).getAttribute('data-active-card');
  await ask(page, 'Expand'); await expect(carousel(page).locator('[data-carousel-card]')).toHaveAttribute('data-expanded', 'true');
  await ask(page, 'Collapse'); await expect(carousel(page).locator('[data-carousel-card]')).toHaveAttribute('data-expanded', 'false');
  await page.screenshot({ path: info.outputPath(`carousel-${mobile ? 'mobile' : 'desktop'}.png`) });
  await page.keyboard.press('Escape');
  await expect(carousel(page)).toBeHidden();
  expect(await site.innerText()).toBe(before);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await page.getByRole('textbox', { name: 'What would you like to see?' }).click();
  await expect(carousel(page)).toHaveAttribute('data-active-card', second!);
  await page.locator('[data-ai-backdrop]').click({ position: { x: 4, y: mobile ? 250 : 400 } });
  await expect(carousel(page)).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

for (const kind of ['products', 'services'] as const) test(`${kind}: typed filters, broadening, ordering, detail return and reset use the carousel`, async ({ page }) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  let site: Site = (await post(page, '/api/sites', { name: `Carousel ${kind}`, slug: `carousel-${kind}-${Date.now()}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication: _publication, ...metadata } = websiteTaskFixture(kind, 40);
  expect(_publication).toBeTruthy();
  let review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records, memberships, relationships } })).review;
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision })).review;
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await ask(page, kind === 'products' ? 'Show me chocolate' : 'Show me remote');
  await expect(carousel(page)).toContainText('14 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Only those under $40'); await expect(carousel(page)).toContainText('6 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, kind === 'products' ? 'Include vanilla too' : 'Include studio too'); await expect(carousel(page)).toContainText('13 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Sort price descending'); await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await carousel(page).getByRole('button', { name: 'Next card' }).click();
  const current = await carousel(page).getAttribute('data-active-card');
  await carousel(page).getByRole('button', { name: 'Read details' }).click();
  await expect(carousel(page).getByRole('region', { name: 'Record detail' })).toBeVisible();
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Go back to those results'); await expect(carousel(page)).toHaveAttribute('data-active-card', current!);
  await ask(page, 'Remove the price limit'); await expect(carousel(page)).toContainText('27 matching items');
  await ask(page, 'Only those under $1'); await expect(carousel(page)).toContainText('No matches yet');
  await ask(page, 'Show everything again'); await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await expect(carousel(page)).not.toContainText('No matches yet');
});

test('mock voice receives the active card receipt, switches to chat and stops on dismissal', async ({ page }) => {
  await prepareCarouselVoice(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'response_started', revision: 1 }); window.__visitorVoice.emit({ type: 'navigation', id: 'open-source', revision: 1, target: { kind: 'source', id: 'section:weddings' } }); });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'open-source')?.navigationAck?.status)).toBe('applied');
  const context = await page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'open-source')!.context);
  expect(context.screen).toBeUndefined(); expect(context.scene?.browseItems).toBeUndefined(); expect(context.carousel?.open).toBe(true);
  expect(context.carousel?.cards.find(card => card.id === context.carousel?.activeId)?.referenceIds.join(' ')).toContain('section:weddings');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What would you like to see?' })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(carousel(page)).toBeHidden();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.stopped))).toBe(true);
});

for (const mobile of [false, true]) test(`gallery requests survive answer updates but reject a changed card${mobile ? ' on mobile' : ''}`, async ({ page }) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  const site = await prepareCarouselVoice(page, true);
  const { library } = await (await page.request.get(`/api/sites/${site.id}/media`)).json();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.context.carousel?.open)).toBe(true);
  const before = await page.evaluate(() => window.__visitorVoice.controls.at(-1)!.context);
  const gallery = { instanceId: 'requested-photos', component: 'gallery' as const, references: [{ kind: 'photo' as const, id: library.assets[0].id, revisionId: site.published!.mediaRevisionId! }] };
  const batch = { schemaVersion: 1 as const, requestId: 'gallery-after-answer', publicationId: before.workspace!.publicationId, baseRevision: before.workspace!.revision, sceneRevision: before.scene!.revision,
    operations: [{ kind: 'add' as const, object: gallery }, { kind: 'focus' as const, instanceId: gallery.instanceId }] };
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'answer-before-gallery', revision: 1, target: { kind: 'answer', text: 'These are the published photographs.' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'answer-before-gallery')?.navigationAck?.status)).toBe('applied');
  await page.evaluate(batch => window.__visitorVoice.emit({ type: 'navigation', id: 'gallery-after-answer', revision: 1, target: { kind: 'workspace', batch } }), batch);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'gallery-after-answer')?.navigationAck?.status)).toBe('applied');
  await expect(carousel(page).locator('img')).toBeVisible();
  await expect(carousel(page).getByRole('alert')).toHaveCount(0);
  const after = await page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'gallery-after-answer')!.context);
  // A real manual change must still invalidate a batch resolved against the old scene.
  await carousel(page).getByRole('button', { name: 'Expand card', exact: true }).click();
  await expect(carousel(page).locator('[data-carousel-card]')).toHaveAttribute('data-expanded', 'true');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.interactionRevision ?? 0)).toBeGreaterThan(0);
  const stale = { ...batch, requestId: 'stale-gallery', baseRevision: after.workspace!.revision, sceneRevision: after.scene!.revision };
  await page.evaluate(batch => {
    const interactionRevision = window.__visitorVoice.controls.at(-1)!.interactionRevision;
    window.__visitorVoice.emit({ type: 'response_started', revision: 2, interactionRevision });
    window.__visitorVoice.emit({ type: 'navigation', id: 'stale-gallery', revision: 2, interactionRevision, target: { kind: 'workspace', batch } });
  }, stale);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'stale-gallery')?.navigationAck?.status)).toBe('failed');
  await expect(carousel(page).locator('img')).toBeVisible();
  await expect(carousel(page).locator('[data-carousel-card]')).toHaveAttribute('data-expanded', 'true');
});

test('typed gallery requests use the same stable scene after an answer receipt', async ({ page }) => {
  const site = await prepareCarouselVoice(page, true);
  const { library } = await (await page.request.get(`/api/sites/${site.id}/media`)).json();
  await page.evaluate(reference => {
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        const request = JSON.parse(String(init.body)); window.__visitorVoice.chats.push(request);
        const batch = { schemaVersion: 1, requestId: 'typed-gallery', publicationId: request.context.workspace.publicationId,
          baseRevision: request.context.workspace.revision, sceneRevision: request.context.scene.revision,
          operations: [{ kind: 'add', object: { instanceId: 'typed-photos', component: 'gallery', references: [reference] } }, { kind: 'focus', instanceId: 'typed-photos' }] };
        const events = [
          { type: 'control', control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } },
          { type: 'navigation', id: '00000000-0000-4000-8000-000000000002', target: { kind: 'answer', text: 'These are the published photographs.' } },
          { type: 'navigation', id: '00000000-0000-4000-8000-000000000003', target: { kind: 'workspace', batch } },
          { type: 'done', text: 'Published photo gallery.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } },
        ];
        return new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return original(input, init);
    };
  }, { kind: 'photo', id: library.assets[0].id, revisionId: site.published!.mediaRevisionId! });
  await ask(page, 'Could you explain the photographs and then put their gallery on screen?');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.chats.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === '00000000-0000-4000-8000-000000000003')?.navigationAck?.status)).toBe('applied');
  await expect(carousel(page).locator('img')).toBeVisible();
  await expect(carousel(page).getByRole('alert')).toHaveCount(0);
});

test('pending work retains useful cards; newer input, dismissal and failures cannot overwrite them', async ({ page }) => {
  await carouselFixture(page, true);
  await ask(page, 'Show me your photos'); await expect(carousel(page)).toContainText('9 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  let release!: () => void, arrived = false;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/tasks', async route => {
    const data = route.request().postDataJSON();
    if (data.action === 'execute' && data.call?.input?.text === 'Only price under $1') {
      const response = await route.fetch(); arrived = true; await held;
      await route.fulfill({ response }).catch(() => undefined); return;
    }
    await route.continue();
  });
  const prior = await carousel(page).getAttribute('data-active-card');
  await ask(page, 'Only price under $1'); await expect.poll(() => arrived).toBe(true);
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'true'); await expect(carousel(page)).toHaveAttribute('data-active-card', prior!);
  await ask(page, 'Show everything again'); release();
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false'); await expect(carousel(page)).not.toContainText('No matches yet');
  await page.unroute('**/tasks');
  await ask(page, 'Show me your photos'); await expect(carousel(page)).toContainText('9 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await page.route('**/tasks', async route => { const data = route.request().postDataJSON(); if (data.action === 'execute') return route.fulfill({ status: 503, json: { error: 'Synthetic connection failure' } }); return route.continue(); });
  await ask(page, 'Only price under $1'); await expect(carousel(page)).toContainText('Synthetic connection failure'); await expect(carousel(page)).toContainText('9 matching items');
  await page.unroute('**/tasks');
  await ask(page, 'Show everything again'); await expect(carousel(page)).not.toContainText('Synthetic connection failure');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  let homeRelease!: () => void, homeArrived = false;
  const beforeHome = new Promise<void>(resolve => { homeRelease = resolve; });
  await page.route('**/tasks', async route => { const data = route.request().postDataJSON(); if (data.action === 'execute' && data.call?.input?.text === 'Only price under $1') { const response = await route.fetch(); homeArrived = true; await beforeHome; await route.fulfill({ response }).catch(() => undefined); return; } await route.continue(); });
  await ask(page, 'Only price under $1'); await expect.poll(() => homeArrived).toBe(true);
  await ask(page, 'Home'); homeRelease(); await expect(carousel(page)).toBeHidden();
  await page.unroute('**/tasks');
  await page.getByRole('textbox', { name: 'What would you like to see?' }).click();
  await expect(carousel(page)).not.toContainText('No matches yet');
  await page.keyboard.press('Escape'); await expect(carousel(page)).toBeHidden();
  await expect(page.locator('[data-website-background]')).not.toHaveAttribute('inert');
  const scenes: string[] = []; page.on('request', request => { if (request.url().endsWith('/tasks') && request.postDataJSON()?.action === 'scene') scenes.push(request.url()); });
  await page.mouse.wheel(0, 700); await page.waitForTimeout(300); expect(scenes).toEqual([]);
});

test('ten thousand nested records stay paged in the normal website and searchable in the carousel', async ({ page }) => {
  test.setTimeout(180000);
  let site: Site = (await post(page, '/api/sites', { name: 'Large published collection', slug: `carousel-large-${Date.now()}`, kind: 'general' })).site;
  const { records, memberships, relationships, publication: _publication, ...metadata } = websiteTaskFixture('products', 10000);
  expect(_publication).toBeTruthy();
  let review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata })).review;
  for (let offset = 0; offset < records.length; offset += 100) {
    const batch = records.slice(offset, offset + 100), ids = new Set(batch.map(record => record.id));
    review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: batch, memberships: memberships.filter(member => ids.has(member.recordId)), relationships: relationships.filter(relation => ids.has(relation.fromId)) } })).review;
  }
  review = (await post(page, `/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision })).review;
  site = (await post(page, `/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await expect(page.locator('[data-published-website] .platform-content-card')).toHaveCount(24);
  await page.getByRole('navigation', { name: 'Collection pages' }).getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByRole('navigation', { name: 'Collection pages' })).toContainText('2 / 417');
  await ask(page, 'Show me chocolate'); await expect(carousel(page)).toContainText('3334 matching items');
  // These are dependent commands: visible text can precede the exact receipt.
  // Deliberate interruption before that receipt is covered by the pending-work case.
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Open 999'); await expect(carousel(page).getByRole('region', { name: 'Record detail' })).toBeVisible();
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Go back to those results'); await expect(carousel(page)).toContainText('3334 matching items');
  await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await ask(page, 'Only those under $40'); await expect(carousel(page)).toHaveAttribute('aria-busy', 'false');
  await expect(carousel(page)).not.toContainText('No matches yet');
  expect(await carousel(page).locator('[data-carousel-card]').count()).toBe(1);
});

test('published YouTube cards use a mocked player and retain paused playback on return', async ({ page }) => {
  await page.addInitScript(() => {
    const state = { seconds: 0, paused: true, destroyed: 0 };
    Object.assign(window, { __carouselPlayer: state, YT: { Player: class {
      node: HTMLElement; options: { events: { onReady: () => void; onStateChange: (event: { data: number }) => void } }; muted = false;
      constructor(node: HTMLElement, options: { events: { onReady: () => void; onStateChange: (event: { data: number }) => void } }) { this.node = node; this.options = options; node.textContent = 'Mock video frame'; const button = document.createElement('button'); button.textContent = 'Advance mock video'; button.onclick = () => { state.seconds = 12; this.playVideo(); }; node.append(button); setTimeout(() => options.events.onReady(), 0); }
      playVideo() { state.paused = false; this.options.events.onStateChange({ data: 1 }); }
      pauseVideo() { state.paused = true; this.options.events.onStateChange({ data: 2 }); }
      destroy() { state.paused = true; state.destroyed++; this.node.remove(); }
      getCurrentTime() { return state.seconds; } getPlayerState() { return state.paused ? 2 : 1; } mute() { this.muted = true; } isMuted() { return this.muted; } seekTo(seconds: number) { state.seconds = seconds; }
    } } });
  });
  let site = await carouselFixture(page);
  const mediaResponse = await page.request.get(`/api/sites/${site.id}/media`); const media = await mediaResponse.json();
  site = (await post(page, `/api/sites/${site.id}/media`, { revision: site.revision, library: { ...media.library, videos: [{ id: 'studio-film', title: 'Studio film', description: 'A synthetic published film.', source: { kind: 'youtube', videoId: 'abcdefghijk' }, transcript: [{ start: 0, end: 20, text: 'Preparing the clay.' }] }] } })).site;
  site = (await post(page, `/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.reload(); await ask(page, 'Show me videos');
  await expect(carousel(page).getByRole('button', { name: 'Play Studio film' })).toBeVisible();
  await carousel(page).getByRole('button', { name: 'Play Studio film' }).click();
  await carousel(page).getByRole('button', { name: 'Advance mock video' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __carouselPlayer: { seconds: number } }).__carouselPlayer.seconds)).toBe(12);
  await page.keyboard.press('Escape'); await expect(carousel(page)).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { __carouselPlayer: { paused: boolean } }).__carouselPlayer.paused)).toBe(true);
  await page.getByRole('textbox', { name: 'What would you like to see?' }).click();
  await expect(carousel(page).getByText('Mock video frame', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __carouselPlayer: { paused: boolean; seconds: number } }).__carouselPlayer)).toMatchObject({ paused: true, seconds: 12 });
});
