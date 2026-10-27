import { createHash } from 'node:crypto';
import type { VoiceDatabase, VoiceTransaction } from './production-voice-store';
import type { KnowledgeProvider } from './knowledge-provider';
import { KnowledgeError, KNOWLEDGE_DOCUMENTS, type KnowledgeDocument, type KnowledgeView } from './knowledge-model';
import type { KnowledgeResult } from './plugin-contract';
import type { CreationIdentity } from './creation-runtime';
import type { CreationCandidate, CreationSafetyStatus, ReviewDocument } from './creation-safety';

export type StoredKnowledgeDocument = KnowledgeDocument & { digest: string; fileId: string | null; fileUncertain?: boolean; checkedAt: number; useWhenApproved?: boolean };
type StoredDocument = StoredKnowledgeDocument;
type Index = { waveformId: string; revision: number; storeId: string | null; storeUncertain?: boolean; documents: StoredDocument[] };
export type KnowledgeScope = { uid: string; waveformId: string; isCurrent(): boolean | Promise<boolean>; reviewIdentity?: CreationIdentity };
const path = (uid: string) => `waveformKnowledge/${createHash('sha256').update(uid).digest('hex')}`;
const safeQuote = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, 850).trim();
export const knowledgeReviewCandidate = (doc: Pick<StoredDocument, 'id' | 'digest' | 'filename'>): CreationCandidate => ({
  name: 'Knowledge document', initialPrompt: 'Review this entire reference document under the creation policy.',
  document: { id: doc.id, digest: doc.digest, filename: doc.filename },
});
export async function knowledgeDocumentForReview(tx: VoiceTransaction, uid: string, binding: ReviewDocument) {
  const row = await tx.get(path(uid)) as Index | null;
  const doc = row?.documents.find(d => d.id === binding.id && d.digest === binding.digest && d.filename === binding.filename);
  return doc && doc.fileId && doc.status !== 'removing' ? doc : null;
}
type Safety = {
  review(scope: KnowledgeScope, doc: StoredDocument, source?: File): Promise<CreationSafetyStatus>;
  assertAllowed(tx: VoiceTransaction, scope: KnowledgeScope, doc: StoredDocument): Promise<void>;
};

/** Provider IDs never leave this server boundary. Uploads are private, immutable versions. */
export function createKnowledgeStore(database: VoiceDatabase, provider: KnowledgeProvider, now = Date.now, safety?: Safety) {
  async function read(scope: KnowledgeScope): Promise<Index> {
    // The existing waveform safety check may itself transact. Never nest it in this transaction.
    if (!await scope.isCurrent()) throw new KnowledgeError('Sign in again to continue.', 401);
    return database.transaction(async tx => {
      const row = await tx.get(path(scope.uid)) as Index | null;
      if (row && row.waveformId !== scope.waveformId) throw new KnowledgeError('Knowledge belongs to a different waveform.', 409);
      return row ?? { waveformId: scope.waveformId, revision: 0, storeId: null, documents: [] };
    });
  }
  async function change<T>(scope: KnowledgeScope, work: (index: Index, tx: VoiceTransaction) => T | Promise<T>, completion = false) {
    // Persist an authorized provider operation's outcome even after sign-out.
    if (!completion && !await scope.isCurrent()) throw new KnowledgeError('Sign in again to continue.', 401);
    return database.transaction(async tx => {
      const index = await tx.get(path(scope.uid)) as Index | null ?? { waveformId: scope.waveformId, revision: 0, storeId: null, documents: [] };
      if (index.waveformId !== scope.waveformId) throw new KnowledgeError('Knowledge belongs to a different waveform.', 409);
      const result = await work(index, tx);
      tx.set(path(scope.uid), index);
      return result;
    });
  }
  const view = (index: Index, available: boolean): KnowledgeView => ({ waveformId: index.waveformId, revision: index.revision, available,
    documents: index.documents.map(({ id, filename, bytes, status, selected, createdAt, message }) => ({ id, filename, bytes, status, selected, createdAt, message })) });
  async function safeView(scope: KnowledgeScope, index: Index, available = true) {
    // Project a clone: displaying an unapproved legacy file must not mutate stored selection intent.
    const projected = structuredClone(index);
    if (safety) for (const doc of projected.documents.filter(d => d.status === 'ready')) {
      try { await database.transaction(tx => safety.assertAllowed(tx, scope, doc)); }
      catch { doc.status = 'review-required'; doc.selected = false; doc.message = 'Safety review is required. Choose Review document safety before using this document.'; }
    }
    return view(projected, available);
  }
  return {
    async view(scope: KnowledgeScope, available = true) {
      return safeView(scope, await read(scope), available);
    },
    async enabled(scope: KnowledgeScope) {
      const index = await read(scope);
      for (const doc of index.documents.filter(d => d.status === 'ready' && d.selected)) {
        try { if (safety) await database.transaction(tx => safety.assertAllowed(tx, scope, doc)); return true; } catch { /* Unreviewed files grant no tool. */ }
      }
      return false;
    },
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
      if (!claimed) return safeView(scope, await read(scope));
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
        // TXT originals may not be downloadable from the provider after ingestion.
        // Review the hash-bound upload bytes now, without persisting another copy.
        if (safety && /\.txt$/i.test(file.name)) {
          const stored = (await read(scope)).documents.find(d => d.id === id)!;
          await safety.review(scope, stored, file).catch(() => undefined);
        }
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
      return safeView(scope, await read(scope));
    },
    async refresh(scope: KnowledgeScope, reviewExisting = false) {
      // A refresh only checks existing indexing jobs. It never creates/re-uploads/retries them.
      const index = await read(scope);
      const due = index.documents.filter(d => (['preparing', 'uploading', 'reviewing', 'manual-review'].includes(d.status) || safety && reviewExisting && d.status === 'ready') && now() - d.checkedAt >= 3_000);
      for (const doc of due) {
        if (safety && doc.status === 'ready') {
          try { await database.transaction(tx => safety.assertAllowed(tx, scope, doc)); continue; } catch { /* New policy needs a review. */ }
        }
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
        try { status = doc.status === 'preparing' ? index.storeId && doc.fileId ? await provider.status(index.storeId, doc.fileId) : 'failed' : 'ready'; }
        catch {
          if (now() - doc.createdAt < 10 * 60_000) continue;
          status = 'failed';
        }
        if (status === 'preparing' && now() - doc.createdAt < 10 * 60_000) continue;
        if (status === 'ready' && safety) {
          await change(scope, row => { const current = row.documents.find(d => d.id === doc.id);
            if (current && current.status !== 'removing') { if (current.status === 'ready') current.useWhenApproved = current.selected;
              current.status = 'reviewing'; current.selected = false; current.message = 'Reviewing document safety…'; row.revision++; } });
          let decision: CreationSafetyStatus;
          try { decision = await safety.review(scope, doc); } catch { decision = 'manual-review'; }
          await change(scope, row => {
            const current = row.documents.find(d => d.id === doc.id);
            if (!current || current.status === 'removing') return;
            current.status = decision === 'allowed' ? 'ready' : decision === 'blocked' ? 'blocked' : decision === 'pending' ? 'reviewing' : 'manual-review';
            current.selected = decision === 'allowed' && current.useWhenApproved !== false; current.checkedAt = now();
            current.message = decision === 'allowed' ? 'This document passed its exact-version safety review.' : decision === 'blocked'
              ? 'This document violates the current creation policy and cannot be used.' : decision === 'pending' ? 'Reviewing document safety…' : 'This document needs the founder’s review before it can be used.';
            row.revision++;
          });
          continue;
        }
        await change(scope, row => {
          const current = row.documents.find(d => d.id === doc.id);
          if (current?.status !== 'preparing') return;
          current.status = status === 'ready' ? 'ready' : 'failed'; current.selected = status === 'ready';
          current.message = status === 'ready' ? 'Ready for your next conversation.' : 'This document could not be prepared. Try a text-based PDF, DOCX or TXT file.';
          row.revision++;
        });
      }
      return safeView(scope, await read(scope));
    },
    async select(scope: KnowledgeScope, id: string, selected: boolean) {
      await change(scope, async (row, tx) => {
        const doc = row.documents.find(d => d.id === id);
        if (!doc || doc.status !== 'ready') throw new KnowledgeError('Only ready documents can be used.', 409);
        if (safety && selected) await safety.assertAllowed(tx, scope, doc);
        if (doc.selected !== selected) { doc.selected = selected; row.revision++; }
      });
      return safeView(scope, await read(scope));
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
      return safeView(scope, await read(scope));
    },
    async search(scope: KnowledgeScope, query: string, signal?: AbortSignal): Promise<KnowledgeResult> {
      const index = await read(scope), selected = index.documents.filter(d => d.status === 'ready' && d.selected);
      const docs = safety ? await database.transaction(async tx => {
        const allowed: StoredDocument[] = [];
        for (const doc of selected) { try { await safety.assertAllowed(tx, scope, doc); allowed.push(doc); } catch { /* Exclude unreviewed legacy versions. */ } }
        return allowed;
      }) : selected;
      if (selected.length && !docs.length) throw new KnowledgeError('Selected documents must pass their current safety review before search.', 409);
      if (!index.storeId || !docs.length) return { revision: index.revision, passages: [] };
      const matches = await provider.search(index.storeId, docs.map(d => d.id), query, signal);
      // Re-check selection/revocation after the provider returns (including eventually consistent deletion).
      const current = await read(scope);
      if (safety) await database.transaction(async tx => { for (const doc of docs) await safety.assertAllowed(tx, scope, doc); });
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
