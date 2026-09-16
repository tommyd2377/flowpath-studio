import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { VisitorTaskStore } from '../lib/visitor-task-store';
import { localTaskDocuments } from '../lib/task-persistence';
import { acknowledgeTaskDisplay, observeTaskScene, executeVisitorCapability, buildVisitorTaskView } from '../lib/visitor-capabilities';

test('actual source migration preserves edited records, structure and rejected memberships across source updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-remigration-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const { newSite, uploadFile, getSite } = await import('../lib/site-store');
    const { analyzeKnowledge, applyKnowledge } = await import('../lib/ingestion');
    const { POST } = await import('../app/api/sites/[siteId]/collections/route');
    const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
    let site = await newSite(user, { name: 'Source migration', slug: 'source-migration', kind: 'general' });
    const source = async (text: string) => {
      const file = { id: randomUUID(), name: 'catalog.csv', mime: 'text/csv', size: Buffer.byteLength(text), kind: 'text' as const, uploadedAt: new Date().toISOString(), data: Buffer.from(text).toString('base64'), text };
      site = await uploadFile(user, site.id, site.revision, file);
      const result = await analyzeKnowledge(user, site.id, { fileId: file.id, revision: site.revision, requestId: randomUUID() });
      site = (await applyKnowledge(user, site.id, { candidateId: result.candidates[0].id, revision: site.revision })).site;
    };
    const request = async (input: unknown, expected = 200) => {
      const response = await POST(new Request('http://127.0.0.1:3225/api', { method: 'POST', headers: { origin: 'http://127.0.0.1:3225', 'content-type': 'application/json' }, body: JSON.stringify(input) }), { params: Promise.resolve({ siteId: site.id }) });
      const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
    };
    await source('ID,Name,Price [USD]\none,One,10\ntwo,Two,20');
    let page = await request({ action: 'migrate', siteRevision: site.revision });
    const recordId = page.records.find((record: { name: string }) => record.name === 'One').id;
    const member = page.memberships.find((member: { recordId: string }) => member.recordId === recordId);
    const edit = async (input: unknown) => { page = await request({ action: 'edit', reviewId: page.review.id, revision: page.review.revision, ...(input as object) }); };
    await edit({ patch: { id: recordId, name: 'Publisher correction' } });
    await edit({ membership: { ...member, included: false } });
    await edit({ metadata: { ...page.review.metadata, name: 'Reviewed collection name', collections: page.review.metadata.collections.map((collection: { id: string; name: string }) => collection.id === page.review.metadata.rootId ? { ...collection, name: 'Reviewed root' } : collection) } });
    site = (await request({ action: 'apply', reviewId: page.review.id, revision: page.review.revision, siteRevision: site.revision })).site;
    const manifest = site.draft.catalogPublicationId;
    await source('ID,Name,Price [USD]\none,One,15\ntwo,Two,25\nthree,Three,30');
    assert.equal(site.draft.catalogPublicationId, manifest, 'source Apply does not bypass the separate collection review');
    const previousReviewId = page.review.id;
    for (const explicit of [false, true]) {
      page = await request({ action: 'migrate', siteRevision: site.revision, ...(explicit ? { previousReviewId: page.review.id } : {}) });
      const corrected = page.records.find((record: { id: string }) => record.id === recordId);
      assert.equal(corrected.name, 'Publisher correction');
      assert.ok(corrected.assertions.some((fact: { value: { value: unknown } | null }) => fact.value?.value === 15), 'uncorrected source values refresh');
      assert.ok(page.records.some((record: { name: string }) => record.name === 'Three'));
      assert.equal(page.review.metadata.name, 'Reviewed collection name');
      assert.equal(page.review.metadata.collections.find((collection: { id: string }) => collection.id === page.review.metadata.rootId).name, 'Reviewed root');
      assert.equal(page.memberships.some((value: { recordId: string; collectionId: string }) => value.recordId === member.recordId && value.collectionId === member.collectionId), false);
    }
    await request({ action: 'migrate', siteRevision: site.revision - 1 }, 409);
    const other = await newSite(user, { name: 'Other site', slug: 'other-migration', kind: 'general' });
    const originalSite = site; site = other;
    await source('ID,Name,Price [USD]\nother,Other,5');
    await request({ action: 'migrate', siteRevision: site.revision, previousReviewId }, 409);
    assert.equal((await getSite(user, originalSite.id)).draft.catalogPublicationId, manifest);
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('viewport observations reject stale ordinals and evidence without changing task revisions or display receipts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'task-viewport-'));
  try {
    const index = compileQueryIndex(taskFixture()), publication = index.space.publication, store = new VisitorTaskStore(localTaskDocuments(directory));
    let session = await store.create(publication);
    buildVisitorTaskView({ session, index, signal: new AbortController().signal }); session = await store.save(session, session.revision);
    const execute = async (capabilityId: string, input: unknown, bindings?: { input: string; handleId: string; outputType: string }[]) => {
      session = await store.read(session.id, publication);
      return executeVisitorCapability({ sessionId: session.id, store, index, signal: new AbortController().signal, assertCurrent: async () => {}, call: { capabilityId, input, bindings, operationId: randomUUID(), expectedRevision: session.revision } });
    };
    const displayed = await execute('query.activate', { queryId: session.queries[0].current.queryId });
    const ack = { operationId: displayed.view.operationId!, queryId: displayed.view.query.queryId, queryRevision: displayed.view.query.revision, resultSetId: displayed.view.result.resultSetId, sceneRevision: 1, recordIds: ['record-00000', 'record-00001'] };
    await acknowledgeTaskDisplay(store, session.id, publication, ack);
    session = await store.read(session.id, publication);
    const initialRevision = session.revision, receiptCount = session.receipts.length;
    await observeTaskScene(store, session.id, publication, { ...ack, generation: session.generation, sceneRevision: 2, recordIds: [], ready: false });
    session = await store.read(session.id, publication); assert.equal(session.viewport, null); assert.equal(session.revision, initialRevision); assert.equal(session.receipts.length, receiptCount);
    const reference = { ordinal: 1, resultSetId: ack.resultSetId, visible: true, sceneRevision: 1 };
    await assert.rejects(() => execute('reference.resolve', reference), /scene changed/);
    const observed = { ...ack, generation: session.generation, sceneRevision: 3, recordIds: ['record-00005', 'record-00006'], ready: true };
    await observeTaskScene(store, session.id, publication, observed);
    const result = await execute('reference.resolve', { ...reference, sceneRevision: 3 });
    assert.equal((result.data as { id: string }[])[0].id, 'record-00005');
    await assert.rejects(() => execute('reference.resolve', reference), /scene changed/);
    await assert.rejects(() => observeTaskScene(store, session.id, publication, { ...observed, sceneRevision: 2 }), /stale/);
    await assert.rejects(() => observeTaskScene(store, session.id, publication, { ...observed, sceneRevision: 4, recordIds: ['invented'] }), /does not match/);
    await observeTaskScene(store, session.id, publication, { ...observed, sceneRevision: 4, recordIds: ['record-00007'] });
    await acknowledgeTaskDisplay(store, session.id, publication, ack);
    assert.deepEqual((await store.read(session.id, publication)).viewport?.recordIds, ['record-00007'], 'duplicate completion ACK cannot rewind the viewport');
    await assert.rejects(() => execute('records.filter', { records: [], where: { kind: 'all', id: 'all', children: [] } }, [{ input: 'records', handleId: result.handleId, outputType: 'records' }]), /stale/);
    await execute('home', {});
    await assert.rejects(() => observeTaskScene(store, session.id, publication, { ...observed, sceneRevision: 5 }), /does not match/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
