import { z } from 'zod';
import { galleryAssetIds, validateMediaLibrary, type MediaLibrary } from './media.js';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const label = z.string().trim().min(1).max(160);
const ids = (limit = 100) => z.array(id).max(limit);
export const catalogValueSchema = z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()]);
export type CatalogValue = z.infer<typeof catalogValueSchema>;

export const attributeDefinitionSchema = z.object({
  id, label, type: z.enum(['text', 'number', 'money', 'date', 'boolean']),
  unit: z.string().trim().min(1).max(32).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
}).strict();
export const catalogEntitySchema = z.object({
  id, kind: z.string().trim().min(1).max(64), name: label,
  summary: z.string().max(1600), attributes: z.record(id, catalogValueSchema),
}).strict();
export const catalogCollectionSchema = z.object({ id, name: label, entityIds: ids() }).strict();
export const catalogRelationshipSchema = z.object({ id, fromEntityId: id, toEntityId: id, label }).strict();
export const catalogJobSchema = z.object({ id, label, attributeIds: ids(24) }).strict();

/** Navigation destinations are registered by the publisher/backend, never generated in a display plan. */
export function isSafeCapabilityUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || /(?:^|\.)(?:localhost|local|internal|home|test|invalid)$/.test(host)) return false;
    // Reject literal addresses entirely, including URL-normalized numeric/IPv6 forms.
    if (host.startsWith('[') || /^\d+(?:\.\d+){3}$/.test(host)) return false;
    return !/(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host);
  } catch { return false; }
}

export const capabilityDefinitionSchema = z.object({
  id, kind: z.literal('link'), label,
  url: z.string().max(2048).refine(isSafeCapabilityUrl, 'Use a public HTTPS destination without credentials.'),
  entityIds: ids(),
}).strict();
/** Shape-only schema is also usable with structured generation. validateCatalog checks cross-references. */
export const knowledgeCatalogSchema = z.object({
  schemaVersion: z.literal(1), id, name: label, description: z.string().max(3000),
  attributes: z.array(attributeDefinitionSchema).max(24),
  entities: z.array(catalogEntitySchema).min(1).max(100),
  collections: z.array(catalogCollectionSchema).max(24),
  relationships: z.array(catalogRelationshipSchema).max(200),
  jobs: z.array(catalogJobSchema).max(12),
  capabilities: z.array(capabilityDefinitionSchema).max(20).optional(),
}).strict();

export type AttributeDefinition = z.infer<typeof attributeDefinitionSchema>;
export type CatalogEntity = z.infer<typeof catalogEntitySchema>;
export type CatalogCollection = z.infer<typeof catalogCollectionSchema>;
export type CatalogRelationship = z.infer<typeof catalogRelationshipSchema>;
export type CatalogJob = z.infer<typeof catalogJobSchema>;
export type CapabilityDefinition = z.infer<typeof capabilityDefinitionSchema>;
export type KnowledgeCatalog = z.infer<typeof knowledgeCatalogSchema>;

export const componentTypes = ['collection', 'criteria', 'detail', 'comparison', 'selection', 'relationships', 'actions', 'gallery'] as const;
export const componentVariants = {
  collection: ['grid', 'list'], criteria: ['compact', 'expanded'], detail: ['compact', 'expanded'],
  comparison: ['compact', 'expanded'], selection: ['compact', 'list'],
  relationships: ['compact', 'list'], actions: ['compact', 'list'], gallery: ['grid', 'list'],
} as const;
export const presentationComponentSchema = z.object({
  id, type: z.enum(componentTypes), variant: z.enum(['grid', 'list', 'compact', 'expanded']),
  entityIds: ids(), attributeIds: ids(24), collectionId: id.optional(), capabilityIds: ids(20).optional(),
  assetIds: ids().optional(), albumId: id.optional(),
}).strict();
export const semanticTransitionSchema = z.object({
  type: z.enum(['none', 'focus', 'reveal', 'replace', 'expand', 'workspace-shift', 'restore']),
  targetComponentId: z.enum(componentTypes).optional(),
}).strict();
export const catalogFilterSchema = z.object({
  attributeId: id, operator: z.enum(['eq', 'contains', 'lt', 'lte', 'gt', 'gte']), value: catalogValueSchema,
}).strict();
export type CatalogFilter = z.infer<typeof catalogFilterSchema>;
export const presentationPlanSchema = z.object({
  schemaVersion: z.literal(1), snapshotId: id,
  operation: z.enum(['discover', 'understand', 'narrow', 'compare', 'decide', 'act']),
  components: z.array(presentationComponentSchema).min(1).max(8), transition: semanticTransitionSchema,
  stateUpdate: z.object({ filters: z.array(catalogFilterSchema).max(24) }).strict().optional(),
}).strict();
export type PresentationComponent = z.infer<typeof presentationComponentSchema>;
export type SemanticTransition = z.infer<typeof semanticTransitionSchema>;
export type PresentationPlan = z.infer<typeof presentationPlanSchema>;

function invalid(message: string): never {
  throw new z.ZodError([{ code: 'custom', path: [], message }]);
}

/** Bound untrusted objects before parsing, including cyclic/deep objects supplied outside JSON. */
function boundPayload(input: unknown, maxNodes = 20000, maxCharacters = 500000) {
  const stack = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let characters = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > maxNodes || depth > 8) invalid('Payload exceeds the supported size or depth.');
    if (typeof value === 'string') characters += value.length;
    else if (value && typeof value === 'object') {
      if (seen.has(value)) invalid('Payload must not contain cycles or shared object references.');
      seen.add(value);
      const entries = Object.entries(value);
      if (entries.length + nodes + stack.length > maxNodes) invalid('Payload exceeds the supported size.');
      for (const [key, child] of entries) {
        characters += key.length;
        stack.push({ value: child, depth: depth + 1 });
      }
    }
    if (characters > maxCharacters) invalid('Payload exceeds the supported text size.');
  }
}

function unique(values: string[], context: string) {
  if (new Set(values).size !== values.length) invalid(`Duplicate identifiers in ${context}.`);
}
function references(values: string[], allowed: Set<string>, context: string) {
  unique(values, context);
  if (values.some(value => !allowed.has(value))) invalid(`Unknown reference in ${context}.`);
}
export function isCatalogValue(value: CatalogValue, definition: AttributeDefinition): boolean {
  if (value === null) return true;
  if (definition.type === 'number' || definition.type === 'money') return typeof value === 'number' && Number.isFinite(value);
  if (definition.type === 'boolean') return typeof value === 'boolean';
  if (definition.type === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }
  return typeof value === 'string';
}

export function validateCatalogFilters(input: unknown, catalog: KnowledgeCatalog): CatalogFilter[] {
  const filters = catalogFilterSchema.array().max(24).parse(input);
  const definitions = new Map(catalog.attributes.map(attribute => [attribute.id, attribute]));
  for (const filter of filters) {
    const definition = definitions.get(filter.attributeId);
    if (!definition || !isCatalogValue(filter.value, definition)) invalid('Unsupported filter attribute or value.');
    if (filter.operator === 'contains' && definition.type !== 'text') invalid('Contains applies only to text.');
    if (['lt', 'lte', 'gt', 'gte'].includes(filter.operator) && !['number', 'money', 'date'].includes(definition.type)) invalid('Range filters require a numeric or date attribute.');
    if (filter.value === null && filter.operator !== 'eq') invalid('Unknown values support only equality filtering.');
  }
  return filters;
}

export function validateCatalog(input: unknown): KnowledgeCatalog {
  boundPayload(input);
  const catalog = knowledgeCatalogSchema.parse(input);
  for (const [name, items] of Object.entries({ attributes: catalog.attributes, entities: catalog.entities,
    collections: catalog.collections, relationships: catalog.relationships, jobs: catalog.jobs, capabilities: catalog.capabilities ?? [] })) {
    unique(items.map(item => item.id), name);
  }
  const attributes = new Map(catalog.attributes.map(attribute => [attribute.id, attribute]));
  const attributeIds = new Set(attributes.keys());
  const entityIds = new Set(catalog.entities.map(entity => entity.id));
  for (const definition of catalog.attributes) {
    if (definition.type === 'money' && !definition.currency) invalid('Money attributes require a currency.');
    if (definition.type !== 'money' && definition.currency) invalid('Currency belongs only to money attributes.');
    if (definition.unit && !['number', 'money'].includes(definition.type)) invalid('Units belong only to numeric attributes.');
  }
  for (const entity of catalog.entities) {
    references(Object.keys(entity.attributes), attributeIds, `attributes of ${entity.id}`);
    for (const [attributeId, value] of Object.entries(entity.attributes)) {
      if (!isCatalogValue(value, attributes.get(attributeId)!)) invalid(`Invalid typed value for ${attributeId} on ${entity.id}.`);
    }
  }
  for (const collection of catalog.collections) references(collection.entityIds, entityIds, `collection ${collection.id}`);
  for (const relationship of catalog.relationships) {
    if (!entityIds.has(relationship.fromEntityId) || !entityIds.has(relationship.toEntityId)) invalid('Unknown relationship entity.');
    if (relationship.fromEntityId === relationship.toEntityId) invalid('A relationship requires two distinct entities.');
  }
  for (const job of catalog.jobs) references(job.attributeIds, attributeIds, `job ${job.id}`);
  for (const capability of catalog.capabilities ?? []) references(capability.entityIds, entityIds, `capability ${capability.id}`);
  return catalog;
}

/** Empty collection entityIds means its named collection, or all catalog entities when unnamed.
 * Criteria and selection may have no IDs; selection always uses runtime-owned visitor state. */
export function validatePlan(input: unknown, catalog: KnowledgeCatalog, snapshotId: string, media?: MediaLibrary | null): PresentationPlan {
  boundPayload(input, 3000, 40000);
  const plan = presentationPlanSchema.parse(input);
  if (plan.stateUpdate) validateCatalogFilters(plan.stateUpdate.filters, catalog);
  if (plan.snapshotId !== snapshotId) invalid('The presentation belongs to a stale catalog snapshot.');
  const entityIds = new Set(catalog.entities.map(entity => entity.id));
  const attributeIds = new Set(catalog.attributes.map(attribute => attribute.id));
  const collections = new Map(catalog.collections.map(collection => [collection.id, collection]));
  const capabilities = new Map((catalog.capabilities ?? []).map(capability => [capability.id, capability]));
  const library = media ? validateMediaLibrary(media, { entityIds: [...entityIds] }) : null;
  unique(plan.components.map(component => component.id), 'presentation components');
  for (const component of plan.components) {
    if (component.id !== component.type) invalid('Component identity must equal its registered type.');
    if (!(componentVariants[component.type] as readonly string[]).includes(component.variant)) invalid('Unsupported component variant.');
    references(component.entityIds, entityIds, 'component entities');
    references(component.attributeIds, attributeIds, 'component attributes');
    references(component.capabilityIds ?? [], new Set(capabilities.keys()), 'component capabilities');
    if (component.type === 'gallery') {
      if (!library) invalid('A gallery requires published photos.');
      if (component.attributeIds.length) invalid('Gallery components do not take catalog attributes.');
      references(component.assetIds ?? [], new Set(library.assets.map(asset => asset.id)), 'gallery photos');
      if (component.albumId && !library.albums.some(album => album.id === component.albumId)) invalid('Unknown gallery album.');
      const resolved = galleryAssetIds(library, component);
      if (!resolved.length || component.assetIds?.some(assetId => !resolved.includes(assetId))) invalid('Gallery photos are outside the requested album or entity context.');
    } else if (component.assetIds?.length || component.albumId) invalid('Photo references belong to gallery components.');
    if (component.collectionId) {
      const collection = collections.get(component.collectionId);
      if (!collection || component.type !== 'collection') invalid('Collection references belong to collection components.');
      if (component.entityIds.some(entityId => !collection.entityIds.includes(entityId))) invalid('Entity is outside the referenced collection.');
    }
    if (component.type === 'detail' && component.entityIds.length !== 1) invalid('Details require exactly one entity.');
    if (component.type === 'comparison' && (component.entityIds.length < 2 || component.entityIds.length > 6 || !component.attributeIds.length)) invalid('Comparison requires two to six entities and at least one attribute.');
    if (component.type === 'criteria' && !component.attributeIds.length) invalid('Criteria require attributes.');
    if (component.type === 'relationships' && !component.entityIds.length) invalid('Relationships require an entity context.');
    if (component.type === 'actions') {
      if (!component.capabilityIds?.length) invalid('Actions require registered capabilities.');
      for (const capabilityId of component.capabilityIds) {
        const capability = capabilities.get(capabilityId)!;
        if (capability.entityIds.length && (!component.entityIds.length || component.entityIds.some(entityId => !capability.entityIds.includes(entityId)))) invalid('Capability is not registered for these entities.');
      }
    } else if (component.capabilityIds?.length) invalid('Capability references belong to actions components.');
  }
  if (plan.transition.targetComponentId && !plan.components.some(component => component.id === plan.transition.targetComponentId)) invalid('Transition target is absent from the plan.');
  // Older saved plans may contain the retired filter panel. Constraints remain in stateUpdate.
  return { ...plan, components: plan.components.filter(component => component.type !== 'criteria'),
    transition: plan.transition.targetComponentId === 'criteria' ? { type: 'none' as const } : plan.transition };
}
