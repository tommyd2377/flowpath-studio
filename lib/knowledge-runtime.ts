import { localPluginAccess, ownerPluginPlayback, pluginAudienceProjection, curatedPluginPlayback, withKnowledgeAccess } from './plugin-access-runtime';
import { creationContentDigest } from './creation-safety';
import { curatedVisitorVoice } from './curated-demo';
import { requestWaveformId } from './account-server';
import { accountServer } from './account-runtime';
import { applicationDatabase } from './application-database';
import { createKnowledgeStore, knowledgeReviewCandidate } from './knowledge-store';
import { openAIKnowledgeProvider, type KnowledgeProvider } from './knowledge-provider';
import { createKnowledgeServer } from './knowledge-server';
import { localAppOrigin } from './local-app-runtime';
import { creationActor, creationReviewStore, creationSafetyEnabled, creationSafetyPaused } from './creation-runtime';
import { CreationSafetyError } from './creation-safety';
import { curatedDemo } from './curated-demo-runtime';
import { FRANKLIN_DEMO_ID, publicVoiceOwner } from './public-voice-identity';
import { resolvePublishedPreview } from './published-preview';
import { hostedKnowledgeConfigured } from './knowledge-config';
import { createKnowledgeStorageBudget } from './knowledge-storage-budget';

const fixtures = process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local' && process.env.FLOWPATH_KNOWLEDGE_FIXTURES === '1';
const shared = globalThis as typeof globalThis & { flowpathKnowledgeFixtures?: Map<string, string> };
function fixtureProvider(): KnowledgeProvider {
  const files = shared.flowpathKnowledgeFixtures ??= new Map();
  return {
    createStore: async () => 'fixture-store',
    upload: async file => { const id = `fixture-${crypto.randomUUID()}`; files.set(id, await file.text()); return id; },
    attach: async () => {}, status: async () => 'ready',
    search: async () => [...files].map(([fileId, text]) => ({ fileId, text })),
    remove: async (_storeId, fileId) => { files.delete(fileId); },
  };
}
// Explicit private hosted activation; public/published visitors never receive documents.
const hosted = hostedKnowledgeConfigured(process.env);
const available = () => fixtures || (!!localAppOrigin() || hosted) && process.env.FLOWPATH_LIVE_ENABLED === '1' && !!process.env.OPENAI_API_KEY;
export const knowledgeStore = createKnowledgeStore(applicationDatabase(), fixtures ? fixtureProvider() : openAIKnowledgeProvider(() => process.env.OPENAI_API_KEY), Date.now, creationSafetyEnabled() ? {
  review: async (scope, doc, source) => {
    if (!scope.reviewIdentity || !doc.fileId) throw new CreationSafetyError('Sign in again to review this document.', 403);
    const store = creationReviewStore(scope.reviewIdentity, { fileId: doc.fileId, filename: doc.filename,
      ...(source ? { sourceBytes: new Uint8Array(await source.arrayBuffer()) } : {}) });
    const result = await store.request(creationActor(scope.reviewIdentity), knowledgeReviewCandidate(doc));
    return (result.needsReview ? await store.runReview(result.record) : result.record).status;
  },
  assertAllowed: (tx, scope, doc) => creationReviewStore().requireAllowed(tx, scope.uid, knowledgeReviewCandidate(doc)).then(() => undefined),
} : undefined, hosted ? createKnowledgeStorageBudget() : undefined, creationSafetyPaused());
export const knowledgeServer = createKnowledgeServer({ store: knowledgeStore, available, requireAdultConsent: hosted, authorizeSearch: withKnowledgeAccess,
  publicOrigin: localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  scope: async request => {
    // File management must remain available while the waveform itself awaits review.
    const header = request.headers.get('X-FlowPath-Waveform');
    const id = requestWaveformId(request) ?? (header && /^[0-9a-f-]{36}$/.test(header) ? header : undefined);
    const resolved = await accountServer.resolveVoiceWaveform(request, id, 'cleanup');
    const identity = await accountServer.resolveIdentity(request);
    return resolved && identity && resolved.ownerUid === identity.owner.uid ? { uid: resolved.ownerUid,
      waveformId: resolved.waveform.id, isCurrent: identity.isCurrent, reviewIdentity: identity } : null;
  },
});
export async function resolveDemoVisitor(request: Request) {
  const visitor = publicVoiceOwner(request);
  if (!visitor) return null;
  const identity = await accountServer.resolveIdentity(request);
  return identity && identity.owner.role !== 'admin' && identity.accountSessionId && await identity.isCurrent()
    ? { ...visitor, tester: { uid: identity.owner.uid, accountSessionId: identity.accountSessionId, founder: false } } : visitor;
}
export async function withWaveformKnowledge(request: Request, id: string) {
  const readOnly = request.method === 'GET' && request.headers.get('X-FlowPath-Prepare') === '1';
  if (new URL(request.url).searchParams.get('preview') === 'published') {
    const { getPaidStore, paidEnabled } = await import('./paid-runtime');
    const preview = paidEnabled ? await resolvePublishedPreview(request, id, { resolveAdmin: accountServer.resolveAdmin,
      approvedPublication: getPaidStore().approvedPublication }) : null;
    if (!preview || request.method === 'DELETE') return preview;
    const projected = await pluginAudienceProjection(preview.ownerUid, id, preview.waveform);
    return { ...preview, waveform: projected.waveform, contentDigest: creationContentDigest(preview.waveform), pluginRevision: projected.revision };
  }
  const resolved = await accountServer.resolveVoiceWaveform(request, id, 'voice');
  if (!resolved) {
    if (id !== FRANKLIN_DEMO_ID) return null;
    const visitor = publicVoiceOwner(request, id);
    if (!visitor) return null;
    const row = request.method === 'DELETE' ? await curatedDemo.cleanupSnapshot() : await curatedDemo.published(readOnly);
    if (!row) return null;
    const projected = readOnly || request.method === 'DELETE' ? { waveform: curatedVisitorVoice(row.waveform), revision: undefined, locked: [], expiresAt: undefined }
      : await curatedPluginPlayback(request, row.ownerUid, id, curatedVisitorVoice(row.waveform));
    return { ownerUid: row.ownerUid, waveform: projected.waveform, pluginEvents: projected.locked.length > 0,
      ...(request.method === 'POST' && localPluginAccess() ? { pluginPlayback: { locked: projected.locked,
        ...(projected.expiresAt === undefined ? {} : { expiresAt: projected.expiresAt }),
        textPanel: projected.waveform.textPanel ?? null, visualDisplay: null } } : {}),
      publicVisitor: { ...await resolveDemoVisitor(request), ...visitor, contentDigest: row.contentDigest, ...(projected.revision === undefined ? {} : { pluginRevision: projected.revision }), ...(projected.expiresAt === undefined ? {} : { pluginExpiresAt: projected.expiresAt }), demoSource: { ownerUid: row.ownerUid } },
      isCurrent: async () => request.method === 'DELETE' || !!await curatedDemo.published(readOnly) };
  }
  // Only creation uses the registered Knowledge tool; readiness and cleanup do not.
  const checkKnowledge = () => request.method === 'POST' && available() ? knowledgeStore.enabled({
    uid: resolved.ownerUid, waveformId: id, isCurrent: resolved.isCurrent,
  }) : Promise.resolve(false);
  let knowledge: boolean;
  let view: Awaited<ReturnType<typeof ownerPluginPlayback>> | undefined;
  if (request.method === 'POST' && localPluginAccess()) {
    // Both paths retain their own fresh authorization and exact-content checks.
    const [knowledgeResult, viewResult] = await Promise.allSettled([
      checkKnowledge(), ownerPluginPlayback(request, id, resolved.waveform),
    ]);
    if (knowledgeResult.status === 'rejected') throw knowledgeResult.reason;
    if (viewResult.status === 'rejected') throw viewResult.reason;
    knowledge = knowledgeResult.value;
    view = { ...viewResult.value, waveform: { ...viewResult.value.waveform,
      knowledge: knowledge && viewResult.value.allowed.includes('knowledge') } };
  } else knowledge = await checkKnowledge();
  const waveform = { ...resolved.waveform, knowledge };
  if (readOnly || !localPluginAccess() || request.method === 'DELETE') return { ...resolved, waveform };
  view ??= await ownerPluginPlayback(request, id, waveform);
  return { ...resolved, waveform: view.waveform, pluginRevision: view.revision, pluginExpiresAt: view.expiresAt,
    ...(request.method === 'POST' ? { pluginPlayback: { locked: view.locked,
      ...(view.expiresAt === undefined ? {} : { expiresAt: view.expiresAt }),
      textPanel: view.waveform.textPanel ?? null, visualDisplay: view.waveform.visualDisplay ?? null } } : {}),
    pluginEvents: view.locked.length > 0, contentDigest: creationContentDigest(waveform) };
}
