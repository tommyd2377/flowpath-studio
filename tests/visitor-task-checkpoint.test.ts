import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { publisherVocabularies, taskFixture } from '../fixtures/visitor-tasks';
import { catalogMetadataSchema } from '../lib/catalog-repository';
import { createVisitorTaskBridge } from '../lib/visitor-task-bridge';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { readVisitorChatEvents, visitorChatEventSchema, type VisitorChatEvent } from '../lib/visitor-chat-protocol';
import { captureVisitorTaskCompletion, reconcileVisitorTaskCheckpoint, visitorTaskCheckpoint, type VisitorTaskCheckpoint } from '../lib/visitor-task-checkpoint';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { visitorAccess } from '../lib/visitor-store';
import { acknowledgeTaskDisplay, observeTaskScene } from '../lib/visitor-capabilities';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { submitVisitorRealtimeControl } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlCapability } from '../lib/visitor-realtime-context';
import type { VisitorContext } from '../lib/visitor-request';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

const availability = { enabled: true, live: true, mode: 'both' as const, chatRemaining: 10, voiceRemaining: 10, resetsAt: '' };
test('text-only chat completion reconciles the exact displayed query before a local follow-up across publisher vocabularies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-task-checkpoint-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite } = await import('../lib/site-store');
    const { POST: collectionRoute } = await import('../app/api/sites/[siteId]/collections/route');
    const { POST: siteRoute } = await import('../app/api/sites/[siteId]/route');
    const { POST: taskRoute } = await import('../app/api/visitor/[slug]/tasks/route');
    const req = (input: unknown) => new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:3225' }, body: JSON.stringify(input) });
    let modelCalls = 0;
    t.mock.method(globalThis, 'fetch', async (url: unknown) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'No unmocked remote request is permitted'); modelCalls++;
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is an explanation of the published guide.' }] }] });
    });
    for (const vocabulary of [publisherVocabularies[1], publisherVocabularies[3]]) {
      const site = await newSite({ uid: 'local-demo', mode: 'demo', email: null, displayName: null }, { name: vocabulary.name, slug: `checkpoint-${vocabulary.type}`, kind: 'general' });
      const space = taskFixture(vocabulary); space.publication.siteId = site.id;
      const collections = async (input: unknown) => { const response = await collectionRoute(req(input), { params: Promise.resolve({ siteId: site.id }) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; };
      let { review } = await collections({ action: 'begin', siteRevision: site.revision, metadata: catalogMetadataSchema.strip().parse(space) });
      ({ review } = await collections({ action: 'append', reviewId: review.id, revision: review.revision, chunk: { records: space.records, memberships: space.memberships, relationships: space.relationships } }));
      ({ review } = await collections({ action: 'finish', reviewId: review.id, revision: review.revision }));
      const applied = await collections({ action: 'apply', siteRevision: site.revision, reviewId: review.id, revision: review.revision });
      assert.equal((await siteRoute(req({ action: 'publish', revision: applied.site.revision }), { params: Promise.resolve({ siteId: site.id }) })).status, 200);
      const call = (input: unknown) => taskRoute(req(input), { params: Promise.resolve({ slug: site.slug }) });
      const initial: VisitorTaskView = (await (await call({ action: 'init' })).json()).view;
      const shown: VisitorTaskView = (await (await call({ action: 'command', sessionId: initial.sessionId, generation: initial.generation, operationId: randomUUID(), text: 'Only measure at least 3' })).json()).view;
      assert.ok(shown?.operationId);
      const tasks = await visitorTaskContext(site.slug);
      const saved = await acknowledgeTaskDisplay(tasks.store, shown.sessionId, tasks.publication, { operationId: shown.operationId!, generation: shown.generation, queryId: shown.query.queryId,
        queryRevision: shown.query.revision, resultSetId: shown.result.resultSetId, sceneRevision: 1, recordIds: shown.records.map(record => record.id) });
      const displayed = { ...shown, revision: saved.revision };
      const { content } = await visitorAccess(site.slug);
      const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(content).publicationId), taskSession: { sessionId: displayed.sessionId, revision: displayed.revision, generation: displayed.generation },
        carousel: { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null } };
      let control: VisitorControlCapability | undefined, checkpoint: VisitorTaskCheckpoint | undefined;
      const events: VisitorChatEvent[] = [];
      const response = visitorChatTask({ slug: site.slug, siteId: site.id, content, signal: new AbortController().signal, availability, onUsage() {},
        request: { kind: 'chat', text: 'Explain this guide', requestId: randomUUID(), history: [], context } });
      await readVisitorChatEvents(response.body!, new AbortController().signal, async event => {
        events.push(event);
        if (event.type === 'control') control = event.control;
        if (event.type === 'navigation') {
          assert.equal(event.target.kind, 'answer', 'The answer must not refresh or redisplay the task collection'); assert.ok(control);
          await submitVisitorRealtimeControl(site.slug, control, { seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status: 'applied' } });
        }
        if (event.type === 'done') checkpoint = event.taskCheckpoint;
      });
      assert.ok(checkpoint, JSON.stringify(events));
      assert.equal(checkpoint.generation, displayed.generation + 1);
      assert.ok(checkpoint.revision > displayed.revision);
      const next = reconcileVisitorTaskCheckpoint(displayed, checkpoint); assert.ok(next);
      assert.deepEqual({ ...next, revision: displayed.revision, generation: displayed.generation }, displayed, 'Completion changes identity counters, not content or display receipts');
      // Old commands are still rejected, rather than retried against a newer view.
      const input = { action: 'command', sessionId: next.sessionId, generation: displayed.generation, operationId: randomUUID(), text: 'Only measure at least 6' };
      assert.equal((await call(input)).status, 409);
      await assert.rejects(observeTaskScene(tasks.store, next.sessionId, tasks.publication, { operationId: displayed.operationId!, generation: displayed.generation, queryId: displayed.query.queryId,
        queryRevision: displayed.query.revision, resultSetId: displayed.result.resultSetId, sceneRevision: 2, recordIds: [], ready: false }), /does not match the current displayed result/, 'Animations cannot report visibility using the previous model generation');
      await observeTaskScene(tasks.store, next.sessionId, tasks.publication, { operationId: next.operationId!, generation: next.generation, queryId: next.query.queryId,
        queryRevision: next.query.revision, resultSetId: next.result.resultSetId, sceneRevision: 2, recordIds: next.records.slice(0, 2).map(record => record.id), ready: true });
      const followup = await call({ ...input, generation: next.generation }), result = await followup.json();
      assert.equal(followup.status, 200, JSON.stringify(result)); assert.equal(result.view.result.count.value, 2);
      assert.deepEqual(result.view.records.map((record: { id: string }) => record.id), ['record-00006', 'record-00007']);

      for (const changed of [
        { sessionId: randomUUID() }, { revision: displayed.revision - 1 }, { generation: displayed.generation - 1 }, { queryId: 'different-query' },
        { queryRevision: displayed.query.revision + 1 }, { resultSetId: 'different-results' }, { operationId: randomUUID() }, { active: !displayed.active },
      ]) assert.equal(reconcileVisitorTaskCheckpoint(displayed, { ...checkpoint, ...changed }), null, JSON.stringify(changed));
      assert.equal(reconcileVisitorTaskCheckpoint(null, checkpoint), null);
      assert.equal(reconcileVisitorTaskCheckpoint(displayed, visitorTaskCheckpoint(displayed)), displayed);
      assert.equal(visitorChatEventSchema.safeParse({ type: 'done', text: 'Ready.', availability, taskCheckpoint: { ...checkpoint, private: 'unknown' } }).success, false);

      const capture = () => {
        const controller = new AbortController();
        const state = { interaction: 0, view: displayed, confirmed: displayed };
        let paused = false, accepted = 0, interrupted = 0;
        const completion = captureVisitorTaskCompletion({ signal: controller.signal, current: () => state,
          pause: () => { paused = true; },
          accept: async (view, confirmed) => { state.view = view; state.confirmed = confirmed; paused = false; accepted++; },
          interrupt: async () => { interrupted++; paused = false; },
        });
        return { completion, controller, state, paused: () => paused, accepted: () => accepted, interrupted: () => interrupted };
      };
      await t.test(`${vocabulary.type}: completion handoff pauses old observers and successful identity needs no cleanup request`, async () => {
        const handoff = capture(); assert.equal(handoff.paused(), true);
        await handoff.completion.accept(checkpoint!); await handoff.completion.finish();
        assert.equal(handoff.paused(), false); assert.equal(handoff.accepted(), 1); assert.equal(handoff.interrupted(), 0);
      });
      await t.test(`${vocabulary.type}: missing or rejected completion reconciles once while a legacy acknowledged display needs no interrupt`, async () => {
        for (const rejected of [false, true]) {
          const handoff = capture();
          if (rejected) await handoff.completion.accept({ ...checkpoint!, operationId: randomUUID() });
          await handoff.completion.finish(); await handoff.completion.finish();
          assert.equal(handoff.paused(), false); assert.equal(handoff.accepted(), 0); assert.equal(handoff.interrupted(), 1);
        }
        const handoff = capture(); handoff.state.view = { ...displayed, generation: displayed.generation + 1 }; handoff.state.confirmed = handoff.state.view;
        await handoff.completion.finish(); assert.equal(handoff.interrupted(), 0, 'An acknowledged task display already resumed its own viewport');
      });
      await t.test(`${vocabulary.type}: cancellation, a newer interaction, or a different session owns its own recovery`, async () => {
        for (const changed of ['aborted', 'interaction', 'session']) {
          const handoff = capture();
          if (changed === 'aborted') handoff.controller.abort();
          else if (changed === 'interaction') handoff.state.interaction++;
          else handoff.state.view = { ...displayed, sessionId: randomUUID() };
          const current = handoff.state.view;
          await handoff.completion.accept(checkpoint!); await handoff.completion.finish();
          assert.equal(handoff.accepted(), 0); assert.equal(handoff.interrupted(), 0); assert.equal(handoff.state.view, current);
        }
      });

      for (const status of ['failed', 'cancelled'] as const) {
        const bridge = await createVisitorTaskBridge(site.slug, next.sessionId); await bridge.beforeModel();
        assert.equal(await bridge.finish(status), undefined, `${status} completion provides no new client authority`);
      }
      const stale = await createVisitorTaskBridge(site.slug, next.sessionId); await stale.beforeModel();
      await call({ action: 'interrupt', sessionId: next.sessionId });
      assert.equal(await stale.finish(), undefined, 'A superseded task cannot reconcile the newer generation');

      for (const status of ['failed', 'completed'] as const) await t.test(`${vocabulary.type}: ${status} answer cleanup preserves the exact displayed clarification and permits the next command`, async () => {
        let current: VisitorTaskView = (await (await call({ action: 'refresh', sessionId: next.sessionId })).json()).view;
        const clarification = { question: 'Which published option would you like to compare?', options: ['First option', 'Second option'] };
        const clarified = await call({ action: 'execute', sessionId: current.sessionId, call: { operationId: randomUUID(), expectedRevision: current.revision, capabilityId: 'task.clarify', input: clarification } });
        const clarificationResult = await clarified.json(); assert.equal(clarified.status, 200, JSON.stringify(clarificationResult)); current = clarificationResult.view;
        const receipt = await acknowledgeTaskDisplay(tasks.store, current.sessionId, tasks.publication, { operationId: current.operationId!, generation: current.generation, queryId: current.query.queryId,
          queryRevision: current.query.revision, resultSetId: current.result.resultSetId, sceneRevision: status === 'failed' ? 3 : 5, recordIds: [] });
        current = { ...current, revision: receipt.revision };
        const displayedClarification = current;
        let interruptions = 0;
        const recovery = captureVisitorTaskCompletion({ signal: new AbortController().signal, current: () => ({ interaction: 0, view: current, confirmed: current }), pause() {},
          accept: async () => assert.fail('A failed or legacy stream supplies no completion checkpoint'),
          interrupt: async () => {
            interruptions++;
            const authoritative: VisitorTaskView = (await (await call({ action: 'interrupt', sessionId: current.sessionId })).json()).view;
            assert.equal(authoritative.clarification, null, 'Server cancellation projects the confirmed result without transient clarification');
            const preserved = reconcileVisitorTaskCheckpoint(current, visitorTaskCheckpoint(authoritative)); assert.ok(preserved, 'Only the same confirmed receipt may preserve displayed content');
            current = preserved;
            assert.equal(reconcileVisitorTaskCheckpoint(displayedClarification, visitorTaskCheckpoint({ ...authoritative, operationId: randomUUID() })), null, 'A late ACK of a different operation requires the authoritative view');
          },
        });
        const bridge = await createVisitorTaskBridge(site.slug, current.sessionId); await bridge.beforeModel();
        const completion = await bridge.finish(status);
        if (status === 'failed') assert.equal(completion, undefined);
        // A legacy completed stream omits its checkpoint. Neither case replays
        // model work; cleanup reconciles its exact receipt once.
        await recovery.finish(); await recovery.finish(); assert.equal(interruptions, 1);
        assert.deepEqual(current.clarification, clarification); assert.equal(current.focus, 'clarification');
        assert.deepEqual({ ...current, revision: displayedClarification.revision, generation: displayedClarification.generation }, displayedClarification);
        await observeTaskScene(tasks.store, current.sessionId, tasks.publication, { operationId: current.operationId!, generation: current.generation, queryId: current.query.queryId,
          queryRevision: current.query.revision, resultSetId: current.result.resultSetId, sceneRevision: status === 'failed' ? 4 : 6, recordIds: [], ready: true });
        assert.equal((await call({ ...input, operationId: randomUUID(), generation: current.generation })).status, 200, 'The next local command succeeds after answer cleanup');
      });
    }
    assert.equal(modelCalls, 2, 'Each answer calls the mocked model once; both follow-ups stay local');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
