'use client';

import { Component, Suspense, lazy, useMemo, useState, type ReactNode } from 'react';
import { catalogDiagram, diagramRelationshipLabel } from './catalog-diagram.js';
import type { KnowledgeCatalog } from './contracts.js';

const DiagramCanvas = lazy(() => import('./CatalogDiagramCanvas.js'));
class DiagramBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="status">The map could not load. The relationship list remains available below.</p> : this.props.children; }
}

/** Optional read-only exploration. The host owns selection and any subsequent task. */
export function CatalogDiagram({ catalog, rootId, onSelect }: { catalog: KnowledgeCatalog; rootId: string; onSelect?: (entityId: string) => void }) {
  const diagram = useMemo(() => catalogDiagram(catalog, rootId), [catalog, rootId]);
  const [mapOpen, setMapOpen] = useState(false);
  const [selection, setSelection] = useState({ root: rootId, id: rootId });
  const selected = diagram.nodes.find(node => node.entity.id === (selection.root === rootId ? selection.id : rootId))?.entity ?? diagram.nodes[0].entity;
  const select = (id: string) => { setSelection({ root: rootId, id }); onSelect?.(id); };
  return <div className="platform-catalog-diagram">
    <button className="platform-diagram-toggle" type="button" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? 'Hide relationship map' : 'View relationship map'}</button>
    {mapOpen && <div className="platform-diagram-visual"><DiagramBoundary key={catalog.id + rootId}>
      <Suspense fallback={<p role="status">Loading relationship map…</p>}><DiagramCanvas diagram={diagram} selectedId={selected.id} onSelect={select}/></Suspense>
    </DiagramBoundary></div>}
    <div className="platform-diagram-detail" aria-live="polite" aria-atomic="true"><h3>{selected.name}</h3><p>{selected.summary}</p></div>
    <ul className="platform-diagram-list" aria-label="Published relationships">
      {diagram.relationships.map(relationship => {
        const from = diagram.nodes.find(node => node.entity.id === relationship.fromEntityId)!.entity;
        const to = diagram.nodes.find(node => node.entity.id === relationship.toEntityId)!.entity;
        return <li key={relationship.id}><button type="button" onClick={() => select(from.id)} aria-pressed={selected.id === from.id}>{from.name}</button><span>{diagramRelationshipLabel(relationship)}</span><button type="button" onClick={() => select(to.id)} aria-pressed={selected.id === to.id}>{to.name}</button></li>;
      })}
    </ul>
    {!diagram.relationships.length && <p>No published relationships for this item.</p>}
    {diagram.omitted > 0 && <p role="status">Showing a focused selection; {diagram.omitted} additional items or relationships are outside this map.</p>}
  </div>;
}
