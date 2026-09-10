import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Site } from '../../lib/site-model';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult } from '../../lib/explore-model';

const origin = 'http://127.0.0.1:3225';
async function createSite(page: Page, enabled = true, mode: 'chat' | 'voice' = 'chat') {
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    expect(response.ok(), await response.text()).toBeTruthy(); return response.json();
  }
  let site: Site = (await post('/api/sites', { name: 'Search explorer', slug: `explore-${randomUUID().slice(0, 12)}`, kind: 'photographer' })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    visitor: { enabled: true, mode, voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 },
    explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled },
  } })).site;
  return (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site as Site;
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
  const search = page.getByRole('region', { name: 'Search and explore', exact: true });
  await search.getByRole('button', { name: 'Images', exact: true }).click();
  await search.getByRole('textbox').fill('Park images');
  await search.getByRole('button', { name: 'Search', exact: true }).click();
  const image = search.getByRole('button', { name: /Open image 2:/ });
  await expect(image).toBeVisible(); await image.click();
  const viewer = page.getByRole('dialog', { name: 'Web image viewer' });
  await expect(viewer).toBeVisible(); await expect(viewer).toContainText('Landscape illustration 2');
  await page.keyboard.press('Escape'); await expect(viewer).toHaveCount(0); await expect(image).toBeFocused();
  const composer = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await composer.fill('Open the second photo'); await composer.press('Enter');
  await expect(viewer).toBeVisible(); expect(requests).toBe(1);
  await page.keyboard.press('Escape');
  await search.getByRole('button', { name: 'Map', exact: true }).click();
  await search.getByRole('textbox').fill('Show me a map of the U.S.'); await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search.getByRole('heading', { name: 'United States overview' })).toBeVisible();
  await search.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(search.getByText('Overview zoom 4', { exact: true })).toBeVisible(); expect(requests).toBe(2);
  await search.getByRole('button', { name: 'Back', exact: true }).click(); await expect(image).toBeVisible();
  await page.screenshot({ path: info.outputPath('search-images-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(image).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('search-images-mobile.png'), fullPage: true });
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('disabled capability stays hidden until saved and published through Studio', async ({ page }) => {
  const site = await createSite(page, false);
  await page.goto(`/s/${site.slug}`); await expect(page.getByRole('region', { name: 'Search and explore', exact: true })).toHaveCount(0);
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(site.id);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Content', exact: true }).click();
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
  await expect(page.getByRole('region', { name: 'Search and explore', exact: true })).toBeVisible();
});

test('cancelled and failed searches retain the accepted view; map embeds use a fixed host', async ({ page }, info) => {
  const site = await createSite(page);
  await page.goto(`/s/${site.slug}`);
  const search = page.getByRole('region', { name: 'Search and explore', exact: true });
  await search.getByRole('textbox').fill('First search'); await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search.getByRole('heading', { name: 'First search' })).toBeVisible();
  await page.route(`**/api/visitor/${site.slug}/explore`, route => route.fulfill({ status: 502, json: { error: 'Synthetic provider failure' } }));
  await search.getByRole('textbox').fill('Failed search'); await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search.getByRole('alert')).toHaveText('Synthetic provider failure');
  await expect(search.getByRole('heading', { name: 'First search' })).toBeVisible();
  await page.unroute(`**/api/visitor/${site.slug}/explore`);
  let release!: () => void;
  await page.route(`**/api/visitor/${site.slug}/explore`, async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { result: demoExploreResult('Late search', 'web') } }).catch(() => undefined);
  });
  await search.getByRole('textbox').fill('Late search'); await search.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(search.getByRole('button', { name: 'Stop search', exact: true })).toBeVisible();
  await search.getByRole('button', { name: 'Images', exact: true }).click(); release();
  await expect(search.getByRole('heading', { name: 'First search' })).toBeVisible();
  await page.unroute(`**/api/visitor/${site.slug}/explore`);
  const result = { ...demoExploreResult('United States map', 'map'), demo: false };
  await page.route(`**/api/visitor/${site.slug}/explore`, route => route.fulfill({ json: { result } }));
  await page.route('https://www.openstreetmap.org/export/embed.html?**', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="background:#dce6e1;font-family:sans-serif"><p>Mocked interactive map transport</p></body></html>' }));
  await search.getByRole('button', { name: 'Map', exact: true }).click();
  await search.getByRole('textbox').fill('United States map'); await search.getByRole('button', { name: 'Search', exact: true }).click();
  const frame = search.getByTitle('Interactive map: United States overview'); await expect(frame).toBeVisible();
  expect(new URL(await frame.getAttribute('src') ?? '').hostname).toBe('www.openstreetmap.org');
  await expect(search.getByRole('link', { name: '© OpenStreetMap contributors' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('search-map-mocked.png'), fullPage: true });
});

declare global { interface Window { __searchVoice: { emit: (event: unknown) => void; controls: { navigationAck?: { id: string; status: string }; context?: { explore?: { selectedImageId: string | null } } }[] } } }
test('voice applies search views and image commands through acknowledged navigation', async ({ page }) => {
  const site = await createSite(page, true, 'voice');
  await page.addInitScript(() => {
    const availability = { enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    let revision = 0;
    window.__searchVoice = { controls: [], emit(event) { const frame = event as { revision?: number }; revision = Math.max(revision, frame.revision ?? 0); sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`)); } };
    class Track { enabled = true; onended: (() => void) | null = null; stop() {} }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class AudioNode { fftSize = 2048; gain = { value: 1 }; connect() { return this; } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    class Context { state = 'running'; destination = new AudioNode(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { return new AudioNode(); } createGain() { return new AudioNode(); } createMediaStreamSource() { return new AudioNode(); } }
    class Audio { srcObject: unknown; muted = false; setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class Peer {
      connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
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
  await page.evaluate(id => {
    window.__searchVoice.emit({ type: 'response_started', revision: 2, interactionRevision: 0 });
    window.__searchVoice.emit({ type: 'navigation', id: 'open-photo', revision: 2, interactionRevision: 0, target: { kind: 'explore', command: { kind: 'open_image', id } } });
  }, result.images[1].id);
  await expect(page.getByRole('dialog', { name: 'Web image viewer' })).toContainText('Landscape illustration 2');
  await expect.poll(() => page.evaluate(() => window.__searchVoice.controls.some(update => update.navigationAck?.id === 'open-photo' && update.navigationAck.status === 'applied'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Web image viewer' })).toHaveCount(0);
  await page.getByRole('button', { name: 'End voice conversation', exact: true }).click();
});
