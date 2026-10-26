import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { firestoreVoiceDatabase, type VoiceDatabase } from './production-voice-store';

/** Explicit full-app development mode; synthetic fixtures and public hosting cannot select it. */
export function localAppOrigin(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.NODE_ENV !== 'development' || env.FLOWPATH_LOCAL_APP !== '1' || env.FLOWPATH_ACCOUNT_MODE !== 'firebase'
    || env.FLOWPATH_FIRESTORE_EDITION !== 'standard' || configuredFirebaseProjectId(env) !== 'flowpath-studio'
    || env.FLOWPATH_PAID_FIXTURES === '1' || env.FLOWPATH_PUBLIC_ORIGIN) return;
  try {
    const url = new URL(env.FLOWPATH_LOCAL_APP_ORIGIN ?? '');
    if (url.protocol === 'http:' && url.hostname === 'localhost' && url.port && !url.username && !url.password
      && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Incomplete configuration stays disabled. */ }
}

/** Accounts/waveforms are real; local voice holds and test ledgers cannot occupy production slots. */
export const localAppPath = (value: string) => /^(?:ownerSessions|ownerWaveforms)\//.test(value) ? value : `localStudio_${value}`;
export function localAppDatabase(base: VoiceDatabase): VoiceDatabase {
  return { transaction: work => base.transaction(tx => work({ get: value => tx.get(localAppPath(value)), set: (value, row) => tx.set(localAppPath(value), row) })) };
}
export function localFirebaseDatabase() {
  if (!localAppOrigin()) throw new Error('Full local app is not configured');
  return localAppDatabase(firestoreVoiceDatabase(() => getFirebaseAccountServices('flowpath-studio', process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db));
}
