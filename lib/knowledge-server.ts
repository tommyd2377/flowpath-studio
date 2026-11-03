import { PluginAccessError } from './plugin-access';
import { isAllowedRequest } from './request-origin';
import { readBody } from './account-server';
import type { KnowledgeScope, KnowledgeStore } from './knowledge-store';
import { KnowledgeError, type KnowledgeView, KNOWLEDGE_FILE_BYTES, knowledgeFilename, knowledgeId } from './knowledge-model';

type Options = { authorizeSearch?: (request: Request, id: string, search: () => Promise<unknown>) => Promise<unknown>; store: KnowledgeStore; scope(request: Request): Promise<KnowledgeScope | null>; available(): boolean;
  requireAdultConsent?: boolean; publicOrigin?: string; trustedProxyHost?: string };
const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function uploadBody(request: Request) {
  const type = request.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data;') || !request.body) throw new KnowledgeError('Choose a document to upload.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  const timer = setTimeout(() => { void reader.cancel(); }, 30_000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > KNOWLEDGE_FILE_BYTES + 64 * 1024) { await reader.cancel(); throw new KnowledgeError('Documents must be 10 MB or smaller.', 413); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const buffer = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  const form = await new Response(buffer, { headers: { 'Content-Type': type } }).formData();
  const file = form.get('file');
  if (!(file instanceof File) || [...form.keys()].length !== 1 || !file.size || file.size > KNOWLEDGE_FILE_BYTES) throw new KnowledgeError('Choose one document, up to 10 MB.');
  knowledgeFilename(file.name);
  const data = new Uint8Array(await file.arrayBuffer());
  if (/\.pdf$/i.test(file.name) && new TextDecoder().decode(data.slice(0, 5)) !== '%PDF-'
    || /\.docx$/i.test(file.name) && (data[0] !== 0x50 || data[1] !== 0x4b)) throw new KnowledgeError('The file contents do not match its document type.');
  if (/\.txt$/i.test(file.name)) {
    try { if (new TextDecoder('utf-8', { fatal: true }).decode(data).includes('\0')) throw new Error(); }
    catch { throw new KnowledgeError('TXT documents must contain UTF-8 text.'); }
  }
  return file;
}

/** Every route derives scope from the current account, never from a supplied owner/provider ID. */
export function createKnowledgeServer(options: Options) {
  const handle = (work: (request: Request, scope: KnowledgeScope) => Promise<Response>) => async (request: Request) => {
    try {
      if (!isAllowedRequest(request, request.method !== 'GET', options.publicOrigin, options.trustedProxyHost)) throw new KnowledgeError('Only requests from this application are allowed.', 403);
      const scope = await options.scope(request);
      if (!scope) throw new KnowledgeError('Sign in and save your waveform to use Knowledge.', 401);
      return await work(request, scope);
    } catch (error) { return json({ error: error instanceof KnowledgeError ? error.message : 'Knowledge is temporarily unavailable.' }, error instanceof KnowledgeError ? error.status : 503); }
  };
  const present = (view: KnowledgeView) => ({ ...view, requiresAdultConsent: options.requireAdultConsent === true });
  const requireAvailable = () => { if (!options.available()) throw new KnowledgeError('Knowledge is not enabled on this server.', 503); };
  return {
    GET: handle(async (_request, scope) => json(present(await options.store.view(scope, options.available())))),
    POST: handle(async (request, scope) => {
      requireAvailable();
      if (options.requireAdultConsent && request.headers.get('X-FlowPath-Adult') !== '1') throw new KnowledgeError('Confirm you are at least 18 before uploading documents.', 403);
      const id = request.headers.get('X-FlowPath-Upload');
      if (!knowledgeId(id)) throw new KnowledgeError('A valid upload identifier is required.');
      return json(present(await options.store.upload(scope, id, await uploadBody(request))), 202);
    }),
    PATCH: handle(async (request, scope) => {
      const body = await readBody(request);
      if (Object.keys(body).length !== 2 || !knowledgeId(body.id) || typeof body.selected !== 'boolean') throw new KnowledgeError('Choose a ready document.');
      return json(present(await options.store.select(scope, body.id, body.selected)));
    }),
    DELETE: handle(async (request, scope) => {
      const body = await readBody(request);
      if (Object.keys(body).length !== 1 || !knowledgeId(body.id)) throw new KnowledgeError('Choose a document to remove.');
      return json(present(await options.store.remove(scope, body.id)));
    }),
    refresh: handle(async (request, scope) => {
      requireAvailable();
      const body = request.headers.get('content-type')?.includes('application/json') ? await readBody(request) : {};
      if (Object.keys(body).some(key => key !== 'reviewExisting') || body.reviewExisting !== undefined && typeof body.reviewExisting !== 'boolean') throw new KnowledgeError('Invalid refresh request.');
      return json(present(await options.store.refresh(scope, body.reviewExisting === true)));
    }),
    search: handle(async (request, scope) => {
      requireAvailable();
      const body = await readBody(request, 6_000);
      if (Object.keys(body).length !== 2 || body.waveformId !== scope.waveformId || typeof body.query !== 'string'
        || !body.query.trim() || body.query.length > 1_000) throw new KnowledgeError('Use a question up to 1,000 characters for your own waveform.');
      const query = body.query.trim();
      const work = () => options.store.search(scope, query, request.signal);
      try { return json(await (options.authorizeSearch ? options.authorizeSearch(request, scope.waveformId, work) : work()) as object); }
      catch (error) { if (error instanceof PluginAccessError) throw new KnowledgeError(error.message, error.status); throw error; }
    }),
  };
}
