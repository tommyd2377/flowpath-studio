import { createHash } from 'node:crypto';
import type { VoiceDatabase } from './production-voice-store';
import type { KnowledgeProvider } from './knowledge-provider';
import { KnowledgeError, KNOWLEDGE_DOCUMENTS, type KnowledgeDocument, type KnowledgeView } from './knowledge-model';
import type { KnowledgeResult } from './plugin-contract';

type StoredDocument = KnowledgeDocument & { digest: string; fileId: string | null; fileUncertain?: boolean; checkedAt: number };
type Index = { waveformId: string; revision: number; storeId: string | null; storeUncertain?: boolean; documents: StoredDocument[] };
export type KnowledgeScope = { uid: string; waveformId: string; isCurrent(): boolean | Promise<boolean> };
const path = (uid: string) => `waveformKnowledge/${createHash('sha256').update(uid).digest('hex')}`;
const safeQuote = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 850).trim();

/** Provider IDs never leave this server boundary. Uploads are private, immutable versions. */
export function createKnowledgeStore(database: VoiceDatabase, provider: KnowledgeProvider, now = Date.now) {
  async function read(scope: KnowledgeScope): Promise<Index> {
    // The existing waveform safety check may itself transact. Never nest it in this transaction.
    if (!await scope.isCurrent()) throw new KnowledgeError('Sign in again to continue.', 401);
    return database.transaction(async tx => {
      const row = await tx.get(path(scope.uid)) as Index | null;
      if (row && row.waveformId !== scope.waveformId) throw new KnowledgeError('Knowledge belongs to a different waveform.', 409);
      return row ?? { waveformId: scope.waveformId, revision: 0, storeId: null, documents: [] };
    });
  }
  async function change<T>(scope: KnowledgeScope, work: (index: Index) => T | Promise<T>, completion = false) {
    // Persist an authorized provider operation's outcome even after sign-out.
    if (!completion && !await scope.isCurrent()) throw new KnowledgeError('Sign in again to continue.', 401);
    return database.transaction(async tx => {
      const index = await tx.get(path(scope.uid)) as Index | null ?? { waveformId: scope.waveformId, revision: 0, storeId: null, documents: [] };
      if (index.waveformId !== scope.waveformId) throw new KnowledgeError('Knowledge belongs to a different waveform.', 409);
      const result = await work(index);
      tx.set(path(scope.uid), index);
      return result;
    });
  }
  const view = (index: Index, available: boolean): KnowledgeView => ({ waveformId: index.waveformId, revision: index.revision, available,
    documents: index.documents.map(({ id, filename, bytes, status, selected, createdAt, message }) => ({ id, filename, bytes, status, selected, createdAt, message })) });
  return {
    async view(scope: KnowledgeScope, available = true) { return view(await read(scope), available); },
    async enabled(scope: KnowledgeScope) { return (await read(scope)).documents.some(d => d.status === 'ready' && d.selected); },
    async upload(scope: KnowledgeScope, id: string, file: File) {
      const digest = createHash('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex');
      const claimed = await change(scope, index => {
        const prior = index.documents.find(d => d.id === id);
        if (prior) {
          if (prior.digest !== digest || prior.filename !== file.name) throw new KnowledgeError('This upload identifier already belongs to another document.', 409);
          return false;
        }
        if (index.storeUncertain) throw new KnowledgeError('An earlier index creation could not be confirmed. Provider cleanup must be checked before another upload.', 409);
        if (index.documents.some(d => d.digest === digest && d.status !== 'removing')) throw new KnowledgeError('This document is already in Knowledge.', 409);
        if (index.documents.length >= KNOWLEDGE_DOCUMENTS) throw new KnowledgeError(`Knowledge supports ${KNOWLEDGE_DOCUMENTS} documents per waveform in this version.`, 409);
        if (index.documents.some(d => d.status === 'uploading')) throw new KnowledgeError('Another document upload is still being confirmed. Refresh its status first.', 409);
        index.documents.push({ id, filename: file.name, bytes: file.size, digest, fileId: null, checkedAt: now(),
          status: 'uploading', selected: false, createdAt: now(), message: 'Uploading…' });
        index.revision++;
        return true;
      });
      if (!claimed) return view(await read(scope), true);
      try {
        let index = await read(scope);
        if (!index.storeId) {
          // A lost creation response must not lead to another potentially billable index.
          await change(scope, row => { row.storeUncertain = true; }, true);
          const storeId = await provider.createStore();
          await change(scope, row => { row.storeId = storeId; row.storeUncertain = false; }, true);
          index = await read(scope);
        }
        await change(scope, row => { row.documents.find(d => d.id === id)!.fileUncertain = true; }, true);
        const fileId = await provider.upload(file);
        await change(scope, row => { const doc = row.documents.find(d => d.id === id)!; doc.fileId = fileId; doc.fileUncertain = false; }, true);
        await provider.attach(index.storeId!, fileId, id);
        await change(scope, row => {
          const doc = row.documents.find(d => d.id === id)!;
          doc.status = 'preparing'; doc.message = 'Preparing for questions…'; doc.checkedAt = 0; row.revision++;
        }, true);
      } catch {
        await change(scope, row => {
          const doc = row.documents.find(d => d.id === id)!;
          doc.status = 'failed'; doc.selected = false;
          doc.message = row.storeUncertain ? 'Index creation could not be confirmed. Provider reconciliation is required before another upload.'
            : doc.fileUncertain ? 'The stored-file identifier could not be confirmed. Provider reconciliation is required; this entry cannot be removed safely yet.'
            : 'Upload could not be confirmed. No automatic retry was made. Remove this entry before trying again.'; row.revision++;
        }, true).catch(() => undefined);
        throw new KnowledgeError('The upload could not be confirmed. Refresh Knowledge to see its status. No automatic retry was made.', 503);
      }
      return view(await read(scope), true);
    },
    async refresh(scope: KnowledgeScope) {
      // A refresh only checks existing indexing jobs. It never creates/re-uploads/retries them.
      const index = await read(scope);
      const due = index.documents.filter(d => (d.status === 'preparing' || d.status === 'uploading') && now() - d.checkedAt >= 3_000);
      for (const doc of due) {
        const claimed = await change(scope, row => {
          const current = row.documents.find(d => d.id === doc.id);
          if (!current || current.status !== doc.status || current.checkedAt !== doc.checkedAt) return false;
          current.checkedAt = now(); return true;
        });
        if (!claimed) continue;
        if (doc.status === 'uploading') {
          if (now() - doc.createdAt < 120_000) continue;
          await change(scope, row => {
            const current = row.documents.find(d => d.id === doc.id);
            if (current?.status === 'uploading') { current.status = 'failed'; current.message = 'Upload interrupted. Remove this entry before trying again.'; row.revision++; }
          });
          continue;
        }
        let status: 'preparing' | 'ready' | 'failed';
        try { status = index.storeId && doc.fileId ? await provider.status(index.storeId, doc.fileId) : 'failed'; }
        catch {
          if (now() - doc.createdAt < 10 * 60_000) continue;
          status = 'failed';
        }
        if (status === 'preparing' && now() - doc.createdAt < 10 * 60_000) continue;
        await change(scope, row => {
          const current = row.documents.find(d => d.id === doc.id);
          if (current?.status !== 'preparing') return;
          current.status = status === 'ready' ? 'ready' : 'failed'; current.selected = status === 'ready';
          current.message = status === 'ready' ? 'Ready for your next conversation.' : 'This document could not be prepared. Try a text-based PDF, DOCX or TXT file.';
          row.revision++;
        });
      }
      return view(await read(scope), true);
    },
    async select(scope: KnowledgeScope, id: string, selected: boolean) {
      await change(scope, row => {
        const doc = row.documents.find(d => d.id === id);
        if (!doc || doc.status !== 'ready') throw new KnowledgeError('Only ready documents can be used.', 409);
        if (doc.selected !== selected) { doc.selected = selected; row.revision++; }
      });
      return view(await read(scope), true);
    },
    async remove(scope: KnowledgeScope, id: string) {
      const target = await change(scope, row => {
        const doc = row.documents.find(d => d.id === id);
        if (!doc) return null;
        if (doc.fileUncertain) throw new KnowledgeError('The upload result is uncertain. Provider reconciliation is required before this entry can be removed.', 409);
        if (doc.status === 'uploading') throw new KnowledgeError('Wait for this upload to finish before removing it.', 409);
        doc.selected = false; doc.status = 'removing'; doc.message = 'Unavailable to the waveform. Removing stored file…'; row.revision++;
        return { fileId: doc.fileId, storeId: row.storeId };
      });
      if (target?.fileId && target.storeId) {
        try { await provider.remove(target.storeId, target.fileId); }
        catch { throw new KnowledgeError('The document is disabled. Stored-file removal is not confirmed; use Remove to retry cleanup.', 503); }
      }
      await change(scope, row => { row.documents = row.documents.filter(d => d.id !== id); row.revision++; });
      return view(await read(scope), true);
    },
    async search(scope: KnowledgeScope, query: string, signal?: AbortSignal): Promise<KnowledgeResult> {
      const index = await read(scope), docs = index.documents.filter(d => d.status === 'ready' && d.selected);
      if (!index.storeId || !docs.length) return { revision: index.revision, passages: [] };
      const matches = await provider.search(index.storeId, docs.map(d => d.id), query, signal);
      // Re-check selection/revocation after the provider returns (including eventually consistent deletion).
      const current = await read(scope);
      if (signal?.aborted || current.revision !== index.revision) throw new KnowledgeError('Knowledge changed during this search. Ask again using the current documents.', 409);
      const passages = matches.slice(0, 4).flatMap(match => {
        const doc = docs.find(d => d.fileId === match.fileId), quote = safeQuote(match.text);
        return doc && quote ? [{ id: '', documentId: doc.id, filename: doc.filename, quote }] : [];
      }).map((p, i) => ({ ...p, id: `source_${i + 1}` }));
      return { revision: index.revision, passages };
    },
  };
}
export type KnowledgeStore = ReturnType<typeof createKnowledgeStore>;
