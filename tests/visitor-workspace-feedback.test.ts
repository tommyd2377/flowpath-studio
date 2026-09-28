import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyWorkspaceBatch, emptyWorkspace, type WorkspaceAuthority } from '@thevoice/platform-ui/workspace';
import { workspaceToolResult } from '../lib/visitor-workspace-feedback';
import { objectInput, publishedWorkspace, workspaceBatch, workspaceToolJsonSchema } from '../lib/visitor-workspace';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { newSite, modifySite } from '../lib/site-store';
import { publicationContent } from '../lib/site-opening';
import { visitorAccess } from '../lib/visitor-store';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { readVisitorChatEvents, type VisitorChatEvent } from '../lib/visitor-chat-protocol';
import { submitVisitorRealtimeControl } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlCapability, VisitorContext } from '../lib/visitor-realtime-context';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { liveAnswer, liveTool } from './helpers/live-fixture';

const compact = (reference: { kind: string; id: string }) => ({ kind: reference.kind, id: reference.id });
function fixture(domain: string) {
  const authority: WorkspaceAuthority = { publicationId: `${domain}-publication`, records: [
    { reference: { kind: 'source', id: 'introduction', revisionId: 'public' }, component: 'information', name: 'Introduction' },
    { reference: { kind: 'photo', id: 'photo-1', revisionId: 'public' }, component: 'photo', name: `${domain} illustration`, example: true },
    { reference: { kind: 'entity', id: 'offering-1', revisionId: 'public' }, component: 'detail', name: `${domain} offering` },
  ] };
  const state = applyWorkspaceBatch(emptyWorkspace(authority.publicationId), workspaceBatch(emptyWorkspace(authority.publicationId), [{ kind: 'add', object: objectInput(authority.records[0]) }]), authority).state;
  const photo = authority.records[1].reference, entity = authority.records[2].reference;
  const proposal = (references: unknown = [compact(photo), compact(entity)]) => ({ batch: { sceneRevision: null, operations: [{ kind: 'add', object: { instanceId: 'requested-photo', component: 'photo', references } }] }, clarification: '' });
  return { authority, state, photo, entity, proposal };
}

for (const domain of ['restaurant', 'architecture-service', 'education']) test(`${domain}: incompatible photo references return bounded feedback without changing the current view`, () => {
  const f = fixture(domain), before = structuredClone(f.state), raw = f.proposal(), original = structuredClone(raw);
  const rejected = workspaceToolResult(raw, f.state, f.authority);
  assert.equal(rejected.data?.status, 'invalid_input');
  assert.equal(rejected.reply, undefined);
  assert.deepEqual(rejected.data?.rules.photo, { kinds: ['photo'], minimum: 1, maximum: 1 });
  assert.deepEqual(rejected.data?.candidates, [{ reference: compact(f.photo), name: `${domain} illustration`, component: 'photo', example: true }]);
  assert.ok(JSON.stringify(rejected.data).length < 2000);
  assert.deepEqual(raw, original); assert.deepEqual(f.state, before);
  const repaired = workspaceToolResult(f.proposal([compact(f.photo)]), f.state, f.authority);
  assert.ok(repaired.reply?.batch);
  const next = applyWorkspaceBatch(f.state, repaired.reply.batch, f.authority).state;
  assert.equal(next.objects.length, 2, 'The useful introduction survives the corrected addition');
  assert.deepEqual(next.objects[1].references, [f.photo]);
  assert.deepEqual(f.state, before);
});

test('reference shape feedback stays narrow; unauthorized, stale and ambiguous identities remain hard failures', () => {
  const f = fixture('repair'), before = structuredClone(f.state);
  for (const refs of [null, [], [null], [compact(f.photo), compact(f.photo)]]) {
    assert.equal(workspaceToolResult(f.proposal(refs), f.state, f.authority).data?.status, 'invalid_input');
  }
  for (const refs of [[{ kind: 'photo', id: 'private-photo' }], [{ ...f.photo, revisionId: 'unpublished' }], [compact(f.photo), { kind: 'entity', id: 'private-offering' }]]) {
    assert.throws(() => workspaceToolResult(f.proposal(refs), f.state, f.authority));
  }
  const ambiguous = { ...f.authority, records: [...f.authority.records, { ...f.authority.records[1], reference: { ...f.photo, revisionId: 'another-publication' } }] };
  assert.throws(() => workspaceToolResult(f.proposal(), f.state, ambiguous));
  assert.throws(() => workspaceToolResult(f.proposal(), f.state, { ...f.authority, publicationId: 'new-publication' }), /publication changed/);
  assert.throws(() => workspaceToolResult({ ...f.proposal(), batch: { ...f.proposal().batch, sceneRevision: 7 } }, f.state, f.authority, { revision: 8, workspaceRevision: f.state.revision, visibility: 'visible', focusedId: null, objects: [] }));
  const legacy = workspaceBatch(f.state, [{ kind: 'add', object: { instanceId: 'requested-photo', component: 'photo', references: [f.photo, f.entity] } }]);
  assert.throws(() => workspaceToolResult({ batch: { ...legacy, baseRevision: f.state.revision - 1 }, clarification: '' }, f.state, f.authority), /workspace changed/);
  assert.throws(() => workspaceToolResult({ batch: { operations: [{ kind: 'not-an-operation' }] }, clarification: '' }, f.state, f.authority));
  assert.deepEqual(f.state, before);
});

test('an invalid replacement or update preserves every existing object and valid operations are not partially applied', () => {
  const f = fixture('services'), before = structuredClone(f.state), invalid = f.proposal().batch.operations[0].object;
  for (const operation of [
    { kind: 'replace', objects: [invalid] },
    { kind: 'update', instanceId: f.state.objects[0].instanceId, component: 'photo', references: invalid.references },
  ]) {
    const result = workspaceToolResult({ batch: { operations: [{ kind: 'expand', instanceId: f.state.objects[0].instanceId }, operation] }, clarification: '' }, f.state, f.authority);
    assert.equal(result.data?.status, 'invalid_input'); assert.deepEqual(f.state, before);
  }
});

test('an earlier repairable error never masks a later unauthorized, stale or ambiguous object or origin reference', () => {
  const f = fixture('mixed-errors'), before = structuredClone(f.state);
  for (const firstReferences of [[compact(f.photo), compact(f.entity)], []]) {
    for (const reference of [{ ...f.photo, id: 'private-photo' }, { ...f.photo, revisionId: 'old' }]) {
      const first = f.proposal(firstReferences).batch.operations[0];
      const second = { instanceId: 'second-photo', component: 'photo', references: [reference] };
      for (const later of [
        { kind: 'add', object: second },
        { kind: 'update', ...second, instanceId: f.state.objects[0].instanceId },
        { kind: 'add', object: { ...second, references: [compact(f.photo)] }, origin: { objectId: null, reference, focusKey: '', scrollTop: 0 } },
      ]) {
        const raw = { batch: { operations: [first, later] }, clarification: '' }, original = structuredClone(raw);
        assert.throws(() => workspaceToolResult(raw, f.state, f.authority), 'No feedback or current candidate may be returned for a batch containing a private/stale identity');
        assert.deepEqual(raw, original); assert.deepEqual(f.state, before);
      }
      const replacement = { batch: { operations: [{ kind: 'replace', objects: [first.object, second] }] }, clarification: '' };
      assert.throws(() => workspaceToolResult(replacement, f.state, f.authority));
    }
  }
  const ambiguous = { ...f.authority, records: [...f.authority.records, { ...f.authority.records[1], reference: { ...f.photo, revisionId: 'other' } }] };
  const raw = { batch: { operations: [f.proposal([]).batch.operations[0], { kind: 'add', object: { instanceId: 'second-photo', component: 'photo', references: [f.photo] } }] }, clarification: '' };
  assert.throws(() => workspaceToolResult(raw, f.state, ambiguous), 'An explicit revision cannot hide a kind/id collision during feedback');
  assert.deepEqual(f.state, before);
});

test('the complete reference list is checked before feedback candidate bounds are applied', () => {
  const f = fixture('complete-preflight');
  const references = [...Array.from({ length: 12 }, () => compact(f.photo)), { ...f.photo, id: 'private-at-end' }];
  assert.throws(() => workspaceToolResult(f.proposal(references), f.state, f.authority));
  const malformed = workspaceToolResult(f.proposal([...Array.from({ length: 12 }, () => compact(f.photo)), null]), f.state, f.authority);
  assert.equal(malformed.data?.status, 'invalid_input', 'Malformed shapes can still be corrected without guessing an identity');
  assert.equal(malformed.data?.candidates.length, 1, 'Feedback remains bounded and deduplicated');
});

test('repeated rejected workspace calls cannot escape the existing four-tool limit or survive cancellation', async () => {
  const f = fixture('bounded'), controller = new AbortController();
  let modelCalls = 0, toolCalls = 0;
  await assert.rejects(runVisitorTask({ channel: 'chat', model: 'offline-fixture', apiKey: 'synthetic', instructions: 'Offline workspace fixture', context: {}, signal: controller.signal,
    tools: [{ type: 'function', name: 'update_workspace', description: 'Synthetic fixture', parameters: workspaceToolJsonSchema() }],
    fetch: async () => { modelCalls++; return Response.json({ status: 'completed', output: [liveTool('update_workspace', f.proposal())] }); },
    execute: async (_name, args) => { toolCalls++; const result = workspaceToolResult(args, f.state, f.authority); assert.ok(result.data); return { data: result.data }; },
  }), /tool limit/);
  assert.equal(modelCalls, 5); assert.equal(toolCalls, 4);
  modelCalls = 0;
  await assert.rejects(runVisitorTask({ channel: 'chat', model: 'offline-fixture', apiKey: 'synthetic', instructions: 'Offline cancellation fixture', context: {}, signal: controller.signal,
    tools: [{ type: 'function', name: 'update_workspace', description: 'Synthetic fixture', parameters: workspaceToolJsonSchema() }],
    fetch: async () => { modelCalls++; return Response.json({ status: 'completed', output: [liveTool('update_workspace', f.proposal())] }); },
    execute: async (_name, args) => { const result = workspaceToolResult(args, f.state, f.authority); controller.abort(); return { data: result.data }; },
  }), error => error instanceof Error && error.name === 'AbortError');
  assert.equal(modelCalls, 1);
});

test('the full chat caller can repair a photo and entity mismatch once without an error or a partial display', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'workspace-photo-feedback-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await newSite(user, { name: 'Synthetic ceramics', slug: 'workspace-photo-fixture', kind: 'general' });
    site = await modifySite(user, site.id, site.revision, stored => { stored.published = publicationContent(stored.draft); stored.publishedAt = new Date().toISOString(); });
    const { content } = await visitorAccess(site.slug), authority = publishedWorkspace(content, semanticFixture, semanticMediaFixture);
    const context: VisitorContext = { workspace: emptyWorkspace(authority.publicationId) };
    const photo = authority.records.find(record => record.reference.kind === 'photo')!.reference, entity = authority.records.find(record => record.reference.kind === 'entity')!.reference;
    let rounds = 0, displays = 0, control: VisitorControlCapability | undefined;
    t.mock.method(globalThis, 'fetch', async (url: unknown, init: RequestInit) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'Only this mocked provider endpoint may be requested');
      const body = JSON.parse(String(init.body)), round = rounds++;
      assert.match(body.tools.find((tool: { name: string }) => tool.name === 'update_workspace').description, /exactly one photo reference/);
      if (round === 1) {
        const feedback = JSON.parse(body.input.at(-1).output);
        assert.equal(feedback.status, 'invalid_input'); assert.deepEqual(feedback.rules.photo.kinds, ['photo']);
        assert.equal(displays, 0); assert.equal(context.workspace?.objects.length, 0);
      }
      if (round === 2) { assert.equal(displays, 1); return Response.json({ status: 'completed', output: [liveAnswer('The published photo is shown.')] }); }
      assert.ok(round < 2, 'No extra provider retry');
      return Response.json({ status: 'completed', output: [liveTool('update_workspace', { batch: { operations: [{ kind: 'add', object: { instanceId: 'requested-photo', component: 'photo', references: round ? [compact(photo)] : [compact(photo), compact(entity)] } }] }, clarification: '' })] });
    });
    const events: VisitorChatEvent[] = [], controller = new AbortController(); t.after(() => controller.abort());
    const response = visitorChatTask({ slug: site.slug, siteId: site.id, content, catalog: semanticFixture, media: semanticMediaFixture, signal: controller.signal,
      request: { kind: 'chat', requestId: randomUUID(), text: 'Show me the published bowl photo.', history: [], context },
      availability: { enabled: true, live: true, mode: 'both', chatRemaining: 10, voiceRemaining: 10, resetsAt: '' }, onUsage() {} });
    await readVisitorChatEvents(response.body!, controller.signal, async event => {
      events.push(event);
      if (event.type === 'control') control = event.control;
      if (event.type !== 'navigation') return;
      assert.equal(event.target.kind, 'workspace'); assert.ok(control);
      if (event.target.kind !== 'workspace') throw new Error('Expected the repaired workspace');
      displays++; context.workspace = applyWorkspaceBatch(context.workspace!, event.target.batch, authority).state;
      await submitVisitorRealtimeControl(site.slug, control, { seq: displays, interactionRevision: 0, viewRevision: 0, ready: true, context, navigationAck: { id: event.id, status: 'applied' } });
    });
    assert.equal(rounds, 3); assert.equal(displays, 1);
    assert.equal(events.some(event => event.type === 'error'), false, JSON.stringify(events));
    assert.ok(events.some(event => event.type === 'done' && event.displaySatisfied));
    assert.deepEqual(context.workspace?.objects[0].references, [photo]);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
