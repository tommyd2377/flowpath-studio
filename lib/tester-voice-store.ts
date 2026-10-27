import { createHash } from 'node:crypto';
import { activeAccountSession, ACCOUNT_SESSION_COLLECTION } from './production-account-session';
import { MEMBERS_COLLECTION } from './invitations';
import { isPublicVoiceOwner } from './public-voice-identity';
import { UNMETERED_LOCAL_DEADLINE, VOICE_CLEANUP_LEASE_MS, VoiceAdmissionError,
  type StoredVoice, type VoiceDatabase, type VoiceOwner, type VoiceTransaction } from './production-voice-store';

export const TESTER_DEMO_SECONDS = 180;
export const TESTER_HEARTBEAT_MS = 10_000;
export const TESTER_CONTROL_LEASE_MS = 45_000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const callPath = (id: string) => `voiceConversations/${id}`;
const ownPath = (uid: string) => `voiceTesterOwners/${hash(uid)}`;
const globalPath = 'voiceAdmission/global';
const slots = (row: Record<string, unknown> | null) => {
  const active = row?.active ?? {};
  if (!active || typeof active !== 'object' || Array.isArray(active)
    || Object.values(active).some(value => !['creating', 'active', 'uncertain'].includes(String(value)))) throw new Error('Invalid voice capacity');
  return { ...active as Record<string, string> };
};
const count = (value: unknown) => {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > TESTER_DEMO_SECONDS) throw new Error('Invalid tester allowance');
  return Number(value);
};
function stored(row: Record<string, unknown> | null): StoredVoice | null {
  if (!row || row.tombstone === true) return null;
  const call = row as unknown as StoredVoice;
  if (!call.tester?.uid || !call.tester.accountSessionId || typeof call.tester.founder !== 'boolean'
    || !call.id || !call.ownerUid || !call.waveformId || !Number.isSafeInteger(call.createdAt)
    || !Number.isSafeInteger(call.expiresAt) || !Number.isSafeInteger(call.controlExpiresAt)
    || !['creating', 'active', 'uncertain', 'closed', 'rejected'].includes(call.state)
    || typeof call.canceled !== 'boolean'
    || call.providerId !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(call.providerId)) throw new Error('Invalid tester conversation');
  return call;
}
const terminal = (call: StoredVoice) => call.state === 'closed' || call.state === 'rejected';
const sameActor = (call: StoredVoice, owner: VoiceOwner) => call.ownerUid === owner.ownerUid
  && call.waveformId === owner.waveformId && call.tester?.uid === owner.tester?.uid
  && call.tester?.accountSessionId === owner.tester?.accountSessionId && call.tester?.founder === owner.tester?.founder;

/** Free invitation-only allowances; separate from wallets, analytics and historical daily holds. */
export function createTesterVoiceStore(database: VoiceDatabase, now: () => number = Date.now,
  period: 'beta' | 'daily' = 'beta', assertContentAllowed?: (tx: VoiceTransaction, owner: VoiceOwner) => Promise<void>) {
  async function authorize(tx: VoiceTransaction, owner: VoiceOwner) {
    const tester = owner.tester;
    if (!tester || !tester.uid || !tester.accountSessionId || owner.paid
      || owner.kind !== undefined && !isPublicVoiceOwner(owner)
      || !owner.kind && (tester.uid !== owner.ownerUid || tester.accountSessionId !== owner.accountSessionId)
      || owner.kind && tester.founder) throw new VoiceAdmissionError('Tester identity is required.', 403);
    const [session, member, waveform] = await Promise.all([
      tx.get(`${ACCOUNT_SESSION_COLLECTION}/${tester.accountSessionId}`), tx.get(`${MEMBERS_COLLECTION}/${tester.uid}`),
      owner.kind ? Promise.resolve(null) : tx.get(`ownerWaveforms/${tester.uid}`),
    ]);
    if (!activeAccountSession(session, tester.uid, now()) || member?.state !== 'active') throw new VoiceAdmissionError('Sign in with an invited account to continue.', 403);
    if (!owner.kind && waveform?.id !== owner.waveformId) throw new VoiceAdmissionError('This waveform belongs to another account.', 403);
    if (!owner.kind) await assertContentAllowed?.(tx, owner);
  }
  function allowance(owner: VoiceOwner) {
    if (!owner.kind && owner.tester?.founder) return undefined;
    const entry = owner.kind ? 'intro' : 'waveform';
    // The intro is always daily. Personal demos use the explicitly selected beta period.
    const key = owner.kind || period === 'daily' ? new Date(now()).toISOString().slice(0, 10) : 'beta-v1';
    return `voiceTesterAllowances/${hash(`${owner.tester!.uid}:${entry}:${key}`)}`;
  }
  async function admission(tx: VoiceTransaction, owner: VoiceOwner) {
    await authorize(tx, owner);
    const path = allowance(owner);
    const [global, own, balance] = await Promise.all([tx.get(globalPath), tx.get(ownPath(owner.tester!.uid)), path ? tx.get(path) : null]);
    const active = slots(global);
    if (Object.values(active).includes('uncertain')) throw new VoiceAdmissionError('A previous voice connection needs confirmed cleanup.', 503);
    if (own?.active) throw new VoiceAdmissionError('Your previous conversation must close before starting another.');
    if (Object.keys(active).length >= 2) throw new VoiceAdmissionError('All available voice connections are in use.');
    const seconds = path ? TESTER_DEMO_SECONDS - count(balance?.usedSeconds) - count(balance?.heldSeconds) : 0;
    if (path && seconds <= 0) throw new VoiceAdmissionError(owner.kind ? 'Your three-minute introduction allowance has ended for today.'
      : period === 'daily' ? 'Your three-minute demo allowance has ended for today.' : 'Your three-minute beta demo has ended.', 429, true);
    return { global, active, path, balance, seconds };
  }
  return {
    async available(owner: VoiceOwner) { await database.transaction(async tx => { await admission(tx, owner); }); },
    async reserve(owner: VoiceOwner, id: string) {
      return database.transaction(async tx => {
        if (await tx.get(callPath(id))) throw new VoiceAdmissionError('This conversation identifier has already been used.');
        const a = await admission(tx, owner);
        const expiresAt = a.path ? now() + a.seconds * 1000 : UNMETERED_LOCAL_DEADLINE;
        const call: StoredVoice = { ...owner, id, state: 'creating', createdAt: now(), expiresAt, canceled: false,
          controlExpiresAt: Math.min(expiresAt, now() + TESTER_CONTROL_LEASE_MS),
          ...(a.path ? { allowancePath: a.path, allowanceSeconds: a.seconds } : {}) };
        tx.set(callPath(id), call);
        tx.set(ownPath(owner.tester!.uid), { active: id });
        tx.set(globalPath, { day: new Date(now()).toISOString().slice(0, 10), reservedSeconds: 0, ...a.global, active: { ...a.active, [id]: 'creating' } });
        if (a.path) tx.set(a.path, { ...a.balance, usedSeconds: count(a.balance?.usedSeconds), heldSeconds: a.seconds });
        return call;
      });
    },
    async mayStart(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || call.canceled || call.state !== 'creating' || call.controlExpiresAt! <= now()) return false;
        await authorize(tx, call); return true;
      });
    },
    async created(id: string, providerId: string, expiresAt: number) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        const global = await tx.get(globalPath);
        if (!call || terminal(call) || call.expiresAt !== expiresAt || !/^[A-Za-z0-9_-]{1,200}$/.test(providerId)
          || call.providerId && call.providerId !== providerId) throw new Error('Invalid provider creation');
        const uncertain = call.state === 'uncertain' || call.controlExpiresAt! <= now();
        const state = uncertain ? 'uncertain' : 'active';
        tx.set(callPath(id), { ...call, providerId, state });
        tx.set(globalPath, { ...global, active: { ...slots(global), [id]: state } });
        return call.canceled || uncertain;
      });
    },
    // Read before scheduling; commit only after the replacement deadline task exists.
    async heartbeat(owner: VoiceOwner, id: string, scheduledUntil?: number) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || !sameActor(call, owner) || call.canceled || call.state !== 'active' || call.cleanup
          || call.controlExpiresAt! <= now() || call.expiresAt <= now()) throw new VoiceAdmissionError('The voice lease ended. Start again after cleanup.', 409);
        await authorize(tx, owner);
        const next = Math.min(call.expiresAt, Math.ceil(now() / 15_000) * 15_000 + TESTER_CONTROL_LEASE_MS);
        if (scheduledUntil !== undefined) {
          if (!Number.isSafeInteger(scheduledUntil) || scheduledUntil > next || scheduledUntil <= now()) throw new Error('Invalid scheduled lease');
          if (scheduledUntil > call.controlExpiresAt!) tx.set(callPath(id), { ...call, controlExpiresAt: scheduledUntil });
          return { expiresAt: call.expiresAt, controlExpiresAt: Math.max(call.controlExpiresAt!, scheduledUntil), schedule: false };
        }
        return { expiresAt: call.expiresAt, controlExpiresAt: next, schedule: call.controlExpiresAt! < next && call.controlExpiresAt! - now() <= 30_000 };
      });
    },
    async expire(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || terminal(call)) return call;
        if (Math.min(call.expiresAt, call.controlExpiresAt!) > now()) return null; // Superseded task acknowledges without rescheduling.
        const global = await tx.get(globalPath);
        const state = call.providerId ? call.state : 'uncertain';
        tx.set(callPath(id), { ...call, canceled: true, state });
        if (state === 'uncertain') tx.set(globalPath, { ...global, active: { ...slots(global), [id]: state } });
        return { ...call, canceled: true, state };
      });
    },
    async cancel(ownerUid: string, waveformId?: string, id?: string, accountSessionId?: string) {
      return database.transaction(async tx => {
        // Account sign-out passes the real UID; explicit waveform cancellation passes its scoped owner UID.
        const own = !id ? await tx.get(ownPath(ownerUid)) : null;
        const target = id ?? own?.active;
        if (typeof target !== 'string') return null;
        const call = stored(await tx.get(callPath(target)));
        if (!call) {
          if (id && waveformId) tx.set(callPath(id), { id, tombstone: true });
          return null;
        }
        if (call.ownerUid !== ownerUid && !(waveformId === undefined && call.tester?.uid === ownerUid)
          || waveformId && call.waveformId !== waveformId || accountSessionId && call.accountSessionId !== accountSessionId) throw new VoiceAdmissionError('This conversation belongs to another account.', 403);
        if (terminal(call)) return call;
        tx.set(callPath(call.id), { ...call, canceled: true }); return { ...call, canceled: true };
      });
    },
    async claimCleanup(id: string) {
      return database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || terminal(call) || !call.canceled || !call.providerId || call.cleanup && call.cleanup.until > now()) return null;
        const cleanup = { epoch: (call.cleanup?.epoch ?? 0) + 1, until: now() + VOICE_CLEANUP_LEASE_MS };
        tx.set(callPath(id), { ...call, cleanup }); return { ...call, cleanup };
      });
    },
    async finish(id: string, result: { finalized: boolean; seconds?: number; rejected?: boolean; providerId?: string; cleanupEpoch?: number }) {
      await database.transaction(async tx => {
        const call = stored(await tx.get(callPath(id)));
        if (!call || terminal(call)) return;
        if (result.providerId !== undefined && !/^[A-Za-z0-9_-]{1,200}$/.test(result.providerId)) throw new Error('Invalid provider identifier');
        if (call.cleanup && (call.cleanup.epoch !== result.cleanupEpoch || call.cleanup.until <= now())
          || !call.cleanup && result.cleanupEpoch !== undefined
          || call.providerId && result.providerId && call.providerId !== result.providerId
          || result.finalized && !result.rejected && (typeof result.seconds !== 'number' || !Number.isFinite(result.seconds) || result.seconds < 0)) throw new Error('Unconfirmed or stale finalization');
        const [global, own, balance] = await Promise.all([tx.get(globalPath), tx.get(ownPath(call.tester!.uid)),
          call.allowancePath ? tx.get(call.allowancePath) : null]);
        const active = slots(global);
        if (result.finalized) delete active[id]; else active[id] = 'uncertain';
        tx.set(globalPath, { ...global, active });
        tx.set(callPath(id), { ...call, state: result.finalized ? result.rejected ? 'rejected' : 'closed' : 'uncertain',
          ...(result.providerId ? { providerId: result.providerId } : {}), ...(result.seconds !== undefined ? { seconds: result.seconds } : {}) });
        if (result.finalized) {
          if (own?.active === id) tx.set(ownPath(call.tester!.uid), { active: null });
          if (call.allowancePath) {
            // Only server-observed provider finalization releases an unused hold. Setup time counts conservatively.
            const used = result.rejected ? 0 : Math.min(call.allowanceSeconds!, Math.max(Math.ceil(result.seconds!), Math.ceil((now() - call.createdAt) / 1000)));
            tx.set(call.allowancePath, { usedSeconds: Math.min(TESTER_DEMO_SECONDS, count(balance?.usedSeconds) + used), heldSeconds: 0 });
          }
        }
      });
    },
  };
}
export type TesterVoiceStore = ReturnType<typeof createTesterVoiceStore>;
