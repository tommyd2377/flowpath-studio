import { accountServer } from './account-runtime';
import { applicationDatabase } from './application-database';
import { createKnowledgeStore } from './knowledge-store';
import { openAIKnowledgeProvider, type KnowledgeProvider } from './knowledge-provider';
import { createKnowledgeServer } from './knowledge-server';
import { localAppOrigin } from './local-app-runtime';

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
export const knowledgeStore = createKnowledgeStore(applicationDatabase(), fixtures ? fixtureProvider() : openAIKnowledgeProvider(() => process.env.OPENAI_API_KEY));
export const knowledgeServer = createKnowledgeServer({ store: knowledgeStore, available,
  publicOrigin: localAppOrigin() ? undefined : process.env.FLOWPATH_PUBLIC_ORIGIN,
  trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST,
  scope: async request => {
    const resolved = await accountServer.resolveVoiceWaveform(request);
    return resolved ? { uid: resolved.ownerUid, waveformId: resolved.waveform.id, isCurrent: resolved.isCurrent } : null;
  },
});
export async function withWaveformKnowledge(request: Request, id: string) {
  const resolved = await accountServer.resolveVoiceWaveform(request, id);
  if (!resolved) return null;
  const knowledge = request.method !== 'DELETE' && available() && await knowledgeStore.enabled({
    uid: resolved.ownerUid, waveformId: id, isCurrent: resolved.isCurrent,
  });
  return { ...resolved, waveform: { ...resolved.waveform, knowledge } };
}
