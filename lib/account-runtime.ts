import { createAccountServer } from './account-server';
import type { AccountMode, FirebasePublicConfig } from './account-model';
import { configuredFirebaseProjectId, createFirebaseAccountAdapter } from './firebase-accounts';
import type { createVoiceServer } from './voice-server';
import { configuredPublicOrigin } from './request-origin';
import { cancelProductionOwnerVoice } from './production-voice-runtime';

function firebaseConfig(): FirebasePublicConfig | undefined {
  if (process.env.FLOWPATH_ACCOUNT_MODE !== 'firebase' || process.env.FLOWPATH_FIRESTORE_EDITION !== 'standard'
    || process.env.NODE_ENV !== 'development' && !configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN)) return;
  const projectId = configuredFirebaseProjectId();
  const apiKey = process.env.FLOWPATH_FIREBASE_WEB_API_KEY;
  const authDomain = process.env.FLOWPATH_FIREBASE_AUTH_DOMAIN;
  const appId = process.env.FLOWPATH_FIREBASE_APP_ID;
  if (projectId && apiKey && authDomain && appId) return { projectId, apiKey, authDomain, appId };
}

const autoFirebaseConfig = () => process.env.FLOWPATH_FIREBASE_AUTO_CONFIG === '1';
const projectId = configuredFirebaseProjectId();
const configuredFirebase = process.env.FLOWPATH_ACCOUNT_MODE === 'firebase'
  && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard' && !!projectId
  && (process.env.NODE_ENV === 'development' || !!configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN))
  && (!!firebaseConfig() || autoFirebaseConfig());
const mode: AccountMode = process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local'
  ? 'local' : configuredFirebase ? 'firebase' : 'unavailable';

// Preserve local sessions and serialized saves across development route reloads.
const state = globalThis as typeof globalThis & {
  flowpathAccounts?: ReturnType<typeof createAccountServer>;
  flowpathVoiceServer?: ReturnType<typeof createVoiceServer>;
};
export const accountServer = state.flowpathAccounts ??= createAccountServer({
  mode,
  localDirectory: mode === 'local' ? process.env.FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY : undefined,
  beforeAccountChange: owner => process.env.NODE_ENV === 'production'
    ? cancelProductionOwnerVoice(owner.uid)
    : state.flowpathVoiceServer?.cancelOwner(owner.uid) ?? Promise.resolve(true),
  firebaseConfig,
  firebaseAutoConfig: autoFirebaseConfig,
  publicOrigin: () => process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: () => process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  firebase: configuredFirebase ? createFirebaseAccountAdapter(
    projectId!, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)',
  ) : undefined,
});
