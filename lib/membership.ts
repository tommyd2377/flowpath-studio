import type { Firestore } from 'firebase-admin/firestore';

export const MEMBERS_COLLECTION = 'waveformMembers';
export class BetaAccessRequiredError extends Error {
  constructor() { super('Unlock beta access with the demo code before joining. Existing members can sign in normally.'); }
}

/** Verified UID + the same durable, expiring grant used by demos; no client verdicts. */
export function createBetaMembershipAccess(db: Firestore, now: () => number = Date.now, grantCollection = 'voiceDemoAccess') {
  const member = (uid: string) => db.collection(MEMBERS_COLLECTION).doc(uid);
  return {
    async isMember(uid: string): Promise<boolean> { return (await member(uid).get()).data()?.state === 'active'; },
    async admit(uid: string, demoGrant?: string): Promise<boolean> {
      return db.runTransaction(async transaction => {
        const reference = member(uid);
        const existing = await transaction.get(reference);
        if (existing.data()?.state === 'active') return true;
        // An expired grant cannot revoke an existing member; a new grant cannot
        // revive a disabled one. Membership always stays bound to the verified UID.
        if (existing.exists || !demoGrant || !/^[a-f0-9]{64}$/.test(demoGrant)) return false;
        const grant = (await transaction.get(db.collection(grantCollection).doc(demoGrant))).data();
        if (grant?.state !== 'active' || !Number.isSafeInteger(grant.expiresAt) || Number(grant.expiresAt) <= now()) return false;
        transaction.set(reference, { state: 'active', createdAt: now(), admission: 'beta-code' });
        return true;
      });
    },
  };
}
