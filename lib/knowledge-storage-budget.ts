import { createHash } from 'node:crypto';
import type { VoiceTransaction } from './production-voice-store';
import { KnowledgeError } from './knowledge-model';
import { KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD, KNOWLEDGE_PENDING_STORAGE_BYTES, KNOWLEDGE_STORAGE_CAPACITY_BYTES, estimatedKnowledgeMonthlyCost } from './knowledge-config';

const globalPath = 'knowledgeStorageBudget/platform';
const reservationPath = (uid: string, id: string) => `knowledgeStorageReservations/${createHash('sha256').update(JSON.stringify([uid, id])).digest('hex')}`;
const bytes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
type Reservation = { bytes: number; state: 'held' | 'reported' | 'released' };
function used(row: Record<string, unknown> | null) {
  if (row && !bytes(row.bytes)) throw new KnowledgeError('Document storage accounting needs attention.', 503);
  return row ? row.bytes as number : 0;
}
function reservation(row: Record<string, unknown> | null): Reservation | null {
  if (!row) return null;
  if (!bytes(row.bytes) || !['held', 'reported', 'released'].includes(String(row.state))) throw new KnowledgeError('Document storage accounting needs attention.', 503);
  return row as Reservation;
}

/** Same transaction as the document change. Estimates never grant money, credit or account authority. */
export function createKnowledgeStorageBudget() {
  return {
    async reserve(tx: VoiceTransaction, uid: string, id: string) {
      const key = reservationPath(uid, id), prior = reservation(await tx.get(key)), total = used(await tx.get(globalPath));
      if (prior) throw new KnowledgeError('Use a new upload identifier for this document.', 409);
      if (total + KNOWLEDGE_PENDING_STORAGE_BYTES > KNOWLEDGE_STORAGE_CAPACITY_BYTES) {
        throw new KnowledgeError('Knowledge storage is at capacity or another document is being indexed. Wait for preparation to finish, remove documents, or contact the founder.', 409);
      }
      tx.set(globalPath, { bytes: total + KNOWLEDGE_PENDING_STORAGE_BYTES });
      tx.set(key, { bytes: KNOWLEDGE_PENDING_STORAGE_BYTES, state: 'held' });
    },
    async report(tx: VoiceTransaction, uid: string, id: string, usageBytes: number) {
      if (!bytes(usageBytes)) throw new KnowledgeError('Document storage usage could not be verified.', 503);
      const key = reservationPath(uid, id), prior = reservation(await tx.get(key)), total = used(await tx.get(globalPath));
      if (!prior || prior.state === 'released') throw new KnowledgeError('Document storage reservation is missing.', 503);
      if (total < prior.bytes) throw new KnowledgeError('Document storage accounting needs attention.', 503);
      tx.set(globalPath, { bytes: total - prior.bytes + usageBytes });
      tx.set(key, { bytes: usageBytes, state: 'reported' });
    },
    async assertKnown(tx: VoiceTransaction, uid: string, id: string) {
      const prior = reservation(await tx.get(reservationPath(uid, id)));
      if (!prior || prior.state !== 'reported') throw new KnowledgeError('Document storage usage needs reconciliation before use.', 409);
    },
    async release(tx: VoiceTransaction, uid: string, id: string) {
      const key = reservationPath(uid, id), prior = reservation(await tx.get(key)), total = used(await tx.get(globalPath));
      if (!prior || prior.state === 'released') return;
      if (total < prior.bytes) throw new KnowledgeError('Document storage accounting needs attention.', 503);
      tx.set(globalPath, { bytes: total - prior.bytes });
      tx.set(key, { bytes: 0, state: 'released' });
    },
    async view(tx: VoiceTransaction) {
      const total = used(await tx.get(globalPath));
      return { estimatedMonthlyMicroUsd: estimatedKnowledgeMonthlyCost(total), budgetMicroUsd: KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD,
        uploadCapacityAvailable: total + KNOWLEDGE_PENDING_STORAGE_BYTES <= KNOWLEDGE_STORAGE_CAPACITY_BYTES };
    },
  };
}
export type KnowledgeStorageBudget = ReturnType<typeof createKnowledgeStorageBudget>;
