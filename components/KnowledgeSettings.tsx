'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, FileText, Upload, Trash2 } from 'lucide-react';
import type { KnowledgeView } from '@/lib/knowledge-model';
import { validKnowledgeResult, type KnowledgeResult } from '@/lib/plugin-contract';

async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Knowledge could not be loaded.');
  return body as T;
}

export default function KnowledgeSettings() {
  const [view, setView] = useState<KnowledgeView | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [query, setQuery] = useState(''), [result, setResult] = useState<KnowledgeResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0), revision = useRef(-1);
  const accept = useCallback((next: KnowledgeView, expected: number) => {
    if (generation.current !== expected || next.revision < revision.current) return;
    revision.current = next.revision; setView(next);
  }, []);
  useEffect(() => {
    const load = () => {
      const expected = ++generation.current;
      revision.current = -1; setView(null); setResult(null); setQuery(''); setError(''); setMessage(''); setBusy(false); setLoading(true);
      void fetch('/api/knowledge', { cache: 'no-store' }).then(read<KnowledgeView>).then(next => accept(next, expected))
        .catch(e => { if (generation.current === expected) setError(e.message); })
        .finally(() => { if (generation.current === expected) setLoading(false); });
    };
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('flowpath-account') : null;
    channel?.addEventListener('message', load); window.addEventListener('flowpath-account-change', load); load();
    const invalidate = () => { generation.current++; };
    return () => { invalidate(); channel?.close(); window.removeEventListener('flowpath-account-change', load); };
  }, [accept]);
  const preparing = !!view?.documents.some(d => d.status === 'preparing' || d.status === 'uploading' || d.status === 'reviewing');
  useEffect(() => {
    if (!preparing || busy) return;
    const controller = new AbortController(), expected = generation.current;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void fetch('/api/knowledge/refresh', { method: 'POST', signal: controller.signal }).then(read<KnowledgeView>)
        .then(next => accept(next, expected)).catch(() => { /* Keep the stored status; the user can refresh explicitly. */ });
    }, 4_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [preparing, busy, accept]);

  async function mutation(work: () => Promise<KnowledgeView>, success: string) {
    const expected = generation.current;
    setBusy(true); setError(''); setMessage(''); setResult(null);
    try { const next = await work(); accept(next, expected); if (generation.current === expected) setMessage(success); }
    catch (e) {
      if (generation.current === expected) setError(e instanceof Error ? e.message : 'The request could not be completed.');
      await fetch('/api/knowledge', { cache: 'no-store' }).then(read<KnowledgeView>).then(next => accept(next, expected)).catch(() => undefined);
    }
    finally { if (generation.current === expected) setBusy(false); }
  }
  async function upload(event: FormEvent) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0]; if (!file) return;
    const form = new FormData(); form.set('file', file);
    await mutation(() => fetch('/api/knowledge', { method: 'POST', headers: { 'X-FlowPath-Upload': crypto.randomUUID() }, body: form })
      .then(read<KnowledgeView>), 'Uploaded. We’re preparing it for questions. You can keep editing your waveform.');
    if (fileInput.current) fileInput.current.value = '';
  }
  async function preview(event: FormEvent) {
    event.preventDefault(); if (!view) return;
    const expected = generation.current; setBusy(true); setError(''); setMessage(''); setResult(null);
    try {
      const next = await fetch('/api/knowledge/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waveformId: view.waveformId, query }) }).then(read<KnowledgeResult>);
      if (!validKnowledgeResult(next)) throw new Error('The search returned an invalid response.');
      if (generation.current === expected) setResult(next);
    } catch (e) { if (generation.current === expected) setError(e instanceof Error ? e.message : 'Search was unavailable.'); }
    finally { if (generation.current === expected) setBusy(false); }
  }
  return <main className="account-page knowledge-page">
    <Link className="account-back" href="/account">← Waveform settings</Link>
    <div className="knowledge-title"><BookOpen aria-hidden="true" /><h1>Knowledge</h1></div>
    <p className="knowledge-intro">Give your waveform something to draw from.</p>
    <p className="field-help">Upload documents, then ask about them by voice. Ask “Show the relevant passages and sources” to open them in Text Box.</p>
    {loading && <p role="status">Loading your documents…</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p className="account-status" role="status">{message}</p>}
    {view && <>
      <form className="knowledge-upload" onSubmit={event => void upload(event)}>
        <Upload aria-hidden="true" /><label htmlFor="knowledge-file">Add a document</label>
        <input ref={fileInput} id="knowledge-file" type="file" accept=".pdf,.docx,.txt" required disabled={busy || !view.available} aria-describedby="knowledge-upload-help" />
        <button className="primary-button" disabled={busy || !view.available}>{busy ? 'Working…' : 'Upload document'}</button>
        <p id="knowledge-upload-help" className="field-help">PDF, DOCX or UTF-8 TXT · 10 MB each · up to 20 documents. Use text-based files; scanned images may not be readable.</p>
      </form>
      {!view.available && <p role="status">Knowledge needs the configured document service enabled on this server.</p>}
      <p className="field-help">Documents are processed and stored by OpenAI using this app’s configured account. Processing and storage can incur API costs. Remove a document to delete its stored file. This version keeps Knowledge private to you; published visitor links do not receive it.</p>
      <div className="knowledge-library" aria-label="Knowledge documents">
        {!view.documents.length && <div className="knowledge-empty"><FileText aria-hidden="true" /><p>Your knowledge library starts here.</p><span>Ready documents become available in your next conversation.</span></div>}
        {view.documents.map(doc => <article className="knowledge-document" key={doc.id}>
          <FileText aria-hidden="true" /><div className="knowledge-document__body"><h2>{doc.filename}</h2>
            <p role="status">{doc.status === 'ready' ? 'Ready' : doc.status === 'preparing' ? 'Preparing' : doc.status === 'uploading' ? 'Uploading' : doc.status === 'reviewing' ? 'Reviewing safety' : doc.status === 'review-required' ? 'Safety review required' : doc.status === 'manual-review' ? 'Founder review required' : doc.status === 'blocked' ? 'Blocked by safety policy' : doc.status === 'removing' ? 'Removal pending' : 'Needs attention'} · {Math.ceil(doc.bytes / 1024)} KB</p>
            <p className="field-help">{doc.message}</p>
            {doc.status === 'ready' && <label><input type="checkbox" checked={doc.selected} disabled={busy} onChange={event => {
              const selected = event.target.checked;
              setView(current => current ? { ...current, documents: current.documents.map(item => item.id === doc.id ? { ...item, selected } : item) } : current);
              void mutation(() => fetch('/api/knowledge', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id, selected }) }).then(read<KnowledgeView>), selected ? 'Document enabled for your waveform.' : 'Document disabled.');
            }} /> Use in my waveform</label>}
          </div><button type="button" className="secondary-button" disabled={busy || doc.status === 'uploading'} aria-label={`Remove ${doc.filename}`} onClick={() => void mutation(() => fetch('/api/knowledge', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: doc.id }) }).then(read<KnowledgeView>), 'Document removed.')}><Trash2 aria-hidden="true" /><span>Remove</span></button>
        </article>)}
      </div>
      {(preparing || view.documents.some(d => d.status === 'review-required' || d.status === 'manual-review')) && <button type="button" className="secondary-button" disabled={busy} onClick={() => void mutation(() => fetch('/api/knowledge/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewExisting: true }) }).then(read<KnowledgeView>), 'Document status refreshed.')}>{view.documents.some(d => d.status === 'review-required') ? 'Review document safety' : 'Refresh preparation status'}</button>}
      <p className="field-help">Documents must pass safety review before use. DOCX files require founder review because embedded images are not covered by the automatic check; a PDF can include those pages in automatic review.</p>
      {view.documents.some(d => d.status === 'ready' && d.selected) && <form className="knowledge-preview" onSubmit={event => void preview(event)}>
        <h2>Try a question</h2><label htmlFor="knowledge-question">What would you like to find?</label>
        <input id="knowledge-question" value={query} onChange={e => setQuery(e.target.value)} maxLength={1000} required disabled={busy} />
        <button className="secondary-button" disabled={busy || !view.available}>Find passages</button>
        <p className="field-help">Preview the passages your voice can use. This searches documents without starting a voice call.</p>
      </form>}
      {result && <section className="knowledge-results" aria-label="Search results">
        {!result.passages.length && <p role="status">No relevant passages found. Try a more specific question.</p>}
        {result.passages.map(p => <article key={p.id}><blockquote>{p.quote}</blockquote><p>{p.filename}</p></article>)}
      </section>}
      <p><Link className="secondary-button" href={`/w/${view.waveformId}`}>Open waveform</Link></p>
      <p className="field-help">Knowledge answers aloud without opening a panel. Apply Text Box in waveform settings to show passages and sources. Changes apply to new conversations; disabling or removing a document also blocks future searches in an existing call.</p>
    </>}
  </main>;
}
