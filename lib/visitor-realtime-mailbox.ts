import 'server-only';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { AppError } from './errors';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import { slugSchema } from './site-store';
import { VISITOR_SESSION_MS } from './visitor-realtime';
import { visitorControlCapabilitySchema, visitorControlSchema, type VisitorControlCapability, type VisitorControlUpdate } from './visitor-realtime-context';

const MAX_UPDATES = 300;
const WINDOW_MS = 1000;
const WINDOW_UPDATES = 8;
const metadataSchema = z.object({
  slug: slugSchema, siteId: z.string().uuid(), publicationKey: z.string().min(1).max(256),
  expiresAt: z.number().int().positive(),
}).strict();
const recordSchema = metadataSchema.extend({
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  count: z.number().int().min(0).max(MAX_UPDATES),
  windowAt: z.number().int().nonnegative(), windowCount: z.number().int().min(0).max(MAX_UPDATES),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), update: visitorControlSchema.nullable(),
});
export type VisitorMailboxRecord = z.infer<typeof recordSchema>;
export type VisitorMailboxBackend = {
  create: (id: string, record: VisitorMailboxRecord) => Promise<void>;
  update: (id: string, transition: (value: unknown) => VisitorMailboxRecord | null) => Promise<void>;
  subscribe: (id: string, next: (value: unknown) => void, error: (error: Error) => void) => () => void;
  delete: (id: string) => Promise<void>;
  pruneExpired: (now: number, maximum: number) => Promise<void>;
};
type Dependencies = { backend?: VisitorMailboxBackend; now?: () => number };
export type VisitorRealtimeMailbox = {
  capability: VisitorControlCapability;
  subscribe: (onUpdate: (update: VisitorControlUpdate) => void | Promise<void>, onError: (error: Error) => void) => () => void;
  close: () => Promise<void>;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const inactive = () => new AppError('The voice session is no longer active.', 410);

/** Exact-document listeners and existing-only transactions work across Firebase workers. */
export function createFirestoreVisitorMailboxBackend(db: Firestore): VisitorMailboxBackend {
  const collection = db.collection('voiceVisitorRealtime');
  return {
    async create(id, record) { await collection.doc(id).create(record); },
    async update(id, transition) {
      const ref = collection.doc(id);
      await db.runTransaction(async transaction => {
        const next = transition((await transaction.get(ref)).data());
        if (next) transaction.update(ref, next);
      }, { maxAttempts: 3 });
    },
    subscribe(id, next, error) { return collection.doc(id).onSnapshot(snapshot => next(snapshot.data()), error); },
    async delete(id) { await collection.doc(id).delete(); },
    async pruneExpired(now, maximum) {
      const expired = await collection.where('expiresAt', '<=', now).limit(maximum).get();
      // Expiry is immutable; a precondition also protects against a concurrent deletion.
      await Promise.allSettled(expired.docs.map(record => record.ref.delete({ lastUpdateTime: record.updateTime })));
    },
  };
}

/** The localhost demo is explicitly single-process, like its existing local store. */
function createLocalBackend(): VisitorMailboxBackend {
  const records = new Map<string, VisitorMailboxRecord>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const notify = (id: string) => {
    const value = structuredClone(records.get(id));
    for (const next of listeners.get(id) ?? []) queueMicrotask(() => next(value));
  };
  return {
    async create(id, record) {
      if (records.size >= 64 || records.has(id)) throw new AppError('Voice is temporarily busy.', 503);
      records.set(id, structuredClone(record));
    },
    async update(id, transition) {
      // The transition is synchronous, so no other local update can interleave.
      const next = transition(structuredClone(records.get(id)));
      if (next) { records.set(id, structuredClone(next)); notify(id); }
    },
    subscribe(id, next) {
      const set = listeners.get(id) ?? new Set(); listeners.set(id, set); set.add(next);
      queueMicrotask(() => { if (set.has(next)) next(structuredClone(records.get(id))); });
      return () => { set.delete(next); if (!set.size) listeners.delete(id); };
    },
    async delete(id) { records.delete(id); notify(id); },
    async pruneExpired(now, maximum) {
      let removed = 0;
      for (const [id, record] of records) if (record.expiresAt <= now && removed++ < maximum) { records.delete(id); notify(id); }
    },
  };
}
function backend() {
  if (getBackendMode() === 'firebase') return createFirestoreVisitorMailboxBackend(getFirestore(getFirebaseAdminApp()));
  const state = globalThis as typeof globalThis & { visitorLocalMailbox?: VisitorMailboxBackend };
  return state.visitorLocalMailbox ??= createLocalBackend();
}

export async function createVisitorRealtimeMailbox(options: z.infer<typeof metadataSchema>, dependencies: Dependencies = {}): Promise<VisitorRealtimeMailbox> {
  const metadata = metadataSchema.parse(options);
  const now = dependencies.now ?? Date.now;
  if (metadata.expiresAt <= now() || metadata.expiresAt > now() + VISITOR_SESSION_MS + 30_000) throw inactive();
  const store = dependencies.backend ?? backend();
  // No TTL policy or scheduler is assumed. Crash leftovers are invalid after expiry.
  await store.pruneExpired(now(), 8).catch(() => undefined);
  const capability = { id: randomUUID(), token: randomBytes(32).toString('base64url') };
  const tokenHash = digest(capability.token);
  await store.create(capability.id, { ...metadata, tokenHash, count: 0, windowAt: now(), windowCount: 0, inputHash: null, update: null });
  let closed = false;
  let closing: Promise<void> | undefined;
  const subscriptions = new Set<() => void>();
  const failures = new Set<(error: Error) => void>();
  const expiryTimer = setTimeout(() => {
    for (const fail of [...failures]) fail(inactive());
    void close().catch(() => undefined);
  }, Math.max(1, metadata.expiresAt - now()));
  function close() {
    if (!closing) {
      closed = true; clearTimeout(expiryTimer);
      for (const stop of [...subscriptions]) stop();
      closing = store.delete(capability.id);
    }
    return closing;
  }
  return {
    capability,
    close,
    subscribe(onUpdate, onError) {
      if (closed) { onError(inactive()); return () => {}; }
      let stopped = false, busy = false, sequence = 0;
      let pending: VisitorControlUpdate | undefined;
      let unsubscribe = () => {};
      function stop() {
        if (stopped) return;
        stopped = true; pending = undefined; unsubscribe(); subscriptions.delete(stop); failures.delete(fail);
      }
      function fail(error: Error) { if (!stopped) { stop(); onError(error); } }
      async function deliver() {
        if (busy || stopped || closed) return;
        busy = true;
        try {
          while (pending && !stopped && !closed) {
            const update = pending; pending = undefined;
            await onUpdate(update);
          }
        } catch { fail(new AppError('Voice control was interrupted. Start a new conversation.', 503)); }
        finally { busy = false; }
      }
      subscriptions.add(stop); failures.add(fail);
      try {
        unsubscribe = store.subscribe(capability.id, value => {
          if (stopped || closed) return;
          try {
            const record = recordSchema.parse(value);
            if (record.tokenHash !== tokenHash || record.slug !== metadata.slug || record.siteId !== metadata.siteId
              || record.publicationKey !== metadata.publicationKey || record.expiresAt !== metadata.expiresAt || now() >= record.expiresAt) throw inactive();
            if (!record.update || record.update.seq <= sequence) return;
            sequence = record.update.seq;
            // Only the newest desired state is needed while the owner applies an update.
            pending = record.update; void deliver();
          } catch { fail(inactive()); }
        }, () => fail(new AppError('Voice control was interrupted. Start a new conversation.', 503)));
        if (stopped) unsubscribe();
      } catch { fail(new AppError('Voice control was interrupted. Start a new conversation.', 503)); }
      return stop;
    },
  };
}

/** Called by any worker; it stores app state only and never invokes the provider. */
export async function submitVisitorRealtimeControl(slug: string, control: VisitorControlCapability, value: VisitorControlUpdate, dependencies: Dependencies = {}) {
  slugSchema.parse(slug);
  const capability = visitorControlCapabilitySchema.parse(control);
  const parsed = visitorControlSchema.parse(value);
  const encoded = JSON.stringify(parsed);
  if (Buffer.byteLength(encoded) > 64 * 1024) throw new AppError('The voice control update is too large.', 413);
  const update = JSON.parse(encoded) as VisitorControlUpdate;
  const inputHash = digest(encoded), tokenHash = digest(capability.token);
  const now = dependencies.now ?? Date.now;
  await (dependencies.backend ?? backend()).update(capability.id, value => {
    const result = recordSchema.safeParse(value);
    if (!result.success) throw inactive();
    const record = result.data;
    if (!timingSafeEqual(Buffer.from(tokenHash, 'hex'), Buffer.from(record.tokenHash, 'hex')) || record.slug !== slug) throw new AppError('This voice control request is not authorized.', 403);
    const timestamp = now();
    if (timestamp >= record.expiresAt) throw inactive();
    const previous = record.update;
    if (update.seq === previous?.seq && inputHash === record.inputHash) return null;
    if (previous?.end) throw inactive();
    if (previous && (update.seq <= previous.seq || update.interactionRevision < previous.interactionRevision)) throw new AppError('A newer visitor action is already active.', 409);
    // Reserve the final accepted update for a deliberate end command.
    if (record.count >= MAX_UPDATES || !update.end && record.count >= MAX_UPDATES - 1) throw new AppError('This conversation has reached its control limit.', 429);
    const windowAt = timestamp - record.windowAt >= WINDOW_MS ? timestamp : record.windowAt;
    const windowCount = windowAt === record.windowAt ? record.windowCount : 0;
    if (!update.end && windowCount >= WINDOW_UPDATES) throw new AppError('Voice controls are moving too quickly. Start a new conversation.', 429);
    const navigationAck = update.navigationAck ?? previous?.navigationAck;
    return { ...record, count: record.count + 1, windowAt, windowCount: windowCount + 1, inputHash,
      update: { ...update, ready: !!previous?.ready || update.ready, end: !!previous?.end || !!update.end, ...(navigationAck ? { navigationAck } : {}) } };
  });
}
