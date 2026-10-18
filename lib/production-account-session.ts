import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { AccountUser } from './account-model';

export const ACCOUNT_SESSION_COLLECTION = 'ownerSessions';
export const accountSessionId = (cookie: string) => createHash('sha256').update(cookie).digest('hex');
export class AccountSessionInactiveError extends Error {
  constructor() { super('Account session is no longer active'); }
}

export function activeAccountSession(value: unknown, uid: string, now = Date.now()): boolean {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.uid === uid && row.state === 'active' && typeof row.expiresAt === 'number'
    && Number.isFinite(row.expiresAt) && row.expiresAt > now;
}

export type DurableAccountSessions = {
  create(cookie: string, user: AccountUser, expiresAt: number): Promise<void>;
  active(id: string, uid: string): Promise<boolean>;
  beginChange(id: string, uid: string): Promise<{ changeId: string } | 'inactive' | 'busy'>;
  finishChange(id: string, uid: string, changeId: string, revoked: boolean): Promise<boolean>;
};

/** Hashes only: Firebase JWTs and application cookies are never stored in Firestore. */
export function createDurableAccountSessions(db: Firestore, now: () => number = Date.now): DurableAccountSessions {
  const reference = (id: string) => db.collection(ACCOUNT_SESSION_COLLECTION).doc(id);
  return {
    async create(cookie, user, expiresAt) {
      await reference(accountSessionId(cookie)).create({ uid: user.uid, expiresAt, state: 'active' });
    },
    async active(id, uid) {
      return activeAccountSession((await reference(id).get()).data(), uid, now());
    },
    async beginChange(id, uid) {
      return db.runTransaction(async transaction => {
        const ref = reference(id);
        const row = (await transaction.get(ref)).data();
        if (!row || row.uid !== uid || row.expiresAt <= now() || row.state === 'revoked') return 'inactive';
        if (row.state === 'changing' && row.changeUntil > now()) return 'busy';
        if (row.state !== 'active' && row.state !== 'changing') return 'busy';
        const changeId = randomUUID();
        // An abandoned operation can be retried, but never becomes active on its own.
        transaction.update(ref, { state: 'changing', changeId, changeUntil: now() + 30_000 });
        return { changeId };
      });
    },
    async finishChange(id, uid, changeId, revoked) {
      return db.runTransaction(async transaction => {
        const ref = reference(id);
        const row = (await transaction.get(ref)).data();
        if (!row || row.uid !== uid || row.state !== 'changing' || row.changeId !== changeId) return false;
        transaction.update(ref, { state: revoked ? 'revoked' : 'active', changeId: null, changeUntil: null });
        return true;
      });
    },
  };
}
