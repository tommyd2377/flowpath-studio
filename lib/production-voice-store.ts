import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { ACCOUNT_SESSION_COLLECTION, activeAccountSession } from './production-account-session';
import { VOICE_SESSION_SECONDS } from './voice-config';
import { isPublicVoiceOwner, PUBLIC_VOICE_SECONDS } from './public-voice-identity';
import { demoBudgets, type DemoBudgets } from './demo-budget';

export type VoicePolicy = {
  ownerDailySeconds: number; globalDailySeconds: number; globalConcurrency: number;
  access: 'signed-in' | 'invite-only'; allowedUids: string[];
  publicDemoSeconds?: number;
  demoBudgets?: DemoBudgets;
  /** Set only by the validated full localhost runtime, never by browser input. */
  unmeteredAdminTesting?: boolean;
};
export type AdminVoice = { uid: string; accountSessionId: string; override: boolean; previousSessionId?: string; deadline?: number; unmeteredLocal?: true };
// Wire/storage compatibility marker; no timer or independent task is scheduled for these local calls.
export const UNMETERED_LOCAL_DEADLINE = Number.MAX_SAFE_INTEGER;
export const isUnmeteredLocalTest = (owner: VoiceOwner, policy: VoicePolicy) => policy.unmeteredAdminTesting === true
  && owner.kind === undefined && owner.admin?.override === true && owner.admin.uid === owner.ownerUid;
export type VoiceOwner = { ownerUid: string; waveformId: string; accountSessionId: string; kind?: 'visitor'; admin?: AdminVoice;
  demoVisitorId?: string; contentDigest?: string;
  paid?: { actor: { visitorId: string; uid?: string; accountSessionId?: string }; choice: 'creator' | 'self'; expectedContentDigest?: string } };
export type StoredVoice = VoiceOwner & {
  id: string; state: 'creating' | 'active' | 'uncertain' | 'closed' | 'rejected';
  createdAt: number; expiresAt: number; canceled: boolean; providerId?: string; seconds?: number;
  /** Cleanup-only ownership. Expiry permits another closer, never a new provider or released usage. */
  cleanup?: { epoch: number; until: number };
};
export const VOICE_CLEANUP_LEASE_MS = 20_000;
export type VoiceTransaction = {
  get(path: string): Promise<Record<string, unknown> | null>;
  set(path: string, value: object): void;
};
export type VoiceDatabase = { transaction<T>(work: (tx: VoiceTransaction) => Promise<T>): Promise<T> };
export class VoiceAdmissionError extends Error {
  constructor(message: string, readonly status = 409, readonly normalLimit = status === 402) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const globalPath = 'voiceAdmission/global';
const adminPath = (uid: string) => `voiceAdminOwners/${hash(uid)}`;
const ownerPath = (uid: string) => `voiceOwners/${hash(uid)}`;
const callPath = (id: string) => `voiceConversations/${id}`;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const day = (now: number) => new Date(now).toISOString().slice(0, 10);
const reserved = (row: Record<string, unknown>, now: number) => row.day === day(now) ? count(row.reservedSeconds) : 0;
const active = (row: Record<string, unknown>) => object(row.active);
function validateDemoGuard(row: Record<string, unknown> | null, capacity: boolean) {
  if (!row) return;
  if (typeof row.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)
    || !Number.isSafeInteger(row.reservedSeconds) || Number(row.reservedSeconds) < 0
    || capacity && (!row.active || typeof row.active !== 'object' || Array.isArray(row.active)
      || Object.values(row.active).some(state => !['creating', 'active', 'uncertain'].includes(String(state))))) throw new VoiceAdmissionError('Demo allowance is unavailable.', 503);
}
function stored(row: Record<string, unknown> | null): StoredVoice | null {
  if (!row) return null;
  if (['id', 'ownerUid', 'waveformId', 'accountSessionId'].some(key => typeof row[key] !== 'string' || !row[key])
    || !['creating', 'active', 'uncertain', 'closed', 'rejected'].includes(String(row.state))
    || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)
    || typeof row.expiresAt !== 'number' || !Number.isFinite(row.expiresAt) || typeof row.canceled !== 'boolean'
    || row.providerId !== undefined && (typeof row.providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(row.providerId))) {
    throw new Error('Invalid durable voice record');
  }
  if (row.admin !== undefined) {
    const admin = object(row.admin);
    if (typeof admin.uid !== 'string' || !admin.uid || typeof admin.accountSessionId !== 'string' || !admin.accountSessionId
      || typeof admin.override !== 'boolean' || typeof admin.deadline !== 'number' || !Number.isFinite(admin.deadline)
      || admin.deadline < row.expiresAt || (admin.unmeteredLocal === true
        ? admin.override !== true || admin.deadline !== UNMETERED_LOCAL_DEADLINE || row.expiresAt !== UNMETERED_LOCAL_DEADLINE
        : admin.unmeteredLocal !== undefined || admin.deadline > row.createdAt + VOICE_SESSION_SECONDS * 1000)) throw new Error('Invalid durable admin record');
  }
  if (row.cleanup !== undefined) {
    const cleanup = object(row.cleanup);
    if (!Number.isSafeInteger(cleanup.epoch) || Number(cleanup.epoch) < 1
      || !Number.isSafeInteger(cleanup.until) || Number(cleanup.until) < 0) throw new Error('Invalid cleanup ownership');
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
  const budgets = demoBudgets(env, { dailySeconds: globalDailySeconds, concurrency: globalConcurrency });
  if (!budgets) return null;
  return { ownerDailySeconds, globalDailySeconds, globalConcurrency, access: access as VoicePolicy['access'], allowedUids,
    ...(env.FLOWPATH_PUBLIC_DEMO_ENABLED === '1' ? { publicDemoSeconds: PUBLIC_VOICE_SECONDS, demoBudgets: budgets } : {}) };
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
export function createProductionVoiceStore(database: VoiceDatabase, now: () => number = Date.now,
  previousPaidCall?: (tx: VoiceTransaction, id: string) => Promise<StoredVoice | null>,
  activePaidCall?: (tx: VoiceTransaction, uid: string) => Promise<boolean>,
  assertContentAllowed?: (tx: VoiceTransaction, owner: VoiceOwner) => Promise<void>) {
  function check(owner: VoiceOwner, policy: VoicePolicy, auth: Record<string, unknown> | null,
    global: Record<string, unknown>, own: Record<string, unknown>) {
    const seconds = owner.admin?.override ? Math.min(VOICE_SESSION_SECONDS, Math.ceil(((owner.admin.deadline ?? now() + VOICE_SESSION_SECONDS * 1000) - now()) / 1000)) : voiceReservationSeconds(owner, policy);
    const visitor = isPublicVoiceOwner(owner);
    if (!visitor && !activeAccountSession(auth, owner.ownerUid, now())) throw new VoiceAdmissionError('Sign in again to continue.', 403);
    if (!visitor && policy.access === 'invite-only' && !policy.allowedUids.includes(owner.ownerUid)) {
      throw new VoiceAdmissionError('Voice access is currently by invitation.', 403);
    }
    if (Object.values(active(global)).includes('uncertain')) throw new VoiceAdmissionError('A previous voice connection needs confirmed cleanup.', 503);
    if (own.active) throw new VoiceAdmissionError('Your previous conversation must close before starting another.');
    const unmetered = isUnmeteredLocalTest(owner, policy);
    if (!unmetered && Object.keys(active(global)).length >= policy.globalConcurrency) throw new VoiceAdmissionError('All available voice connections are in use.');
    if (!unmetered && reserved(global, now()) + seconds > policy.globalDailySeconds) {
      const remainingMinutes = Math.floor(Math.max(0, policy.globalDailySeconds - reserved(global, now())) / 60);
      throw new VoiceAdmissionError(owner.admin?.override
        ? `Today's shared test limit has ${remainingMinutes} minutes left. Starting this conversation needs a ${Math.ceil(seconds / 60)}-minute block, even if you end early.`
        : 'The shared daily voice limit has been reached. Please try again tomorrow.', 429);
    }
    if (!owner.admin?.override && reserved(own, now()) + seconds > (visitor ? seconds : policy.ownerDailySeconds)) {
      throw new VoiceAdmissionError(visitor
        ? 'Your three-minute demo allowance has ended. Please try again tomorrow.'
        : 'The daily voice allowance has been reached.', 429, true);
    }
  }
  async function admission(tx: VoiceTransaction, owner: VoiceOwner, policy: VoicePolicy) {
    if (owner.paid) throw new VoiceAdmissionError('Paid sessions require the paid admission store.', 403);
    let seconds = voiceReservationSeconds(owner, policy);
    const [auth, global, own, adminAuth, previousRow, adminOwner, paidActive] = await Promise.all([
      isPublicVoiceOwner(owner) ? Promise.resolve(null) : tx.get(`${ACCOUNT_SESSION_COLLECTION}/${owner.accountSessionId}`),
      tx.get(globalPath), tx.get(ownerPath(owner.ownerUid)),
      owner.admin ? tx.get(`${ACCOUNT_SESSION_COLLECTION}/${owner.admin.accountSessionId}`) : Promise.resolve(null),
      owner.admin?.previousSessionId ? tx.get(callPath(owner.admin.previousSessionId)).then(async row => row ?? await previousPaidCall?.(tx, owner.admin!.previousSessionId!) ?? null) : Promise.resolve(null),
      owner.admin ? tx.get(adminPath(owner.admin.uid)) : Promise.resolve(null),
      owner.admin ? activePaidCall?.(tx, owner.admin.uid) ?? Promise.resolve(false) : Promise.resolve(false),
    ]);
    let admin: AdminVoice | undefined;
    if (owner.admin) {
      if (adminOwner?.active || paidActive) throw new VoiceAdmissionError('Your previous conversation must close before starting another.');
      if (!activeAccountSession(adminAuth, owner.admin.uid, now())) throw new VoiceAdmissionError('Sign in again to continue as admin.', 403);
      const unmetered = isUnmeteredLocalTest(owner, policy);
      let deadline = unmetered ? UNMETERED_LOCAL_DEADLINE : now() + VOICE_SESSION_SECONDS * 1000;
      if (owner.admin.previousSessionId) {
        const previous = stored(previousRow);
        if (!owner.admin.override || !previous || previous.state !== 'closed'
          || previous.admin?.uid !== owner.admin.uid || previous.admin.accountSessionId !== owner.admin.accountSessionId
          || previous.ownerUid !== owner.ownerUid || previous.waveformId !== owner.waveformId
          || !Number.isFinite(previous.admin.deadline)) throw new VoiceAdmissionError('The previous conversation must close before continuing as admin.', 409);
        deadline = unmetered ? UNMETERED_LOCAL_DEADLINE : Math.min(previous.admin.deadline!, deadline);
      }
      if (deadline <= now()) throw new VoiceAdmissionError('The overall 15-minute conversation limit has been reached.', 429);
      admin = { ...owner.admin, deadline, ...(unmetered ? { unmeteredLocal: true as const } : {}) };
      if (admin.override) seconds = Math.min(VOICE_SESSION_SECONDS, Math.ceil((deadline - now()) / 1000));
    }
    validateGuards(global, own);
    check({ ...owner, ...(admin ? { admin } : {}) }, policy, auth, global ?? {}, own ?? {});
    if (!isPublicVoiceOwner(owner)) await assertContentAllowed?.(tx, owner);
    const demo = !owner.admin?.override && isPublicVoiceOwner(owner) && owner.demoVisitorId ? {
      budgetPath: 'voiceDemoBudgets/studio', visitorPath: `voiceDemoVisitors/${hash(owner.demoVisitorId)}`,
      budget: policy.demoBudgets?.studio ?? { dailySeconds: policy.globalDailySeconds, concurrency: policy.globalConcurrency, visitorDailySeconds: 180 },
    } : null;
    let demoGlobal: Record<string, unknown> | null = null, demoVisitor: Record<string, unknown> | null = null;
    if (demo) {
      const b = demo.budget;
      if (!Number.isSafeInteger(b.dailySeconds) || b.dailySeconds < 0 || b.dailySeconds > policy.globalDailySeconds
        || !Number.isSafeInteger(b.concurrency) || b.concurrency < 1 || b.concurrency > policy.globalConcurrency
        || !Number.isSafeInteger(b.visitorDailySeconds) || b.visitorDailySeconds < 0 || b.visitorDailySeconds > 180) throw new VoiceAdmissionError('Demo limits are unavailable.', 503);
      [demoGlobal, demoVisitor] = await Promise.all([tx.get(demo.budgetPath), tx.get(demo.visitorPath)]);
      validateDemoGuard(demoGlobal, true); validateDemoGuard(demoVisitor, false);
      if (reserved(demoGlobal ?? {}, now()) + seconds > demo.budget.dailySeconds
        || Object.keys(active(demoGlobal ?? {})).length >= demo.budget.concurrency) throw new VoiceAdmissionError('The public demo budget is currently unavailable.', 429);
      if (reserved(demoVisitor ?? {}, now()) + seconds > demo.budget.visitorDailySeconds) throw new VoiceAdmissionError('Your three-minute demo allowance has ended. Please try again tomorrow.', 429, true);
    }
    return { global: global ?? {}, own: own ?? {}, seconds, admin, demo, demoGlobal, demoVisitor };
  }
  async function finish(id: string, result: { finalized: boolean; seconds?: number; rejected?: boolean; providerId?: string; cleanupEpoch?: number }) {
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
      // A prior in-memory controller or expired worker cannot settle after cleanup takes ownership.
      if (call.cleanup && (result.cleanupEpoch !== call.cleanup.epoch || call.cleanup.until <= now())
        || !call.cleanup && result.cleanupEpoch !== undefined) throw new Error('Cleanup ownership changed');
      if (call.cleanup && (result.providerId !== call.providerId || result.rejected)) throw new Error('Cleanup requires matching provider finalization');
      const demo = call.demoVisitorId ? await tx.get('voiceDemoBudgets/studio') : null;
      validateDemoGuard(demo, true);
      const [global, own, adminOwner] = await Promise.all([tx.get(globalPath), tx.get(ownerPath(call.ownerUid)),
        call.admin ? tx.get(adminPath(call.admin.uid)) : Promise.resolve(null)]);
      validateGuards(global, own);
      const slots = { ...active(global ?? {}) };
      if (result.finalized) delete slots[id]; else slots[id] = 'uncertain';
      tx.set(callPath(id), {
        ...call, state: result.finalized ? result.rejected ? 'rejected' : 'closed' : 'uncertain',
        ...(result.providerId ? { providerId: result.providerId } : {}),
        ...(result.finalized && !result.rejected ? { seconds: result.seconds } : {}),
      });
      tx.set(globalPath, { ...global, active: slots });
      if (demo) { const demoSlots = { ...active(demo) }; if (result.finalized) delete demoSlots[id]; else demoSlots[id] = 'uncertain'; tx.set('voiceDemoBudgets/studio', { ...demo, active: demoSlots }); }
      if (call.admin && adminOwner?.active === id && result.finalized) tx.set(adminPath(call.admin.uid), { active: null });
      if (own?.active === id && result.finalized) tx.set(ownerPath(call.ownerUid), { ...own, active: null });
    });
  }
  return {
    async claimCleanup(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || !call.canceled || !call.providerId || call.state === 'closed' || call.state === 'rejected'
          || call.cleanup && call.cleanup.until > now()) return null;
        const epoch = (call.cleanup?.epoch ?? 0) + 1;
        if (!Number.isSafeInteger(epoch)) throw new Error('Cleanup epoch exhausted');
        const cleanup = { epoch, until: now() + VOICE_CLEANUP_LEASE_MS };
        tx.set(callPath(id), { ...call, cleanup });
        return { ...call, cleanup };
      });
    },
    async available(owner: VoiceOwner, policy: VoicePolicy) {
      await database.transaction(async tx => { await admission(tx, owner, policy); });
    },
    async reserve(owner: VoiceOwner, id: string, policy: VoicePolicy) {
      return database.transaction(async tx => {
        const previous = await tx.get(callPath(id));
        if (previous) throw new VoiceAdmissionError('This conversation identifier has already been used.');
        const { global, own, seconds, admin, demo, demoGlobal, demoVisitor } = await admission(tx, owner, policy);
        const call: StoredVoice = {
          ...owner, ...(admin ? { admin } : {}), id, state: 'creating', createdAt: now(),
          expiresAt: admin?.unmeteredLocal ? UNMETERED_LOCAL_DEADLINE : Math.min(now() + seconds * 1000, admin?.deadline ?? Infinity), canceled: false,
        };
        tx.set(callPath(id), call);
        if (admin) tx.set(adminPath(admin.uid), { active: id });
        tx.set(globalPath, { day: day(now()), reservedSeconds: reserved(global, now()) + seconds, active: { ...active(global), [id]: 'creating' } });
        tx.set(ownerPath(owner.ownerUid), { day: day(now()), reservedSeconds: reserved(own, now()) + seconds, active: id });
        if (demo) {
          tx.set(demo.budgetPath, { day: day(now()), reservedSeconds: reserved(demoGlobal ?? {}, now()) + seconds, active: { ...active(demoGlobal ?? {}), [id]: 'creating' } });
          tx.set(demo.visitorPath, { day: day(now()), reservedSeconds: reserved(demoVisitor ?? {}, now()) + seconds });
        }
        return call;
      });
    },
    async created(id: string, providerId: string, expiresAt: number) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!/^[A-Za-z0-9_-]{1,200}$/.test(providerId) || !call || !['creating', 'uncertain'].includes(call.state)
          || call.providerId && call.providerId !== providerId || call.expiresAt !== expiresAt) throw new Error('Voice reservation is no longer creating');
        const global = await tx.get(globalPath);
        validateGuards(global, null);
        if (!global || !['creating', 'uncertain'].includes(String(active(global)[id]))) throw new Error('Missing voice admission slot');
        // A deadline/worker may have run before the creation response arrived. Keep its ID for cleanup.
        const uncertain = call.state === 'uncertain' || call.expiresAt <= now();
        const state = uncertain ? 'uncertain' : 'active';
        tx.set(callPath(id), { ...call, providerId, state });
        tx.set(globalPath, { ...global, active: { ...active(global), [id]: state } });
        return call.canceled || uncertain;
      });
    },
    async mayStart(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || call.state !== 'creating' || call.canceled || call.expiresAt <= now()) return false;
        if (call.admin && !activeAccountSession(await tx.get(`${ACCOUNT_SESSION_COLLECTION}/${call.admin.accountSessionId}`), call.admin.uid, now())) return false;
        if (isPublicVoiceOwner(call)) return true;
        await assertContentAllowed?.(tx, call);
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
    async cancel(ownerUid: string, waveformId: string | undefined, id?: string, accountSessionId?: string, kind?: 'visitor', policy?: VoicePolicy, demoVisitorId?: string) {
      if (demoVisitorId !== undefined && !/^[a-f0-9]{64}$/.test(demoVisitorId)) throw new VoiceAdmissionError('Invalid demo identity.', 403);
      if (kind !== undefined && !isPublicVoiceOwner({ ownerUid, waveformId, accountSessionId, kind })) {
        throw new VoiceAdmissionError('Invalid public voice identity.', 403);
      }
      return database.transaction(async tx => {
        const own = await tx.get(ownerPath(ownerUid));
        const adminOwner = !id && !waveformId ? await tx.get(adminPath(ownerUid)) : null;
        const target = id ?? (typeof own?.active === 'string' ? own.active : typeof adminOwner?.active === 'string' ? adminOwner.active : undefined);
        if (!target) return null;
        const call = stored(await tx.get(callPath(target)));
        if (!call) {
          if (id && waveformId && accountSessionId) {
            // Cancellation may beat the POST on another instance. Keep a tombstone.
            const canceled: StoredVoice = {
              id, ownerUid, waveformId, accountSessionId, state: 'rejected', canceled: true, createdAt: now(), expiresAt: now(),
              ...(kind ? { kind } : {}),
              ...(demoVisitorId ? { demoVisitorId } : {}),
            };
            if (kind === 'visitor') {
              if (!policy || typeof policy.publicDemoSeconds !== 'number' || !Number.isSafeInteger(policy.publicDemoSeconds)
                || policy.publicDemoSeconds < 1 || policy.publicDemoSeconds > VOICE_SESSION_SECONDS) return null;
              // An anonymous pre-cancel is a bounded attempt, just like creation.
              const allowance = await admission(tx, canceled, policy);
              if (allowance.demo) {
                tx.set(allowance.demo.budgetPath, { day: day(now()), reservedSeconds: reserved(allowance.demoGlobal ?? {}, now()) + allowance.seconds, active: active(allowance.demoGlobal ?? {}) });
                tx.set(allowance.demo.visitorPath, { day: day(now()), reservedSeconds: reserved(allowance.demoVisitor ?? {}, now()) + allowance.seconds });
              }
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
        if (call.ownerUid !== ownerUid && !(waveformId === undefined && call.admin?.uid === ownerUid) || waveformId && call.waveformId !== waveformId) throw new VoiceAdmissionError('This conversation belongs to another waveform.', 403);
        if (call.state === 'closed' || call.state === 'rejected') return call;
        tx.set(callPath(target), { ...call, canceled: true });
        return { ...call, canceled: true };
      });
    },
    finish,
  };
}

// Paid fixture adapters do not opt into hosted cleanup; missing support must fail closed.
export type ProductionVoiceStore = Omit<ReturnType<typeof createProductionVoiceStore>, 'claimCleanup'>
  & Partial<Pick<ReturnType<typeof createProductionVoiceStore>, 'claimCleanup'>>;

export function firestoreVoiceDatabase(db: () => Firestore): VoiceDatabase {
  return {
    transaction: work => db().runTransaction(async transaction => work({
      async get(path) { const row = await transaction.get(db().doc(path)); return row.exists ? row.data()! : null; },
      set(path, value) { transaction.set(db().doc(path), value); },
    })),
  };
}
