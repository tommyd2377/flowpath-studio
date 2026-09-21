import { test, expect, type Page } from '@playwright/test';
import type { Site } from '../../lib/site-model';
import type { VisitorContext, VisitorHistory, VisitorControlUpdate } from '../../lib/visitor-realtime-context';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { taskFixture } from '../../fixtures/visitor-tasks';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

const origin = 'http://127.0.0.1:3225';
type Harness = { controls: VisitorControlUpdate[]; requests: { context: VisitorContext; history: VisitorHistory }[]; chats: { context: VisitorContext; history: VisitorHistory; text: string }[]; inputActive: boolean; outputActive: boolean; outgoing: { stopped: boolean; enabled: boolean }[]; audioMuted: boolean; ack: boolean; failControl: boolean; deferConnection: boolean; deferTrack: boolean; neverResolvePlay: boolean; connect: () => void; attach: () => void; revision: number; calls: number; closed: number; aborted: number; tracks: { stopped: boolean; enabled: boolean }[]; deferPermission: boolean; releasePermission: () => void; emit: (event: unknown) => void; disconnect: () => void; offers: string[] };
declare global { interface Window { __visitorVoice: Harness } }
let publishedSite: Site | undefined;
let greetingSite: Site | undefined;

async function prepare(page: Page, welcome = false) {
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  }
  // Calls are mocked and each browser is fresh; reuse the immutable publication
  // so regression cases do not consume the demo workspace's site allowance.
  if (!(welcome ? greetingSite : publishedSite)) {
    let site: Site = (await post('/api/sites', { name: 'Synthetic voice publisher', slug: `voice-${Date.now()}`, kind: 'photographer' })).site;
    if (welcome) {
      const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#698aa0' } }).png().toBuffer();
      const upload = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'image/png', 'X-File-Name': 'greeting-fixture.png', 'X-Site-Revision': String(site.revision) }, data: bytes });
      expect(upload.ok()).toBe(true); const body = await upload.json(); site = body.site;
      site = (await post(`/api/sites/${site.id}/media`, { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(), assets: [{ id: body.fileId, width: 640, height: 480, caption: 'Wedding setting', alt: 'Synthetic welcome photograph' }], albums: [], associations: [{ id: 'welcome-photo', assetId: body.fileId, targetType: 'section', targetId: 'weddings', role: 'depicts', primary: true }] } })).site;
    }
    site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitorSpeaksFirst: !welcome,
      ...(welcome ? { greetingPoints: [{ kind: 'source', id: 'section:weddings' }, { kind: 'source', id: 'section:portraits' }, { kind: 'custom', text: 'Explore the neighborhood at your own pace.' }] } : {}),
      visitor: { enabled: true, mode: 'both', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
    const published = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
    if (welcome) greetingSite = published; else publishedSite = published;
  }
  const site = (welcome ? greetingSite : publishedSite)!;
  await page.addInitScript(() => {
    const availability = { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
    let sink: ReadableStreamDefaultController<Uint8Array> | undefined;
    let preparation: { revision: number; interactionRevision: number; queued: unknown[] } | undefined;
    const state: Harness = { controls: [], requests: [], chats: [], inputActive: false, outputActive: false, outgoing: [], audioMuted: false, ack: true, failControl: false, deferConnection: false, deferTrack: false, neverResolvePlay: false, connect() {}, attach() {}, revision: 0, calls: 0, closed: 0, aborted: 0, tracks: [], deferPermission: false, releasePermission() {}, offers: [],
      emit(event) {
        const frame = event as { type: string; revision?: number; interactionRevision?: number };
        if (frame.revision !== undefined) state.revision = Math.max(state.revision, frame.revision);
        if (frame.type === 'response_started') preparation = { revision: frame.revision!, interactionRevision: frame.interactionRevision ?? 0, queued: [] };
        else if (['ended', 'error', 'response_cancelled'].includes(frame.type)) preparation = undefined;
        else if (preparation && frame.revision === preparation.revision && (frame.interactionRevision ?? 0) === preparation.interactionRevision
          && ['navigation', 'plan', 'backend_idle', 'answer_completed', 'result_ready'].includes(frame.type)) { preparation.queued.push(event); return; }
        sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(['response_started', 'plan', 'playback_started', 'transcript', 'navigation'].includes(frame.type) ? { interactionRevision: 0, ...frame } : frame)}\n`));
      },
      disconnect() { sink?.close(); sink = undefined; } };
    window.__visitorVoice = state;
    class Track { clone() { const clone = new Track(); state.outgoing.push(clone); return clone; } enabled = true; stopped = false; onended: (() => void) | null = null; stop() { this.stopped = true; } }
    class Stream { track = new Track(); getTracks() { return [this.track]; } getAudioTracks() { return [this.track]; } }
    class Node { output = false; getByteTimeDomainData(array: Uint8Array) { array.fill((this.output ? state.outputActive : state.inputActive) ? 144 : 128); } fftSize = 2048; gain = { value: 1 }; connect() { return this; } getFloatTimeDomainData(array: Float32Array) { array.fill(0); } }
    let analyserIndex = 0;
    class Context { state = 'running'; destination = new Node(); resume() { return Promise.resolve(); } close() { this.state = 'closed'; return Promise.resolve(); } createAnalyser() { const node = new Node(); node.output = analyserIndex++ % 2 === 1; return node; } createGain() { return new Node(); } createMediaStreamSource() { return new Node(); } }
    class Audio { autoplay = false; srcObject: unknown; get muted() { return state.audioMuted; } set muted(value: boolean) { state.audioMuted = value; } setAttribute() {} play() { return state.neverResolvePlay ? new Promise<void>(() => {}) : Promise.resolve(); } pause() {} }
    class Peer {
      iceGatheringState = 'complete'; connectionState = 'new'; ontrack?: (event: unknown) => void; onconnectionstatechange?: () => void;
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
        preparation = undefined;
        state.calls++; state.requests.push(JSON.parse(String(init?.body))); state.offers.push(JSON.parse(String(init?.body)).sdp);
        const body = new ReadableStream<Uint8Array>({ start(controller) { sink = controller; }, cancel() { state.aborted++; sink = undefined; } });
        state.emit({ type: 'session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', availability, expiresAt: Date.now() + 120000, protectOpening: true, control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } });
        state.emit({ type: 'ready' });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/\/api\/visitor\/[^/]+\/session\/control$/.test(path)) {
        const { update } = JSON.parse(String(init?.body)); state.controls.push(update); if (update.end) queueMicrotask(() => state.emit({ type: 'ended', message: 'Ended.' }));
        if (state.failControl) return Response.json({ error: 'Synthetic control failure' }, { status: 503 });
        if (state.ack && !update.end) state.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision: state.revision, ready: update.ready });
        if (update.end || preparation && update.interactionRevision > preparation.interactionRevision) preparation = undefined;
        // Mirror the owner: restored task state is confirmed before display work.
        if (state.ack && preparation && update.ready && update.preparationAck?.revision === preparation.revision
          && update.interactionRevision === preparation.interactionRevision) {
          const pending = preparation; preparation = undefined;
          if (update.preparationAck.status === 'applied') pending.queued.forEach(event => state.emit(event));
          else state.emit({ type: 'task_error', revision: pending.revision, interactionRevision: pending.interactionRevision, message: 'The current information could not be prepared.' });
        }
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

async function browse(page: Page) {
  const button = page.getByRole('button', { name: 'Browse published content', exact: true });
  if (await button.count()) await button.click();
}

for (const mobile of [false, true]) test(`microphone remains available throughout the opening${mobile ? ' on iPhone' : ' on desktop'}`, async ({ page }) => {
  if (mobile) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }));
  }
  await prepare(page, true);
  await page.evaluate(() => { window.__visitorVoice.ack = false; });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.ready))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, latest = state.controls.at(-1)!;
    state.ack = true;
    state.emit({ type: 'control_applied', seq: latest.seq, interactionRevision: latest.interactionRevision, revision: 0, ready: true });
  });
  // Check before playback begins: a greeting must not hold input until its end.
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.outgoing.every(track => track.enabled && !track.stopped))).toBe(true);
  await page.evaluate(() => { window.__visitorVoice.outputActive = true; window.__visitorVoice.inputActive = true; });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.audio)).toEqual({ inputActive: true, outputActive: true });
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => track.enabled && !track.stopped))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.outgoing.every(track => track.stopped))).toBe(true);
});

for (const mobile of [false, true]) test(`voice closes, switches and exits workspace panels across successive requests${mobile ? ' on mobile with reduced motion' : ''}`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  let revision = 0;
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  async function navigate(kind: string, targetId?: string, expected = 'applied') {
    const id = `panel-navigation-${++revision}`;
    await page.evaluate(({ kind, targetId, id, revision }) => {
      window.__visitorVoice.emit({ type: 'response_started', revision });
      window.__visitorVoice.emit({ type: 'navigation', id, revision, target: { kind, ...(targetId ? { id: targetId } : {}) } });
    }, { kind, targetId, id, revision });
    await expect.poll(() => page.evaluate(id => window.__visitorVoice.controls.find(update => update.navigationAck?.id === id)?.navigationAck?.status, id)).toBe(expected);
    const update = await page.evaluate(id => window.__visitorVoice.controls.find(update => update.navigationAck?.id === id)!, id);
    expect(update.interactionRevision).toBe(0);
    expect(update.context.scene?.workspaceRevision).toBe(update.context.workspace?.revision);
    expect(update.context.scene?.focusedId).toBe(update.context.workspace?.focusedId);
    return update.context.workspace!;
  }
  const first = await navigate('open', 'source:section:weddings');
  const wedding = first.focusedId!;
  const second = await navigate('open', 'source:section:portraits');
  const portrait = second.focusedId!;
  expect(second.objects).toHaveLength(2);
  expect((await navigate('open', wedding)).focusedId).toBe(wedding);
  const expanded = await navigate('expand', portrait);
  expect(expanded.focusedId).toBe(portrait);
  expect(expanded.objects.find(object => object.instanceId === portrait)?.expanded).toBe(true);
  const collapsed = await navigate('collapse', portrait);
  expect(collapsed.focusedId).toBe(null);
  expect(collapsed.objects).toHaveLength(2);
  expect(collapsed.objects.find(object => object.instanceId === portrait)?.expanded).toBe(false);
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await navigate('focus', wedding);
  const partial = await navigate('close', portrait);
  expect(partial.objects.map(object => object.instanceId)).toEqual([wedding]);
  expect(partial.focusedId).toBe(wedding);
  const stale = await navigate('focus', portrait, 'failed');
  expect(stale).toEqual(partial);
  await navigate('open', 'source:section:portraits');
  const back = await navigate('back');
  expect(back.focusedId).toBe(wedding); expect(back.objects).toHaveLength(2);
  await navigate('focus', portrait);
  const closed = await navigate('close');
  expect(closed.focusedId).toBe(wedding); expect(closed.objects).toHaveLength(1);
  const overview = await navigate('unfocus');
  expect(overview.focusedId).toBe(null); expect(overview.objects).toHaveLength(1);
  await expect(focused).toHaveCount(0);
  const cleared = await navigate('clear');
  expect(cleared.objects).toEqual([]); expect(cleared.focusHistory).toEqual([]);
  const reopened = await navigate('open', 'source:section:portraits');
  expect(reopened.objects).toHaveLength(1);
  await expect(focused.getByRole('heading', { name: 'Portrait sessions', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  expect(errors).toEqual([]);
});

for (const mobile of [false, true]) test(`opening narration follows three carousel cards${mobile ? ' on mobile with reduced motion' : ''}`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  await prepare(page, true);
  const carousel = page.getByRole('region', { name: 'Welcome highlights' });
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  await expect(carousel).toHaveCount(0);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome.', revision: 0, interactionRevision: 0 }));
  await expect(carousel).toHaveCount(0);
  await page.evaluate(() => { window.__visitorVoice.outputActive = true; });
  await expect(carousel).toBeVisible();
  await expect(carousel.locator('.platform-workspace-card')).toHaveCount(3);
  await expect(focused).toHaveCount(0);
  const pageTop = await page.evaluate(() => window.scrollY);
  const activeControl = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome. Wedding stories.', revision: 0, interactionRevision: 0 }));
  await expect(focused.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await expect(focused.getByRole('img', { name: 'Synthetic welcome photograph' })).toBeVisible();
  if (!mobile) await expect(focused).toHaveAttribute('data-workspace-transition', 'settled');
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome. Wedding stories. Portrait sessions.', revision: 0, interactionRevision: 0 }));
  await expect(focused.getByRole('heading', { name: 'Portrait sessions', exact: true })).toBeVisible();
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome. Wedding stories. Portrait sessions. Explore the neighborhood at your own pace.', revision: 0, interactionRevision: 0 }));
  await expect(focused.getByText('Explore the neighborhood at your own pace.', { exact: true })).toBeVisible();
  await expect(focused).toHaveAttribute('data-workspace-transition', 'settled');
  await page.screenshot({ path: info.outputPath('welcome-focus.png'), fullPage: true });
  expect(await page.evaluate(() => window.scrollY)).toBe(pageTop);
  expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(activeControl);
  expect(await page.evaluate(() => window.__visitorVoice.controls.every(update => update.interactionRevision === 0))).toBe(true);
  await page.evaluate(() => { window.__visitorVoice.outputActive = false; });
  await expect(focused).toHaveCount(0);
  await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
  await expect(carousel.locator('.platform-workspace-card:not([inert])')).toHaveCount(3);
  for (const card of await carousel.locator('.platform-workspace-card').all()) await expect(card).toHaveCSS('opacity', '1');
  await page.screenshot({ path: info.outputPath('welcome-carousel.png'), fullPage: true });
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await carousel.getByRole('button', { name: 'Show welcome highlight 1: Wedding stories' }).click();
  await expect(focused.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(focused).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('manual browsing cancels opening focus and rejects late captions without recreating closed cards', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.outputActive = true; window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Wedding stories.', revision: 0, interactionRevision: 0 }); });
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  await expect(focused.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await focused.getByRole('button', { name: 'Close Wedding stories', exact: true }).click();
  await expect(focused).toHaveCount(0);
  await page.evaluate(() => {
    const state = window.__visitorVoice;
    state.emit({ type: 'greeting_progress', text: 'Wedding stories. Portrait sessions.', revision: 0, interactionRevision: 0 });
    state.emit({ type: 'greeting_progress', text: 'Portrait sessions.', revision: 0, interactionRevision: state.controls.at(-1)?.interactionRevision ?? 1 });
    state.outputActive = false;
  });
  await page.waitForTimeout(3000);
  await expect(focused).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Welcome highlights' }).locator('.platform-workspace-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await expect(page.getByRole('region', { name: 'Welcome highlights' })).toHaveCount(0);
});

test('one tap maintains streaming conversation, interruption and explicit Stop', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const information = page.getByRole('article', { name: 'Current information', exact: true });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'speech_stopped' });
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'first' });
  });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await expect(page.locator('.site-opening')).toHaveCount(0);
  await expect(page.locator('.site-cards')).toHaveCount(0);
  await expect(information).toHaveCSS('opacity', '1');
  await expect(information.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('continuous-voice.png'), fullPage: true });
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.enabled && !track.stopped))).toBe(true);
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'playback_stopped', responseId: 'unrelated-response' }));
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'playback_cleared', responseId: 'first' });
    // An interrupted earlier plan cannot replace the accepted view.
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:portraits'], status: 'ready' } });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await expect(information.getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await expect(information.getByRole('heading', { name: 'Portrait sessions', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, closed: window.__visitorVoice.closed, aborted: window.__visitorVoice.aborted, stopped: window.__visitorVoice.tracks.every(track => track.stopped), offer: window.__visitorVoice.offers[0] }))).toEqual({ calls: 1, closed: 1, aborted: 1, stopped: true, offer: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' });
  expect(errors).toEqual([]);
});

test('manual browsing preserves the call, invalidates older output, and Escape ends capture', async ({ page }) => {
  await prepare(page);
  await browse(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.locator('[data-workspace-content$=":section:weddings"]').first().click();
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 1 && update.context.scene?.objects.some(object => object.references.some(ref => ref.id === 'section:weddings'))))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:portraits'], status: 'ready' } });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'stale' });
  });
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toContainText('Wedding stories');
  await expect(page.locator('[data-workspace-focused]:not([inert])')).not.toContainText('Portrait sessions');
  expect(await page.evaluate(() => ({ muted: window.__visitorVoice.audioMuted, stopped: window.__visitorVoice.tracks.some(track => track.stopped), calls: window.__visitorVoice.calls }))).toEqual({ muted: false, stopped: false, calls: 1 });
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'speech_stopped' });
    window.__visitorVoice.emit({ type: 'response_started', revision: 2, interactionRevision: 1 });
    window.__visitorVoice.emit({ type: 'playback_started', responseId: 'current', interactionRevision: 1 });
  });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-workspace-focused]:not([inert])')).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).focus();
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
  await expect(page.getByRole('dialog', { name: 'Assistant exploration', exact: true }).getByRole('alert')).toContainText('voice connection ended');
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'availability', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 25, voiceRemaining: 0, resetsAt: '' } });
    window.__visitorVoice.emit({ type: 'ended', message: 'Voice has reached its limit. Continue by typing.' });
  });
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(2);
});

test('unpublished references fail their request and preserve the last accepted workspace and call', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
  });
  await expect(page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'speech_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'plan', revision: 2, presentation: { layout: 'detail', sources: ['section:private-unpublished'], status: 'ready' } });
  });
  await expect(page.getByText('The browser could not apply that view. Your current workspace is still available.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-workspace-focused]:not([inert])').getByRole('heading', { name: 'Wedding stories', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.planAck?.revision === 2 && update.planAck.status === 'failed'))).toBe(true);
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.some(track => track.stopped) }))).toEqual({ calls: 1, stopped: false });
});

test('readiness waits for connected media and the owner ACK, without waiting for audio samples', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Tell me about weddings'); await input.press('Enter');
  await expect(page.locator('[data-information-surface]')).toContainText('Wedding stories');
  await expect(page.locator('[data-information-surface]')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.evaluate(() => { const state = window.__visitorVoice; state.deferConnection = true; state.deferTrack = true; state.neverResolvePlay = true; state.ack = false; });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => window.__visitorVoice.connect());
  await expect(page.getByText('Connecting voice…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.controls.some(update => update.ready))).toBe(false);
  await page.evaluate(() => window.__visitorVoice.attach());
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.ready))).toBe(true);
  await expect(page.getByText('Connecting voice…', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, update = state.controls.filter(update => update.ready).at(-1)!;
    state.ack = true; state.emit({ type: 'control_applied', seq: update.seq, interactionRevision: update.interactionRevision, revision: 0, ready: true });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.enabled))).toBe(true);
  await expect(page.getByRole('button', { name: 'Close assistant', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.requests[0].context.scene?.objects.flatMap(object => object.references.map(ref => ref.id)))).toContain('section:weddings');
});

test('a failed control update stops once and offers typing without reconnecting', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  for (const [index, id] of ['section:weddings', 'section:portraits'].entries()) {
    await page.evaluate(({ index, id }) => { window.__visitorVoice.emit({ type: 'response_started', revision: index + 1 }); window.__visitorVoice.emit({ type: 'navigation', id, revision: index + 1, target: { kind: 'source', id } }); }, { index, id });
    await expect.poll(() => page.evaluate(id => window.__visitorVoice.controls.find(update => update.navigationAck?.id === id)?.navigationAck?.status, id)).toBe('applied');
    await page.evaluate(index => window.__visitorVoice.emit({ type: 'backend_idle', revision: index + 1, interactionRevision: 0 }), index);
    await expect(page.locator('[data-information-surface]')).toHaveAttribute('data-pending-request', '');
  }
  await page.evaluate(() => { window.__visitorVoice.failControl = true; });
  await page.getByRole('button', { name: 'Back to previous information', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Assistant exploration', exact: true }).getByRole('alert')).toContainText('could not update your view');
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, stopped: window.__visitorVoice.tracks.every(track => track.stopped), ended: window.__visitorVoice.controls.at(-1)?.end }))).toEqual({ calls: 1, stopped: true, ended: true });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'What would you like to see?', exact: true })).toBeVisible();
});

test('bounded voice history and accepted views survive typing and restarting voice', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    const emit = window.__visitorVoice.emit;
    emit({ type: 'response_started', revision: 1 });
    emit({ type: 'plan', revision: 1, presentation: { layout: 'detail', sources: ['section:weddings'], status: 'ready' } });
    // Transcription may arrive after the completed response; history still orders the turn.
    emit({ type: 'transcript', id: 'a1', role: 'assistant', text: 'Wedding information from the site.', revision: 1 });
    emit({ type: 'transcript', id: 'u1', role: 'user', text: 'Tell me about weddings.', revision: 1 });
    emit({ type: 'transcript', id: 'u1', role: 'user', text: 'Tell me about weddings.', revision: 1 });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.viewRevision === 1 && update.context.scene?.objects.some(object => object.references.some(ref => ref.id === 'section:weddings'))))).toBe(true);
  // A displayed plan and transcripts do not complete the backend transaction.
  // Switching modes before its terminal event deliberately rolls it back.
  await expect(page.locator('[data-information-surface]')).toHaveAttribute('data-pending-request', 'voice:1');
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'backend_idle', revision: 1, interactionRevision: 0 }));
  await expect(page.locator('[data-information-surface]')).toHaveAttribute('data-pending-request', '');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('And what else?'); await input.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.chats.length)).toBe(1);
  const typed = await page.evaluate(() => window.__visitorVoice.chats[0]);
  expect(typed.history).toEqual([{ role: 'user', text: 'Tell me about weddings.' }, { role: 'assistant', text: 'Wedding information from the site.' }]);
  expect(typed.context.scene?.objects.flatMap(object => object.references.map(ref => ref.id))).toEqual(['section:weddings']);
  expect(typed.context.workspace?.focusedId).toBeTruthy();
  // Typing stays editable during work. Wait for the confirmed view and reply
  // before changing mode, which intentionally cancels an unfinished request.
  await expect(page.getByRole('button', { name: 'Show me', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const restarted = await page.evaluate(() => window.__visitorVoice.requests[1]);
  expect(restarted.history.map(item => item.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  expect(restarted.history[2].text).toBe('And what else?');
  expect(restarted.context.scene?.objects.flatMap(object => object.references.map(ref => ref.id))).toEqual(['section:weddings']);
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
  await browse(page);
  await page.getByRole('region', { name: 'Browse approved information' }).evaluate(element => { (element as HTMLElement).style.minHeight = '1400px'; });
  if (nested) await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-visitor-site]')!;
    const pane = document.createElement('div'); pane.id = 'synthetic-preview-pane'; pane.style.cssText = 'height:400px;overflow:auto;border:2px solid gray;';
    root.before(pane); pane.append(root);
  });
  const start = page.getByRole('button', { name: 'Start conversation', exact: true });
  await start.click(); await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
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
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
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

test('manual context pauses outgoing audio until the matching owner ACK, preserving the call', async ({ page }) => {
  await prepare(page);
  await browse(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.ack = false; });
  await browse(page);
  await page.locator('[data-workspace-content$=":section:weddings"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 1))).toBe(true);
  await expect(page.getByText('Updating view · microphone paused…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => !track.enabled && !track.stopped))).toBe(true);
  await page.getByRole('button', { name: 'Back to workspace', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.interactionRevision === 2))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, older = state.controls.find(update => update.interactionRevision === 1)!;
    state.emit({ type: 'control_applied', seq: older.seq, interactionRevision: 1, revision: 1, ready: true });
  });
  await expect(page.getByText('Updating view · microphone paused…', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => !track.enabled))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, latest = state.controls.filter(update => update.interactionRevision === 2).at(-1)!;
    state.ack = true; state.emit({ type: 'control_applied', seq: latest.seq, interactionRevision: 2, revision: 2, ready: true });
  });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  expect(await page.evaluate(() => ({ calls: window.__visitorVoice.calls, live: window.__visitorVoice.tracks.every(track => track.enabled && !track.stopped), muted: window.__visitorVoice.audioMuted }))).toEqual({ calls: 1, live: true, muted: false });
});

test('spoken cancellation clears stale activity and waits for quiet output plus the new owner revision', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    const state = window.__visitorVoice; state.ack = false;
    state.emit({ type: 'response_started', revision: 1 });
    state.emit({ type: 'activity', revision: 1, interactionRevision: 0, activity: 'images' });
  });
  await expect(page.getByRole('status').filter({ has: page.locator('span'), hasText: 'Finding images…' })).toBeVisible();
  await page.evaluate(() => {
    const state = window.__visitorVoice;
    state.emit({ type: 'response_cancelled', revision: 2, interactionRevision: 0 });
    state.emit({ type: 'task_error', revision: 1, interactionRevision: 0, message: 'Obsolete timeout' });
    state.emit({ type: 'navigation', id: 'obsolete-navigation', revision: 1, target: { kind: 'browse' } });
    state.emit({ type: 'playback_started', responseId: 'obsolete-audio', interactionRevision: 0 });
  });
  // The voice stage retains its last label for the fade, but removes it from
  // accessibility; the floating activity indicator must also be gone.
  await expect(page.getByRole('status').filter({ hasText: 'Finding images…' })).toHaveCount(0);
  await expect(page.getByText('Obsolete timeout')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(true);
  // Output is quiet already, but the last accepted revision predates cancellation.
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.filter(update => update.ready).length)).toBeGreaterThan(1);
  expect(await page.evaluate(() => window.__visitorVoice.outgoing.every(track => track.enabled && !track.stopped))).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice; state.outputActive = true;
  });
  // Let the audio observer see the old output before acknowledging the new view.
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.audio?.outputActive)).toBe(true);
  await page.evaluate(() => {
    const state = window.__visitorVoice, latest = state.controls.at(-1)!;
    state.ack = true; state.emit({ type: 'control_applied', seq: latest.seq, interactionRevision: 0, revision: 2, ready: true });
  });
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(true);
  await page.evaluate(() => { window.__visitorVoice.outputActive = false; });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 3 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'current-home', revision: 3, target: { kind: 'home' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'current-home' && update.navigationAck.status === 'applied'))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'obsolete-navigation'))).toBe(false);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
});

for (const mobile of [false, true]) test(`background work stays visible while both sides converse${mobile ? ' on mobile' : ''}`, async ({ page }, info) => {
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const indicator = page.getByRole('status').filter({ has: page.locator('span'), hasText: 'Working on your request…' });
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'response_started', revision: 1 }));
  await expect(indicator).toBeVisible();
  await page.evaluate(() => { window.__visitorVoice.outputActive = true; });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await expect(indicator).toBeVisible();
  await page.evaluate(() => { window.__visitorVoice.inputActive = true; });
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await expect(indicator).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  const progressBounds = await indicator.boundingBox(), endBounds = await page.getByRole('button', { name: 'End voice conversation', exact: true }).boundingBox();
  expect(progressBounds!.x + progressBounds!.width).toBeLessThan(endBounds!.x);
  expect(progressBounds!.y + progressBounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: info.outputPath('working-during-conversation.png') });
  // Neither speech nor a stale completion may clear a newer request's indicator.
  await page.evaluate(() => {
    const state = window.__visitorVoice;
    state.emit({ type: 'response_started', revision: 2 });
    state.emit({ type: 'backend_idle', revision: 1, interactionRevision: 0 });
    state.emit({ type: 'task_error', revision: 1, interactionRevision: 0, message: 'Obsolete failure' });
  });
  await expect(indicator).toBeVisible(); await expect(page.getByText('Obsolete failure')).toHaveCount(0);
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'backend_idle', revision: 2, interactionRevision: 0 }));
  await expect(indicator).toHaveCount(0);
  await page.getByRole('button', { name: 'End conversation', exact: true }).click();
});

test('a quiet minute ends voice despite repeated idle events, then restart keeps the view and accepts a new request', async ({ page }) => {
  await prepare(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    const state = window.__visitorVoice;
    state.emit({ type: 'transcript', id: 'before-pause', role: 'user', text: 'Show the contact information.', revision: 1 });
    state.emit({ type: 'response_started', revision: 1 });
    state.emit({ type: 'navigation', id: 'before-pause-view', revision: 1, target: { kind: 'open', id: 'source:contact' } });
  });
  const foreground = page.locator('[data-workspace-focused]:not([inert])');
  await expect(foreground).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'before-pause-view'))).toBe(true);
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'backend_idle', revision: 1, interactionRevision: 0 }));
  for (let step = 0; step < 3; step++) {
    await page.clock.fastForward(15_000);
    await page.evaluate(() => window.__visitorVoice.emit({ type: 'backend_idle', revision: 1, interactionRevision: 0 }));
    await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
  }
  await page.clock.fastForward(15_100);
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect(page.getByText('Voice ended after 1 minute of inactivity. Tap the wave to continue.', { exact: true })).toBeVisible();
  await expect(foreground).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.tracks.every(track => track.stopped))).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const restarted = await page.evaluate(() => window.__visitorVoice.requests[1]);
  expect(restarted.history).toEqual([{ role: 'user', text: 'Show the contact information.' }]);
  expect(restarted.context.screen?.focusedSourceId).toBe('contact');
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'transcript', id: 'after-pause', role: 'user', text: 'Take me home instead.', revision: 2 });
    window.__visitorVoice.emit({ type: 'response_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'after-pause-home', revision: 2, target: { kind: 'home' } });
  });
  await expect(foreground).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'after-pause-home' && update.navigationAck.status === 'applied'))).toBe(true);
});

for (const mobile of [false, true]) test(`clear-all chat controls close three greeting panels without a model request${mobile ? ' on mobile' : ''}`, async ({ page }) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  await prepare(page, true);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome.', revision: 0, interactionRevision: 0 }); window.__visitorVoice.outputActive = true; });
  await expect(page.locator('.platform-workspace-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?' });
  for (const command of ['close all three panels', 'clear workspace']) {
    await input.fill(command); await page.getByRole('button', { name: 'Show me', exact: true }).click();
    await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
    await expect(page.locator('[data-workspace-focused]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clear workspace', exact: true })).toHaveCount(0);
    await expect(input).toHaveValue('');
  }
  expect(await page.evaluate(() => window.__visitorVoice.chats)).toHaveLength(0);
  await expect(page.getByText('The task could not finish. Any confirmed views remain available.')).toHaveCount(0);
});

test('a model-generated bulk close is applied after chat layout moves and acknowledged as empty', async ({ page }) => {
  await prepare(page, true);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.emit({ type: 'greeting_progress', text: 'Welcome.', revision: 0, interactionRevision: 0 }); window.__visitorVoice.outputActive = true; });
  await expect(page.locator('.platform-workspace-card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.evaluate(() => {
    const previousFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (/\/api\/visitor\/[^/]+$/.test(String(url)) && init?.method === 'POST') {
        const request = JSON.parse(String(init.body)); window.__visitorVoice.chats.push(request);
        const workspace = request.context.workspace;
        // Simulate layout moving during model latency, without changing objects.
        document.querySelector<HTMLElement>('.visitor-workspace')!.style.paddingTop = '40px';
        await new Promise(resolve => setTimeout(resolve, 500));
        const events = [
          { type: 'control', control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } },
          { type: 'navigation', id: '00000000-0000-4000-8000-000000000002', target: { kind: 'workspace', batch: { schemaVersion: 1, requestId: 'clear-after-layout', publicationId: workspace.publicationId, baseRevision: workspace.revision, sceneRevision: request.context.scene.revision,
            operations: workspace.objects.map((object: { instanceId: string }) => ({ kind: 'close', instanceId: object.instanceId })) } } },
          { type: 'done', text: 'The workspace is clear.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } },
        ];
        return new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return previousFetch(url, init);
    };
  });
  await page.getByRole('textbox', { name: 'What would you like to see?' }).fill('Put the workspace back into an empty state.');
  await page.getByRole('button', { name: 'Show me', exact: true }).click();
  await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await expect(page.getByText('The workspace is clear.', { exact: true })).toBeVisible();
  const ack = await page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === '00000000-0000-4000-8000-000000000002'));
  expect(ack?.navigationAck?.status).toBe('applied'); expect(ack?.context.workspace?.objects).toEqual([]);
  expect(await page.evaluate(() => window.__visitorVoice.chats)).toHaveLength(1);
  await expect(page.getByText('The workspace changed. Use its current objects before trying again.')).toHaveCount(0);
});

test('continuous busy animation cannot starve accepted view updates or navigation acknowledgments', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
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
  // Default exponential polling stops around 850 ms when its next 1 s delay
  // exceeds this deadline. Keep sampling through the unchanged 1.5 s budget.
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.viewRevision === 1 && update.context.scene?.objects.some(object => object.references.some(ref => ref.id === 'section:weddings')))), { timeout: 1500, intervals: [50] }).toBe(true);
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 2 });
    window.__visitorVoice.emit({ type: 'navigation', id: 'busy-navigation', revision: 2, target: { kind: 'source', id: 'section:unrendered' } });
  });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'busy-navigation' && update.navigationAck.status === 'unavailable')), { timeout: 1500, intervals: [50] }).toBe(true);
  await expect(page.locator('#synthetic-continuous-motion')).not.toHaveAttribute('data-finished', 'true');
  expect(await page.evaluate(() => window.__visitorVoice.controls.filter(update => update.navigationAck?.id === 'busy-navigation').every(update => update.viewRevision === 1 && update.context.scene?.objects.some(object => object.references.some(ref => ref.id === 'section:weddings'))))).toBe(true);
});

 test('Live audio levels drive playback independently of backend completion and stale speech is muted during browsing', async ({ page }) => {
  await prepare(page);
  await browse(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => { window.__visitorVoice.outputActive = true; });
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => window.__visitorVoice.emit({ type: 'backend_idle', revision: 0, interactionRevision: 0 }));
  await expect(page.getByText('Speaking · you can interrupt · tap to end', { exact: true })).toBeAttached();
  await browse(page);
  await page.locator('[data-workspace-content$=":section:weddings"]').first().click();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(true);
  expect(await page.evaluate(() => window.__visitorVoice.tracks.every(track => track.enabled && !track.stopped))).toBe(true);
  await page.evaluate(() => { window.__visitorVoice.outputActive = false; });
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.audioMuted)).toBe(false);
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'End conversation', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.tracks.every(track => track.stopped))).toBe(true);
});

test('live adapter receives actual photo focus, modal obscuring, offscreen retained objects and quiet updates', async ({ page }) => {
  await prepare(page);
  let site = publishedSite!;
  const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#698aa0' } }).png().toBuffer();
  const uploaded = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'image/png', 'X-File-Name': 'screen-fixture.png', 'X-Site-Revision': String(site.revision) }, data: bytes });
  expect(uploaded.ok()).toBe(true); const body = await uploaded.json(); site = body.site;
  const fileId = body.fileId as string;
  const saved = await page.request.post(`/api/sites/${site.id}/media`, { headers: { Origin: origin }, data: { revision: site.revision, library: { schemaVersion: 1, id: randomUUID(), assets: [{ id: fileId, width: 640, height: 480, caption: 'Scene photo', alt: 'Synthetic scene' }], albums: [], associations: [] } } });
  expect(saved.ok()).toBe(true); site = (await saved.json()).site;
  const published = await page.request.post(`/api/sites/${site.id}`, { headers: { Origin: origin }, data: { action: 'publish', revision: site.revision } });
  expect(published.ok()).toBe(true); publishedSite = (await published.json()).site;
  await page.reload(); await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await browse(page);
  await page.locator(`[data-workspace-content^="photo:"][data-workspace-content$=":${fileId}"]`).first().click();
  const focused = page.locator('[data-workspace-focused]:not([inert])'); await expect(focused).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.context.scene?.objects.some(object => object.name === 'Scene photo' && object.visibility === 'full'))).toBe(true);
  await focused.getByRole('button', { name: 'Open photo: Scene photo' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(() => { const scene = window.__visitorVoice.controls.at(-1)?.context.scene; return scene?.modal?.kind === 'photo' && scene.objects.every(object => object.open && object.mounted && object.visibility === 'obscured'); })).toBe(true);
  const navigate = async (id: string, target: unknown) => {
    await page.evaluate(({ id, target }) => {
      const state = window.__visitorVoice, revision = state.revision + 1, interactionRevision = state.controls.at(-1)!.interactionRevision;
      state.emit({ type: 'response_started', revision, interactionRevision }); state.emit({ type: 'navigation', id, revision, interactionRevision, target });
    }, { id, target });
    await expect.poll(() => page.evaluate(id => window.__visitorVoice.controls.find(update => update.navigationAck?.id === id)?.navigationAck?.status, id)).toBe('applied');
  };
  await navigate('back-from-photo', { kind: 'back' });
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(focused).toContainText('Scene photo');
  const beforeReopen = await page.evaluate(() => window.__visitorVoice.controls.at(-1)!.interactionRevision);
  await focused.getByRole('button', { name: 'Open photo: Scene photo' }).click(); await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => page.evaluate(revision => {
    const update = window.__visitorVoice.controls.at(-1);
    return update && update.interactionRevision > revision && update.context.scene?.modal?.kind === 'photo';
  }, beforeReopen)).toBe(true);
  await navigate('open-through-photo', { kind: 'open', id: 'source:section:weddings' });
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(focused).toContainText('Wedding stories');
  await navigate('return-to-photo', { kind: 'back' }); await expect(focused).toContainText('Scene photo');
  await focused.getByRole('button', { name: 'Back to workspace' }).click(); await expect(focused).toHaveCount(0);
  await page.locator('[data-workspace-content$=":section:weddings"]').first().click(); await expect(focused).toBeVisible();
  await focused.getByRole('button', { name: 'Back to workspace' }).click(); await expect(focused).toHaveCount(0);
  // Browse deliberately hides retained workspace objects; return to workspace
  // before testing offscreen geometry rather than conflating hidden with offscreen.
  await page.getByRole('button', { name: 'Hide browser', exact: true }).click();
  // Guarantee a long fixture after the focused view closes; a compact website
  // need not naturally push the retained photo outside the viewport.
  await page.locator('.visitor-workspace').evaluate(element => { (element as HTMLElement).style.minHeight = '2400px'; });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.context.scene?.objects.some(object => object.name === 'Scene photo' && object.open && object.visibility === 'offscreen'))).toBe(true);
  const count = await page.evaluate(() => window.__visitorVoice.controls.length); await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__visitorVoice.controls.length)).toBeLessThanOrEqual(count + 1);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
});

test('mocked chat and voice share real visitor query state and reject a late display after manual correction', async ({ page }) => {
  await prepare(page);
  const post = async (path: string, data: unknown) => { const response = await page.request.post(path, { headers: { Origin: origin }, data }); const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body; };
  let site: Site = (await post('/api/sites', { name: 'Task channel conformance', slug: `task-channels-${Date.now()}`, kind: 'general' })).site;
  const space = taskFixture(), metadata = { version: space.version, name: space.name, rootId: space.rootId, fields: space.fields, relationshipTypes: space.relationshipTypes, collections: space.collections, edges: space.edges };
  let { review } = await post(`/api/sites/${site.id}/collections`, { action: 'begin', siteRevision: site.revision, metadata });
  ({ review } = await post(`/api/sites/${site.id}/collections`, { action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
  ({ review } = await post(`/api/sites/${site.id}/collections`, { action: 'finish', reviewId: review.id, revision: review.revision }));
  site = (await post(`/api/sites/${site.id}/collections`, { action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitorSpeaksFirst: true, visitor: { enabled: true, mode: 'both', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  let lastView: VisitorTaskView | undefined;
  page.on('response', async response => { if (response.url().endsWith('/tasks') && response.ok()) { const value = await response.json().catch(() => ({})); if (value.view) lastView = value.view; } });
  await page.getByRole('button', { name: 'Browse published content' }).click();
  const results = page.getByRole('region', { name: 'Website content', exact: true }); await expect(results.getByRole('status')).toHaveText('8 matching items');
  await page.evaluate(() => {
    const previousFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      const path = String(url);
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        const request = JSON.parse(String(init.body));
        const send = async (input: unknown) => { const response = await previousFetch(`${path}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const body = await response.json(); if (!response.ok) throw new Error(body.error); return body; };
        const { view } = await send({ action: 'refresh', sessionId: request.context.taskSession.sessionId });
        const updated = await send({ action: 'execute', sessionId: view.sessionId, call: { operationId: crypto.randomUUID(), capabilityId: 'query.patch', expectedRevision: view.revision, input: { queryId: view.query.queryId, baseRevision: view.query.revision, operations: [{ op: 'addConstraint', parentId: 'criteria', expression: { kind: 'field', id: 'minimum', fieldId: 'reading-minutes', op: 'gte', value: { type: 'number', value: 5, unit: 'units' } } }] } } });
        const events = [{ type: 'control', control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } }, { type: 'navigation', id: crypto.randomUUID(), target: { kind: 'task', view: updated.view } }, { type: 'done', text: 'Three published records match.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } }];
        return new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return previousFetch(url, init);
    };
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true }); await input.fill('Find records with a reading measure of at least five'); await input.press('Enter');
  await expect(results.getByRole('status')).toHaveText('3 matching items'); await expect(page.getByText('Three published records match.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Voice', exact: true }).click(); await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const path = `/api/visitor/${site.slug}/tasks`, current = (await post(path, { action: 'refresh', sessionId: lastView!.sessionId })).view as VisitorTaskView;
  const voice = await post(path, { action: 'execute', sessionId: current.sessionId, call: { operationId: randomUUID(), capabilityId: 'query.patch', expectedRevision: current.revision, input: { queryId: current.query.queryId, baseRevision: current.query.revision, operations: [{ op: 'replaceConstraint', nodeId: 'minimum', expression: { kind: 'field', id: 'minimum', fieldId: 'reading-minutes', op: 'gte', value: { type: 'number', value: 6, unit: 'units' } } }] } } });
  await page.evaluate(view => { window.__visitorVoice.emit({ type: 'response_started', revision: 1 }); window.__visitorVoice.emit({ type: 'navigation', id: 'task-voice', revision: 1, target: { kind: 'task', view } }); }, voice.view);
  await expect(results.getByRole('status')).toHaveText('2 matching items');
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'task-voice')?.navigationAck?.status)).toBe('applied');
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await input.fill('Remove reading minutes'); await input.press('Enter'); await expect(results.getByRole('status')).toHaveText('8 matching items');
  await page.evaluate(view => window.__visitorVoice.emit({ type: 'navigation', id: 'late-task-voice', revision: 2, target: { kind: 'task', view } }), voice.view);
  await expect(results.getByRole('status')).toHaveText('8 matching items'); expect(await page.evaluate(() => window.__visitorVoice.controls.some(update => update.navigationAck?.id === 'late-task-voice' && update.navigationAck.status === 'applied'))).toBe(false);
});

for (const mobile of [false, true]) test(`foreground cards yield to voice task views and Home${mobile ? ' on mobile with reduced motion' : ''}`, async ({ page }) => {
  if (mobile) { await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' }); }
  await prepare(page);
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  };
  let site: Site = (await post('/api/sites', { name: 'Foreground conformance', slug: `foreground-${Date.now()}`, kind: 'general' })).site;
  const upload = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'places.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from('Name,Kind,Summary\nHarbor,place,An approved harbor.\nForest,place,An approved forest.') });
  expect(upload.ok()).toBeTruthy(); const uploaded = await upload.json(); site = uploaded.site;
  const knowledge = await post(`/api/sites/${site.id}/knowledge`, { action: 'analyze', fileId: uploaded.fileId, revision: site.revision, requestId: randomUUID() });
  site = (await post(`/api/sites/${site.id}/knowledge`, { action: 'apply', revision: site.revision, candidateId: knowledge.candidates[0].id, candidateRevisionId: knowledge.candidates[0].catalog.id })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, contact: 'hello@foreground.example', visitorSpeaksFirst: true, visitor: { enabled: true, mode: 'both', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  await page.goto(`/s/${site.slug}`);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  const focused = page.locator('[data-workspace-focused]:not([inert])');
  let revision = 0;
  const navigate = async (id: string, target: unknown) => {
    await page.evaluate(({ id, target, revision }) => { window.__visitorVoice.emit({ type: 'response_started', revision }); window.__visitorVoice.emit({ type: 'navigation', id, revision, target }); }, { id, target, revision: ++revision });
    await expect.poll(() => page.evaluate(id => window.__visitorVoice.controls.find(update => update.navigationAck?.id === id)?.navigationAck?.status, id)).toBe('applied');
  };
  const task = async (capabilityId: string, input: (view: VisitorTaskView) => unknown) => {
    const sessionId = await page.evaluate(() => window.__visitorVoice.controls.at(-1)!.context.taskSession!.sessionId);
    const { view } = await post(`/api/visitor/${site.slug}/tasks`, { action: 'refresh', sessionId });
    return (await post(`/api/visitor/${site.slug}/tasks`, { action: 'execute', sessionId, call: { operationId: randomUUID(), capabilityId, expectedRevision: view.revision, input: input(view) } })).view as VisitorTaskView;
  };
  await navigate('open-contact', { kind: 'open', id: 'source:contact' });
  await expect(focused).toHaveCount(1);
  expect(await page.evaluate(() => window.__visitorVoice.controls.at(-1)?.context.screen?.focusedSourceId)).toBe('contact');
  const query = await task('query.activate', view => ({ queryId: view.query.queryId }));
  await navigate('show-query', { kind: 'task', view: query });
  await expect(focused).toHaveCount(0);
  const results = page.getByRole('region', { name: 'Website content', exact: true });
  await expect(results.getByRole('status')).toHaveText('2 matching items');
  const detail = await task('record.detail', view => ({ recordId: view.records[0].id }));
  await navigate('show-detail', { kind: 'task', view: detail });
  await expect(results.getByRole('region', { name: 'Record detail' })).toBeVisible();
  await task('records.lookup', () => ({ recordIds: [query.records[0].id] }));
  await navigate('back-to-query', { kind: 'back' });
  await expect(results.getByRole('region', { name: 'Record detail' })).toHaveCount(0);
  await navigate('contact-again', { kind: 'open', id: 'source:contact' });
  await navigate('open-harbor', { kind: 'open', id: `entity:${query.records[0].id}` });
  await expect(focused).toHaveCount(0);
  await expect(results.getByRole('region', { name: 'Record detail' })).toContainText(query.records[0].name);
  await navigate('back-to-results', { kind: 'back' });
  await expect(results.getByRole('region', { name: 'Record detail' })).toHaveCount(0);
  await expect(results.getByRole('status')).toHaveText('2 matching items');
  const home = await task('home', () => ({}));
  await navigate('task-home', { kind: 'task', view: home });
  await expect(focused).toHaveCount(0); await expect(results).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.at(-1)?.context.scene?.page)).toBe('home');
  // A late result from before Home cannot reopen a card or disturb a newer foreground.
  await navigate('new-contact', { kind: 'open', id: 'source:contact' });
  await page.evaluate(view => { window.__visitorVoice.emit({ type: 'response_started', revision: 99 }); window.__visitorVoice.emit({ type: 'navigation', id: 'late-query', revision: 99, target: { kind: 'task', view } }); }, query);
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.controls.find(update => update.navigationAck?.id === 'late-query')?.navigationAck?.status)).toBe('cancelled');
  await expect(focused).toHaveCount(1); await expect(focused).toContainText('Get in touch');
  // The same foreground transition must work through chat's streamed adapter.
  await page.evaluate(() => {
    const previousFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      const path = String(url);
      if (/\/api\/visitor\/[^/]+$/.test(path) && init?.method === 'POST') {
        const input = JSON.parse(String(init.body));
        const send = async (data: unknown) => { const response = await previousFetch(`${path}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (!response.ok) throw new Error('Synthetic task failed'); return response.json(); };
        const { view } = await send({ action: 'refresh', sessionId: input.context.taskSession.sessionId });
        const next = await send({ action: 'execute', sessionId: view.sessionId, call: { operationId: crypto.randomUUID(), capabilityId: 'query.activate', expectedRevision: view.revision, input: { queryId: view.query.queryId } } });
        return new Response([
          { type: 'control', control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } },
          { type: 'navigation', id: crypto.randomUUID(), target: { kind: 'task', view: next.view } },
          { type: 'done', text: 'Here are the published places.', availability: { enabled: true, mode: 'both', live: true, chatRemaining: 24, voiceRemaining: 5, resetsAt: '' } },
        ].map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      return previousFetch(url, init);
    };
  });
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'What would you like to see?', exact: true });
  await input.fill('Could you show the published places?'); await input.press('Enter');
  await expect(page.getByText('Here are the published places.', { exact: true })).toBeVisible();
  await expect(focused).toHaveCount(0); await expect(results.getByRole('status')).toHaveText('2 matching items');
  // Clearing the visible workspace must not depend on a healthy task service.
  const tasksUrl = `**/api/visitor/${site.slug}/tasks`;
  await page.route(tasksUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic task outage' }) }));
  await input.fill('Clear workspace'); await input.press('Enter');
  await expect(results).toHaveCount(0); await expect(focused).toHaveCount(0);
  await expect(page.locator('.platform-workspace-card')).toHaveCount(0);
  await page.unroute(tasksUrl);
  await page.getByRole('button', { name: 'Browse published content', exact: true }).click();
  await expect(results).toBeVisible();
  await input.fill('Take me home'); await input.press('Enter');
  await expect(results).toHaveCount(0); await expect(focused).toHaveCount(0);
});

test('voice startup handles legacy descriptive kinds and reports a failed task preflight before an explicit retry', async ({ page }) => {
  await prepare(page);
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers: { Origin: origin }, data });
    const body = await response.json(); expect(response.ok(), JSON.stringify(body)).toBeTruthy(); return body;
  };
  let site: Site = (await post('/api/sites', { name: 'Legacy startup', slug: `legacy-start-${Date.now()}`, kind: 'general' })).site;
  const text = "Name,Kind,Summary\nHarbor,Traveler's guide (regional),An approved regional guide.";
  const upload = await page.request.post(`/api/sites/${site.id}/files`, { headers: { Origin: origin, 'Content-Type': 'text/csv', 'X-File-Name': 'startup.csv', 'X-Site-Revision': String(site.revision) }, data: Buffer.from(text) });
  expect(upload.ok()).toBeTruthy(); const uploaded = await upload.json(); site = uploaded.site;
  const path = `/api/sites/${site.id}/knowledge`;
  const knowledge = await post(path, { action: 'analyze', fileId: uploaded.fileId, revision: site.revision, requestId: randomUUID() });
  site = (await post(path, { action: 'apply', revision: site.revision, candidateId: knowledge.candidates[0].id, candidateRevisionId: knowledge.candidates[0].catalog.id })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'save', revision: site.revision, content: { ...site.draft, visitorSpeaksFirst: true, visitor: { enabled: true, mode: 'both', voiceTier: 'standard', chatDailyLimit: 25, voiceDailyLimit: 5 } } })).site;
  site = (await post(`/api/sites/${site.id}`, { action: 'publish', revision: site.revision })).site;
  let unavailable = true, attempts = 0;
  const diagnostics: string[] = []; page.on('console', message => { if (message.text().includes('[flowpath:visitor]')) diagnostics.push(message.text()); });
  await page.route(`**/api/visitor/${site.slug}/tasks`, route => {
    if (route.request().postDataJSON().action === 'init') {
      attempts++;
      if (unavailable) return route.fulfill({ status: 400, json: { error: 'Synthetic catalog unavailable.' } });
    }
    return route.continue();
  });
  await page.goto(`/s/${site.slug}`);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not prepare the website: Synthetic catalog unavailable.' })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
  expect(attempts).toBe(1);
  expect(diagnostics.some(value => value.includes('"stage":"context"') && value.includes('"status":"failed"') && value.includes('"httpStatus":400'))).toBe(true);
  unavailable = false;
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  expect(attempts).toBe(2);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  expect(diagnostics.some(value => value.includes('"stage":"context"') && value.includes('"status":"succeeded"'))).toBe(true);
});

test('speed: cold preparation is visible and cancellation prevents a paid session', async ({ page }) => {
  await prepare(page);
  let release!: () => void, initializations = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/visitor/*/tasks', async route => {
    if (route.request().postDataJSON().action === 'init') { initializations++; await gate; }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel connection', exact: true })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Preparing voice…' })).toBeVisible();
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
  await page.getByRole('button', { name: 'Cancel connection', exact: true }).click();
  release();
  await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__visitorVoice.tracks.every(track => track.stopped))).toBe(true);
  expect(initializations).toBe(1);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(0);
});

for (const reduced of [false, true]) test(`speed: truthful progress ignores stale events and cancels without disconnecting${reduced ? ' with reduced motion' : ''}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await prepare(page);
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByText('Listening · speak naturally · tap to end', { exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.__visitorVoice.emit({ type: 'response_started', revision: 1 });
    window.__visitorVoice.emit({ type: 'progress', revision: 1, interactionRevision: 0, stage: 'retrieving' });
  });
  const progress = page.getByRole('status').filter({ hasText: 'Checking this site’s information…' });
  await expect(progress).toBeVisible();
  await page.evaluate(() => {
    window.__visitorVoice.outputActive = true;
    window.__visitorVoice.emit({ type: 'progress', revision: 0, interactionRevision: 0, stage: 'searching' });
  });
  await expect(progress).toBeVisible(); await expect(page.getByText('Searching the web…', { exact: true })).toHaveCount(0);
  if (reduced) expect(await progress.locator('[aria-hidden="true"]').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  const progressBox = await progress.boundingBox(), modesBox = await page.getByRole('group', { name: 'Conversation mode' }).boundingBox();
  expect(progressBox!.y + progressBox!.height).toBeLessThanOrEqual(modesBox!.y);
  await page.screenshot({ path: info.outputPath('voice-progress.png') });
  await page.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(progress).toHaveCount(0);
  expect(await page.evaluate(() => window.__visitorVoice.calls)).toBe(1);
  await expect(page.getByRole('button', { name: 'End conversation', exact: true })).toBeVisible();
});
