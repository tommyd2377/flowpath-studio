import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SurfaceHistory, surfaceSnapshotSchema, type SurfaceSnapshot } from '../lib/visitor-surface-history';
import { emptyWorkspace, applyWorkspaceBatch } from '@thevoice/platform-ui/workspace';
import { SURFACE_HISTORY_BYTES, SURFACE_HISTORY_ENTRIES, informationLayout, retainSurfaceHistory } from '@thevoice/platform-ui/surface';
import { sampleContent } from '../lib/site-model';
import { publishedWorkspace, workspaceBatch } from '../lib/visitor-workspace';
import { surfacePublishedFacts, carouselInstructions } from '../lib/visitor-carousel-control';
import { validateVisitorContext } from '../lib/visitor-realtime-context';
import { VisitorTaskStore, confirmVisitorView, retainTaskSurface, restoreTaskSurface } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { buildVisitorTaskView } from '../lib/visitor-capabilities';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { taskFixture } from '../fixtures/visitor-tasks';
import { semanticFixture, semanticMediaFixture } from '../fixtures/semantic-knowledge/graph';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { demoExploreResult } from '../lib/explore-model';
import { retainVisitorResearch, retainedResearchContext } from '../lib/visitor-research-cache';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { FakeLiveSocket, flushLive } from './helpers/live-fixture';

const snapshot = (answer = ''): SurfaceSnapshot => ({ id: randomUUID(), tenantId: 'synthetic', publicationId: 'publication', requestId: null, workspace: emptyWorkspace('publication'), task: null, taskBookmark: null, external: [], selections: {}, answer, primaryId: null, expanded: false, scrollTop: 0 });
test('one request coalesces multiple result updates and Back branches from the restored state', () => {
  const history = new SurfaceHistory(), initial = snapshot('First answer');
  history.begin('request-1', initial);
  const answer = { ...initial, id: randomUUID(), answer: 'An explanation', primaryId: 'answer' };
  assert.equal(history.past.length, 0);
  history.commit('request-1', { ...answer, expanded: true, selections: { chart: 'point-1' } });
  assert.equal(history.past.length, 1); assert.equal(history.destination(), initial);
  history.acceptBack();
  history.begin('branch', initial); history.commit('branch', { ...initial, answer: 'Different subject' });
  assert.deepEqual(history.past, [initial]);
  assert.equal(history.commit('request-1', answer), false);
});
test('pending Back restores its prior stable state, even before results; observations add no history', () => {
  const history = new SurfaceHistory(), before = snapshot('Stable');
  history.begin('slow', before); assert.equal(history.destination(), before); history.acceptBack();
  assert.equal(history.commit('slow', snapshot('Late result')), false); assert.equal(history.past.length, 0);
  history.begin('ack', before); assert.equal(history.commit('ack', { ...before, scrollTop: 550, workspace: { ...before.workspace, revision: 99 } }), false);
  assert.equal(history.past.length, 0);
});
test('the first answer does not create a Back destination for the empty invitation', () => {
  const history = new SurfaceHistory(); history.begin('first', snapshot());
  assert.equal(history.commit('first', snapshot('First useful answer')), true);
  assert.equal(history.destination(), undefined);
});
test('supporting final answers survive back/forward without changing the retained primary result', () => {
  const history = new SurfaceHistory(), before = snapshot('Earlier answer');
  const after = surfaceSnapshotSchema.parse({ ...snapshot('The hypothetical total is $30.24.'), answerPlacement: 'supporting', primaryId: 'detail:item-1' });
  history.begin('calculate', before); history.commit('calculate', after);
  assert.equal(history.destination(), before);
  history.acceptBack(after);
  assert.deepEqual(history.forwardDestination(), after);
  assert.equal(history.forwardDestination()?.answerPlacement, 'supporting');
  assert.equal(history.forwardDestination()?.primaryId, 'detail:item-1');
  history.acceptForward(before);
  history.begin('rich-answer', after);
  assert.equal(history.commit('rich-answer', { ...after, answerPlacement: undefined }), true, 'Moving the same answer into a rich region is a meaningful state');
  assert.equal(surfaceSnapshotSchema.parse(before).answerPlacement, undefined, 'Older snapshots retain their original full-answer behavior');
});
test('retained history has entry and UTF-8 byte limits and rejects nodes/unvalidated shapes', () => {
  let history: SurfaceSnapshot[] = [];
  for (let i = 0; i < 30; i++) history = retainSurfaceHistory(history, snapshot(`State ${i}`));
  assert.equal(history.length, SURFACE_HISTORY_ENTRIES);
  const huge = '🌍'.repeat(50_000);
  let bounded: { text: string }[] = [];
  for (let i = 0; i < 20; i++) bounded = retainSurfaceHistory(bounded, { text: huge });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= SURFACE_HISTORY_BYTES);
  assert.equal(surfaceSnapshotSchema.safeParse({ ...snapshot(), children: 'React nodes forbidden' }).success, false);
});
test('composition chooses semantic layouts and charts validate approved numeric fields', () => {
  assert.equal(informationLayout([{ kind: 'answer', role: 'primary' }]), 'reading');
  assert.equal(informationLayout([{ kind: 'video', role: 'supporting' }, { kind: 'answer', role: 'primary' }]), 'split');
  assert.equal(informationLayout([{ kind: 'map', role: 'primary' }]), 'map');
  assert.equal(informationLayout([{ kind: 'information', role: 'supporting' }, { kind: 'collection', role: 'primary' }]), 'collection', 'A requested grid keeps the wide surface even when supporting content remains');
  const authority = publishedWorkspace(sampleContent('general'), semanticFixture), state = emptyWorkspace(authority.publicationId);
  const chart = { instanceId: 'chart', component: 'chart' as const, metric: 'price', references: [{ kind: 'entity' as const, id: 'blue', revisionId: semanticFixture.id }, { kind: 'entity' as const, id: 'white', revisionId: semanticFixture.id }] };
  assert.equal(applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: chart }]), authority).state.objects[0].metric, 'price');
  assert.throws(() => applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: { ...chart, metric: 'invented' } }]), authority));
});
test('restored context resolves exact business facts and rejects another tenant/publication', () => {
  const content = { ...sampleContent('general'), contact: '+1 212 555 0194' }, authority = publishedWorkspace(content);
  const region = { id: 'contact', kind: 'information' as const, title: 'Forged name', referenceIds: ['contact'], role: 'primary' as const, visible: true, selectedId: null };
  const surface = { version: 1 as const, stateId: randomUUID(), requestId: null, tenantId: 'synthetic', publicationId: authority.publicationId, revision: 1, status: 'committed' as const, layout: 'reading' as const, subject: ['contact'], regions: [region], answer: '', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
  const context = validateVisitorContext({ surface }, content, undefined, undefined, 'synthetic');
  assert.match(JSON.stringify(surfacePublishedFacts(context, authority)), /212 555 0194/);
  assert.throws(() => validateVisitorContext({ surface }, content, undefined, undefined, 'other'));
  assert.throws(() => validateVisitorContext({ surface: { ...surface, publicationId: 'old' } }, content));
  const compatibility = { version: 1 as const, open: true, revision: 1, cards: [{ id: 'contact', kind: 'information' as const, title: '', referenceIds: ['contact'] }], activeId: 'contact', previousId: null, lastNarratedId: null, expanded: false, reading: surface.reading, media: null };
  assert.match(carouselInstructions({ ...context, carousel: compatibility }, authority), /212 555 0194/);
});
test('task restoration uses retained result data, restores query and selection, preserves effects and rejects expiry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'information-history-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory));
    const session = await store.create(index.space.publication);
    const view = buildVisitorTaskView({ index, session, signal: new AbortController().signal });
    confirmVisitorView(session); retainTaskSurface(session, view);
    const originalQuery = structuredClone(session.queries);
    session.queries[0].current.searchText = 'abandoned'; session.business = { receipt: 'a completed action' };
    const restored = restoreTaskSurface(session, 'initial');
    assert.deepEqual(session.queries, originalQuery); assert.deepEqual(restored.result, view.result);
    assert.deepEqual(restored.business, { receipt: 'a completed action' }); assert.equal(session.generation, 1);
    assert.throws(() => restoreTaskSurface(session, 'expired'), /expired/);
    await store.save(session, session.revision);
    await assert.rejects(store.read(session.id, { ...index.space.publication, siteId: 'different-site' }), /Publication changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('each tool round receives the newly committed composition without additional model calls', async () => {
  let stateId = 'before'; const supplied: unknown[] = [];
  await runVisitorTask({ model: 'mock', channel: 'chat', apiKey: 'fake', instructions: '', context: () => ({ stateId }), signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'read', description: '', parameters: {} }], execute: async () => { stateId = 'after'; return { data: 'retained result' }; },
    fetch: async (_url, init) => { const request = JSON.parse(String(init?.body)); supplied.push(JSON.parse(request.input[0].content)); return Response.json({ status: 'completed', output: supplied.length === 1 ? [{ type: 'function_call', call_id: 'one', name: 'read', arguments: '{}' }] : [{ type: 'message', content: [{ type: 'output_text', text: 'Ready.' }] }] }); },
  });
  assert.deepEqual(supplied, [{ stateId: 'before' }, { stateId: 'after' }]);
});
test('restored external evidence stays bound to its tenant, publication and retained result ID', () => {
  const result = { ...demoExploreResult('Synthetic research', 'web'), answer: 'Verified fixture evidence.' };
  retainVisitorResearch('synthetic', 'publication-1', result);
  assert.match(JSON.stringify(retainedResearchContext('synthetic', 'publication-1', [result.id])), /Verified fixture evidence/);
  assert.deepEqual(retainedResearchContext('other', 'publication-1', [result.id]).available, []);
  assert.deepEqual(retainedResearchContext('synthetic', 'publication-2', [result.id]).unavailableIds, [result.id]);
  assert.deepEqual(retainedResearchContext('synthetic', 'publication-1', ['forged']).available, []);
  for (let i = 0; i < 65; i++) retainVisitorResearch('bounded', 'publication', { ...result, id: randomUUID() });
  assert.deepEqual(retainedResearchContext('synthetic', 'publication-1', [result.id]).unavailableIds, [result.id]);
});
test('live voice receives exact facts after a long restored answer without truncation or resending facts on scroll', async t => {
  const content = { ...sampleContent('general'), visitorSpeaksFirst: true, contact: '+1 212 555 0194' }, authority = publishedWorkspace(content);
  const surface = { version: 1 as const, stateId: randomUUID(), requestId: null, tenantId: 'synthetic', publicationId: authority.publicationId, revision: 1, status: 'committed' as const, layout: 'reading' as const, subject: ['contact'], regions: [{ id: 'contact', kind: 'information' as const, title: 'Contact', referenceIds: ['contact'], role: 'primary' as const, visible: true, selectedId: null }], answer: 'Retained text. '.repeat(300) + 'END_OF_RESTORED_ANSWER', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
  const carousel = { version: 1 as const, open: true, revision: 1, cards: [{ id: 'contact', kind: 'information' as const, title: 'Contact', referenceIds: ['contact'] }], activeId: 'contact', previousId: null, lastNarratedId: null, expanded: false, reading: surface.reading, media: null };
  const socket = new FakeLiveSocket(), availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  const control = createVisitorRealtimeControl({ callId: 'surface-test', apiKey: 'synthetic', content, context: { surface, carousel }, initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {}, emit() {}, onFatal() {}, signal: new AbortController().signal, socketFactory: () => socket as unknown as VisitorControlSocket, fetch: async () => { throw new Error('No model request expected'); } });
  t.after(() => control.close()); socket.open(); await control.ready; control.start(); await flushLive();
  const supplied = () => socket.sent.filter(event => event.type === 'session.thinking.append').map(event => String(event.content).replace(/^\[(?:screen|content|reading) \d+ part \d+\/\d+\] /, '')).join('');
  assert.match(supplied(), /END_OF_RESTORED_ANSWER/); assert.match(supplied(), /212 555 0194/);
  const before = supplied().length;
  await control.applyControl({ seq: 1, ready: true, interactionRevision: 0, viewRevision: 1, context: { carousel, surface: { ...surface, reading: { scrollTop: 300, blockId: null } } } });
  await flushLive();
  const observation = supplied().slice(before); assert.match(observation, /300/); assert.doesNotMatch(observation, /212 555 0194|END_OF_RESTORED_ANSWER/);
});

test('audio heartbeats do not resend a surface because knowledge retrieval has a new asOf time', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const content = { ...sampleContent('general'), visitorSpeaksFirst: true }, authority = publishedWorkspace(content, semanticFixture);
  const surface = { version: 1 as const, stateId: randomUUID(), requestId: null, tenantId: 'synthetic', publicationId: authority.publicationId, revision: 1, status: 'committed' as const, layout: 'reading' as const, subject: ['blue'], regions: [{ id: 'blue', kind: 'information' as const, title: 'Blue', referenceIds: ['blue'], role: 'primary' as const, visible: true, selectedId: null }], answer: '', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
  const carousel = { version: 1 as const, open: true, revision: 1, cards: [{ id: 'blue', kind: 'information' as const, title: 'Blue', referenceIds: ['blue'] }], activeId: 'blue', previousId: null, lastNarratedId: null, expanded: false, reading: surface.reading, media: null };
  const socket = new FakeLiveSocket(), availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  const control = createVisitorRealtimeControl({ callId: 'unchanged-surface', apiKey: 'synthetic', content, catalog: semanticFixture, context: { surface, carousel }, initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {}, emit() {}, onFatal() {}, signal: new AbortController().signal, socketFactory: () => socket as unknown as VisitorControlSocket, fetch: async () => { throw new Error('No model request expected'); } });
  t.after(() => control.close()); socket.open(); await control.ready; control.start(); await flushLive();
  const count = socket.sent.length;
  for (let seq = 1; seq <= 18; seq++) {
    t.mock.timers.tick(2000);
    await control.applyControl({ seq, ready: true, interactionRevision: 0, viewRevision: 1, context: { carousel, surface }, audio: { inputActive: seq % 2 === 0, outputActive: seq % 2 !== 0 } });
    await flushLive();
  }
  assert.equal(socket.sent.length, count, 'identical published content must not be reinjected on each audio heartbeat');
  await control.applyControl({ seq: 19, ready: true, interactionRevision: 0, viewRevision: 1, context: { carousel: { ...carousel, open: false }, surface } }); await flushLive();
  assert.match(String(socket.sent.at(-1)?.content), /hidden/);
});

test('gallery paging sends current photo observations without repeating retained answers and contact facts', async t => {
  const content = { ...sampleContent('general'), visitorSpeaksFirst: true, contact: '+1 212 555 0194' };
  const media = { ...semanticMediaFixture, assets: [...semanticMediaFixture.assets, { id: 'unlabeled-photo', width: 640, height: 480, caption: '', alt: '' }] };
  const authority = publishedWorkspace(content, undefined, media);
  const surface = { version: 1 as const, stateId: randomUUID(), requestId: null, tenantId: 'synthetic', publicationId: authority.publicationId, revision: 1, status: 'committed' as const, layout: 'split' as const, subject: ['contact'],
    regions: [{ id: 'gallery', kind: 'photo' as const, title: '', referenceIds: ['blue-photo'], role: 'primary' as const, visible: true, selectedId: 'blue-photo' }, { id: 'contact', kind: 'information' as const, title: 'Contact', referenceIds: ['contact'], role: 'supporting' as const, visible: true, selectedId: null }],
    answer: 'Retained explanation. '.repeat(250) + 'EXACT_END', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
  const carousel = { version: 1 as const, open: true, revision: 1, cards: surface.regions.map(({ id, kind, title, referenceIds }) => ({ id, kind, title, referenceIds })), activeId: 'gallery', previousId: null, lastNarratedId: null, expanded: false, reading: surface.reading, media: null };
  const socket = new FakeLiveSocket(), availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  const control = createVisitorRealtimeControl({ callId: 'gallery-context', apiKey: 'synthetic', content, media, context: { surface, carousel }, initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {}, emit() {}, onFatal() {}, signal: new AbortController().signal, socketFactory: () => socket as unknown as VisitorControlSocket, fetch: async () => { throw new Error('No model request expected'); } });
  t.after(() => control.close()); socket.open(); await control.ready; control.start(); await flushLive();
  const before = socket.sent.length;
  for (let seq = 1; seq <= 4; seq++) {
    const photoId = seq % 2 ? 'unlabeled-photo' : 'blue-photo';
    const next = { ...surface, stateId: `selection-${seq}`, regions: [{ ...surface.regions[0], referenceIds: [photoId], selectedId: photoId }, surface.regions[1]], previous: [{ stateId: surface.stateId, title: 'Previous information', subject: ['contact'] }] };
    await control.applyControl({ seq, ready: true, interactionRevision: seq, viewRevision: 1, context: { carousel, surface: next } }); await flushLive();
  }
  const updates = socket.sent.slice(before).filter(event => String(event.event_id).startsWith('visitor_context_'));
  const text = updates.map(event => String(event.content)).join('');
  assert.doesNotMatch(text, /212 555 0194|EXACT_END|Retained explanation|Previous information/);
  assert.match(text, /unlabeled-photo/); assert.match(text, /Reviewed photo of Blue Bowl/);
  assert.equal(updates.some(event => String(event.content).startsWith('[content ')), false);
  assert.ok(updates.length <= 20, 'four selections should not each retransmit many parts of old answer/history');
  const original = socket.sent.slice(0, before).map(event => String(event.content)).join('');
  assert.match(original, /212 555 0194/); assert.match(original, /EXACT_END/);
  t.diagnostic(`Four gallery selections: ${updates.length} context fragments, ${Buffer.byteLength(text)} bytes; retained facts sent once.`);
});

test('Back/Forward restore whole states, branch only after a committed change, and never retain a pending answer', () => {
  const history = new SurfaceHistory(), first = snapshot('First'), second = { ...snapshot('Second'), selections: { photo: 'one' }, scrollTop: 300 }, third = snapshot('Third');
  history.begin('second', first); history.commit('second', second);
  history.begin('third', second); history.commit('third', third);
  history.acceptBack(third); assert.equal(history.destination(), first); assert.equal(history.forwardDestination(), third);
  history.acceptBack(second); assert.equal(history.destination(), undefined); assert.equal(history.forwardDestination(), second);
  history.acceptForward(first); assert.equal(history.destination(), first); assert.equal(history.forwardDestination(), third);
  history.begin('cancelled', second); assert.equal(history.forwardDestination(), undefined);
  history.acceptBack(snapshot('Unfinished answer')); assert.equal(history.forwardDestination(), third);
  history.begin('observation', second); history.commit('observation', { ...second, scrollTop: 20 }); assert.equal(history.forwardDestination(), third);
  history.begin('branch', second); history.commit('branch', snapshot('New question')); assert.equal(history.forwardDestination(), undefined);
  history.clear(); assert.equal(history.past.length + history.future.length, 0);
});

test('both history directions share one capacity and retain the nearest states', () => {
  const history = new SurfaceHistory(); let current = snapshot('0');
  for (let i = 1; i <= 30; i++) { const next = snapshot(String(i)); history.begin(String(i), current); history.commit(String(i), next); current = next; }
  for (let i = 0; i < 16; i++) { const destination = history.destination()!; history.acceptBack(current); current = destination; }
  assert.equal(history.past.length + history.future.length, 16);
  assert.equal(history.forwardDestination()?.answer, '15');
  for (let i = 0; i < 16; i++) { const destination = history.forwardDestination()!; history.acceptForward(current); current = destination; }
  assert.equal(current.answer, '30'); assert.equal(history.destination()?.answer, '29');
});

test('restoring an older task receipt keeps later receipts available without replaying effects', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'information-forward-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory));
    const session = await store.create(index.space.publication), first = buildVisitorTaskView({ index, session, signal: new AbortController().signal });
    confirmVisitorView(session); retainTaskSurface(session, first);
    const later = { ...first, operationId: randomUUID() };
    retainTaskSurface(session, later); session.business = { completed: 'keep this current' };
    restoreTaskSurface(session, 'initial');
    const result = restoreTaskSurface(session, later.operationId);
    assert.equal(result.operationId, later.operationId); assert.equal(session.surfaceHistory.length, 2);
    assert.deepEqual(result.business, { completed: 'keep this current' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
