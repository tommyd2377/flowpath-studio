'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, FileSearch, Trash2 } from 'lucide-react';
import { validateCatalog, type CatalogEntity, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { Site } from '@/lib/site-model';
import type { KnowledgeCandidate, KnowledgeJob } from '@/lib/knowledge-model';

type KnowledgeState = { catalog: KnowledgeCatalog | null; candidates: KnowledgeCandidate[]; jobs: KnowledgeJob[]; semanticMode: 'structured' | 'connected' };
type Props = { site: Site; blocked: boolean; onBusyChange: (busy: boolean) => void; onSiteChange: (site: Site) => void };

export default function KnowledgeReview({ site, blocked, onBusyChange, onSiteChange }: Props) {
  const [state, setState] = useState<KnowledgeState | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileId, setFileId] = useState('');
  const running = useRef(false);
  const sources = site.files.filter(file => file.kind === 'text' || file.kind === 'pdf');
  const candidate = state?.candidates.find(item => item.id === selected) ?? state?.candidates[0];
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${site.id}/knowledge`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Knowledge could not be loaded.'); if (!controller.signal.aborted) setState(body); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [site.id, site.revision]);

  async function act(action: Record<string, unknown>) {
    if (running.current || blocked) return;
    running.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const response = await fetch(`/api/sites/${site.id}/knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...action, revision: site.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The request could not finish. Reload to check its saved status.');
      setState(body);
      if (body.site) onSiteChange(body.site);
    } catch (error) { setError(error instanceof Error ? error.message : 'The request could not finish.'); }
    finally { running.current = false; setBusy(false); onBusyChange(false); }
  }

  return <div className="settings-panel knowledge-panel">
    <div className="panel-heading"><span className="eyebrow">Turn source material into a useful site</span><h2>Knowledge</h2><p>Review what your files say, correct the interpretation, and choose what visitors can explore.</p></div>
    <div className="knowledge-summary"><strong>{state?.catalog ? `${state.catalog.entities.length} items in your draft` : 'Start with a source'}</strong><p>{state?.catalog ? `${state.catalog.attributes.length} attributes · ${state.catalog.collections.length} collections · ${state.catalog.capabilities?.length ?? 0} configured links` : 'Upload a CSV, text document, or text-bearing PDF in Files, then interpret it here.'}</p></div>
    {state?.catalog && <button className="button secondary" disabled={busy || blocked} onClick={() => void act({ action: 'review', requestId: crypto.randomUUID() })}>Review draft knowledge</button>}
    <label className="field">Source file<select value={fileId || sources[0]?.id || ''} disabled={blocked || busy || !sources.length} onChange={event => setFileId(event.target.value)}>{!sources.length && <option value="">Upload a file first</option>}{sources.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
    <button className="button secondary" disabled={blocked || busy || !sources.length} onClick={() => void act({ action: 'analyze', fileId: fileId || sources[0]?.id, requestId: crypto.randomUUID() })}><FileSearch size={16}/>{busy ? 'Working…' : 'Interpret source'}</button>
    <p className="field-help">Interpretation produces a proposal. Applying it updates your draft; publishing is a separate step. An uploaded file cannot enable bookings, live stock, or checkout.</p>
    <p className="field-help">{state?.semanticMode === 'connected' ? 'When needed, interpretation shares this source with the configured AI service. Each attempt is bounded and uses your existing daily AI limit.' : 'Offline interpretation supports CSV and labeled item blocks in TXT or PDF. Free-form prose and broader corrections need the connected interpreter.'}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {state?.jobs.at(-1) && <p role="status" className="field-help">{state.jobs.at(-1)!.message}</p>}
    {state && state.jobs.length > 0 && <details className="knowledge-jobs"><summary>Import activity ({state.jobs.length})</summary>{[...state.jobs].reverse().map(job => <div key={job.id}><strong>{job.sourceName}</strong><p>{job.status.replaceAll('_', ' ')} · {job.message}</p></div>)}</details>}
    {state && state.candidates.length > 1 && <label className="field">Proposal to review<select value={candidate?.id} disabled={busy || blocked} onChange={event => setSelected(event.target.value)}>{state.candidates.map(item => <option value={item.id} key={item.id}>{item.sourceName}</option>)}</select></label>}
    {candidate && <CandidateReview key={`${candidate.id}:${candidate.catalog.id}`} candidate={candidate} disabled={busy || blocked} act={act}/>}
    {state?.catalog && <div className="knowledge-remove"><p>Removing knowledge affects your draft. Your published site keeps its current version until you publish again.</p><button className="text-button muted" disabled={busy || blocked} onClick={() => void act({ action: 'remove' })}>Remove knowledge from draft</button></div>}
  </div>;
}

function CandidateReview({ candidate, disabled, act }: { candidate: KnowledgeCandidate; disabled: boolean; act: (action: Record<string, unknown>) => Promise<void> }) {
  const [catalog, setCatalog] = useState(candidate.catalog);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const dirty = JSON.stringify(catalog) !== JSON.stringify(candidate.catalog);
  function entity(id: string, patch: Partial<CatalogEntity>) { setCatalog(current => ({ ...current, entities: current.entities.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function remove(id: string) { setCatalog(current => ({ ...current, entities: current.entities.filter(item => item.id !== id), collections: current.collections.map(item => ({ ...item, entityIds: item.entityIds.filter(value => value !== id) })).filter(item => item.entityIds.length), relationships: current.relationships.filter(item => item.fromEntityId !== id && item.toEntityId !== id), capabilities: (current.capabilities ?? []).filter(item => item.entityIds.length !== 1 || item.entityIds[0] !== id).map(item => ({ ...item, entityIds: item.entityIds.filter(value => value !== id) })) })); }
  async function save() {
    try { const checked = validateCatalog(catalog); setError(''); await act({ action: 'revise', candidateId: candidate.id, catalog: checked }); }
    catch { setError('Check the values below. Keep at least one item and use valid values for each attribute.'); }
  }
  function correct(event: FormEvent) {
    event.preventDefault(); if (disabled || dirty || !text.trim()) return;
    void act({ action: 'correct', candidateId: candidate.id, text: text.trim(), requestId: crypto.randomUUID() });
  }
  return <section className="knowledge-review" aria-label="Knowledge proposal">
    <div className="section-heading"><h3>Review the interpretation</h3><span>{catalog.entities.length} items</span></div>
    <p>{candidate.sourceName}</p>
    {candidate.notes.length > 0 && <ul className="knowledge-notes">{candidate.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    <label className="field">Catalog name<input value={catalog.name} disabled={disabled} maxLength={120} onChange={event => setCatalog({ ...catalog, name: event.target.value })}/></label>
    <label className="field">What visitors can learn<textarea value={catalog.description} disabled={disabled} rows={2} maxLength={1500} onChange={event => setCatalog({ ...catalog, description: event.target.value })}/></label>
    <div className="knowledge-inference"><strong>Likely visitor needs</strong>{catalog.jobs.length ? catalog.jobs.map(job => <p key={job.id}>{job.label}</p>) : <p>No visitor needs inferred.</p>}<strong>Collections</strong><p>{catalog.collections.map(item => item.name).join(', ') || 'No collections inferred.'}</p><strong>Actions</strong><p>{catalog.capabilities?.map(item => item.label).join(', ') || 'No connected actions. Visitors can browse, compare, and select.'}</p></div>
    <form className="knowledge-correction" onSubmit={correct}><label className="field">Correct the interpretation<textarea value={text} disabled={disabled || dirty} maxLength={2000} rows={2} onChange={event => setText(event.target.value)} placeholder={'For example: Rename "Weekend Workshop" to "Saturday Workshop"'}/></label><button type="submit" className="button secondary" disabled={disabled || dirty || !text.trim()}><ArrowUp size={16}/>Propose correction</button><p className="field-help">You can also edit individual fields below. Save those edits before requesting another correction.</p></form>
    {catalog.entities.map(item => <details className="knowledge-item" key={item.id}><summary>{item.name}<span>{item.kind}</span></summary><div>
      <label className="field">Name<input disabled={disabled} value={item.name} maxLength={180} onChange={event => entity(item.id, { name: event.target.value })}/></label>
      <label className="field">Type<input disabled={disabled} value={item.kind} maxLength={80} onChange={event => entity(item.id, { kind: event.target.value })}/></label>
      <label className="field">Description<textarea disabled={disabled} value={item.summary} rows={3} maxLength={1500} onChange={event => entity(item.id, { summary: event.target.value })}/></label>
      {catalog.attributes.map(attribute => <label className="field" key={attribute.id}>{attribute.label}{attribute.currency ? ` (${attribute.currency})` : attribute.unit ? ` (${attribute.unit})` : ''}
        {attribute.type === 'boolean' ? <select disabled={disabled} value={item.attributes[attribute.id] === undefined || item.attributes[attribute.id] === null ? '' : String(item.attributes[attribute.id])} onChange={event => entity(item.id, { attributes: { ...item.attributes, [attribute.id]: event.target.value === '' ? null : event.target.value === 'true' } })}><option value="">Not provided</option><option value="true">Yes</option><option value="false">No</option></select>
          : <input disabled={disabled} type={['number', 'money'].includes(attribute.type) ? 'number' : attribute.type === 'date' ? 'date' : 'text'} step="any" value={String(item.attributes[attribute.id] ?? '')} placeholder="Not provided" onChange={event => entity(item.id, { attributes: { ...item.attributes, [attribute.id]: event.target.value === '' ? null : ['number', 'money'].includes(attribute.type) ? Number(event.target.value) : event.target.value } })}/>}
      </label>)}
      <button className="text-button muted" disabled={disabled || catalog.entities.length <= 1} onClick={() => remove(item.id)}><Trash2 size={14}/>Remove this item</button>
    </div></details>)}
    <div className="knowledge-links"><h3>Publisher links</h3><p className="field-help">Add a destination you control. A link opens a page; it does not establish live availability or complete an action.</p>
      {(catalog.capabilities ?? []).map(link => <div key={link.id}><label className="field">Link label<input disabled={disabled} maxLength={120} value={link.label} onChange={event => setCatalog({ ...catalog, capabilities: catalog.capabilities?.map(item => item.id === link.id ? { ...item, label: event.target.value } : item) })}/></label><label className="field">HTTPS destination<input disabled={disabled} type="url" value={link.url} placeholder="https://example.com/contact" onChange={event => setCatalog({ ...catalog, capabilities: catalog.capabilities?.map(item => item.id === link.id ? { ...item, url: event.target.value } : item) })}/></label><button disabled={disabled} className="text-button muted" onClick={() => setCatalog({ ...catalog, capabilities: catalog.capabilities?.filter(item => item.id !== link.id) })}>Remove link</button></div>)}
      <button className="button secondary" disabled={disabled || (catalog.capabilities?.length ?? 0) >= 10} onClick={() => setCatalog({ ...catalog, capabilities: [...catalog.capabilities ?? [], { id: crypto.randomUUID(), kind: 'link', label: 'Learn more', url: '', entityIds: [] }] })}>Add a publisher link</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="proposal-actions">{dirty ? <button className="button primary" disabled={disabled} onClick={() => void save()}><Check size={16}/>Save corrections</button> : <button className="button primary" disabled={disabled} onClick={() => void act({ action: 'apply', candidateId: candidate.id })}><Check size={16}/>Apply to draft</button>}<button className="text-button muted" disabled={disabled} onClick={() => void act({ action: 'discard', candidateId: candidate.id })}>Dismiss proposal</button></div>
  </section>;
}
