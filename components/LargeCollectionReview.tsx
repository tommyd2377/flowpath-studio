'use client';
import { useEffect, useState } from 'react';
import type { TypedValue, FieldDescriptor } from '@thevoice/platform-ui/query';
import type { CanonicalRecord, PublicationSpace } from '@thevoice/platform-ui/collection-space';
import type { Site } from '@/lib/site-model';
import type { CatalogReview } from '@/lib/catalog-repository';

type Page = { review: CatalogReview; records?: CanonicalRecord[]; memberships?: PublicationSpace['memberships']; nextOffset?: number | null; truncatedRecords?: string[]; site?: Site };
export function LargeCollectionReview({ site, disabled, onSiteChange, onBusyChange }: { site: Site; disabled: boolean; onSiteChange: (site: Site) => void; onBusyChange: (value: boolean) => void }) {
  const [page, setPage] = useState<Page | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [offset, setOffset] = useState(0), [progress, setProgress] = useState('');
  useEffect(() => { const controller = new AbortController(); void fetch(`/api/sites/${site.id}/collections`, { signal: controller.signal }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); if (result.review) setPage(result); }).catch(error => { if (!controller.signal.aborted) setError(error.message); }); return () => controller.abort(); }, [site.id]);
  const [previous, setPrevious] = useState<CatalogReview['metadata'] | null>(null);
  async function request(input: unknown): Promise<Page> {
    const response = await fetch(`/api/sites/${site.id}/collections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Review could not finish.'); if (['edit', 'finish', 'migrate'].includes((input as { action: string }).action)) setOffset(0); return result;
  }
  async function run(action: () => Promise<Page>) {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setError('');
    try { const result = await action(); setPage(result); if (result.site) onSiteChange(result.site); }
    catch (error) { setError(error instanceof Error ? error.message : 'Review could not finish.'); }
    finally { setBusy(false); onBusyChange(false); setProgress(''); }
  }
  async function importFile(file: File) {
    if (file.size > 128 * 1024 * 1024) throw new Error('Import exceeds 128 MiB.');
    // Stream JSONL instead of retaining a large upload or preview in React state.
    const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader(); let remaining = '', current: Page | null = null;
    const line = async (text: string) => {
      if (!text.trim()) return;
      if (text.length > 600_000) throw new Error('An import line exceeds 600 KB. Split its records.');
      const data = JSON.parse(text);
      current = current ? await request({ action: 'append', reviewId: current.review.id, revision: current.review.revision, chunk: data })
        : await request({ action: 'begin', siteRevision: site.revision, metadata: data, ...(page?.review ? { previousReviewId: page.review.id } : {}) });
      setProgress(`${current.review.recordCount.toLocaleString()} records staged for review`);
    };
    try { while (true) { const { done, value } = await reader.read(); if (done) break; remaining += value; let end: number; while ((end = remaining.indexOf('\n')) >= 0) { await line(remaining.slice(0, end)); remaining = remaining.slice(end + 1); } if (remaining.length > 600_000) throw new Error('An import line exceeds 600 KB.'); } await line(remaining); }
    finally { await reader.cancel(); reader.releaseLock(); }
    if (!current) throw new Error('The import is empty.');
    const completed = current as Page; setOffset(0);
    return request({ action: 'finish', reviewId: completed.review.id, revision: completed.review.revision });
  }
  const review = page?.review;
  const edit = (metadata: CatalogReview['metadata']) => { if (!review) return; setPrevious(review.metadata); void run(() => request({ action: 'edit', reviewId: review.id, revision: review.revision, metadata })); };
  const changePage = (next: number) => { setOffset(next); void run(() => request({ action: 'review', reviewId: review!.id, offset: next })); };
  return <section className="knowledge-review" aria-label="Paged collection review" aria-busy={busy}>
    <h3>Collections and large imports</h3><p>Review shared records and their collection memberships before applying. Your published site changes only when you publish.</p>
    <button className="button secondary" disabled={disabled || busy || !site.draft.knowledgeRevisionId} onClick={() => void run(() => request({ action: 'migrate', siteRevision: site.revision, ...(review ? { previousReviewId: review.id } : {}) }))}>Review source knowledge as collections</button>
    {site.draft.catalogPublicationId && <p>After applying updated source knowledge, refresh this collection review, apply it to the draft, then publish. Your collection corrections are carried forward for matching records and collections.</p>}
    <label className="field">Import collection file (.jsonl)<input aria-label="Import collection file" disabled={busy || disabled} type="file" accept=".jsonl,.ndjson" onChange={event => { const file = event.target.files?.[0]; if (file) void run(() => importFile(file)); event.target.value = ''; }}/><span className="field-help">First line: publication metadata. Following lines: batches of up to 100 canonical records and memberships. Source excerpts and private notes must stay in source review.</span></label>
    {progress && <p role="status">{progress}</p>}{busy && <p role="status">Preparing collection review…</p>}{error && <p role="alert">{error}</p>}
    {review && <><p role="status">{review.recordCount.toLocaleString()} records · {review.metadata.collections.length} collections · {review.status}</p>
      {review.status === 'applying' && <button disabled={busy || disabled} onClick={() => void run(() => request({ action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision }))}>Check Apply status</button>}
      {review.status === 'review' && <><details><summary>Collection structure and reviewed fields</summary>{review.metadata.collections.map(collection => <div key={collection.id}><label className="field">Collection name<input aria-label={`Collection name ${collection.id}`} key={`${collection.id}:${review.revision}`} defaultValue={collection.name} disabled={busy || disabled} maxLength={160} onBlur={event => { if (event.target.value !== collection.name) edit({ ...review.metadata, collections: review.metadata.collections.map(value => value.id === collection.id ? { ...value, name: event.target.value } : value) }); }}/></label>
      {collection.id !== review.metadata.rootId && <label className="field">Parent collection<select value={review.metadata.edges.find(edge => edge.childId === collection.id)?.parentId ?? ''} disabled={busy || disabled} onChange={event => edit({ ...review.metadata, edges: [...review.metadata.edges.filter(edge => edge.childId !== collection.id), { parentId: event.target.value, childId: collection.id }] })}>{review.metadata.collections.filter(value => value.id !== collection.id).map(value => <option value={value.id} key={value.id}>{value.name}</option>)}</select></label>}</div>)}
      {review.metadata.fields.map(field => <label className="field" key={field.id}>{field.label} · {field.coverage.known}/{field.coverage.total} with a value<input aria-label={`Aliases for ${field.label}`} key={`${field.id}:${review.revision}`} defaultValue={field.aliases.join(', ')} disabled={busy || disabled} onBlur={event => { const aliases = event.target.value.split(',').map(value => value.trim()).filter(Boolean); if (JSON.stringify(aliases) !== JSON.stringify(field.aliases)) edit({ ...review.metadata, fields: review.metadata.fields.map(value => value.id === field.id ? { ...value, aliases } : value) }); }}/></label>)}</details>
      {previous && <button className="button secondary" disabled={busy || disabled} onClick={() => edit(previous)}>Undo structure edit</button>}
      <div aria-label="Collection record preview">{page.records?.map(record => <details key={record.id}><summary>{record.name}</summary><label className="field">Record name<input key={`name:${record.id}:${review.revision}`} defaultValue={record.name} disabled={busy || disabled} maxLength={180} onBlur={event => { if (event.target.value !== record.name) void run(() => request({ action: 'edit', reviewId: review.id, revision: review.revision, patch: { id: record.id, name: event.target.value } })); }}/></label><label className="field">Record summary<textarea key={`summary:${record.id}:${review.revision}`} defaultValue={record.summary} disabled={busy || disabled} maxLength={1600} onBlur={event => { if (event.target.value !== record.summary) void run(() => request({ action: 'edit', reviewId: review.id, revision: review.revision, patch: { id: record.id, summary: event.target.value } })); }}/></label>{page.truncatedRecords?.includes(record.id) && <p>Showing the first 32 assertions and four detail blocks. Edits retain the rest of this record.</p>}{record.assertions.map(fact => <AssertionInput key={`${fact.id}:${review.revision}`} field={review.metadata.fields.find(field => field.id === fact.fieldId)!} value={fact.value} disabled={busy || disabled} label={`${fact.polarity}${fact.conditions.length ? ` · ${fact.conditions.join('; ')}` : ''}`} save={value => void run(() => request({ action: 'edit', reviewId: review.id, revision: review.revision, patch: { id: record.id, assertion: { id: fact.id, value } } }))}/>)}{record.blocks.map(block => <p key={block.id}>{block.text}</p>)}{review.metadata.collections.filter(collection => collection.kind === 'explicit').map(collection => <label key={collection.id}><input type="checkbox" disabled={busy || disabled} checked={page.memberships?.some(member => member.recordId === record.id && member.collectionId === collection.id) ?? false} onChange={event => void run(() => request({ action: 'edit', reviewId: review.id, revision: review.revision, membership: { recordId: record.id, collectionId: collection.id, included: event.target.checked } }))}/>{collection.name}</label>)}</details>)}</div>
      <div className="proposal-actions"><button className="button secondary" disabled={busy || disabled || offset === 0} onClick={() => changePage(Math.max(0, offset - 24))}>Previous review page</button><button className="button secondary" disabled={busy || disabled || page.nextOffset == null} onClick={() => changePage(page.nextOffset!)}>Next review page</button><button className="button primary" disabled={busy || disabled} onClick={() => void run(() => request({ action: 'apply', reviewId: review.id, revision: review.revision, siteRevision: site.revision }))}>Apply collections to draft</button></div></>}
      {review.status === 'applied' && <p>Applied to draft. Review the site, then use Publish when ready. Draft Undo restores the previous publication reference.</p>}
    </>}
  </section>;
}

function AssertionInput({ field, value, disabled, label, save }: { field: FieldDescriptor; value: TypedValue | null; disabled: boolean; label: string; save: (value: TypedValue | null) => void }) {
  const text = value === null ? '' : Array.isArray(value.value) ? value.value.join(', ') : typeof value.value === 'object' ? JSON.stringify(value.value) : String(value.value);
  function update(raw: string) {
    if (raw === text) return;
    if (!raw.trim()) { save(null); return; }
    const scalar = (text: string) => field.type === 'boolean' ? text === 'true' : ['number', 'money'].includes(field.type) ? Number(text) : text;
    if (field.type === 'geo') return;
    save({ type: field.type, value: field.cardinality === 'many' ? raw.split(',').map(value => scalar(value.trim())) : scalar(raw), ...(field.unit ? { unit: field.unit } : {}), ...(field.currency ? { currency: field.currency } : {}), ...(field.basis ? { basis: field.basis } : {}) });
  }
  return <label className="field">{field.label} · {label}{field.type === 'boolean' ? <select disabled={disabled} defaultValue={text} onChange={event => update(event.target.value)}><option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option></select> : <input disabled={disabled || field.type === 'geo'} defaultValue={text} maxLength={2000} onBlur={event => update(event.target.value)}/>}</label>;
}
