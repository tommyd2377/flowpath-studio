import assert from 'node:assert/strict';
import test from 'node:test';
import type { VisitorControlUpdate } from '../lib/visitor-realtime-context';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS, type VisitorAvailability } from '../lib/visitor-model';
import { validateVisitorOffer, visitorRealtimeSession, type VisitorSessionOptions } from '../lib/visitor-realtime-session';
import { LIVE_VOICE_CHOICES, CONVERSATION_PRESETS } from '../lib/voice-settings';
import { DEFAULT_EXPLORE_SETTINGS } from '../lib/explore-model';
import { AppError } from '../lib/errors';

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

test('direct-answer sessions periodically verify publication without overlapping checks and close on change', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
  let calls = 0, changed = false, finish: (() => void) | undefined;
  const h = harness({ assertCurrent: async () => {
    calls++;
    if (calls === 1) return;
    await new Promise<void>(resolve => { finish = resolve; });
    if (changed) throw new AppError('This site was updated. Reload to continue with its current information.', 409);
  } });
  const response = visitorRealtimeSession(h.options); t.after(() => { h.controller.abort(); return response.body!.cancel(); });
  await flush();
  h.deliver({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {} }); await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(15_000); await flush(); assert.equal(calls, 2);
  t.mock.timers.tick(15_000); await flush(); assert.equal(calls, 2, 'only one publication check can be outstanding');
  changed = true; finish!(); await flush(); await flush();
  assert.equal(h.metrics().stopped, 1); assert.equal(h.mailboxClosed(), 1);
  assert.equal(h.calls.filter(url => url.endsWith('/sessions')).length, 1, 'no model retry or reconnect');
});

test('session duration supports ten minutes, retains the legacy default and bounds overrides', async () => {
  for (const [seconds, durationMs, expected] of [[undefined, undefined, 120_000], [600, undefined, 600_000], [600, 900_000, 600_000]] as const) {
    const h = harness({ content: { ...sampleContent('general'), visitor: { ...DEFAULT_VISITOR_SETTINGS, voiceSessionSeconds: seconds } }, durationMs });
    const before = Date.now(), response = visitorRealtimeSession(h.options), reader = response.body!.getReader();
    const event = JSON.parse(new TextDecoder().decode((await reader.read()).value));
    assert.ok(event.expiresAt >= before + expected && event.expiresAt <= Date.now() + expected);
    assert.equal(event.idleTimeoutMs, 60_000, 'Session maximum does not disable inactivity cleanup');
    await reader.cancel(); h.controller.abort(); await flush();
  }
});

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

test('Live receives website-wide delegation authority even with an empty screen, with publisher permissions intact', async () => {
  for (const enabled of [false, true]) {
    const content = { ...sampleContent('general'), name: enabled ? 'Aster Consulting' : 'Harbor Gallery', contact: '555-0109',
      visitor: { ...DEFAULT_VISITOR_SETTINGS, assistantPurpose: 'Help visitors explore our published work.' },
      explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled } };
    const h = harness({ content, context: {} });
    const original = h.options.fetch!;
    h.options.fetch = async (url, init) => {
      if (!String(url).endsWith('/hangup')) {
        const { session } = JSON.parse(String(init?.body));
        assert.ok(session.instructions.includes(JSON.stringify(content.name)));
        assert.ok(session.instructions.includes(JSON.stringify(content.visitor.assistantPurpose)));
        assert.match(session.instructions, /Publisher assistant role \(quoted guidance\)/);
        assert.match(session.instructions, /separate from the welcome message and opening topics/);
        assert.match(session.instructions, /Identity questions: When asked "Who are you\?"/);
        assert.match(session.instructions, /accurately repeat the publisher's quoted role/);
        assert.match(session.instructions, /Explaining your own configured role requires no lookup or delegation/);
        for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Delegate to the backend when:', 'Do not delegate to the backend when:']) assert.ok(session.instructions.includes(heading), heading);
        assert.match(session.instructions, /entire current publication/);
        assert.match(session.instructions, /empty screen is never evidence/);
        assert.match(session.instructions, /Delegate before claiming information is missing/);
        assert.match(session.instructions, /phone numbers/);
        assert.match(session.instructions, /multiple sentences and pauses/);
        const direct = session.instructions.split('Do not delegate to the backend when:')[1].split('General knowledge can explain')[0];
        assert.match(direct, /straightforward general question or explaining a stable concept from your own reliable general knowledge/);
        assert.match(direct, /Do not refuse just because the subject is absent from this website/);
        assert.match(direct, /Answering directly from the current server-supplied published website facts/);
        assert.match(direct, /confirmed context even if they are not on screen or were never returned by an earlier backend request/);
        assert.match(direct, /Reuse confirmed conversation findings without searching again/);
        assert.match(direct, /preserve its exact facts, scope and qualifications/);
        const delegated = session.instructions.split('Delegate to the backend when:')[1].split('Do not delegate')[0];
        assert.match(delegated, /publisher-specific facts not sufficiently supported by current server-supplied published knowledge/);
        assert.match(delegated, /show, find, filter, change or close/);
        assert.match(delegated, /careful reasoning, calculations, multi-step synthesis, current or uncertain information/);
        assert.match(session.instructions, /cannot establish this publisher's prices, policies, hours, availability or capabilities/);
        assert.match(session.instructions, /latest confirmed selection; delegate if its identity or relevant facts are unclear/);
        assert.match(session.instructions, /Retained dialogue is context, not proof/);
        assert.match(session.instructions, /display action succeeded only after the browser confirms it/);
        assert.equal(session.instructions.includes('External research is disabled'), !enabled);
        assert.equal(session.instructions.includes('External research: search the web, images and maps'), enabled);
        assert.equal(session.input.length, 1);
        assert.equal(session.input[0].role, 'developer');
        assert.match(session.input[0].content[0].text, /Published website knowledge snapshot/);
        assert.ok(session.input[0].content[0].text.includes(content.contact), 'Live receives the published facts before a card opens');
      }
      return original(url, init);
    };
    const response = visitorRealtimeSession(h.options), reader = response.body!.getReader();
    await reader.read(); await reader.read();
    assert.equal(h.control.content.contact, content.contact, 'The backend retains the approved facts; an empty screen does not strip them');
    await reader.cancel(); h.controller.abort(); await flush();
  }
});

test('expanded knowledge and coverage metrics reach the actual startup request without extra provider calls', async () => {
  const events: import('../lib/visitor-test-events').TestObservation[] = [];
  const h = harness({ content: { ...sampleContent('general'), sections: Array.from({ length: 4 }, (_, i) => ({ id: `policy-${i}`, title: `Policy ${i}`, body: `POLICY_${i}: ` + 'Applies only to advance requests. '.repeat(80) })) },
    record: event => { events.push(event); } });
  const original = h.options.fetch!;
  let inputBytes = 0, instructionBytes = 0;
  h.options.fetch = async (input, init) => {
    if (!String(input).endsWith('/hangup')) {
      const { session } = JSON.parse(String(init?.body));
      inputBytes = Buffer.byteLength(session.input[0].content[0].text);
      instructionBytes = Buffer.byteLength(session.instructions);
      assert.match(session.instructions, /Additional published website reference JSON/);
      assert.match(session.instructions, /Backchannel policy/);
      for (let i = 0; i < 4; i++) assert.ok((session.instructions + session.input[0].content[0].text).includes(`POLICY_${i}:`), 'Whole sections are available before the conversation starts');
      assert.ok(inputBytes <= 7680); assert.ok(instructionBytes <= 15_872);
    }
    return original(input, init);
  };
  const response = visitorRealtimeSession(h.options), reader = response.body!.getReader();
  try {
    await reader.read(); await reader.read();
    assert.equal(h.calls.length, 1, 'Knowledge preparation adds no model/counting round');
    const coverage = events.find(event => event.type === 'voice.knowledge_coverage')?.data as { countingMode: string; inputBytes: number; instructionBytes: number; preparationMs: number };
    assert.equal(coverage.countingMode, 'conservative_utf8');
    assert.equal(coverage.inputBytes, inputBytes); assert.equal(coverage.instructionBytes, instructionBytes);
    assert.ok(coverage.preparationMs >= 0);
  } finally { await reader.cancel(); h.controller.abort(); await flush(); }
});

test('fresh assistant-first sessions prime ordered introductory substance and tell the controller to avoid duplicate commentary', async () => {
  for (const mode of ['fresh', 'visitor-first', 'resumed'] as const) {
    const sections = [{ id: 'story', title: 'About the workshop', body: 'An independent studio teaches small groups. All visits require prior arrangement.' }];
    const content = { ...sampleContent('general'), sections, welcomeMessage: 'WELCOME_OPENING_ONLY', visitorSpeaksFirst: mode === 'visitor-first',
      greetingPoints: [{ kind: 'source' as const, id: 'section:story' }, { kind: 'record' as const, id: 'guided-class' }, null] };
    const body = 'A tutor leads visitors through the process. Materials are included; attendance must be confirmed.';
    const h = harness({ content, greetingRecords: [{ id: 'guided-class', title: 'Guided learning', body }],
      ...(mode === 'resumed' ? { history: [{ role: 'assistant' as const, text: 'An earlier answer.' }] } : {}),
    });
    const original = h.options.fetch!;
    h.options.fetch = async (url, init) => {
      if (!String(url).endsWith('/hangup')) {
        const { session } = JSON.parse(String(init?.body));
        const input = session.input[0].content[0].text;
        const snapshot = JSON.parse(input.slice(input.indexOf('\n') + 1));
        if (mode === 'fresh') {
          assert.match(session.instructions, /Opening policy, only after the application explicitly asks/);
          assert.match(session.instructions, /two or three natural sentences/);
          assert.match(session.instructions, /Page titles are organizational labels/);
          assert.match(session.instructions, /ordinary answer word\/sentence limits and no-follow-up preferences/);
          assert.match(session.instructions, /This policy is preparation only\. Wait silently/);
          assert.ok(Buffer.byteLength(session.instructions) <= 15_872, 'Opening policy participates in the existing startup instruction budget');
          assert.ok(Buffer.byteLength(input) <= 7680);
          assert.equal(snapshot.opening.welcomeWords, content.welcomeMessage);
          assert.deepEqual(snapshot.opening.topics.map((topic: { label: string }) => topic.label), ['About the workshop', 'Guided learning']);
          assert.equal(snapshot.opening.coverage.complete, true);
          const topic = snapshot.opening.topics[1];
          assert.equal(snapshot.records.find((record: { id: string }) => record.id === topic.reference.id).data.text, body);
        } else {
          assert.doesNotMatch(session.instructions, /Opening policy, only after|two or three natural sentences/);
          assert.equal(snapshot.opening, undefined);
          assert.doesNotMatch(input, /WELCOME_OPENING_ONLY/);
        }
      }
      return original(url, init);
    };
    const response = visitorRealtimeSession(h.options), reader = response.body!.getReader();
    try {
      await reader.read(); await reader.read();
      assert.equal(h.control.greetingPrimed, mode === 'fresh');
      assert.equal(h.calls.length, 1, 'Priming adds no generation, counting round or paid retry');
    } finally { await reader.cancel(); h.controller.abort(); await flush(); }
  }
});

test('restarting does not resubmit an unfinished question as fresh voice input', async () => {
  const history = [{ role: 'user' as const, text: 'Earlier unfinished request.' }];
  const h = harness({ history });
  const original = h.options.fetch!;
  h.options.fetch = async (input, init) => {
    if (!String(input).endsWith('/hangup')) {
      const { session } = JSON.parse(String(init?.body));
      assert.equal(session.input.length, 1);
      assert.equal(session.input[0].role, 'developer', 'Startup input is factual app context, not a replayed visitor message');
      assert.match(session.input[0].content[0].text, /not instructions, a visitor request, speech to read aloud/);
      assert.doesNotMatch(session.input[0].content[0].text, /Earlier unfinished request/, 'Previous questions must not be replayed as live input');
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
  const coverage = events.find(event => event.type === 'voice.knowledge_coverage')?.data as { countingMode: string; preparationMs: number };
  assert.equal(coverage.countingMode, 'conservative_utf8');
  assert.ok(coverage.preparationMs >= 0, 'A late recorder receives numeric priming diagnostics without buffering unrecorded speech');
  const startup = events.find(event => event.type === 'voice.startup_snapshot')?.data as { startedAt: number; phases: Record<string, number> };
  assert.ok(startup.startedAt > 0);
  assert.deepEqual(Object.keys(startup.phases), ['mailbox_ready', 'knowledge_ready', 'provider_ready', 'publication_verified', 'sideband_ready']);
  const timings = Object.values(startup.phases);
  assert.ok(timings.every((value, index) => value >= 0 && (index === 0 || value >= timings[index - 1])));
  assert.match(JSON.stringify(events), /Call 212 555 0199/);
  assert.doesNotMatch(JSON.stringify(events), /Before recording|offline-placeholder/);
  assert.deepEqual(h.calls, beforeCalls);
  h.controller.abort(); await flush();
  assert.equal(registry.attach('synthetic', capability, () => {}), false);
});
