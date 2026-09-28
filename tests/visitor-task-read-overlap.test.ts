import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { taskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { buildVisitorTaskView } from '../lib/visitor-capabilities';
import { VisitorTaskStore, confirmVisitorView } from '../lib/visitor-task-store';
import type { TaskDocuments } from '../lib/task-persistence';

async function fixture() {
  const records = new Map<string, unknown>(), reads: string[] = [];
  let writes = 0;
  const value = (key: string) => structuredClone(records.get(key) ?? null);
  let load = async (key: string) => value(key);
  const documents: TaskDocuments = {
    read: async key => { reads.push(key); return load(key); },
    create: async (key, entry) => { assert.equal(records.has(key), false); records.set(key, structuredClone(entry)); writes++; },
    compareAndSwap: async (key, revision, entry) => {
      if ((records.get(key) as { revision?: number } | undefined)?.revision !== revision) throw new Error('State changed in another request. Reload.');
      records.set(key, structuredClone(entry)); writes++;
    },
  };
  const space = taskFixture(), store = new VisitorTaskStore(documents);
  let session = await store.create(space.publication);
  const view = buildVisitorTaskView({ index: compileQueryIndex(space), session, signal: new AbortController().signal });
  session.activeQueryId = view.query.queryId;
  session.scene = { operationId: randomUUID(), queryId: view.query.queryId, queryRevision: view.query.revision, resultSetId: view.result.resultSetId, sceneRevision: 1, recordIds: view.records.map(record => record.id) };
  confirmVisitorView(session); session = await store.save(session, session.revision);
  await store.observeViewport(session, { ...session.scene!, sceneRevision: 2, recordIds: ['record-00003', 'record-00004'], ready: true, generation: session.generation });
  delete session.viewport;
  reads.length = 0;
  return { records, reads, value, store, session, publication: space.publication, sceneKey: `scene-${session.id}`, writes: () => writes,
    loader: (next: typeof load) => { load = next; }, read: () => store.read(session.id, space.publication, { viewport: 'parallel' }),
  };
}

test('resumed task reads session and viewport concurrently without another read or write', async t => {
  const f = await fixture(), main = Promise.withResolvers<void>(), scene = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.loader(async key => { const value = f.value(key); (key === f.session.id ? main : scene).resolve(); await release.promise; return value; });
  const writes = f.writes(), reading = f.read();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; release.resolve(); }, 1000);
  try {
    await Promise.all([main.promise, scene.promise]);
    assert.equal(timedOut, false, 'Both reads must start before either document returns');
    assert.deepEqual(f.reads, [f.session.id, f.sceneKey]);
    release.resolve();
    const result = await reading;
    assert.deepEqual(result.viewport?.recordIds, ['record-00003', 'record-00004']);
    assert.equal(f.reads.length, 2); assert.equal(f.writes(), writes);
  } finally { clearTimeout(timer); release.resolve(); }
  f.loader(async key => { await new Promise(resolve => setTimeout(resolve, 30)); return f.value(key); });
  let started = performance.now(); await f.store.read(f.session.id, f.publication); const sequential = performance.now() - started;
  started = performance.now(); await f.read(); const parallel = performance.now() - started;
  t.diagnostic(`Synthetic 30ms document latency: sequential ${sequential.toFixed(1)}ms; overlapping ${parallel.toFixed(1)}ms. Two reads in both cases; not a live benchmark.`);
});

test('scene identity and generation validation rejects every mismatched parallel result', async () => {
  for (const change of [
    { operationId: randomUUID() }, { generation: 1 }, { sceneRevision: 0 },
    { queryId: 'different-query' }, { queryRevision: 1 }, { resultSetId: 'different-result-set' },
  ]) {
    const f = await fixture();
    f.records.set(f.sceneKey, { ...f.value(f.sceneKey) as object, ...change });
    const result = await f.read();
    assert.deepEqual(result.viewport, f.session.scene, JSON.stringify(change));
  }
  const f = await fixture();
  f.records.set(f.sceneKey, { ...f.value(f.sceneKey) as object, ready: false });
  assert.equal((await f.read()).viewport, null, 'An unsettled current viewport gives no visible ordinal authority');
});

test('a newer session cannot inherit an older viewport captured by the overlapping read', async () => {
  const f = await fixture(), requested = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.loader(async key => {
    if (key === f.session.id) { requested.resolve(); await release.promise; }
    return f.value(key);
  });
  const reading = f.read(); await requested.promise;
  const current = structuredClone(f.session); current.generation++; current.revision++;
  current.scene = { ...current.scene!, operationId: randomUUID(), sceneRevision: 3, recordIds: ['record-00005'] };
  f.records.set(current.id, current); release.resolve();
  const result = await reading;
  assert.equal(result.generation, current.generation);
  assert.deepEqual(result.viewport, current.scene, 'The old scene must fall back to the newer session\'s acknowledged base');
});

test('an older session read cannot gain newer viewport authority or overwrite a concurrent update', async () => {
  const f = await fixture(), started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  f.loader(async key => {
    if (key === f.session.id) { const old = f.value(key); started.resolve(); await release.promise; return old; }
    await release.promise; return f.value(key);
  });
  const reading = f.read(); await started.promise;
  const current = structuredClone(f.session); current.generation++; current.revision++;
  current.scene = { ...current.scene!, operationId: randomUUID(), sceneRevision: 3, recordIds: ['record-00005'] };
  f.records.set(current.id, current);
  f.records.set(f.sceneKey, { ...current.scene, revision: 1, generation: current.generation, ready: true });
  release.resolve();
  const stale = await reading;
  assert.deepEqual(stale.viewport, f.session.scene, 'No mix of prior query state and a newer display');
  await assert.rejects(f.store.save(stale, stale.revision), /State changed/);
  assert.deepEqual(f.records.get(current.id), current);
});

test('publication, expiry, missing and failed scene checks retain their existing boundaries', async () => {
  const f = await fixture(), writes = f.writes();
  await assert.rejects(f.store.read(f.session.id, { ...f.publication, revisionId: 'new-publication' }, { viewport: 'parallel' }), /Publication changed/);
  f.records.delete(f.sceneKey);
  assert.deepEqual((await f.read()).viewport, f.session.scene);
  f.loader(async key => { if (key === f.sceneKey) throw new Error('Scene storage unavailable'); return f.value(key); });
  await assert.rejects(f.read(), /Scene storage unavailable/);
  const expired = structuredClone(f.session); expired.touchedAt -= 31 * 60_000; f.records.set(expired.id, expired);
  await assert.rejects(f.read(), /Visitor session expired/);
  f.records.set(f.session.id, { ...f.session, scene: null });
  assert.equal((await f.read()).viewport, null, 'Unused scene failures do not break a session without display authority');
  assert.equal(f.writes(), writes);
});

test('receipt-only and ordinary no-scene reads never prefetch a viewport', async () => {
  const f = await fixture();
  const result = await f.store.read(f.session.id, f.publication, { viewport: false });
  assert.equal(result.viewport, null); assert.deepEqual(f.reads, [f.session.id]);
  f.reads.length = 0; f.records.set(f.session.id, { ...f.session, scene: null });
  assert.equal((await f.store.read(f.session.id, f.publication)).viewport, null);
  assert.deepEqual(f.reads, [f.session.id]);
  f.reads.length = 0;
  await assert.rejects(f.store.read('invalid-id', f.publication, { viewport: 'parallel' }));
  assert.equal(f.reads.length, 0);
});
