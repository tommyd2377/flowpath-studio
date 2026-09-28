import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../fixtures/visitor-tasks';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { acknowledgeTaskDisplay, observeTaskScene } from '../lib/visitor-capabilities';
import { runVisitorTask } from '../lib/visitor-task-runner';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { FakeLiveSocket, liveAnswer, liveTool } from './helpers/live-fixture';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';

for (const stage of ['beforeModel', 'instructions'] as const) test(`cancelled task does not call the model after asynchronous ${stage}`, async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(runVisitorTask({ channel: 'voice', model: 'offline-test-model', apiKey: 'synthetic', signal: controller.signal,
    context: {}, tools: [], execute: async () => { throw new Error('Unexpected tool'); },
    beforeModel: async () => { if (stage === 'beforeModel') controller.abort(); },
    instructions: async () => { if (stage === 'instructions') controller.abort(); return 'Synthetic instructions'; },
    fetch: async () => { calls++; throw new Error('Model must not run'); },
  }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('actual owner review/apply/publish routes feed the same bounded mocked chat and voice task engine', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-task-routes-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite } = await import('../lib/site-store');
    const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
    const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
    const { POST: taskRoute } = await import('../app/api/visitor/[slug]/tasks/route');
    const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Task fixture', slug: 'task-fixture', kind: 'general' });
    const space = taskFixture(); space.publication.siteId = site.id;
    const req = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
    const collections = async (input: unknown) => { const response = await collectionRoute(req(input), { params: Promise.resolve({ siteId: site.id }) }); const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body; };
    let { review } = await collections({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
    ({ review } = await collections({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
    ({ review } = await collections({ action: 'finish', reviewId: review.id, revision: review.revision }));
    const before = await taskRoute(req({ action: 'init' }), { params: Promise.resolve({ slug: site.slug }) }); assert.equal(before.status, 404);
    const applied = await collections({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
    const publishedResponse = await siteRoute(req({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
    const published = await publishedResponse.json(); assert.equal(publishedResponse.status, 200, JSON.stringify(published));
    for (const channel of ['chat', 'voice'] as const) {
      const bridge = await createVisitorTaskBridge(site.slug), context = await visitorTaskContext(site.slug);
      const instructions = await bridge.instructions(); t.diagnostic(`${channel} task context: ${Buffer.byteLength(instructions)} bytes`); assert.ok(Buffer.byteLength(instructions) < 48_000);
      let round = 0, displayed: VisitorTaskView | undefined, handleId = '', outputType = '';
      const mock: typeof fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body)); assert.ok(payload.instructions.includes('untrusted data'));
        const proposal = round === 0 ? { capabilityId: 'records.lookup', input: { recordIds: ['record-00001', 'record-00003'] } }
          : round === 1 ? { capabilityId: 'records.filter', input: { records: [], where: { kind: 'field', id: 'f', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } }, bindings: [{ input: 'records', handleId, outputType }] }
          : round === 2 ? { capabilityId: 'selection.compare', input: { records: [] }, bindings: [{ input: 'records', handleId, outputType }] }
          : { capabilityId: 'presentation.show', input: { handleId, outputType } };
        const output = round++ < 4 ? [{ type: 'function_call', call_id: `call-${round}`, name: 'visitor_task', arguments: JSON.stringify(proposal) }] : [{ type: 'message', content: [{ type: 'output_text', text: 'The two published records are compared.' }] }];
        return Response.json({ status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
      };
      const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'unused-offline-placeholder', signal: new AbortController().signal, fetch: mock, tools: [bridge.tool], context: { request: 'Look up the two records, filter and compare, then show them.' }, instructions: () => bridge.instructions(), beforeModel: () => bridge.beforeModel(), onUsage: usage => bridge.usage(usage), execute: async (_name, args, signal) => {
        const result = await bridge.execute(args, signal, async view => { displayed = view; await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.comparison?.rows.map(record => record.id) ?? view.records.map(record => record.id) }); });
        assert.ok(result.data.handleId); assert.ok(result.data.outputType);
        handleId = result.data.handleId; outputType = result.data.outputType; return result;
      } });
      assert.equal(round, 5); assert.match(result.text, /compared/); assert.deepEqual(displayed!.comparison!.rows.map(row => row.id), ['record-00001', 'record-00003']);
      await bridge.finish();
      const saved = await context.store.read(bridge.sessionId, context.publication); assert.equal(saved.tasks.length, 1); assert.equal(saved.tasks[0].steps.length, 4); assert.equal(saved.tasks[0].status, 'completed'); assert.equal(saved.tasks[0].budget.modelCalls, 5); assert.equal(saved.tasks[0].budget.inputTokens, 500);
      const sceneContext = JSON.parse((await bridge.instructions()).split('\n').at(-1)!);
      assert.equal(sceneContext.scene.sceneRevision, 1);
      assert.deepEqual(sceneContext.scene.records.map((record: { id: string }) => record.id), ['record-00001', 'record-00003']);
      await observeTaskScene(context.store, saved.id, context.publication, { ...saved.scene!, operationId: saved.scene!.operationId!, generation: saved.generation, sceneRevision: 2, ready: false, recordIds: [] });
      assert.equal(JSON.parse((await bridge.instructions()).split('\n').at(-1)!).scene, null, `${channel} must not receive stale visible ordinals while the viewport moves`);
      const blocked = await bridge.execute(JSON.stringify({ capabilityId: 'presentation.show', input: { handleId: 'retrieval', outputType: 'records' } }), new AbortController().signal, async () => { assert.fail('A bounded retrieval must not become a second results section.'); });
      assert.equal(blocked.data.status, 'unavailable');
      assert.ok(!bridge.tool.parameters.properties.capabilityId.enum.includes('query.command'));
      const beforeRejectedCommand = await context.store.read(bridge.sessionId, context.publication);
      const rejectedCommand = await bridge.execute(JSON.stringify({ capabilityId: 'query.command', input: { text: 'Show articles with their reading minutes' } }), new AbortController().signal, async () => { assert.fail('Raw prose must not become a displayed keyword filter.'); });
      assert.equal(rejectedCommand.data.status, 'unavailable');
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), beforeRejectedCommand);
      const localCommand = await bridge.command('Only reading minutes at least 6');
      assert.equal(localCommand?.capabilityId, 'query.patch');
      await bridge.execute(JSON.stringify(localCommand), new AbortController().signal, async view => {
        assert.equal(view.result.count.value, 2);
        await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 3, recordIds: view.records.map(record => record.id) });
      });
      const interrupted = await taskRoute(req({ action: 'interrupt', sessionId: saved.id }), { params: Promise.resolve({ slug: site.slug }) }); assert.equal(interrupted.status, 200);
      await assert.rejects(() => bridge.instructions(), /cancelled/);
    }
    await t.test('refreshing an existing view preserves its revision and does not write session state', async () => {
      const call = (input: unknown) => taskRoute(req(input), { params: Promise.resolve({ slug: site.slug }) });
      const initial = (await (await call({ action: 'init' })).json()).view;
      const context = await visitorTaskContext(site.slug), before = await context.store.read(initial.sessionId, context.publication);
      for (let i = 0; i < 2; i++) {
        const response = await call({ action: 'refresh', sessionId: initial.sessionId }), result = await response.json();
        assert.equal(response.status, 200); assert.equal(result.view.revision, initial.revision);
        assert.deepEqual(await context.store.read(initial.sessionId, context.publication), before);
      }
    });
    await t.test('one command request cancels old work and rejects stale replay without changing the view', async () => {
      const call = (input: unknown) => taskRoute(req(input), { params: Promise.resolve({ slug: site.slug }) });
      const initial = (await (await call({ action: 'init' })).json()).view;
      const bridge = await createVisitorTaskBridge(site.slug, initial.sessionId);
      await bridge.beforeModel();
      const active = (await (await call({ action: 'refresh', sessionId: initial.sessionId })).json()).view;
      const input = { action: 'command', sessionId: active.sessionId, generation: active.generation, operationId: randomUUID(), text: 'Only reading minutes at least 6' };
      const response = await call(input), result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.view.result.count.value, 2);
      await assert.rejects(bridge.beforeModel(), /cancelled/);
      const context = await visitorTaskContext(site.slug);
      const before = await context.store.read(active.sessionId, context.publication);
      assert.ok(active.tasks.length > 0);
      assert.ok(active.tasks.every((task: { id: string }) => before.tasks.find(value => value.taskId === task.id)?.status === 'cancelled'));
      assert.equal((await call(input)).status, 409, 'An old generation cannot execute the command twice');
      assert.deepEqual(await context.store.read(active.sessionId, context.publication), before);
      const unhandled = await call({ ...input, operationId: randomUUID(), generation: result.view.generation, text: 'Explain how this studio can help me' });
      const fallback = await unhandled.json();
      assert.equal(unhandled.status, 200, JSON.stringify(fallback));
      assert.equal(fallback.handled, false);
      assert.equal(fallback.view.generation, result.view.generation + 1);
      assert.equal((await context.store.read(active.sessionId, context.publication)).operations.length, before.operations.length, 'Unrecognized prose cancels old work but executes no capability');
    });
    for (const status of ['completed', 'cancelled', 'failed'] as const) await t.test(`task counters are batched without losing usage on ${status}`, async () => {
      const bridge = await createVisitorTaskBridge(site.slug), context = await visitorTaskContext(site.slug);
      await bridge.beforeModel();
      const reserved = await context.store.read(bridge.sessionId, context.publication);
      bridge.usage({ inputTokens: 100, outputTokens: 20 });
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), reserved, 'Token observation must not add a storage round trip before the tool');
      await bridge.beforeModel();
      assert.equal((await context.store.read(bridge.sessionId, context.publication)).tasks[0].budget.inputTokens, 100);
      bridge.usage({ inputTokens: 50, outputTokens: 10 });
      await bridge.finish(status);
      const finished = (await context.store.read(bridge.sessionId, context.publication)).tasks[0];
      assert.equal(finished.status, status);
      assert.equal(finished.budget.inputTokens, 150); assert.equal(finished.budget.outputTokens, 30);
    });
    const context = await visitorTaskContext(site.slug);
    for (const compound of [false, true]) {
      const socket = new FakeLiveSocket(); let calls = 0;
      let resolveNavigation!: (event: Extract<VisitorRealtimeEvent, { type: 'navigation' }>) => void, resolveDone!: () => void;
      let rejectNavigation!: (error: Error) => void, rejectDone!: (error: Error) => void;
      const navigation = new Promise<Extract<VisitorRealtimeEvent, { type: 'navigation' }>>((resolve, reject) => { resolveNavigation = resolve; rejectNavigation = reject; });
      const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
      void navigation.catch(() => {}); void done.catch(() => {});
      const fail = (message: string) => { const error = new Error(message); rejectNavigation(error); rejectDone(error); };
      const timeout = setTimeout(() => fail('The synthetic voice request did not finish.'), 5000);
      const availability = { enabled: true, mode: 'voice' as const, live: true, voiceRemaining: 4, chatRemaining: 20, resetsAt: '' };
      const control = createVisitorRealtimeControl({ taskSlug: site.slug, callId: 'voice_task_fixture', apiKey: 'synthetic', content: { ...context.site.content, visitorSpeaksFirst: true },
        initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => availability, assertCurrent: async () => {},
        socketFactory: () => socket as unknown as VisitorControlSocket, onFatal: fail,
        emit: event => { if (event.type === 'navigation') resolveNavigation(event); if (event.type === 'backend_idle') resolveDone(); if (event.type === 'task_error') fail(event.message);
          if (event.type === 'response_started') void control.applyControl({ seq: 1, interactionRevision: event.interactionRevision, viewRevision: event.revision, ready: true,
            context: control.recordingSnapshot().context, preparationAck: { revision: event.revision, status: 'applied' } }).catch(error => fail(String(error))); },
        fetch: async () => Response.json({ status: 'completed', output: ++calls === 1 ? [liveTool('visitor_task', { capabilityId: 'record.detail', input: { recordId: 'record-00001' } })] : [liveAnswer('Published details.')] }),
      });
      try {
        socket.open(); await control.ready; control.start();
        socket.user(`Open ${space.records.find(record => record.id === 'record-00001')!.name}${compound ? ' and explain its details' : ''}`);
        const event = await navigation; assert.equal(calls, 1); assert.equal(event.target.kind, 'task');
        if (event.target.kind !== 'task') throw new Error('Expected a task view.');
        const view = event.target.view;
        assert.equal(socket.sent.some(value => value.content === 'Opened.'), false);
        await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: [view.detail!.record.id] });
        await control.applyControl({ seq: 2, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: event.id, status: 'applied' } });
        await done;
        assert.equal(calls, compound ? 2 : 1, 'Only simple confirmed navigation skips the closing model call');
        assert.ok(socket.sent.some(value => value.content === (compound ? 'Published details.' : 'Opened.')));
      } finally { clearTimeout(timeout); await control.close(); }
    }
    const session = await context.store.create(context.publication);
    const oldBridge = await createVisitorTaskBridge(site.slug, session.id), newBridge = await createVisitorTaskBridge(site.slug, session.id);
    await assert.rejects(() => oldBridge.beforeModel(), /cancelled/); await newBridge.beforeModel();
    await oldBridge.finish('cancelled');
    assert.deepEqual((await context.store.read(session.id, context.publication)).tasks.map(task => task.status), ['interpreting'], 'A superseded request cannot run or complete the newer task');
    await newBridge.finish();
    const changed = await siteRoute(req({ action: 'save', revision: published.site.revision, content: { ...published.site.draft, headline: 'Changed publication' } }), { params: Promise.resolve({ siteId: site.id }) });
    const changedBody = await changed.json(); assert.equal(changed.status, 200, JSON.stringify(changedBody));
    await siteRoute(req({ action: 'publish', revision: changedBody.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
    const stale = await taskRoute(req({ action: 'refresh', sessionId: session.id }), { params: Promise.resolve({ slug: site.slug }) }); assert.notEqual(stale.status, 200);
    const forged = await siteRoute(req({ action: 'save', revision: changedBody.site.revision, content: { ...changedBody.site.draft, catalogPublicationId: randomUUID() } }), { params: Promise.resolve({ siteId: site.id }) }); assert.notEqual(forged.status, 200);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
