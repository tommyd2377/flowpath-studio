'use client';
import { useState } from 'react';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';

export function CollectionReview({ catalog, change, disabled }: { catalog: KnowledgeCatalog; change: (catalog: KnowledgeCatalog) => void; disabled: boolean }) {
  const [selected, setSelected] = useState(catalog.collections[0]?.id ?? '');
  const [past, setPast] = useState<KnowledgeCatalog[]>([]);
  const [error, setError] = useState('');
  const collection = catalog.collections.find(item => item.id === selected);
  function update(next: KnowledgeCatalog) {
    try { validateCatalog(next); setPast(history => [...history, catalog].slice(-20)); change(next); setError(''); }
    catch { setError('Collections must have unique names/IDs, valid memberships and no parent cycles.'); }
  }
  function tree(parent?: string, path: string[] = []): React.ReactNode {
    return <ul>{catalog.collections.filter(item => parent ? item.parentIds?.includes(parent) : !item.parentIds?.length).map(item => <li key={[...path, item.id].join('/')}>
      <button type="button" className="text-button" aria-pressed={item.id === selected} onClick={() => setSelected(item.id)}>{item.name} ({item.entityIds.length})</button>
      {tree(item.id, [...path, item.id])}
    </li>)}</ul>;
  }
  return <details className="knowledge-collections"><summary>Collections and filters</summary>
    <p className="field-help">This organization is a proposal. One item can appear in several collections while keeping one set of facts. Review private source material below before Apply.</p>
    <nav aria-label="Proposed collections">{tree()}</nav>
    <button type="button" className="button secondary" disabled={disabled || catalog.collections.length >= 24} onClick={() => { const id = crypto.randomUUID(); update({ ...catalog, collections: [...catalog.collections, { id, name: 'New collection', entityIds: [], ...(collection ? { parentIds: [collection.id] } : {}) }] }); setSelected(id); }}>Create subcollection</button>
    <button type="button" className="text-button" disabled={disabled || !past.length} onClick={() => { change(past.at(-1)!); setPast(past.slice(0, -1)); }}>Undo organization edit</button>
    {collection && <fieldset disabled={disabled}><legend>Collection preview</legend>
      <label className="field">Collection name<input value={collection.name} maxLength={160} onChange={event => update({ ...catalog, collections: catalog.collections.map(item => item.id === selected ? { ...item, name: event.target.value } : item) })}/></label>
      <label className="field">Parent collection<select value={collection.parentIds?.[0] ?? ''} onChange={event => update({ ...catalog, collections: catalog.collections.map(item => item.id === selected ? { ...item, parentIds: event.target.value ? [event.target.value] : [] } : item) })}><option value="">Publication root</option>{catalog.collections.filter(item => item.id !== selected).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {catalog.entities.map(record => <label key={record.id} className="field"><span><input type="checkbox" checked={collection.entityIds.includes(record.id)} onChange={event => update({ ...catalog, collections: catalog.collections.map(item => item.id === selected ? { ...item, entityIds: event.target.checked ? [...item.entityIds, record.id] : item.entityIds.filter(id => id !== record.id) } : item) })}/>{record.name}</span></label>)}
      <p className="field-help">Removing this collection keeps its {collection.entityIds.length} items and moves child collections to the root.</p>
      <button type="button" className="text-button" onClick={() => update({ ...catalog, collections: catalog.collections.filter(item => item.id !== selected).map(item => ({ ...item, parentIds: item.parentIds?.filter(id => id !== selected) })) })}>Remove collection organization</button>
    </fieldset>}
    <h4>Filters and terminology</h4>{catalog.attributes.map(field => <label className="field" key={field.id}>{field.label} · {catalog.entities.filter(item => item.attributes[field.id] !== null && item.attributes[field.id] !== undefined).length}/{catalog.entities.length} populated · {field.unit ?? field.currency ?? field.type}
      <input disabled={disabled} aria-label={`Aliases for ${field.label}`} value={(field.aliases ?? []).join(', ')} onChange={event => update({ ...catalog, attributes: catalog.attributes.map(item => item.id === field.id ? { ...item, aliases: event.target.value.split(',').map(value => value.trim()).filter(Boolean) } : item) })}/></label>)}
    {error && <p role="alert">{error}</p>}
  </details>;
}
