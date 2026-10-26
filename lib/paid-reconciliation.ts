import type { PaidSegment, PaidStore } from './paid-store';
import { VoiceAdmissionError } from './production-voice-store';

export type PaidProviderEvidence = { outcome: 'unknown' }
  | { outcome: 'not-created'; requestId: string; referenceId: string }
  | { outcome: 'closed'; requestId: string; referenceId: string; providerId: string; seconds: number };

/** Synthetic authority adapter only. No HTTP/admin endpoint or real-provider lookup is installed. */
export function createPaidReconciliation(store: PaidStore, options: {
  environment: 'fixture'; lookup: (segment: Readonly<PaidSegment>) => Promise<PaidProviderEvidence>;
}) {
  if (options.environment !== 'fixture' || process.env.NODE_ENV === 'production') throw new Error('Paid reconciliation is fixture-only.');
  async function inspect(id: string) {
    const segment = await store.segment(id);
    if (!segment) return null;
    return { id: segment.id, state: segment.state, reserved: segment.reserved, charged: segment.charged ?? null,
      payer: segment.payer, expiresAt: segment.expiresAt, providerKnown: !!segment.providerId,
      connectionConfirmed: segment.connectedAt !== undefined, needsAuthority: segment.state === 'uncertain' };
  }
  return {
    inspect,
    async resolve(id: string) {
      const segment = await store.segment(id);
      if (!segment || segment.state !== 'uncertain') return inspect(id);
      let evidence: PaidProviderEvidence;
      try { evidence = await options.lookup(Object.freeze(structuredClone(segment))); }
      catch { return inspect(id); } // Lookup failure is uncertainty, never a release instruction.
      if (evidence?.outcome === 'unknown') return inspect(id);
      if (!evidence || !['not-created', 'closed'].includes(evidence.outcome) || evidence.requestId !== segment.id
        || typeof evidence.referenceId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(evidence.referenceId)) {
        throw new VoiceAdmissionError('Provider reconciliation evidence does not match the reservation.', 503);
      }
      if (evidence.outcome === 'closed' && (typeof evidence.providerId !== 'string'
        || !/^[A-Za-z0-9_-]{1,200}$/.test(evidence.providerId) || segment.providerId && evidence.providerId !== segment.providerId
        || typeof evidence.seconds !== 'number' || !Number.isSafeInteger(Math.ceil(evidence.seconds)) || evidence.seconds < 0)) {
        throw new VoiceAdmissionError('Confirmed provider identity and final duration are required.', 503);
      }
      await store.settle(id, { finalized: true, seconds: evidence.outcome === 'closed' ? evidence.seconds : 0,
        ...(evidence.outcome === 'closed' ? { providerId: evidence.providerId } : {}),
        reconciliation: { referenceId: evidence.referenceId, outcome: evidence.outcome } });
      return inspect(id);
    },
  };
}
