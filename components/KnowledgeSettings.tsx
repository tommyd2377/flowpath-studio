'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, FileText, Upload, Trash2 } from 'lucide-react';
import type { KnowledgeView } from '@/lib/knowledge-model';
import { validKnowledgeResult, type KnowledgeResult } from '@/lib/plugin-contract';
import BrandLoader from './BrandLoader';

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Knowledge could not be loaded.');
  return body as T;
}

export default function KnowledgeSettings({ waveformId }: { waveformId?: string }) {
  const endpoint = useCallback((path: string) => waveformId ? `${path}?id=${waveformId}` : path, [waveformId]);
  const [view, setView] = useState<KnowledgeView | null>(null);
  const [loading, setLoading] = useState(true), [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [query, setQuery] = useState(''), [result, setResult] = useState<KnowledgeResult | null>(null);
  const [adult, setAdult] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), revision = useRef(-1);
  const accept = useCallback((next: KnowledgeView, expected: number) => {
    if (generation.current !== expected || next.revision < revision.current) return;
    revision.current = next.revision; setView(next);
  }, []);
  useEffect(() => {
    const load = () => {
      const expected = ++generation.current;
      revision.current = -1; setView(null); setResult(null); setQuery(''); setError(''); setMessage(''); setBusyAction(null); setAdult(false); setLoading(true);
      void fetch(endpoint('/api/knowledge'), { cache: 'no-store' }).then(read<KnowledgeView>).then(next => accept(next, expected))
        .catch(e => { if (generation.current === expected) setError(e.message); })
        .finally(() => { if (generation.current === expected) setLoading(false); });
    };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', load); window.addEventListener('flowpath-account-change', load); load();
    const invalidate = () => { generation.current++; };
    return () => { invalidate(); channel?.close(); window.removeEventListener('flowpath-account-change', load); };
  }, [accept, endpoint]);
  const preparing = !!view?.documents.some(d => d.status === 'preparing' || d.status === 'uploading' || d.status === 'reviewing');
  useEffect(() => {
    if (!preparing || busy) return;
    const controller = new AbortController(), expected = generation.current;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetch(endpoint('/api/knowledge/refresh'), { method: 'POST', signal: controller.signal }).then(read<KnowledgeView>)
        .then(next => accept(next, expected)).catch(() => { /* Keep the stored status; the user can refresh explicitly. */ });
    }, 4_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [preparing, busy, accept, endpoint]);

  async function mutation(work: () => Promise<KnowledgeView>, success: string, action = 'upload') {
    const expected = generation.current;
    setBusyAction(action); setError(''); setMessage(''); setResult(null);
    try { const next = await work(); accept(next, expected); if (generation.current === expected) setMessage(success); }
    catch (e) {
      if (generation.current === expected) setError(e instanceof Error ? e.message : 'The request could not be completed.');
      await fetch(endpoint('/api/knowledge'), { cache: 'no-store' }).then(read<KnowledgeView>).then(next => accept(next, expected)).catch(() => undefined);
    }
    finally { if (generation.current === expected) setBusyAction(null); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0]; if (!file) return;
    const form = new FormData(); form.set('file', file);
    await mutation(() => fetch(endpoint('/api/knowledge'), { method: 'POST', headers: { ...(adult ? { 'X-FlowPath-Adult': '1' } : {}), 'X-FlowPath-Upload': crypto.randomUUID() }, body: form })
      .then(read<KnowledgeView>), 'Uploaded. We’re preparing it for questions. You can keep editing your waveform.');
    if (fileInput.current) fileInput.current.value = '';
  }
  async function preview(event: FormEvent) {
    event.preventDefault(); if (!view) return;
    const expected = generation.current; setBusyAction('preview'); setError(''); setMessage('');
    try {
      const next = await fetch(`/api/knowledge/search?id=${encodeURIComponent(view.waveformId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waveformId: view.waveformId, query }) }).then(read<KnowledgeResult>);
      if (!validKnowledgeResult(next)) throw new Error('The search returned an invalid response.');
      if (generation.current === expected) setResult(next);
    } catch (e) { if (generation.current === expected) setError(e instanceof Error ? e.message : 'Search was unavailable.'); }
    finally { if (generation.current === expected) setBusyAction(null); }
  }
  return <main className="account-page knowledge-page">
    <Link className="account-back" href={waveformId ? `/account?id=${waveformId}` : "/account"}>← Waveform settings</Link>
    <div className="knowledge-title"><BookOpen aria-hidden="true" /><h1>Knowledge</h1></div>
    <p className="knowledge-intro">Give your waveform something to draw from.</p>
    <p className="field-help">Upload documents, then ask about them by voice. Ask “Show the relevant passages and sources” to open them in Text Box.</p>
    {loading && <BrandLoader label="Loading your documents…" />}
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p className="account-status" role="status">{message}</p>}
    {view && <>
      {view.storage && <p className="field-help" role="status">Platform document-storage estimate: ${(view.storage.estimatedMonthlyMicroUsd / 1_000_000).toFixed(2)} / ${(view.storage.budgetMicroUsd / 1_000_000).toFixed(2)} per month. Includes temporary indexing reservations, without assuming free storage. {view.storage.estimatedMonthlyMicroUsd >= view.storage.budgetMicroUsd * .8 ? 'Storage is approaching its budget. ' : ''}{!view.storage.uploadCapacityAvailable ? 'New uploads need indexing to finish or storage to be freed. ' : ''}This estimates document storage, not your total API bill.</p>}
      <form className="knowledge-upload" onSubmit={event => void upload(event)}>
        {view.requiresAdultConsent && <label className="knowledge-consent"><input type="checkbox" required checked={adult} disabled={busy} onChange={event => setAdult(event.target.checked)} /> I am at least 18 and have permission to upload these documents.</label>}
        <Upload aria-hidden="true" /><label htmlFor="knowledge-file">Add a document</label>
        <input ref={fileInput} id="knowledge-file" type="file" accept=".pdf,.docx,.txt" required disabled={busy || !view.available} aria-describedby="knowledge-upload-help" />
        <button className="primary-button" disabled={busy || !view.available} aria-busy={busyAction === 'upload'}>{busyAction === 'upload' && <BrandLoader variant="inline" />}{busyAction === 'upload' ? 'Uploading…' : 'Upload document'}</button>
        <p id="knowledge-upload-help" className="field-help">PDF, DOCX or UTF-8 TXT · 10 MB each · up to 20 documents. Use text-based files; scanned images may not be readable.</p>
      </form>
      {!view.available && <p role="status">Knowledge needs the configured document service enabled on this server.</p>}
      <p className="field-help">Documents are processed and stored by OpenAI using this app’s configured account. Processing and storage can incur API costs. Files stay until you remove them. Remove a document to delete its stored file and search copy. This version keeps Knowledge private to you; published visitor links do not receive it.</p>
      <div className="knowledge-library" aria-label="Knowledge documents">
        {!view.documents.length && <div className="knowledge-empty"><FileText aria-hidden="true" /><p>Your knowledge library starts here.</p><span>Ready documents become available in your next conversation.</span></div>}
        {view.documents.map(doc => <article className="knowledge-document" key={doc.id}>
          <FileText aria-hidden="true" /><div className="knowledge-document__body"><h2>{doc.filename}</h2>
            <p role="status">{(['preparing', 'uploading', 'reviewing', 'removing'].includes(doc.status) || busyAction === `select:${doc.id}`) && <BrandLoader variant="inline" />}{busyAction === `select:${doc.id}` ? 'Updating…' : doc.status === 'ready' ? 'Ready' : doc.status === 'preparing' ? 'Preparing' : doc.status === 'uploading' ? 'Uploading' : doc.status === 'reviewing' ? 'Reviewing safety' : doc.status === 'review-required' ? 'Safety review required' : doc.status === 'manual-review' ? 'Founder review required' : doc.status === 'blocked' ? 'Blocked by safety policy' : doc.status === 'removing' ? 'Removal pending' : 'Needs attention'} · {Math.ceil(doc.bytes / 1024)} KB</p>
            <p className="field-help">{doc.message}</p>
            {doc.status === 'ready' && <label><input type="checkbox" checked={doc.selected} disabled={busy} onChange={event => {
              const selected = event.target.checked;
              setView(current => current ? { ...current, documents: current.documents.map(item => item.id === doc.id ? { ...item, selected } : item) } : current);
              void mutation(() => fetch(endpoint('/api/knowledge'), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, selected }) }).then(read<KnowledgeView>), selected ? 'Document enabled for your waveform.' : 'Document disabled.', `select:${doc.id}`);
            }} /> Use in my waveform</label>}
          </div><button type="button" className="secondary-button" disabled={busy || doc.status === 'uploading'} aria-label={`Remove ${doc.filename}`} aria-busy={busyAction === `remove:${doc.id}`} onClick={() => void mutation(() => fetch(endpoint('/api/knowledge'), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id }) }).then(read<KnowledgeView>), 'Document removed.', `remove:${doc.id}`)}>{busyAction === `remove:${doc.id}` ? <BrandLoader variant="inline" /> : <Trash2 aria-hidden="true" />}<span>Remove</span></button>
        </article>)}
      </div>
      {(preparing || view.documents.some(d => d.status === 'review-required' || d.status === 'manual-review')) && <button type="button" className="secondary-button" disabled={busy} aria-busy={busyAction === 'refresh'} onClick={() => void mutation(() => fetch(endpoint('/api/knowledge/refresh'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewExisting: true }) }).then(read<KnowledgeView>), 'Document status refreshed.', 'refresh')}>{busyAction === 'refresh' && <BrandLoader variant="inline" />}{view.documents.some(d => d.status === 'review-required') ? 'Review document safety' : 'Refresh preparation status'}</button>}
      {view.creationReviewPaused ? <p className="field-help">Creation review is paused. Indexed documents can be selected for private use.</p>
        : <p className="field-help">Documents must pass safety review before use. DOCX files require founder review because embedded images are not covered by the automatic check; a PDF can include those pages in automatic review.</p>}
      {view.documents.some(d => d.status === 'ready' && d.selected) && <form className="knowledge-preview" onSubmit={event => void preview(event)}>
        <h2>Try a question</h2><label htmlFor="knowledge-question">What would you like to find?</label>
        <input id="knowledge-question" value={query} onChange={e => setQuery(e.target.value)} maxLength={1000} required disabled={busy} />
        <button className="secondary-button" disabled={busy || !view.available} aria-busy={busyAction === 'preview'}>{busyAction === 'preview' && <BrandLoader variant="inline" />}Find passages</button>
        <p className="field-help">Preview the passages your voice can use. This searches documents without starting a voice call.</p>
      </form>}
      {result && <section className="knowledge-results" aria-label="Search results">
        {!result.passages.length && <p role="status">No relevant passages found. Try a more specific question.</p>}
        {result.passages.map(p => <article key={p.id}><blockquote>{p.quote}</blockquote><p>{p.filename}</p></article>)}
      </section>}
      <p><Link className="secondary-button" href={`/w/${view.waveformId}`}>Preview draft</Link></p>
      <p className="field-help">Knowledge answers aloud without opening a panel. Install Text Box and save your waveform draft to show passages and sources. Changes apply to new conversations; disabling or removing a document also blocks future searches in an existing call.</p>
    </>}
  </main>;
}
