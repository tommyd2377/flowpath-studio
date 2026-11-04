import { randomBytes, randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ACCOUNT_COOKIE_SECONDS, accountTestingPreference, withAccountTesting, waveformRecord, WaveformStoreError, type FirebaseAccountAdapter } from './account-server';
import { WAVEFORMS_PER_OWNER, type AccountUser, type Waveform } from './account-model';
import { ACCOUNT_SESSION_COLLECTION, AccountSessionInactiveError, activeAccountSession, createDurableAccountSessions } from './production-account-session';
import { BetaAccessRequiredError, createBetaMembershipAccess } from './membership';
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
  services = () => getFirebaseAccountServices(projectId, databaseId),
  validateWaveform?: (tx: VoiceTransaction, uid: string, input: WaveformInput, id?: string) => Promise<void>, grantCollection = 'voiceDemoAccess'): FirebaseAccountAdapter {
  const durableSessions = () => createDurableAccountSessions(services().db);
  const membership = () => createBetaMembershipAccess(services().db, Date.now, grantCollection);
  const user = (claims: { uid: string; name?: unknown; email?: unknown; email_verified?: unknown; firebase?: { sign_in_provider?: string } }): AccountUser => ({
    ...(accountRole(claims) ? { role: accountRole(claims) } : {}),
    uid: claims.uid, displayName: typeof claims.name === 'string' ? claims.name.slice(0, 80) : 'Waveform owner',
  });

  return {
    async signIn(idToken, demoGrant) {
      const { auth } = services();
      const claims = await auth.verifyIdToken(idToken, true);
      if (!supportedAccountClaims(claims)
        || !Number.isFinite(claims.auth_time) || Math.abs(Date.now() / 1000 - claims.auth_time) > 300) {
        throw new Error('Recent Google or verified email sign-in required');
      }
      if (!await membership().admit(claims.uid, demoGrant)) throw new BetaAccessRequiredError();
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
        return supportedAccountClaims(claims) && await membership().isMember(claims.uid) ? user(claims) : null;
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
    async listWaveforms(uid) {
      const db = services().db;
      return db.runTransaction(async tx => {
        const legacy = await tx.get(db.collection('ownerWaveforms').doc(uid));
        const index = await tx.get(db.collection('ownerWaveformLists').doc(uid));
        const ids = additionalWaveformIds(index.data());
        const adminTesting = accountTestingPreference(index.data(), legacy.exists ? waveformRecord(legacy.data()) : null);
        const extra = await Promise.all(ids.map(id => tx.get(db.collection('ownerWaveforms').doc(uid).collection('waveforms').doc(id))));
        return [legacy, ...extra].filter(row => row.exists).map(row => {
          const waveform = waveformRecord(row.data());
          if (!waveform) throw new Error('Invalid saved waveform');
          return withAccountTesting(waveform, adminTesting);
        });
      });
    },
    async readWaveform(uid, id) {
      const db = services().db;
      return db.runTransaction(async tx => {
        const [legacy, index] = await tx.getAll(db.collection('ownerWaveforms').doc(uid), db.collection('ownerWaveformLists').doc(uid));
        const first = legacy.exists ? waveformRecord(legacy.data()) : null;
        if (legacy.exists && !first) throw new Error('Invalid saved waveform');
        const adminTesting = accountTestingPreference(index.data(), first);
        if (!id || first?.id === id) return first ? withAccountTesting(first, adminTesting) : null;
        const snapshot = await tx.get(db.collection('ownerWaveforms').doc(uid).collection('waveforms').doc(id));
        if (!snapshot.exists) return null;
        const waveform = waveformRecord(snapshot.data());
        if (!waveform || waveform.id !== id) throw new Error('Invalid saved waveform');
        return withAccountTesting(waveform, adminTesting);
      });
    },
    async saveWaveform(uid, input, accountSessionId, id, create = false) {
      if (!accountSessionId) throw new AccountSessionInactiveError();
      const db = services().db;
      const reference = db.collection('ownerWaveforms').doc(uid);
      const indexReference = db.collection('ownerWaveformLists').doc(uid);
      // The owner index serializes all creations, including competing instances.
      // The original document and every existing /w/<id> remain in place.
      return db.runTransaction(async transaction => {
        const session = await transaction.get(db.collection(ACCOUNT_SESSION_COLLECTION).doc(accountSessionId));
        if (!activeAccountSession(session.data(), uid)) throw new AccountSessionInactiveError();
        const snapshot = await transaction.get(reference);
        const index = await transaction.get(indexReference);
        const ids = additionalWaveformIds(index.data());
        const first = snapshot.exists ? waveformRecord(snapshot.data()) : null;
        if (snapshot.exists && !first) throw new Error('Invalid saved waveform');
        const savedAdminTesting = accountTestingPreference(index.data(), first);
        const adminTesting = input.adminTesting ?? savedAdminTesting;
        const selectedId = id ?? first?.id;
        const extraReference = selectedId && first && selectedId !== first.id ? reference.collection('waveforms').doc(selectedId) : null;
        const extra = extraReference ? await transaction.get(extraReference) : null;
        const existing = extra ? extra.exists ? waveformRecord(extra.data()) : null : first;
        if (extra?.exists && !existing) throw new Error('Invalid saved waveform');
        if (create && (id ? existing?.id === id : false)) throw new WaveformStoreError('This waveform already exists.', 409);
        if (!create && id && !existing) throw new WaveformStoreError('This waveform is unavailable.', 404);
        const adding = create || !existing;
        if (adding && ids.length + (first ? 1 : 0) >= WAVEFORMS_PER_OWNER) throw new WaveformStoreError(`You can save up to ${WAVEFORMS_PER_OWNER} waveforms.`, 409);
        const waveform: Waveform = { id: !adding ? existing!.id : id ?? randomUUID(), ...input, ...(input.practicePlugins === undefined && existing?.practicePlugins ? { practicePlugins: existing.practicePlugins } : {}), updatedAt: new Date().toISOString() };
        const target = first && waveform.id !== first.id ? reference.collection('waveforms').doc(waveform.id) : reference;
        await validateWaveform?.({ get: async path => { const row = await transaction.get(db.doc(path)); return row.exists ? row.data()! : null; },
          set: (path, value) => { transaction.set(db.doc(path), value); } }, uid, input, id ?? (!adding ? existing?.id : undefined));
        transaction.set(target, waveform);
        if (adding || adminTesting !== undefined) transaction.set(indexReference, { ...index.data(),
          ids: adding && first ? [...ids, waveform.id] : ids, ...(adminTesting !== undefined ? { adminTesting } : {}) });
        return withAccountTesting(waveform, adminTesting);
      });
    },
  };
}

function additionalWaveformIds(row: FirebaseFirestore.DocumentData | undefined): string[] {
  if (!row) return [];
  if (!Array.isArray(row.ids) || row.ids.length >= WAVEFORMS_PER_OWNER
    || row.ids.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))
    || new Set(row.ids).size !== row.ids.length) throw new Error('Invalid waveform index');
  return row.ids;
}
