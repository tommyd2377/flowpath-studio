'use client';

import { useRef, useState } from 'react';
import { knowledgeReviewGroups, pendingKnowledgeReviews } from '@/lib/knowledge-review-groups';
import type { CatalogFact, CatalogRelationship, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { KnowledgeCandidate } from '@/lib/knowledge-model';
import type { AssertionDecision } from '@/lib/knowledge-assertions';

export function AssertionReviews({ candidate, disabled, decide, resolvedAssertion }: { candidate: KnowledgeCandidate; disabled: boolean; decide: (decisions: AssertionDecision[]) => Promise<void>; resolvedAssertion?: string }) {
  const reviews = candidate.assertionReviews ?? [];
  const [open, setOpen] = useState(() => reviews.some(review => `${review.targetType}/${review.targetId}` === resolvedAssertion)
    || reviews.some(review => review.support === 'unsupported' && review.status === 'pending') && reviews.some(review => review.status === 'approved' || review.status === 'rejected'));
  const pending = pendingKnowledgeReviews(candidate);
  const [acknowledged, setAcknowledged] = useState(false);
  const groups = knowledgeReviewGroups(candidate);
  const fieldDetails = useRef<HTMLDetailsElement>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const visible = selectedGroup ? groups.find(group => group.id === selectedGroup)?.reviews ?? [] : reviews;
  return <section aria-label="Content review">
    <h4>{pending.length ? 'Review your website content' : 'Content ready to apply'}</h4>
    <p className="field-help">{pending.length ? `${pending.length} fields across ${groups.filter(group => group.reviews.some(review => review.support === 'unsupported' && review.status === 'pending')).length} items lack linked source evidence. Review the content below. You can approve it together as your publisher decision, or inspect individual fields.` : 'No unresolved evidence decisions. Apply to draft saves this content; Publish updates your website.'}</p>
    <div className="knowledge-content-review">{groups.map(group => <article key={group.id}>
      <strong>{group.name}</strong>{group.summary && <p>{group.summary}</p>}
      {candidate.catalog.entities.find(entity => entity.id === group.id)?.blocks?.length ? <details><summary>Read section content</summary>{candidate.catalog.entities.find(entity => entity.id === group.id)!.blocks!.map(block => <p key={block.id}>{block.text}</p>)}</details> : null}
      <button className="text-button" disabled={disabled} onClick={() => { setSelectedGroup(group.id); setOpen(true); fieldDetails.current?.scrollIntoView({ block: 'start' }); fieldDetails.current?.focus(); }}>{group.reviews.filter(review => review.support === 'unsupported' && review.status === 'pending').length} fields need review · Inspect fields</button>
    </article>)}</div>
    {pending.length > 0 && <div className="knowledge-review-confirm">
      <label><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={event => setAcknowledged(event.target.checked)}/> I have reviewed this content and approve the pending fields as my publisher decisions. This does not verify them against the source.</label>
      <button className="button secondary" disabled={disabled || !acknowledged} onClick={() => void decide(pending.map(review => ({ targetType: review.targetType, targetId: review.targetId, decision: 'approve' })))}>Approve reviewed content ({pending.length} fields)</button>
    </div>}
    <details ref={fieldDetails} tabIndex={-1} open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Individual fields and source evidence ({pending.length} need review)</summary>
    {selectedGroup && <button className="text-button" onClick={() => setSelectedGroup(null)}>Show all fields</button>}
    <p className="field-help">A linked excerpt identifies a location, not proof that its text supports the claim. Apply approves visible anchored proposals. Unsupported claims need your explicit decision. Publisher corrections are your decisions, not source evidence. Missing values remain unknown.</p>
    {open && visible.map(review => {
      const [entityId, field] = review.targetId.split('/');
      const fact = candidate.catalog.facts?.find(fact => review.targetType === 'fact' && fact.id === review.targetId);
      const relation = candidate.catalog.relationships.find(relation => review.targetType === 'relationship' && relation.id === review.targetId);
      const entity = candidate.catalog.entities.find(entity => entity.id === (fact?.entityId ?? relation?.fromEntityId ?? entityId));
      const value = review.targetId === 'catalog/description' ? candidate.catalog.description : fact?.value ?? (field?.startsWith('attributes.') ? entity?.attributes[field.slice(11)] : entity?.[field as 'name' | 'kind' | 'summary' | 'aliases' | 'identifiers']);
      const references = candidate.origins?.flatMap(origin => {
        const provenance = origin.provenance;
        const ids = review.targetType === 'field' ? provenance?.fields.find(reference => reference.entityId === entityId && reference.field === field)?.anchorIds
          : (review.targetType === 'fact' ? provenance?.facts : provenance?.relationships)?.find(reference => reference.targetId === review.targetId)?.anchorIds;
        return (provenance?.anchors ?? []).filter(anchor => ids?.includes(anchor.id)).map(anchor => ({ name: origin.name, key: `${origin.key}/${anchor.id}`, anchor }));
      }) ?? [];
      return <article key={`${review.targetType}/${review.targetId}`} data-assertion-review={`${review.targetType}/${review.targetId}`} tabIndex={-1} aria-label={`${entity?.name ?? 'Assertion'} ${fact?.field ?? relation?.label ?? field}`}>
        <strong>{entity?.name} · {fact?.definition?.label ?? fact?.field ?? relation?.label ?? field}</strong>
        <p>{relation ? `${relation.label} → ${candidate.catalog.entities.find(entity => entity.id === relation.toEntityId)?.name}` : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? 'Unknown')}</p>
        <p>{review.origin === 'model' ? 'Model interpretation' : review.origin === 'publisher' ? 'Publisher correction' : 'Deterministic source reading'} · {review.support} · {review.status}</p>
        {review.extractionConfidence !== undefined && <p>Uncalibrated extraction score: {review.extractionConfidence}</p>}
        <details><summary>Review supporting excerpts</summary>{review.support === 'publisher' && <p>Earlier excerpts below are historical context only; they do not establish this correction.</p>}{references.length ? references.map(({ key, name, anchor }) => <figure key={key}><figcaption>{name} · {anchor.label}</figcaption><pre>{anchor.excerpt}</pre></figure>) : <p>No exact source excerpt supports this assertion.</p>}</details>
        <div className="knowledge-update-choices"><button className="button secondary" disabled={disabled || review.status === 'approved'} onClick={() => void decide([{ targetType: review.targetType, targetId: review.targetId, decision: 'approve' }])}>Approve assertion</button><button className="button secondary" disabled={disabled || review.status === 'rejected'} onClick={() => void decide([{ targetType: review.targetType, targetId: review.targetId, decision: 'reject' }])}>Reject assertion</button></div>
      </article>;
    })}
  </details>
  </section>;
}

function Qualifiers({ value, disabled, change }: { value: CatalogFact | CatalogRelationship; disabled: boolean; change: (patch: Partial<CatalogFact & CatalogRelationship>) => void }) {
  return <>
    <label className="field">Polarity<select disabled={disabled} value={value.polarity ?? 'affirmed'} onChange={event => change({ polarity: event.target.value as 'affirmed' | 'denied' })}><option value="affirmed">Affirmed</option><option value="denied">Denied / negated</option></select></label>
    {(['validFrom', 'validTo', 'observedAt'] as const).map(key => <label className="field" key={key}>{key === 'validFrom' ? 'Valid from' : key === 'validTo' ? 'Valid through' : 'Observed at (not import time)'}<input disabled={disabled} placeholder="YYYY-MM-DD or UTC timestamp" value={value[key] ?? ''} onChange={event => change({ [key]: event.target.value || undefined })}/></label>)}
    <label className="field">Source-stated certainty (0–1; leave blank if absent)<input type="number" min={0} max={1} step="any" disabled={disabled} value={value.confidence ?? ''} onChange={event => change({ confidence: event.target.value === '' ? undefined : Number(event.target.value) })}/></label>
    {(value.qualifiers ?? []).map((qualifier, index) => <div key={index}><label className="field">Condition predicate<input disabled={disabled} value={qualifier.predicate} onChange={event => change({ qualifiers: value.qualifiers!.map((item, at) => at === index ? { ...item, predicate: event.target.value } : item) })}/></label><label className="field">Condition value<input disabled={disabled} value={String(qualifier.value ?? '')} onChange={event => change({ qualifiers: value.qualifiers!.map((item, at) => at === index ? { ...item, value: event.target.value || null } : item) })}/></label><button className="text-button" disabled={disabled} onClick={() => change({ qualifiers: value.qualifiers!.filter((_, at) => at !== index) })}>Remove condition</button></div>)}
    <button className="text-button" disabled={disabled || (value.qualifiers?.length ?? 0) >= 8} onClick={() => change({ qualifiers: [...(value.qualifiers ?? []), { predicate: 'condition', value: null }] })}>Add condition or exception</button>
  </>;
}
export function KnowledgeAssertionsEditor({ catalog, disabled, change }: { catalog: KnowledgeCatalog; disabled: boolean; change: (catalog: KnowledgeCatalog) => void }) {
  const factChange = (id: string, patch: Partial<CatalogFact>) => change({ ...catalog, facts: catalog.facts?.map(fact => fact.id === id ? { ...fact, ...patch } : fact) });
  const relationChange = (id: string, patch: Partial<CatalogRelationship>) => change({ ...catalog, relationships: catalog.relationships.map(relation => relation.id === id ? { ...relation, ...patch } : relation) });
  return <details><summary>Edit individual facts and relationships ({catalog.facts?.length ?? 0} facts, {catalog.relationships.length} relationships)</summary>
    <p className="field-help">Singleton facts do not need to be comparison columns. Corrections save a new private revision. Conditional, conflicting or out-of-time assertions are not flattened into current card values.</p>
    {(catalog.facts ?? []).map(fact => {
      const definition = fact.definition ?? catalog.attributes.find(attribute => fact.field === `attributes.${attribute.id}`);
      const numeric = definition?.type === 'money' || definition?.type === 'number';
      return <details key={fact.id}><summary>{catalog.entities.find(entity => entity.id === fact.entityId)?.name} · {definition?.label ?? fact.field} · {fact.value === null ? 'Unknown' : String(fact.value)}</summary>
        {fact.definition && <><label className="field">Domain predicate<input disabled={disabled} value={fact.definition.id} onChange={event => factChange(fact.id, { field: `properties.${event.target.value}`, definition: { ...fact.definition!, id: event.target.value } })}/></label><label className="field">Fact label<input disabled={disabled} value={fact.definition.label} onChange={event => factChange(fact.id, { definition: { ...fact.definition!, label: event.target.value } })}/></label>
          <label className="field">Value type<select disabled={disabled} value={definition!.type} onChange={event => factChange(fact.id, { value: null, definition: { id: definition!.id, label: definition!.label, type: event.target.value as AttributeDefinitionType, ...(event.target.value === 'money' ? { currency: '' } : {}) } })}>{['text', 'number', 'money', 'date', 'boolean'].map(type => <option key={type}>{type}</option>)}</select></label>
          {numeric && <label className="field">Unit<input disabled={disabled} value={definition!.unit ?? ''} onChange={event => factChange(fact.id, { definition: { ...definition!, unit: event.target.value || undefined } })}/></label>}
          {definition?.type === 'money' && <label className="field">Currency<input disabled={disabled} maxLength={3} value={definition.currency ?? ''} onChange={event => factChange(fact.id, { definition: { ...definition, currency: event.target.value.toUpperCase() } })}/></label>}
        </>}
        <label className="field">Assertion value{definition?.type === 'boolean' ? <select disabled={disabled} value={fact.value === null ? '' : String(fact.value)} onChange={event => factChange(fact.id, { value: event.target.value === '' ? null : event.target.value === 'true', expression: undefined })}><option value="">Unknown</option><option value="true">True</option><option value="false">False</option></select>
          : <input disabled={disabled} type={numeric ? 'number' : definition?.type === 'date' ? 'date' : 'text'} step="any" value={String(fact.value ?? '')} placeholder="Unknown" onChange={event => factChange(fact.id, { value: event.target.value === '' ? null : numeric ? Number(event.target.value) : event.target.value, expression: undefined })}/>}</label>
        {fact.expression && <p>Unevaluated expression: <code>{fact.expression}</code>. A typed value is an explicit publisher correction, not a calculated result.</p>}
        <Qualifiers value={fact} disabled={disabled} change={patch => factChange(fact.id, patch)}/><button className="text-button" disabled={disabled} onClick={() => change({ ...catalog, facts: catalog.facts?.filter(item => item.id !== fact.id) })}>Remove fact</button>
      </details>;
    })}
    <label className="field">Add a singleton fact to<select disabled={disabled || (catalog.facts?.length ?? 0) >= 2000} value="" onChange={event => { if (event.target.value) change({ ...catalog, facts: [...(catalog.facts ?? []), { id: crypto.randomUUID(), entityId: event.target.value, field: 'properties.detail', value: null, definition: { id: 'detail', label: 'Detail', type: 'text' } }] }); }}><option value="">Choose an entity</option>{catalog.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>
    {catalog.relationships.map(relation => <details key={relation.id}><summary>{catalog.entities.find(entity => entity.id === relation.fromEntityId)?.name} → {relation.label} → {catalog.entities.find(entity => entity.id === relation.toEntityId)?.name}</summary>
      {(['fromEntityId', 'toEntityId'] as const).map(key => <label key={key} className="field">{key === 'fromEntityId' ? 'From entity' : 'To entity'}<select disabled={disabled} value={relation[key]} onChange={event => relationChange(relation.id, { [key]: event.target.value })}>{catalog.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select></label>)}
      {(['label', 'kind', 'inverseLabel'] as const).map(key => <label className="field" key={key}>{key === 'kind' ? 'Relationship predicate' : key === 'label' ? 'Relationship label' : 'Inverse label'}<input disabled={disabled} value={relation[key] ?? ''} onChange={event => relationChange(relation.id, { [key]: event.target.value || (key === 'label' ? '' : undefined) })}/></label>)}
      <Qualifiers value={relation} disabled={disabled} change={patch => relationChange(relation.id, patch)}/><button className="text-button" disabled={disabled} onClick={() => change({ ...catalog, relationships: catalog.relationships.filter(item => item.id !== relation.id) })}>Remove relationship</button>
    </details>)}
    <button className="button secondary" disabled={disabled || catalog.entities.length < 2 || catalog.relationships.length >= 200} onClick={() => change({ ...catalog, relationships: [...catalog.relationships, { id: crypto.randomUUID(), fromEntityId: catalog.entities[0].id, toEntityId: catalog.entities[1].id, label: 'Related to' }] })}>Add relationship</button>
  </details>;
}
type AttributeDefinitionType = NonNullable<CatalogFact['definition']>['type'];
