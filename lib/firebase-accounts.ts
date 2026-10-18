import { randomUUID } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { ACCOUNT_COOKIE_SECONDS, waveformRecord, type FirebaseAccountAdapter } from './account-server';
import type { AccountUser, Waveform } from './account-model';

/** Dormant until explicit local Firebase configuration; never initialized by fixtures. */
export function createFirebaseAccountAdapter(projectId: string, databaseId: string): FirebaseAccountAdapter {
  const services = () => {
    const app = getApps().find(candidate => candidate.name === 'flowpath-owner')
      ?? initializeApp({ projectId, credential: applicationDefault() }, 'flowpath-owner');
    return { auth: getAuth(app), db: getFirestore(app, databaseId) };
  };
  const user = (claims: { uid: string; name?: unknown }): AccountUser => ({
    uid: claims.uid, displayName: typeof claims.name === 'string' ? claims.name.slice(0, 80) : 'Waveform owner',
  });

  return {
    async signIn(idToken) {
      const { auth } = services();
      const claims = await auth.verifyIdToken(idToken, true);
      if (claims.firebase.sign_in_provider !== 'google.com'
        || !Number.isFinite(claims.auth_time) || Math.abs(Date.now() / 1000 - claims.auth_time) > 300) {
        throw new Error('Recent Google sign-in required');
      }
      const cookie = await auth.createSessionCookie(idToken, { expiresIn: ACCOUNT_COOKIE_SECONDS * 1000 });
      return { user: user(claims), cookie };
    },
    async authenticate(cookie) {
      const claims = await services().auth.verifySessionCookie(cookie, true);
      return claims.firebase.sign_in_provider === 'google.com' ? user(claims) : null;
    },
    async readWaveform(uid) {
      const snapshot = await services().db.collection('ownerWaveforms').doc(uid).get();
      if (!snapshot.exists) return null;
      const waveform = waveformRecord(snapshot.data());
      if (!waveform) throw new Error('Invalid saved waveform');
      return waveform;
    },
    async saveWaveform(uid, input) {
      const db = services().db;
      const reference = db.collection('ownerWaveforms').doc(uid);
      // A transaction keeps concurrent first saves at one waveform per account.
      return db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        const existing = snapshot.exists ? waveformRecord(snapshot.data()) : null;
        if (snapshot.exists && !existing) throw new Error('Invalid saved waveform');
        const waveform: Waveform = {
          id: existing?.id ?? randomUUID(),
          ...input, updatedAt: new Date().toISOString(),
        };
        transaction.set(reference, waveform);
        return waveform;
      });
    },
  };
}
