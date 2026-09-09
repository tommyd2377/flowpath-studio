import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../lib/errors';
import { createFirestoreVisitorMailboxBackend, createVisitorRealtimeMailbox, submitVisitorRealtimeControl, type VisitorMailboxRecord } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlUpdate } from '../lib/visitor-realtime-context';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const update = (seq: number, extras: Partial<VisitorControlUpdate> = {}): VisitorControlUpdate => ({ seq, interactionRevision: 0, viewRevision: 0, ready: false, context: {}, ...extras });
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

/** Separate adapters share this fake database, never an application-worker map. */
function fixture() {
  let clock = Date.now(), writes = 0, deletes = 0;
  let queue = Promise.resolve();
  const records = new Map<string, VisitorMailboxRecord>();
  const watchers = new Map<string, Set<{ next: (value: unknown) => void; error: (error: Error) => void }>>();
  const publish = (id: string) => {
    const value = structuredClone(records.get(id));
    for (const listener of watchers.get(id) ?? []) queueMicrotask(() => listener.next({ data: () => value }));
  };
  const ref = (id: string) => ({
    id,
    async create(value: VisitorMailboxRecord) { assert.ok(!records.has(id)); records.set(id, structuredClone(value)); writes++; },
    async delete() { records.delete(id); deletes++; publish(id); },
    onSnapshot(next: (value: unknown) => void, error: (error: Error) => void) {
      const listener = { next, error }, set = watchers.get(id) ?? new Set(); watchers.set(id, set); set.add(listener);
      queueMicrotask(() => { if (set.has(listener)) next({ data: () => structuredClone(records.get(id)) }); });
      return () => { set.delete(listener); };
    },
  });
  const db = {
    collection(name: string) {
      assert.equal(name, 'voiceVisitorRealtime');
      return { doc: ref, where(field: string, operation: string, until: number) {
        assert.equal(field, 'expiresAt'); assert.equal(operation, '<=');
        return { limit(maximum: number) { assert.equal(maximum, 8); return { async get() {
          return { docs: [...records].filter(([, value]) => value.expiresAt <= until).slice(0, maximum).map(([id]) => ({ ref: ref(id), updateTime: 1 })) };
        } }; } };
      } };
    },
    runTransaction(operation: (transaction: unknown) => Promise<void>, options: { maxAttempts: number }) {
      assert.equal(options.maxAttempts, 3);
      const result = queue.then(async () => {
        let pending: { id: string; value: VisitorMailboxRecord } | undefined;
        await operation({
          async get(reference: { id: string }) { return { data: () => structuredClone(records.get(reference.id)) }; },
          update(reference: { id: string }, value: VisitorMailboxRecord) { assert.ok(records.has(reference.id)); pending = { id: reference.id, value }; },
        });
        if (pending) { records.set(pending.id, structuredClone(pending.value)); writes++; publish(pending.id); }
      });
      queue = result.catch(() => undefined); return result;
    },
  } as unknown as Firestore;
  const owner = { backend: createFirestoreVisitorMailboxBackend(db), now: () => clock };
  const worker = { backend: createFirestoreVisitorMailboxBackend(db), now: () => clock };
  const metadata = () => ({ slug: 'synthetic-site', siteId: randomUUID(), publicationKey: 'synthetic-publication-hash', expiresAt: clock + 120_000 });
  return { records, watchers, owner, worker, metadata, writes: () => writes, deletes: () => deletes, advance: (ms: number) => { clock += ms; } };
}

test('independent Firebase workers deliver bounded reference state, sticky readiness, and view revisions without storing the capability', async t => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner); t.after(() => box.close());
  const seen: VisitorControlUpdate[] = [], errors: Error[] = [];
  box.subscribe(value => { seen.push(value); }, error => errors.push(error));
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(1, { ready: true, viewRevision: 4, navigationAck: { id: 'server-action', status: 'applied' } }), f.worker);
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(2, { interactionRevision: 2, viewRevision: 1 }), f.worker);
  await flush();
  assert.deepEqual(seen.map(value => [value.seq, value.ready, value.viewRevision]), [[1, true, 4], [2, true, 1]]);
  assert.deepEqual(seen.at(-1)?.navigationAck, { id: 'server-action', status: 'applied' });
  assert.deepEqual(errors, []);
  const stored = JSON.stringify(f.records.get(box.capability.id));
  assert.ok(!stored.includes(box.capability.token)); assert.ok(!stored.includes('transcript')); assert.ok(!stored.includes('history'));
  const writes = f.writes();
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(2, { interactionRevision: 2, viewRevision: 1 }), f.worker);
  assert.equal(f.writes(), writes);
});

test('auth, slug, expiry, stale sequences and interaction revisions fail before writes; concurrent workers cannot roll state back', async t => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner); t.after(() => box.close());
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', { ...box.capability, token: 'x'.repeat(43) }, update(1), f.worker), status(403));
  await assert.rejects(submitVisitorRealtimeControl('another-site', box.capability, update(1), f.worker), status(403));
  const outcomes = await Promise.allSettled([
    submitVisitorRealtimeControl('synthetic-site', box.capability, update(2, { interactionRevision: 2 }), f.worker),
    submitVisitorRealtimeControl('synthetic-site', box.capability, update(1), f.worker),
  ]);
  assert.equal(outcomes[0].status, 'fulfilled'); assert.equal(outcomes[1].status, 'rejected');
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(2, { ready: true }), f.worker), status(409));
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(3, { interactionRevision: 1 }), f.worker), status(409));
  assert.equal(f.records.get(box.capability.id)?.update?.seq, 2);
  f.advance(120_000);
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(3, { interactionRevision: 3 }), f.worker), status(410));
  assert.equal(f.writes(), 2);
});

test('burst and total caps reserve capacity for End; ended records cannot reopen', async t => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner); t.after(() => box.close());
  for (let seq = 1; seq <= 8; seq++) await submitVisitorRealtimeControl('synthetic-site', box.capability, update(seq), f.worker);
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(9), f.worker), status(429));
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(10, { end: true }), f.worker);
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(11), f.worker), status(410));
  const limited = await createVisitorRealtimeMailbox(f.metadata(), f.owner); t.after(() => limited.close());
  for (let seq = 1; seq <= 299; seq++) {
    if (seq % 8 === 0) f.advance(1000);
    await submitVisitorRealtimeControl('synthetic-site', limited.capability, update(seq), f.worker);
  }
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', limited.capability, update(300), f.worker), status(429));
  await submitVisitorRealtimeControl('synthetic-site', limited.capability, update(301, { end: true }), f.worker);
  assert.equal(f.records.get(limited.capability.id)?.count, 300);
});

test('a slow owner receives latest desired state without an unbounded delivery queue, and close suppresses late callbacks', async () => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const seen: number[] = [];
  box.subscribe(async value => { seen.push(value.seq); if (value.seq === 1) await waiting; }, assert.fail);
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(1), f.worker);
  await flush();
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(2), f.worker);
  await submitVisitorRealtimeControl('synthetic-site', box.capability, update(3), f.worker);
  await flush(); assert.deepEqual(seen, [1]);
  release(); await flush(); assert.deepEqual(seen, [1, 3]);
  await box.close(); await box.close(); assert.equal(f.deletes(), 1);
  assert.equal(f.watchers.get(box.capability.id)?.size, 0);
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, update(4), f.worker), status(410));
  await flush(); assert.deepEqual(seen, [1, 3]);
});

test('listener errors are sanitized and unsubscribe once; expired leftovers are cleaned in a bounded batch', async () => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner);
  const errors: Error[] = [];
  box.subscribe(() => assert.fail('Unexpected mailbox update.'), error => errors.push(error)); await flush();
  for (const listener of [...f.watchers.get(box.capability.id)!]) listener.error(new Error('private transport details'));
  assert.equal(errors.length, 1); assert.ok(!errors[0].message.includes('private')); assert.equal(f.watchers.get(box.capability.id)?.size, 0);
  const record = f.records.get(box.capability.id)!; await box.close();
  for (let i = 0; i < 12; i++) f.records.set(randomUUID(), { ...record, expiresAt: 1 });
  const next = await createVisitorRealtimeMailbox(f.metadata(), f.owner);
  assert.equal(f.records.size, 5); await next.close();
});

test('fixed expiry notifies the owner, removes its listener and deletes the record', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner);
  const errors: Error[] = [];
  box.subscribe(() => assert.fail('Unexpected mailbox update.'), error => errors.push(error));
  f.advance(120_000); t.mock.timers.tick(120_000); await flush();
  assert.equal(errors.length, 1); assert.equal(f.records.has(box.capability.id), false);
  assert.equal(f.watchers.get(box.capability.id)?.size, 0);
  await box.close(); assert.equal(f.deletes(), 1);
});

test('unknown command fields, stored metadata corruption and invalid creation deadlines fail closed', async t => {
  const f = fixture(), box = await createVisitorRealtimeMailbox(f.metadata(), f.owner); t.after(() => box.close());
  await assert.rejects(submitVisitorRealtimeControl('synthetic-site', box.capability, { ...update(1), history: [{ text: 'never store this' }] } as VisitorControlUpdate, f.worker));
  assert.equal(f.writes(), 1);
  await assert.rejects(createVisitorRealtimeMailbox({ ...f.metadata(), expiresAt: 1 }, f.owner), status(410));
  await assert.rejects(createVisitorRealtimeMailbox({ ...f.metadata(), expiresAt: Date.now() + 60 * 60_000 }, f.owner), status(410));
  const errors: Error[] = [];
  f.records.get(box.capability.id)!.publicationKey = 'different-publication';
  box.subscribe(() => assert.fail('Unexpected mailbox update.'), error => errors.push(error)); await flush();
  assert.equal(errors.length, 1);
});
