import { catalogFilterSchema, isCatalogValue, validatePlan, type AttributeDefinition, type CatalogFilter, type CatalogValue, type KnowledgeCatalog, type PresentationPlan } from './contracts.js';

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

/** Unknown values never match a positive constraint except an explicit unknown-value equality. */
export function filterEntities(catalog: KnowledgeCatalog, input: CatalogFilter[]) {
  const filters = catalogFilterSchema.array().max(24).parse(input);
  const definitions = new Map(catalog.attributes.map(attribute => [attribute.id, attribute]));
  for (const filter of filters) {
    const definition = definitions.get(filter.attributeId);
    if (!definition || !isCatalogValue(filter.value, definition)) throw new Error('Unsupported filter attribute or value.');
    if (filter.operator === 'contains' && definition.type !== 'text') throw new Error('Contains applies only to text.');
    if (['lte', 'gte'].includes(filter.operator) && !['number', 'money', 'date'].includes(definition.type)) throw new Error('Range filters require a numeric or date attribute.');
    if (filter.value === null && filter.operator !== 'eq') throw new Error('Unknown values support only equality filtering.');
  }
  return catalog.entities.filter(entity => filters.every(filter => {
    const value = entity.attributes[filter.attributeId] ?? null;
    if (filter.value === null) return value === null;
    if (value === null) return false;
    if (filter.operator === 'eq') return typeof value === 'string' && typeof filter.value === 'string' ? value.toLocaleLowerCase('en-US') === filter.value.toLocaleLowerCase('en-US') : value === filter.value;
    if (filter.operator === 'contains') return typeof value === 'string' && typeof filter.value === 'string' && value.toLocaleLowerCase('en-US').includes(filter.value.toLocaleLowerCase('en-US'));
    if (typeof value !== typeof filter.value || typeof value === 'boolean' || typeof filter.value === 'boolean') return false;
    return filter.operator === 'lte' ? value <= filter.value : value >= filter.value;
  }));
}

export function defaultPresentation(catalog: KnowledgeCatalog, snapshotId = catalog.id): PresentationPlan {
  return validatePlan({ schemaVersion: 1, snapshotId, operation: 'discover', components: [
    { id: 'collection', type: 'collection', variant: 'grid', entityIds: [], attributeIds: catalog.attributes.slice(0, 3).map(attribute => attribute.id) },
    ...(catalog.attributes.length ? [{ id: 'criteria', type: 'criteria', variant: 'compact', entityIds: [], attributeIds: catalog.attributes.map(attribute => attribute.id) }] : []),
  ], transition: { type: 'none' } }, catalog, snapshotId);
}
