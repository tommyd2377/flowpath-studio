import { createAccountServer } from './account-server';
import type { AccountMode, FirebasePublicConfig } from './account-model';
import { configuredFirebaseProjectId, createFirebaseAccountAdapter } from './firebase-accounts';
import type { createVoiceServer } from './voice-server';
import { configuredPublicOrigin } from './request-origin';
import { localAppOrigin, localAppPath } from './local-app-runtime';
import { cancelProductionOwnerVoice } from './production-voice-runtime';
import { creationActor, creationReviewStore, creationSafetyEnabled, creationSafetyFixtures } from './creation-runtime';
import { applicationDatabase } from './application-database';
import { CreationSafetyError } from './creation-safety';

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
  flowpathAccountSafetyVersion?: string;
};
// Refresh callbacks on the running local server; Firebase sessions/data stay durable.
if (localAppOrigin() && state.flowpathAccountSafetyVersion !== 'creation-safety-v3') {
  state.flowpathAccounts = undefined;
  state.flowpathAccountSafetyVersion = 'creation-safety-v3';
}
export const accountServer = state.flowpathAccounts ??= createAccountServer({
  mode,
  creationSafetyEnabled,
  safetyAdminFixture: creationSafetyFixtures,
  localUnmeteredTesting: () => !!localAppOrigin(),
  validateWaveform: async (request, waveform) => {
    if (!creationSafetyEnabled()) {
      if (waveform.textPanel?.version === 1) throw new CreationSafetyError('Creator text display is paused until safety review is available.', 503);
      return;
    }
    const identity = await accountServer.resolveIdentity(request);
    if (!identity) throw new Error('Sign in again');
    const store = creationReviewStore(identity);
    await applicationDatabase().transaction(async tx => { await store.requireAllowed(tx, creationActor(identity).uid, waveform); });
  },
  checkWaveform: async (request, waveform) => {
    if (!creationSafetyEnabled()) return;
    const identity = await accountServer.resolveIdentity(request);
    if (!identity) throw new Error('Sign in again');
    await applicationDatabase().transaction(async tx => { await creationReviewStore(identity).requireAllowed(tx, identity.owner.uid, waveform); });
  },
  localDirectory: mode === 'local' ? process.env.FLOWPATH_ACCOUNT_FIXTURE_DIRECTORY : undefined,
  beforeAccountChange: async owner => {
    const paid = await import('./paid-runtime');
    if (paid.paidEnabled && !await (await import('./paid-voice-runtime')).cancelPaidOwnerVoice(owner.uid)) return false;
    return process.env.NODE_ENV === 'production' || localAppOrigin() ? cancelProductionOwnerVoice(owner.uid)
      : state.flowpathVoiceServer?.cancelOwner(owner.uid) ?? true;
  },
  afterSignIn: async (request, owner) => {
    const paid = await import('./paid-runtime');
    const visitor = (await import('./paid-http')).paidVisitor(request);
    if (paid.paidEnabled && visitor) await paid.getPaidStore().link(visitor, owner.uid);
  },
  afterWaveformSaved: async (request, waveform) => {
    const paid = await import('./paid-runtime');
    if (!paid.paidEnabled) return;
    const identity = await accountServer.resolveIdentity(request);
    if (!identity) throw new Error('Account changed while saving');
    const store = paid.getPaidStore();
    await store.saveWaveform({ visitorId: (await import('./paid-http')).paidVisitor(request) ?? 'owner-save', uid: identity.owner.uid,
      accountSessionId: identity.accountSessionId }, waveform);
  },
  firebaseConfig,
  firebaseAutoConfig: autoFirebaseConfig,
  openRegistration: () => process.env.FLOWPATH_PAID_TEST_ENABLED === '1',
  publicOrigin: () => process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: () => process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  firebase: configuredFirebase ? createFirebaseAccountAdapter(
    projectId!, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)', undefined, process.env.FLOWPATH_PAID_TEST_ENABLED === '1',
    async (tx, uid, input) => {
      if (creationSafetyEnabled()) await creationReviewStore().requireAllowed(localAppOrigin() ? {
        get: path => tx.get(localAppPath(path)), set: (path, value) => tx.set(localAppPath(path), value),
      } : tx, uid, input);
    },
  ) : undefined,
});
