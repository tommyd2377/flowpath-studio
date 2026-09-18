import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Site } from '../../lib/site-model';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult } from '../../lib/explore-model';

const origin = 'http://127.0.0.1:3225';
async function createSite(page: Page, enabled = true, mode: 'chat' | 'voice' = 'chat', annotations = false) {
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  }
  let site: Site = (await post('/api/sites', { name: 'Search explorer', slug: `explore-${randomUUID().slice(0, 12)}`, kind: 'photographer' })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    visitor: { enabled: true, mode, voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 },
    explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled, annotations },
  } })).site;
  return (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site as Site;
}
async function ask(page: Page, query: string) {
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await expect(input).not.toHaveAttribute('readonly');
  await input.fill(query); await input.press('Enter');
}
test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.addInitScript(() => { if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('No real microphone in offline tests'); }; });
});

test('published images, keyboard viewer, typed follow-up, maps and history work without outside requests', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const external: string[] = []; page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
  const site = await createSite(page);
  let requests = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/explore')) requests++; });
  await page.goto(`/s/${site.slug}`);
  const search = page.getByRole('region', { name: 'Search results', exact: true });
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Search the web, images or maps' })).toHaveCount(0);
  await ask(page, 'Show Wedding stories');
  await expect(page.locator('.platform-workspace-card[data-workspace-component="information"]')).toHaveCount(1);
  await ask(page, 'Find park images online');
  const image = search.getByRole('button', { name: /Open image 2:/ });
  await expect(image).toBeVisible(); await image.click();
  const viewer = page.getByRole('dialog', { name: 'Web image viewer' });
  await expect(viewer).toBeVisible(); await expect(viewer).toContainText('Landscape illustration 2');
  await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0); await expect(image).toBeFocused();
  const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await composer.fill('Open the second photo'); await composer.press('Enter');
  await expect(viewer).toBeVisible(); expect(requests).toBe(1);
  await page.keyboard.press('Escape');
  await ask(page, 'Show me a map of the U.S.');
  await expect(search.getByRole('heading', { name: 'United States overview' })).toBeVisible();
  await search.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(search.getByText('Overview zoom 4', { exact: true })).toBeVisible(); expect(requests).toBe(2);
  await search.filter({ has: page.getByRole('heading', { name: 'United States overview', exact: true }) }).getByRole('button', { name: 'Back', exact: true }).click(); await expect(image).toBeVisible();
  await page.screenshot({ path: info.outputPath('search-images-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(image).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('search-images-mobile.png'), fullPage: true });
  await search.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(search).toHaveCount(0);
  await expect(page.locator('.platform-workspace-card[data-workspace-component="information"]')).toHaveCount(1);
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('disabled capability stays hidden until saved and published through Studio', async ({ page }) => {
  const site = await createSite(page, false);
  await page.goto(`/s/${site.slug}`); await expect(page.getByRole('region', { name: 'Search results', exact: true })).toHaveCount(0);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'The Voice', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Search and explore settings' });
  await settings.getByRole('checkbox', { name: 'Allow visitors to search beyond this site' }).check();
  await settings.getByRole('textbox', { name: 'Search websites' }).fill('nps.gov, wikipedia.org');
  const save = page.getByRole('region', { name: 'Site editor', exact: true }).getByRole('button', { name: 'Save draft', exact: true });
  await save.click(); await expect(save).toBeDisabled();
  const current = (await (await page.request.get(`/api/sites/${site.id}`)).json()).site as Site;
  expect(current.draft.explore?.enabled).toBe(true); expect(current.published?.explore?.enabled).toBe(false);
  expect(current.draft.explore?.allowedDomains).toEqual(['nps.gov', 'wikipedia.org']);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('button', { name: 'Publish locally', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Publish locally', exact: true })).toHaveCount(0);
  await page.goto(`/s/${site.slug}`);
  await expect(page.getByRole('region', { name: 'Search results', exact: true })).toHaveCount(0);
  await ask(page, 'Search the web for parks');
  await expect(page.getByRole('region', { name: 'Search results', exact: true })).toBeVisible();
});

test('cancelled and failed searches retain the accepted view; map embeds use a fixed host', async ({ page }, info) => {
  const site = await createSite(page);
  await page.goto(`/s/${site.slug}`);
  const search = page.getByRole('region', { name: 'Search results', exact: true });
  await ask(page, 'Search the web: First search');
  await expect(search.getByRole('heading', { name: 'Search the web: First search' })).toBeVisible();
  await page.route(`**/api/visitor/${site.slug}/explore`, route => route.fulfill({ status: 502, json: { error: 'Synthetic provider failure' } }));
  await ask(page, 'Search the web: Failed search');
  await expect(page.getByRole('alert').filter({ hasText: 'Synthetic provider failure' })).toHaveText('Synthetic provider failure');
  await expect(search.getByRole('heading', { name: 'Search the web: First search' })).toBeVisible();
  await page.unroute(`**/api/visitor/${site.slug}/explore`);
  let release!: () => void;
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { result: demoExploreResult('Late search', 'web') } }).catch(() => undefined);
  });
  await ask(page, 'Search the web: Late search');
  await expect(page.getByRole('button', { name: 'Stop request', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop request', exact: true }).click(); release();
  await expect(search.getByRole('heading', { name: 'Search the web: First search' })).toBeVisible();
  await page.unroute(`**/api/visitor/${site.slug}/explore`);
  const result = { ...demoExploreResult('Map of the United States', 'map'), demo: false };
  expect(result.map).not.toBeNull();
  await page.route(`**/api/visitor/${site.slug}/explore`, route => route.fulfill({ json: { result } }));
  await page.route('https://www.openstreetmap.org/export/embed.html?**', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="background:#dce6e1;font-family:sans-serif"><p>Mocked interactive map transport</p></body></html>' }));
  await ask(page, 'United States map');
  const frame = search.getByTitle('Interactive map: United States overview'); await expect(frame).toBeVisible();
  expect(new URL(await frame.getAttribute('src') ?? '').hostname).toBe('www.openstreetmap.org');
  await expect(search.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('search-map-mocked.png'), fullPage: true });
});

declare global { interface Window { __searchVoice: { emit: (event: unknown) => void; controls: { interactionRevision?: number; navigationAck?: { id: string; status: string }; context?: { explore?: { selectedImageId: string | null }; scene?: { highlightedReference?: { kind: string; id: string } | null } } }[] } } }
test('voice applies search views and image commands through acknowledged navigation', async ({ page }) => {
  const site = await createSite(page, true, 'voice');
  await page.addInitScript(() => {
    const availability = { enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    let revision = 0;
    window.__searchVoice = { controls: [], emit(event) { const frame = event as { revision?: number }; revision = Math.max(revision, frame.revision ?? 0); sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); } };
    class Track { clone() { return new Track(); } enabled = true; onended: (() => void) | null = null; stop() {} }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class AudioNode { fftSize = 2048; gain = { value: 1 }; connect() { return this; } getByteTimeDomainData(array: Uint8Array) { array.fill(128); } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    class Context { state = 'running'; destination = new AudioNode(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { return new AudioNode(); } createGain() { return new AudioNode(); } createMediaStreamSource() { return new AudioNode(); } }
    class Audio { srcObject: unknown; muted = false; setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class Peer {
      iceGatheringState = 'complete'; connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
      addTrack() {} createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription() { return Promise.resolve(); }
      setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.ontrack?.({ streams: [new Stream()] }); return Promise.resolve(); }
      close() { this.connectionState = 'closed'; }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context }); Object.defineProperty(window, 'Audio', { value: Audio }); Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => new Stream() });
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && !init?.method) return Response.json({ availability });
      if (/\/session$/.test(path)) {
        const body = new ReadableStream<Uint8Array>({ start(controller) { sink = controller; }, cancel() { sink = undefined; } });
        window.__searchVoice.emit({ type: 'session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', availability, expiresAt: Date.now() + 120000, control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } });
        window.__searchVoice.emit({ type: 'ready' });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/\/session\/control$/.test(path)) {
        const { update } = JSON.parse(String(init?.body)); window.__searchVoice.controls.push(update);
        if (!update.end) window.__searchVoice.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision, ready: update.ready });
        return new Response(null, { status: 204 });
      }
      return fetch(input, init);
    };
  });
  await page.goto(`/s/${site.slug}`); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const result = demoExploreResult('Voice image search', 'images');
  await page.evaluate(result => {
    window.__searchVoice.emit({ type: 'response_started', revision: 1, interactionRevision: 0 });
    window.__searchVoice.emit({ type: 'navigation', id: 'search-view', revision: 1, interactionRevision: 0, target: { kind: 'explore', result } });
  }, result);
  await expect(page.getByRole('button', { name: /Open image 2:/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.some(update => update.navigationAck?.id === 'search-view' && update.navigationAck.status === 'applied'))).toBe(true);
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toHaveAttribute('data-workspace-transition', 'settled');
  await page.evaluate(id => {
    const interactionRevision = window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0;
    window.__searchVoice.emit({ type: 'response_started', revision: 2, interactionRevision });
    window.__searchVoice.emit({ type: 'navigation', id: 'open-photo', revision: 2, interactionRevision, target: { kind: 'explore', command: { kind: 'open_image', id } } });
  }, result.images[1].id);
  await expect(page.getByRole('dialog', { name: 'Web image viewer' })).toContainText('Landscape illustration 2');
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.some(update => update.navigationAck?.id === 'open-photo' && update.navigationAck.status === 'applied'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.at(-1)?.context?.explore?.selectedImageId)).toBe(result.images[1].id);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Web image viewer' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.at(-1)?.context?.explore?.selectedImageId)).toBe(null);
  const beforeReturn = await page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0);
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0)).toBeGreaterThan(beforeReturn);
  const beforeBrowse = await page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0);
  await page.getByRole('button', { name: 'Browse published content' }).click();
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0)).toBeGreaterThan(beforeBrowse);
  const tile = page.getByRole('region', { name: 'Browse approved information' }).getByRole('button', { name: 'Open Wedding stories', exact: true });
  await tile.scrollIntoViewIfNeeded();
  async function navigate(kind: 'spotlight' | 'open', revision: number) {
    const id = `${kind}-${revision}`;
    await page.evaluate(({ kind, revision, id }) => {
      const interactionRevision = window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0;
      window.__searchVoice.emit({ type: 'response_started', revision, interactionRevision });
      window.__searchVoice.emit({ type: 'navigation', id, revision, interactionRevision, target: { kind, id: 'source:section:weddings' } });
    }, { kind, revision, id });
    await expect.poll(() => page.evaluate(id => window.__searchVoice.controls.find(update => update.navigationAck?.id === id)?.navigationAck?.status, id)).toBe('applied');
  }
  await navigate('spotlight', 3); await expect(tile).toHaveAttribute('data-workspace-highlighted');
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.at(-1)?.context?.scene?.highlightedReference?.id)).toBe('section:weddings');
  await navigate('open', 4);
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  await expect(focused).toHaveAttribute('data-workspace-transition', 'settled');
  await navigate('spotlight', 5); await expect(focused).toHaveAttribute('data-workspace-highlighted');
  // Closing a search panel is a voice action, not a manual interruption of itself.
  const beforeClose = await page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0);
  await page.evaluate(() => {
    const interactionRevision = window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0;
    window.__searchVoice.emit({ type: 'response_started', revision: 6, interactionRevision });
    window.__searchVoice.emit({ type: 'navigation', id: 'close-search', revision: 6, interactionRevision, target: { kind: 'explore', command: { kind: 'back' } } });
  });
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.find(update => update.navigationAck?.id === 'close-search')?.navigationAck?.status)).toBe('applied');
  await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__searchVoice.controls.at(-1)?.interactionRevision)).toBe(beforeClose);
  await expect(focused.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const interactionRevision = window.__searchVoice.controls.at(-1)?.interactionRevision ?? 0;
    window.__searchVoice.emit({ type: 'response_started', revision: 7, interactionRevision });
    window.__searchVoice.emit({ type: 'navigation', id: 'voice-home', revision: 7, interactionRevision, target: { kind: 'home' } });
  });
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.find(update => update.navigationAck?.id === 'voice-home')?.navigationAck?.status)).toBe('applied');
  await expect(focused).toHaveCount(0); await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await expect(page.locator('[data-published-website]')).toHaveCount(0);
  await page.getByRole('button', { name: 'End voice conversation', exact: true }).click();
});

test('24-image grids use stable labels and expand web sources without another provider request', async ({ page }, info) => {
  const site = await createSite(page);
  const images = demoExploreResult('Current visual references', 'images');
  images.images = Array.from({ length: 24 }, (_, index) => ({ ...images.images[0], id: `synthetic-image-${index + 1}`, caption: `Synthetic visual reference ${index + 1}` }));
  let calls = 0;
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => { calls++; await route.fulfill({ json: { result: images } }); });
  await page.goto(`/s/${site.slug}`); await ask(page, 'Find visual reference images online');
  const focus = page.locator('[data-workspace-focused]:not([inert])');
  await expect(focus).toHaveAttribute('data-workspace-transition', 'settled');
  await expect(focus.locator('[data-external-item^="synthetic-image-"]')).toHaveCount(24);
  await ask(page, 'Expand B4');
  const viewer = page.getByRole('dialog', { name: 'Web image viewer' });
  await expect(viewer).toContainText('Synthetic visual reference 8');
  await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0);
  await ask(page, 'Expand image 23'); await expect(viewer).toContainText('Synthetic visual reference 23');
  await viewer.getByRole('img').click(); await expect(viewer).toHaveCount(0); expect(calls).toBe(1);
  await ask(page, 'Expand image 23'); await expect(viewer).toContainText('Synthetic visual reference 23');
  await page.mouse.click(8, 8); await expect(viewer).toHaveCount(0); expect(calls).toBe(1);
  await page.screenshot({ path: info.outputPath('web-images-labeled-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(focus.locator('[data-external-item="synthetic-image-8"]')).toHaveAttribute('data-external-label', 'B4');
  await expect.poll(async () => { const box = await focus.boundingBox(); return !!box && box.x >= 0 && box.x + box.width <= 390.5; }).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('web-images-labeled-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect.poll(async () => (await focus.boundingBox())?.width).toBe(900);
  await page.unroute(`**/api/visitor/${site.slug}/explore`);
  const web = { ...images, id: randomUUID(), kind: 'web' as const, query: 'Cited web sources', images: images.images.slice(0, 4), sources: Array.from({ length: 8 }, (_, i) => ({ title: `Reference source ${i + 1}`, url: `https://www.nps.gov/reference-${i + 1}` })) };
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => { calls++; await route.fulfill({ json: { result: web } }); });
  await ask(page, 'Search the web for reference sources'); await expect(focus).toContainText('Cited web sources');
  await ask(page, 'Expand result B4');
  const source = page.getByRole('dialog', { name: 'Web result viewer' });
  await expect(source.getByRole('heading', { name: 'Reference source 8' })).toBeVisible(); expect(calls).toBe(2);
  await source.getByRole('heading', { name: 'Reference source 8' }).click(); await expect(source).toHaveCount(0);
  await expect(focus.locator('.platform-external')).toHaveCSS('opacity', '1');
  await expect(focus.locator('.platform-external-sources article').first()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('web-sources-desktop.png') });
});

test('whole-card clicks, background return, hover, highlight and optional web additions preserve published content', async ({ page }, info) => {
  const site = await createSite(page, true, 'chat', true);
  await page.goto(`/s/${site.slug}`);
  await page.getByRole('button', { name: 'Browse published content' }).click();
  const tile = page.getByRole('region', { name: 'Browse approved information' }).getByRole('button', { name: 'Open Wedding stories', exact: true });
  await tile.hover(); await expect(tile).not.toHaveCSS('box-shadow', 'none');
  await ask(page, 'Highlight Wedding stories'); await expect(tile).toHaveAttribute('data-workspace-highlighted');
  const focus = page.locator('[data-workspace-focused]:not([inert])');
  await expect(focus).toHaveCount(0);
  await tile.click(); await expect(focus).toHaveAttribute('data-workspace-transition', 'settled');
  await focus.locator('.platform-workspace-copy > p').click(); await expect(focus).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide browser', exact: true }).click();
  // The retained card can be opened from its body, not only its header button.
  const card = page.locator('.platform-workspace-card[data-workspace-component="information"]');
  await card.locator('.platform-workspace-copy > p').click(); await expect(focus).toHaveAttribute('data-workspace-transition', 'settled');
  const bounds = await focus.boundingBox();
  await page.mouse.click(Math.max(4, bounds!.x - 12), bounds!.y + 100); await expect(focus).toHaveCount(0);
  await ask(page, 'Pull up Wedding stories'); await expect(focus).toHaveAttribute('data-workspace-transition', 'settled');
  let calls = 0; page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/explore')) calls++; });
  await focus.getByRole('button', { name: 'Add web context', exact: true }).click();
  const additions = focus.getByRole('region', { name: 'Web additions' });
  await expect(additions.getByRole('button', { name: 'Remove web context' })).toBeVisible();
  await expect(additions).toContainText('Synthetic preview'); expect(calls).toBe(1);
  await expect(additions.locator('.platform-external')).toHaveCSS('opacity', '1');
  await expect(additions.locator('.platform-external-sources article').first()).toHaveCSS('opacity', '1');
  expect((await (await page.request.get(`/api/sites/${site.id}`)).json()).site.published).toEqual(site.published);
  await page.screenshot({ path: info.outputPath('card-web-addition.png') });
  await additions.getByRole('button', { name: 'Remove web context' }).click(); await expect(additions.getByRole('region', { name: 'Search results' })).toHaveCount(0);
  let release!: () => void;
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => {
    const { annotationTarget } = route.request().postDataJSON();
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { result: { ...demoExploreResult('Late addition', 'web'), annotationTarget } } }).catch(() => undefined);
  });
  await focus.getByRole('button', { name: 'Add web context' }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(additions).toHaveAttribute('aria-busy', 'true');
  await expect(additions.getByRole('status')).toHaveText('Finding web context…');
  await expect(additions.getByRole('button', { name: 'Add web context' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: /^Searching the web…$/ })).toBeVisible();
  await focus.getByRole('button', { name: 'Close Wedding stories', exact: true }).click(); release();
  await expect(focus).toHaveCount(0); await expect(card).toHaveCount(0);
  await expect(page.getByText('Late addition', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: /^Searching the web…$/ })).toHaveCount(0);
});

test('explicit clear releases retained external results without restoring stale search context', async ({ page }) => {
  const site = await createSite(page); await page.goto(`/s/${site.slug}`);
  for (let index = 0; index < 6; index++) {
    await ask(page, `Search the web: Synthetic set ${index + 1}`);
    await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(index + 1);
  }
  await page.getByRole('button', { name: 'Close External web results', exact: true }).first().click();
  await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(5);
  await ask(page, 'Search the web: Replacement for closed result');
  await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear workspace', exact: true }).click();
  await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await ask(page, 'Search the web: Fresh results');
  await expect(page.locator('.platform-workspace-card[data-workspace-component="external"]')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Search the web: Fresh results', exact: true })).toBeVisible();
});
