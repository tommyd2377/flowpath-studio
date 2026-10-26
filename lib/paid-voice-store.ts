import { createHash } from 'node:crypto';
import type { PaidActor, PaidSegment, PaidStore } from './paid-store';
import { VoiceAdmissionError, type ProductionVoiceStore, type StoredVoice, type VoiceOwner, type VoiceTransaction } from './production-voice-store';

const stored = (s: PaidSegment): StoredVoice => ({ id: s.id, ownerUid: s.viewer, waveformId: s.waveformId,
  accountSessionId: s.accountSessionId ?? s.visitorId, state: s.state, createdAt: s.createdAt, expiresAt: s.expiresAt,
  canceled: s.canceled, ...(s.providerId ? { providerId: s.providerId } : {}) });
/** A settled paid segment can continue only inside its original 15-minute window. */
export async function previousPaidAdminCall(tx: VoiceTransaction, id: string): Promise<StoredVoice | null> {
  const segment = await tx.get(`paidTestSegments/${createHash('sha256').update(id).digest('hex')}`) as PaidSegment | null;
  if (!segment || segment.id !== id || segment.state !== 'closed' || !segment.viewerUid || !segment.accountSessionId) return null;
  return { ...stored(segment), ownerUid: segment.viewerUid,
    admin: { uid: segment.viewerUid, accountSessionId: segment.accountSessionId, override: false, deadline: segment.createdAt + 900_000 } };
}
export async function activePaidAdminCall(tx: VoiceTransaction, uid: string): Promise<boolean> {
  return !!(await tx.get(`paidTestParticipants/${createHash('sha256').update(`account:${uid}`).digest('hex')}`))?.active;
}
const access = (owner: VoiceOwner) => {
  if (!owner.paid) throw new VoiceAdmissionError('Paid session authority is missing.', 403);
  return owner.paid;
};

/** Reuses the existing upstream supervisor, separate from the homepage's 180-second store. */
export function createPaidVoiceStore(store: PaidStore, now = Date.now): ProductionVoiceStore {
  return {
    available: async owner => { const a = access(owner); await store.quote(a.actor, owner.waveformId, a.choice); },
    reserve: async (owner, id, policy) => { const a = access(owner); const call = stored(await store.reserve(a.actor, owner.waveformId, id, a.choice,
      { concurrency: policy.globalConcurrency, dailySeconds: policy.globalDailySeconds }));
      return { ...call, ...(owner.admin ? { admin: { ...owner.admin, deadline: call.createdAt + 900_000 } } : {}) }; },
    created: async (id, providerId) => (await store.updateSegment(id, 'created', providerId))?.canceled ?? true,
    mayStart: store.mayStart,
    expire: async id => {
      const call = await store.segment(id);
      if (!call) return null;
      if (call.expiresAt > now()) throw new Error('Voice deadline has not arrived');
      return stored((await store.updateSegment(id, 'cancel'))!);
    },
    cancel: async (viewer, waveformId, id, accountSessionId) => {
      if (!id || !waveformId) throw new VoiceAdmissionError('A conversation identifier is required.', 400);
      let call = await store.segment(id);
      if (!call) {
        const actor: PaidActor = { visitorId: accountSessionId ?? viewer, ...(viewer.startsWith('account:') ? { uid: viewer.slice(8) } : {}) };
        await store.cancelMissing(actor, waveformId, id);
        call = await store.segment(id);
      }
      if (!call || call.viewer !== viewer || call.waveformId !== waveformId) throw new VoiceAdmissionError('This conversation belongs to another waveform.', 403);
      return stored((await store.updateSegment(id, 'cancel'))!);
    },
    finish: store.settle,
  };
}
