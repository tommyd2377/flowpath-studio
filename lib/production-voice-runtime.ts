import { requirePluginRevision } from './plugin-access';
import { curatedDemo } from './curated-demo-runtime';
import { createVoiceServer, type VoiceControllers } from './voice-server';
import { configuredFirebaseProjectId, getFirebaseAccountServices } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { createProductionVoiceStore, firestoreVoiceDatabase, type VoiceOwner, type VoiceTransaction } from './production-voice-store';
import { productionVoiceDeadlineConfigured, scheduleProductionVoiceDeadline } from './voice-deadline';
import { activePaidAdminCall, previousPaidAdminCall } from './paid-voice-store';
import { localAppOrigin, localFirebaseDatabase, localTestingVoicePolicy } from './local-app-runtime';
import { demoGrantId } from './demo-access';
import { demoAccess } from './demo-access-runtime';
import { hostedTesterDemo, hostedTesterRuntime } from './tester-voice-config';
import { createTesterVoiceStore } from './tester-voice-store';
import { scheduleTesterVoiceDeadline } from './voice-deadline';
import { scheduleLocalVoiceDeadline } from './local-voice-deadline';
import { prewarmLocalVoiceSupervisor, superviseLocalVoice } from './local-voice-supervisor';
import { publicVoiceOwner } from './public-voice-identity';
import { creationReviewStore, creationSafetyEnabled, creationSafetyRuntimeVersion } from './creation-runtime';
import { creationContentDigest, CreationSafetyError } from './creation-safety';
import { waveformRecord } from './account-server';
import { requirePublishedPreview } from './published-preview';

type AdminResolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveAdmin'];
type VisitorResolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolvePublicVisitor'];
type Resolver = NonNullable<Parameters<typeof createVoiceServer>[0]>['resolveWaveform'];
const shared = globalThis as typeof globalThis & {
  flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
  flowpathProductionVoiceConfigVersion?: string;
  flowpathProductionVoiceFactory?: typeof createVoiceServer;
  flowpathProductionWaveformResolver?: Resolver;
  flowpathProductionAdminResolver?: AdminResolver;
  flowpathProductionVisitorResolver?: VisitorResolver;
  flowpathLocalVoiceControllers?: VoiceControllers;
};

/** Also initialized by logout/deadline routes, which must work on a fresh instance. */
export function getProductionVoiceServer(resolveWaveform?: Resolver, resolveAdmin?: AdminResolver, resolveVisitor?: VisitorResolver): ReturnType<typeof createVoiceServer> {
  if (resolveVisitor) shared.flowpathProductionVisitorResolver = resolveVisitor;
  if (resolveAdmin) shared.flowpathProductionAdminResolver = resolveAdmin;
  if (resolveWaveform) shared.flowpathProductionWaveformResolver = resolveWaveform;
  const local = !!localAppOrigin();
  const testerDemo = hostedTesterRuntime();
  // Dev hot reload may change registered tools while keeping the process online.
  // Retain local control handles across module replacement, including independent workers.
  const configVersion = `local-independent-supervision-v1:${creationSafetyRuntimeVersion()}`;
  if (process.env.NODE_ENV === 'development' && (shared.flowpathProductionVoiceConfigVersion !== configVersion
    || shared.flowpathProductionVoiceFactory !== createVoiceServer)) {
    shared.flowpathProductionVoiceServer = undefined;
    shared.flowpathProductionVoiceConfigVersion = configVersion;
    shared.flowpathProductionVoiceFactory = createVoiceServer;
  }
  const database = local ? localFirebaseDatabase() : firestoreVoiceDatabase(() => {
    const projectId = configuredFirebaseProjectId();
    if (!projectId) throw new Error('Firebase project is not configured');
    return getFirebaseAccountServices(projectId, process.env.FLOWPATH_FIREBASE_DATABASE_ID ?? '(default)').db;
  });
  const assertContentAllowed = async (tx: VoiceTransaction, owner: VoiceOwner) => {
    await requirePluginRevision(tx, owner.demoSource?.ownerUid ?? owner.ownerUid, owner.waveformId, owner.pluginRevision);
    if ((owner.pluginExpiresAt ?? Infinity) <= Date.now()) throw new CreationSafetyError('Plugin access expired. Unlock the plugin again.');
    if (owner.demoSource) { await curatedDemo.requireVoice(tx, owner); return; }
    if (owner.publishedRevision !== undefined) {
      await requirePublishedPreview(tx, owner, creationSafetyEnabled() ? creationReviewStore().requireSnapshotAllowed : async () => {}, creationContentDigest);
      return;
    }
    if (!creationSafetyEnabled()) return;
    const first = waveformRecord(await tx.get(`ownerWaveforms/${owner.ownerUid}`));
    const waveform = first?.id === owner.waveformId ? first
      : waveformRecord(await tx.get(`ownerWaveforms/${owner.ownerUid}/waveforms/${owner.waveformId}`));
    if (!waveform || waveform.id !== owner.waveformId || creationContentDigest(waveform) !== owner.contentDigest) throw new CreationSafetyError('Waveform content changed. Start again after its review.');
    await creationReviewStore().requireAllowed(tx, owner.ownerUid, waveform);
  };
  const store = testerDemo ? createTesterVoiceStore(database, Date.now, 'daily', assertContentAllowed, true) : createProductionVoiceStore(database, Date.now, previousPaidAdminCall, activePaidAdminCall, assertContentAllowed);
  return shared.flowpathProductionVoiceServer ??= createVoiceServer({
    publicOrigin: local ? undefined : configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN),
    trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
    // Explicit invitation-only demo uses request-owned heartbeats/cleanup.
    // An old live flag alone cannot reactivate hosted sessions.
    enabled: () => (local || hostedTesterDemo())
      && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase' && process.env.FLOWPATH_FIRESTORE_EDITION === 'standard'
      && Boolean(configuredFirebaseProjectId()) && (local || Boolean(configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN)))
      && (local || productionVoiceDeadlineConfigured()) && Boolean(localTestingVoicePolicy()),
    requestOwnedCleanup: !local,
    localRecoveryDiagnostics: local,
    requestScopedDemo: testerDemo,
    ...(testerDemo ? { authorizeStart: demoAccess.allowed, demoGrant: demoGrantId } : {}),
    resolveWaveform: (request, id) => shared.flowpathProductionWaveformResolver?.(request, id) ?? Promise.resolve(null),
    // The stable intro cookie keeps the same allowance across sign-in/out and code re-entry.
    resolvePublicVisitor: request => shared.flowpathProductionVisitorResolver?.(request) ?? publicVoiceOwner(request),
    resolveAdmin: request => shared.flowpathProductionAdminResolver?.(request) ?? Promise.resolve(null),
    production: {
      store,
      ...(local ? { supervise: superviseLocalVoice, prepareSupervisor: prewarmLocalVoiceSupervisor } : {}),
      ...(testerDemo && 'heartbeat' in store ? { heartbeat: store.heartbeat, preCancel: store.preCancel, beginConnection: store.beginConnection,
        confirmConnection: async (id: string) => {
          const meter = await store.connectionDeadline(id);
          await scheduleTesterVoiceDeadline(id, meter.controlExpiresAt);
          return store.confirmConnection(id, meter);
        } } : {}),
      policy: () => localTestingVoicePolicy(),
      scheduleDeadline: local ? scheduleLocalVoiceDeadline : testerDemo ? scheduleTesterVoiceDeadline : scheduleProductionVoiceDeadline,
    },
  }, local ? shared.flowpathLocalVoiceControllers ??= new Map() : undefined);
}

export const cancelProductionOwnerVoice = (uid: string) => getProductionVoiceServer().cancelOwner(uid);
export const expireProductionVoiceReservation = (id: string) => getProductionVoiceServer().expireReservation(id);
