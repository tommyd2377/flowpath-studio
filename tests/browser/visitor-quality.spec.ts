import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Site } from '../../lib/site-model';

const origin = 'http://127.0.0.1:3225';
type QualityHarness = { navigation: { id: string; status: string }[]; calls: number; stopped: number; denyMicrophone: boolean; interactionRevision: number; emit: (event: unknown) => void };
declare global { interface Window { __visitorQuality: QualityHarness } }
test.use({ hasTouch: true });
const publications = new Map<string, Site>();

async function publication(page: Page, mode: 'voice' | 'chat', withCatalog: boolean) {
  const key = `${mode}:${withCatalog}`;
  const cached = publications.get(key);
  if (cached) return cached;
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  }
  let site: Site = (await post('/api/sites', { name: 'Synthetic visitor quality', slug: `quality-${Date.now()}`, kind: 'photographer' })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft,
    visitorSpeaksFirst: true, visitor: { enabled: true, mode, voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 },
    sections: Array.from({ length: 12 }, (_, index) => ({ id: `quality-${index}`, title: `Published topic ${index + 1}`,
      body: 'This is published synthetic information for a long visitor page. The details stay available while exploring another view. '.repeat(20) })),
  } })).site;
  if (withCatalog) {
    const uploaded = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'quality-catalog.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from('ID,Name,Price [USD]\none,First published item,10\ntwo,Second published item,20\n') });
    expect(uploaded.ok()).toBe(true); site = (await uploaded.json()).site;
    const knowledge = await post(`/api/sites/${site.id}/knowledge`, { action: 'analyze', fileId: site.files[0].id, revision: site.revision, requestId: randomUUID() });
    expect(knowledge.candidates).toHaveLength(1);
    site = (await post(`/api/sites/${site.id}/knowledge`, { action: 'apply', candidateId: knowledge.candidates[0].id, revision: site.revision })).site;
  }
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  // Tests only read these two publications; each test still owns its browser and voice mocks.
  publications.set(key, site);
  return site;
}

async function prepare(page: Page, mode: 'voice' | 'chat' = 'voice', withCatalog = false) {
  const site = await publication(page, mode, withCatalog);
  await page.addInitScript(mode => {
    const availability = { enabled: true, mode, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    const state: QualityHarness = { navigation: [], calls: 0, stopped: 0, denyMicrophone: false, interactionRevision: 0,
      emit(event) { const frame = event as { type: string; interactionRevision?: number }; sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(['response_started', 'plan', 'playback_started', 'transcript', 'navigation'].includes(frame.type) ? { interactionRevision: state.interactionRevision, ...frame } : frame)}\n`)); } };
    window.__visitorQuality = state;
    class Track { clone() { return new Track(); } enabled = true; onended: (() => void) | null = null; stop() { state.stopped++; } }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class Node { getByteTimeDomainData(array: Uint8Array) { array.fill(128); } fftSize = 2048; gain = { value: 1 }; connect() { return this; } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    class Context { state = 'running'; destination = new Node(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { return new Node(); } createGain() { return new Node(); } createMediaStreamSource() { return new Node(); } }
    class Audio { autoplay = false; srcObject: unknown; setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class Peer {
      iceGatheringState = 'complete'; connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
      addTrack() {} createDataChannel() { throw new Error('Provider commands cannot originate in the browser'); }
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription() { return Promise.resolve(); }
      setRemoteDescription() { this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.ontrack?.({ streams: [new Stream()] }); return Promise.resolve(); }
      close() { this.connectionState = 'closed'; }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
    Object.defineProperty(window, 'Audio', { value: Audio });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (state.denyMicrophone) throw new DOMException('Synthetic microphone refusal', 'NotAllowedError');
      return new Stream();
    } });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && !init?.method) return Response.json({ availability });
      if (/\/api\/visitor\/[^/]+\/session$/.test(path)) {
        state.calls++;
        const body = new ReadableStream<Uint8Array>({ start(controller) { sink = controller; }, cancel() { sink = undefined; } });
        state.emit({ type: 'session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', availability, expiresAt: Date.now() + 120000, control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } });
        state.emit({ type: 'ready' });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/\/api\/visitor\/[^/]+\/session\/control$/.test(path)) {
        const { update } = JSON.parse(String(init?.body)); if (update.end) queueMicrotask(() => state.emit({ type: 'ended', message: 'Ended.' }));
        state.interactionRevision = update.interactionRevision;
        if (update.navigationAck) state.navigation.push(update.navigationAck);
        if (!update.end) state.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision: update.viewRevision, ready: update.ready });
        return new Response(null, { status: 204 });
      }
      return originalFetch(input, init);
    };
  }, mode);
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.goto(`/s/${site.slug}`);
  if (mode === 'voice') await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
  else await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeEnabled();
  return site;
}

async function showView(page: Page, index: number) {
  await expect.poll(() => page.evaluate(() => window.__visitorQuality.calls)).toBeGreaterThan(0);
  await page.evaluate(index => {
    const emit = window.__visitorQuality.emit;
    emit({ type: 'speech_started', revision: index + 1 });
    emit({ type: 'speech_stopped' });
    emit({ type: 'response_started', revision: index + 1 });
    emit({ type: 'plan', revision: index + 1, presentation: { layout: 'detail', sources: [`section:quality-${index}`], status: 'ready' } });
    emit({ type: 'playback_started', responseId: `quality-response-${index}` });
  }, index);
  await expect(page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { name: `Published topic ${index + 1}`, exact: true })).toBeVisible();
}

async function scrollAway(page: Page) {
  // Keep focus where the visitor left it while physically moving away from the controls.
  const back = page.getByRole('button', { name: 'Back to workspace' });
  if (await back.count()) { await back.click(); await expect(page.locator('[data-workspace-focused]')).toHaveCount(0); }
  const browse = page.getByRole('button', { name: 'Browse published content' });
  if (await browse.count()) await browse.click();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.site-wave')?.focus({ preventScroll: true }));
  await page.mouse.wheel(0, 10000);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const dockLayout = await page.locator('.site-wave').evaluate(node => {
    const boxes = [];
    for (let item: Element | null = node; item; item = item.parentElement) {
      const style = getComputedStyle(item), rect = item.getBoundingClientRect();
      boxes.push({ tag: item.tagName, className: item.className, top: rect.top, height: rect.height, position: style.position, overflow: style.overflow, transform: style.transform });
    }
    return boxes;
  });
  await expect(page.locator('.site-wave'), JSON.stringify(dockLayout)).toBeInViewport();
  // Wheel delivery can precede the final scroll frames. The next mocked reply
  // represents a new turn after that manual movement, not during its momentum.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const started = performance.now();
    let previous = scrollY, stable = 0;
    const sample = () => {
      const current = scrollY;
      stable = Math.abs(current - previous) < 0.5 ? stable + 1 : 0;
      previous = current;
      if (stable >= 6 && performance.now() - started >= 150) { resolve(); return; }
      if (performance.now() - started >= 2000) { reject(new Error('The synthetic manual scroll did not settle.')); return; }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

for (const width of [390, 1600]) test(`shared invitation and dock use the available ${width}px viewport`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await prepare(page, 'voice', true);
  const wave = page.getByRole('button', { name: 'Start conversation', exact: true });
  const canvas = await wave.locator('canvas').elementHandle();
  const opening = await page.locator('.site-opening').boundingBox();
  expect(opening!.y).toBeGreaterThanOrEqual(899);
  await expect(page.locator('.site-wordmark')).toHaveCSS('font-size', '11px');
  await page.screenshot({ path: info.outputPath(`opening-${width}.png`) });
  await wave.click();
  await expect(page.locator('.site-opening')).toHaveCount(0);
  await expect.poll(() => page.locator('[data-voice-dock]').evaluate(node => Number(getComputedStyle(node).getPropertyValue('--opening-progress')))).toBe(0);
  expect(await canvas!.evaluate(node => node.isConnected)).toBe(true);
  await expect(page.locator('.site-wordmark').locator('..')).toHaveCSS('opacity', '0');
  const content = (await page.locator('.visitor-workspace').boundingBox())!;
  expect(content.width).toBeGreaterThan(width - 65);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.__visitorQuality.emit({ type: 'activity', activity: 'web', revision: 0, interactionRevision: 0 }));
  const voiceStatus = page.locator('[data-voice-dock]').getByRole('status').filter({ hasText: 'Searching the web…' });
  await expect(voiceStatus).toBeVisible();
  await expect(voiceStatus.locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath(`docked-${width}.png`) });
  await page.getByRole('button', { name: 'End voice conversation', exact: true }).click();
});

test('mobile visitors retain docked voice and a reachable touch End control while scrolling', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await expect(page.locator('.site-sample-note, .site-signature')).toHaveCount(0);
  await expect(page.getByText('AI voice · information from this site', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Explore the site', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  const end = page.getByRole('button', { name: 'End voice conversation', exact: true });
  await expect(end).toBeVisible(); await expect(page.locator('.site-opening')).toHaveCount(0);
  const dock = page.locator('[data-voice-dock]');
  await expect.poll(async () => Math.abs((await dock.boundingBox())!.y)).toBeLessThan(3);
  await scrollAway(page);
  expect(Math.abs((await dock.boundingBox())!.y)).toBeLessThan(3);
  const box = (await end.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(828);
  expect(await end.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); })).toBe(true);
  await page.screenshot({ path: info.outputPath('mobile-reachable-end-voice.png') });
  const scrollBeforeStop = await page.evaluate(() => scrollY);
  await end.tap();
  await expect(end).toHaveCount(0);
  expect(Math.abs(await page.evaluate(() => scrollY) - scrollBeforeStop)).toBeLessThan(2);
  expect(await page.evaluate(() => window.__visitorQuality.calls)).toBe(1);
  expect(await page.evaluate(() => window.__visitorQuality.stopped)).toBeGreaterThan(0);
});

test('returning a voice view preserves objects and restores a reachable keyboard origin', async ({ page }) => {
  await prepare(page);
  const start = page.getByRole('button', { name: 'Start conversation', exact: true });
  await start.focus(); await start.press('Enter'); await showView(page, 0);
  const reset = page.getByRole('button', { name: 'Back to workspace', exact: true });
  await reset.focus(); await reset.press('Enter');
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toHaveCount(0);
  const object = page.locator('[data-workspace-open]').first();
  await expect(object).toBeFocused();
  await expect(page.locator('.platform-workspace-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'End voice conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorQuality.stopped)).toBe(0);
});

for (const action of ['end', 'escape', 'wave-end', 'wave-escape'] as const) test(`keyboard ${action} after the final voice allowance focuses the resulting chat field`, async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  await showView(page, 0);
  await page.evaluate(() => window.__visitorQuality.emit({ type: 'availability', availability: { enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 0, resetsAt: '' } }));
  const control = page.getByRole('button', { name: action.startsWith('wave-') ? 'End conversation' : 'End voice conversation', exact: true });
  await control.focus(); await control.press(action.endsWith('escape') ? 'Escape' : 'Enter');
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await expect(input).toBeFocused(); await expect(input).toBeInViewport();
  await expect(page.getByRole('button', { name: 'End voice conversation', exact: true })).toHaveCount(0);
  expect(await input.evaluate(element => Boolean(element.closest('[inert], [aria-hidden="true"]')))).toBe(false);
});

test('Escape from the keyboard-focused floating control restores the remaining voice control', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  const end = page.getByRole('button', { name: 'End voice conversation', exact: true });
  await end.focus(); await end.press('Escape');
  await expect(end).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeFocused();
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) test(`a new legacy voice result becomes visible without taking focus (${reducedMotion})`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion }); await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  await showView(page, 0);
  await expect(page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { level: 2 })).toBeInViewport();
  await scrollAway(page); await showView(page, 1);
  const heading = page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { level: 2 });
  await expect.poll(() => heading.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 16 && box.bottom <= innerHeight - 16;
  })).toBe(true);
  await expect(page.locator('.site-wave')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`legacy-reveal-${reducedMotion}.png`) });
});

test('manual scrolling preserves an already focused result without automatic page scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  await showView(page, 0);
  const heading = page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { level: 2 });
  await expect(heading).toBeInViewport();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.site-wave')?.focus({ preventScroll: true }));
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(250);
  const before = await page.evaluate(() => scrollY);
  await page.waitForTimeout(1100);
  expect(Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThanOrEqual(1);
  await expect(page.locator('.site-wave')).toBeFocused();
});

test('a voice-only publisher offers an explicit typing fallback when microphone access is denied', async ({ page }, info) => {
  await prepare(page);
  await page.evaluate(() => { window.__visitorQuality.denyMicrophone = true; });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  const alert = page.getByRole('region', { name: 'Site assistant', exact: true }).getByRole('alert');
  await expect(alert).toContainText('You can still browse this site.');
  await expect(alert).not.toContainText(/type|chat/i);
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__visitorQuality.calls)).toBe(0);
  await page.screenshot({ path: info.outputPath('voice-typing-fallback.png') });
  await page.getByRole('button', { name: 'Browse published content', exact: true }).tap();
  const topic = page.locator('[data-workspace-content$=":section:quality-0"]').first();
  await topic.tap(); await expect(page.locator('[data-workspace-focused]:not([inert])')).toContainText('Published topic 1');
  await page.getByRole('button', { name: 'Continue by typing', exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeFocused();
});

test('a pending host chat request keeps ordinary browsing available without updating-view copy', async ({ page }) => {
  const site = await prepare(page, 'chat', true);
  let release!: () => void, observed!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requested = new Promise<void>(resolve => { observed = resolve; });
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    observed(); await pending;
    await route.fulfill({ status: 503, json: { error: 'Synthetic request ended.' } }).catch(() => undefined);
  });
  try {
    const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
    await input.fill('Explain how these topics relate'); await input.press('Enter'); await requested;
    const status = page.locator('.platform-view-status');
    await expect(status).toHaveCount(0);
    await page.getByRole('button', { name: 'Browse published content' }).click();
    const item = page.getByRole('region', { name: 'Browse approved information' }).getByRole('button', { name: 'Open First published item', exact: true });
    await expect(item).toBeEnabled(); await item.click();
    await expect(page.locator('[data-workspace-focused]:not([inert])')).toContainText('First published item');
    await expect(status).toHaveCount(0);
  } finally { release(); }
});

test('voice spotlight, reading view, comparison and back reuse the catalog without reconnecting', async ({ page }, info) => {
  await prepare(page, 'voice', true);
  const browse = page.getByRole('button', { name: 'Browse published content', exact: true });
  if (await browse.count()) await browse.click();
  const ids = await page.locator('[data-workspace-content^="entity:"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-workspace-content')!.split(':').at(-1)!));
  expect(ids.length).toBe(2);
  await page.locator(`[data-workspace-content$=":${ids[1]}"]`).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  async function command(revision: number, target: { kind: string; id?: string; ids?: string[] }) {
    await page.evaluate(({ revision, target }) => {
      const emit = window.__visitorQuality.emit;
      emit({ type: 'speech_started', revision }); emit({ type: 'speech_stopped' });
      emit({ type: 'response_started', revision });
      emit({ type: 'navigation', id: `command-${revision}`, revision, target });
    }, { revision, target });
    await expect.poll(() => page.evaluate(id => window.__visitorQuality.navigation.find(item => item.id === id)?.status, `command-${revision}`)).toBe('applied');
  }
  await command(1, { kind: 'spotlight', id: ids[1] });
  await expect(page.locator('[data-workspace-highlighted]')).toHaveCount(1);
  await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await command(2, { kind: 'open', id: ids[1] });
  await expect(page.locator('[data-workspace-focused]:not([inert]) [data-entity-id]')).toHaveAttribute('data-entity-id', ids[1]);
  await expect(page.locator('.platform-workspace-card')).toHaveCount(1);
  await page.evaluate(() => window.__visitorQuality.emit({ type: 'playback_started', responseId: 'reading' }));
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await page.screenshot({ path: info.outputPath('voice-reading-view.png') });
  await command(3, { kind: 'back' });
  await expect(page.locator('.platform-workspace-card')).toHaveCount(1);
  await command(4, { kind: 'compare', ids });
  await expect(page.locator('.platform-comparison-table')).toBeVisible();
  await command(5, { kind: 'collapse' });
  await expect(page.locator('.platform-workspace-card')).toHaveCount(2);
  expect(await page.evaluate(() => window.__visitorQuality.calls)).toBe(1);
  await page.getByRole('button', { name: 'End voice conversation', exact: true }).click();
});

for (const width of [390, 1600]) for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`chat dock expands and submits at ${width}px with ${reducedMotion}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion });
  await prepare(page, 'chat');
  const dock = page.locator('.platform-conversation-dock');
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  const original = await input.elementHandle();
  const suggestions = page.getByLabel('Ideas to explore');
  await expect(dock).toHaveAttribute('data-expanded', 'false');
  await expect(suggestions).toHaveCount(0);
  await expect(page.getByText('THE SITE, AT YOUR DIRECTION', { exact: true })).toHaveCount(0);
  await expect(page.getByText('AI guide · information from this site', { exact: true })).toHaveCount(0);
  await input.click();
  await expect(dock).toHaveAttribute('data-expanded', 'true');
  await expect(suggestions).toBeVisible();
  await expect.poll(() => page.locator('.platform-conversation-surface').evaluate(element => getComputedStyle(element).getPropertyValue('--composer-progress').trim())).toBe('1');
  await expect.poll(async () => (await input.boundingBox())!.y).toBeGreaterThan(180);
  await page.screenshot({ path: info.outputPath('chat-expanded.png') });
  await suggestions.getByRole('button').first().click();
  await expect(dock).toHaveAttribute('data-expanded', 'false');
  await expect(suggestions).toHaveCount(0);
  await expect.poll(async () => (await input.boundingBox())!.y).toBeLessThan(100);
  expect(await original!.evaluate(element => element.isConnected)).toBe(true);
  await expect(input).not.toHaveAttribute('readonly');
  await input.click(); await input.fill('Show me more'); await input.press('Enter');
  await expect(dock).toHaveAttribute('data-expanded', 'false');
  await expect(suggestions).toHaveCount(0);
  await expect(input).not.toHaveAttribute('readonly');
  await input.click(); await input.press('Escape');
  await expect(dock).toHaveAttribute('data-expanded', 'false');
  await page.mouse.wheel(0, 1400);
  // Wait for compositor scroll delivery before asserting the dock and capturing it.
  await page.waitForTimeout(350);
  await expect.poll(async () => Math.abs((await dock.boundingBox())!.y)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('chat-docked.png') });
});

test('chat explanation is readable without an error or workspace mutation', async ({ page }) => {
  const site = await prepare(page, 'chat', true);
  await page.route(`**/api/visitor/${site.slug}`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({ json: { text: 'General background: this place has a long public history.', demo: false,
      availability: { enabled: true, mode: 'chat', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } } });
  });
  await page.getByRole('button', { name: 'Browse published content' }).click();
  await page.getByRole('button', { name: 'Open First published item', exact: true }).click();
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toBeVisible();
  const before = await page.locator('[data-workspace-content]').count();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Tell me more about its history'); await input.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'General background:' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'General background:' })).toHaveCount(0);
  await expect(page.locator('[data-workspace-content]')).toHaveCount(before);
  const answer = page.getByRole('complementary', { name: 'Assistant answer' });
  await expect(answer).toBeInViewport();
  expect(await answer.evaluate(element => { const r = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(20, r.height / 2))); })).toBe(true);
  await page.getByRole('button', { name: 'Dismiss answer' }).click();
  await expect(answer).toHaveCount(0); await expect(input).toBeFocused();
});
