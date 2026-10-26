import { createVoiceServer } from './voice-server';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { createProductionVoiceStore, firestoreVoiceDatabase, productionVoicePolicy } from './production-voice-store';
import { productionVoiceDeadlineConfigured, scheduleProductionVoiceDeadline } from './voice-deadline';
import { activePaidAdminCall, previousPaidAdminCall } from './paid-voice-store';
import { localAppOrigin, localFirebaseDatabase } from './local-app-runtime';
import { scheduleLocalVoiceDeadline } from './local-voice-deadline';
import { publicVoiceOwner } from './public-voice-identity';

type AdminResolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveAdmin'];
type Resolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveWaveform'];
const shared = globalThis as typeof globalThis & {
  flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
  flowpathProductionWaveformResolver?: Resolver;
  flowpathProductionAdminResolver?: AdminResolver;
};

/** Also initialized by logout/deadline routes, which must work on a fresh instance. */
export function getProductionVoiceServer(resolveWaveform?: Resolver, resolveAdmin?: AdminResolver) {
  if (resolveAdmin) shared.flowpathProductionAdminResolver = resolveAdmin;
  if (resolveWaveform) shared.flowpathProductionWaveformResolver = resolveWaveform;
  const local = !!localAppOrigin();
  return shared.flowpathProductionVoiceServer ??= createVoiceServer({
    publicOrigin: local ? undefined : configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN),
    trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    enabled: () => (local || process.env.NODE_ENV === 'production')
      && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase' && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard'
      && Boolean(configuredFirebaseProjectId()) && (local || Boolean(configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN)))
      && (local || productionVoiceDeadlineConfigured()) && Boolean(productionVoicePolicy(process.env)),
    resolveWaveform: (request, id) => shared.flowpathProductionWaveformResolver?.(request, id) ?? Promise.resolve(null),
    resolvePublicVisitor: publicVoiceOwner,
    resolveAdmin: request => shared.flowpathProductionAdminResolver?.(request) ?? Promise.resolve(null),
    production: {
      store: createProductionVoiceStore(local ? localFirebaseDatabase() : firestoreVoiceDatabase(() => {
        const projectId = configuredFirebaseProjectId();
        if (!projectId) throw new Error('Firebase project is not configured');
        return getFirebaseAccountServices(projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
      }), Date.now, previousPaidAdminCall, activePaidAdminCall),
      policy: () => productionVoicePolicy(process.env),
      scheduleDeadline: local ? scheduleLocalVoiceDeadline : scheduleProductionVoiceDeadline,
    },
  });
}

export const cancelProductionOwnerVoice = (uid: string) => getProductionVoiceServer().cancelOwner(uid);
export const expireProductionVoiceReservation = (id: string) => getProductionVoiceServer().expireReservation(id);
