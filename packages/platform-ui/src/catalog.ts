import { validateCatalogFilters, isCatalogValue, validatePlan, type AttributeDefinition, type CatalogEntity, type CatalogFilter, type CatalogValue, type KnowledgeCatalog, type PresentationPlan } from './contracts.js';

export function filterOperatorLabel(operator: CatalogFilter['operator'], type: AttributeDefinition['type']): string {
  return type === 'date' ? { eq: 'On', contains: 'Contains', lt: 'Before', lte: 'On or before', gt: 'After', gte: 'On or after' }[operator]
    : { eq: 'Exactly', contains: 'Contains', lt: 'Under', lte: 'Up to', gt: 'Over', gte: 'At least' }[operator];
}

export function formatAttribute(value: CatalogValue | undefined, definition: AttributeDefinition): string {
  if (value === null || value === undefined) return 'Not provided';
  if (!isCatalogValue(value, definition)) return 'Not provided';
  if (definition.type === 'money') {
    if (!definition.currency || typeof value !== 'number') return 'Not provided';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: definition.currency }).format(value);
  }
  if (definition.type === 'boolean') return value ? 'Yes' : 'No';
  if (definition.type === 'date') return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${value}T00:00:00Z`));
  if (typeof value === 'number') return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(value)}${definition.unit ? ` ${definition.unit}` : ''}`;
  return String(value);
}

/** Return only facts that this entity actually publishes. Renderers must never turn an absent value into content. */
export function knownAttributes(entity: CatalogEntity, attributes: AttributeDefinition[]) {
  return attributes.filter(attribute => {
    const value = entity.attributes[attribute.id];
    return value !== null && value !== undefined && isCatalogValue(value, attribute);
  });
}

/** Attributes with real variation make useful filters and card details; sparse placeholders do neither. */
export function usefulAttributes(catalog: KnowledgeCatalog, attributes = catalog.attributes) {
  return attributes.filter(attribute => {
    const values = catalog.entities.flatMap(entity => {
      const value = entity.attributes[attribute.id];
      return value !== null && value !== undefined && isCatalogValue(value, attribute) ? [value] : [];
    });
    return values.length >= 2 && new Set(values.map(value => String(value))).size >= 2;
  });
}

/** Unknown values never match a positive constraint except an explicit unknown-value equality. */
export function filterEntities(catalog: KnowledgeCatalog, input: CatalogFilter[]) {
  const filters = validateCatalogFilters(input, catalog);
  return catalog.entities.filter(entity => filters.every(filter => {
    const value = entity.attributes[filter.attributeId] ?? null;
    if (filter.value === null) return value === null;
    if (value === null) return false;
    if (filter.operator === 'eq') return typeof value === 'string' && typeof filter.value === 'string' ? value.toLocaleLowerCase('en-US') === filter.value.toLocaleLowerCase('en-US') : value === filter.value;
    if (filter.operator === 'contains') return typeof value === 'string' && typeof filter.value === 'string' && value.toLocaleLowerCase('en-US').includes(filter.value.toLocaleLowerCase('en-US'));
    if (typeof value !== typeof filter.value || typeof value === 'boolean' || typeof filter.value === 'boolean') return false;
    if (filter.operator === 'lt') return value < filter.value;
    if (filter.operator === 'gt') return value > filter.value;
    return filter.operator === 'lte' ? value <= filter.value : value >= filter.value;
  }));
}

export function defaultPresentation(catalog: KnowledgeCatalog, snapshotId = catalog.id): PresentationPlan {
  const attributes = usefulAttributes(catalog);
  return validatePlan({ schemaVersion: 1, snapshotId, operation: 'discover', components: [
    { id: 'collection', type: 'collection', variant: 'grid', entityIds: [], attributeIds: attributes.slice(0, 6).map(attribute => attribute.id) },
  ], transition: { type: 'none' } }, catalog, snapshotId);
}
