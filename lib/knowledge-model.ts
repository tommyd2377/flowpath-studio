import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CatalogEntity, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { catalogEntitySchema, catalogCollectionSchema, catalogRelationshipSchema, capabilityDefinitionSchema, isCatalogValue, validateCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import { sourceAnchorSchema, validateSourceProvenance, type SourceAnchor, type SourceProvenance } from './source-provenance';

export type KnowledgeJob = {
  id: string; fileId?: string; operation?: 'source' | 'review'; sourceName: string; sourceHash: string; baseDraftHash: string; baseRevision: number;
  status: 'running' | 'needs_review' | 'applied' | 'discarded' | 'failed' | 'interrupted';
  stage: 'extracting' | 'interpreting' | 'review'; claim: string; startedAt: number; updatedAt: number;
  message: string; candidateRevisionId?: string; appliedRevisionId?: string; paidAttempt?: boolean;
};
export type KnowledgeLedger = { schemaVersion: 1; jobs: KnowledgeJob[] };
export type SourceOrigin = { key: string; fileId: string; name: string; hash: string; entityIds: string[]; baseline: KnowledgeCatalog; provenance?: SourceProvenance };
export type KnowledgeArtifact = { schemaVersion: 1; id: string; catalog: KnowledgeCatalog; origins: SourceOrigin[]; notes: string[]; updates?: SourceUpdate[];
  updateAnchors?: SourceAnchor[]; updateContext?: SourceUpdateContext };
export type KnowledgeCandidate = { id: string; catalog: KnowledgeCatalog; notes: string[]; sourceName: string; baseRevision: number;
  origins?: Pick<SourceOrigin, 'key' | 'name' | 'provenance'>[]; updates?: SourceUpdate[]; updateAnchors?: SourceAnchor[] };
export const hashValue = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const sourceKey = (name: string) => name.trim().toLowerCase();
export const entityKey = (source: string, id: string) => `item-${hashValue([source, id.trim().toLowerCase()]).slice(0, 24)}`;

type KnowledgeField = 'name' | 'kind' | 'summary' | `attributes.${string}`;
const updateId = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
const choiceSchema = z.enum(['keep', 'incoming']);
const sourceReferenceSchema = z.object({ sourceName: z.string().max(500), anchorId: updateId }).strict();
const updateValueSchema = z.union([z.string().max(1600), z.number().finite(), z.boolean(), z.null()]);
export const updateAnchorsSchema = z.array(sourceAnchorSchema).max(400);
export const updateContextSchema = z.object({ collections: z.array(catalogCollectionSchema).max(48), relationships: z.array(catalogRelationshipSchema).max(400), capabilities: z.array(capabilityDefinitionSchema).max(20) }).strict();
export type SourceUpdateContext = z.infer<typeof updateContextSchema>;
export function validateKnowledgeUpdateContext(input: unknown): SourceUpdateContext {
  const context = updateContextSchema.parse(input);
  for (const entries of Object.values(context)) if (new Set(entries.map(item => item.id)).size !== entries.length) throw new AppError('Source update references contain duplicate identifiers.');
  return context;
}
export const sourceUpdateSchema = z.object({
  id: updateId, kind: z.enum(['changed', 'conflict', 'missing', 'added', 'removed_by_publisher']),
  entityId: updateId, entityName: z.string().max(160),
  field: z.custom<KnowledgeField>(value => typeof value === 'string' && /^(?:name|kind|summary|attributes\.[A-Za-z0-9_-]+)$/.test(value)).optional(),
  previous: updateValueSchema, current: updateValueSchema, incoming: updateValueSchema,
  currentPresent: z.boolean().optional(), incomingPresent: z.boolean().optional(),
  defaultChoice: choiceSchema, choice: choiceSchema.optional(),
  previousSource: sourceReferenceSchema.optional(), incomingSource: sourceReferenceSchema.optional(),
  currentEntity: catalogEntitySchema.nullable().optional(), incomingEntity: catalogEntitySchema.nullable().optional(),
  restoration: z.object({ index: z.number().int().min(0).max(100),
    collectionIds: z.array(updateId).max(48), relationshipIds: z.array(updateId).max(400), capabilityIds: z.array(updateId).max(20),
  }).strict().optional(),
}).strict();
export type SourceUpdate = z.infer<typeof sourceUpdateSchema>;
export const sourceUpdateDecisionSchema = z.object({ id: updateId, choice: choiceSchema }).strict();
export type SourceUpdateDecision = z.infer<typeof sourceUpdateDecisionSchema>;

export function validateKnowledgeUpdates(input: unknown, catalog?: KnowledgeCatalog, context?: SourceUpdateContext, anchors?: SourceAnchor[]): SourceUpdate[] {
  const updates = sourceUpdateSchema.array().max(2700).parse(input);
  if (anchors && new Set(anchors.map(anchor => anchor.id)).size !== anchors.length) throw new AppError('Source update excerpts contain duplicate identifiers.');
  if (new Set(updates.map(update => update.id)).size !== updates.length
    || new Set(updates.map(update => `${update.entityId}:${update.field ?? '*'}`)).size !== updates.length) throw new AppError('Source updates contain duplicate decisions.');
  for (const update of updates) {
    for (const reference of [update.previousSource, update.incomingSource]) if (reference && anchors && !anchors.some(anchor => anchor.id === reference.anchorId)) throw new AppError('A source update references an unavailable excerpt.');
    const expectedDefault = update.kind === 'changed' || update.kind === 'added' ? 'incoming' : 'keep';
    if (update.defaultChoice !== expectedDefault) throw new AppError('A source update has an invalid default.');
    const fieldUpdate = update.kind === 'changed' || update.kind === 'conflict';
    if (fieldUpdate !== Boolean(update.field)) throw new AppError('A source update field is missing or unsupported.');
    if (fieldUpdate) {
      if (update.currentEntity !== undefined || update.incomingEntity !== undefined || update.restoration) throw new AppError('Field updates cannot replace whole items.');
      if (update.currentPresent === false && update.current !== null || update.incomingPresent === false && update.incoming !== null) throw new AppError('An absent source value must be null.');
      if (update.field!.startsWith('attributes.')) {
        const definition = catalog?.attributes.find(attribute => attribute.id === update.field!.slice(11));
        if (catalog && !definition) throw new AppError('A source update references an unknown attribute.');
        if (definition && [update.previous, update.current, update.incoming].some(value => !isCatalogValue(value, definition))) throw new AppError('A source update has an invalid attribute value.');
      } else if ([update.previous, update.current, update.incoming].some(value => typeof value !== 'string') || update.currentPresent === false || update.incomingPresent === false) throw new AppError('An item field requires text.');
    } else {
      if (update.currentEntity === undefined || update.incomingEntity === undefined || !update.restoration) throw new AppError('An item update is missing its saved values.');
      for (const [ids, known] of [[update.restoration.collectionIds, context?.collections], [update.restoration.relationshipIds, context?.relationships], [update.restoration.capabilityIds, context?.capabilities]] as const) {
        if (new Set(ids).size !== ids.length || known && ids.some(id => !known.some(item => item.id === id))) throw new AppError('An item update references unavailable saved relationships.');
      }
      if ((update.kind === 'missing') !== (update.incomingEntity === null) || (update.kind !== 'missing') !== (update.currentEntity === null)) throw new AppError('An item update has inconsistent saved values.');
      if (update.current !== (update.currentEntity?.name ?? null) || update.incoming !== (update.incomingEntity?.name ?? null)) throw new AppError('An item update label does not match its saved value.');
      for (const entity of [update.currentEntity, update.incomingEntity]) if (entity) {
        if (entity.id !== update.entityId) throw new AppError('A source update cannot change item identity.');
        if (catalog) validateCatalog({ ...catalog, entities: [entity], collections: [], relationships: [], capabilities: [] });
      }
    }
  }
  return updates;
}

function fieldValue(entity: CatalogEntity, field: KnowledgeField) { return field.startsWith('attributes.') ? entity.attributes[field.slice(11)] : entity[field as 'name' | 'kind' | 'summary']; }
function sameEntity(left: CatalogEntity | null | undefined, right: CatalogEntity | null | undefined): boolean {
  if (!left || !right) return !left && !right;
  return ['id', 'name', 'kind', 'summary'].every(field => left[field as keyof Omit<CatalogEntity, 'attributes'>] === right[field as keyof Omit<CatalogEntity, 'attributes'>])
    && Object.keys(left.attributes).length === Object.keys(right.attributes).length
    && Object.entries(left.attributes).every(([key, value]) => Object.hasOwn(right.attributes, key) && right.attributes[key] === value);
}
function sourceReference(origin: SourceOrigin | undefined, entityId: string, field: string | undefined, anchors: Map<string, SourceAnchor>): { sourceName: string; anchorId: string } | undefined {
  const reference = origin?.provenance?.fields.find(item => item.entityId === entityId && item.field === (field ?? 'name'));
  const anchor = origin?.provenance?.anchors.find(item => reference?.anchorIds.includes(item.id));
  if (!anchor) return undefined;
  const anchorId = `anchor-${hashValue([origin!.key, origin!.hash, anchor.id]).slice(0, 32)}`;
  anchors.set(anchorId, { ...structuredClone(anchor), id: anchorId });
  return { sourceName: origin!.name, anchorId };
}

export function claimKnowledgeJob(ledger: KnowledgeLedger, input: Omit<KnowledgeJob, 'status' | 'stage' | 'claim' | 'startedAt' | 'updatedAt' | 'message'>, now = Date.now()) {
  if (ledger.jobs.some(job => job.id === input.id)) throw new AppError('This import request was already received. Reload its saved status before starting another attempt.', 409);
  if (ledger.jobs.some(job => job.status === 'running' && (job.stage === 'review' || now - job.updatedAt < 120_000))) throw new AppError('An import or Apply is already running for this site. Reload to check its result.', 409);
  for (const job of ledger.jobs) if (job.status === 'running') {
    job.status = 'interrupted'; job.message = 'Processing was interrupted. A new explicit attempt is required; an earlier paid call will not be replayed.';
  }
  // Reservation records are never silently dropped: that would make old request IDs replayable.
  if (ledger.jobs.length >= 50) throw new AppError('This pilot supports 50 knowledge operations per site. Existing knowledge remains available.', 413);
  const job: KnowledgeJob = { ...input, status: 'running', stage: 'extracting', claim: randomUUID(), startedAt: now, updatedAt: now, message: 'Reading source structure.' };
  ledger.jobs.push(job);
  return { ...job };
}

export function changeKnowledgeJob(ledger: KnowledgeLedger, id: string, claim: string, patch: Partial<KnowledgeJob>) {
  const job = ledger.jobs.find(item => item.id === id);
  if (!job || job.claim !== claim || job.status !== 'running') throw new AppError('This import was superseded or cancelled. Its result was not applied.', 409);
  Object.assign(job, patch, { id: job.id, claim: job.claim, updatedAt: Date.now() });
  return { ...job };
}

/** Check deterministic source identity before extraction or a paid interpretation attempt. */
export function resolveSourceOrigin(current: KnowledgeArtifact | null, source: { name: string; replacesSourceKey?: string }): SourceOrigin | undefined {
  const requestedKey = source.replacesSourceKey ?? sourceKey(source.name);
  const matches = current?.origins.filter(origin => origin.key === requestedKey || source.replacesSourceKey === undefined && sourceKey(origin.name) === requestedKey) ?? [];
  if (matches.length > 1 || source.replacesSourceKey !== undefined && matches.length !== 1) throw new AppError('Choose an existing source to replace. This source reference is unavailable or ambiguous.');
  const previous = matches[0];
  const key = previous?.key ?? requestedKey;
  if (current?.origins.some(origin => origin.key !== key && (origin.key === sourceKey(source.name) || sourceKey(origin.name) === sourceKey(source.name)))) throw new AppError('Another source already uses this filename. Choose a different filename before replacing it.');
  return previous;
}

/** Three-way source merge: unchanged imported fields update; publisher overrides survive. */
export function mergeKnowledge(current: KnowledgeArtifact | null, incoming: KnowledgeCatalog, source: { fileId: string; name: string; hash: string; provenance?: SourceProvenance; replacesSourceKey?: string }): KnowledgeArtifact {
  const previous = resolveSourceOrigin(current, source);
  // Keep the original namespace when a publisher explicitly replaces a renamed file.
  const key = previous?.key ?? sourceKey(source.name);
  const notes: string[] = [];
  const updates: SourceUpdate[] = [];
  const anchors = new Map<string, SourceAnchor>();
  const imported = validateCatalog(incoming);
  const map = new Map(imported.entities.map(entity => [entity.id, entityKey(key, entity.id)]));
  const entities = imported.entities.map(entity => ({ ...entity, id: map.get(entity.id)! }));
  const sourceCatalog = validateCatalog({ ...imported, id: randomUUID(), entities,
    collections: imported.collections.map(collection => ({ ...collection, id: `group-${hashValue([key, collection.id]).slice(0, 24)}`, entityIds: collection.entityIds.map(id => map.get(id)!) })),
    relationships: imported.relationships.map(relation => ({ ...relation, id: `relation-${hashValue([key, relation.id]).slice(0, 24)}`, fromEntityId: map.get(relation.fromEntityId)!, toEntityId: map.get(relation.toEntityId)! })),
    jobs: imported.jobs.map(job => ({ ...job, id: `job-${hashValue([key, job.id]).slice(0, 24)}` })),
    capabilities: [],
  });
  const provenance = source.provenance ? validateSourceProvenance(source.provenance, imported) : undefined;
  const nextOrigin: SourceOrigin = { key, fileId: source.fileId, name: source.name, hash: source.hash,
    entityIds: sourceCatalog.entities.map(entity => entity.id), baseline: sourceCatalog,
    ...(provenance ? { provenance: { ...provenance, fields: provenance.fields.map(field => ({ ...field, entityId: map.get(field.entityId)! })) } } : {}),
  };
  const addUpdate = (kind: SourceUpdate['kind'], entity: CatalogEntity, baseline: CatalogEntity | undefined, existing: CatalogEntity | undefined, incomingEntity: CatalogEntity | undefined, field?: KnowledgeField) => {
    const before = field && baseline ? fieldValue(baseline, field) : baseline?.name;
    const currentValue = field && existing ? fieldValue(existing, field) : existing?.name;
    const incomingValue = field && incomingEntity ? fieldValue(incomingEntity, field) : incomingEntity?.name;
    const priorReference = sourceReference(previous, entity.id, field, anchors);
    const nextReference = sourceReference(nextOrigin, entity.id, field, anchors);
    updates.push({ id: `update-${hashValue([key, source.hash, entity.id, field ?? '*', kind]).slice(0, 32)}`, kind, entityId: entity.id, entityName: existing?.name ?? entity.name,
      ...(field ? { field, ...(currentValue === undefined ? { currentPresent: false } : {}), ...(incomingValue === undefined ? { incomingPresent: false } : {}) } : { currentEntity: existing ? structuredClone(existing) : null, incomingEntity: incomingEntity ? structuredClone(incomingEntity) : null }),
      previous: before ?? null, current: currentValue ?? null, incoming: incomingValue ?? null,
      defaultChoice: kind === 'changed' || kind === 'added' ? 'incoming' : 'keep',
      ...(priorReference ? { previousSource: priorReference } : {}), ...(nextReference ? { incomingSource: nextReference } : {}),
    });
  };
  const result = current ? structuredClone(current.catalog) : { ...sourceCatalog, entities: [], collections: [], relationships: [] };
  const definitions = new Map(result.attributes.map(attribute => [attribute.id, attribute]));
  for (const attribute of sourceCatalog.attributes) {
    const existing = definitions.get(attribute.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(attribute)) throw new AppError(`The attribute “${attribute.label}” has a different type or unit in another source. Rename that column or correct the source before combining it.`);
    definitions.set(attribute.id, attribute);
  }
  result.attributes = [...definitions.values()];
  for (const entity of sourceCatalog.entities) {
    const existing = result.entities.find(item => item.id === entity.id);
    const baseline = previous?.baseline.entities.find(item => item.id === entity.id);
    if (!existing) {
      if (baseline) {
        if (!sameEntity(baseline, entity)) {
          notes.push(`The updated source includes “${entity.name}” after your earlier removal. Review whether to restore it.`);
          addUpdate('removed_by_publisher', entity, baseline, undefined, entity);
        } else notes.push(`Kept your removal of “${entity.name}”.`);
      } else { if (current) addUpdate('added', entity, undefined, undefined, entity); result.entities.push(entity); }
      continue;
    }
    if (!baseline) { notes.push(`Review the matching item “${entity.name}”; the existing record was retained.`); continue; }
    for (const field of ['name', 'summary', 'kind'] as const) {
      if (entity[field] !== baseline[field] && entity[field] !== existing[field]) addUpdate(existing[field] === baseline[field] ? 'changed' : 'conflict', entity, baseline, existing, entity, field);
      if (existing[field] === baseline[field]) existing[field] = entity[field];
      else if (existing[field] !== entity[field]) notes.push(`An earlier publisher ${field} correction for “${existing.name}” differs from the incoming source.`);
    }
    for (const field of new Set([...Object.keys(baseline.attributes), ...Object.keys(entity.attributes)])) {
      if (entity.attributes[field] !== baseline.attributes[field] && entity.attributes[field] !== existing.attributes[field]) addUpdate(existing.attributes[field] === baseline.attributes[field] ? 'changed' : 'conflict', entity, baseline, existing, entity, `attributes.${field}`);
      if (existing.attributes[field] === baseline.attributes[field]) {
        if (field in entity.attributes) existing.attributes[field] = entity.attributes[field];
        else delete existing.attributes[field];
      } else if (existing.attributes[field] !== entity.attributes[field]) notes.push(`An earlier publisher ${field} correction for “${existing.name}” differs from the incoming source.`);
    }
  }
  for (const old of previous?.baseline.entities ?? []) if (!sourceCatalog.entities.some(entity => entity.id === old.id)) {
    const existing = result.entities.find(entity => entity.id === old.id);
    if (existing) { addUpdate('missing', old, old, existing, undefined); notes.push(`“${old.name}” is absent from the updated source. Review whether to keep or remove it.`); }
  }
  const entityIds = new Set(result.entities.map(entity => entity.id));
  result.collections = result.collections.filter(collection => {
    const baseline = previous?.baseline.collections.find(item => item.id === collection.id);
    if (!baseline || sourceCatalog.collections.some(item => item.id === collection.id)) return true;
    const keep = JSON.stringify(collection) !== JSON.stringify(baseline);
    notes.push(keep ? `Kept your edited collection “${collection.name}”, which is absent from the new source.` : `Removed the unchanged source collection “${collection.name}”, which is absent from the new source.`);
    return keep;
  });
  for (const incomingCollection of sourceCatalog.collections) {
    const collection = { ...incomingCollection, entityIds: incomingCollection.entityIds.filter(id => entityIds.has(id)) };
    const index = result.collections.findIndex(item => item.id === collection.id);
    const baseline = previous?.baseline.collections.find(item => item.id === collection.id);
    if (index < 0) { if (!baseline) result.collections.push(collection); }
    else if (!baseline || JSON.stringify(result.collections[index]) === JSON.stringify(baseline)) result.collections[index] = collection;
    else notes.push(`Kept your collection correction for “${result.collections[index].name}”.`);
  }
  result.relationships = result.relationships.filter(relation => {
    const baseline = previous?.baseline.relationships.find(item => item.id === relation.id);
    if (!baseline || sourceCatalog.relationships.some(item => item.id === relation.id)) return true;
    const keep = JSON.stringify(relation) !== JSON.stringify(baseline);
    notes.push(keep ? `Kept your edited relationship “${relation.label}”, which is absent from the new source.` : `Removed the unchanged source relationship “${relation.label}”, which is absent from the new source.`);
    return keep;
  });
  for (const relation of sourceCatalog.relationships) {
    if (!entityIds.has(relation.fromEntityId) || !entityIds.has(relation.toEntityId)) continue;
    const index = result.relationships.findIndex(item => item.id === relation.id);
    const baseline = previous?.baseline.relationships.find(item => item.id === relation.id);
    if (index < 0) { if (!baseline) result.relationships.push(relation); }
    else if (!baseline || JSON.stringify(result.relationships[index]) === JSON.stringify(baseline)) result.relationships[index] = relation;
    else notes.push(`Kept your relationship correction for “${result.relationships[index].label}”.`);
  }
  result.jobs = result.jobs.filter(job => {
    const baseline = previous?.baseline.jobs.find(item => item.id === job.id);
    return !baseline || sourceCatalog.jobs.some(item => item.id === job.id) || JSON.stringify(job) !== JSON.stringify(baseline);
  });
  for (const job of sourceCatalog.jobs) {
    const index = result.jobs.findIndex(item => item.id === job.id);
    const baseline = previous?.baseline.jobs.find(item => item.id === job.id);
    if (index < 0) { if (!baseline) result.jobs.push(job); }
    else if (!baseline || JSON.stringify(result.jobs[index]) === JSON.stringify(baseline)) result.jobs[index] = job;
  }
  result.id = randomUUID();
  const catalog = validateCatalog(result);
  const collections = new Map<string, SourceUpdateContext['collections'][number]>();
  const relationships = new Map<string, SourceUpdateContext['relationships'][number]>();
  const capabilities = new Map<string, SourceUpdateContext['capabilities'][number]>();
  for (const update of updates) if (!update.field) {
    const index = catalog.entities.findIndex(entity => entity.id === update.entityId);
    let savedCollections = catalog.collections.filter(collection => collection.entityIds.includes(update.entityId));
    let savedRelationships = catalog.relationships.filter(relation => relation.fromEntityId === update.entityId || relation.toEntityId === update.entityId);
    const savedCapabilities = (catalog.capabilities ?? []).filter(capability => capability.entityIds.includes(update.entityId));
    if (update.kind === 'removed_by_publisher') {
      savedCollections = sourceCatalog.collections.filter(collection => collection.entityIds.includes(update.entityId)).map(collection => {
        const retained = catalog.collections.find(item => item.id === collection.id);
        return retained ? { ...structuredClone(retained), entityIds: [...retained.entityIds, update.entityId] } : structuredClone(collection);
      });
      savedRelationships = sourceCatalog.relationships.filter(relation => relation.fromEntityId === update.entityId || relation.toEntityId === update.entityId);
    }
    for (const collection of savedCollections) {
      const previous = collections.get(collection.id);
      collections.set(collection.id, { ...structuredClone(collection), entityIds: [...new Set([...previous?.entityIds ?? [], ...collection.entityIds])] });
    }
    for (const relation of savedRelationships) relationships.set(relation.id, structuredClone(relation));
    for (const capability of savedCapabilities) capabilities.set(capability.id, structuredClone(capability));
    update.restoration = { index: index < 0 ? catalog.entities.length : index, collectionIds: savedCollections.map(item => item.id), relationshipIds: savedRelationships.map(item => item.id), capabilityIds: savedCapabilities.map(item => item.id) };
  }
  const updateContext = validateKnowledgeUpdateContext({ collections: [...collections.values()], relationships: [...relationships.values()], capabilities: [...capabilities.values()] });
  const updateAnchors = updateAnchorsSchema.parse([...anchors.values()]);
  return { schemaVersion: 1, id: catalog.id, catalog, notes, updates: validateKnowledgeUpdates(updates, catalog, updateContext, updateAnchors), updateContext, updateAnchors, origins: [
    ...(current?.origins.filter(origin => origin.key !== key) ?? []),
    nextOrigin,
  ] };
}

/** Resolve only recorded source alternatives; callers never submit replacement facts. */
export function resolveKnowledgeUpdates(artifact: KnowledgeArtifact, decisions: SourceUpdateDecision[]): KnowledgeArtifact {
  const parsed = sourceUpdateDecisionSchema.array().min(1).max(2700).parse(decisions);
  if (new Set(parsed.map(decision => decision.id)).size !== parsed.length) throw new AppError('Choose each source update only once.');
  const context = validateKnowledgeUpdateContext(artifact.updateContext ?? { collections: [], relationships: [], capabilities: [] });
  const anchors = updateAnchorsSchema.parse(artifact.updateAnchors ?? []);
  const updates = validateKnowledgeUpdates(artifact.updates ?? [], artifact.catalog, context, anchors);
  if (parsed.some(decision => !updates.some(update => update.id === decision.id))) throw new AppError('This source update is no longer available. Reload the proposal.', 409);
  const catalog = structuredClone(artifact.catalog);
  for (const update of updates) {
    const actual = catalog.entities.find(entity => entity.id === update.entityId);
    const priorChoice = update.choice ?? update.defaultChoice;
    if (update.field) {
      const value = priorChoice === 'keep' ? update.current : update.incoming;
      const present = priorChoice === 'keep' ? update.currentPresent : update.incomingPresent;
      if (!actual || fieldValue(actual, update.field) !== (present === false ? undefined : value)) throw new AppError('This field was edited after its source update. Review the current proposal before resolving it.', 409);
    } else {
      const expected = priorChoice === 'keep' ? update.currentEntity : update.incomingEntity;
      if (!sameEntity(actual, expected)) throw new AppError('This item was edited after its source update. Review the current proposal before resolving it.', 409);
    }
  }
  for (const decision of parsed) updates.find(update => update.id === decision.id)!.choice = decision.choice;
  for (const update of updates) {
    const choice = update.choice ?? update.defaultChoice;
    if (update.field) {
      const entity = catalog.entities.find(entity => entity.id === update.entityId)!;
      const value = choice === 'keep' ? update.current : update.incoming;
      const present = choice === 'keep' ? update.currentPresent : update.incomingPresent;
      if (update.field.startsWith('attributes.')) {
        if (present === false) delete entity.attributes[update.field.slice(11)];
        else entity.attributes[update.field.slice(11)] = value;
      } else entity[update.field as 'name' | 'kind' | 'summary'] = value as string;
    } else {
      const entity = choice === 'keep' ? update.currentEntity : update.incomingEntity;
      const index = catalog.entities.findIndex(item => item.id === update.entityId);
      if (!entity) { if (index >= 0) catalog.entities.splice(index, 1); }
      else if (index >= 0) catalog.entities[index] = structuredClone(entity);
      else catalog.entities.splice(Math.min(update.restoration!.index, catalog.entities.length), 0, structuredClone(entity));
    }
  }
  if (!catalog.entities.length) throw new AppError('Keep at least one item in this proposal. To remove all knowledge, use Remove knowledge from draft.');
  const entityIds = new Set(catalog.entities.map(entity => entity.id));
  for (const update of updates) if (!update.field && entityIds.has(update.entityId)) {
    for (const collection of context.collections.filter(item => update.restoration!.collectionIds.includes(item.id))) {
      const index = catalog.collections.findIndex(item => item.id === collection.id);
      if (index >= 0) catalog.collections[index].entityIds = [...new Set([...collection.entityIds, ...catalog.collections[index].entityIds])]; else catalog.collections.push(structuredClone(collection));
    }
    for (const relation of context.relationships.filter(item => update.restoration!.relationshipIds.includes(item.id))) if (!catalog.relationships.some(item => item.id === relation.id)) catalog.relationships.push(structuredClone(relation));
    for (const capability of context.capabilities.filter(item => update.restoration!.capabilityIds.includes(item.id))) {
      const index = catalog.capabilities?.findIndex(item => item.id === capability.id) ?? -1;
      if (index >= 0) catalog.capabilities![index].entityIds = [...new Set([...capability.entityIds, ...catalog.capabilities![index].entityIds])]; else (catalog.capabilities ??= []).push(structuredClone(capability));
    }
  }
  catalog.collections = catalog.collections.map(collection => ({ ...collection, entityIds: collection.entityIds.filter(id => entityIds.has(id)) })).filter(collection => collection.entityIds.length);
  catalog.relationships = catalog.relationships.filter(relation => entityIds.has(relation.fromEntityId) && entityIds.has(relation.toEntityId));
  catalog.capabilities = catalog.capabilities?.filter(capability => !capability.entityIds.length || capability.entityIds.some(id => entityIds.has(id))).map(capability => ({ ...capability, entityIds: capability.entityIds.filter(id => entityIds.has(id)) }));
  catalog.id = randomUUID();
  return { ...structuredClone(artifact), id: catalog.id, catalog: validateCatalog(catalog), updates };
}
