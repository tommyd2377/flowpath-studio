import { createVoiceServer } from './voice-server';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { createProductionVoiceStore, firestoreVoiceDatabase, type VoiceOwner, type VoiceTransaction } from './production-voice-store';
import { productionVoiceDeadlineConfigured, scheduleProductionVoiceDeadline } from './voice-deadline';
import { activePaidAdminCall, previousPaidAdminCall } from './paid-voice-store';
import { localAppOrigin, localFirebaseDatabase, localTestingVoicePolicy } from './local-app-runtime';
import { hostedTesterDemo } from './tester-voice-config';
import { createTesterVoiceStore } from './tester-voice-store';
import { createHash } from 'node:crypto';
import { PUBLIC_WAVEFORM_ID } from './public-voice-identity';
import { scheduleTesterVoiceDeadline } from './voice-deadline';
import { scheduleLocalVoiceDeadline } from './local-voice-deadline';
import { publicVoiceOwner } from './public-voice-identity';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { creationContentDigest, CreationSafetyError } from './creation-safety';
import { waveformRecord } from './account-server';
import { requirePublishedPreview } from './published-preview';

type AdminResolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveAdmin'];
type Resolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveWaveform'];
const shared = globalThis as typeof globalThis & {
  flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
  flowpathProductionVoiceConfigVersion?: string;
  flowpathProductionWaveformResolver?: Resolver;
  flowpathProductionAdminResolver?: AdminResolver;
};

/** Also initialized by logout/deadline routes, which must work on a fresh instance. */
export function getProductionVoiceServer(resolveWaveform?: Resolver, resolveAdmin?: AdminResolver): ReturnType<typeof createVoiceServer> {
  if (resolveAdmin) shared.flowpathProductionAdminResolver = resolveAdmin;
  if (resolveWaveform) shared.flowpathProductionWaveformResolver = resolveWaveform;
  const local = !!localAppOrigin();
  const testerDemo = hostedTesterDemo();
  // Dev hot reload may change registered tools while keeping the process online.
  // Old calls keep their sideband/timers; durable cleanup supports either instance.
  if (process.env.NODE_ENV === 'development' && shared.flowpathProductionVoiceConfigVersion !== 'creation-safety-v3-draft-publication-v1') {
    shared.flowpathProductionVoiceServer = undefined;
    shared.flowpathProductionVoiceConfigVersion = 'creation-safety-v3-draft-publication-v1';
  }
  const database = local ? localFirebaseDatabase() : firestoreVoiceDatabase(() => {
    const projectId = configuredFirebaseProjectId();
    if (!projectId) throw new Error('Firebase project is not configured');
    return getFirebaseAccountServices(projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
  });
  const assertContentAllowed = async (tx: VoiceTransaction, owner: VoiceOwner) => {
    if (owner.publishedRevision !== undefined) {
      await requirePublishedPreview(tx, owner, creationSafetyEnabled() ? creationReviewStore().requireSnapshotAllowed : async () => {}, creationContentDigest);
      return;
    }
    if (!creationSafetyEnabled()) return;
    const waveform = waveformRecord(await tx.get(`ownerWaveforms/${owner.ownerUid}`));
    if (!waveform || waveform.id !== owner.waveformId || creationContentDigest(waveform) !== owner.contentDigest) throw new CreationSafetyError('Waveform content changed. Start again after its review.');
    await creationReviewStore().requireAllowed(tx, owner.ownerUid, waveform);
  };
  const store = testerDemo ? createTesterVoiceStore(database, Date.now, 'daily', assertContentAllowed) : createProductionVoiceStore(database, Date.now, previousPaidAdminCall, activePaidAdminCall, assertContentAllowed);
  return shared.flowpathProductionVoiceServer ??= createVoiceServer({
    publicOrigin: local ? undefined : configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN),
    trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    // Explicit invitation-only demo uses request-owned heartbeats/cleanup.
    // An old live flag alone cannot reactivate hosted sessions.
    enabled: () => (local || testerDemo)
      && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase' && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard'
      && Boolean(configuredFirebaseProjectId()) && (local || Boolean(configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN)))
      && (local || productionVoiceDeadlineConfigured()) && Boolean(localTestingVoicePolicy()),
    requestOwnedCleanup: !local,
    requestScopedDemo: testerDemo,
    resolveWaveform: (request, id) => shared.flowpathProductionWaveformResolver?.(request, id) ?? Promise.resolve(null),
    resolvePublicVisitor: async (request): Promise<VoiceOwner | null> => {
      if (!testerDemo) return publicVoiceOwner(request);
      const { accountServer } = await import('./account-runtime');
      const identity = await accountServer.resolveIdentity(request);
      if (!identity?.accountSessionId || !await identity.isCurrent()) return null;
      // Intro is a separate UID-scoped allowance, even for the verified founder.
      const accountSessionId = createHash('sha256').update(`intro:${identity.owner.uid}`).digest('hex');
      return { kind: 'visitor', ownerUid: `visitor:${accountSessionId}`, waveformId: PUBLIC_WAVEFORM_ID, accountSessionId,
        tester: { uid: identity.owner.uid, accountSessionId: identity.accountSessionId, founder: false } };
    },
    resolveAdmin: request => shared.flowpathProductionAdminResolver?.(request) ?? Promise.resolve(null),
    production: {
      store,
      ...(testerDemo && 'heartbeat' in store ? { heartbeat: store.heartbeat } : {}),
      policy: () => localTestingVoicePolicy(),
      scheduleDeadline: local ? scheduleLocalVoiceDeadline : testerDemo ? scheduleTesterVoiceDeadline : scheduleProductionVoiceDeadline,
    },
  });
}

export const cancelProductionOwnerVoice = (uid: string) => getProductionVoiceServer().cancelOwner(uid);
export const expireProductionVoiceReservation = (id: string) => getProductionVoiceServer().expireReservation(id);
