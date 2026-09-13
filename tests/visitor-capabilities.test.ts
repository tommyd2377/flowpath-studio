import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { taskFixture } from '../fixtures/visitor-tasks';
import { localTaskDocuments } from '../lib/task-persistence';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { acknowledgeTaskDisplay, executeVisitorCapability, buildVisitorTaskView, visitorCapabilities } from '../lib/visitor-capabilities';
import { resolveEvidence } from '../lib/visitor-evidence-store';
import { SyntheticVisitorAdapter } from '../lib/visitor-adapters/synthetic';
import { demoExploreResult } from '../lib/explore-model';
import { visitorArtifactSchema, artifactMarkdown } from '@thevoice/platform-ui/artifacts';

test('dependent typed handles compose lookup/filter/selection/compare with exact display receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-capabilities-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(index.space.publication);
    buildVisitorTaskView({ index, session, signal: new AbortController().signal }); session = await store.save(session, session.revision);
    const execute = async (capabilityId: string, input: unknown, bindings?: { input: string; handleId: string; outputType: string }[]) => {
      session = await store.read(session.id, index.space.publication);
      return executeVisitorCapability({ sessionId: session.id, store, index, signal: new AbortController().signal, assertCurrent: async () => {}, call: { capabilityId, input, bindings, operationId: randomUUID(), expectedRevision: session.revision } });
    };
    const lookup = await execute('records.lookup', { recordIds: ['record-00000', 'record-00001', 'record-00003'] });
    const filtered = await execute('records.filter', { records: [], where: { kind: 'field', id: 'flag', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } }, [{ input: 'records', handleId: lookup.handleId, outputType: 'records' }]);
    assert.deepEqual((filtered.data as { id: string }[]).map(record => record.id), ['record-00001', 'record-00003']);
    await execute('selection.fromRecords', { records: [] }, [{ input: 'records', handleId: filtered.handleId, outputType: 'records' }]);
    const compared = await execute('selection.compare', {});
    assert.equal(compared.view.comparison!.rows.length, 2);
    const ack = { operationId: compared.view.operationId!, queryId: compared.view.query.queryId, queryRevision: compared.view.query.revision, resultSetId: compared.view.result.resultSetId, sceneRevision: 1, recordIds: compared.view.comparison!.rows.map(record => record.id) };
    await assert.rejects(() => acknowledgeTaskDisplay(store, session.id, index.space.publication, { ...ack, resultSetId: 'fabricated' }), /acknowledgment/);
    session = await acknowledgeTaskDisplay(store, session.id, index.space.publication, ack);
    assert.equal(session.receipts.at(-1)!.kind, 'display');
    session.generation++; session = await store.save(session, session.revision);
    assert.throws(() => resolveEvidence(session, lookup.handleId, 'records'), /stale/);
    await assert.rejects(() => execute('selection.fromRecords', { records: [] }, [{ input: 'records', handleId: 'fabricated', outputType: 'records' }]), /Evidence/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('server-owned external evidence composes to approximate maps; spoofed, expired and interrupted dependencies fail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-research-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory)); let session = await store.create(index.space.publication), calls = 0;
    buildVisitorTaskView({ index, session, signal: new AbortController().signal }); session = await store.save(session, session.revision);
    const research = async () => { calls++; return { ...demoExploreResult('fixture location', 'map'), map: { label: 'Fixture area', latitude: 41.4, longitude: -74, zoom: 10 } }; };
    const execute = async (capabilityId: string, input: unknown, bindings?: { input: string; handleId: string; outputType: string }[]) => { session = await store.read(session.id, index.space.publication); return executeVisitorCapability({ sessionId: session.id, index, store, research, signal: new AbortController().signal, assertCurrent: async () => {}, call: { operationId: randomUUID(), expectedRevision: session.revision, capabilityId, input, bindings } }); };
    const lookup = await execute('research.lookup', { query: 'fixture location', kind: 'map' }); assert.equal(calls, 1);
    assert.equal((await store.read(session.id, index.space.publication)).presentation, null, 'read does not change the displayed scene');
    const external = await execute('presentation.show', { handleId: lookup.handleId, outputType: 'research' }); assert.equal(external.view.research!.id, (lookup.data as { id: string }).id);
    const mapped = await execute('map.fromEvidence', { evidence: { ...(lookup.data as object), map: { label: 'Attacker', latitude: 0, longitude: 0, zoom: 2 } } });
    assert.equal((mapped.data as { latitude: number }).latitude, 41.4, 'browser/model replacement coordinates have no authority');
    const shown = await execute('presentation.show', { handleId: mapped.handleId, outputType: 'map' }); assert.equal(shown.view.map!.approximate, true);
    session = await store.read(session.id, index.space.publication); const handle = session.evidence.find(value => value.handle.id === lookup.handleId)!; handle.handle.expiresAt = '2000-01-01'; await store.save(session, session.revision);
    await assert.rejects(() => execute('map.fromEvidence', { evidence: lookup.data }), /stale/);
    let entered!: () => void, release!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    const registry = new Map(visitorCapabilities), original = registry.get('records.lookup')!;
    registry.set('records.lookup', { ...original, execute: async (...args) => { entered(); await pending; return original.execute(...args); } });
    session = await store.read(session.id, index.space.publication);
    const delayed = executeVisitorCapability({ sessionId: session.id, index, store, registry, signal: new AbortController().signal, assertCurrent: async () => {}, call: { capabilityId: 'records.lookup', input: { recordIds: ['record-00001'] }, operationId: randomUUID(), expectedRevision: session.revision } });
    await started; session = await store.read(session.id, index.space.publication); session.generation++; await store.save(session, session.revision); release();
    await assert.rejects(delayed, /superseded/); session = await store.read(session.id, index.space.publication); assert.equal(session.tasks.at(-1)!.status, 'cancelled');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('synthetic appointment race across visitors commits once and status does not repeat the mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-booking-race-'));
  try {
    const documents = localTaskDocuments(directory), a = new SyntheticVisitorAdapter(documents, 'visitor-a', new Map(), Date.now, 'shared-calendar'), b = new SyntheticVisitorAdapter(documents, 'visitor-b', new Map(), Date.now, 'shared-calendar');
    const draftA = await a.prepareBooking('fixture-slot-0'), draftB = await b.prepareBooking('fixture-slot-0');
    const opA = randomUUID(), opB = randomUUID();
    const results = await Promise.allSettled([a.confirm('booking', draftA.id, draftA.payloadHash, opA), b.confirm('booking', draftB.id, draftB.payloadHash, opB)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const before = await documents.read('shared-calendar'); await a.status(opA); await b.status(opB); assert.deepEqual(await documents.read('shared-calendar'), before);
    assert.equal((await a.availability()).length, 2);
    const winner = results[0].status === 'fulfilled' ? a : b, draft = results[0].status === 'fulfilled' ? draftA : draftB, op = results[0].status === 'fulfilled' ? opA : opB;
    await assert.rejects(() => winner.confirm('booking', draft.id, '0'.repeat(64), op), /Conflicting/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('brief, reading list and itinerary schemas preserve edited authorized entries and escape exports', () => {
  for (const kind of ['brief', 'reading-list', 'itinerary'] as const) {
    const artifact = visitorArtifactSchema.parse({ version: 2, id: 'artifact', revision: 0, publication: taskFixture().publication, kind, title: '<script>not markup</script>', notes: 'Visitor notes', saved: true, entries: [{ recordId: 'record-00001', title: 'Published record', summary: 'Approved summary', note: 'My preference' }] });
    assert.match(artifactMarkdown(artifact), /\\<script\\>/); assert.match(artifactMarkdown(artifact), /Approved summary/);
    assert.equal(artifact.kind, kind);
  }
  assert.equal(visitorArtifactSchema.safeParse({ kind: 'itinerary', timeZone: 'Invented/Zone' }).success, false);
});
test('invalid schemas, unsupported capabilities and concurrent state fail before execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-capability-race-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory));
    const session = await store.create(index.space.publication); let calls = 0;
    const registry = new Map(visitorCapabilities), original = registry.get('query.create')!;
    registry.set('query.create', { ...original, execute: async (...args) => { calls++; return original.execute(...args); } });
    const operationId = randomUUID(), run = (capabilityId = 'query.create', input: unknown = {}) => executeVisitorCapability({ sessionId: session.id, index, store, registry, signal: new AbortController().signal, assertCurrent: async () => {}, call: { operationId, capabilityId, expectedRevision: 0, input } });
    await assert.rejects(() => run('unapproved.checkout'), /not enabled/); await assert.rejects(() => run('query.create', { endpoint: 'untrusted' })); assert.equal(calls, 0);
    const results = await Promise.allSettled([run(), run()]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(calls, 1);
    await assert.rejects(() => run('query.create', { scope: {} }), /Conflicting/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('synthetic quotes invalidate on edits/expiry; duplicate confirmation and timeout reconciliation have one effect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-synthetic-'));
  try {
    let now = Date.now(); const adapter = new SyntheticVisitorAdapter(localTaskDocuments(directory), 'synthetic', new Map([['a', 1000], ['b', 2000], ['c', 3000]]), () => now);
    for (const record of ['a', 'b', 'c']) await adapter.cart(record, 1);
    const quote = await adapter.quote('fixture-delivery'); assert.deepEqual([quote.subtotalMinor, quote.taxMinor, quote.deliveryMinor, quote.totalMinor], [6000, 495, 500, 6995]);
    await adapter.cart('a', 2); await assert.rejects(() => adapter.confirm('order', quote.id, quote.payloadHash, randomUUID()), /changed|expired/);
    const expired = await adapter.quote('fixture-pickup'); now += 60_001; await assert.rejects(() => adapter.confirm('order', expired.id, expired.payloadHash, randomUUID()), /expired/);
    const fresh = await adapter.quote('fixture-pickup'), op = randomUUID();
    await assert.rejects(() => adapter.confirm('order', fresh.id, fresh.payloadHash, op, 'after'), /after commit/);
    const receipt = await adapter.status(op); assert.equal(receipt!.totalMinor, 7578);
    assert.deepEqual(await adapter.confirm('order', fresh.id, fresh.payloadHash, op), receipt);
    assert.equal((await adapter.state()).receipts.length, 1);
    const slot = (await adapter.availability())[0], booking = await adapter.prepareBooking(slot.id), bookingOp = randomUUID();
    await adapter.confirm('booking', booking.id, booking.payloadHash, bookingOp);
    await assert.rejects(() => adapter.prepareBooking(slot.id), /no longer/);
    assert.equal((await adapter.state()).occupied.length, 1);
    assert.deepEqual(await adapter.confirm('booking', booking.id, booking.payloadHash, randomUUID()), await adapter.status(bookingOp));
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('clarification retains current criteria and completes only as a needs-input state after display', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-clarify-'));
  try {
    const index = compileQueryIndex(taskFixture()), store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(index.space.publication); buildVisitorTaskView({ index, session, signal: new AbortController().signal }); session = await store.save(session, session.revision);
    const where = session.queries[0].current.where;
    const result = await executeVisitorCapability({ sessionId: session.id, store, index, signal: new AbortController().signal, assertCurrent: async () => {}, call: { operationId: randomUUID(), expectedRevision: session.revision, capabilityId: 'task.clarify', input: { question: 'Which reviewed quantity do you mean?', options: ['Duration', 'Word count'] } } });
    assert.deepEqual(result.view.query.where, where); assert.equal(result.view.clarification!.options.length, 2);
    session = await acknowledgeTaskDisplay(store, session.id, index.space.publication, { operationId: result.view.operationId!, queryId: result.view.query.queryId, queryRevision: result.view.query.revision, resultSetId: result.view.result.resultSetId, sceneRevision: 1, recordIds: result.view.records.map(record => record.id) });
    assert.equal(session.tasks.at(-1)!.status, 'needsClarification');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
