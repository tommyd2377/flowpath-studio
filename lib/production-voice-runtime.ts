import { createVoiceServer } from './voice-server';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { createProductionVoiceStore, firestoreVoiceDatabase, productionVoicePolicy } from './production-voice-store';
import { productionVoiceDeadlineConfigured, scheduleProductionVoiceDeadline } from './voice-deadline';

type Resolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveWaveform'];
const shared = globalThis as typeof globalThis & {
  flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
  flowpathProductionWaveformResolver?: Resolver;
};

/** Also initialized by logout/deadline routes, which must work on a fresh instance. */
export function getProductionVoiceServer(resolveWaveform?: Resolver) {
  if (resolveWaveform) shared.flowpathProductionWaveformResolver = resolveWaveform;
  return shared.flowpathProductionVoiceServer ??= createVoiceServer({
    publicOrigin: configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN),
    trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    enabled: () => process.env.NODE_ENV === 'production'
      && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase' && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard'
      && Boolean(configuredFirebaseProjectId()) && Boolean(configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN))
      && productionVoiceDeadlineConfigured() && Boolean(productionVoicePolicy(process.env)),
    resolveWaveform: (request, id) => shared.flowpathProductionWaveformResolver?.(request, id) ?? Promise.resolve(null),
    production: {
      store: createProductionVoiceStore(firestoreVoiceDatabase(() => {
        const projectId = configuredFirebaseProjectId();
        if (!projectId) throw new Error('Firebase project is not configured');
        return getFirebaseAccountServices(projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
      })),
      policy: () => productionVoicePolicy(process.env),
      scheduleDeadline: scheduleProductionVoiceDeadline,
    },
  });
}

export const cancelProductionOwnerVoice = (uid: string) => getProductionVoiceServer().cancelOwner(uid);
export const expireProductionVoiceReservation = (id: string) => getProductionVoiceServer().expireReservation(id);
