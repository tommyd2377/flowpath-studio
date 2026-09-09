import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { Site } from '../../lib/site-model';

const origin = 'http://127.0.0.1:3225';
type QualityHarness = { calls: number; stopped: number; denyMicrophone: boolean; emit: (event: unknown) => void };
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
    const state: QualityHarness = { calls: 0, stopped: 0, denyMicrophone: false,
      emit(event) { const frame = event as { type: string; interactionRevision?: number }; sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(['response_started', 'plan', 'playback_started', 'transcript', 'navigation'].includes(frame.type) ? { interactionRevision: 0, ...frame } : frame)}\n`)); } };
    window.__visitorQuality = state;
    class Track { enabled = true; onended: (() => void) | null = null; stop() { state.stopped++; } }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class Node { fftSize = 2048; gain = { value: 1 }; connect() { return this; } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    class Context { state = 'running'; destination = new Node(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { return new Node(); } createGain() { return new Node(); } createMediaStreamSource() { return new Node(); } }
    class Audio { autoplay = false; srcObject: unknown; setAttribute() {} play() { return Promise.resolve(); } pause() {} }
    class Peer {
      connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
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
        const { update } = JSON.parse(String(init?.body));
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
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { name: `Published topic ${index + 1}`, exact: true })).toBeVisible();
}

async function scrollAway(page: Page) {
  // Keep focus where the visitor left it while physically moving away from the controls.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.site-wave')?.focus({ preventScroll: true }));
  await page.mouse.wheel(0, 10000);
  await expect.poll(async () => (await page.locator('.site-wave').boundingBox())!.y + (await page.locator('.site-wave').boundingBox())!.height).toBeLessThan(0);
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

test('mobile visitors can end a live conversation by touch after the wave scrolls offscreen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  const end = page.getByRole('button', { name: 'End voice conversation', exact: true });
  await expect(end).toBeVisible(); await expect(page.locator('.site-opening')).toHaveCount(0); await scrollAway(page);
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

test('resetting a legacy voice view restores visible keyboard focus to the waveform', async ({ page }) => {
  await prepare(page);
  const start = page.getByRole('button', { name: 'Start conversation', exact: true });
  await start.focus(); await start.press('Enter'); await showView(page, 0);
  const reset = page.getByRole('button', { name: 'All of the site', exact: true });
  await reset.focus(); await reset.press('Enter');
  await expect(page.getByRole('region', { name: 'Your requested information' })).toHaveCount(0);
  const wave = page.getByRole('button', { name: 'End conversation', exact: true });
  await expect(wave).toBeFocused(); await expect(wave).toBeInViewport();
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
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { level: 2 })).toBeInViewport();
  await scrollAway(page); await showView(page, 1);
  const heading = page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { level: 2 });
  await expect.poll(() => heading.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.top >= 16 && box.bottom <= innerHeight - 16;
  })).toBe(true);
  await expect(page.locator('.site-wave')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`legacy-reveal-${reducedMotion}.png`) });
});

test('manual scrolling cancels a pending legacy result reveal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).tap();
  await showView(page, 0);
  const heading = page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { level: 2 });
  await expect(heading).toBeInViewport();
  await scrollAway(page); await showView(page, 1);
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(1100);
  await expect(heading).not.toBeInViewport();
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
  const topic = page.getByRole('button', { name: 'Explore Published topic 1', exact: true });
  await topic.tap(); await expect(page.getByRole('button', { name: 'Close Published topic 1', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Continue by typing', exact: true }).tap();
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeFocused();
});

test('a pending host chat request announces progress while manual catalog navigation remains available', async ({ page }) => {
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
    await input.fill('Show the first published item'); await input.press('Enter'); await requested;
    const status = page.locator('.platform-view-status');
    await expect(status).toHaveAttribute('role', 'status'); await expect(status).toHaveText('Shaping your view…');
    const item = page.locator('.platform-explorer').getByRole('button', { name: 'First published item', exact: true });
    await expect(item).toBeEnabled(); await item.click();
    await expect(page.getByRole('region', { name: 'Details of First published item', exact: true })).toBeVisible();
    await expect(status).not.toHaveText('Shaping your view…');
  } finally { release(); }
});
