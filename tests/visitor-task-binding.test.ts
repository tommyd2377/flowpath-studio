import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskFixture } from '../fixtures/visitor-tasks';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
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

async function fixture() {
  const { newSite } = await import('../lib/site-store');
  const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
  const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
  const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: 'Binding fixture', slug: 'binding-fixture', kind: 'general' });
  const space = taskFixture(); space.publication.siteId = site.id;
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
        const state = JSON.parse(body.instructions.split('\n').find((line: string) => line.startsWith('{"activeCard"') || line.startsWith('{"activeRecords"'))!);
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
        const state = JSON.parse(body.instructions.split('\n').find((line: string) => line.startsWith('{"activeRecords"'))!);
        assert.match(body.instructions, /compact supporting text within the current information/);
        assert.ok(body.instructions.includes(`Display for this request: ${round ? 'confirmed' : 'not yet confirmed'}.`));
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
        const state = JSON.parse(body.instructions.split('\n').find((line: string) => line.startsWith('{"activeRecords"'))!);
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
