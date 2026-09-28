import { taskPromptData } from './helpers/prompt-context-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskFixture, recordedMenuFixture, websiteTaskFixture } from '../fixtures/visitor-tasks';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { acknowledgeTaskDisplay } from '../lib/visitor-capabilities';
import { EvidenceTypeError, resolveEvidence } from '../lib/visitor-evidence-store';
import { runVisitorTask } from '../lib/visitor-task-runner';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { randomUUID } from 'node:crypto';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { readVisitorChatEvents, type VisitorChatEvent } from '../lib/visitor-chat-protocol';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { submitVisitorRealtimeControl } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlCapability, VisitorContext } from '../lib/visitor-realtime-context';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { FakeLiveSocket } from './helpers/live-fixture';
import { createVisitorPromptContext, VISITOR_PROMPT_CONTEXT_GUIDE } from '../lib/visitor-prompt-context';
import { workspaceInstructions } from '../lib/visitor-workspace';
import { carouselInstructions } from '../lib/visitor-carousel-control';
import { assistantPurposeInstructions } from '../lib/visitor-model';
import { expandPromptData } from './helpers/prompt-context-fixture';

function developerInstructions(body: { instructions: string; input: { role?: string; content?: string | { text?: string }[] }[] }) {
  return [body.instructions, ...body.input.filter(item => item.role === 'developer').map(item =>
    typeof item.content === 'string' ? item.content : item.content?.map(part => part.text ?? '').join('\n') ?? '')].join('\n');
}

async function fixture(space = taskFixture()) {
  const { newSite } = await import('../lib/site-store');
  const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
  const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
  const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Binding fixture', slug: 'binding-fixture', kind: 'general' });
  space.publication.siteId = site.id;
  const req = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
  const collections = async (input: unknown) => {
    const response = await collectionRoute(req(input), { params: Promise.resolve({ siteId: site.id }) });
    const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); return body;
  };
  let { review } = await collections({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
  ({ review } = await collections({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
  ({ review } = await collections({ action: 'finish', reviewId: review.id, revision: review.revision }));
  const applied = await collections({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
  const published = await siteRoute(req({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) });
  assert.equal(published.status, 200);
  return { slug: site.slug, ...await visitorTaskContext(site.slug) };
}

test('complete provider payload shares current state once and shrinks without dropping server data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-prompt-bytes-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture(), bridge = await createVisitorTaskBridge(f.slug);
    const authority = publishedWorkspace(f.site.content), workspace = emptyWorkspace(authority.publicationId);
    const answer = 'Previously confirmed reading text remains visible; it is not new evidence. '.repeat(95);
    const context: VisitorContext = { workspace,
      carousel: { version: 1, open: true, revision: 3, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 320, blockId: null }, media: null, answer },
      surface: { version: 1, stateId: 'current-answer', requestId: 'last-request', publicationId: authority.publicationId, tenantId: f.slug, revision: 3, status: 'committed', layout: 'reading', subject: [], regions: [{ id: 'answer', kind: 'answer', title: '', referenceIds: [], role: 'primary', visible: true, selectedId: null }], answer, pendingRequestId: null, previous: [], next: [], reading: { scrollTop: 320, blockId: null } },
    };
    const request = 'Explain the first published article and its qualifications.';
    const originalData: Record<string, unknown> = {};
    const original = await bridge.instructions(context.carousel, context.surface, data => { originalData.task = data; return JSON.stringify(data); });
    const prompt = createVisitorPromptContext();
    const shared = await bridge.instructions(context.carousel, context.surface, prompt.write('task'));
    const workspaceBefore = workspaceInstructions(workspace, authority, undefined, request, undefined, undefined, 'tool', true);
    const workspaceAfter = workspaceInstructions(workspace, authority, undefined, request, undefined, undefined, 'tool', true, prompt.write('workspace'));
    const carouselBefore = carouselInstructions(context, authority), carouselAfter = carouselInstructions(context, authority, prompt.write('carousel'));
    const beforeInstructions = `${original}\n${assistantPurposeInstructions(f.site.content)}\n${carouselBefore}\n${workspaceBefore}`;
    const afterInstructions = `${shared}\n${VISITOR_PROMPT_CONTEXT_GUIDE}\n${assistantPurposeInstructions(f.site.content)}\n${carouselAfter}\n${workspaceAfter}`;
    const input = { request, history: [{ role: 'assistant', text: 'The earlier published view is ready.' }], currentView: context };
    const rawWorkspace = JSON.parse(workspaceBefore.split('\n').at(-1)!); delete rawWorkspace.state; delete rawWorkspace.scene;
    const rawCarousel = JSON.parse(carouselBefore.split('\n').at(-1)!); delete rawCarousel.surface; delete rawCarousel.media;
    assert.deepEqual(expandPromptData(prompt.context(input)), { ...originalData, workspace: rawWorkspace, carousel: rawCarousel });
    const bodies: string[] = [];
    for (const [instructions, providerContext] of [[beforeInstructions, input], [afterInstructions, prompt.context(input)]] as const) {
      await runVisitorTask({ channel: 'chat', model: 'gpt-5.6-luna', apiKey: 'synthetic', signal: new AbortController().signal,
        latestRequest: request, instructionPrefix: () => bridge.instructionPrefix(), instructions, context: providerContext, tools: [bridge.tool],
        fetch: async (_url, init) => { bodies.push(String(init?.body)); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'A qualified response.' }] }] }); },
        execute: async () => { throw new Error('This fixture must not execute any tool or network request.'); },
      });
    }
    const before = Buffer.byteLength(bodies[0]), after = Buffer.byteLength(bodies[1]);
    assert.ok(after < before - 4000, `Complete request bytes: ${before} -> ${after}`);
    t.diagnostic(`Complete mocked provider envelope including instructions/tools/input: ${before} -> ${after} bytes (${Math.round((before - after) / before * 100)}% reduction). No evidence omitted.`);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('a reserved model round reuses its snapshot once while later manual changes still cancel tool execution', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-round-snapshot-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture(), bridge = await createVisitorTaskBridge(context.slug);
    const original = VisitorTaskStore.prototype.read;
    const reads = t.mock.method(VisitorTaskStore.prototype, 'read', original);
    await bridge.beforeModel();
    const reservedReads = reads.mock.callCount();
    assert.equal(reservedReads, 0, 'The first reservation uses the newly prepared bridge snapshot and still performs CAS');
    await bridge.instructions();
    assert.equal(reads.mock.callCount(), reservedReads, 'No repeated session read between reservation and model instructions');
    await bridge.instructions();
    assert.equal(reads.mock.callCount(), reservedReads + 1, 'The shortcut is consumed, not a stale cache');
    const changed = await context.store.read(bridge.sessionId, context.publication);
    changed.generation++; await context.store.save(changed, changed.revision);
    await assert.rejects(bridge.execute(JSON.stringify({ capabilityId: 'schema.describe', input: {} }), new AbortController().signal, async () => {}), /Manual interaction cancelled/);
    await assert.rejects(bridge.beforeModel(), /cancelled/);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('a manual edit before the first model reservation rejects the old bridge without a paid round', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-first-reservation-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture(), bridge = await createVisitorTaskBridge(context.slug);
    const changed = await context.store.read(bridge.sessionId, context.publication);
    changed.generation++; const saved = await context.store.save(changed, changed.revision);
    await assert.rejects(bridge.beforeModel(), /cancelled/);
    assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), saved);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('menu scopes resolve before execution and invalid collection input preserves the confirmed session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-menu-scope-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture(), bridge = await createVisitorTaskBridge(context.slug), signal = new AbortController().signal;
    let displays = 0;
    const display = async (view: VisitorTaskView) => {
      displays++;
      await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
        queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: displays, recordIds: view.records.map(record => record.id) });
    };
    for (const path of [['root', 'child'], undefined]) {
      const before = await context.store.read(bridge.sessionId, context.publication), query = before.queries[0].current;
      const result = await bridge.execute(JSON.stringify({ capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision,
        operations: [{ op: 'setScope', scope: { collectionId: 'child', traversal: 'descendants', path } }, { op: 'setSearch', text: '' }] } }), signal, display);
      assert.equal(result.data.status, 'applied');
      const saved = await context.store.read(bridge.sessionId, context.publication);
      assert.deepEqual(saved.queries[0].current.scope.path, ['root', 'topic', 'child']);
      assert.deepEqual(saved.scene!.recordIds, ['record-00001', 'record-00003', 'record-00005', 'record-00007']);
    }
    for (const scope of [{ collectionId: 'unpublished', traversal: 'descendants' }, { collectionId: 'child', traversal: 'explicitUnion', include: ['unpublished'] }, { collectionId: 'child', traversal: 'direct', include: ['cross'] },
      { collectionId: 'root', traversal: 'explicitUnion', include: ['topic', 'cross'] },
      { collectionId: 'child', traversal: 'explicitUnion', include: ['topic'] },
      { collectionId: 'cross', traversal: 'explicitUnion', include: ['topic', 'child'] },
    ]) {
      const before = await context.store.read(bridge.sessionId, context.publication), query = before.queries[0].current;
      const result = await bridge.execute(JSON.stringify({ capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision, operations: [{ op: 'setScope', scope }] } }), signal, display);
      assert.equal(result.data.status, 'invalid_input');
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before, 'A rejected scope must not reserve an operation or consume a capability call');
    }
    assert.equal(displays, 2);
    const described = await bridge.execute(JSON.stringify({ capabilityId: 'schema.describe', input: { scope: { collectionId: 'topic', traversal: 'descendants' } } }), signal, display);
    assert.equal(described.data.status, 'retrieved');
    assert.deepEqual((described.data.result as { childScopes: unknown[] }).childScopes, [{ collectionId: 'child', traversal: 'descendants', path: ['root', 'topic', 'child'] }]);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('malformed call envelopes return correction feedback without mutating the session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-envelope-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture(), bridge = await createVisitorTaskBridge(context.slug), signal = new AbortController().signal;
    const before = await context.store.read(bridge.sessionId, context.publication);
    let displays = 0;
    const display = async () => { displays++; };
    for (const args of ['{"capabilityId":', JSON.stringify({ capabilityId: 'schema.describe', input: {}, bindings: {} }),
      JSON.stringify({ capabilityId: 'schema.describe', input: {}, bindings: [{ input: 'records' }] })]) {
      const rejected = await bridge.execute(args, signal, display);
      assert.equal(rejected.data.status, 'invalid_input');
      assert.ok('issues' in rejected.data && rejected.data.issues?.length);
      assert.match(JSON.stringify(rejected.data), /did not execute/);
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before);
    }
    const accepted = await bridge.execute(JSON.stringify({ capabilityId: 'schema.describe', input: {}, bindings: [] }), signal, display);
    assert.equal(accepted.data.status, 'retrieved');
    assert.equal(displays, 0);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('model query patches bind the presented revision without copying IDs or rebasing stale work', async () => {
  for (const kind of ['products', 'services'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-query-owner-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const context = await fixture(websiteTaskFixture(kind)), bridge = await createVisitorTaskBridge(context.slug), signal = new AbortController().signal;
      const instructions = await bridge.instructions();
      const schemas = JSON.parse(instructions.split('\n').find(line => line.startsWith('{"expressionSchema"'))!);
      const patch = schemas.capabilities.find((value: { id: string }) => value.id === 'query.patch');
      assert.ok(!JSON.stringify(patch.inputSchema).includes('queryId'));
      assert.ok(!JSON.stringify(patch.inputSchema).includes('baseRevision'));
      const display = async (view: VisitorTaskView) => acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
        queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.records.map(record => record.id) });
      const request = JSON.stringify({ capabilityId: 'query.patch', input: { operations: [{ op: 'setSort', order: [{ fieldId: 'price', direction: 'desc' }] }] } });
      const accepted = await bridge.execute(request, signal, display);
      assert.equal(accepted.data.status, 'applied');
      await bridge.instructions();
      const changed = await context.store.read(bridge.sessionId, context.publication);
      changed.queries[0].current.revision++;
      await context.store.save(changed, changed.revision);
      const saved = await context.store.read(bridge.sessionId, context.publication);
      await assert.rejects(bridge.execute(request, signal, display), /Query changed/);
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), saved, 'A stale model snapshot must not be silently rebound to newer query state');
      const rejected = await bridge.execute(JSON.stringify({ capabilityId: 'query.patch', input: { queryId: 'mistyped', baseRevision: 0, operations: [{ op: 'setSearch', text: '' }] } }), signal, display);
      assert.equal(rejected.data.status, 'invalid_input');
      assert.match(JSON.stringify(rejected.data), /unknown_query/);
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), saved);
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('display-only completion skips synthesis only for a complete acknowledged query, across domains and channels', async () => {
  for (const kind of ['products', 'services'] as const) for (const channel of ['chat', 'voice'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-display-completion-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const context = await fixture(websiteTaskFixture(kind));
      for (const scenario of [
        { request: `Show ${kind} under $40, most expensive first`, hint: true, rounds: 1 },
        { request: `Please narrow ${kind} to prices below $40, ordered with the priciest first`, hint: true, rounds: 1 },
        { request: `Could you please filter ${kind} under $40, highest first?`, hint: true, rounds: 1 },
        { request: `Show ${kind} under $40, most expensive first`, hint: false, rounds: 2 },
        { request: `Show ${kind} under $40 and calculate the total`, hint: true, rounds: 2 },
        { request: `Show ${kind} under $40 and explain which is best`, hint: true, rounds: 2 },
        { request: `Show ${kind} under $40 then research delivery options`, hint: true, rounds: 2 },
        { request: `Show ${kind} under $40 and include pictures`, hint: true, rounds: 2 },
      ]) {
        const bridge = await createVisitorTaskBridge(context.slug, undefined, undefined, { request: scenario.request });
        const session = await context.store.read(bridge.sessionId, context.publication), query = session.queries[0].current;
        let rounds = 0, displays = 0;
        const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
          latestRequest: scenario.request, context: {}, tools: [bridge.tool], beforeModel: () => bridge.beforeModel(), instructions: () => bridge.instructions(),
          fetch: async () => Response.json({ status: 'completed', output: rounds++ === 0 ? [{ type: 'function_call', call_id: 'query', name: 'visitor_task', arguments: JSON.stringify({
            capabilityId: 'query.patch', ...(scenario.hint ? { completion: 'display_only' } : {}), input: { operations: [
              { op: 'addConstraint', parentId: query.where.id, expression: { kind: 'field', id: 'budget', fieldId: 'price', op: 'lt', value: { type: 'money', value: 40, currency: 'USD' } } },
              { op: 'setSort', order: [{ fieldId: 'price', direction: 'desc' }] },
            ] },
          }) }] : [{ type: 'message', content: [{ type: 'output_text', text: 'Additional requested synthesis.' }] }] }),
          execute: (_name, args, signal) => bridge.execute(args, signal, async view => {
            displays++;
            assert.equal(view.result.count.value, 19);
            assert.deepEqual(view.records.map(record => record.id), Array.from({ length: 19 }, (_, i) => `record-${String(19 - i).padStart(5, '0')}`));
            await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
              queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.records.map(record => record.id) });
          }),
        });
        assert.equal(rounds, scenario.rounds, scenario.request); assert.equal(displays, 1);
        assert.equal(result.text, scenario.rounds === 1 ? 'Showing 19 matching items.' : 'Additional requested synthesis.');
        await bridge.finish();
      }
      const bridge = await createVisitorTaskBridge(context.slug, undefined, undefined, { request: 'Show all items' });
      await bridge.instructions();
      await assert.rejects(bridge.execute(JSON.stringify({ capabilityId: 'query.patch', completion: 'display_only', input: { operations: [{ op: 'setSearch', text: '' }] } }), new AbortController().signal, async () => {}), /did not confirm the exact task result/);
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('published price basis fills omitted metadata while explicit conflicts remain correctable without mutation', async () => {
  for (const kind of ['products', 'services'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-query-basis-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const context = await fixture(websiteTaskFixture(kind)), bridge = await createVisitorTaskBridge(context.slug), signal = new AbortController().signal;
      const schemas = JSON.parse((await bridge.instructions()).split('\n').find(line => line.startsWith('{"expressionSchema"'))!);
      const findMeasurement = (node: unknown): Record<string, unknown> | undefined => {
        if (!node || typeof node !== 'object') return;
        const object = node as Record<string, unknown>;
        if (object.properties && (object.properties as Record<string, unknown>).currency && object.anyOf) return object;
        return Object.values(object).map(findMeasurement).find(Boolean);
      };
      const measurement = findMeasurement(schemas.expressionSchema)!;
      assert.ok(measurement, 'Model guidance must retain typed measurement refinements lost by ordinary JSON Schema export');
      const variants = measurement.anyOf as { properties: { type: { const?: string }; unit?: unknown; currency?: unknown }; required?: string[] }[];
      const money = variants.find(value => value.properties.type.const === 'money')!;
      assert.equal(money.properties.unit, false, 'Prices must not advertise the numeric measurement unit property');
      assert.ok(money.required?.includes('currency'));
      assert.equal(variants.find(value => value.properties.type.const === 'number')!.properties.currency, false);
      let displays = 0;
      const display = async (view: VisitorTaskView) => {
        displays++;
        await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
          queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: displays, recordIds: view.records.map(record => record.id) });
      };
      const before = await context.store.read(bridge.sessionId, context.publication), query = before.queries[0].current;
      const request = (basis?: string) => JSON.stringify({ capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision,
        operations: [{ op: 'addConstraint', parentId: query.where.id, expression: { kind: 'field', id: 'budget', fieldId: 'price', op: 'lt', value: { type: 'money', value: 40, currency: 'USD', basis } } }] } });
      for (const basis of ['unsupported']) {
        const rejected = await bridge.execute(request(basis), signal, display);
        assert.equal(rejected.data.status, 'invalid_input');
        assert.match(JSON.stringify(rejected.data), /invalid_query_fields/);
        assert.match(JSON.stringify(rejected.data), /schema.describe/);
        assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before);
        assert.equal(displays, 0);
      }
      const accepted = await bridge.execute(request(), signal, display);
      assert.equal(accepted.data.status, 'applied');
      assert.ok('appliedQuery' in accepted.data && accepted.data.appliedQuery);
      assert.equal(accepted.data.appliedQuery.matchingCount.value, 19);
      const applied = await context.store.read(bridge.sessionId, context.publication);
      assert.equal(JSON.stringify(applied.queries[0].current.where).includes(`"basis":"${kind === 'products' ? 'item' : 'session'}"`), true);
      assert.equal(accepted.data.appliedQuery.page.length, 12);
      assert.equal(accepted.data.appliedQuery.omittedPageRecords, 7);
      assert.equal(accepted.data.appliedQuery.scope[0].id, query.scope.collectionId);
      assert.ok(accepted.data.appliedQuery.scope[0].name);
      assert.ok(accepted.data.appliedQuery.page.every(record => record.id && record.name && record.category));
      assert.equal(displays, 1);
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('chat and voice correct a query-to-records binding mistake inside the existing bounded task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-binding-recovery-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture();
    for (const channel of ['chat', 'voice'] as const) {
      const bridge = await createVisitorTaskBridge(context.slug);
      let round = 0, handleId = '', sceneRevision = 0;
      const displays: VisitorTaskView[] = [];
      const mock: typeof fetch = async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const state = JSON.parse(body.instructions.split('\n').filter((line: string) => line.startsWith('{')).findLast((line: string) => Object.hasOwn(JSON.parse(line), 'activeRecords'))!);
        if (round === 2) {
          const feedback = JSON.parse(body.input.at(-1).output);
          assert.equal(feedback.status, 'invalid_input');
          assert.equal(feedback.issues[0].code, 'evidence_type_mismatch');
          assert.match(feedback.issues[0].message, /contains query/);
          assert.match(body.instructions, /records.search accepts text only/);
        }
        const proposal = round === 0 ? { capabilityId: 'query.patch', input: { queryId: state.query.queryId, baseRevision: state.query.revision, operations: [{ op: 'setSearch', text: '' }] } }
          : round === 1 ? { capabilityId: 'records.search', input: { text: 'articles' }, bindings: [{ input: 'records', handleId, outputType: 'records' }] }
          : round === 2 ? { capabilityId: 'records.lookup', input: { recordIds: ['record-00001', 'record-00003'] } }
          : { capabilityId: 'selection.compare', input: { records: [] }, bindings: [{ input: 'records', handleId, outputType: 'records' }] };
        const output = round++ < 4 ? [{ type: 'function_call', call_id: `call-${round}`, name: 'visitor_task', arguments: JSON.stringify(proposal) }]
          : [{ type: 'message', content: [{ type: 'output_text', text: 'The two published articles are compared.' }] }];
        return Response.json({ status: 'completed', output });
      };
      const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal, fetch: mock,
        tools: [bridge.tool], context: { request: 'Show the articles and compare their published fields.' }, instructions: () => bridge.instructions(), beforeModel: () => bridge.beforeModel(),
        execute: async (_name, args, signal) => {
          const before = await context.store.read(bridge.sessionId, context.publication);
          const result = await bridge.execute(args, signal, async view => {
            displays.push(view);
            await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
              queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: ++sceneRevision,
              recordIds: view.comparison?.rows.map(row => row.id) ?? view.records.map(record => record.id) });
          });
          if (result.data.status === 'invalid_input') assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before, 'Rejected input must not reserve or execute an operation, or alter the confirmed view');
          if (result.data.handleId) handleId = result.data.handleId;
          return result;
        },
      });
      assert.match(result.text, /compared/); assert.equal(result.displaySatisfied, true); assert.equal(round, 5);
      assert.equal(displays.length, 2, 'The confirmed query is not displayed again during correction');
      assert.deepEqual(displays[1].comparison!.rows.map(row => row.id), ['record-00001', 'record-00003']);
      const saved = await context.store.read(bridge.sessionId, context.publication);
      assert.equal(saved.tasks[0].budget.modelCalls, 5); assert.equal(saved.tasks[0].steps.length, 3);
    }
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('chat and voice recover omitted field namespaces in the next model round without schema discovery', async () => {
  for (const kind of ['products', 'services'] as const) {
    const directory = await mkdtemp(join(tmpdir(), 'visitor-field-id-recovery-')), previous = process.env;
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
    try {
      const space = websiteTaskFixture(kind), category = space.fields[1].id, value = kind === 'products' ? 'vanilla' : 'studio';
      space.fields.forEach(field => { field.id = `attributes.${field.id}`; });
      space.records.forEach(record => record.assertions.forEach(assertion => { assertion.fieldId = `attributes.${assertion.fieldId}`; }));
      const context = await fixture(space), request = `Please show only ${value} ${kind} under twenty-six dollars, most expensive first.`;
      for (const channel of ['chat', 'voice'] as const) {
        const bridge = await createVisitorTaskBridge(context.slug, undefined, undefined, { request });
        let rounds = 0, displays = 0;
        const capabilities: string[] = [];
        const result = await runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', signal: new AbortController().signal,
          tools: [bridge.tool], context: { request }, latestRequest: request, instructions: () => bridge.instructions(), beforeModel: () => bridge.beforeModel(),
          fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            let priceId = 'price', categoryId = category;
            if (rounds === 1) {
              const feedback = JSON.parse(body.input.at(-1).output);
              assert.equal(feedback.status, 'invalid_input');
              assert.equal(feedback.issues[0].code, 'invalid_query_fields');
              assert.equal(feedback.queryFields.omittedReferences, 0);
              assert.deepEqual(feedback.queryFields.references.map((reference: { match: string }) => reference.match), ['candidate', 'candidate']);
              const candidates = new Map(feedback.queryFields.references.map((reference: { requestedId: string; candidateIds: string[] }) => [reference.requestedId, reference.candidateIds[0]]));
              priceId = String(candidates.get('price')); categoryId = String(candidates.get(category));
              assert.deepEqual([priceId, categoryId], ['attributes.price', `attributes.${category}`]);
              assert.equal(displays, 0, 'Invalid IDs never produce an optimistic or partial display');
            }
            assert.ok(rounds++ < 2, 'Correction must not require a schema.describe or prose-only model round');
            return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: `query-${rounds}`, name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'query.patch', completion: 'display_only', input: { operations: [
              { op: 'addConstraint', parentId: 'criteria', expression: { kind: 'all', id: 'requested-criteria', children: [
                { kind: 'field', id: 'budget', fieldId: priceId, op: 'lt', value: { type: 'money', value: 26, currency: 'USD' } },
                { kind: 'field', id: 'category', fieldId: categoryId, op: 'eq', value: { type: 'enum', value } },
              ] } },
              { op: 'setSort', order: [{ fieldId: priceId, direction: 'desc' }] },
            ] } }) }] });
          }, execute: async (_name, args, signal) => {
            capabilities.push(JSON.parse(args).capabilityId);
            const before = await context.store.read(bridge.sessionId, context.publication);
            const result = await bridge.execute(args, signal, async view => {
              displays++; assert.deepEqual(view.records.map(record => record.id), ['record-00004', 'record-00001']);
              assert.equal(view.query.order[0].fieldId, 'attributes.price');
              await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId,
                queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: displays, recordIds: view.records.map(record => record.id) });
            });
            if (result.data.status === 'invalid_input') assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before,
              'Rejected fields leave all query, operation, capability budget and display state unchanged');
            return result;
          },
        });
        assert.equal(result.displaySatisfied, true); assert.equal(result.text, 'Showing 2 matching items.');
        assert.deepEqual(capabilities, ['query.patch', 'query.patch']);
        assert.equal(rounds, 2); assert.equal(displays, 1);
        const saved = await context.store.read(bridge.sessionId, context.publication);
        assert.equal(saved.operations.length, 1); assert.equal(saved.tasks[0].budget.modelCalls, 2);
        assert.equal(saved.receipts.filter(receipt => receipt.kind === 'display' && receipt.status === 'confirmed').length, 1);
      }
    } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
  }
});

test('invalid declared inputs can be corrected but stale evidence remains a hard failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-binding-validation-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const context = await fixture(), bridge = await createVisitorTaskBridge(context.slug);
    const signal = new AbortController().signal;
    const display = async () => { assert.fail('Invalid arguments and background retrieval must not display'); };
    const initial = await context.store.read(bridge.sessionId, context.publication), query = initial.queries[0].current;
    await bridge.execute(JSON.stringify({ capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision, operations: [{ op: 'setSearch', text: '' }] } }), signal, async view => {
      await acknowledgeTaskDisplay(context.store, view.sessionId, context.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
        resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.records.map(record => record.id) });
    });
    const found = await bridge.execute(JSON.stringify({ capabilityId: 'records.lookup', input: { recordIds: ['record-00001', 'record-00003'] } }), signal, display);
    assert.ok(found.data.handleId);
    assert.notEqual(found.displaySatisfied, true, 'Retrieving published evidence is not a confirmed display');
    for (const proposal of [
      { capabilityId: 'records.search', input: { text: 'articles', unexpected: true } },
      { capabilityId: 'records.search', input: { text: 'articles' }, bindings: [{ input: 'records', handleId: found.data.handleId, outputType: 'records' }] },
      { capabilityId: 'selection.compare', input: { records: [] }, bindings: Array.from({ length: 2 }, () => ({ input: 'records', handleId: found.data.handleId, outputType: 'records' })) },
    ]) {
      const before = await context.store.read(bridge.sessionId, context.publication);
      const result = await bridge.execute(JSON.stringify(proposal), signal, display);
      assert.equal(result.data.status, 'invalid_input');
      assert.notEqual(result.displaySatisfied, true, 'Rejected arguments do not satisfy a requested display');
      assert.deepEqual(await context.store.read(bridge.sessionId, context.publication), before);
    }
    let session = await context.store.read(bridge.sessionId, context.publication);
    const evidenceIndex = session.evidence.findIndex(value => value.handle.id === found.data.handleId);
    assert.throws(() => resolveEvidence(session, found.data.handleId!, 'query'), EvidenceTypeError);
    for (const change of [
      (value: typeof session) => { value.evidence[evidenceIndex].handle.generation++; },
      (value: typeof session) => { value.evidence[evidenceIndex].handle.sessionId = 'another-session'; },
      (value: typeof session) => { value.evidence[evidenceIndex].handle.publication.revisionId = 'another-publication'; },
      (value: typeof session) => { value.evidence[evidenceIndex].handle.expiresAt = '2000-01-01T00:00:00.000Z'; },
      (value: typeof session) => { value.queries[0].current.revision++; },
    ]) {
      const stale = structuredClone(session); change(stale);
      assert.throws(() => resolveEvidence(stale, found.data.handleId!, 'query'), error => error instanceof Error && !(error instanceof EvidenceTypeError) && /stale/.test(error.message));
    }
    session.queries[0].current.revision++; session = await context.store.save(session, session.revision);
    await assert.rejects(() => bridge.execute(JSON.stringify({ capabilityId: 'selection.compare', input: { records: [] }, bindings: [{ input: 'records', handleId: found.data.handleId, outputType: 'records' }] }), signal, display), /stale/);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('the chat stream retains implicit answers within the confirmed view and preserves explicit rich calculations', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-display-composition-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture();
    for (const mode of ['confirmation', 'explicit', 'implicit'] as const) {
      const compare = mode === 'explicit';
      let requests = 0, sequence = 0, control: VisitorControlCapability | undefined;
      const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(f.site.content).publicationId),
        carousel: { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null } };
      const answer = compare ? 'The published reading amounts are 1 and 3 units: 1 + 3 = 4 units combined.' : mode === 'implicit'
        ? 'Three copies at the published 1 unit each total 3 units. Your hypothetical 12% allowance adds 0.36, for 3.36 units; this allowance is not a published term.' : 'Only article 1 is shown.';
      const mock = t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
        assert.equal(String(url), 'https://api.openai.com/v1/responses', 'Only the mocked provider endpoint is allowed');
        const body = JSON.parse(String(init.body)), round = requests++;
        const instructions = developerInstructions(body);
        const state = taskPromptData(body);
        assert.match(instructions, /compact supporting text within the current information/);
        assert.ok(instructions.includes(`Display for this request: ${round ? 'confirmed' : 'not yet confirmed'}.`));
        let name = 'visitor_task', args: unknown;
        if (round === 0) args = { capabilityId: 'query.patch', input: { queryId: state.query.queryId, baseRevision: state.query.revision,
          operations: [{ op: 'setSearch', text: compare ? 'article' : 'article 1' }] } };
        else if (mode === 'implicit' && round === 1) args = { capabilityId: 'record.detail', input: { recordId: 'record-00001' } };
        else if (!compare) {
          assert.equal(round, mode === 'implicit' ? 2 : 1);
          return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: answer }] }] });
        } else if (round === 1) args = { capabilityId: 'records.lookup', input: { recordIds: ['record-00001', 'record-00003'] } };
        else if (round === 2) {
          const retrieved = JSON.parse(body.input.at(-1).output);
          assert.equal(retrieved.outputType, 'records');
          args = { capabilityId: 'selection.compare', input: { records: [] }, bindings: [{ input: 'records', handleId: retrieved.handleId, outputType: 'records' }] };
        } else {
          assert.equal(round, 3, 'The explicit answer fits within the existing four-tool budget');
          name = 'present_answer'; args = { text: answer, relationship: 'related' };
        }
        return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: `call-${round}`, name, arguments: JSON.stringify(args) }] });
      });
      try {
        const events: VisitorChatEvent[] = [];
        const response = visitorChatTask({ slug: f.slug, siteId: f.site.siteId, content: f.site.content,
          request: { kind: 'chat', requestId: randomUUID(), text: compare ? 'Show the articles, compare articles 1 and 3, and add their published reading amounts.' : mode === 'implicit' ? 'Show article 1 and calculate three copies plus a hypothetical 12% allowance.' : 'Only article 1.', history: [], context },
          availability: { enabled: true, live: true, mode: 'both', chatRemaining: 10, voiceRemaining: 10, resetsAt: '' }, signal: new AbortController().signal, onUsage() {} });
        await readVisitorChatEvents(response.body!, new AbortController().signal, async event => {
          events.push(event);
          if (event.type === 'control') control = event.control;
          if (event.type !== 'navigation') return;
          assert.ok(control);
          if (event.target.kind === 'task') {
            const view = event.target.view;
            const saved = await acknowledgeTaskDisplay(f.store, view.sessionId, f.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
              resultSetId: view.result.resultSetId, sceneRevision: sequence + 1, recordIds: view.comparison?.rows.map(row => row.id) ?? view.records.map(record => record.id) });
            context.taskSession = { sessionId: saved.id, revision: saved.revision, generation: saved.generation };
          }
          await submitVisitorRealtimeControl(f.slug, control, { seq: ++sequence, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status: 'applied' } });
        });
        assert.equal(events.some(event => event.type === 'error'), false, JSON.stringify(events.filter(event => event.type === 'error')));
        const navigation = events.filter(event => event.type === 'navigation');
        assert.deepEqual(navigation.map(event => event.target.kind), mode === 'confirmation' ? ['task', 'answer'] : ['task', 'task', 'answer']);
        assert.equal(requests, compare ? 4 : mode === 'implicit' ? 3 : 2);
        const completion = events.find(event => event.type === 'done'); assert.ok(completion);
        assert.equal(completion.text, answer); assert.equal(completion.displaySatisfied, true);
        if (compare) {
          assert.ok(navigation[1].target.kind === 'task' && navigation[1].target.view.comparison);
          assert.ok(navigation[2].target.kind === 'answer' && navigation[2].target.text === answer && navigation[2].target.relationship === 'related');
          assert.equal(navigation[2].target.placement, undefined, 'An explicit answer keeps its rich region');
        } else {
          assert.ok(navigation[0].target.kind === 'task' && navigation[0].target.view.records.length === 1);
          const final = navigation.at(-1)!.target;
          assert.ok(final.kind === 'answer'); assert.equal(final.text, answer); assert.equal(final.placement, 'supporting');
        }
      } finally { mock.mock.restore(); }
    }
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('a claimed applied response without the exact display receipt cannot satisfy the bridge display', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-display-receipt-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture(), bridge = await createVisitorTaskBridge(f.slug), signal = new AbortController().signal;
    const session = await f.store.read(bridge.sessionId, f.publication), query = session.queries[0].current;
    await assert.rejects(() => bridge.execute(JSON.stringify({ capabilityId: 'query.patch', input: { queryId: query.queryId, baseRevision: query.revision,
      operations: [{ op: 'setSearch', text: 'article 1' }] } }), signal, async () => ({ status: 'applied' })), /did not confirm the exact task result/);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('voice delivers the implicit calculation through an acknowledged supporting-answer update', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-voice-supporting-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture(), socket = new FakeLiveSocket(), events: VisitorRealtimeEvent[] = [];
    const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(f.site.content).publicationId),
      carousel: { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null } };
    const answer = 'Three copies at 1 published unit each, plus your hypothetical 12% allowance, total 3.36 units.';
    let requests = 0, sequence = 0, complete!: () => void, fail!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const timeout = setTimeout(() => fail(new Error('Supporting voice answer timed out')), 5000);
    const availability = { enabled: true, live: true, mode: 'both' as const, chatRemaining: 10, voiceRemaining: 10, resetsAt: '' };
    const control = createVisitorRealtimeControl({ callId: 'supporting-calculation', apiKey: 'synthetic', content: f.site.content, taskSlug: f.slug, context,
      initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => availability, assertCurrent: async () => {},
      socketFactory: () => socket as unknown as VisitorControlSocket, onFatal: message => fail(new Error(message)),
      emit: event => {
        events.push(event);
        if (event.type === 'backend_idle') complete();
        if (event.type === 'task_error') fail(new Error(event.message));
        if (event.type !== 'response_started' && event.type !== 'navigation') return;
        void (async () => {
          if (event.type === 'navigation' && event.target.kind === 'task') {
            const view = event.target.view;
            const saved = await acknowledgeTaskDisplay(f.store, view.sessionId, f.publication, { operationId: view.operationId!, queryId: view.query.queryId,
              queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: sequence + 1, recordIds: view.records.map(record => record.id) });
            context.taskSession = { sessionId: saved.id, revision: saved.revision, generation: saved.generation };
          }
          await control.applyControl({ seq: ++sequence, interactionRevision: event.interactionRevision, viewRevision: event.revision, ready: true, context,
            ...(event.type === 'response_started' ? { preparationAck: { revision: event.revision, status: 'applied' as const } } : { navigationAck: { id: event.id, status: 'applied' as const } }) });
        })().catch(fail);
      },
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body)), round = requests++;
        const state = taskPromptData(body);
        const args = round === 0 ? { capabilityId: 'query.patch', input: { queryId: state.query.queryId, baseRevision: state.query.revision, operations: [{ op: 'setSearch', text: 'article 1' }] } }
          : { capabilityId: 'record.detail', input: { recordId: 'record-00001' } };
        return Response.json({ status: 'completed', output: round < 2 ? [{ type: 'function_call', call_id: `round-${round}`, name: 'visitor_task', arguments: JSON.stringify(args) }]
          : [{ type: 'message', content: [{ type: 'output_text', text: answer }] }] });
      },
    });
    try {
      socket.open(); await control.ready; control.start(); socket.user('Show article 1 and calculate three copies plus a hypothetical 12% allowance.'); await finished;
      const navigation = events.filter(event => event.type === 'navigation');
      assert.deepEqual(navigation.map(event => event.target.kind), ['task', 'task', 'answer']);
      assert.deepEqual(navigation.at(-1)!.target, { kind: 'answer', text: answer, placement: 'supporting' });
      assert.equal(events.filter(event => event.type === 'answer_completed').at(-1)?.text, answer);
      assert.equal(requests, 3);
    } finally { clearTimeout(timeout); await control.close(); }
    t.diagnostic('Mocked voice/provider; tests display acknowledgment and exact answer retention, not audible output.');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

for (const scenario of ['menu', 'exact name', 'partial name', 'clarification'] as const) test(`recorded voice regression: ${scenario} reports the acknowledged result`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-recorded-voice-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture(recordedMenuFixture()), socket = new FakeLiveSocket(), events: VisitorRealtimeEvent[] = [];
    const request = ({ menu: 'Can you bring up the menu', 'exact name': 'Open up the red-and-blue velvet', 'partial name': 'Open up the red and blue', clarification: 'Undo' })[scenario];
    const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(f.site.content).publicationId),
      carousel: { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null } };
    const requests: Record<string, unknown>[] = []; let sequence = 0, complete!: () => void, fail!: (error: Error) => void;
    const finished = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const timeout = setTimeout(() => fail(new Error('Recorded voice regression timed out')), 10000);
    const availability = { enabled: true, live: true, mode: 'both' as const, chatRemaining: 10, voiceRemaining: 10, resetsAt: '' };
    const control = createVisitorRealtimeControl({ callId: 'recorded-voice', apiKey: 'synthetic', content: f.site.content, taskSlug: f.slug, context,
      initialAvailability: availability, signal: new AbortController().signal, reserveTurn: async () => availability, assertCurrent: async () => {},
      socketFactory: () => socket as unknown as VisitorControlSocket, onFatal: message => fail(new Error(message)),
      emit: event => {
        events.push(event);
        if (event.type === 'backend_idle') complete();
        if (event.type === 'task_error') fail(new Error(event.message));
        if (event.type !== 'response_started' && event.type !== 'navigation') return;
        void (async () => {
          if (event.type === 'navigation' && event.target.kind === 'task') {
            const view = event.target.view;
            assert.equal(events.some(event => event.type === 'answer_completed'), false, 'no success before a display receipt');
            const saved = await acknowledgeTaskDisplay(f.store, view.sessionId, f.publication, { operationId: view.operationId!, queryId: view.query.queryId,
              queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: sequence + 1, recordIds: view.focus === 'clarification' ? [] : view.detail ? [view.detail.record.id] : view.records.map(record => record.id) });
            context.taskSession = { sessionId: saved.id, revision: saved.revision, generation: saved.generation };
            const title = view.focus === 'clarification' ? '' : view.detail?.record.name ?? 'Published menu';
            context.carousel = { ...context.carousel!, activeId: 'current', cards: [{ id: 'current', title, kind: 'information', referenceIds: [] }] };
          }
          await control.applyControl({ seq: ++sequence, interactionRevision: event.interactionRevision, viewRevision: event.revision, ready: true, context,
            ...(event.type === 'response_started' ? { preparationAck: { revision: event.revision, status: 'applied' as const } } : { navigationAck: { id: event.id, status: 'applied' as const } }) });
        })().catch(fail);
      },
      fetch: async (_url, init) => {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({ status: 'completed', output: requests.length === 1 ? [{ type: 'function_call', call_id: 'resolved-name', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'record.detail', input: { recordId: 'cake-0' } }) }]
          : [{ type: 'message', content: [{ type: 'output_text', text: 'Red & Blue Velvet is open.' }] }] });
      },
    });
    try {
      socket.open(); await control.ready; control.start();
      if (scenario === 'partial name') socket.frame({ type: 'session.input_transcript.delta', delta: 'Open up the red-and-blue velvet', start_ms: 0, end_ms: 200 });
      socket.frame({ type: 'session.input_transcript.delta', delta: request, start_ms: 2000, end_ms: 2500 });
      socket.frame({ type: 'session.delegation.created', offset_ms: 2500, delegation: { id: 'recorded-request', target: 'client' } });
      await finished;
      const navigation = events.filter(event => event.type === 'navigation');
      assert.equal(navigation.length, scenario === 'partial name' ? 2 : 1); assert.equal(navigation[0].target.kind, 'task');
      const target = navigation[0].target; assert.ok(target.kind === 'task');
      const spoken = events.find(event => event.type === 'answer_completed')?.text ?? '';
      assert.notEqual(spoken, 'Showing .');
      if (scenario === 'clarification') {
        assert.equal(target.view.focus, 'clarification'); assert.equal(spoken, target.view.clarification?.question);
      } else if (scenario === 'menu') {
        assert.equal(target.view.result.count.value, 7); assert.ok(target.view.records.every(record => record.id !== 'menu-article'));
      } else assert.equal(target.view.detail?.record.id, 'cake-0');
      assert.equal(requests.length, scenario === 'partial name' ? 2 : 0, 'simple commands avoid model calls and ambiguity retains dialogue');
      if (scenario === 'partial name') {
        assert.match(JSON.stringify(requests[0].input), /red-and-blue velvet/);
        assert.match(JSON.stringify(requests[0].input), /Open up the red and blue/);
      }
      assert.ok(socket.sent.some(event => event.delegation_id === 'recorded-request' && event.content === spoken));
    } finally { clearTimeout(timeout); await control.close(); }
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
