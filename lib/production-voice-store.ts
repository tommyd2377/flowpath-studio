import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ACCOUNT_SESSION_COLLECTION, activeAccountSession } from './production-account-session';
import { VOICE_SESSION_SECONDS } from './voice-config';
import { isPublicVoiceOwner, PUBLIC_VOICE_SECONDS } from './public-voice-identity';

export type VoicePolicy = {
  ownerDailySeconds: number; globalDailySeconds: number; globalConcurrency: number;
  access: 'signed-in' | 'invite-only'; allowedUids: string[];
  publicDemoSeconds?: number;
};
export type VoiceOwner = { ownerUid: string; waveformId: string; accountSessionId: string; kind?: 'visitor' };
export type StoredVoice = VoiceOwner & {
  id: string; state: 'creating' | 'active' | 'uncertain' | 'closed' | 'rejected';
  createdAt: number; expiresAt: number; canceled: boolean; providerId?: string; seconds?: number;
};
export type VoiceTransaction = {
  get(path: string): Promise<Record<string, unknown> | null>;
  set(path: string, value: object): void;
};
export type VoiceDatabase = { transaction<T>(work: (tx: VoiceTransaction) => Promise<T>): Promise<T> };
export class VoiceAdmissionError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const globalPath = 'voiceAdmission/global';
const ownerPath = (uid: string) => `voiceOwners/${hash(uid)}`;
const callPath = (id: string) => `voiceConversations/${id}`;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const reserved = (row: Record<string, unknown>, now: number) => row.day === day(now) ? count(row.reservedSeconds) : 0;
const active = (row: Record<string, unknown>) => object(row.active);
function stored(row: Record<string, unknown> | null): StoredVoice | null {
  if (!row) return null;
  if (['id', 'ownerUid', 'waveformId', 'accountSessionId'].some(key => typeof row[key] !== 'string' || !row[key])
    || !['creating', 'active', 'uncertain', 'closed', 'rejected'].includes(String(row.state))
    || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)
    || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt) || typeof row.canceled !== 'boolean'
    || row.providerId !== undefined && (typeof row.providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(row.providerId))) {
    throw new Error('Invalid durable voice record');
  }
  if (row.kind !== undefined && !isPublicVoiceOwner(row)) throw new Error('Invalid durable voice record');
  return row as StoredVoice;
}
function validateGuards(global: Record<string, unknown> | null, own: Record<string, unknown> | null) {
  for (const row of [global, own]) {
    if (row && (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
      || typeof row.reservedSeconds !== 'number' || !Number.isSafeInteger(row.reservedSeconds) || row.reservedSeconds < 0)) {
      throw new Error('Invalid voice allowance');
    }
  }
  if (global && (!global.active || typeof global.active !== 'object' || Array.isArray(global.active)
    || Object.values(global.active).some(state => !['creating', 'active', 'uncertain'].includes(String(state))))
    || own && own.active !== null && (typeof own.active !== 'string' || !own.active)) throw new Error('Invalid voice admission state');
}

export function productionVoicePolicy(env: Record<string, string | undefined>): VoicePolicy | null {
  const integer = (key: string) => /^\d+$/.test(env[key] ?? '') ? Number(env[key]) : 0;
  const ownerDailySeconds = integer('FLOWPATH_VOICE_OWNER_DAILY_SECONDS');
  const globalDailySeconds = integer('FLOWPATH_VOICE_GLOBAL_DAILY_SECONDS');
  const globalConcurrency = integer('FLOWPATH_VOICE_GLOBAL_CONCURRENCY');
  const access = env.FLOWPATH_VOICE_ACCESS;
  const allowedUids = (env.FLOWPATH_VOICE_ALLOWED_UIDS ?? '').split(',').map(uid => uid.trim()).filter(Boolean);
  if (env.FLOWPATH_LIVE_ENABLED !== '1' || !Number.isSafeInteger(ownerDailySeconds)
    || !Number.isSafeInteger(globalDailySeconds) || ownerDailySeconds < VOICE_SESSION_SECONDS
    || globalDailySeconds < VOICE_SESSION_SECONDS || globalConcurrency < 1 || globalConcurrency > 20
    || !['signed-in', 'invite-only'].includes(access ?? '') || access === 'invite-only' && !allowedUids.length) return null;
  return { ownerDailySeconds, globalDailySeconds, globalConcurrency, access: access as VoicePolicy['access'], allowedUids,
    ...(env.FLOWPATH_PUBLIC_DEMO_ENABLED === '1' ? { publicDemoSeconds: PUBLIC_VOICE_SECONDS } : {}) };
}

export function voiceReservationSeconds(owner: VoiceOwner, policy: VoicePolicy): number {
  if (owner.kind === undefined) return VOICE_SESSION_SECONDS;
  if (!isPublicVoiceOwner(owner)) throw new VoiceAdmissionError('Invalid public voice identity.', 403);
  const seconds = policy.publicDemoSeconds;
  if (typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > VOICE_SESSION_SECONDS) {
    throw new VoiceAdmissionError('The public voice demo is unavailable.', 503);
  }
  return seconds;
}

/** Reservations never expire automatically: uncertain calls need confirmed provider closure. */
export function createProductionVoiceStore(database: VoiceDatabase, now: () => number = Date.now) {
  function check(owner: VoiceOwner, policy: VoicePolicy, auth: Record<string, unknown> | null,
    global: Record<string, unknown>, own: Record<string, unknown>) {
    const seconds = voiceReservationSeconds(owner, policy);
    const visitor = isPublicVoiceOwner(owner);
    if (!visitor && !activeAccountSession(auth, owner.ownerUid, now())) throw new VoiceAdmissionError('Sign in again to continue.', 403);
    if (!visitor && policy.access === 'invite-only' && !policy.allowedUids.includes(owner.ownerUid)) {
      throw new VoiceAdmissionError('Voice access is currently by invitation.', 403);
    }
    if (Object.values(active(global)).includes('uncertain')) throw new VoiceAdmissionError('A previous voice connection needs confirmed cleanup.', 503);
    if (own.active) throw new VoiceAdmissionError('Your previous conversation must close before starting another.');
    if (Object.keys(active(global)).length >= policy.globalConcurrency) throw new VoiceAdmissionError('All available voice connections are in use.');
    if (reserved(own, now()) + seconds > (visitor ? seconds : policy.ownerDailySeconds)
      || reserved(global, now()) + seconds > policy.globalDailySeconds) {
      throw new VoiceAdmissionError('The daily voice allowance has been reached.', 429);
    }
  }
  async function admission(tx: VoiceTransaction, owner: VoiceOwner, policy: VoicePolicy) {
    const seconds = voiceReservationSeconds(owner, policy);
    const [auth, global, own] = await Promise.all([
      isPublicVoiceOwner(owner) ? Promise.resolve(null) : tx.get(`${ACCOUNT_SESSION_COLLECTION}/${owner.accountSessionId}`),
      tx.get(globalPath), tx.get(ownerPath(owner.ownerUid)),
    ]);
    validateGuards(global, own);
    check(owner, policy, auth, global ?? {}, own ?? {});
    return { global: global ?? {}, own: own ?? {}, seconds };
  }
  async function finish(id: string, result: { finalized: boolean; seconds?: number; rejected?: boolean; providerId?: string }) {
    if (result.finalized && !result.rejected && (typeof result.seconds !== 'number' || !Number.isFinite(result.seconds) || result.seconds < 0)) {
      throw new Error('Confirmed final usage is required');
    }
    if (result.providerId !== undefined && (typeof result.providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(result.providerId))) {
      throw new Error('Invalid provider identifier');
    }
    await database.transaction(async tx => {
      const call = stored(await tx.get(callPath(id)));
      if (call?.providerId && result.providerId && call.providerId !== result.providerId) throw new Error('Provider identifier does not match');
      if (!call || call.state === 'closed' || call.state === 'rejected') return;
      const [global, own] = await Promise.all([tx.get(globalPath), tx.get(ownerPath(call.ownerUid))]);
      validateGuards(global, own);
      const slots = { ...active(global ?? {}) };
      if (result.finalized) delete slots[id]; else slots[id] = 'uncertain';
      tx.set(callPath(id), {
        ...call, state: result.finalized ? result.rejected ? 'rejected' : 'closed' : 'uncertain',
        ...(result.providerId ? { providerId: result.providerId } : {}),
        ...(result.finalized && !result.rejected ? { seconds: result.seconds } : {}),
      });
      tx.set(globalPath, { ...global, active: slots });
      if (own?.active === id && result.finalized) tx.set(ownerPath(call.ownerUid), { ...own, active: null });
    });
  }
  return {
    async available(owner: VoiceOwner, policy: VoicePolicy) {
      await database.transaction(async tx => { await admission(tx, owner, policy); });
    },
    async reserve(owner: VoiceOwner, id: string, policy: VoicePolicy) {
      return database.transaction(async tx => {
        const previous = await tx.get(callPath(id));
        if (previous) throw new VoiceAdmissionError('This conversation identifier has already been used.');
        const { global, own, seconds } = await admission(tx, owner, policy);
        const call: StoredVoice = {
          ...owner, id, state: 'creating', createdAt: now(), expiresAt: now() + seconds * 1000, canceled: false,
        };
        tx.set(callPath(id), call);
        tx.set(globalPath, { day: day(now()), reservedSeconds: reserved(global, now()) + seconds, active: { ...active(global), [id]: 'creating' } });
        tx.set(ownerPath(owner.ownerUid), { day: day(now()), reservedSeconds: reserved(own, now()) + seconds, active: id });
        return call;
      });
    },
    async created(id: string, providerId: string, expiresAt: number) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || call.state !== 'creating') throw new Error('Voice reservation is no longer creating');
        const global = await tx.get(globalPath);
        validateGuards(global, null);
        if (!global || active(global)[id] !== 'creating') throw new Error('Missing voice admission slot');
        tx.set(callPath(id), { ...call, providerId, expiresAt, state: 'active' });
        tx.set(globalPath, { ...global, active: { ...active(global ?? {}), [id]: 'active' } });
        return call.canceled;
      });
    },
    async mayStart(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || call.state !== 'creating' || call.canceled || call.expiresAt <= now()) return false;
        if (isPublicVoiceOwner(call)) return true;
        return activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${call.accountSessionId}`), call.ownerUid, now());
      });
    },
    async expire(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || call.state === 'closed' || call.state === 'rejected') return call;
        if (call.expiresAt > now()) throw new Error('Voice deadline has not arrived');
        const global = await tx.get(globalPath);
        validateGuards(global, null);
        const expired: StoredVoice = { ...call, canceled: true, state: call.providerId ? call.state : 'uncertain' };
        tx.set(callPath(id), expired);
        if (!call.providerId) tx.set(globalPath, { ...global, active: { ...active(global ?? {}), [id]: 'uncertain' } });
        return expired;
      });
    },
    async cancel(ownerUid: string, waveformId: string | undefined, id?: string, accountSessionId?: string, kind?: 'visitor', policy?: VoicePolicy) {
      if (kind !== undefined && !isPublicVoiceOwner({ ownerUid, waveformId, accountSessionId, kind })) {
        throw new VoiceAdmissionError('Invalid public voice identity.', 403);
      }
      return database.transaction(async tx => {
        const own = await tx.get(ownerPath(ownerUid));
        const target = id ?? (typeof own?.active === 'string' ? own.active : undefined);
        if (!target) return null;
        const call = stored(await tx.get(callPath(target)));
        if (!call) {
          if (id && waveformId && accountSessionId) {
            // Cancellation may beat the POST on another instance. Keep a tombstone.
            const canceled: StoredVoice = {
              id, ownerUid, waveformId, accountSessionId, state: 'rejected', canceled: true, createdAt: now(), expiresAt: now(),
              ...(kind ? { kind } : {}),
            };
            if (kind === 'visitor') {
              if (!policy || typeof policy.publicDemoSeconds !== 'number' || !Number.isSafeInteger(policy.publicDemoSeconds)
                || policy.publicDemoSeconds < 1 || policy.publicDemoSeconds > VOICE_SESSION_SECONDS) return null;
              // An anonymous pre-cancel is a bounded attempt, just like creation.
              const allowance = await admission(tx, canceled, policy);
              tx.set(globalPath, {
                day: day(now()), reservedSeconds: reserved(allowance.global, now()) + allowance.seconds,
                active: active(allowance.global),
              });
              tx.set(ownerPath(ownerUid), {
                day: day(now()), reservedSeconds: reserved(allowance.own, now()) + allowance.seconds, active: null,
              });
            }
            tx.set(callPath(id), canceled);
            return canceled;
          }
          return null;
        }
        if (call.ownerUid !== ownerUid || waveformId && call.waveformId !== waveformId) throw new VoiceAdmissionError('This conversation belongs to another waveform.', 403);
        if (call.state === 'closed' || call.state === 'rejected') return call;
        tx.set(callPath(target), { ...call, canceled: true });
        return { ...call, canceled: true };
      });
    },
    finish,
  };
}

export type ProductionVoiceStore = ReturnType<typeof createProductionVoiceStore>;

export function firestoreVoiceDatabase(db: () => Firestore): VoiceDatabase {
  return {
    transaction: work => db().runTransaction(async transaction => work({
      async get(path) { const row = await transaction.get(db().doc(path)); return row.exists ? row.data()! : null; },
      set(path, value) { transaction.set(db().doc(path), value); },
    })),
  };
}
