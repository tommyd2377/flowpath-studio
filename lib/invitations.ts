import { createHash, randomBytes } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';

export const INVITATIONS_COLLECTION = 'waveformInvites';
export const MEMBERS_COLLECTION = 'waveformMembers';
export const INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
export const generateInvitationCode = () => `FP-${randomBytes(12).toString('hex').toUpperCase()}`;

export function invitationCodeHash(value: string | undefined): string | null {
  const code = value?.trim().toUpperCase();
  return code && /^FP-[A-F0-9]{24}$/.test(code) ? createHash('sha256').update(code).digest('hex') : null;
}

export class InvitationRequiredError extends Error {
  constructor() { super('An active invitation is required to join FlowPath Studio.'); }
}

/** Authentication alone does not grant application access. Only this server admits members. */
export function createInvitationAccess(db: Firestore, now: () => number = Date.now) {
  const member = (uid: string) => db.collection(MEMBERS_COLLECTION).doc(uid);
  return {
    async isMember(uid: string): Promise<boolean> {
      return (await member(uid).get()).data()?.state === 'active';
    },
    async admit(uid: string, inviteCode?: string): Promise<boolean> {
      const hash = invitationCodeHash(inviteCode);
      return db.runTransaction(async transaction => {
        const memberRef = member(uid);
        const existing = await transaction.get(memberRef);
        if (existing.data()?.state === 'active') return true;
        // A disabled membership cannot be bypassed with another invitation.
        if (existing.exists || !hash) return false;
        const invitationRef = db.collection(INVITATIONS_COLLECTION).doc(hash);
        const invitation = (await transaction.get(invitationRef)).data();
        if (!invitation || typeof invitation.expiresAt !== 'number' || !Number.isFinite(invitation.expiresAt)
          || invitation.expiresAt <= now() || invitation.usedBy !== null || invitation.usedAt !== null) return false;
        transaction.update(invitationRef, { usedBy: uid, usedAt: now() });
        transaction.set(memberRef, { state: 'active', createdAt: now() });
        return true;
      });
    },
  };
}
