import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeTestRecorder, sanitizeTestObservation, LOCAL_TEST_HEADER, type TestObservation } from '../lib/visitor-test-events';
import { createTestRecordingStore, localRecordingRequest, recordingLimits } from '../lib/visitor-test-recording-store';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { createLiveRuntime, type LiveSocket } from '../lib/gpt-live/runtime';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
import { observeTestSocket } from '../lib/visitor-test-socket';
import { createVisitorRealtimeControl } from '../lib/visitor-realtime-control';
import { sampleContent } from '../lib/site-model';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';

test('local recording requires development, loopback, explicit same-origin and custom header', () => {
  const make = (url = 'http://127.0.0.1:3220/api/dev/recordings', headers: Record<string, string> = { origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1' }) => new Request(url, { method: 'POST', headers });
  assert.equal(localRecordingRequest(make(), 'development'), true);
  assert.equal(localRecordingRequest(make('http://localhost:3220/api/dev/recordings', { host: '127.0.0.1:3220', origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1' }), 'development'), true, 'Next request URL normalization preserves the browser origin boundary');
  assert.equal(localRecordingRequest(make(undefined, { host: 'localhost:3220', origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1' }), 'development'), false);
  for (const mode of ['production', 'test', undefined] as const) assert.equal(localRecordingRequest(make(), mode), false);
  for (const headers of [{}, { origin: 'https://evil.example', [LOCAL_TEST_HEADER]: '1' }, { origin: 'null', [LOCAL_TEST_HEADER]: '1' }, { origin: 'http://127.0.0.1:3220' }, { origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1', host: 'evil.example' }, { origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1', 'sec-fetch-site': 'cross-site' }]) assert.equal(localRecordingRequest(make(undefined, headers as Record<string, string>), 'development'), false);
  assert.equal(localRecordingRequest(make('https://studio.example/api/dev/recordings'), 'development'), false);
});

test('copies redact nested JSON, credentials, opaque reasoning and binary media without touching inputs', () => {
  const data = { instructions: 'Published information only.', apiKey: 'synthetic-secret', transport: { sdp: 'private connection' }, output: [{ type: 'reasoning', encrypted_content: 'opaque-private' }],
    input: JSON.stringify({ context: { control: { token: 'private-control' }, transcript: 'A blue bowl please', image_url: 'data:image/png;base64,abc' } }),
    arguments: JSON.stringify({ password: 'do-not-save' }), url: 'https://user:pass@photos.example/pic?signature=private', text: 'Bearer fake-private-token' };
  const before = JSON.stringify(data), saved = sanitizeTestObservation({ type: 'model.request', data });
  assert.equal(JSON.stringify(data), before); assert.equal(saved.redacted, true);
  const serialized = JSON.stringify(saved);
  for (const privateValue of ['synthetic-secret', 'private connection', 'opaque-private', 'private-control', 'do-not-save', 'signature=private', 'fake-private-token', 'data:image/png']) assert.ok(!serialized.includes(privateValue));
  assert.match(serialized, /A blue bowl please/); assert.match(serialized, /Published information only/);
  const source = { count: 1 };
  safeTestRecorder(event => { (event.data as { count: number }).count = 9; throw new Error('broken observer'); })({ type: 'test', data: source });
  assert.deepEqual(source, { count: 1 });
});

test('oversized and cyclic observations are bounded and visibly incomplete', () => {
  const cycle: Record<string, unknown> = { text: '汉'.repeat(400_000), values: Array.from({ length: 2000 }, (_, id) => ({ id })) }; cycle.self = cycle;
  const event = sanitizeTestObservation({ type: 'model.request', data: cycle });
  assert.equal(event.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(event)) < 241_000);
  const largeJson = sanitizeTestObservation({ type: 'model.request', data: JSON.stringify({ apiKey: 'synthetic-secret', content: 'x'.repeat(240_000) }) });
  assert.equal(largeJson.truncated, true); assert.doesNotMatch(JSON.stringify(largeJson), /synthetic-secret/);
});

test('separate recordings retain detached snapshots, browser clocks, markers, redactions and stop boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-recorder-'));
  const store = createTestRecordingStore(directory);
  try {
    const a = await store.start('Publisher A', { build: 'fixture' }), b = await store.start('Publisher B', {});
    const data = { activeId: 'bowl' }; store.observer(a.id, 'trace-a')({ type: 'screen.accepted', data }); data.activeId = 'changed';
    store.observer(b.id, 'trace-b')({ type: 'model.request', data: { text: 'Only B knows this' } });
    store.append(a.id, [{ type: 'problem.marked', source: 'browser', at: 1234, monotonicMs: 55, sequence: 1, data: { note: 'Wrong card' }, truncated: true }], 2);
    await store.stop(a.id); store.observer(a.id)({ type: 'after.stop', data: 'must not record' }); await store.stop(b.id);
    const events = await store.read(a.id), serialized = JSON.stringify(events);
    assert.match(serialized, /bowl/); assert.doesNotMatch(serialized, /changed|Only B|after.stop/);
    assert.equal(events.find(event => event.type === 'problem.marked')?.at, 1234);
    assert.equal(events.find(event => event.type === 'problem.marked')?.truncated, true);
    assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4]);
    assert.equal((await stat(join(directory, `${a.id}.jsonl`))).mode & 0o777, 0o600);
    const recovered = createTestRecordingStore(directory); const info = (await recovered.list()).find(item => item.id === a.id)!;
    assert.equal(info.active, false); assert.equal(info.dropped, 2); assert.equal(info.error, undefined);
    await assert.rejects(store.read('../outside'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('storage budgets, rotation, expiration and write failure never grow an unbounded queue', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-recorder-limits-'));
  const store = createTestRecordingStore(directory, { ...recordingLimits, sessions: 2, active: 1, bytes: 6000, queueBytes: 2000, durationMs: 200 });
  try {
    const a = await store.start('A', {}); await assert.rejects(store.start('too many', {}));
    for (let i = 0; i < 100; i++) store.observer(a.id)({ type: 'synthetic', data: 'x'.repeat(1000) });
    await store.stop(a.id); assert.ok((await store.list())[0].dropped > 0); assert.ok((await stat(join(directory, `${a.id}.jsonl`))).size <= 6000);
    const b = await store.start('B', {}); await store.stop(b.id); const c = await store.start('C', {});
    assert.equal((await store.list()).length, 2); await assert.rejects(store.read(a.id));
    await new Promise(resolve => setTimeout(resolve, 230)); assert.equal((await store.list()).find(item => item.id === c.id)!.active, false);
    const d = await store.start('D', {}); await rm(directory, { recursive: true, force: true });
    assert.doesNotThrow(() => store.observer(d.id)({ type: 'failure', data: 'disk unavailable' })); await store.stop(d.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const channel of ['voice', 'chat'] as const) test(`${channel}: recorder on/off produces identical provider requests, actions and answers`, async () => {
  async function scenario(record?: (event: TestObservation) => void) {
    const bodies: unknown[] = [], actions: unknown[] = []; let round = 0;
    const result = await runVisitorTask({ channel, model: 'offline-model', apiKey: 'synthetic-key', instructions: 'Follow published references.', context: { request: 'Show the blue bowl, then explain it.', currentView: { activeId: 'home' } },
      signal: new AbortController().signal, tools: [{ type: 'function', name: 'open', description: 'Open a published card', parameters: {} }], record,
      fetch: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: round++ === 0 ? [{ type: 'reasoning', encrypted_content: 'opaque-model-state' }, liveTool('open', { id: 'blue-bowl' })] : [liveAnswer('The blue bowl is shown.')] }); },
      execute: async (name, args) => { actions.push({ name, args }); return { data: { status: 'applied', currentView: { activeId: 'blue-bowl' } } }; },
    });
    return { bodies, actions, result };
  }
  const baseline = await scenario(), events: TestObservation[] = [];
  const recorded = await scenario(event => events.push(event));
  assert.deepEqual(recorded, baseline); assert.deepEqual(await scenario(() => { throw new Error('Disk failed'); }), baseline);
  assert.deepEqual(events.map(event => event.type), ['model.request', 'model.response', 'tool.request', 'tool.result', 'model.request', 'model.response']);
  assert.doesNotMatch(JSON.stringify(events), /opaque-model-state|synthetic-key/);
  const first = events[0].data as { body: { input: unknown[] } }; assert.equal(first.body.input.length, 1, 'Later tool rounds cannot mutate a recorded input');
});

test('failed validation and cancellation are recorded without retries or successful tool results', async () => {
  for (const cancel of [false, true]) {
    let calls = 0; const events: TestObservation[] = [], controller = new AbortController();
    await assert.rejects(runVisitorTask({ channel: 'voice', model: 'offline', apiKey: 'fake', context: {}, instructions: '', signal: controller.signal, record: event => events.push(event), tools: [{ name: 'open', type: 'function', description: '', parameters: {} }],
      fetch: async () => { calls++; return Response.json({ status: 'completed', output: [liveTool('open', { id: 'unknown' })] }); },
      execute: async () => { if (cancel) controller.abort(); throw new Error('Unpublished reference'); },
    }));
    assert.equal(calls, 1); assert.equal(events.at(-1)?.type, cancel ? 'task.cancelled' : 'task.failed');
    assert.equal(events.some(event => event.type === 'tool.result'), false);
  }
});

test('voice observation records existing fragments and appends without introducing speech or work', async () => {
  async function scenario(observe?: (event: TestObservation) => void) {
    const socket = new FakeLiveSocket(); let calls = 0;
    const live = createLiveRuntime({ sessionId: 'sess_test', apiKey: 'synthetic', socketFactory: () => observe ? observeTestSocket(socket as unknown as LiveSocket, observe) : socket as unknown as LiveSocket,
      delegate: async () => { calls++; return { text: 'Published answer' }; }, onFatal: message => assert.fail(message), closeTimeoutMs: 20 });
    socket.open(); await live.ready; live.start(); socket.user('What is this?'); await flushLive(); await flushLive(); await live.close();
    return { sent: socket.sent, calls };
  }
  const baseline = await scenario(), observed: object[] = [];
  assert.deepEqual(await scenario(event => observed.push(event.data as object)), baseline);
  assert.deepEqual(await scenario(() => { throw new Error('Observer failed'); }), baseline);
  assert.ok(observed.some(event => 'type' in event && event.type === 'session.input_transcript.delta'));
  assert.ok(observed.some(event => 'type' in event && event.type === 'session.commentary.append'));
});

test('production recorder API is unavailable before body parsing or filesystem access', async () => {
  const { POST } = await import('../app/api/dev/recordings/route');
  const previous = process.env;
  process.env = { ...previous, NODE_ENV: 'production' };
  try {
    const response = await POST(new Request('http://127.0.0.1:3220/api/dev/recordings', { method: 'POST', headers: { origin: 'http://127.0.0.1:3220', [LOCAL_TEST_HEADER]: '1' }, body: 'not JSON' }));
    assert.equal(response.status, 404);
    let called = false; safeTestRecorder(() => { called = true; })({ type: 'test', data: 'private' }); assert.equal(called, false);
  } finally { process.env = previous; }
});

test('Studio voice adapter preserves actual model inputs and speech output with recording enabled or broken', async () => {
  async function scenario(record?: (event: TestObservation) => void) {
    const socket = new FakeLiveSocket(), requests: unknown[] = [], events: VisitorRealtimeEvent[] = [];
    const availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 4, resetsAt: '' };
    const control = createVisitorRealtimeControl({ callId: 'live_recording_fixture', traceId: 'recording-parity', apiKey: 'synthetic', record,
      content: { ...sampleContent('general'), visitorSpeaksFirst: true }, initialAvailability: availability,
      signal: new AbortController().signal, reserveTurn: async () => availability, assertCurrent: async () => {},
      emit: event => events.push(event), onFatal: message => assert.fail(message), socketFactory: () => socket as unknown as LiveSocket,
      fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: [liveAnswer('Published answer')] }); },
    });
    socket.open(); await control.ready; control.start(); socket.user('What information can you help me find?'); await flushLive(); await flushLive();
    if (!record) assert.equal(socket.listenerCount('message'), 1, 'No additional socket observation when recording is disabled');
    await control.close();
    return { requests, sent: socket.sent, transcripts: events.filter(event => event.type === 'transcript').map(event => ({ role: event.role, text: event.text })) };
  }
  const baseline = await scenario(), events: TestObservation[] = [];
  assert.deepEqual(await scenario(event => events.push(event)), baseline);
  assert.deepEqual(await scenario(() => { throw new Error('Recorder unavailable'); }), baseline);
  assert.ok(events.some(event => event.type === 'voice.context'));
  assert.ok(events.some(event => event.type === 'model.request'));
  assert.ok(events.some(event => event.type === 'voice.received'));
});
