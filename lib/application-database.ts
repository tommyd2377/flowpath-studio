import { join } from 'node:path';
import { createFixturePaidDatabase } from './paid-database';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { firestoreVoiceDatabase, type VoiceDatabase } from './production-voice-store';
import { localAppOrigin, localFirebaseDatabase } from './local-app-runtime';

const shared = globalThis as typeof globalThis & { flowpathApplicationDatabase?: VoiceDatabase };
/** One fixture transaction lock for reviews and the test ledger; no private runtime is copied. */
export function applicationDatabase(): VoiceDatabase {
  return shared.flowpathApplicationDatabase ??= localAppOrigin() ? localFirebaseDatabase()
    : process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local'
      ? createFixturePaidDatabase(process.env.FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY ?? join(process.cwd(), '.local-waveforms'))
      : firestoreVoiceDatabase(() => {
        const project = configuredFirebaseProjectId();
        if (!project || process.env.FLOWPATH_ACCOUNT_MODE !== 'firebase' || process.env.FLOWPATH_FIRESTORE_EDITION !== 'standard') throw new Error('Application storage is unavailable');
        return getFirebaseAccountServices(project, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
      });
}
