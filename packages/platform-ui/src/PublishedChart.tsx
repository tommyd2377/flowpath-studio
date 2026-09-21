'use client';
import type { KnowledgeCatalog } from './contracts.js';
import { formatAttribute } from './catalog.js';

/** A registered quantitative view over approved numeric values, not model data. */
export function PublishedChart({ catalog, entityIds, selectedId, onSelect, metric }: { catalog: KnowledgeCatalog; entityIds: string[]; metric?: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const entities = catalog.entities.filter(entity => entityIds.includes(entity.id)).slice(0, 12);
  const attribute = catalog.attributes.find(attribute => (!metric || attribute.id === metric) && ['number', 'money'].includes(attribute.type) && entities.some(entity => typeof entity.attributes[attribute.id] === 'number'));
  if (!attribute) return <p>No comparable numeric values have been published for these items.</p>;
  const rows = entities.flatMap(entity => typeof entity.attributes[attribute.id] === 'number' ? [{ entity, value: entity.attributes[attribute.id] as number }] : []);
  const maximum = Math.max(1, ...rows.map(row => Math.abs(row.value)));
  return <figure className="platform-published-chart" aria-label={`${attribute.label} chart`}><figcaption>{attribute.label}</figcaption>
    <div role="group" aria-label={`Compare ${attribute.label.toLowerCase()}`}>{rows.map(({ entity, value }) => <button type="button" key={entity.id} aria-pressed={selectedId === entity.id} onClick={() => onSelect(entity.id)}>
      <span>{entity.name}</span><strong>{formatAttribute(value, attribute)}</strong><span aria-hidden="true" className="platform-chart-track"><span style={{ width: `${Math.abs(value) / maximum * 100}%` }}/></span>
    </button>)}</div><small>Published values · {rows.length} items{rows.length < entities.length ? ' · unknown values omitted' : ''}</small>
  </figure>;
}
