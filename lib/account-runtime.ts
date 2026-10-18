import { createAccountServer } from './account-server';
import type { AccountMode, FirebasePublicConfig } from './account-model';
import { createFirebaseAccountAdapter } from './firebase-accounts';
import type { createVoiceServer } from './voice-server';

function firebaseConfig(): FirebasePublicConfig | undefined {
  if (process.env.NODE_ENV !== 'development' || process.env.FLOWPATH_ACCOUNT_MODE !== 'firebase'
    || process.env.FLOWPATH_FIRESTORE_EDITION !== 'standard') return;
  const projectId = process.env.FLOWPATH_FIREBASE_PROJECT_ID;
  const apiKey = process.env.FLOWPATH_FIREBASE_WEB_API_KEY;
  const authDomain = process.env.FLOWPATH_FIREBASE_AUTH_DOMAIN;
  const appId = process.env.FLOWPATH_FIREBASE_APP_ID;
  if (projectId && apiKey && authDomain && appId) return { projectId, apiKey, authDomain, appId };
}

const configuredFirebase = firebaseConfig();
const mode: AccountMode = process.env.NODE_ENV !== 'development' ? 'unavailable'
  : process.env.FLOWPATH_ACCOUNT_MODE === 'local' ? 'local'
    : configuredFirebase ? 'firebase' : 'unavailable';

// Preserve local sessions and serialized saves across development route reloads.
const state = globalThis as typeof globalThis & {
  flowpathAccounts?: ReturnType<typeof createAccountServer>;
  flowpathVoiceServer?: ReturnType<typeof createVoiceServer>;
};
export const accountServer = state.flowpathAccounts ??= createAccountServer({
  mode,
  localDirectory: mode === 'local' ? process.env.FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY : undefined,
  beforeAccountChange: owner => state.flowpathVoiceServer?.cancelOwner(owner.uid) ?? Promise.resolve(true),
  firebaseConfig,
  firebase: configuredFirebase ? createFirebaseAccountAdapter(
    configuredFirebase.projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)',
  ) : undefined,
});
