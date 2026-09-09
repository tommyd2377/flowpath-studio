import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { initialSite, updateDraft, type StoredSite } from '../../lib/local-store';
import type { KnowledgeLedger } from '../../lib/knowledge-model';

type Document = Record<string, unknown>;
type Reference = { id: string; path: string };
const records = new Map<string, Document>();
const batches: string[][] = [];
const attemptedWrites: string[] = [];
let storageCalls = 0;
let externalCalls = 0;
function assertFirestoreValue(value: unknown): void {
  assert.notEqual(value, undefined, 'Firestore cannot persist an undefined value');
  if (value && typeof value === 'object') for (const nested of Object.values(value)) assertFirestoreValue(nested);
}
const database = {
  collection: (name: string) => ({ doc: (id: string): Reference => ({ id, path: `${name}/${id}` }) }),
  async runTransaction<T>(operation: (transaction: {
    get: (ref: Reference) => Promise<{ id: string; exists: boolean; data: () => Document | undefined }>;
    set: (ref: Reference, value: Document) => void;
  }) => Promise<T>, options: { maxAttempts: number }): Promise<T> {
    assert.equal(options.maxAttempts, 3);
    const staged = new Map<string, Document>();
    const result = await operation({
      async get(ref) {
        assert.equal(staged.size, 0, 'Firestore reads must precede every write');
        const value = structuredClone(records.get(ref.path));
        return { id: ref.id, exists: value !== undefined, data: () => structuredClone(value) };
      },
      set(ref, value) { assertFirestoreValue(value); attemptedWrites.push(ref.path); staged.set(ref.path, structuredClone(value)); },
    });
    // The fake commits only after the production transaction callback succeeds.
    for (const [path, value] of staged) records.set(path, value);
    batches.push([...staged.keys()]);
    return result;
  },
};

mock.module('firebase-admin/firestore', { cache: true, namedExports: { getFirestore: () => database } });
mock.module('firebase-admin/storage', { cache: true, namedExports: { getStorage: () => { storageCalls++; throw new Error('Storage is forbidden in this offline test.'); } } });
mock.module(new URL('../../lib/firebase/admin.ts', import.meta.url).href, { cache: true, namedExports: { getFirebaseAdminApp: () => ({ name: 'offline-fake-admin' }) } });
mock.method(globalThis, 'fetch', async () => { externalCalls++; throw new Error('Network is forbidden in this offline test.'); });
const { modifyCloudSite } = await import('../../lib/cloud-store');
const { changeKnowledgeLedger } = await import('../../lib/knowledge-store');

async function seed() {
  records.clear(); batches.length = 0; attemptedWrites.length = 0;
  const uid = 'offline-cloud-owner';
  const site = initialSite('general', 'Offline cloud fixture', 'offline-cloud-fixture', uid);
  const oldRevision = randomUUID(); const candidateRevision = randomUUID();
  site.revision = 7;
  site.draft.knowledgeRevisionId = oldRevision;
  site.published = structuredClone(site.draft);
  site.publishedAt = '2026-09-09T12:00:00.000Z';
  const job = { id: randomUUID(), operation: 'review' as const, sourceName: 'Saved knowledge', sourceHash: '', baseDraftHash: '',
    baseRevision: site.revision, status: 'running' as const, stage: 'review' as const, claim: randomUUID(),
    startedAt: 1, updatedAt: 1, message: 'Applying', candidateRevisionId: candidateRevision };
  const sitePath = `voiceSites/${site.id}`;
  const publicPath = `voicePublished/${site.slug}`;
  const publicKnowledgePath = `voiceKnowledgePublic/${site.id}-${oldRevision}`;
  records.set(sitePath, { ownerId: uid, state: JSON.stringify(site) });
  records.set(publicPath, { siteId: site.id, slug: site.slug, content: structuredClone(site.published), publishedAt: site.publishedAt, logo: null });
  records.set(publicKnowledgePath, { catalog: { id: oldRevision, name: 'Already published knowledge' } });
  await changeKnowledgeLedger({ uid, mode: 'firebase', email: null, displayName: null }, site.id, ledger => { ledger.jobs.push(job); });
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 1);
  const jobPath = batches[0][0];
  assert.ok(jobPath.startsWith('voiceKnowledgeJobs/'));
  batches.length = 0; attemptedWrites.length = 0;
  return { uid, site, job, oldRevision, candidateRevision, sitePath, jobPath, publicPath, publicKnowledgePath,
    claim: { jobId: job.id, claim: job.claim }, before: structuredClone(records) };
}

test('Apply commits the draft reference and applied job together, preserving public data and Undo', async () => {
  const state = await seed();
  const result = await modifyCloudSite(state.uid, state.site.id, state.site.revision,
    site => updateDraft(site, { ...site.draft, knowledgeRevisionId: state.candidateRevision }), state.claim);
  assert.deepEqual(batches, [[state.jobPath, state.sitePath]]);
  const stored = JSON.parse(records.get(state.sitePath)!.state as string) as StoredSite;
  const ledger = records.get(state.jobPath)!.ledger as KnowledgeLedger;
  assert.equal(stored.draft.knowledgeRevisionId, state.candidateRevision);
  assert.equal(result.revision, 8);
  assert.equal(stored.history.at(-1)?.knowledgeRevisionId, state.oldRevision);
  assert.equal(ledger.jobs[0].status, 'applied');
  assert.equal(ledger.jobs[0].appliedRevisionId, stored.draft.knowledgeRevisionId);
  assert.equal(stored.published?.knowledgeRevisionId, state.oldRevision);
  assert.deepEqual(records.get(state.publicPath), state.before.get(state.publicPath));
  assert.deepEqual(records.get(state.publicKnowledgePath), state.before.get(state.publicKnowledgePath));
});

test('a superseded claim rejects before the draft operation or any writes', async () => {
  const state = await seed(); let invoked = false;
  await assert.rejects(() => modifyCloudSite(state.uid, state.site.id, state.site.revision,
    () => { invoked = true; }, { ...state.claim, claim: randomUUID() }), /cancelled or superseded/);
  assert.equal(invoked, false); assert.deepEqual(attemptedWrites, []); assert.deepEqual(batches, []);
  assert.deepEqual(records, state.before);
});

test('a mismatched candidate rejects the operation without committing either document', async () => {
  const state = await seed();
  await assert.rejects(() => modifyCloudSite(state.uid, state.site.id, state.site.revision,
    site => updateDraft(site, { ...site.draft, knowledgeRevisionId: randomUUID() }), state.claim), /does not match/);
  assert.deepEqual(attemptedWrites, []); assert.deepEqual(batches, []); assert.deepEqual(records, state.before);
});

test('a cancelled job and a foreign owner ledger cannot authorize Apply', async () => {
  for (const change of ['cancelled', 'foreign-owner'] as const) {
    const state = await seed(); const record = records.get(state.jobPath)!;
    if (change === 'cancelled') (record.ledger as KnowledgeLedger).jobs[0].status = 'discarded';
    else record.ownerId = 'another-owner';
    const before = structuredClone(records); let invoked = false;
    await assert.rejects(() => modifyCloudSite(state.uid, state.site.id, state.site.revision,
      () => { invoked = true; }, state.claim), /cancelled or superseded/);
    assert.equal(invoked, false); assert.deepEqual(attemptedWrites, []); assert.deepEqual(batches, []);
    assert.deepEqual(records, before);
  }
});

test('a stale site revision rejects before applying an otherwise valid claim', async () => {
  const state = await seed(); let invoked = false;
  await assert.rejects(() => modifyCloudSite(state.uid, state.site.id, state.site.revision - 1,
    () => { invoked = true; }, state.claim), /site changed/);
  assert.equal(invoked, false); assert.deepEqual(attemptedWrites, []); assert.deepEqual(batches, []);
  assert.deepEqual(records, state.before);
});

test('all cloud persistence checks used mocks with no storage or external requests', () => {
  assert.equal(storageCalls, 0); assert.equal(externalCalls, 0);
});
