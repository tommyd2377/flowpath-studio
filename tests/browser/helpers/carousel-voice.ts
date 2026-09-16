import { expect, type Page } from '@playwright/test';
import type { Site } from '../../../lib/site-model';
import type { VisitorContext, VisitorHistory, VisitorControlUpdate } from '../../../lib/visitor-realtime-context';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const origin = 'http://127.0.0.1:3225';
type Harness = { controls: VisitorControlUpdate[]; requests: { context: VisitorContext; history: VisitorHistory }[]; chats: { context: VisitorContext; history: VisitorHistory; text: string }[]; inputActive: boolean; outputActive: boolean; outgoing: { stopped: boolean; enabled: boolean }[]; audioMuted: boolean; ack: boolean; failControl: boolean; deferConnection: boolean; deferTrack: boolean; neverResolvePlay: boolean; connect: () => void; attach: () => void; revision: number; calls: number; closed: number; aborted: number; tracks: { stopped: boolean; enabled: boolean }[]; deferPermission: boolean; releasePermission: () => void; emit: (event: unknown) => void; disconnect: () => void; offers: string[] };

let publishedSite: Site | undefined;
let greetingSite: Site | undefined;

export async function prepareCarouselVoice(page: Page, welcome = false) {
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
    const state: Harness = { controls: [], requests: [], chats: [], inputActive: false, outputActive: false, outgoing: [], audioMuted: false, ack: true, failControl: false, deferConnection: false, deferTrack: false, neverResolvePlay: false, connect() {}, attach() {}, revision: 0, calls: 0, closed: 0, aborted: 0, tracks: [], deferPermission: false, releasePermission() {}, offers: [],
      emit(event) { const frame = event as { type: string; revision?: number; interactionRevision?: number }; if (frame.revision !== undefined) state.revision = Math.max(state.revision, frame.revision); sink?.enqueue(new TextEncoder().encode(`${JSON.stringify(['response_started', 'plan', 'playback_started', 'transcript', 'navigation'].includes(frame.type) ? { interactionRevision: 0, ...frame } : frame)}\n`)); },
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
        state.calls++; state.requests.push(JSON.parse(String(init?.body))); state.offers.push(JSON.parse(String(init?.body)).sdp);
        const body = new ReadableStream<Uint8Array>({ start(controller) { sink = controller; }, cancel() { state.aborted++; sink = undefined; } });
        state.emit({ type: 'session', sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n', availability, expiresAt: Date.now() + 120000, control: { id: '00000000-0000-4000-8000-000000000001', token: 'a'.repeat(43) } });
        state.emit({ type: 'ready' });
        return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
      if (/\/api\/visitor\/[^/]+\/session\/control$/.test(path)) {
        const { update } = JSON.parse(String(init?.body)); state.controls.push(update); if (update.end) queueMicrotask(() => state.emit({ type: 'ended', message: 'Ended.' }));
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
  return site;
}
