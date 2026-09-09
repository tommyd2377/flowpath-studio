import { test, expect, type Page } from '@playwright/test';
import type { Site } from '../../lib/site-model';
import type { VisitorContext, VisitorHistory, VisitorControlUpdate } from '../../lib/visitor-realtime-context';

const origin = 'http://127.0.0.1:3225';
type Harness = { controls: VisitorControlUpdate[]; requests: { context: VisitorContext; history: VisitorHistory }[]; chats: { context: VisitorContext; history: VisitorHistory; text: string }[]; audioMuted: boolean; ack: boolean; failControl: boolean; deferConnection: boolean; deferTrack: boolean; neverResolvePlay: boolean; connect: () => void; attach: () => void; revision: number; calls: number; closed: number; aborted: number; tracks: { stopped: boolean; enabled: boolean }[]; deferPermission: boolean; releasePermission: () => void; emit: (event: unknown) => void; disconnect: () => void; offers: string[] };
declare global { interface Window { __visitorVoice: Harness } }
let publishedSite: Site | undefined;

async function prepare(page: Page) {
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  }
  // Calls are mocked and each browser is fresh; reuse the immutable publication
  // so regression cases do not consume the demo workspace's site allowance.
  if (!publishedSite) {
    let site: Site = (await post('/api/sites', { name: 'Synthetic voice publisher', slug: `voice-${Date.now()}`, kind: 'photographer' })).site;
    site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitorSpeaksFirst: true, visitor: { enabled: true, mode: 'both', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
    publishedSite = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  }
  const site = publishedSite!;
  await page.addInitScript(() => {
    const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    const state: Harness = { controls: [], requests: [], chats: [], audioMuted: false, ack: true, failControl: false, deferConnection: false, deferTrack: false, neverResolvePlay: false, connect() {}, attach() {}, revision: 0, calls: 0, closed: 0, aborted: 0, tracks: [], deferPermission: false, releasePermission() {}, offers: [],
      emit(event) { const frame = event as { type: string; revision?: number; interactionRevision?: number }; if (frame.revision !== undefined) state.revision = Math.max(state.revision, frame.revision); sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(['response_started', 'plan', 'playback_started', 'transcript', 'navigation'].includes(frame.type) ? { interactionRevision: 0, ...frame } : frame)}\n`)); },
      disconnect() { sink?.close(); sink = undefined; } };
    window.__visitorVoice = state;
    class Track { enabled = true; stopped = false; onended: (() => void) | null = null; stop() { this.stopped = true; } }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class Node { fftSize = 2048; gain = { value: 1 }; connect() { return this; } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    class Context { state = 'running'; destination = new Node(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { return new Node(); } createGain() { return new Node(); } createMediaStreamSource() { return new Node(); } }
    class Audio { autoplay = false; srcObject: unknown; get muted() { return state.audioMuted; } set muted(value: boolean) { state.audioMuted = value; } setAttribute() {} play() { return state.neverResolvePlay ? new Promise<void>(() => {}) : Promise.resolve(); } pause() {} }
    class Peer {
      connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
      addTrack() {} createDataChannel() { throw new Error('Provider data channels are forbidden'); }
      createOffer() { return Promise.resolve({ type: 'offer', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }); }
      setLocalDescription() { return Promise.resolve(); }
      setRemoteDescription() { state.connect = () => { this.connectionState = 'connected'; this.onconnectionstatechange?.(); }; state.attach = () => this.ontrack?.({ streams: [new Stream()] }); if (!state.deferConnection) state.connect(); if (!state.deferTrack) state.attach(); return Promise.resolve(); }
      close() { this.connectionState = 'closed'; state.closed++; }
    }
    Object.defineProperty(window, 'AudioContext', { value: Context });
    Object.defineProperty(window, 'RTCPeerConnection', { value: Peer });
    Object.defineProperty(window, 'Audio', { value: Audio });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
      if (state.deferPermission) await new Promise<void>(resolve => { state.releasePermission = resolve; });
      const stream = new Stream(); state.tracks.push(stream.track); return stream;
    } });
    const fetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
      if (/\/api\/visitor\/[^/]+$/.test(path) && !init?.method) return Response.json({ availability });
      if (/\/api\/visitor\/[^/]+\/session$/.test(path)) {
        state.calls++; state.requests.push(JSON.parse(String(init?.body))); state.offers.push(JSON.parse(String(init?.body)).sdp);
        const body = new ReadableStream<Uint8Array>({ start(controller) { sink = controller; }, cancel() { state.aborted++; sink = undefined; } });
        state.emit({ type: 'session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', availability, expiresAt: Date.now() + 120000, control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } });
        state.emit({ type: 'ready' });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/\/api\/visitor\/[^/]+\/session\/control$/.test(path)) {
        const { update } = JSON.parse(String(init?.body)); state.controls.push(update);
        if (state.failControl) return Response.json({ error: 'Synthetic control failure' }, { status: 503 });
        if (state.ack && !update.end) state.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision: state.revision, ready: update.ready });
        return new Response(null, { status: 204 });
      }
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        state.chats.push(JSON.parse(String(init.body)));
        return Response.json({ availability, text: 'Published wedding information', presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
      }
      return fetch(input, init);
    };
  });
  await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
  await page.goto(`/s/${site.slug}`);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeEnabled();
}

test('one tap maintains streaming conversation, interruption and explicit Stop', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'speech_stopped' });
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'first' });
  });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeVisible();
  await expect(page.locator('.site-opening')).toHaveCount(0);
  await expect(page.locator('.site-cards')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your requested information' })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('continuous-voice.png'), fullPage: true });
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.enabled && !track.stopped))).toBe(true);
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'playback_stopped', responseId: 'unrelated-response' }));
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'playback_cleared', responseId: 'first' });
    // An interrupted earlier plan cannot replace the accepted view.
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:portraits'], status: 'ready' } });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { name: 'Portrait sessions', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, closed: window.__visitorVoice.closed, aborted: window.__visitorVoice.aborted, stopped: window.__visitorVoice.tracks.every(track => track.stopped), offer: window.__visitorVoice.offers[0] }))).toEqual({ calls: 1, closed: 1, aborted: 1, stopped: true, offer: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  expect(errors).toEqual([]);
});

test('manual browsing preserves the call, invalidates older output, and Escape ends capture', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Explore Wedding stories', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 1 && update.context.expandedSourceIds?.includes('section:weddings')))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(true);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:portraits'], status: 'ready' } });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'stale' });
  });
  await expect(page.getByRole('region', { name: 'Your requested information' })).toHaveCount(0);
  expect(await page.evaluate(() => ({ muted: window.__visitorVoice.audioMuted, stopped: window.__visitorVoice.tracks.some(track => track.stopped), calls: window.__visitorVoice.calls }))).toEqual({ muted: true, stopped: false, calls: 1 });
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'speech_stopped' });
    window.__visitorVoice.emit({ type: 'response_started', revision: 2, interactionRevision: 1 });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'current', interactionRevision: 1 });
  });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.stopped))).toBe(true);
});

test('cancelling pending microphone permission cannot create a late session', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => { window.__visitorVoice.deferPermission = true; });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  await page.evaluate(() => window.__visitorVoice.releasePermission());
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.tracks.length)).toBe(1);
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.every(track => track.stopped) }))).toEqual({ calls: 0, stopped: true });
});

test('stream failure stops without retry; exhausted session falls back to chat', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await page.evaluate(() => window.__visitorVoice.disconnect());
  await expect(page.getByRole('region', { name: 'Site assistant', exact: true }).getByRole('alert')).toContainText('voice connection ended');
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'availability', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 0, resetsAt: '' } });
    window.__visitorVoice.emit({ type: 'ended', message: 'Voice has reached its limit. Continue by typing.' });
  });
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(2);
});

test('unpublished references stop voice and preserve the last accepted view', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
  });
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'plan', revision: 2, presentation: { layout: 'detail', sources: ['section:private-unpublished'], status: 'ready' } });
  });
  await expect(page.getByRole('region', { name: 'Site assistant', exact: true }).getByRole('alert')).toContainText('Your current view is still available');
  await expect(page.getByRole('region', { name: 'Your requested information' }).getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.every(track => track.stopped) }))).toEqual({ calls: 1, stopped: true });
});

test('readiness waits for connected media and the owner ACK, without waiting for audio samples', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Explore Wedding stories', exact: true }).click();
  await page.evaluate(() => { const state = window.__visitorVoice; state.deferConnection = true; state.deferTrack = true; state.neverResolvePlay = true; state.ack = false; });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => window.__visitorVoice.connect());
  await expect(page.getByText('Connecting…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.controls.some(update => update.ready))).toBe(false);
  await page.evaluate(() => window.__visitorVoice.attach());
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.ready))).toBe(true);
  await expect(page.getByText('Connecting…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, update = state.controls.filter(update => update.ready).at(-1)!;
    state.ack = true; state.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision: 0, ready: true });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.enabled))).toBe(true);
  await expect(page.getByRole('button', { name: 'Close Wedding stories', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.requests[0].context.expandedSourceIds)).toContain('section:weddings');
});

test('a failed control update stops once and offers typing without reconnecting', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.__visitorVoice.failControl = true; });
  await page.getByRole('button', { name: 'Explore Wedding stories', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Site assistant', exact: true }).getByRole('alert')).toContainText('could not update your view');
  await expect(page.getByRole('button', { name: 'Continue by typing', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.every(track => track.stopped), ended: window.__visitorVoice.controls.at(-1)?.end }))).toEqual({ calls: 1, stopped: true, ended: true });
});

test('bounded voice history and accepted views survive typing and restarting voice', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const emit = window.__visitorVoice.emit;
    emit({ type: 'response_started', revision: 1 });
    emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
    // Transcription may arrive after the completed response; history still orders the turn.
    emit({ type: 'transcript', id: 'a1', role: 'assistant', text: 'Wedding information from the site.', revision: 1 });
    emit({ type: 'transcript', id: 'u1', role: 'user', text: 'Tell me about weddings.', revision: 1 });
    emit({ type: 'transcript', id: 'u1', role: 'user', text: 'Tell me about weddings.', revision: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.viewRevision === 1 && update.context.presentation?.sources.includes('section:weddings')))).toBe(true);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('And what else?'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.chats.length)).toBe(1);
  const typed = await page.evaluate(() => window.__visitorVoice.chats[0]);
  expect(typed.history).toEqual([{ role: 'user', text: 'Tell me about weddings.' }, { role: 'assistant', text: 'Wedding information from the site.' }]);
  expect(typed.context.presentation?.sources).toEqual(['section:weddings']);
  expect(typed.context.expandedSourceIds).toContain('section:weddings');
  await expect(input).not.toHaveAttribute('readonly');
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  const restarted = await page.evaluate(() => window.__visitorVoice.requests[1]);
  expect(restarted.history.map(item => item.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(restarted.history[2].text).toBe('And what else?');
  expect(restarted.context.presentation?.sources).toEqual(['section:weddings']);
  await page.evaluate(() => {
    for (let revision = 2; revision <= 7; revision++) {
      window.__visitorVoice.emit({ type: 'transcript', id: `u${revision}`, role: 'user', text: `Question ${revision}`, revision });
      window.__visitorVoice.emit({ type: 'transcript', id: `a${revision}`, role: 'assistant', text: `Answer ${revision}`, revision });
    }
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.fill('Continue'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.chats.length)).toBe(2);
  const history = await page.evaluate(() => window.__visitorVoice.chats[1].history);
  expect(history).toHaveLength(8); expect(history[0]).toEqual({ role: 'user', text: 'Question 4' }); expect(history.at(-1)).toEqual({ role: 'assistant', text: 'Answer 7' });
});

for (const nested of [false, true]) test(`navigation acknowledges actual ${nested ? 'nested preview' : 'page'} geometry without moving focus`, async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (nested) await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-visitor-site]')!;
    const pane = document.createElement('div'); pane.id = 'synthetic-preview-pane'; pane.style.cssText = 'height:400px;overflow:auto;border:2px solid gray;';
    root.before(pane); pane.append(root);
  });
  const start = page.getByRole('button', { name: 'Start conversation', exact: true });
  await start.click(); await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'End conversation', exact: true }).focus();
  const outerBefore = await page.evaluate(() => scrollY);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'nav-bottom', revision: 1, target: { kind: 'bottom' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'nav-bottom')?.navigationAck?.status)).toBe('applied');
  const bottom = await page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'nav-bottom')!);
  expect(bottom.context.screen!.scrollY).toBeGreaterThan(0);
  expect(Math.abs(bottom.context.screen!.documentHeight - bottom.context.screen!.viewportHeight - bottom.context.screen!.scrollY)).toBeLessThanOrEqual(2);
  await expect(page.locator('.site-wave')).toBeFocused();
  if (nested) { expect(bottom.context.screen!.viewportHeight).toBe(await page.locator('#synthetic-preview-pane').evaluate(element => element.clientHeight)); expect(await page.evaluate(() => scrollY)).toBe(outerBefore); }
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'nav-top', revision: 2, target: { kind: 'top' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'nav-top')?.navigationAck?.status)).toBe('applied');
  expect(await page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'nav-top')?.context.screen?.scrollY)).toBe(0);
  await expect(page.locator('.site-wave')).toBeFocused();
});

test('navigation reports unavailable targets and yields to manual scrolling', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'missing-target', revision: 1, target: { kind: 'source', id: 'section:not-in-dom' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'missing-target')?.navigationAck?.status)).toBe('unavailable');
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'cancelled-target', revision: 2, target: { kind: 'bottom' } });
  });
  await page.mouse.wheel(0, 40);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 1))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'cancelled-target' && update.navigationAck.status === 'applied'))).toBe(false);
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.some(track => track.stopped) }))).toEqual({ calls: 1, stopped: false });
});

test('manual context pauses capture until the matching owner ACK, preserving the call', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.__visitorVoice.ack = false; });
  await page.getByRole('button', { name: 'Explore Wedding stories', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 1))).toBe(true);
  await expect(page.getByText('Updating view · microphone paused…', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.enabled && !track.stopped))).toBe(true);
  await page.getByRole('button', { name: 'Close Wedding stories', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 2))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, older = state.controls.find(update => update.interactionRevision === 1)!;
    state.emit({ type: 'control_applied', seq: older.seq, interactionRevision: 1, revision: 1, ready: true });
  });
  await expect(page.getByText('Updating view · microphone paused…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, latest = state.controls.filter(update => update.interactionRevision === 2).at(-1)!;
    state.ack = true; state.emit({ type: 'control_applied', seq: latest.seq, interactionRevision: 2, revision: 2, ready: true });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, live: window.__visitorVoice.tracks.every(track => track.enabled && !track.stopped), muted: window.__visitorVoice.audioMuted }))).toEqual({ calls: 1, live: true, muted: true });
});

test('continuous busy animation cannot starve accepted view updates or navigation acknowledgments', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-visitor-site]')!;
    const animation = document.createElement('span'); animation.id = 'synthetic-continuous-motion'; animation.dataset.frames = '0'; root.append(animation);
    const started = performance.now();
    const tick = () => {
      const frame = Number(animation.dataset.frames) + 1; animation.dataset.frames = String(frame);
      animation.style.transform = `translateX(${frame % 10}px)`;
      if (performance.now() - started < 3500) requestAnimationFrame(tick);
      else animation.dataset.finished = 'true';
    };
    requestAnimationFrame(tick);
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.viewRevision === 1 && update.context.presentation?.sources.includes('section:weddings'))), { timeout: 1500 }).toBe(true);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'busy-navigation', revision: 2, target: { kind: 'source', id: 'section:unrendered' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'busy-navigation' && update.navigationAck.status === 'unavailable')), { timeout: 1500 }).toBe(true);
  await expect(page.locator('#synthetic-continuous-motion')).not.toHaveAttribute('data-finished', 'true');
  expect(await page.evaluate(() => window.__visitorVoice.controls.filter(update => update.navigationAck?.id === 'busy-navigation').every(update => update.viewRevision === 1 && update.context.presentation?.sources.includes('section:weddings')))).toBe(true);
});
