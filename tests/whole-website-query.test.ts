import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixtureQuery, websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { evaluateQuery } from '../lib/catalog-query';
import { VisitorTaskStore, confirmVisitorView, restoreConfirmedView } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { acknowledgeTaskDisplay, buildVisitorTaskView, executeVisitorCapability } from '../lib/visitor-capabilities';
import { demoWebsiteQuery } from '../lib/visitor-demo-query';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { expressionNodes } from '@thevoice/platform-ui/query';

test('published reading text participates in search without treating prose as typed assertions', () => {
  const space = websiteTaskFixture('products');
  space.records[39].blocks = [{ id: 'tail', kind: 'paragraph', text: 'Reading sentinel beyond every short summary. This prose mentions free cake.' }];
  const index = compileQueryIndex(space), query = { ...fixtureQuery(space), searchText: 'reading sentinel' };
  assert.deepEqual(evaluateQuery(index, query).ordered, ['record-00039']);
  assert.deepEqual(evaluateQuery(index, { ...query, where: { kind: 'field', id: 'price-limit', fieldId: 'price', op: 'lt', value: { type: 'money', value: 1, currency: 'USD', basis: 'item' } } }).ordered, []);
});

for (const kind of ['products', 'services'] as const) test(`${kind}: complete publication, refinement, broadening, ordering, detail history and unacknowledged cancellation`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whole-website-'));
  try {
    const index = compileQueryIndex(websiteTaskFixture(kind)), store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(index.space.publication), sceneRevision = 0;
    const signal = new AbortController().signal;
    buildVisitorTaskView({ index, session, signal }); confirmVisitorView(session); session = await store.save(session, session.revision);
    const run = async (capabilityId: string, input: unknown, ack = true) => {
      session = await store.read(session.id, index.space.publication);
      const result = await executeVisitorCapability({ index, store, sessionId: session.id, signal, assertCurrent: async () => {}, call: { operationId: randomUUID(), capabilityId, input, expectedRevision: session.revision } });
      const view = result.view;
      if (ack) await acknowledgeTaskDisplay(store, session.id, index.space.publication, { operationId: view.operationId!, queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: ++sceneRevision, recordIds: view.active ? view.detail ? [view.detail.record.id] : view.records.map(record => record.id) : [] });
      return view;
    };
    const ask = async (text: string, ack = true) => { session = await store.read(session.id, index.space.publication); const proposal = demoWebsiteQuery(text, { index, session, signal }); return run(proposal.capabilityId, proposal.input, ack); };
    let view = await run('view.reset', {});
    assert.equal(view.result.count.value, 40); assert.equal(new Set(view.records.map(record => record.id)).size, 24);
    view = await run('query.page', { cursor: view.result.nextCursor });
    const pageIds = view.records.map(record => record.id), pageCursor = view.result.nextCursor;
    await run('record.detail', { recordId: view.records[1].id });
    await run('record.detail', { recordId: view.records[1].id, fieldOffset: 1 });
    view = await run('view.back', {}); assert.deepEqual(view.records.map(record => record.id), pageIds); assert.equal(view.result.nextCursor, pageCursor);
    view = await ask(kind === 'products' ? 'Show me chocolate' : 'Show me remote');
    assert.equal(view.result.count.value, 14); assert.ok(view.records.some(record => record.id === 'record-00039'), 'last records participate beyond initial page');
    view = await ask('Only those under $40'); assert.equal(view.result.count.value, 6); assert.equal(view.result.exclusions.unknown, 1);
    await run('record.detail', { recordId: view.records[0].id });
    view = await ask(kind === 'products' ? 'Include vanilla too' : 'Include studio too'); assert.equal(view.result.count.value, 13); assert.equal(view.detail, undefined);
    view = await ask('Sort price descending'); const ordered = view.records.map(record => record.id);
    await run('record.detail', { recordId: ordered[1] });
    await run('record.detail', { recordId: ordered[2] });
    view = await run('view.back', { target: 'results' });
    assert.equal(view.detail, undefined); assert.deepEqual(view.records.map(record => record.id), ordered);
    view = await ask('Remove the price limit'); assert.equal(view.result.count.value, 27);
    const broadening = structuredClone(view);
    const categoryNodes = expressionNodes(view.query.where).filter(node => node.kind === 'field');
    view = await run('query.patch', { queryId: view.query.queryId, baseRevision: view.query.revision, operations: categoryNodes.map(node => ({ op: 'removeConstraint', nodeId: node.id })) });
    assert.equal(view.result.count.value, 40, 'removing the last OR branches removes the Boolean container');
    view = await run('query.patch', { queryId: view.query.queryId, baseRevision: view.query.revision, operations: [{ op: 'replaceConstraint', nodeId: view.query.where.id, expression: broadening.query.where }] });
    const confirmedQuery = view.query;
    await ask('Only those under $25', false);
    session = await store.read(session.id, index.space.publication); restoreConfirmedView(session); session.generation++; session.scene = null; session = await store.save(session, session.revision);
    assert.deepEqual(session.queries.find(query => query.current.queryId === confirmedQuery.queryId)?.current, confirmedQuery);
    view = await run('view.reset', {}); assert.equal(view.result.count.value, 40); assert.equal(view.query.searchText, ''); assert.equal(view.query.order.length, 0);
    const home: VisitorTaskView = await run('home', {}); assert.equal(home.active, false); assert.equal(home.navigation, 'home');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
