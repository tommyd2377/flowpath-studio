import { createVoiceServer } from './voice-server';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { createProductionVoiceStore, firestoreVoiceDatabase } from './production-voice-store';
import { productionVoiceDeadlineConfigured, scheduleProductionVoiceDeadline } from './voice-deadline';
import { activePaidAdminCall, previousPaidAdminCall } from './paid-voice-store';
import { localAppOrigin, localFirebaseDatabase, localTestingVoicePolicy } from './local-app-runtime';
import { scheduleLocalVoiceDeadline } from './local-voice-deadline';
import { publicVoiceOwner } from './public-voice-identity';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { creationContentDigest, CreationSafetyError } from './creation-safety';
import { waveformRecord } from './account-server';

type AdminResolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveAdmin'];
type Resolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveWaveform'];
const shared = globalThis as typeof globalThis & {
  flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
  flowpathProductionVoiceConfigVersion?: string;
  flowpathProductionWaveformResolver?: Resolver;
  flowpathProductionAdminResolver?: AdminResolver;
};

/** Also initialized by logout/deadline routes, which must work on a fresh instance. */
export function getProductionVoiceServer(resolveWaveform?: Resolver, resolveAdmin?: AdminResolver) {
  if (resolveAdmin) shared.flowpathProductionAdminResolver = resolveAdmin;
  if (resolveWaveform) shared.flowpathProductionWaveformResolver = resolveWaveform;
  const local = !!localAppOrigin();
  // Dev hot reload may change registered tools while keeping the process online.
  // Old calls keep their sideband/timers; durable cleanup supports either instance.
  if (process.env.NODE_ENV === 'development' && shared.flowpathProductionVoiceConfigVersion !== 'creation-safety-v3') {
    shared.flowpathProductionVoiceServer = undefined;
    shared.flowpathProductionVoiceConfigVersion = 'creation-safety-v3';
  }
  return shared.flowpathProductionVoiceServer ??= createVoiceServer({
    publicOrigin: local ? undefined : configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN),
    trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    // Hosted creation stays closed until provider cutoff/recovery and active execution are verified.
    // No environment switch or warm-instance setting can bypass this release gate.
    enabled: () => local
      && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase' && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard'
      && Boolean(configuredFirebaseProjectId()) && (local || Boolean(configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN)))
      && (local || productionVoiceDeadlineConfigured()) && Boolean(localTestingVoicePolicy()),
    requestOwnedCleanup: !local,
    resolveWaveform: (request, id) => shared.flowpathProductionWaveformResolver?.(request, id) ?? Promise.resolve(null),
    resolvePublicVisitor: publicVoiceOwner,
    resolveAdmin: request => shared.flowpathProductionAdminResolver?.(request) ?? Promise.resolve(null),
    production: {
      store: createProductionVoiceStore(local ? localFirebaseDatabase() : firestoreVoiceDatabase(() => {
        const projectId = configuredFirebaseProjectId();
        if (!projectId) throw new Error('Firebase project is not configured');
        return getFirebaseAccountServices(projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
      }), Date.now, previousPaidAdminCall, activePaidAdminCall, async (tx, owner) => {
        if (!creationSafetyEnabled()) return;
        const waveform = waveformRecord(await tx.get(`ownerWaveforms/${owner.ownerUid}`));
        if (!waveform || waveform.id !== owner.waveformId || creationContentDigest(waveform) !== owner.contentDigest) throw new CreationSafetyError('Waveform content changed. Start again after its review.');
        await creationReviewStore().requireAllowed(tx, owner.ownerUid, waveform);
      }),
      policy: () => localTestingVoicePolicy(),
      scheduleDeadline: local ? scheduleLocalVoiceDeadline : scheduleProductionVoiceDeadline,
    },
  });
}

export const cancelProductionOwnerVoice = (uid: string) => getProductionVoiceServer().cancelOwner(uid);
export const expireProductionVoiceReservation = (id: string) => getProductionVoiceServer().expireReservation(id);
