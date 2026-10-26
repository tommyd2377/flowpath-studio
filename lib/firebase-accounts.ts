import { randomBytes, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ACCOUNT_COOKIE_SECONDS, waveformRecord, type FirebaseAccountAdapter } from './account-server';
import type { AccountUser, Waveform } from './account-model';
import { ACCOUNT_SESSION_COLLECTION, AccountSessionInactiveError, activeAccountSession, createDurableAccountSessions } from './production-account-session';
import { InvitationRequiredError, createInvitationAccess } from './invitations';
import type { VoiceTransaction } from './production-voice-store';
import type { WaveformInput } from './account-model';

export function configuredFirebaseProjectId(environment: Record<string, string | undefined> = process.env): string | undefined {
  let projectId: unknown = environment.FLOWPATH_FIREBASE_PROJECT_ID;
  if (projectId === undefined && environment.FIREBASE_CONFIG) {
    try { projectId = JSON.parse(environment.FIREBASE_CONFIG).projectId; } catch { return; }
  }
  return typeof projectId === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ? projectId : undefined;
}

/** Lazily uses the runtime service identity; no credential files or values are inspected. */
export function getFirebaseAccountServices(projectId: string, databaseId: string) {
  const app = getApps().find(candidate => candidate.name === 'flowpath-owner')
    ?? initializeApp({ projectId, credential: applicationDefault() }, 'flowpath-owner');
  if (app.options.projectId !== projectId) throw new Error('Firebase project does not match the active application');
  return { auth: getAuth(app), db: getFirestore(app, databaseId) };
}

export function supportedAccountClaims(claims: { firebase?: { sign_in_provider?: string }; email_verified?: unknown }) {
  return claims.firebase?.sign_in_provider === 'google.com'
    || claims.firebase?.sign_in_provider === 'password' && claims.email_verified === true;
}

/** Derived only from Firebase-verified claims, never from browser profile fields. */
export function accountRole(claims: { email?: unknown; email_verified?: unknown; firebase?: { sign_in_provider?: string } }): 'admin' | undefined {
  return claims.firebase?.sign_in_provider === 'google.com' && claims.email_verified === true
    && typeof claims.email === 'string' && claims.email.trim().toLowerCase() === 'tomdevito27@gmail.com' ? 'admin' : undefined;
}

/** Dormant until explicit Firebase configuration; never initialized by fixtures. */
export function createFirebaseAccountAdapter(projectId: string, databaseId: string,
  services = () => getFirebaseAccountServices(projectId, databaseId), openRegistration = false,
  validateWaveform?: (tx: VoiceTransaction, uid: string, input: WaveformInput) => Promise<void>): FirebaseAccountAdapter {
  const durableSessions = () => createDurableAccountSessions(services().db);
  const invitations = () => createInvitationAccess(services().db, Date.now, openRegistration);
  const user = (claims: { uid: string; name?: unknown; email?: unknown; email_verified?: unknown; firebase?: { sign_in_provider?: string } }): AccountUser => ({
    ...(accountRole(claims) ? { role: accountRole(claims) } : {}),
    uid: claims.uid, displayName: typeof claims.name === 'string' ? claims.name.slice(0, 80) : 'Waveform owner',
  });

  return {
    async signIn(idToken, inviteCode) {
      const { auth } = services();
      const claims = await auth.verifyIdToken(idToken, true);
      if (!supportedAccountClaims(claims)
        || !Number.isFinite(claims.auth_time) || Math.abs(Date.now() / 1000 - claims.auth_time) > 300) {
        throw new Error('Recent Google or verified email sign-in required');
      }
      if (!await invitations().admit(claims.uid, inviteCode)) throw new InvitationRequiredError();
      const verifiedCookie = await auth.createSessionCookie(idToken, { expiresIn: ACCOUNT_COOKIE_SECONDS * 1000 });
      // A fresh nonce prevents a re-login from reviving an earlier application session.
      const cookie = `${randomBytes(16).toString('hex')}.${verifiedCookie}`;
      return { user: user(claims), cookie };
    },
    async authenticate(cookie) {
      const match = /^[a-f0-9]{32}\.([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(cookie);
      if (!match) return null;
      try {
        const claims = await services().auth.verifySessionCookie(match[1], true);
        return supportedAccountClaims(claims) && await invitations().isMember(claims.uid) ? user(claims) : null;
      } catch (error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string' && ['auth/session-cookie-expired', 'auth/session-cookie-revoked',
          'auth/invalid-session-cookie', 'auth/argument-error', 'auth/user-disabled', 'auth/user-not-found'].includes(code)) return null;
        throw error;
      }
    },
    sessions: {
      create: (...args) => durableSessions().create(...args),
      active: (...args) => durableSessions().active(...args),
      beginChange: (...args) => durableSessions().beginChange(...args),
      finishChange: (...args) => durableSessions().finishChange(...args),
    },
    async readWaveform(uid) {
      const snapshot = await services().db.collection('ownerWaveforms').doc(uid).get();
      if (!snapshot.exists) return null;
      const waveform = waveformRecord(snapshot.data());
      if (!waveform) throw new Error('Invalid saved waveform');
      return waveform;
    },
    async saveWaveform(uid, input, accountSessionId) {
      if (!accountSessionId) throw new AccountSessionInactiveError();
      const db = services().db;
      const reference = db.collection('ownerWaveforms').doc(uid);
      // A transaction keeps concurrent first saves at one waveform per account.
      return db.runTransaction(async transaction => {
        const session = await transaction.get(db.collection(ACCOUNT_SESSION_COLLECTION).doc(accountSessionId));
        if (!activeAccountSession(session.data(), uid)) throw new AccountSessionInactiveError();
        const snapshot = await transaction.get(reference);
        const existing = snapshot.exists ? waveformRecord(snapshot.data()) : null;
        if (snapshot.exists && !existing) throw new Error('Invalid saved waveform');
        const waveform: Waveform = {
          id: existing?.id ?? randomUUID(),
          ...input, updatedAt: new Date().toISOString(),
        };
        await validateWaveform?.({ get: async path => { const row = await transaction.get(db.doc(path)); return row.exists ? row.data()! : null; },
          set: (path, value) => { transaction.set(db.doc(path), value); } }, uid, input);
        transaction.set(reference, waveform);
        return waveform;
      });
    },
  };
}
