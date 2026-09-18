import assert from 'node:assert/strict';
import test from 'node:test';
import type { VisitorControlUpdate } from '../lib/visitor-realtime-context';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS, type VisitorAvailability } from '../lib/visitor-model';
import { validateVisitorOffer, visitorRealtimeSession, type VisitorSessionOptions } from '../lib/visitor-realtime-session';
import { LIVE_VOICE_CHOICES, CONVERSATION_PRESETS } from '../lib/voice-settings';

const offer = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=sendrecv\r\n';
const availability: VisitorAvailability = { enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 4, resetsAt: '2026-09-10T00:00:00.000Z' };
function harness(overrides: Partial<VisitorSessionOptions> = {}) {
  const controller = new AbortController();
  const calls: string[] = [];
  let blocked = 0, released = 0, stopped = 0, mailboxClosed = 0;
  const updates: VisitorControlUpdate[] = [];
  let deliver: (update: VisitorControlUpdate) => void = () => {};
  let controlOptions: Parameters<NonNullable<VisitorSessionOptions['controlFactory']>>[0] | undefined;
  const options: VisitorSessionOptions = {
    mailbox: {slug: 'synthetic', siteId: 'site_1', publicationKey: 'snapshot_1'},
    mailboxFactory: async () => ({ capability: {id:'00000000-0000-4000-8000-000000000001', token:'x'.repeat(43)}, subscribe: listener => { deliver = listener; return () => { deliver = () => {}; }; }, close: async () => { mailboxClosed++; } }),
    offer, availability, apiKey: 'offline-placeholder', signal: controller.signal,
    content: { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, voiceTier: 'premium' } },
    reserveTurn: async () => availability, assertCurrent: async () => {},
    onCleanupFailure: () => { blocked++; }, onClosed: () => { released++; },
    fetch: async (input, init) => {
      const url = String(input); calls.push(url);
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer offline-placeholder');
      if (url.endsWith('/hangup')) return new Response(null, { status: 200 });
      const { session: config, transport } = JSON.parse(String(init?.body));
      assert.equal(config.model, 'gpt-live-1'); assert.deepEqual(config.delegation, { type: 'client' });
      assert.equal(transport.sdp, offer); assert.equal('tools' in config, false);
      return Response.json({ session: { id: 'live_offline' }, transport: { type: 'webrtc', sdp: offer } });
    },
    controlFactory: value => {
      controlOptions = value;
      return { ready: Promise.resolve(), start() {}, observeControl() {}, async applyControl(update) { updates.push(update); value.emit({type:'control_applied', seq:update.seq, interactionRevision:update.interactionRevision, revision:update.interactionRevision, ready:update.ready}); }, async close() { stopped++; return { finalized: false }; }, closed: Promise.resolve({ finalized: false }) };
    },
    ...overrides,
  };
  return { options, controller, calls, updates, deliver: (update: VisitorControlUpdate) => deliver(update), mailboxClosed: () => mailboxClosed, metrics: () => ({ blocked, released, stopped }), get control() { return controlOptions!; } };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('owner forwards cancellation hints while an earlier apply is blocked', async t => {
  let release!: () => void;
  const observed: number[] = [], applied: number[] = [];
  const h = harness({ controlFactory: () => ({ ready: Promise.resolve(), start() {},
    observeControl(update) { observed.push(update.seq); },
    async applyControl(update) { applied.push(update.seq); if (update.seq === 1) await new Promise<void>(resolve => { release = resolve; }); },
    async close() { return { finalized: true }; }, closed: Promise.resolve({ finalized: true }),
  }) });
  const response = visitorRealtimeSession(h.options); t.after(() => { h.controller.abort(); return response.body!.cancel(); });
  await flush();
  h.deliver({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {} });
  h.deliver({ seq: 2, interactionRevision: 1, viewRevision: 0, ready: true, context: {} });
  assert.deepEqual(observed, [1, 2]); assert.deepEqual(applied, [1]);
  release(); await flush(); assert.deepEqual(applied, [1, 2]);
});

test('only an audio media section is accepted; control channels cannot be smuggled into SDP', () => {
  assert.equal(validateVisitorOffer(offer), offer);
  for (const bad of [offer + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n', offer + 'a=sctp-port:5000\r\n',
    offer + 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\n', offer.replace('m=audio', 'm=application'),
    offer.replace('m=audio', 'M=audio'), offer.replace('m=audio', ' m=audio'), offer + '\u0000', 'v=0\r\n', offer.repeat(1000)]) {
    assert.throws(() => validateVisitorOffer(bad));
  }
});

test('session streams only public setup, and cancelling the body closes and hangs up once', async () => {
  const h = harness();
  const response = visitorRealtimeSession(h.options);
  assert.match(response.headers.get('content-type')!, /ndjson/);
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.equal(JSON.parse(first).type, 'session');
  assert.equal(JSON.parse(first).idleTimeoutMs, 60_000);
  assert.ok(!first.includes('offline-placeholder'));
  assert.ok(!first.includes('live_offline'));
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, 'ready');
  await reader.cancel();
  h.controller.abort(); await flush();
  assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
  assert.deepEqual(h.metrics(), { blocked: 0, released: 1, stopped: 1 });
});

test('mocked Live session creation uses the selected built-in voice, personality and shorter session limit', async () => {
  for (const voice of Object.keys(LIVE_VOICE_CHOICES) as (keyof typeof LIVE_VOICE_CHOICES)[]) {
    const h = harness({ content: { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, voiceSessionSeconds: 30, conversation: { voice, language: 'es', ...CONVERSATION_PRESETS.quiet.settings } } } });
    const original = h.options.fetch!;
    h.options.fetch = async (url, init) => {
      if (!String(url).endsWith('/hangup')) {
        const { session } = JSON.parse(String(init?.body));
        assert.deepEqual(session.audio, { output: { voice } }); assert.equal(session.model, 'gpt-live-1');
        assert.match(session.instructions, /Listen quietly/); assert.match(session.instructions, /Use Spanish/);
        assert.match(session.instructions, /cool and reserved/); assert.match(session.instructions, /at most 25 words/);
        assert.equal(session.store, false); assert.deepEqual(session.delegation, { type: 'client' });
        assert.equal('temperature' in session, false); assert.equal('speed' in session.audio.output, false);
      }
      return original(url, init);
    };
    const before = Date.now(), response = visitorRealtimeSession(h.options), reader = response.body!.getReader();
    const event = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.ok(event.expiresAt >= before + 30_000 && event.expiresAt <= Date.now() + 30_000);
    await reader.cancel(); h.controller.abort(); await flush();
  }
});

test('restarting does not resubmit an unfinished question as fresh voice input', async () => {
  const history = [{ role: 'user' as const, text: 'Earlier unfinished request.' }];
  const h = harness({ history });
  const original = h.options.fetch!;
  h.options.fetch = async (input, init) => {
    if (!String(input).endsWith('/hangup')) {
      const { session } = JSON.parse(String(init?.body));
      assert.deepEqual(session.input, [], 'Previous questions must not be replayed as live input');
    }
    return original(input, init);
  };
  const response = visitorRealtimeSession(h.options);
  const reader = response.body!.getReader();
  const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  assert.equal(first.protectOpening, false);
  assert.deepEqual(h.control.history, history, 'The backend still receives conversation context');
  await reader.cancel(); h.controller.abort(); await flush();
});

test('aborting during call creation reclaims the eventual call ID rather than abandoning it', async () => {
  let finish!: (response: Response) => void;
  const h = harness();
  const original = h.options.fetch!;
  h.options.fetch = async (input, init) => String(input).endsWith('/hangup') ? original(input, init) : new Promise<Response>(resolve => { finish = resolve; });
  const response = visitorRealtimeSession(h.options);
  await flush(); h.controller.abort();
  finish(Response.json({ session: { id: 'live_offline' }, transport: { type: 'webrtc', sdp: offer } }));
  await response.text(); await flush();
  assert.deepEqual(h.calls, ['https://api.openai.com/v1/live/sessions/live_offline/hangup']);
  assert.deepEqual(h.metrics(), { blocked: 0, released: 1, stopped: 0 });
});

test('a pre-cancelled request makes no provider calls and releases its slot', async () => {
  const h = harness(); h.controller.abort();
  await visitorRealtimeSession(h.options).text();
  assert.deepEqual(h.calls, []);
  assert.equal(h.metrics().released, 1);
});

test('invalid provider SDP and publication changes are cleaned up before client audio connects', async () => {
  for (const changed of [false, true]) {
    const h = harness();
    const original = h.options.fetch!;
    if (changed) h.options.assertCurrent = async () => { throw new Error('changed'); };
    else h.options.fetch = async (input, init) => String(input).endsWith('/hangup') ? original(input, init)
      : Response.json({ session: { id: 'live_offline' }, transport: { type: 'webrtc', sdp: offer + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' } });
    const text = await visitorRealtimeSession(h.options).text(); await flush();
    assert.equal(JSON.parse(text).type, 'error');
    assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
    assert.equal(h.metrics().released, 1);
  }
});

test('unsafe or missing call IDs fail closed without following an attacker-controlled cleanup URL', async () => {
  for (const location of ['', 'https://attacker.example/v1/realtime/calls/rtc_bad', '/v1/realtime/calls/rtc_bad?token=x']) {
    const h = harness({ fetch: async () => Response.json({ session: { id: location }, transport: { type: 'webrtc', sdp: offer } }) });
    const text = await visitorRealtimeSession(h.options).text();
    assert.equal(JSON.parse(text).type, 'error');
    assert.equal(h.metrics().blocked, 1);
    assert.equal(h.metrics().released, 1);
  }
});

test('server deadline and controller fatal events close the provider without browser cooperation', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const fatal of [false, true]) {
    const h = harness({ durationMs: 1000 });
    const reader = visitorRealtimeSession(h.options).body!.getReader();
    await reader.read(); await reader.read();
    if (fatal) h.control.onFatal('Voice allowance reached.');
    else context.mock.timers.tick(1000);
    const ended = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.equal(ended.type, 'ended');
    await flush();
    assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
    assert.equal(h.metrics().released, 1);
    await reader.cancel();
  }
});

test('uncertain hangup blocks later calls and never retries paid work', async () => {
  const h = harness();
  const original = h.options.fetch!;
  h.options.fetch = async (input, init) => String(input).endsWith('/hangup') ? new Response(null, { status: 503 }) : original(input, init);
  const reader = visitorRealtimeSession(h.options).body!.getReader();
  await reader.read(); await reader.cancel();
  assert.equal(h.metrics().blocked, 1);
  assert.equal(h.metrics().released, 1);
  assert.equal(h.calls.length, 1);
});

test('a stalled event reader is closed once without recursively queuing a terminal frame', async () => {
  const h = harness();
  const response = visitorRealtimeSession(h.options);
  await flush();
  for (let index = 0; index < 700; index++) h.control.emit({ type: 'plan', revision: index, interactionRevision: 0, presentation: { padding: 'x'.repeat(1000) } });
  await flush();
  assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
  assert.equal(h.metrics().released, 1);
  await response.body!.cancel();
});

test('natural termination retains the request until bounded provider cleanup completes', async () => {
  let finishHangup!: () => void;
  let retained: Promise<void> | undefined;
  const h = harness({ retainCleanup: work => { retained = work; } });
  const original = h.options.fetch!;
  h.options.fetch = async (input, init) => String(input).endsWith('/hangup')
    ? new Promise<Response>(resolve => { finishHangup = () => resolve(new Response(null, { status: 200 })); }) : original(input, init);
  const reader = visitorRealtimeSession(h.options).body!.getReader();
  await reader.read(); await reader.read();
  h.control.onFatal('Conversation complete.');
  let completed = false;
  const endOfStream = reader.read().then(async result => { assert.equal(JSON.parse(new TextDecoder().decode(result.value)).type, 'ended'); completed = Boolean((await reader.read()).done); });
  await flush();
  assert.equal(completed, false);
  assert.equal(h.metrics().released, 0);
  finishHangup();
  await retained; await endOfStream;
  assert.equal(completed, true);
  assert.equal(h.metrics().released, 1);
});

test('SDP and sideband readiness cannot start the greeting until the browser readiness update is applied', async () => {
  const h = harness();
  const reader = visitorRealtimeSession(h.options).body!.getReader();
  const setup = JSON.parse(new TextDecoder().decode((await reader.read()).value));
  await reader.read();
  assert.equal(setup.control.token.length, 43);
  assert.deepEqual(h.updates, []);
  h.deliver({seq:1,interactionRevision:0,viewRevision:0,ready:true,context:{}});
  assert.equal(JSON.parse(new TextDecoder().decode((await reader.read()).value)).type, 'control_applied');
  assert.equal(h.updates.length, 1);
  await reader.cancel();
  assert.equal(h.mailboxClosed(), 1);
  h.deliver({seq:2,interactionRevision:1,viewRevision:0,ready:true,context:{}});
  assert.equal(h.updates.length, 1);
});

test('missing client readiness times out and reclaims both provider and mailbox', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  const h = harness();
  const reader = visitorRealtimeSession(h.options).body!.getReader();
  await reader.read(); await reader.read();
  t.mock.timers.tick(25_000); await flush();
  const frames = new TextDecoder().decode((await reader.read()).value);
  // Heartbeat frames may precede the terminal event in the queue.
  let ended = frames;
  while (!ended.includes('Audio was not ready')) {
    const next = await reader.read(); if (next.done) break;
    ended += new TextDecoder().decode(next.value);
  }
  assert.match(ended, /Audio was not ready/);
  assert.equal(h.mailboxClosed(), 1);
  assert.equal(h.calls.filter(url => url.endsWith('/hangup')).length, 1);
  assert.deepEqual(h.updates, []);
});

test('audio SDP is delivered while sideband connects, but ready waits for sideband', async () => {
  let release!: () => void;
  let starts = 0;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const h = harness({ controlFactory: () => ({ ready, start() { starts++; }, observeControl() {}, async applyControl() {}, async close() { return { finalized: false }; }, closed: Promise.resolve({ finalized: false }) }) });
  const reader = visitorRealtimeSession(h.options).body!.getReader();
  try {
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('SDP blocked by sideband')), 1000); timer.unref(); })]);
    assert.equal(JSON.parse(new TextDecoder().decode(first.value)).type, 'session');
    let secondDelivered = false;
    const second = reader.read().then(value => { secondDelivered = true; return value; });
    await flush(); assert.equal(secondDelivered, false); assert.equal(starts, 0);
    release();
    assert.equal(JSON.parse(new TextDecoder().decode((await second).value)).type, 'ready');
    assert.equal(starts, 0, 'Browser readiness still gates greeting and microphone');
  } finally { release(); await reader.cancel(); }
});

test('recording attaches to an already-running session without provider calls or reconnection', async t => {
  const { createLiveTestRegistry } = await import('../lib/visitor-test-live');
  const registry = createLiveTestRegistry();
  const events: import('../lib/visitor-test-events').TestObservation[] = [];
  const h = harness({ testRegistry: registry });
  const response = visitorRealtimeSession(h.options);
  t.after(() => { h.controller.abort(); return response.body!.cancel(); });
  await flush(); await flush();
  const capability = { id: '00000000-0000-4000-8000-000000000001', token: 'x'.repeat(43) };
  h.control.record?.({ type: 'voice.received', data: { delta: 'Before recording' } });
  const beforeCalls = [...h.calls];
  assert.equal(registry.attach('other-site', capability, event => events.push(event)), false);
  assert.equal(registry.attach('synthetic', { ...capability, token: 'y'.repeat(43) }, event => events.push(event)), false);
  assert.equal(registry.attach('synthetic', capability, event => events.push(event)), true);
  h.control.record?.({ type: 'voice.received', data: { type: 'session.output_transcript.delta', delta: 'Call 212 555 0199' } });
  assert.ok(events.some(event => event.type === 'voice.config_snapshot'));
  assert.ok(events.some(event => event.type === 'voice.capture_attached'));
  assert.match(JSON.stringify(events), /Call 212 555 0199/);
  assert.doesNotMatch(JSON.stringify(events), /Before recording|offline-placeholder/);
  assert.deepEqual(h.calls, beforeCalls);
  h.controller.abort(); await flush();
  assert.equal(registry.attach('synthetic', capability, () => {}), false);
});
