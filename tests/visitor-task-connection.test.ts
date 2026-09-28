import { taskPromptData } from './helpers/prompt-context-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { VisitorTaskConnectionError, visitorTaskFailureMessage } from '../lib/visitor-task-error';
import { diagnosticError } from '../lib/visitor-diagnostics';
import { liveTaskFailureMessage } from '../lib/gpt-live/runtime';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { readVisitorChatEvents, type VisitorChatEvent } from '../lib/visitor-chat-protocol';
import { newSite, modifySite } from '../lib/site-store';
import { publicationContent } from '../lib/site-opening';
import { visitorAccess } from '../lib/visitor-store';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { acknowledgeTaskDisplay } from '../lib/visitor-capabilities';
import { submitVisitorRealtimeControl } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlCapability, VisitorContext } from '../lib/visitor-realtime-context';

const socketFailure = () => new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
const tool = { type: 'function', name: 'show_fixture', description: 'Show synthetic published information', parameters: {} };
const call = { type: 'function_call', call_id: 'fixture-call', name: tool.name, arguments: '{}' };

test('both task channels retain a confirmed tool result when the next model connection closes without retrying', async () => {
  for (const channel of ['chat', 'voice'] as const) for (const transport of ['request', 'stream'] as const) {
    let requests = 0, displays = 0; const failure = socketFailure();
    await assert.rejects(runVisitorTask({ channel, model: 'offline-test-model', apiKey: 'synthetic', instructions: 'Offline fixture', context: {}, signal: new AbortController().signal, tools: [tool],
      fetch: async () => {
        if (++requests === 1) return Response.json({ status: 'completed', output: [call] });
        if (transport === 'request') throw failure;
        return new Response(new ReadableStream({ start(controller) { controller.error(failure); } }), { headers: { 'content-type': 'text/event-stream' } });
      },
      execute: async () => { displays++; return { data: { status: 'applied', title: 'Confirmed fixture result' } }; },
    }), error => {
      assert.ok(error instanceof VisitorTaskConnectionError); assert.equal(error.cause, failure);
      assert.deepEqual(diagnosticError(error), { reason: 'provider' });
      assert.match(visitorTaskFailureMessage(error), /connection was interrupted/);
      assert.match(liveTaskFailureMessage(error), /unavailable right now/);
      return true;
    });
    assert.equal(requests, 2); assert.equal(displays, 1, 'The useful view is not cleared or displayed again');
  }
});

test('model connection classification does not swallow cancellation, malformed model replies or capability failures', async () => {
  const controller = new AbortController();
  await assert.rejects(runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', instructions: 'Offline fixture', context: {}, signal: controller.signal, tools: [],
    fetch: async () => { controller.abort(); throw socketFailure(); }, execute: async () => { assert.fail('No tool expected'); },
  }), { name: 'AbortError' });
  for (const failure of [new Error('Evidence is unavailable, expired or stale.'), new SyntaxError('Malformed capability input'), socketFailure()]) {
    let requests = 0;
    await assert.rejects(runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', instructions: 'Offline fixture', context: {}, signal: new AbortController().signal, tools: [tool],
      fetch: async () => { requests++; return Response.json({ status: 'completed', output: [call] }); }, execute: async () => { throw failure; },
    }), error => error === failure && !(error instanceof VisitorTaskConnectionError));
    assert.equal(requests, 1);
    assert.doesNotMatch(visitorTaskFailureMessage(failure), /connection was interrupted/);
  }
  await assert.rejects(runVisitorTask({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', instructions: 'Offline fixture', context: {}, signal: new AbortController().signal, tools: [],
    fetch: async () => Response.json({ status: 'incomplete', output: [] }), execute: async () => { assert.fail('No tool expected'); },
  }), error => error instanceof Error && !(error instanceof VisitorTaskConnectionError) && /did not finish/.test(error.message));
});

test('the real chat stream reports connection failure, retains the acknowledged view and accepts a separate manual retry', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-connection-failure-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await newSite(user, { name: 'Synthetic services', slug: 'connection-fixture', kind: 'general' });
    site = await modifySite(user, site.id, site.revision, stored => { stored.published = publicationContent(stored.draft); stored.publishedAt = new Date().toISOString(); });
    const { content } = await visitorAccess(site.slug), tasks = await visitorTaskContext(site.slug);
    const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(content).publicationId) };
    let requests = 0, control: VisitorControlCapability | undefined;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'Only the mocked provider endpoint is allowed');
      const body = JSON.parse(String(init.body)); requests++;
      if (requests === 2) throw socketFailure();
      if (requests === 3) return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Your published information remains available.' }] }] });
      assert.equal(requests, 1, 'No automatic retries');
      const state = taskPromptData(body);
      return Response.json({ status: 'completed', output: [{ type: 'function_call', call_id: 'show-fixture', name: 'visitor_task', arguments: JSON.stringify({ capabilityId: 'query.patch', input: {
        queryId: state.query.queryId, baseRevision: state.query.revision, operations: [{ op: 'setSearch', text: '' }],
      } }) }] });
    });
    const ask = async (text: string) => {
      const events: VisitorChatEvent[] = [];
      const response = visitorChatTask({ slug: site.slug, siteId: site.id, content, signal: new AbortController().signal, request: { kind: 'chat', text, requestId: randomUUID(), history: [], context },
        availability: { enabled: true, live: true, mode: 'both', chatRemaining: 10, voiceRemaining: 10, resetsAt: '' }, onUsage() {} });
      await readVisitorChatEvents(response.body!, new AbortController().signal, async event => {
        events.push(event);
        if (event.type === 'control') control = event.control;
        if (event.type !== 'navigation') return;
        assert.equal(event.target.kind, 'task'); assert.ok(control);
        if (event.target.kind !== 'task') throw new Error('Expected a task view');
        const view = event.target.view;
        const saved = await acknowledgeTaskDisplay(tasks.store, view.sessionId, tasks.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision,
          resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.records.map(record => record.id) });
        context.taskSession = { sessionId: saved.id, revision: saved.revision, generation: saved.generation };
        await submitVisitorRealtimeControl(site.slug, control, { seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status: 'applied' } });
      });
      return events;
    };
    const failed = await ask('Show me all the published services and explain them.');
    assert.equal(requests, 2); assert.equal(failed.filter(event => event.type === 'navigation').length, 1);
    const error = failed.find(event => event.type === 'error'); assert.ok(error);
    assert.equal(error.message, 'The assistant connection was interrupted. Your current view is still available. Please try your request again.');
    assert.deepEqual(error.diagnostic, { reason: 'provider' });
    const confirmed = (await tasks.store.read(context.taskSession!.sessionId, tasks.publication)).confirmed;
    assert.ok(confirmed?.activeQueryId, 'The confirmed collection survives the failed synthesis round');
    const retry = await ask('Please try my explanation again.');
    assert.equal(requests, 3); assert.ok(retry.some(event => event.type === 'done')); assert.equal(retry.some(event => event.type === 'error'), false);
    assert.deepEqual((await tasks.store.read(context.taskSession!.sessionId, tasks.publication)).confirmed, confirmed);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
