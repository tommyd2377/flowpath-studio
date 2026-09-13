'use client';
import LoadingIndicator from './LoadingIndicator';
import WebsiteImport from './WebsiteImport';
import { pendingKnowledgeReviews } from '@/lib/knowledge-review-groups';
import WebsiteDesignReview from './WebsiteDesignReview';
import type { SiteContent } from '@/lib/site-model';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Check, FileSearch, Tag, Trash2, X } from 'lucide-react';
import { validateCatalog, type CatalogEntity, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { Site } from '@/lib/site-model';
import type { KnowledgeCandidate, KnowledgeJob } from '@/lib/knowledge-model';
import { AssertionReviews, KnowledgeAssertionsEditor } from './KnowledgeAssertions';
import { LargeCollectionReview } from './LargeCollectionReview';
import { CollectionReview } from './CollectionReview';

type KnowledgeState = { websiteRepairAvailable?: boolean; catalog: KnowledgeCatalog | null; candidates: KnowledgeCandidate[]; jobs: KnowledgeJob[]; sources?: { key: string; name: string }[]; semanticMode: 'structured' | 'connected' };
type SourceOrigin = NonNullable<KnowledgeCandidate['origins']>[number];
type SourceAnchor = NonNullable<SourceOrigin['provenance']>['anchors'][number];
type SourceUpdate = NonNullable<KnowledgeCandidate['updates']>[number];
type Props = { site: Site; blocked: boolean; onBusyChange: (busy: boolean) => void; onSiteChange: (site: Site) => void };

export default function KnowledgeReview({ site, blocked, onBusyChange, onSiteChange }: Props) {
  const [state, setState] = useState<KnowledgeState | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileId, setFileId] = useState('');
  const [replacesSourceKey, setReplacesSourceKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [deleteReview, setDeleteReview] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const editingRef = useRef(false);
  const reviewRoot = useRef<HTMLDivElement>(null);
  const resolvedUpdate = useRef<string | null>(null);
  const [resolvedAssertion, setResolvedAssertion] = useState<string>();
  const running = useRef(false);
  const sources = site.files.filter(file => file.kind === 'text' || file.kind === 'pdf' || file.kind === 'image');
  const sourceFile = sources.find(file => file.id === fileId) ?? sources[0];
  const normalizedSourceName = sourceFile?.name.trim().toLowerCase();
  const matchingSource = state?.sources?.find(source => source.key === normalizedSourceName || source.name.trim().toLowerCase() === normalizedSourceName);
  const candidate = state?.candidates.find(item => item.id === selected) ?? state?.candidates.at(-1);
  function dirtyChange(value: boolean) { editingRef.current = value; setEditing(value); }
  useEffect(() => {
    if (!resolvedUpdate.current) return;
    const row = Array.from(reviewRoot.current?.querySelectorAll<HTMLElement>('[data-source-update],[data-graph-update],[data-identity-match],[data-assertion-review]') ?? []).find(element => [element.dataset.sourceUpdate, element.dataset.graphUpdate, element.dataset.identityMatch, element.dataset.assertionReview].includes(resolvedUpdate.current!));
    if (row) { row.focus({ preventScroll: true }); resolvedUpdate.current = null; }
  }, [candidate?.catalog.id]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${site.id}/knowledge`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Knowledge could not be loaded.'); if (!controller.signal.aborted && !editingRef.current) setState(body); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [site.id, site.revision]);

  async function act(action: Record<string, unknown>) {
    if (running.current || blocked) return;
    running.current = true; setBusy(true); onBusyChange(true); setError(''); setResolvedAssertion(undefined);
    try {
      const response = await fetch(`/api/sites/${site.id}/knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...action, revision: site.revision }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The request could not finish. Reload to check its saved status.');
      if (['resolve', 'identity', 'assertions'].includes(String(action.action)) && Array.isArray(action.decisions)) {
        const decision = action.decisions[0];
        resolvedUpdate.current = action.action === 'assertions' ? `${decision.targetType}/${decision.targetId}` : decision.id;
        if (action.action === 'assertions') setResolvedAssertion(resolvedUpdate.current ?? undefined);
      }
      setState(body);
      if (['analyze-website','repair-website'].includes(String(action.action)) && body.candidates?.length) setSelected(body.candidates.at(-1).id);
      if (body.site) onSiteChange(body.site);
    } catch (error) { setError(error instanceof Error ? error.message : 'The request could not finish.'); }
    finally { running.current = false; setBusy(false); onBusyChange(false); }
  }

  return <div className="settings-panel knowledge-panel" ref={reviewRoot} aria-busy={busy}>
    {busy && <LoadingIndicator label="Interpreting and saving knowledge…"/>}
    {!state && !error && !busy && <LoadingIndicator label="Loading knowledge…"/>}
    <div className="panel-heading"><span className="eyebrow">Turn source material into a useful site</span><h2>Knowledge</h2><p>Add your source material, review what we found, then choose what appears on your site.</p></div>
    <ol className="field-help" aria-label="Knowledge workflow"><li><strong>Add a source.</strong> Upload a file in Files, then choose it below, or import a website.</li><li><strong>Review the information.</strong> Check the suggested items and correct anything that is wrong.</li><li><strong>Apply to draft, then Publish.</strong> Applying saves your review; publishing updates what visitors can see.</li></ol>
    <div className="knowledge-summary"><strong>{state?.catalog ? `${state.catalog.entities.length} items saved in your draft` : site.draft.catalogPublicationId ? 'Collections saved in your draft' : 'No information saved in your draft yet'}</strong><p>{state?.catalog ? `${state.catalog.collections.length} collections organize your information.` : 'Choose a source below to get started.'}</p></div>
    {(state?.catalog || site.draft.catalogPublicationId) && <div className="knowledge-remove">
      <button className="text-button muted" disabled={busy || blocked || editing} onClick={() => { setDeleteReview(true); setDeleteName(''); }}>Delete all draft knowledge</button>
      {deleteReview && <div role="group" aria-label="Confirm deletion of draft knowledge">
        <p>This removes all imported knowledge and collections from this draft. Uploaded files, photos, pending proposals and your current published site remain. Publish afterward to remove the information from the live site. Undo can restore this draft change.</p>
        <label className="field">Type {site.draft.name} to confirm<input value={deleteName} disabled={busy || blocked} onChange={event => setDeleteName(event.target.value)}/></label>
        <button className="button secondary" disabled={busy || blocked || editing || deleteName !== site.draft.name} onClick={() => { setDeleteReview(false); void act({ action: 'remove' }); }}>Confirm delete all draft knowledge</button>
        <button className="text-button" disabled={busy} onClick={() => { setDeleteReview(false); setDeleteName(''); }}>Cancel</button>
      </div>}
    </div>}
    <h3>Add information from a file</h3>
    {state?.catalog && <button className="button secondary" disabled={busy || blocked || editing} onClick={() => void act({ action: 'review', requestId: crypto.randomUUID() })}>Review draft knowledge</button>}
    <label className="field">Source file<select value={sourceFile?.id || ''} disabled={blocked || busy || editing || !sources.length} onChange={event => { setFileId(event.target.value); setReplacesSourceKey(''); }}>{!sources.length && <option value="">Upload a file first</option>}{sources.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
    {!!state?.sources?.length && <label className="field">How should this file be used?<select value={replacesSourceKey} disabled={blocked || busy || editing} onChange={event => setReplacesSourceKey(event.target.value)}><option value="">{matchingSource ? `Update ${matchingSource.name} (same filename)` : 'Add as new source'}</option>{state.sources.map(source => <option key={source.key} value={source.key}>Replace {source.name}</option>)}</select><span className="field-help">Choose Replace when a renamed file updates an existing source. Other files are kept separate.</span></label>}
    <button className="button secondary" disabled={blocked || busy || editing || !sources.length} onClick={() => void act({ action: 'analyze', fileId: sourceFile?.id, requestId: crypto.randomUUID(), ...(replacesSourceKey ? { replacesSourceKey } : {}) })}><FileSearch size={16}/>{busy ? 'Working…' : sourceFile?.kind === 'image' ? 'OCR and interpret source' : 'Interpret source'}</button>
    {state?.websiteRepairAvailable && <button className="button secondary" disabled={busy || blocked || editing} onClick={() => void act({ action: 'repair-website', requestId: crypto.randomUUID() })}>Prepare source-based website repair (no AI)</button>}
    <WebsiteImport entities={state?.catalog?.entities} onSiteChange={onSiteChange} siteId={site.id} revision={site.revision} disabled={blocked || busy || editing} onBusyChange={onBusyChange} onImport={(url, urls) => act({ action: 'analyze-website', url, urls, requestId: crypto.randomUUID() })}/>
    <p className="field-help">Interpretation produces a proposal. Applying it updates your draft; publishing is a separate step. An uploaded file cannot enable bookings, live stock, or checkout.</p>
    <p className="field-help">{state?.semanticMode === 'connected' ? 'When needed, interpretation shares this source with the configured AI service. Each attempt is bounded and uses your existing daily AI limit.' : 'Offline interpretation supports CSV, XLSX and labeled item blocks in TXT, DOCX, HTML or PDF. Free-form prose and website pages need the connected interpreter; OCR requires local Tesseract or an injected provider.'}</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {state?.jobs.at(-1) && <p role="status" className="field-help">{state.jobs.at(-1)!.message}</p>}
    {state && state.jobs.length > 0 && <details className="knowledge-jobs"><summary>Import activity ({state.jobs.length})</summary>{[...state.jobs].reverse().map(job => <div key={job.id}><strong>{job.sourceName}</strong><p>{job.status.replaceAll('_', ' ')} · {job.message}</p></div>)}</details>}
    {editing && <p className="field-help" role="status">Save your field corrections before changing sources, choosing another proposal or resolving source updates.</p>}
    {state && state.candidates.length > 1 && <label className="field">Proposal to review<select value={candidate?.id} disabled={busy || blocked || editing} onChange={event => setSelected(event.target.value)}>{[...state.candidates].reverse().map((item, index) => <option value={item.id} key={item.id}>{item.sourceName} · {item.catalog.entities.length} items{index === 0 ? ' · Latest' : ''}</option>)}</select></label>}
    <details><summary>Advanced collection tools</summary><p className="field-help">For large catalogs and structured collection imports. Most publishers can use the file or website workflow above.</p><LargeCollectionReview site={site} disabled={busy || blocked || editing} onSiteChange={onSiteChange} onBusyChange={onBusyChange}/></details>
    {candidate && <CandidateReview key={`${candidate.id}:${candidate.catalog.id}`} candidate={candidate} content={site.draft} disabled={busy || blocked} act={act} onDirtyChange={dirtyChange} resolvedAssertion={resolvedAssertion}/>}

  </div>;
}

function sourceLocation(anchor: SourceAnchor) {
  const locations: string[] = [];
  if (anchor.sheet) locations.push(`Sheet ${anchor.sheet}`);
  if (anchor.cellRange) locations.push(`Cells ${anchor.cellRange}`);
  if (anchor.row !== undefined) locations.push(`Row ${anchor.row}`);
  if (anchor.lineStart !== undefined) locations.push(anchor.lineEnd && anchor.lineEnd !== anchor.lineStart ? `Lines ${anchor.lineStart}–${anchor.lineEnd}` : `Line ${anchor.lineStart}`);
  if (anchor.pageStart !== undefined) locations.push(anchor.pageEnd && anchor.pageEnd !== anchor.pageStart ? `Pages ${anchor.pageStart}–${anchor.pageEnd}` : `Page ${anchor.pageStart}`);
  return locations.join(' · ') || anchor.label;
}

function SourceExcerpt({ sourceName, anchor }: { sourceName: string; anchor: SourceAnchor }) {
  return <figure className="knowledge-source-excerpt"><figcaption>{sourceName} · {sourceLocation(anchor)}</figcaption><pre>{anchor.excerpt}</pre>{anchor.truncated && <p className="field-help">Excerpt shortened; see original for the full record.</p>}</figure>;
}

function UpdateExcerpt({ reference, anchors, label }: { reference: NonNullable<SourceUpdate['previousSource']>; anchors: Map<string, SourceAnchor>; label: string }) {
  const anchor = anchors.get(reference.anchorId);
  return <div><p className="field-help">{label}</p>{anchor ? <SourceExcerpt sourceName={reference.sourceName} anchor={anchor}/> : <p className="field-help">The saved excerpt for {reference.sourceName} is unavailable. No exact source citation can be shown.</p>}</div>;
}

function SourceMaterial({ origins }: { origins: SourceOrigin[] }) {
  const [open, setOpen] = useState(false);
  return <details className="knowledge-source-material" onToggle={event => setOpen(event.currentTarget.open)}><summary>Source material ({origins.length})</summary>{open && <div>
    <p className="field-help">Private excerpts help you review the interpretation. They are not published. A source excerpt may differ from your corrections.</p>
    {!origins.length && <p className="field-help">No source excerpts were saved for this proposal. Existing knowledge can still be corrected.</p>}
    {origins.map(origin => <details className="knowledge-source-file" key={origin.key}><summary>{origin.name}</summary>
      {!origin.provenance?.fields.length && <p className="field-help">Fields are not linked to exact excerpts for this source. The material below is source-level context, not a field citation.</p>}
      {origin.provenance?.anchors.length ? origin.provenance.anchors.map(anchor => <SourceExcerpt key={anchor.id} sourceName={origin.name} anchor={anchor}/>) : <p className="field-help">No saved excerpt is available. Refer to the original file in Files.</p>}
    </details>)}
  </div>}</details>;
}

function FieldSource({ origins, entityId, field, label }: { origins: SourceOrigin[]; entityId: string; field: string; label: string }) {
  const references = origins.flatMap(origin => {
    const ids = new Set(origin.provenance?.fields.filter(link => link.entityId === entityId && link.field === field).flatMap(link => link.anchorIds) ?? []);
    return (origin.provenance?.anchors ?? []).filter(anchor => ids.has(anchor.id)).map(anchor => ({ sourceName: origin.name, anchor, key: `${origin.key}:${anchor.id}` }));
  });
  return <details className="knowledge-field-source"><summary>Source for {label}</summary>{references.length
    ? references.map(reference => <SourceExcerpt key={reference.key} sourceName={reference.sourceName} anchor={reference.anchor}/>)
    : <p className="field-help">This field is not linked to a source excerpt. Source material above may provide context; no exact field citation is available.</p>}
  </details>;
}

const updateLabels: Record<SourceUpdate['kind'], string> = {
  changed: 'Source value changed', conflict: 'Publisher correction kept', missing: 'Missing from the new source',
  added: 'New item', removed_by_publisher: 'Previously removed by you',
};
function updateValue(value: SourceUpdate['current'], entity: boolean) {
  return value === null ? entity ? 'Item not present' : 'Not provided' : value === '' ? 'Empty' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
}
function updateChoices(update: SourceUpdate): { keep: string; incoming: string } {
  if (update.kind === 'missing') return { keep: 'Keep item', incoming: 'Remove item' };
  if (update.kind === 'added') return { keep: 'Do not add item', incoming: 'Add item' };
  if (update.kind === 'removed_by_publisher') return { keep: 'Keep removed', incoming: 'Restore item' };
  return { keep: 'Keep current', incoming: 'Use source' };
}

function SourceUpdates({ candidate, disabled, dirty, resolve }: { candidate: KnowledgeCandidate; disabled: boolean; dirty: boolean; resolve: (decisions: { id: string; choice: 'keep' | 'incoming' }[]) => Promise<void> }) {
  const [open, setOpen] = useState(() => (candidate.updates ?? []).some(update => update.choice !== undefined));
  const updates = candidate.updates ?? [];
  const anchors = new Map((candidate.updateAnchors ?? []).map(anchor => [anchor.id, anchor]));
  const counts = (kind: SourceUpdate['kind']) => updates.filter(update => update.kind === kind).length;
  const correctionsKept = updates.filter(update => update.kind === 'conflict' && (update.choice ?? update.defaultChoice) === 'keep').length;
  const summary = [[counts('changed') + counts('conflict'), 'Source value changes'], [correctionsKept, 'Corrections kept'], [counts('missing'), 'Missing items'], [counts('added'), 'New items'], [counts('removed_by_publisher'), 'Previously removed items']].filter(([count]) => Number(count) > 0).map(([count, label]) => `${label}: ${count}`).join(' · ');
  return <section className="knowledge-source-updates" aria-label="Source update review"><h4>Changes from this source</h4><p>{summary}</p><p className="field-help">Your corrections and missing items are kept by default. Other source changes are included. You can apply these defaults without reviewing every change.</p>
    {dirty && <p className="field-help" role="status">Save or discard your field edits before choosing a source update. Your direct edits replace matching source suggestions.</p>}
    <details open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Review source updates ({updates.length})</summary>{open && updates.map(update => {
      const selected = update.choice ?? update.defaultChoice;
      const choices = updateChoices(update);
      const field = update.field?.startsWith('attributes.') ? candidate.catalog.attributes.find(attribute => attribute.id === update.field!.slice(11))?.label ?? update.field.slice(11)
        : update.field === 'kind' ? 'Type' : update.field === 'summary' ? 'Description' : update.field === 'name' ? 'Name' : '';
      const title = `${update.entityName}${field ? ` · ${field}` : ''}`;
      return <article className="knowledge-source-update" key={update.id} data-source-update={update.id} tabIndex={-1} aria-label={title}><header><strong>{title}</strong><span>{update.kind === 'conflict' && selected === 'incoming' ? 'Using the source value' : updateLabels[update.kind]}</span></header>
        <dl className="knowledge-source-values">{([['Previous source', update.previous], ['Your current value', update.current], ['Incoming source', update.incoming]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{updateValue(value, !update.field)}</dd></div>)}</dl>
        {(update.previousSource || update.incomingSource) && <details className="knowledge-update-excerpts"><summary>Compare source excerpts</summary>{update.previousSource && <UpdateExcerpt reference={update.previousSource} anchors={anchors} label="Previous source"/>}{update.incomingSource && <UpdateExcerpt reference={update.incomingSource} anchors={anchors} label="Incoming source"/>}</details>}
        <div className="knowledge-update-choices">{(['keep', 'incoming'] as const).map(choice => <button key={choice} type="button" className="button secondary" aria-pressed={selected === choice} aria-label={`${choices[choice]} for ${title}`} disabled={disabled || selected === choice} onClick={() => void resolve([{ id: update.id, choice }])}>{selected === choice && <Check size={14}/>} {choices[choice]}</button>)}</div>
        <p className="field-help">{update.choice ? 'Saved choice' : 'Default'}: {choices[selected]}.</p>
        {update.kind === 'missing' && <p className="field-help">Photos stay in your library; connections to this item are removed on Apply if you choose Remove item.</p>}
      </article>;
    })}</details>
  </section>;
}

function IdentityMatches({ candidate, disabled, resolve }: { candidate: KnowledgeCandidate; disabled: boolean; resolve: (decisions: { id: string; action: 'approve' | 'reject' | 'alias'; alias?: string }[]) => Promise<void> }) {
  const matches = candidate.identityMatches ?? [];
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const review = matches.filter(match => match.status === 'review');
  return <section className="knowledge-identity-review" aria-label="Identity suggestion review"><h4>Cross-source identity</h4><p className="field-help">Names, types, aliases and similarity suggest a review; they do not prove identity. Automatic consolidation requires a scoped identifier and corroborating attributes. Undo the applied draft revision to reverse a merge.</p>
    {matches.map(match => {
      const decided = match.decision && match.decision !== 'pending';
      const alias = aliases[match.id] ?? '';
      return <article className="knowledge-identity-match" key={match.id} data-identity-match={match.id} tabIndex={-1} aria-label={`${match.incomingName} to ${match.canonicalName}`}>
        <div><strong>{match.incomingName} → {match.canonicalName}</strong><span>{match.status === 'auto' ? 'Applied automatically' : match.decision === 'approved' ? 'Approved and consolidated' : match.decision === 'rejected' ? 'Rejected' : 'Review suggested'} · Match score {match.confidence} (not probability) · {match.reason}</span></div>
        {match.status === 'review' && !decided && <div className="knowledge-identity-actions"><button type="button" className="button secondary" disabled={disabled} onClick={() => void resolve([{ id: match.id, action: 'approve' }])}><Check size={14}/>Approve match</button><button type="button" className="button secondary" disabled={disabled} onClick={() => void resolve([{ id: match.id, action: 'reject' }])}><X size={14}/>Keep separate</button></div>}
        <div className="knowledge-identity-alias"><label className="field">Add an explicit alias<input disabled={disabled} maxLength={160} value={alias} placeholder={match.incomingName} onChange={event => setAliases(current => ({ ...current, [match.id]: event.target.value }))}/></label><button type="button" className="button secondary" disabled={disabled || !alias.trim()} onClick={() => { void resolve([{ id: match.id, action: 'alias', alias: alias.trim() }]); setAliases(current => ({ ...current, [match.id]: '' })); }}><Tag size={14}/>Save alias</button></div>
      </article>;
    })}
    {!review.length && <p className="field-help">No pending identity suggestions. You can still add an alias to an existing match above.</p>}
  </section>;
}

function GraphUpdates({ candidate, disabled, resolve }: { candidate: KnowledgeCandidate; disabled: boolean; resolve: (decisions: { id: string; choice: 'keep' | 'incoming' }[]) => Promise<void> }) {
  const updates = candidate.graphUpdates ?? [];
  if (!updates.length) return null;
  const value = (item: unknown) => item === null ? 'Not present' : JSON.stringify(item);
  const anchors = new Map((candidate.updateAnchors ?? []).map(anchor => [anchor.id, anchor]));
  return <section className="knowledge-graph-updates" aria-label="Fact and relationship update review"><h4>Fact and relationship changes</h4><p className="field-help">Overlapping temporal assertions or edited edges remain private until you choose which source to keep. The correction history stays with the private revision.</p>{updates.map(update => {
    const selected = update.choice ?? update.defaultChoice; const label = update.targetType === 'fact' ? 'Fact' : 'Relationship';
    return <article className="knowledge-source-update" data-graph-update={update.id} key={update.id} tabIndex={-1} aria-label={`${label} update for ${update.entityName}`}><header><strong>{label} · {update.entityName}</strong><span>{update.kind.endsWith('_conflict') ? 'Temporal conflict' : update.kind.endsWith('_missing') ? 'Missing from source' : update.kind.endsWith('_added') ? 'New assertion' : 'Source changed'}</span></header><dl className="knowledge-source-values"><div><dt>Previous source</dt><dd>{value(update.previous)}</dd></div><div><dt>Current draft</dt><dd>{value(update.current)}</dd></div><div><dt>Incoming source</dt><dd>{value(update.incoming)}</dd></div></dl>{(update.previousSource || update.incomingSource) && <details className="knowledge-update-excerpts"><summary>Compare source excerpts</summary>{update.previousSource && <UpdateExcerpt reference={update.previousSource} anchors={anchors} label="Previous source"/>}{update.incomingSource && <UpdateExcerpt reference={update.incomingSource} anchors={anchors} label="Incoming source"/>}</details>}<div className="knowledge-update-choices">{(['keep', 'incoming'] as const).map(choice => <button type="button" key={choice} className="button secondary" aria-pressed={selected === choice} disabled={disabled || selected === choice} onClick={() => void resolve([{ id: update.id, choice }])}>{selected === choice && <Check size={14}/>} {choice === 'keep' ? 'Keep current' : 'Use source'}</button>)}</div><p className="field-help">{update.choice ? 'Saved choice' : 'Default'}: {selected === 'keep' ? 'Keep current' : 'Use source'}.</p></article>;
  })}</section>;
}

function CandidateReview({ candidate, content, disabled, act, onDirtyChange, resolvedAssertion }: { candidate: KnowledgeCandidate; content: SiteContent; disabled: boolean; act: (action: Record<string, unknown>) => Promise<void>; onDirtyChange: (dirty: boolean) => void; resolvedAssertion?: string }) {
  const [catalog, setCatalog] = useState(candidate.catalog);
  const [design, setDesign] = useState(candidate.website?.design);
  const [includeDesign, setIncludeDesign] = useState(true);
  const [acceptPartial, setAcceptPartial] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [aliasText, setAliasText] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(design) !== JSON.stringify(candidate.website?.design) || JSON.stringify(catalog) !== JSON.stringify(candidate.catalog) || Object.entries(aliasText).some(([id, value]) => value !== (candidate.catalog.entities.find(entity => entity.id === id)?.aliases ?? []).join(', '));
  const dirtyCallback = useRef(onDirtyChange);
  useEffect(() => { dirtyCallback.current = onDirtyChange; }, [onDirtyChange]);
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  function entity(id: string, patch: Partial<CatalogEntity>) { setCatalog(current => ({ ...current, entities: current.entities.map(item => item.id === id ? { ...item, ...patch } : item) })); }
  function remove(id: string) { setCatalog(current => ({ ...current, entities: current.entities.filter(item => item.id !== id), facts: current.facts?.filter(fact => fact.entityId !== id), collections: current.collections.map(item => ({ ...item, entityIds: item.entityIds.filter(value => value !== id) })), relationships: current.relationships.filter(item => item.fromEntityId !== id && item.toEntityId !== id), capabilities: (current.capabilities ?? []).filter(item => item.entityIds.length !== 1 || item.entityIds[0] !== id).map(item => ({ ...item, entityIds: item.entityIds.filter(value => value !== id) })) })); }
  async function save() {
    try { const checked = validateCatalog({ ...catalog, entities: catalog.entities.map(entity => aliasText[entity.id] === undefined ? entity : { ...entity, aliases: aliasText[entity.id].split(',').map(value => value.trim()).filter(Boolean) }) }); setError(''); await act({ action: 'revise', candidateId: candidate.id, catalog: checked, ...(design ? { websiteDesign: design } : {}) }); }
    catch { setError('Check the values below. Keep at least one item and use valid values for each attribute.'); }
  }
  function correct(event: FormEvent) {
    event.preventDefault(); if (disabled || dirty || !text.trim()) return;
    void act({ action: 'correct', candidateId: candidate.id, text: text.trim(), requestId: crypto.randomUUID() });
  }
  return <section className="knowledge-review" aria-label="Knowledge proposal">
    <div className="section-heading"><h3>Review the interpretation</h3><span>{catalog.entities.length} items</span></div>
    <p>{candidate.sourceName}</p>
    <details className="knowledge-review-version"><summary>Review version</summary><p>Proposal: {candidate.id}</p><p>Proposal revision: {candidate.catalog.id}</p><p>Current draft knowledge: {content.knowledgeRevisionId ?? 'None'}</p><p>Current draft media: {content.mediaRevisionId ?? 'None'}</p><p>Current draft logo: {content.logoAssetId ?? 'None'}</p></details>
    {candidate.website && design && <WebsiteDesignReview proposal={candidate.website} design={design} content={content} catalog={catalog} disabled={disabled} onChange={setDesign} include={includeDesign} onInclude={setIncludeDesign} acceptPartial={acceptPartial} onAcceptPartial={setAcceptPartial}/>}
    {candidate.notes.length > 0 && <ul className="knowledge-notes">{candidate.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
    {!!candidate.identityMatches?.length && <IdentityMatches candidate={candidate} disabled={disabled || dirty} resolve={decisions => act({ action: 'identity', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, decisions })}/>}
    <AssertionReviews candidate={candidate} disabled={disabled || dirty} resolvedAssertion={resolvedAssertion} decide={decisions => act({ action: 'assertions', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, decisions })}/>
    <KnowledgeAssertionsEditor catalog={catalog} disabled={disabled} change={setCatalog}/>
    <CollectionReview catalog={catalog} change={setCatalog} disabled={disabled}/>
    <SourceMaterial origins={candidate.origins ?? []}/>
    {!!candidate.updates?.length && <SourceUpdates candidate={candidate} disabled={disabled || dirty} resolve={decisions => act({ action: 'resolve', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, decisions })} dirty={dirty}/>}
    {!!candidate.graphUpdates?.length && <GraphUpdates candidate={candidate} disabled={disabled || dirty} resolve={decisions => act({ action: 'resolve', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, decisions })}/>}
    {!!candidate.correctionHistory?.length && <details className="knowledge-correction-history"><summary>Fact and relationship correction history ({candidate.correctionHistory.length})</summary><p className="field-help">This immutable private history records source replacements and publisher choices, including historical IDs before identity remaps. It is never published.</p>{candidate.correctionHistory.slice().reverse().map(entry => <details className="knowledge-correction-entry" key={entry.id}><summary>{entry.targetType === 'fact' ? 'Fact' : 'Relationship'} · {entry.action.replaceAll('-', ' ')} · {new Date(entry.recordedAt).toLocaleString()}</summary><p>{entry.sourceName ?? entry.sourceKey}</p><strong>Before</strong><pre>{JSON.stringify(entry.before, null, 2)}</pre><strong>After</strong><pre>{JSON.stringify(entry.after, null, 2)}</pre>{entry.anchorIds?.map(id => { const anchor = candidate.updateAnchors?.find(anchor => anchor.id === id); return anchor ? <SourceExcerpt key={id} sourceName={entry.sourceName ?? 'Historical source'} anchor={anchor}/> : null; })}</details>)}</details>}
    <label className="field">Catalog name<input value={catalog.name} disabled={disabled} maxLength={120} onChange={event => setCatalog({ ...catalog, name: event.target.value })}/></label>
    <label className="field">What visitors can learn<textarea value={catalog.description} disabled={disabled} rows={2} maxLength={1500} onChange={event => setCatalog({ ...catalog, description: event.target.value })}/></label>
    <div className="knowledge-inference"><strong>Likely visitor needs</strong>{catalog.jobs.length ? catalog.jobs.map(job => <p key={job.id}>{job.label}</p>) : <p>No visitor needs inferred.</p>}<strong>Collections</strong><p>{catalog.collections.map(item => item.name).join(', ') || 'No collections inferred.'}</p><strong>Actions</strong><p>{catalog.capabilities?.map(item => item.label).join(', ') || 'No connected actions. Visitors can browse, compare, and select.'}</p></div>
    <form className="knowledge-correction" onSubmit={correct}><label className="field">Correct the interpretation<textarea value={text} disabled={disabled || dirty} maxLength={2000} rows={2} onChange={event => setText(event.target.value)} placeholder={'For example: Rename "Weekend Workshop" to "Saturday Workshop"'}/></label><button type="submit" className="button secondary" disabled={disabled || dirty || !text.trim()}><ArrowUp size={16}/>Propose correction</button><p className="field-help">You can also edit individual fields below. Save those edits before requesting another correction.</p></form>
    <details><summary>Edit item names, descriptions and fields ({catalog.entities.length})</summary>
    {catalog.entities.map(item => <details className="knowledge-item" key={item.id}><summary>{item.name}<span>{item.kind}</span></summary><div>
      <label className="field">Name<input disabled={disabled} value={item.name} maxLength={180} onChange={event => entity(item.id, { name: event.target.value })}/></label><FieldSource origins={candidate.origins ?? []} entityId={item.id} field="name" label="Name"/>
      <label className="field">Approved alternate labels<input disabled={disabled} maxLength={1942} value={aliasText[item.id] ?? (item.aliases ?? []).join(', ')} placeholder="Optional aliases, separated by commas" onChange={event => setAliasText(current => ({ ...current, [item.id]: event.target.value }))}/><span className="field-help">Up to 12 distinct aliases. Aliases suggest identity review; they do not prove a match.</span></label>
      <label className="field">Type<input disabled={disabled} value={item.kind} maxLength={80} onChange={event => entity(item.id, { kind: event.target.value })}/></label><FieldSource origins={candidate.origins ?? []} entityId={item.id} field="kind" label="Type"/>
      <label className="field">Description<textarea disabled={disabled} value={item.summary} rows={3} maxLength={1500} onChange={event => entity(item.id, { summary: event.target.value })}/></label><FieldSource origins={candidate.origins ?? []} entityId={item.id} field="summary" label="Description"/>
      {catalog.attributes.map(attribute => <div key={attribute.id}><label className="field">{attribute.label}{attribute.currency ? ` (${attribute.currency})` : attribute.unit ? ` (${attribute.unit})` : ''}
        {attribute.type === 'boolean' ? <select disabled={disabled} value={item.attributes[attribute.id] === undefined || item.attributes[attribute.id] === null ? '' : String(item.attributes[attribute.id])} onChange={event => entity(item.id, { attributes: { ...item.attributes, [attribute.id]: event.target.value === '' ? null : event.target.value === 'true' } })}><option value="">Not provided</option><option value="true">Yes</option><option value="false">No</option></select>
          : <input disabled={disabled} type={['number', 'money'].includes(attribute.type) ? 'number' : attribute.type === 'date' ? 'date' : 'text'} step="any" value={String(item.attributes[attribute.id] ?? '')} placeholder="Not provided" onChange={event => entity(item.id, { attributes: { ...item.attributes, [attribute.id]: event.target.value === '' ? null : ['number', 'money'].includes(attribute.type) ? Number(event.target.value) : event.target.value } })}/>}
      </label><FieldSource origins={candidate.origins ?? []} entityId={item.id} field={`attributes.${attribute.id}`} label={attribute.label}/></div>)}
      {!!item.blocks?.length && <details><summary>Page reading content ({item.blocks.length} blocks)</summary>{item.blocks.map((block, blockIndex) => <label className="field" key={block.id}>Text block {blockIndex + 1}<textarea disabled={disabled} maxLength={8000} value={block.text} onChange={event => entity(item.id, { blocks: item.blocks!.map(value => value.id === block.id ? { ...value, text: event.target.value } : value) })}/></label>)}</details>}
      <button className="text-button muted" disabled={disabled || catalog.entities.length <= 1} onClick={() => remove(item.id)}><Trash2 size={14}/>Remove this item</button>
    </div></details>)}
    </details>
    <div className="knowledge-links"><h3>Publisher links</h3><p className="field-help">Add a destination you control. A link opens a page; it does not establish live availability or complete an action.</p>
      {(catalog.capabilities ?? []).map(link => <div key={link.id}><label className="field">Link label<input disabled={disabled} maxLength={120} value={link.label} onChange={event => setCatalog({ ...catalog, capabilities: catalog.capabilities?.map(item => item.id === link.id ? { ...item, label: event.target.value } : item) })}/></label><label className="field">HTTPS destination<input disabled={disabled} type="url" value={link.url} placeholder="https://example.com/contact" onChange={event => setCatalog({ ...catalog, capabilities: catalog.capabilities?.map(item => item.id === link.id ? { ...item, url: event.target.value } : item) })}/></label><button disabled={disabled} className="text-button muted" onClick={() => setCatalog({ ...catalog, capabilities: catalog.capabilities?.filter(item => item.id !== link.id) })}>Remove link</button></div>)}
      <button className="button secondary" disabled={disabled || (catalog.capabilities?.length ?? 0) >= 10} onClick={() => setCatalog({ ...catalog, capabilities: [...catalog.capabilities ?? [], { id: crypto.randomUUID(), kind: 'link', label: 'Learn more', url: '', entityIds: [] }] })}>Add a publisher link</button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {pendingKnowledgeReviews(candidate).length > 0 && <p role="status" className="field-help">Review and approve the pending content above before applying. Nothing has been saved to your draft yet.</p>}
    <div className="proposal-actions">{dirty ? <><button className="button primary" disabled={disabled} onClick={() => void save()}><Check size={16}/>Save corrections</button><button className="text-button muted" disabled={disabled} onClick={() => { setCatalog(candidate.catalog); setAliasText({}); setDesign(candidate.website?.design); }}>Discard field edits</button></> : <button className="button primary" disabled={disabled || pendingKnowledgeReviews(candidate).length > 0} onClick={() => void act({ action: 'apply', candidateId: candidate.id, candidateRevisionId: candidate.catalog.id, ...(includeDesign && design ? { websiteDesign: design } : {}), acceptPartial })}><Check size={16}/>Apply to draft</button>}<button className="text-button muted" disabled={disabled || dirty} onClick={() => void act({ action: 'discard', candidateId: candidate.id })}>Dismiss proposal</button></div>
  </section>;
}
