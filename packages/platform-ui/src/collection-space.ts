import { z } from 'zod';
import { capabilityDefinitionSchema, validateCatalog, type KnowledgeCatalog } from './contracts.js';
import { validateMediaLibrary, type MediaLibrary } from './media.js';
import { knowledgeFacts } from './knowledge.js';
import { expressionSchema, queryTimeSchema, fieldDescriptorSchema, publicationRefSchema, queryScopeSchema, relationshipDescriptorSchema, taskIdSchema, typedValueSchema, type FieldDescriptor, type PublicationRef } from './query.js';

const id = taskIdSchema;
export const recordAssertionSchema = z.object({ id, fieldId: id, value: typedValueSchema.nullable(),
  polarity: z.enum(['affirmed', 'denied']), conditions: z.array(z.string().min(1).max(300)).max(8),
  validFrom: queryTimeSchema.optional(), validTo: queryTimeSchema.optional(), observedAt: queryTimeSchema.optional(),
  authority: z.enum(['publisher', 'calculated', 'external', 'provider']),
}).strict().superRefine((fact, ctx) => {
  if (fact.validFrom && fact.validTo && Date.parse(fact.validFrom) > Date.parse(fact.validTo)) ctx.addIssue({ code: 'custom', message: 'Unordered validity range.' });
});
export type RecordAssertion = z.infer<typeof recordAssertionSchema>;
export const contentBlockSchema = z.object({ id, kind: z.enum(['paragraph', 'heading', 'link', 'image']), text: z.string().max(8000), referenceId: id.optional() }).strict();
export const canonicalRecordSchema = z.object({ id, type: id, media: z.object({ assetId: id, role: z.enum(['depicts', 'example']) }).strict().optional(), name: z.string().min(1).max(180), summary: z.string().max(1600), aliases: z.array(z.string().min(1).max(160)).max(16),
  assertions: z.array(recordAssertionSchema).max(256), blocks: z.array(contentBlockSchema).max(32),
}).strict();
export type CanonicalRecord = z.infer<typeof canonicalRecordSchema>;
export const spaceCollectionSchema = z.object({ id, name: z.string().min(1).max(160), introduction: z.string().max(1600), kind: z.enum(['explicit', 'derived', 'group']),
  view: z.enum(['grid', 'list', 'gallery']),
  derived: z.object({ scope: queryScopeSchema, where: expressionSchema, asOf: queryTimeSchema }).strict().optional(),
}).strict().superRefine((collection, ctx) => { if ((collection.kind === 'derived') !== Boolean(collection.derived)) ctx.addIssue({ code: 'custom', message: 'Derived collections require a query.' }); });
export type SpaceCollection = z.infer<typeof spaceCollectionSchema>;
export const membershipSchema = z.object({ collectionId: id, recordId: id }).strict();
export const collectionEdgeSchema = z.object({ parentId: id, childId: id }).strict();
export const recordRelationshipSchema = z.object({ id, predicateId: id, fromId: id, toId: id, polarity: z.enum(['affirmed', 'denied']), conditions: z.array(z.string().max(300)).max(8),
  validFrom: queryTimeSchema.optional(), validTo: queryTimeSchema.optional(),
}).strict();
export const publicationSpaceSchema = z.object({ version: z.literal(2), publication: publicationRefSchema, name: z.string().min(1).max(160), rootId: id,
  links: z.array(capabilityDefinitionSchema).max(20).default([]),
  fields: z.array(fieldDescriptorSchema).max(64), relationshipTypes: z.array(relationshipDescriptorSchema).max(64),
  collections: z.array(spaceCollectionSchema).min(1).max(1000), edges: z.array(collectionEdgeSchema).max(4000),
  records: z.array(canonicalRecordSchema).max(10_160), memberships: z.array(membershipSchema).max(40_000), relationships: z.array(recordRelationshipSchema).max(40_000),
}).strict();
export type PublicationSpace = z.infer<typeof publicationSpaceSchema>;
function unique(values: string[]) { if (new Set(values).size !== values.length) throw new Error('Duplicate publication identity.'); }
export function validatePublicationSpace(input: unknown): PublicationSpace {
  const space = publicationSpaceSchema.parse(input);
  for (const list of [space.records, space.fields, space.collections, space.relationshipTypes, space.relationships]) unique(list.map(value => value.id));
  unique(space.links.map(link => link.id));
  for (const link of space.links) if (link.entityIds.some(id => !space.records.some(record => record.id === id))) throw new Error('Unknown publisher link record.');
  unique(space.edges.map(edge => `${edge.parentId}/${edge.childId}`)); unique(space.memberships.map(member => `${member.collectionId}/${member.recordId}`));
  const collections = new Map(space.collections.map(collection => [collection.id, collection])), records = new Map(space.records.map(record => [record.id, record]));
  const fields = new Map(space.fields.map(field => [field.id, field])), predicates = new Map(space.relationshipTypes.map(relation => [relation.id, relation]));
  const children = new Map<string, string[]>(), dependencies = new Map<string, string[]>();
  if (!collections.has(space.rootId)) throw new Error('Missing publication root.');
  for (const edge of space.edges) {
    if (!collections.has(edge.parentId) || !collections.has(edge.childId) || edge.childId === space.rootId) throw new Error('Invalid collection reference.');
    children.set(edge.parentId, [...children.get(edge.parentId) ?? [], edge.childId]);
  }
  const reached = new Set<string>(), visited = new WeakMap<Map<string, string[]>, Set<string>>();
  function visit(node: string, path: Set<string>, graph: Map<string, string[]>, depth = 0) {
    if (path.has(node) || depth > 8) throw new Error('Collection containment/dependency cycle or depth exceeds eight.');
    reached.add(node); const done = visited.get(graph) ?? new Set<string>(); visited.set(graph, done);
    const key = `${node}:${depth}`; if (done.has(key)) return;
    const next = new Set([...path, node]);
    for (const child of graph.get(node) ?? []) visit(child, next, graph, depth + 1);
    done.add(key);
  }
  visit(space.rootId, new Set(), children);
  if (reached.size !== collections.size) throw new Error('Every collection must be reachable from the root.');
  for (const collection of space.collections) if (collection.derived) {
    const scope = collection.derived.scope;
    const upstream = [scope.collectionId, ...scope.include ?? []];
    if (upstream.some(id => !collections.has(id))) throw new Error('Unknown derived scope.');
    // An ancestor descendant-query includes this collection and is self-dependent.
    if (scope.traversal !== 'direct') for (const id of [...upstream]) {
      const pending = [...children.get(id) ?? []], seen = new Set<string>();
      while (pending.length) { const child = pending.pop()!; if (seen.has(child)) continue; seen.add(child); upstream.push(child); pending.push(...children.get(child) ?? []); }
    }
    dependencies.set(collection.id, [...new Set(upstream)]);
  }
  for (const collection of space.collections) visit(collection.id, new Set(), dependencies);
  for (const membership of space.memberships) if (!collections.has(membership.collectionId) || !records.has(membership.recordId) || collections.get(membership.collectionId)?.kind !== 'explicit') throw new Error('Unknown membership or navigation-only collection.');
  for (const record of space.records) {
    unique(record.assertions.map(fact => fact.id)); unique(record.blocks.map(block => block.id));
    for (const assertion of record.assertions) {
      const field = fields.get(assertion.fieldId), value = assertion.value;
      if (!field || field.recordTypes.length && !field.recordTypes.includes(record.type)) throw new Error('Unsupported record field.');
      if (value && (field.type !== value.type || field.unit !== value.unit || field.currency !== value.currency || field.basis !== value.basis
        || (field.cardinality === 'many') !== Array.isArray(value.value))) throw new Error('Invalid assertion measurement/type.');
      if (value?.type === 'reference' && (Array.isArray(value.value) ? value.value : [value.value]).some(ref => !records.has(String(ref)))) throw new Error('Unknown record reference.');
    }
    for (const block of record.blocks) if (block.referenceId && !records.has(block.referenceId)) throw new Error('Unknown content block reference.');
  }
  for (const relation of space.relationships) {
    const predicate = predicates.get(relation.predicateId), from = records.get(relation.fromId), to = records.get(relation.toId);
    if (!predicate || !from || !to || predicate.fromTypes.length && !predicate.fromTypes.includes(from.type) || predicate.toTypes.length && !predicate.toTypes.includes(to.type)) throw new Error('Unknown relationship endpoint or type.');
  }
  return space;
}
/** Legacy kinds and units are labels, not task identifiers. Keep compatible IDs
 * and allocate collision-free IDs for the rest within this immutable snapshot. */
function legacyLabelIds(values: string[], prefix: string, preferred = (value: string) => value) {
  const labels = [...new Set(values)].sort(), candidates = labels.map(preferred);
  const compatible = (candidate: string) => taskIdSchema.safeParse(candidate).success && candidates.filter(value => value === candidate).length === 1;
  const used = new Set(candidates.filter(compatible));
  let sequence = 0;
  return new Map(labels.map((label, index) => {
    let candidate = candidates[index];
    if (!compatible(candidate)) { do { candidate = `${prefix}-${++sequence}`; } while (used.has(candidate)); used.add(candidate); }
    return [label, candidate];
  }));
}

/** Lossless compatibility bundle: v1 is kept only on the adapter, never inside a v2 publication. */
export function adaptV1Catalog(input: KnowledgeCatalog, publication: PublicationRef, media?: MediaLibrary | null): { space: PublicationSpace; legacy: KnowledgeCatalog } {
  const catalog = validateCatalog(input), facts = knowledgeFacts(catalog);
  const definitions = [...catalog.attributes.map(field => ({ ...field, id: `attributes.${field.id}` })),
    ...facts.filter(fact => fact.definition).map(fact => ({ ...fact.definition!, id: fact.field }))];
  const basisIds = legacyLabelIds(definitions.flatMap(field => field.type === 'money' && field.unit ? [field.unit] : []), 'legacy-basis', unit => unit.replace(/[^A-Za-z0-9_.:-]/g, '-'));
  const typeIds = legacyLabelIds(catalog.entities.map(entity => entity.kind), 'legacy-type', kind => `type-${encodeURIComponent(kind).replace(/%/g, '').slice(0, 80)}`);
  const predicateIds = legacyLabelIds(catalog.relationships.map(relation => relation.kind ?? relation.id), 'legacy-predicate');
  const fields: FieldDescriptor[] = [...new Map(definitions.map(field => [field.id, field])).values()].map(field => ({ id: field.id, label: field.label, type: field.type,
    aliases: field.aliases ?? [], recordTypes: [], cardinality: 'one', ...(field.type === 'number' && field.unit ? { unit: field.unit } : {}), ...(field.currency ? { currency: field.currency } : {}),
    ...(field.type === 'money' && field.unit ? { basis: basisIds.get(field.unit)! } : {}),
    operations: field.type === 'text' ? ['eq', 'contains'] : ['number', 'money', 'date'].includes(field.type) ? ['eq', 'lt', 'lte', 'gt', 'gte'] : ['eq'],
    filter: true, sort: true, facet: true, coverage: { known: new Set(facts.filter(fact => fact.field === field.id && fact.value !== null).map(fact => fact.entityId)).size, total: catalog.entities.length },
  }));
  const fieldMap = new Map(fields.map(field => [field.id, field]));
  const used = new Set(catalog.collections.map(collection => collection.id));
  const fresh = (base: string) => { let id = base; while (used.has(id)) id += '-root'; used.add(id); return id; };
  const rootId = fresh('publication-root'), otherId = fresh('other-published-items');
  const assigned = new Set(catalog.collections.flatMap(collection => collection.entityIds)), other = catalog.entities.filter(entity => !assigned.has(entity.id));
  const collections: SpaceCollection[] = [{ id: rootId, name: catalog.name, introduction: catalog.description.slice(0, 1600), kind: 'explicit', view: 'grid' },
    ...catalog.collections.map(collection => ({ id: collection.id, name: collection.name, introduction: '', kind: 'explicit' as const, view: 'grid' as const })),
    ...(other.length ? [{ id: otherId, name: 'Other published items', introduction: '', kind: 'explicit' as const, view: 'grid' as const }] : [])];
  const relationTypes = [...new Map(catalog.relationships.map(relation => [relation.kind ?? relation.id, { id: predicateIds.get(relation.kind ?? relation.id)!, label: relation.label, inverseLabel: relation.inverseLabel ?? relation.label, fromTypes: [], toTypes: [] }])).values()];
  let space = validatePublicationSpace({ version: 2, publication, links: catalog.capabilities ?? [], name: catalog.name, rootId, fields, relationshipTypes: relationTypes, collections,
    edges: collections.filter(collection => collection.id !== rootId).flatMap(collection => (catalog.collections.find(item => item.id === collection.id)?.parentIds?.length ? catalog.collections.find(item => item.id === collection.id)!.parentIds! : [rootId]).map(parentId => ({ parentId, childId: collection.id }))),
    records: catalog.entities.map(entity => ({ id: entity.id, name: entity.name, type: typeIds.get(entity.kind)!, summary: entity.summary, aliases: entity.aliases ?? [], blocks: entity.blocks ?? [],
      assertions: facts.filter(fact => fact.entityId === entity.id && fieldMap.has(fact.field)).map(fact => {
        const field = fieldMap.get(fact.field)!;
        return { id: fact.id, fieldId: fact.field, value: fact.value === null || fact.expression ? null : { type: field.type, value: fact.value, ...(field.unit ? { unit: field.unit } : {}), ...(field.currency ? { currency: field.currency } : {}), ...(field.basis ? { basis: field.basis } : {}) },
          polarity: fact.polarity ?? 'affirmed', conditions: fact.qualifiers?.map(value => `${value.predicate}: ${value.value}`) ?? [], authority: 'publisher',
          ...(fact.validFrom ? { validFrom: fact.validFrom } : {}), ...(fact.validTo ? { validTo: fact.validTo } : {}), ...(fact.observedAt ? { observedAt: fact.observedAt } : {}) };
      }) })),
    memberships: [...catalog.collections.flatMap(collection => collection.entityIds.map(recordId => ({ collectionId: collection.id, recordId }))), ...other.map(entity => ({ collectionId: otherId, recordId: entity.id }))],
    relationships: catalog.relationships.map(relation => ({ id: relation.id, predicateId: predicateIds.get(relation.kind ?? relation.id)!, fromId: relation.fromEntityId, toId: relation.toEntityId,
      polarity: relation.polarity ?? 'affirmed', conditions: relation.qualifiers?.map(value => `${value.predicate}: ${value.value}`) ?? [], ...(relation.validFrom ? { validFrom: relation.validFrom } : {}), ...(relation.validTo ? { validTo: relation.validTo } : {}) })),
  });
  if (media) space = addPublishedMedia(space, media);
  return { space, legacy: catalog };
}

/** Adds already-published/reviewed media metadata; asset serving still authorizes the current library. */
export function addPublishedMedia(input: PublicationSpace, media: MediaLibrary): PublicationSpace {
  const space = structuredClone(input), library = validateMediaLibrary(media), records = new Set(space.records.map(record => record.id)), collections = new Set(space.collections.map(collection => collection.id));
  const fresh = (used: Set<string>, original: string, prefix: string) => { let id = original, n = 0; while (used.has(id)) id = `${prefix}-${original}-${++n}`; used.add(id); return id; };
  for (const record of space.records) {
    const association = library.associations.filter(link => link.targetType === 'entity' && link.targetId === record.id).sort((a, b) => Number(b.primary) - Number(a.primary))[0];
    if (association) record.media = { assetId: association.assetId, role: association.role === 'example' ? 'example' : 'depicts' };
  }
  const photos = new Map<string, string>(), parentId = fresh(collections, 'published-photos', 'media');
  space.collections.push({ id: parentId, name: 'Published photos', introduction: 'Reviewed photos and albums. Illustrative examples retain their labels.', kind: 'explicit', view: 'gallery' }); space.edges.push({ parentId: space.rootId, childId: parentId });
  for (const asset of library.assets) {
    const existing = space.records.find(record => record.type === 'published-photo' && record.media?.assetId === asset.id);
    const id = existing?.id ?? fresh(records, asset.id, 'media'), role = library.associations.some(link => link.assetId === asset.id && link.role === 'example') ? 'example' as const : 'depicts' as const; photos.set(asset.id, id);
    if (!existing) space.records.push({ id, type: 'published-photo', name: (asset.alt || asset.caption || 'Published photo').slice(0, 180), summary: asset.caption.slice(0, 1600), aliases: [], assertions: [], blocks: [], media: { assetId: asset.id, role } });
    space.memberships.push({ collectionId: parentId, recordId: id });
  }
  for (const album of library.albums) {
    const id = fresh(collections, album.id, 'album'); space.collections.push({ id, name: album.title, introduction: album.description.slice(0, 1600), kind: 'explicit', view: 'gallery' }); space.edges.push({ parentId, childId: id });
    space.memberships.push(...album.assetIds.map(assetId => ({ collectionId: id, recordId: photos.get(assetId)! })));
  }
  if (library.videos?.length) {
    const videoCollection = fresh(collections, 'published-videos', 'media');
    space.collections.push({ id: videoCollection, name: 'Videos', introduction: 'Published videos and reviewed descriptions.', kind: 'explicit', view: 'gallery' });
    space.edges.push({ parentId: space.rootId, childId: videoCollection });
    for (const video of library.videos) {
      const existing = space.records.find(record => record.type === 'published-video' && record.media?.assetId === video.id);
      const id = existing?.id ?? fresh(records, video.id, 'video');
      if (!existing) space.records.push({ id, type: 'published-video', name: video.title, summary: video.description.slice(0, 1600), aliases: ['video', 'film'], assertions: [], blocks: Array.from({ length: Math.ceil((video.transcript?.length ?? 0) / 4) }, (_, index) => ({ id: `cue-${index * 4}`, kind: 'paragraph' as const, text: video.transcript!.slice(index * 4, index * 4 + 4).map(cue => cue.text).join('\n') })), media: { assetId: video.id, role: 'depicts' } });
      space.memberships.push({ collectionId: videoCollection, recordId: id });
    }
  }
  return validatePublicationSpace(space);
}
