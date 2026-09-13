import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { detailPlan, initialInteraction } from '@thevoice/platform-ui/interaction';
import { createVisitorRealtimeControl, type VisitorRealtimeControlOptions, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_VISITOR_SETTINGS, VOICE_MODELS } from '../lib/visitor-model';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
import { emptyWorkspace, applyWorkspaceBatch, type WorkspaceScene, type WorkspaceState } from '@thevoice/platform-ui/workspace';
import { objectInput, publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';
import { publicationContent } from '../lib/site-opening';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { annotationTargetForObject, DEFAULT_EXPLORE_SETTINGS, demoExploreResult, exploreContextForResult } from '../lib/explore-model';
import { publishedProseFixture } from './helpers/published-prose-fixture';

const availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 4, resetsAt: '' };
export async function liveVisitorSetup(output: unknown[] = [liveAnswer()], overrides: Partial<VisitorRealtimeControlOptions> = {}) {
  const socket = new FakeLiveSocket(), events: VisitorRealtimeEvent[] = [], failures: string[] = [], requests: Record<string, unknown>[] = [];
  let reserved = 0;
  const control = createVisitorRealtimeControl({ callId: 'live_fixture', apiKey: 'synthetic', content: { ...sampleContent('general'), visitorSpeaksFirst: true },
    initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => { reserved++; return availability; }, assertCurrent: async () => {},
    emit: event => events.push(event), onFatal: message => failures.push(message), socketFactory: () => socket as unknown as VisitorControlSocket,
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: requests.length === 1 ? output : [liveAnswer()] }); }, ...overrides });
  socket.open(); await control.ready;
  return { socket, events, failures, requests, control, reserved: () => reserved };
}

test('voice reads full published prose without a display request or external search', async t => {
  const catalog = publishedProseFixture(), content = publicationContent({ ...sampleContent('general'), visitorSpeaksFirst: true });
  const authority = publishedWorkspace(content, catalog), workspace = emptyWorkspace(authority.publicationId);
  const reference = authority.records.find(record => record.reference.id === 'offerings')!.reference;
  const h = await liveVisitorSetup([liveTool('read_published_content', { query: '', reference, offset: 0 })], { content, catalog, context: { workspace } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('What cakes do you have?'); await flushLive();
  assert.equal(h.requests.length, 2);
  assert.ok(String(h.requests[0].instructions).includes('Cocoa Cloud and Lemon Blossom'));
  const returned = (h.requests[1].input as { type: string; output?: string }[]).find(item => item.type === 'function_call_output');
  assert.ok(returned?.output?.includes('Cocoa Cloud and Lemon Blossom'));
  assert.ok(returned?.output?.includes('availability must be confirmed'));
  assert.equal(h.events.some(event => event.type === 'navigation' || event.type === 'plan' || event.type === 'task_error'), false);
  assert.deepEqual(h.failures, []);
});

for (const kind of ['source', 'photo', 'collection', 'fact'] as const) test(`workspace voice can open a published ${kind} when a catalog is present`, async t => {
  const content = publicationContent({ ...sampleContent('general'), visitorSpeaksFirst: true });
  const authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
  const record = authority.records.find(record => record.reference.kind === kind)!;
  const workspace = emptyWorkspace(authority.publicationId);
  const h = await liveVisitorSetup([liveTool('navigate_view', { kind: 'open', id: `${kind}:${record.reference.id}`, ids: null })], { content, catalog: semanticFixture, media: semanticMediaFixture, context: { workspace } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user(`Open ${record.name}`); await flushLive();
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event);
  assert.deepEqual(event.target, { kind: 'open', id: `${kind}:${record.reference.id}` });
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: { workspace }, navigationAck: { id: event.id, status: 'applied' } });
  await flushLive(); assert.equal(h.requests.length, 2);
});
test('workspace voice receives publisher purpose and web guidance, and forwards an authorized card annotation', async t => {
  const content = publicationContent({ ...sampleContent('general'), visitorSpeaksFirst: true, visitor: { ...DEFAULT_VISITOR_SETTINGS, assistantPurpose: 'Help readers compare published locations.' }, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, annotations: true } });
  const authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
  const object = objectInput(authority.records.find(record => record.reference.kind === 'entity')!);
  const initial = emptyWorkspace(authority.publicationId), workspace = applyWorkspaceBatch(initial, workspaceBatch(initial, [{ kind: 'add', object }]), authority).state;
  const target = annotationTargetForObject(workspace, object.instanceId)!;
  let searches = 0;
  const h = await liveVisitorSetup([liveTool('search_explore', { kind: 'annotate', id: object.instanceId, query: 'Historical background' })], { content, catalog: semanticFixture, media: semanticMediaFixture, context: { workspace }, search: async (query, kind, _signal, annotationTarget) => {
    searches++; assert.deepEqual(annotationTarget, target); return { ...demoExploreResult(query, kind), annotationTarget };
  } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Add historical web context to this card'); await flushLive();
  assert.match(String(h.requests[0].instructions), /compare published locations/);
  assert.match(String(h.requests[0].instructions), /open_image\/open_source/);
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event && event.target.kind === 'explore');
  assert.deepEqual(event.target.result?.annotationTarget, target); assert.equal(searches, 1);
  assert.equal(h.requests.length, 1, 'No spoken success before browser acknowledgement');
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: { workspace }, navigationAck: { id: event.id, status: 'applied' } });
  await flushLive(); assert.equal(h.requests.length, 2); assert.ok((h.requests[1].tools as { name: string }[]).some((tool) => tool.name === 'navigate_view'), 'Acknowledged results allow the next task step');
});

test('every saved Studio voice tier selects Live and a new publisher defaults to voice', () => {
  assert.equal(DEFAULT_VISITOR_SETTINGS.mode, 'voice'); assert.deepEqual(Object.values(VOICE_MODELS), ['gpt-live-1', 'gpt-live-1']);
});
test('no greeting or paid backend starts until browser readiness is applied', async t => {
  const h = await liveVisitorSetup([], { content: sampleContent('general') }); t.after(() => h.control.close());
  assert.equal(h.socket.sent.length, 0); assert.equal(h.requests.length, 0);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {} });
  assert.ok(h.socket.sent.some(x => x.type === 'session.commentary.append')); assert.equal(h.requests.length, 0);
});
test('opening captions are visual-only and stop after an interruption without adding voice requests', async t => {
  const content = { ...sampleContent('general'), greetingPoints: [{ kind: 'custom' as const, text: 'Explore the neighborhood.' }, null, null] };
  const h = await liveVisitorSetup([], { content }); t.after(() => h.control.close());
  const caption = (delta: string) => h.socket.frame({ type: 'session.output_transcript.delta', delta, start_ms: 0, end_ms: 100 });
  caption('Before ready.'); assert.equal(h.events.some(event => event.type === 'greeting_progress'), false);
  h.control.start();
  const commands = h.socket.sent.length;
  caption('Welcome. '); caption('Explore the neighborhood.');
  assert.deepEqual(h.events.filter(event => event.type === 'greeting_progress').map(event => event.text), ['Welcome. ', 'Welcome. Explore the neighborhood.']);
  assert.equal(h.socket.sent.length, commands); assert.equal(h.requests.length, 0);
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Stop', start_ms: 100, end_ms: 200 });
  caption('Late caption.');
  assert.equal(h.events.filter(event => event.type === 'greeting_progress').length, 2);
});
test('visitor-first and resumed conversations never send greeting visual cues', async t => {
  for (const overrides of [{ content: { ...sampleContent('general'), visitorSpeaksFirst: true } }, { history: [{ role: 'user' as const, text: 'Earlier question' }] }]) {
    const h = await liveVisitorSetup([], { content: { ...sampleContent('general'), greetingPoints: [{ kind: 'custom', text: 'Explore the neighborhood.' }, null, null] }, ...overrides }); t.after(() => h.control.close());
    h.control.start(); h.socket.frame({ type: 'session.output_transcript.delta', delta: 'Explore the neighborhood.', start_ms: 0, end_ms: 100 });
    assert.equal(h.events.some(event => event.type === 'greeting_progress'), false);
  }
});
test('resumed dialogue is reference context and only the fresh request reaches the backend', async t => {
  const history = [{ role: 'user' as const, text: 'Earlier unfinished request.' }];
  const h = await liveVisitorSetup([], { history }); t.after(() => h.control.close()); h.control.start();
  const context = h.socket.sent.filter(event => event.type === 'session.thinking.append').map(event => event.content).join('');
  assert.match(context, /Earlier unfinished request/);
  assert.equal(h.socket.sent.some(event => event.type === 'session.commentary.append'), false);
  assert.equal(h.requests.length, 0);
  h.socket.user('Take me home instead.'); await flushLive();
  const input = JSON.parse((h.requests[0].input as { content: string }[])[0].content);
  assert.equal(input.latestRequest, 'Take me home instead.');
  assert.deepEqual(input.history, history);
  assert.equal(h.requests.length, 1);
});

test('prepaid delegation then later task reserves once each; duplicate delegation is inert', async t => {
  const h = await liveVisitorSetup(); t.after(() => h.control.close()); h.control.start();
  h.socket.user('Tell me about it'); await flushLive(); assert.equal(h.requests.length, 1); assert.equal(h.reserved(), 0);
  h.socket.user('Again', 'item_test'); await flushLive(); assert.equal(h.requests.length, 1);
  h.socket.user('Another question', 'item_second'); await flushLive(); assert.equal(h.reserved(), 1); assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].model, 'gpt-5.6-luna'); assert.ok(h.socket.sent.some(x => x.delegation_id === 'item_second'));
});
for (const failed of [false, true]) test(`a ${failed ? 'failed' : 'completed'} request cannot run again after silence without fresh speech`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const h = await liveVisitorSetup([], { idleTimeoutMs: 120_000, fetch: async () => {
    calls++; return failed ? new Response(null, { status: 503 }) : Response.json({ status: 'completed', output: [liveAnswer()] });
  } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Show the first collection.'); await flushLive();
  const replies = h.socket.sent.filter(event => event.type === 'session.commentary.append').length;
  t.mock.timers.tick(45_000);
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 45_000, delegation: { id: 'delayed_repeat', target: 'client' } }); await flushLive();
  assert.equal(calls, 1, 'Silence is not a new instruction or an automatic retry');
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Mm-hmm.', start_ms: 46_000, end_ms: 46_300 });
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 46_300, delegation: { id: 'acknowledgement', target: 'client' } }); await flushLive();
  assert.equal(calls, 1); assert.equal(h.reserved(), 0);
  assert.equal(h.events.filter(event => event.type === 'response_started').length, 1, 'Rejected stale work must not reactivate Thinking');
  assert.equal(h.socket.sent.filter(event => event.type === 'session.commentary.append').length, replies);
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Show the contact information instead.', start_ms: 48_000, end_ms: 49_000 });
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 49_000, delegation: { id: 'new_request', target: 'client' } }); await flushLive();
  assert.equal(calls, 2); assert.equal(h.reserved(), 1);
});
test('late overlapping captions are consumed with their completed request', async t => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const h = await liveVisitorSetup([], { fetch: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Show the collection'); await flushLive();
  h.socket.frame({ type: 'session.input_transcript.delta', delta: ' please.', start_ms: 50, end_ms: 200 });
  finish(Response.json({ status: 'completed', output: [liveAnswer()] })); await flushLive();
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 200, delegation: { id: 'late_caption_delegation', target: 'client' } }); await flushLive();
  assert.equal(calls, 1); assert.equal(h.reserved(), 0);
});
test('late delegations during silence cannot keep a completed conversation alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await liveVisitorSetup(); t.after(() => h.control.close());
  h.control.start(); h.socket.user('Tell me about the collection.'); await flushLive();
  t.mock.timers.tick(45_000);
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 45_000, delegation: { id: 'late_quiet_delegation', target: 'client' } }); await flushLive();
  t.mock.timers.tick(15_000); await flushLive();
  assert.equal(h.requests.length, 1); assert.equal(h.failures.length, 1);
});
test('unchanged quiet workspace reports cannot postpone the server inactivity deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await liveVisitorSetup([], { idleTimeoutMs: 60_000 }); t.after(() => h.control.close());
  h.control.start();
  for (let seq = 1; seq <= 5; seq++) {
    t.mock.timers.tick(10_000);
    await h.control.applyControl({ seq, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, audio: { inputActive: false, outputActive: false } });
    assert.deepEqual(h.failures, []);
  }
  t.mock.timers.tick(10_000); await flushLive();
  assert.deepEqual(h.failures, ['Voice ended after 1 minute of inactivity. Tap the wave to continue.']);
  assert.equal(h.requests.length, 0);
});
test('valid published plan waits for view acknowledgement before backend continuation', async t => {
  const h = await liveVisitorSetup([liveTool('present_site', { layout: 'detail', sources: ['overview'], status: 'ready' })]); t.after(() => h.control.close()); h.control.start();
  h.socket.user('Show overview'); await flushLive();
  const plan = h.events.find(x => x.type === 'plan'); assert.ok(plan); assert.equal(h.requests.length, 1);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: plan.revision, ready: true, context: {} }); await flushLive();
  assert.equal(h.requests.length, 2); assert.ok((h.requests[1].tools as { name: string }[]).some((tool) => tool.name === 'navigate_view'), 'Acknowledged results allow the next task step'); assert.deepEqual(h.failures, []);
});
test('backend failures emit a bounded task error while keeping the voice session open', async t => {
  const h = await liveVisitorSetup([], { fetch: async () => new Response(null, { status: 503 }) }); t.after(() => h.control.close()); h.control.start();
  h.socket.user('Find images.'); await flushLive();
  assert.deepEqual(h.events.filter(event => event.type === 'task_error').map(event => event.type === 'task_error' ? event.message : ''), ['The conversation backend is unavailable right now.']);
  assert.deepEqual(h.failures, []);
});
test('voice can clear all panels through one acknowledged navigation action', async t => {
  const h = await liveVisitorSetup([liveTool('navigate_view', { kind: 'clear', id: null, ids: null })]);
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Close all the panels.'); await flushLive();
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event);
  assert.deepEqual(event.target, { kind: 'clear' }); assert.equal(h.requests.length, 1);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: event.id, status: 'applied' } });
  await flushLive(); assert.equal(h.requests.length, 2); assert.deepEqual(h.failures, []);
});
test('unknown references fail without a plan or paid repair', async t => {
  const h = await liveVisitorSetup([liveTool('present_site', { layout: 'detail', sources: ['private-source'], status: 'ready' })]); t.after(() => h.control.close()); h.control.start();
  h.socket.user('Show private data'); await flushLive(); assert.ok(!h.events.some(x => x.type === 'plan')); assert.equal(h.requests.length, 1);
});
test('manual navigation aborts backend generation and rejects a late plan', async t => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const h = await liveVisitorSetup([], { fetch: async (_url, init) => { signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Old view'); await flushLive();
  await h.control.applyControl({ seq: 1, interactionRevision: 1, viewRevision: 0, ready: true, context: {} }); assert.equal(signal.aborted, true);
  finish(Response.json({ status: 'completed', output: [liveTool('present_site', { layout: 'detail', sources: ['overview'], status: 'ready' })] })); await flushLive();
  assert.ok(!h.events.some(x => x.type === 'plan')); assert.ok(!h.socket.sent.some(x => x.type === 'session.commentary.append'));
});
for (const instruction of ['Take me home.', 'Go back to the main screen.', 'Cancel that.', 'Show the contact information instead.']) test(`new spoken instruction cancels pending work before another delegation: ${instruction}`, async t => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const h = await liveVisitorSetup([], { fetch: async (_url, init) => { signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Research the first item.'); await flushLive();
  // Live can hear a new instruction without immediately creating a delegation.
  h.socket.frame({ type: 'session.input_transcript.delta', delta: instruction, start_ms: 2000, end_ms: 3000 });
  assert.equal(signal.aborted, true);
  finish(Response.json({ status: 'completed', output: [liveAnswer('Obsolete research answer.')] })); await flushLive();
  assert.ok(!h.socket.sent.some(event => event.type === 'session.commentary.append'));
  assert.ok(!h.events.some(event => event.type === 'task_error'));
  assert.deepEqual(h.failures, []);
});
test('backchannels and overlapping fragments preserve work until a substantive correction arrives', async t => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const h = await liveVisitorSetup([], { fetch: async (_url, init) => { signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Research the first item.'); await flushLive();
  h.socket.frame({ type: 'session.input_transcript.delta', delta: ' please.', start_ms: 50, end_ms: 150 });
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Mm-hmm.', start_ms: 2000, end_ms: 2300 });
  assert.equal(signal.aborted, false);
  h.socket.frame({ type: 'session.input_transcript.delta', delta: ' Actually, show a different item.', start_ms: 2600, end_ms: 3300 });
  assert.equal(signal.aborted, true);
  finish(Response.json({ status: 'completed', output: [liveAnswer()] })); await flushLive();
});
test('manual Home cancels immediately before a slow publication check and fences late delegations', async t => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  let authorize!: () => void, checks = 0, calls = 0;
  const h = await liveVisitorSetup([], {
    assertCurrent: async () => { if (++checks === 2) await new Promise<void>(resolve => { authorize = resolve; }); },
    fetch: async (_url, init) => { calls++; signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); },
  });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Old request'); await flushLive();
  const applying = h.control.applyControl({ seq: 1, interactionRevision: 1, viewRevision: 0, ready: true, context: {} });
  assert.equal(signal.aborted, true, 'Cancellation must not wait for a store read');
  finish(Response.json({ status: 'completed', output: [liveAnswer('Late result')] })); await flushLive();
  authorize(); await applying;
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 100, delegation: { id: 'late_old_request', target: 'client' } }); await flushLive();
  assert.equal(calls, 1, 'No new model call for a delegation with only pre-Home speech');
  assert.equal(h.reserved(), 0); assert.ok(!h.socket.sent.some(event => event.type === 'session.commentary.append'));
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Mm-hmm.', start_ms: 2000, end_ms: 2300 });
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 2300, delegation: { id: 'late_after_backchannel', target: 'client' } }); await flushLive();
  assert.equal(calls, 1, 'An acknowledgement does not restart the cancelled task');
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Open the contact information.', start_ms: 4000, end_ms: 4800 });
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 4800, delegation: { id: 'fresh_request', target: 'client' } }); await flushLive();
  assert.equal(calls, 2, 'New requests still work in the same voice session');
  finish(Response.json({ status: 'completed', output: [liveAnswer('New answer')] })); await flushLive();
});
test('an old navigation timer and ACK cannot settle a newer request', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const requests: Record<string, unknown>[] = [];
  const h = await liveVisitorSetup([], { fetch: async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({ status: 'completed', output: requests.length <= 2 ? [liveTool('navigate_view', { kind: 'home', id: null, ids: null })] : [liveAnswer('Latest answer')] });
  } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('First view'); await flushLive();
  const first = h.events.find(event => event.type === 'navigation'); assert.ok(first);
  t.mock.timers.tick(1000);
  h.socket.user('Second view', 'second_view'); await flushLive();
  const second = h.events.filter(event => event.type === 'navigation').at(-1)!; assert.notEqual(second.id, first.id);
  t.mock.timers.tick(7000); await flushLive();
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: first.id, status: 'applied' } });
  await flushLive(); assert.equal(requests.length, 2, 'The new navigation still needs its own ACK');
  await h.control.applyControl({ seq: 2, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: second.id, status: 'applied' } });
  await flushLive(); assert.equal(requests.length, 3);
  assert.ok(h.socket.sent.filter(event => event.type === 'session.commentary.append').every(event => event.delegation_id === 'second_view'));
});
test('a queued manual change cancels work while an earlier context check is still waiting', async t => {
  let finish!: (response: Response) => void, release!: () => void; let checks = 0, signal!: AbortSignal;
  const h = await liveVisitorSetup([], {
    assertCurrent: async () => { if (++checks === 2) await new Promise<void>(resolve => { release = resolve; }); },
    fetch: async (_url, init) => { signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); },
  });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Old request'); await flushLive();
  const older = h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {} });
  const manual = { seq: 2, interactionRevision: 1, viewRevision: 0, ready: true, context: {} };
  h.control.observeControl(manual); assert.equal(signal.aborted, true);
  release(); await older; await h.control.applyControl(manual);
  assert.deepEqual(h.events.filter(event => event.type === 'control_applied').map(event => event.seq), [2]);
  finish(Response.json({ status: 'completed', output: [liveAnswer('Obsolete answer')] })); await flushLive();
  assert.ok(!h.socket.sent.some(event => event.type === 'session.commentary.append'));
});
test('a correction can delegate Home while an abort-ignoring search finishes late', async t => {
  let finish!: (value: ReturnType<typeof demoExploreResult>) => void; let searchSignal!: AbortSignal;
  let requests = 0;
  const content = { ...sampleContent('general'), visitorSpeaksFirst: true, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true, images: true } };
  const h = await liveVisitorSetup([], { content,
    fetch: async () => Response.json({ status: 'completed', output: [++requests === 1
      ? liveTool('search_explore', { kind: 'images', query: 'Museum photographs', id: null })
      : requests === 2 ? liveTool('navigate_view', { kind: 'home', id: null, ids: null }) : liveAnswer('Ready for your next question.')] }),
    search: async (_query, _kind, signal) => { searchSignal = signal; return new Promise(resolve => { finish = resolve; }); },
  });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Find museum pictures'); await flushLive();
  h.socket.frame({ type: 'session.input_transcript.delta', delta: 'Take me home instead.', start_ms: 2000, end_ms: 3000 });
  assert.equal(searchSignal.aborted, true);
  h.socket.frame({ type: 'session.delegation.created', offset_ms: 3000, delegation: { id: 'home_request', target: 'client' } }); await flushLive();
  const home = h.events.find(event => event.type === 'navigation'); assert.ok(home); assert.deepEqual(home.target, { kind: 'home' });
  finish(demoExploreResult('Museum photographs', 'images')); await flushLive();
  assert.equal(h.events.filter(event => event.type === 'navigation').length, 1, 'Late search cannot display or displace Home');
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: home.id, status: 'applied' } }); await flushLive();
  assert.equal(requests, 3); assert.deepEqual(h.failures, []);
  assert.ok(h.socket.sent.filter(event => event.type === 'session.commentary.append').every(event => event.delegation_id === 'home_request'));
});
test('catalog navigation uses published IDs and waits for actual browser result', async t => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));
  const target = catalog.entities[0].id;
  const h = await liveVisitorSetup([liveTool('navigate_view', { kind: 'open', id: target, ids: null })], { catalog }); t.after(() => h.control.close()); h.control.start(); h.socket.user('Open the first item'); await flushLive();
  const navigation = h.events.find(x => x.type === 'navigation'); assert.ok(navigation); assert.equal(h.requests.length, 1);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: navigation.id, status: 'unavailable' } }); await flushLive();
  assert.equal(h.requests.length, 2); assert.match(JSON.stringify(h.requests[1].input), /not completed/);
});
test('catalog plans keep the focused entity in the voice view context', async t => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));
  const target = catalog.entities[0].id;
  const plan = detailPlan(catalog, target);
  const h = await liveVisitorSetup([liveTool('present_site', { status: 'ready', plan })], { catalog }); t.after(() => h.control.close()); h.control.start(); h.socket.user('Open the first item'); await flushLive();
  const event = h.events.find(value => value.type === 'plan'); assert.ok(event && event.type === 'plan' && event.catalogPlan);
  const state = { ...initialInteraction(catalog), entityIds: [target], focusedId: target, focusedRef: { kind: 'entity' as const, id: target }, focusOrigin: null };
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: event.revision, ready: true, context: { catalogState: state } }); await flushLive();
  const output = JSON.parse(String((h.requests[1].input as { output?: string }[]).at(-1)?.output));
  assert.deepEqual(output.catalog.state.focusedRef, { kind: 'entity', id: target });
  assert.equal(output.catalog.state.focusedId, target);
});
test('publication validation failure blocks backend work', async t => {
  const h = await liveVisitorSetup([], { assertCurrent: async () => { throw new Error('publication changed'); } }); t.after(() => h.control.close()); h.control.start();
  h.socket.user('Tell me'); await flushLive(); assert.equal(h.requests.length, 0);
});

const workspaceContent = publicationContent({ ...sampleContent('general', 'Harbor Studio'), visitorSpeaksFirst: true });
const workspaceAuthority = publishedWorkspace(workspaceContent, semanticFixture, semanticMediaFixture);
function observedWorkspace(state: WorkspaceState): WorkspaceScene {
  return { revision: state.revision + 1, workspaceRevision: state.revision, focusedId: state.focusedId, visibility: 'visible', objects: state.objects.map((object, index) => ({
    instanceId: object.instanceId, references: object.references, order: index + 1, name: 'Ignored browser label', open: true, mounted: true,
    visibility: 'full', position: 'left', rect: { x: 0, y: 0, width: 400, height: 250 }, selected: object.selected, expanded: object.expanded, controls: ['focus', 'close'], scroll: null,
  })) };
}
for (const status of ['applied', 'failed', 'cancelled'] as const) test(`workspace tool waits for browser ${status}, sends no premature success and ignores duplicate acknowledgments`, async t => {
  const initial = emptyWorkspace(workspaceAuthority.publicationId);
  const batch = workspaceBatch(initial, [{ kind: 'add', object: objectInput(workspaceAuthority.records.find(record => record.reference.kind === 'fact' && record.reference.id === 'address')!) }]);
  const next = applyWorkspaceBatch(initial, batch, workspaceAuthority).state;
  const h = await liveVisitorSetup([liveTool('update_workspace', { batch, clarification: '' })], { content: workspaceContent, catalog: semanticFixture, media: semanticMediaFixture, context: { workspace: initial, scene: observedWorkspace(initial) } });
  t.after(() => h.control.close()); h.control.start();
  const summaryCount = h.socket.sent.filter(event => event.type === 'session.thinking.append').length;
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: { workspace: initial, scene: observedWorkspace(initial) } });
  assert.equal(h.socket.sent.filter(event => event.type === 'session.thinking.append').length, summaryCount, 'unchanged scene is deduplicated');
  h.socket.user('Show the address'); await flushLive();
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event && event.type === 'navigation' && event.target.kind === 'workspace');
  assert.equal(h.requests.length, 1, 'no backend continuation or success before browser result');
  const context = { workspace: next, scene: observedWorkspace(next) };
  await h.control.applyControl({ seq: 2, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status } }); await flushLive();
  assert.equal(h.requests.length, 2);
  const result = JSON.parse(String((h.requests[1].input as { output?: string }[]).at(-1)?.output));
  assert.equal(result.status, status);
  if (status !== 'applied') assert.match(result.message, /Do not claim/);
  assert.match(JSON.stringify(h.socket.sent.filter(event => event.type === 'session.thinking.append')), /Address.*Harbor Studio/);
  await h.control.applyControl({ seq: 2, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status } }); await flushLive();
  assert.equal(h.requests.length, 2);
});
test('manual interaction cancels pending workspace delegation before late browser success', async t => {
  const initial = emptyWorkspace(workspaceAuthority.publicationId);
  const batch = workspaceBatch(initial, [{ kind: 'add', object: objectInput(workspaceAuthority.records.find(record => record.reference.id === 'email')!) }]);
  const context = { workspace: initial, scene: observedWorkspace(initial) };
  const h = await liveVisitorSetup([liveTool('update_workspace', { batch, clarification: '' })], { content: workspaceContent, catalog: semanticFixture, media: semanticMediaFixture, context });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Show email'); await flushLive();
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event && event.type === 'navigation');
  await h.control.applyControl({ seq: 1, interactionRevision: 1, viewRevision: 0, ready: true, context }); await flushLive();
  await h.control.applyControl({ seq: 2, interactionRevision: 1, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 1, 'cancelled work does not continue or retry');
});

test('opening a prefixed published entity supplies its details to the voice answer', async t => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));
  const entity = catalog.entities[0];
  const h = await liveVisitorSetup([liveTool('navigate_view', { kind: 'open', id: entity.id, ids: null })], { catalog });
  t.after(() => h.control.close()); h.control.start(); h.socket.user(`Open ${entity.name}`); await flushLive();
  const navigation = h.events.find(event => event.type === 'navigation'); assert.ok(navigation);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: navigation.id, status: 'applied' } }); await flushLive();
  assert.match(JSON.stringify(h.requests[1].input), new RegExp(entity.id));
  assert.match(JSON.stringify(h.requests[1].input), new RegExp(entity.name));
});

test('voice explanation gets focused identity and general knowledge rules without a display envelope', async t => {
  const record = workspaceAuthority.records.find(record => record.reference.kind === 'entity')!;
  const initial = emptyWorkspace(workspaceAuthority.publicationId), object = objectInput(record);
  const workspace = applyWorkspaceBatch(initial, workspaceBatch(initial, [{ kind: 'add', object }, { kind: 'focus', instanceId: object.instanceId }]), workspaceAuthority).state;
  const h = await liveVisitorSetup([], { content: workspaceContent, catalog: semanticFixture, media: semanticMediaFixture, context: { workspace, scene: observedWorkspace(workspace) } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Tell me more about this place'); await flushLive();
  const guide = String(h.requests[0].instructions);
  assert.ok(guide.includes(record.name)); assert.match(guide, /General model knowledge may explain stable public history/);
  assert.match(guide, /not automatically a web search/); assert.match(guide, /answer explanatory questions naturally without a display tool/);
  assert.ok(!guide.includes('Return {batch,clarification};'));
  assert.equal(h.events.filter(event => event.type === 'navigation').length, 0);
});

test('voice reuses only server-obtained web evidence accepted in the current context', async t => {
  const content = publicationContent({ ...sampleContent('general'), visitorSpeaksFirst: true, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true } });
  const result = { ...demoExploreResult('public history', 'web'), answer: 'SERVER_EVIDENCE_MARKER' };
  let searches = 0;
  const h = await liveVisitorSetup([liveTool('search_explore', { kind: 'web', query: 'public history', id: null })], { content, search: async () => { searches++; return result; } });
  t.after(() => h.control.close()); h.control.start(); h.socket.user('Search the web for public history'); await flushLive();
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event);
  const external = exploreContextForResult(result);
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: { externalResults: [external] }, navigationAck: { id: event.id, status: 'applied' } }); await flushLive();
  h.socket.user('Explain more about that', 'second'); await flushLive();
  assert.match(String(h.requests.at(-1)?.instructions), /SERVER_EVIDENCE_MARKER/); assert.equal(searches, 1);
  await h.control.applyControl({ seq: 2, interactionRevision: 1, viewRevision: 0, ready: true, context: { externalResults: [{ ...external, resultId: 'unknown-result' }] } });
  h.socket.user('Explain this other result', 'third'); await flushLive();
  assert.ok(!String(h.requests.at(-1)?.instructions).includes('SERVER_EVIDENCE_MARKER'));
});
