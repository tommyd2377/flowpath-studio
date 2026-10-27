import { createHash } from 'node:crypto';
import type { VoiceDatabase } from './production-voice-store';
import { CREATION_REVIEW_BUDGET_MICRO_USD, CREATION_REVIEW_RESERVATION_MICRO_USD } from './creation-review-config';

type Budget = { spent: number; held: number; uncertain?: boolean };
const ownerPath = (uid: string) => `creationReviewSpending/${createHash('sha256').update(uid).digest('hex')}`;
const callPath = (id: string) => `creationReviewCalls/${id}`;
function budget(row: Record<string, unknown> | null): Budget {
  if (!row) return { spent: 0, held: 0 };
  if (![row.spent, row.held].every(v => Number.isSafeInteger(v) && Number(v) >= 0)
    || Number(row.spent) + Number(row.held) > CREATION_REVIEW_BUDGET_MICRO_USD) throw new Error('Review budget unavailable');
  return row as Budget;
}

/** Separate operating-cost guard, never credit/charges. Unknown bounded attempts consume the full reservation; they are never refunded or retried. */
export function createReviewBudget(database: VoiceDatabase) {
  return {
    async reserve(uid: string, id: string) {
      return database.transaction(async tx => {
        const row = budget(await tx.get(ownerPath(uid))), prior = await tx.get(callPath(id));
        if (prior) return false;
        if (row.spent + row.held + CREATION_REVIEW_RESERVATION_MICRO_USD > CREATION_REVIEW_BUDGET_MICRO_USD) return false;
        tx.set(ownerPath(uid), { ...row, held: row.held + CREATION_REVIEW_RESERVATION_MICRO_USD });
        tx.set(callPath(id), { uid, state: 'held', reserved: CREATION_REVIEW_RESERVATION_MICRO_USD });
        return true;
      });
    },
    async finish(uid: string, id: string, charge = CREATION_REVIEW_RESERVATION_MICRO_USD, uncertain = false) {
      if (!Number.isSafeInteger(charge) || charge < 0 || charge > CREATION_REVIEW_RESERVATION_MICRO_USD) throw new Error('Invalid review accounting');
      return database.transaction(async tx => {
        const row = budget(await tx.get(ownerPath(uid))), call = await tx.get(callPath(id));
        if (!call || call.uid !== uid || call.state !== 'held') return;
        if (row.held < CREATION_REVIEW_RESERVATION_MICRO_USD) throw new Error('Review budget unavailable');
        tx.set(ownerPath(uid), { spent: row.spent + charge, held: row.held - CREATION_REVIEW_RESERVATION_MICRO_USD, ...(row.uncertain || uncertain ? { uncertain: true } : {}) });
        tx.set(callPath(id), { ...call, state: 'finished', charged: charge });
      });
    },
    async view(uid: string) { return database.transaction(async tx => ({ ...budget(await tx.get(ownerPath(uid))), limit: CREATION_REVIEW_BUDGET_MICRO_USD })); },
  };
}
