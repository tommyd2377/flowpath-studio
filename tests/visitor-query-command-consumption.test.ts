import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { acknowledgeTaskDisplay, buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { websiteQueryCommand } from '../lib/visitor-query-command';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { FakeLiveSocket, liveAnswer } from './helpers/live-fixture';

function rugs() {
  const space = websiteTaskFixture('products', 6);
  const price = space.fields.find(field => field.id === 'price')!;
  price.label = 'Sale price';
  for (const id of ['material', 'color']) space.fields.push({ id, label: id, type: 'enum', cardinality: 'one', aliases: [], recordTypes: ['product'], operations: ['eq'], filter: true, sort: true, facet: true, coverage: { known: id === 'material' ? 5 : 6, total: 6 } });
  space.records.forEach((record, i) => {
    record.name = `Synthetic rug ${i}`;
    record.assertions.find(assertion => assertion.fieldId === 'price')!.value = { type: 'money', value: [1000, 1700, 1600, 900, 1500, 2000][i], currency: 'USD', basis: 'item' };
    for (const [id, value] of [['material', ['wool', 'wool', null, 'cotton', 'cotton', 'wool'][i]], ['color', ['blue', 'red', 'blue', 'red', 'red', 'blue'][i]]] as const) {
      record.assertions.push({ id: `${id}-${i}`, fieldId: id, value: value === null ? null : { type: 'enum', value }, authority: 'publisher', polarity: 'affirmed', conditions: [] });
    }
  });
  return space;
}

test('filter shortcuts consume every prefix and suffix constraint without changing the current query', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'filter-consumption-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const space = rugs(), index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  const session = await store.create(space.publication), context = { index, session, signal: new AbortController().signal };
  buildVisitorTaskView(context);
  const before = structuredClone(session);
  for (const request of [
    'Show wool rugs sale price under $1800', 'Show blue rugs sale price under $1800',
    'Show blue rugs sale price unknown', 'Only sale price unknown at Downtown',
    'Show wool options without cotton', 'Show wool options safe for a sesame allergy',
    'Show wool options at Downtown', 'Show wool options for 20 people',
    'Only material is wool without cotton', 'Only material is wool and color is blue',
    'Sale price under $1800 without cotton', 'Sale price under $1800 at Downtown',
    'Remove sale price filter for blue rugs',
  ]) {
    assert.equal(websiteQueryCommand(request, context), null, request);
    assert.deepEqual(session, before, 'Fallback must not apply part of the request');
  }
  const run = async (request: string) => {
    const command = websiteQueryCommand(request, context); assert.ok(command, request);
    await visitorCapabilities.get(command.capabilityId)!.execute(context, command.input);
    return buildVisitorTaskView(context);
  };
  assert.equal((await run('Only material is wool')).result.count.value, 3);
  assert.deepEqual((await run('Sale price under $1800')).records.map(record => record.id), ['record-00000', 'record-00001']);
  assert.equal(websiteQueryCommand('Sale price under $1800 EUR', context)?.capabilityId, 'task.clarify', 'A simple mismatched currency retains value feedback');
});

test('whole published values, numeric field labels and existing replacement suffixes keep their meaning', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'filter-literals-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const space = websiteTaskFixture('products', 4);
  space.fields.find(field => field.id === 'size')!.label = 'Vitamin B12 per portion';
  space.fields.find(field => field.id === 'flavor')!.values = ['salt and pepper', 'salt', 'pepper', 'plain'];
  space.records.forEach((record, i) => {
    record.name = `Synthetic item ${i}`;
    record.assertions.find(assertion => assertion.fieldId === 'flavor')!.value = { type: 'enum', value: ['salt and pepper', 'salt', 'pepper', 'plain'][i] };
  });
  const index = compileQueryIndex(space), store = new VisitorTaskStore(localTaskDocuments(directory));
  const session = await store.create(space.publication), context = { index, session, signal: new AbortController().signal };
  buildVisitorTaskView(context);
  const run = async (request: string) => {
    const command = websiteQueryCommand(request, context); assert.ok(command, request);
    await visitorCapabilities.get(command.capabilityId)!.execute(context, command.input);
    return buildVisitorTaskView(context);
  };
  assert.deepEqual((await run('Show salt and pepper')).records.map(record => record.id), ['record-00000']);
  assert.deepEqual((await run('Only flavor is salt and pepper')).records.map(record => record.id), ['record-00000']);
  await run('Only those under $23');
  assert.deepEqual((await run('Show salt and pepper or plain instead, at any price')).records.map(record => record.id), ['record-00000', 'record-00003']);
  await run('Show everything');
  assert.deepEqual((await run('Only Vitamin B12 per portion at least 12')).records.map(record => record.id), ['record-00002', 'record-00003']);
});

test('actual typed route and voice fastpath defer compound filters while retaining confirmed sequential filters', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'filter-channel-routes-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  t.after(async () => { process.env = previous; await rm(directory, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external request'); });
  const { newSite } = await import('../lib/site-store');
  const { catalogMetadataSchema } = await import('../lib/catalog-repository');
  const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
  const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
  const { POST: taskRoute } = await import('../app/api/visitor/[slug]/tasks/route');
  const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Synthetic rugs', slug: 'synthetic-rugs', kind: 'general' });
  const space = rugs(); space.publication.siteId = site.id;
  const req = (input: unknown) => new Request('http://127.0.0.1:3248/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3248' }, body: JSON.stringify(input) });
  const collect = async (input: unknown) => {
    const response = await collectionRoute(req(input), { params: Promise.resolve({ siteId: site.id }) }), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  let { review } = await collect({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
  ({ review } = await collect({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
  ({ review } = await collect({ action: 'finish', reviewId: review.id, revision: review.revision }));
  const applied = await collect({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
  const published = await siteRoute(req({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
  assert.equal(published.status, 200);
  const context = await visitorTaskContext(site.slug);
  const call = async (input: unknown) => {
    const response = await taskRoute(req(input), { params: Promise.resolve({ slug: site.slug }) }), body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  let view: VisitorTaskView = (await call({ action: 'init' })).view, sceneRevision = 0;
  const ack = async (current: VisitorTaskView) => acknowledgeTaskDisplay(context.store, current.sessionId, context.publication, {
    operationId: current.operationId!, queryId: current.query.queryId, queryRevision: current.query.revision,
    resultSetId: current.result.resultSetId, sceneRevision: ++sceneRevision, recordIds: current.records.map(record => record.id),
  });
  for (const request of ['Only material is wool', 'Sale price under $1800']) {
    view = (await call({ action: 'command', sessionId: view.sessionId, generation: view.generation, operationId: randomUUID(), text: request })).view;
    await ack(view);
  }
  assert.deepEqual(view.records.map(record => record.id), ['record-00000', 'record-00001']);
  for (const request of ['Show wool rugs sale price under $1800', 'Show blue rugs sale price under $1800']) {
    const before = await context.store.read(view.sessionId, context.publication);
    const result = await call({ action: 'command', sessionId: view.sessionId, generation: view.generation, operationId: randomUUID(), text: request });
    assert.equal(result.handled, false); assert.deepEqual(result.view.query, view.query);
    assert.deepEqual((await context.store.read(view.sessionId, context.publication)).operations, before.operations);
    view = result.view;
  }
  for (const compound of [false, true]) {
    const before = await context.store.read(view.sessionId, context.publication);
    const socket = new FakeLiveSocket(); let calls = 0, sequence = 0;
    const events: VisitorRealtimeEvent[] = [];
    let finish!: () => void, fail!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
    const timeout = setTimeout(() => fail(new Error('Synthetic voice request timed out')), 10000);
    const availability = { enabled: true, mode: 'voice' as const, live: true, voiceRemaining: 4, chatRemaining: 20, resetsAt: '' };
    const control = createVisitorRealtimeControl({ taskSlug: site.slug, callId: `filter-voice-${compound}`, apiKey: 'synthetic', content: { ...context.site.content, visitorSpeaksFirst: true },
      context: { taskSession: { sessionId: view.sessionId, revision: before.revision, generation: before.generation },
        carousel: { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null } },
      initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => availability, assertCurrent: async () => {},
      socketFactory: () => socket as unknown as VisitorControlSocket, onFatal: message => fail(new Error(message)),
      fetch: async (_url, init) => {
        assert.equal(compound, true);
        const body = JSON.parse(String(init?.body));
        assert.ok(JSON.stringify(body.input).includes('Show blue rugs sale price under $1800'), 'The fallback receives the entire original request');
        calls++; return Response.json({ status: 'completed', output: [liveAnswer('Synthetic full-request fallback; no display changes.')] });
      },
      emit: event => {
        events.push(event);
        if (event.type === 'backend_idle') finish();
        if (event.type === 'task_error') fail(new Error(event.message));
        if (event.type === 'response_started') void control.applyControl({ seq: ++sequence, interactionRevision: event.interactionRevision, viewRevision: event.revision, ready: true,
          context: control.recordingSnapshot().context, preparationAck: { revision: event.revision, status: 'applied' } }).catch(fail);
        if (event.type === 'navigation') void (async () => {
          if (compound) assert.equal(event.target.kind, 'answer', 'Compound input must not apply a partial query display');
          else {
            assert.equal(event.target.kind, 'task'); if (event.target.kind !== 'task') throw new Error('Expected task view');
            view = event.target.view; await ack(view);
          }
          await control.applyControl({ seq: ++sequence, interactionRevision: 0, viewRevision: 0, ready: true,
            context: control.recordingSnapshot().context, navigationAck: { id: event.id, status: 'applied' } });
        })().catch(fail);
      },
    });
    try {
      socket.open(); await control.ready; control.start();
      socket.user(compound ? 'Show blue rugs sale price under $1800' : 'Only color is blue');
      await done;
      assert.equal(calls, compound ? 1 : 0, 'Only compound input reaches the injected offline model');
      const after = await context.store.read(view.sessionId, context.publication);
      if (compound) {
        assert.deepEqual(after.queries, before.queries); assert.deepEqual(after.operations, before.operations);
        assert.equal(events.some(event => event.type === 'navigation' && event.target.kind === 'task'), false);
      } else assert.deepEqual(view.records.map(record => record.id), ['record-00000']);
    } finally { clearTimeout(timeout); await control.close(); }
  }
});
