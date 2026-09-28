import { validateCatalog, type CatalogEntity, type CatalogRelationship } from './contracts.js';

export type CatalogDiagram = {
  rootId: string;
  nodes: { entity: CatalogEntity; depth: number }[];
  relationships: CatalogRelationship[];
  omitted: number;
};

/** A bounded two-hop view of approved relationships, never a generated executable workflow. */
export function catalogDiagram(input: unknown, rootId: string): CatalogDiagram {
  const catalog = validateCatalog(input);
  if (!catalog.entities.some(entity => entity.id === rootId)) throw new Error('Unknown diagram item.');
  const depths = new Map([[rootId, 0]]);
  for (let depth = 0; depth < 2; depth++) {
    const frontier = new Set([...depths].filter(([, value]) => value === depth).map(([id]) => id));
    for (const relationship of catalog.relationships) {
      const neighbor = frontier.has(relationship.fromEntityId) ? relationship.toEntityId : frontier.has(relationship.toEntityId) ? relationship.fromEntityId : null;
      if (neighbor && !depths.has(neighbor)) depths.set(neighbor, depth + 1);
    }
  }
  const candidates = [...depths].map(([id, depth]) => ({ entity: catalog.entities.find(entity => entity.id === id)!, depth }));
  const nodes = candidates.slice(0, 12), included = new Set(nodes.map(node => node.entity.id));
  const relationships = catalog.relationships.filter(item => included.has(item.fromEntityId) && included.has(item.toEntityId));
  return { rootId, nodes, relationships: relationships.slice(0, 24), omitted: candidates.length - nodes.length + Math.max(0, relationships.length - 24) };
}

/** Keep negation, qualifiers and dates visible rather than implying unconditional facts. */
export function diagramRelationshipLabel(relationship: CatalogRelationship): string {
  const qualifiers = relationship.qualifiers?.map(item => `${item.predicate}: ${item.value ?? 'not supplied'}`) ?? [];
  if (relationship.validFrom) qualifiers.push(`from ${relationship.validFrom}`);
  if (relationship.validTo) qualifiers.push(`until ${relationship.validTo}`);
  if (relationship.observedAt) qualifiers.push(`observed ${relationship.observedAt}`);
  if (relationship.confidence !== undefined) qualifiers.push(`confidence ${Math.round(relationship.confidence * 100)}%`);
  return `${relationship.polarity === 'denied' ? 'Not: ' : ''}${relationship.label}${qualifiers.length ? ` (${qualifiers.join('; ')})` : ''}`;
}
