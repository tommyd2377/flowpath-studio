import { createAccountServer, creationWaveformId } from './account-server';
import type { AccountMode, FirebasePublicConfig } from './account-model';
import { configuredFirebaseProjectId, createFirebaseAccountAdapter } from './firebase-accounts';
import type { createVoiceServer } from './voice-server';
import { configuredPublicOrigin } from './request-origin';
import { localAppOrigin, localAppPath } from './local-app-runtime';
import { cancelProductionOwnerVoice } from './production-voice-runtime';
import { creationActor, creationReviewStore, creationSafetyEnabled, creationSafetyFixtures, creationSafetyPaused, creationSafetyRuntimeVersion } from './creation-runtime';
import { applicationDatabase } from './application-database';
import { demoGrantId } from './demo-access';
import { demoAccess } from './demo-access-runtime';
import { hostedTesterDemo } from './tester-voice-config';
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
const safetyVersion = `${creationSafetyRuntimeVersion()}:bounded-visual-encoding-v1:account-testing-v1`;
if (localAppOrigin() && state.flowpathAccountSafetyVersion !== safetyVersion) {
  state.flowpathAccounts = undefined;
  state.flowpathAccountSafetyVersion = safetyVersion;
}
export const accountServer = state.flowpathAccounts ??= createAccountServer({
  mode,
  creationSafetyEnabled,
  hostedTesterDemo,
  authorizeWaveformSave: demoAccess.allowed,
  safetyAdminFixture: creationSafetyFixtures,
  localUnmeteredTesting: () => !!localAppOrigin(),
  validateWaveform: async (request, waveform) => {
    if (creationSafetyPaused()) return;
    if (!creationSafetyEnabled()) {
      if (waveform.textPanel?.version === 1 || waveform.visualDisplay) throw new CreationSafetyError('Creator text display is paused until safety review is available.', 503);
      return;
    }
    const identity = await accountServer.resolveIdentity(request);
    if (!identity) throw new Error('Sign in again');
    const store = creationReviewStore(identity);
    const id = creationWaveformId(request, identity.owner.uid) ?? (await accountServer.resolveVoiceWaveform(request, undefined, 'cleanup'))?.waveform.id;
    await applicationDatabase().transaction(async tx => { await store.requireAllowed(tx, creationActor(identity).uid, waveform, undefined, id); });
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
  membershipGrant: demoGrantId,
  publicOrigin: () => process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: () => process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  firebase: configuredFirebase ? createFirebaseAccountAdapter(
    projectId!, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)', undefined,
    async (tx, uid, input, id) => {
      if (creationSafetyEnabled()) await creationReviewStore().requireAllowed(localAppOrigin() ? {
        get: path => tx.get(localAppPath(path)), set: (path, value) => tx.set(localAppPath(path), value),
      } : tx, uid, input, undefined, id);
    }, localAppOrigin() ? localAppPath('voiceDemoAccess') : 'voiceDemoAccess',
  ) : undefined,
});
