import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { visitorControlSchema, type VisitorControlUpdate } from '../lib/visitor-realtime-context';
import { readVisitorRealtimeEvents, type VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { prepareVisitorVoiceRequest } from '../lib/visitor-request-preparation';
import { sampleContent } from '../lib/site-model';
import { FakeLiveSocket, flushLive, liveAnswer } from './helpers/live-fixture';

async function setup(assertCurrent: () => Promise<void> = async () => {}) {
  const socket = new FakeLiveSocket(), events: VisitorRealtimeEvent[] = [], requests: unknown[] = [], failures: string[] = [];
  const availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  let reservations = 0, sequence = 0, turn = 0;
  const control = createVisitorRealtimeControl({ callId: 'preparation-test', apiKey: 'synthetic', content: { ...sampleContent('general'), visitorSpeaksFirst: true },
    initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => { reservations++; return availability; }, assertCurrent,
    emit: event => events.push(event), onFatal: message => failures.push(message), socketFactory: () => socket as unknown as VisitorControlSocket,
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: [liveAnswer('The confirmed answer.')] }); },
  });
  socket.open(); await control.ready; control.start();
  return { control, events, requests, failures, reservations: () => reservations,
    async ask(text = 'Explain the published offering.') {
      const start = ++turn * 3000;
      socket.frame({ type: 'session.input_transcript.delta', delta: text, start_ms: start, end_ms: start + 300 });
      socket.frame({ type: 'session.delegation.created', offset_ms: start + 300, delegation: { id: `question-${turn}`, target: 'client' } });
      await flushLive();
      return events.filter(event => event.type === 'response_started').at(-1)!;
    },
    update(overrides: Partial<VisitorControlUpdate> = {}) {
      return control.applyControl(visitorControlSchema.parse({ seq: ++sequence, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, ...overrides }));
    },
  };
}

test('each voice request waits for validated preparation before model work or another turn reservation', async t => {
  const h = await setup(); t.after(() => h.control.close());
  const first = await h.ask();
  assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
  await h.update({ preparationAck: { revision: first.revision, status: 'applied' }, context: { expandedSourceIds: ['overview'] } }); await flushLive();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.control.recordingSnapshot().context.expandedSourceIds, ['overview']);
  const second = await h.ask('Explain the other published offering.');
  assert.equal(h.requests.length, 1); assert.equal(h.reservations(), 0, 'The connection prepaid only its first task');
  await h.update({ preparationAck: { revision: second.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 2); assert.equal(h.reservations(), 1);
  await h.update({ preparationAck: { revision: second.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 2); assert.equal(h.reservations(), 1, 'Duplicate acknowledgments cannot repeat work');
  assert.deepEqual(h.failures, []);
});

test('publication validation completes before preparation releases the model', async t => {
  let release!: () => void;
  const h = await setup(() => new Promise<void>(resolve => { release = resolve; })); t.after(() => h.control.close());
  const request = await h.ask();
  const applying = h.update({ preparationAck: { revision: request.revision, status: 'applied' } });
  await flushLive(); assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
  // Stop during validation: the eventual acknowledgment cannot restart this request.
  await h.control.close(); release(); await applying; await flushLive();
  assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
});

test('invalid, not-ready and wrong-revision preparation cannot release a request', async t => {
  const h = await setup(); t.after(() => h.control.close()); const request = await h.ask();
  await assert.rejects(h.update({ preparationAck: { revision: request.revision, status: 'applied' }, context: { expandedSourceIds: ['unpublished-source'] } }));
  await h.update({ preparationAck: { revision: request.revision + 1, status: 'applied' } });
  await h.update({ preparationAck: { revision: request.revision, status: 'applied' }, ready: false });
  await flushLive(); assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
  await h.update({ preparationAck: { revision: request.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 1);
});

for (const status of ['failed', 'cancelled'] as const) test(`${status} preparation preserves the session without paid work or retry`, async t => {
  const h = await setup(); t.after(() => h.control.close()); const request = await h.ask();
  await h.update({ preparationAck: { revision: request.revision, status } }); await flushLive();
  assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
  assert.ok(h.events.some(event => event.type === 'task_error' && /could not be prepared/.test(event.message)));
  assert.equal(h.events.some(event => event.type === 'answer_completed'), false);
  assert.deepEqual(h.failures, []);
});

test('an old client without a preparation acknowledgment fails clearly after five seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await setup(); t.after(() => h.control.close()); await h.ask();
  t.mock.timers.tick(4999); await flushLive();
  assert.equal(h.events.some(event => event.type === 'task_error'), false);
  t.mock.timers.tick(1); await flushLive();
  assert.ok(h.events.some(event => event.type === 'task_error' && /Reload the page/.test(event.message)));
  assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
  t.mock.timers.tick(5000); await flushLive(); assert.equal(h.requests.length, 0);
});

test('newer speech supersedes pending preparation and its stale acknowledgment cannot release the new request', async t => {
  const h = await setup(); t.after(() => h.control.close()); const old = await h.ask();
  const fresh = await h.ask('Instead, explain the contact details.'); assert.ok(fresh.revision > old.revision);
  await h.update({ preparationAck: { revision: old.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 0);
  await h.update({ preparationAck: { revision: fresh.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 1);
  assert.equal(JSON.parse((h.requests[0] as { input: { content: string }[] }).input[0].content).latestRequest, 'Instead, explain the contact details.');
});

test('manual navigation and End invalidate pending preparation without late work', async t => {
  const h = await setup(); t.after(() => h.control.close()); const request = await h.ask();
  await h.update({ interactionRevision: 1, preparationAck: { revision: request.revision, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 0);
  await assert.rejects(h.update({ interactionRevision: 0, preparationAck: { revision: request.revision, status: 'applied' } }), /out of order/);
  await h.control.close();
  await h.update({ interactionRevision: 1, preparationAck: { revision: request.revision, status: 'applied' } });
  assert.equal(h.requests.length, 0); assert.equal(h.reservations(), 0);
});

test('preparation does not block the event reader and End prevents a late begin or acknowledgment', async () => {
  const abort = new AbortController(), session = new AbortController();
  let release!: () => void, began = 0, acknowledgments = 0, ended = false;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"type":"response_started","revision":1,"interactionRevision":0}\n{"type":"ended","message":"Done"}\n')); controller.close();
  } });
  await readVisitorRealtimeEvents(body, session.signal, event => {
    if (event.type === 'response_started') prepareVisitorVoiceRequest({ signal: abort.signal, current: () => !ended,
      prepare: () => waiting, begin: () => { began++; }, acknowledge: () => { acknowledgments++; } });
    if (event.type === 'ended') { ended = true; abort.abort(); }
  });
  assert.equal(ended, true); release(); await flushLive();
  assert.equal(began, 0); assert.equal(acknowledgments, 0);
});

test('browser preparation acknowledges only a current successful start and reports failures once', async () => {
  const controller = new AbortController(), order: string[] = [];
  prepareVisitorVoiceRequest({ signal: controller.signal, current: () => true, prepare: () => { order.push('prepare'); }, begin: () => { order.push('begin'); }, acknowledge: status => order.push(status) });
  await flushLive(); assert.deepEqual(order, ['prepare', 'begin', 'applied']);
  order.length = 0;
  prepareVisitorVoiceRequest({ signal: controller.signal, current: () => true, prepare: () => { throw new Error('Missing bookmark'); }, begin: () => { order.push('begin'); }, acknowledge: status => order.push(status) });
  await flushLive(); assert.deepEqual(order, ['failed']);
  order.length = 0; let current = true, release!: () => void;
  prepareVisitorVoiceRequest({ signal: controller.signal, current: () => current, prepare: () => new Promise<void>(resolve => { release = resolve; }), begin: () => { order.push('begin'); }, acknowledge: status => order.push(status) });
  await flushLive(); current = false; release(); await flushLive(); assert.deepEqual(order, []);
});
