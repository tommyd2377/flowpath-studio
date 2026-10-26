import { KnowledgeError } from './knowledge-model';

export type ProviderMatch = { fileId: string; text: string };
export type KnowledgeProvider = {
  createStore(): Promise<string>;
  upload(file: File): Promise<string>;
  attach(storeId: string, fileId: string, documentId: string): Promise<void>;
  status(storeId: string, fileId: string): Promise<'preparing' | 'ready' | 'failed'>;
  search(storeId: string, documentIds: string[], query: string, signal?: AbortSignal): Promise<ProviderMatch[]>;
  remove(storeId: string, fileId: string): Promise<void>;
};
const providerId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);

/** Server-only managed retrieval adapter. No SDK retries, fallback model or provider error logging. */
export function openAIKnowledgeProvider(key: () => string | undefined, request: typeof fetch = fetch): KnowledgeProvider {
  async function call(path: string, method = 'GET', body?: object | FormData, signal?: AbortSignal) {
    const token = key();
    if (!token) throw new KnowledgeError('Knowledge is not configured on this server.', 503);
    const response = await request(`https://api.openai.com/v1${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) },
      body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (method === 'DELETE' && response.status === 404) return {};
    if (!response.ok) throw new KnowledgeError('The document service could not complete this request. No automatic retry was made.', 503);
    return await response.json() as Record<string, unknown>;
  }
  function readId(row: Record<string, unknown>) {
    if (!providerId(row.id)) throw new KnowledgeError('The document service returned an invalid response.', 503);
    return row.id;
  }
  const path = (storeId: string) => `/vector_stores/${encodeURIComponent(storeId)}`;
  return {
    async createStore() { return readId(await call('/vector_stores', 'POST', { name: 'Waveform Knowledge' })); },
    async upload(file) {
      const form = new FormData(); form.set('purpose', 'assistants'); form.set('file', file);
      return readId(await call('/files', 'POST', form));
    },
    async attach(storeId, fileId, documentId) {
      await call(`${path(storeId)}/files`, 'POST', { file_id: fileId, attributes: { document_id: documentId } });
    },
    async status(storeId, fileId) {
      const row = await call(`${path(storeId)}/files/${encodeURIComponent(fileId)}`);
      return row.status === 'completed' ? 'ready' : row.status === 'in_progress' ? 'preparing' : 'failed';
    },
    async search(storeId, documentIds, query, signal) {
      const row = await call(`${path(storeId)}/search`, 'POST', { query, max_num_results: 4, rewrite_query: false,
        filters: { type: 'in', key: 'document_id', value: documentIds } }, signal);
      if (!Array.isArray(row.data)) throw new KnowledgeError('The document service returned an invalid response.', 503);
      return row.data.slice(0, 4).flatMap(value => {
        if (!value || typeof value !== 'object' || !providerId(value.file_id) || !Array.isArray(value.content)) return [];
        const text = value.content.filter((c: { type?: string; text?: unknown }) => c?.type === 'text' && typeof c.text === 'string')
          .map((c: { text: string }) => c.text).join('\n').trim();
        return text ? [{ fileId: value.file_id, text }] : [];
      });
    },
    async remove(storeId, fileId) {
      await call(`${path(storeId)}/files/${encodeURIComponent(fileId)}`, 'DELETE');
      await call(`/files/${encodeURIComponent(fileId)}`, 'DELETE');
    },
  };
}
