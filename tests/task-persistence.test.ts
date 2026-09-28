import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, type CollectionReference } from 'firebase-admin/firestore';
import { firestoreTaskDocuments } from '../lib/task-persistence';

function cloudFixture() {
  const records = new Map<string, { data: { revision: number; value: unknown }; time: Timestamp }>();
  const counts = { reads: 0, writes: 0, transactions: 0 };
  let clock = 1;
  const write = (key: string, data: { revision: number; value: unknown }) => {
    const time = Timestamp.fromMillis(clock++); records.set(key, { data: structuredClone(data), time }); counts.writes++;
    return { writeTime: time };
  };
  const doc = (key: string) => ({ key,
    get: async () => { counts.reads++; const record = records.get(key); return { data: () => structuredClone(record?.data), updateTime: record?.time }; },
    create: async (data: { revision: number; value: unknown }) => { assert.ok(!records.has(key)); return write(key, data); },
    update: async (data: { revision: number; value: unknown }, precondition: { lastUpdateTime: Timestamp }) => {
      const record = records.get(key);
      if (!record?.time.isEqual(precondition.lastUpdateTime)) throw Object.assign(new Error('Precondition failed'), { code: 9 });
      return write(key, data);
    },
  });
  const collection = { doc, firestore: { runTransaction: async (callback: (transaction: unknown) => Promise<void>) => {
    counts.transactions++;
    await callback({ get: (reference: ReturnType<typeof doc>) => reference.get(), set: (reference: ReturnType<typeof doc>, data: { revision: number; value: unknown }) => write(reference.key, data) });
  } } } as unknown as CollectionReference;
  return { collection, records, counts, write };
}

test('session CAS uses the exact read version without a transaction reread', async () => {
  const { collection, counts } = cloudFixture(), store = firestoreTaskDocuments(collection, true);
  await store.create('visitor-a', { revision: 0, title: 'Original' });
  assert.deepEqual(await store.read('visitor-a'), { revision: 0, title: 'Original' });
  const reads = counts.reads;
  await store.compareAndSwap('visitor-a', 0, { revision: 1, title: 'Updated' });
  await store.compareAndSwap('visitor-a', 1, { revision: 2, title: 'Updated again' });
  assert.equal(counts.reads, reads); assert.equal(counts.transactions, 0);
  assert.deepEqual(await store.read('visitor-a'), { revision: 2, title: 'Updated again' });
});

test('independent session writers cannot overwrite a newer edit or retry the failed write', async () => {
  const { collection, counts } = cloudFixture(), first = firestoreTaskDocuments(collection, true), second = firestoreTaskDocuments(collection, true);
  await first.create('visitor-a', { revision: 0 });
  await second.read('visitor-a');
  const results = await Promise.allSettled([first.compareAndSwap('visitor-a', 0, { revision: 1, source: 'first' }), second.compareAndSwap('visitor-a', 0, { revision: 1, source: 'second' })]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(counts.writes, 2); assert.equal(counts.transactions, 0);
  assert.deepEqual(await first.read('visitor-a'), { revision: 1, source: 'first' });
});

test('version tokens reject same-revision replacement, deletion and cross-visitor writes', async () => {
  for (const change of ['replacement', 'deletion', 'other-visitor']) {
    const { collection, records, write } = cloudFixture(), store = firestoreTaskDocuments(collection, true);
    await store.create('visitor-a', { revision: 0, name: 'A' });
    await store.create('visitor-b', { revision: 0, name: 'B' });
    await store.read('visitor-a');
    if (change === 'deletion') records.delete('visitor-a');
    else write('visitor-a', { revision: 0, value: { revision: 0, name: 'New A' } });
    if (change === 'other-visitor') await store.read('visitor-b');
    await assert.rejects(store.compareAndSwap('visitor-a', 0, { revision: 1, name: 'Stale' }), /State changed/);
    assert.deepEqual(await store.read('visitor-b'), { revision: 0, name: 'B' });
    assert.notEqual((await store.read('visitor-a') as { name?: string } | null)?.name, 'Stale');
  }
});

test('uncached tokens and non-session namespaces preserve transactional CAS', async () => {
  const { collection, counts } = cloudFixture();
  const creator = firestoreTaskDocuments(collection, true), fresh = firestoreTaskDocuments(collection, true), original = firestoreTaskDocuments(collection);
  await creator.create('visitor-a', { revision: 0 });
  await fresh.compareAndSwap('visitor-a', 0, { revision: 1 });
  assert.equal(counts.transactions, 1);
  await original.read('visitor-a'); await original.compareAndSwap('visitor-a', 1, { revision: 2 });
  assert.equal(counts.transactions, 2);
  await assert.rejects(fresh.compareAndSwap('visitor-a', 0, { revision: 3 }), /State changed/);
  assert.deepEqual(await original.read('visitor-a'), { revision: 2 });
});
