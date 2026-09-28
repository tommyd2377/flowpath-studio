'use client';
import { useId, useState } from 'react';
import { visitorArtifactSchema, type VisitorArtifact } from './artifacts.js';
import { fakeQuoteSchema, fakeBookingSchema, fakeReceiptSchema, fakeSlotSchema, fakeLineSchema } from './business.js';
import { ExternalSearchResults, type ExternalSearchResult } from './ExternalSearchResults.js';
import type { VisitorTaskView } from './task-view.js';

/** The same reviewed values become aligned columns or compact mobile records. */
export function TaskComparison({ comparison }: { comparison: NonNullable<VisitorTaskView['comparison']> }) {
  const id = useId();
  const { rows } = comparison;
  const value = (row: typeof rows[number], fieldId: string) => row.values.find(field => field.fieldId === fieldId)?.text ?? 'unknown';
  // Retained older results may still contain fields with no evidence on either item.
  const fields = comparison.fields.filter(field => rows.some(row => value(row, field.id) !== 'unknown'));
  const display = (text: string) => text === 'unknown' ? 'Not specified' : text;
  return <section aria-label="Selection comparison" className="platform-task-comparison">
    <p className="platform-task-comparison-count">{rows.length} items</p>
    <div className="platform-task-comparison-table"><table style={{ minWidth: 140 + rows.length * 180 }}>
      <thead><tr><th scope="col">Compare</th>{rows.map(row => <th scope="col" key={row.id} data-task-record={row.id}>{row.name}</th>)}</tr></thead>
      <tbody>{fields.map(field => <tr key={field.id}><th scope="row">{field.label}</th>{rows.map(row => <td key={row.id}>{display(value(row, field.id))}</td>)}</tr>)}</tbody>
    </table></div>
    {rows.length === 2 ? <div className="platform-task-comparison-pair"><table aria-label="Compare two items by attribute">
      <thead><tr>{rows.map((row, index) => <th scope="col" id={`${id}-item-${index}`} key={row.id} data-task-record={row.id}>{row.name}</th>)}</tr></thead>
      {fields.map((field, index) => <tbody key={field.id}>
        <tr><th colSpan={2} scope="rowgroup" id={`${id}-field-${index}`}>{field.label}</th></tr>
        <tr>{rows.map((row, rowIndex) => <td key={row.id} headers={`${id}-item-${rowIndex} ${id}-field-${index}`}>{display(value(row, field.id))}</td>)}</tr>
      </tbody>)}
    </table></div> : <div className="platform-task-comparison-records">{rows.map(row => <article key={row.id} data-task-record={row.id}>
      <h3>{row.name}</h3><dl>{fields.map(field => <div key={field.id}><dt>{field.label}</dt><dd>{display(value(row, field.id))}</dd></div>)}</dl>
    </article>)}</div>}
  </section>;
}

export function TaskProgress({ busy, label }: { busy: boolean; label: string }) { return <div role="status" aria-live="polite">{busy ? 'Updating collection…' : label}</div>; }
type Run = (capability: string, input: unknown) => void;
function ArtifactEditor({ artifact, busy, run, exportArtifact }: { artifact: VisitorArtifact; busy: boolean; run: Run; exportArtifact: (id: string) => void }) {
  const [draft, setDraft] = useState(artifact);
  const detail = draft.kind === 'brief' ? draft.objective : draft.kind === 'reading-list' ? draft.readingGoal : draft.timeZone;
  return <section aria-label={`${draft.kind} artifact`} className="platform-task-artifact"><h3>{draft.title}</h3><form onSubmit={event => { event.preventDefault(); run('artifact.edit', { id: draft.id, baseRevision: artifact.revision, title: draft.title, notes: draft.notes, saved: draft.saved, ...(draft.kind === 'brief' ? { objective: draft.objective } : draft.kind === 'reading-list' ? { readingGoal: draft.readingGoal } : { timeZone: draft.timeZone }), entries: draft.entries.map(({ recordId, note, time, timeZone }) => ({ recordId, note, time, timeZone })) }); }}>
    <label>Artifact title<input value={draft.title} maxLength={160} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
    <label>{draft.kind === 'brief' ? 'Project objective' : draft.kind === 'reading-list' ? 'Reading goal' : 'Itinerary time zone'}<input value={detail} maxLength={draft.kind === 'itinerary' ? 80 : 2000} onChange={event => setDraft(draft.kind === 'brief' ? { ...draft, objective: event.target.value } : draft.kind === 'reading-list' ? { ...draft, readingGoal: event.target.value } : { ...draft, timeZone: event.target.value })}/></label>
    <label>Artifact notes<textarea value={draft.notes} maxLength={4000} onChange={event => setDraft({ ...draft, notes: event.target.value })}/></label>
    <ol>{draft.entries.map((entry, index) => <li key={entry.recordId}><strong>{entry.title}</strong><p>{entry.summary}</p><label>Note for {entry.title}<input value={entry.note} maxLength={1000} onChange={event => setDraft({ ...draft, entries: draft.entries.map((value, i) => i === index ? { ...value, note: event.target.value } : value) })}/></label>{draft.kind === 'itinerary' && <label>Time for {entry.title}<input placeholder="2030-10-15T18:00:00-04:00" value={entry.time ?? ''} onChange={event => setDraft({ ...draft, entries: draft.entries.map((value, i) => i === index ? { ...value, time: event.target.value || undefined, timeZone: draft.timeZone } : value) })}/></label>}</li>)}</ol>
    {draft.sources.length > 0 && <section aria-label="Artifact external research"><h4>External research</h4>{draft.sources.map(source => <div key={source.handleId}><strong>{source.title}</strong><p>{source.excerpt}</p>{source.urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">Source</a>)}</div>)}</section>}
    <label><input type="checkbox" checked={draft.saved} onChange={event => setDraft({ ...draft, saved: event.target.checked })}/>Keep this artifact in my visitor session</label><button className="button secondary" disabled={busy}>Save artifact edits</button><button type="button" className="button secondary" disabled={busy} onClick={() => exportArtifact(artifact.id)}>Export saved version</button></form></section>;
}
export function VisitorArtifacts({ artifacts, busy, run, exportArtifact }: { artifacts: unknown[]; busy: boolean; run: Run; exportArtifact: (id: string) => void }) { return <>{artifacts.map(value => { const artifact = visitorArtifactSchema.parse(value); return <ArtifactEditor key={`${artifact.id}:${artifact.revision}`} artifact={artifact} busy={busy} run={run} exportArtifact={exportArtifact}/>; })}</>; }
export function ActionReview({ business, selected, busy, run }: { business: Record<string, unknown>; selected: { id: string; name: string }[]; busy: boolean; run: Run }) {
  const quote = fakeQuoteSchema.safeParse(business.quote), booking = fakeBookingSchema.safeParse(business.booking), receipt = fakeReceiptSchema.safeParse(business.receipt);
  const slots = fakeSlotSchema.array().safeParse(business.slots), cart = fakeLineSchema.array().safeParse((business.cart as { lines?: unknown })?.lines);
  const money = (minor: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
  const confirm = (kind: 'order' | 'booking', draft: { id: string; payloadHash: string }) => run('demo.confirm', { kind, confirmationId: draft.id, payloadHash: draft.payloadHash, operationId: crypto.randomUUID() });
  return <details className="platform-action-review"><summary>Synthetic action demo</summary><p>Local test data only. Prices, tax, delivery and appointment slots are fixtures. These controls do not place real orders or bookings.</p>
    {selected.map(record => <button className="button secondary" disabled={busy} key={record.id} onClick={() => run('demo.cart', { recordId: record.id, quantity: 1 })}>Add {record.name} to demo cart</button>)}
    {cart.success && <div aria-label="Synthetic cart">{cart.data.map(line => <label key={line.recordId}>{selected.find(record => record.id === line.recordId)?.name ?? line.recordId} · {money(line.unitMinor)}<input aria-label={`Quantity ${line.recordId}`} type="number" min={0} max={99} defaultValue={line.quantity} key={`${line.recordId}:${line.quantity}`} disabled={busy} onBlur={event => { if (Number(event.target.value) !== line.quantity) run('demo.cart', { recordId: line.recordId, quantity: Number(event.target.value) }); }}/></label>)}{cart.data.length > 0 && <button className="button secondary" disabled={busy} onClick={() => run('demo.quote', { destination: 'fixture-delivery' })}>Get synthetic quote</button>}</div>}
    {quote.success && <section aria-label="Synthetic quote review"><h3>Review synthetic estimate</h3><dl><dt>Items</dt><dd>{money(quote.data.subtotalMinor)}</dd><dt>Fixture tax</dt><dd>{money(quote.data.taxMinor)}</dd><dt>Fixture delivery</dt><dd>{money(quote.data.deliveryMinor)}</dd><dt>Total</dt><dd>{money(quote.data.totalMinor)}</dd></dl><p>Expires {new Date(quote.data.expiresAt).toLocaleTimeString()}.</p><button className="button secondary" disabled={busy} onClick={() => confirm('order', quote.data)}>Confirm synthetic order for {money(quote.data.totalMinor)}</button></section>}
    <button className="button secondary" disabled={busy} onClick={() => run('demo.availability', {})}>Find synthetic appointments</button>{slots.success && <div aria-label="Synthetic appointments">{slots.data.map(slot => <button className="button secondary" key={slot.id} disabled={busy} onClick={() => run('demo.booking', { slotId: slot.id })}>{new Date(slot.startsAt).toLocaleString('en-US', { timeZone: slot.timeZone })} · {slot.timeZone}</button>)}</div>}
    {booking.success && <section aria-label="Synthetic booking review"><h3>Review synthetic booking</h3><p>{new Date(booking.data.slot.startsAt).toLocaleString('en-US', { timeZone: booking.data.slot.timeZone })} · {booking.data.slot.timeZone}</p><button className="button secondary" disabled={busy} onClick={() => confirm('booking', booking.data)}>Confirm this synthetic appointment</button></section>}
    {receipt.success && <p role="status">Synthetic {receipt.data.kind} confirmed · receipt {receipt.data.id}</p>}
  </details>;
}

export function TaskResearch({ result, onInteraction }: { result: ExternalSearchResult; onInteraction: () => void }) {
  const [selected, setSelected] = useState<string | null>(null), [kind, setKind] = useState(result.kind), [closed, setClosed] = useState(false), [map, setMap] = useState(result.map);
  return closed ? null : <ExternalSearchResults result={{ ...result, map }} kind={kind} selected={selected} onInteraction={onInteraction} onCommand={command => {
    if (command.kind === 'back') { if (selected) setSelected(null); else setClosed(true); }
    else if ('id' in command) setSelected(command.id);
    else if (command.kind === 'web' || command.kind === 'images') setKind(command.kind);
    else if (map) setMap({ ...map, zoom: Math.min(12, Math.max(2, map.zoom + (command.kind === 'zoom_in' ? 1 : -1))) });
  }}/>;
}

export { PublishedEstimateView } from './PublishedEstimate.js';
