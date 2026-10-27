import { accountServer } from './account-runtime';
import { applicationDatabase } from './application-database';
import { createKnowledgeStore, knowledgeReviewCandidate } from './knowledge-store';
import { openAIKnowledgeProvider, type KnowledgeProvider } from './knowledge-provider';
import { createKnowledgeServer } from './knowledge-server';
import { localAppOrigin } from './local-app-runtime';
import { creationActor, creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { CreationSafetyError } from './creation-safety';
import { curatedDemo } from './curated-demo-runtime';
import { FRANKLIN_DEMO_ID, publicVoiceOwner } from './public-voice-identity';
import { resolvePublishedPreview } from './published-preview';

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
// Local MVP only. Hosted activation needs explicit ingestion/storage funding and publication policy.
const available = () => fixtures || !!localAppOrigin() && process.env.FLOWPATH_LIVE_ENABLED === '1' && !!process.env.OPENAI_API_KEY;
export const knowledgeStore = createKnowledgeStore(applicationDatabase(), fixtures ? fixtureProvider() : openAIKnowledgeProvider(() => process.env.OPENAI_API_KEY), Date.now, creationSafetyEnabled() ? {
  review: async (scope, doc, source) => {
    if (!scope.reviewIdentity || !doc.fileId) throw new CreationSafetyError('Sign in again to review this document.', 403);
    const store = creationReviewStore(scope.reviewIdentity, { fileId: doc.fileId, filename: doc.filename,
      ...(source ? { sourceBytes: new Uint8Array(await source.arrayBuffer()) } : {}) });
    const result = await store.request(creationActor(scope.reviewIdentity), knowledgeReviewCandidate(doc));
    return (result.needsReview ? await store.runReview(result.record) : result.record).status;
  },
  assertAllowed: (tx, scope, doc) => creationReviewStore().requireAllowed(tx, scope.uid, knowledgeReviewCandidate(doc)).then(() => undefined),
} : undefined);
export const knowledgeServer = createKnowledgeServer({ store: knowledgeStore, available,
  publicOrigin: localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  scope: async request => {
    // File management must remain available while the waveform itself awaits review.
    const resolved = await accountServer.resolveVoiceWaveform(request, undefined, 'cleanup');
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
  if (new URL(request.url).searchParams.get('preview') === 'published') {
    const { getPaidStore, paidEnabled } = await import('./paid-runtime');
    return paidEnabled ? resolvePublishedPreview(request, id, { resolveAdmin: accountServer.resolveAdmin,
      approvedPublication: getPaidStore().approvedPublication }) : null;
  }
  const resolved = await accountServer.resolveVoiceWaveform(request, id, 'voice');
  if (!resolved) {
    if (id !== FRANKLIN_DEMO_ID) return null;
    const visitor = publicVoiceOwner(request, id);
    if (!visitor) return null;
    const row = request.method === 'DELETE' ? await curatedDemo.cleanupSnapshot() : await curatedDemo.published();
    if (!row) return null;
    return { ownerUid: row.ownerUid, waveform: { ...row.waveform, knowledge: false },
      publicVisitor: { ...await resolveDemoVisitor(request), ...visitor, contentDigest: row.contentDigest, demoSource: { ownerUid: row.ownerUid } },
      isCurrent: async () => request.method === 'DELETE' || !!await curatedDemo.published() };
  }
  const knowledge = request.method !== 'DELETE' && available() && await knowledgeStore.enabled({
    uid: resolved.ownerUid, waveformId: id, isCurrent: resolved.isCurrent,
  });
  return { ...resolved, waveform: { ...resolved.waveform, knowledge } };
}
