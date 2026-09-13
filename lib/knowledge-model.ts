import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CatalogEntity, CatalogFact, CatalogRelationship, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { catalogEntitySchema, catalogCollectionSchema, catalogFactSchema, catalogRelationshipSchema, capabilityDefinitionSchema, isCatalogValue, validateCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import { sourceAnchorSchema, validateSourceProvenance, type SourceAnchor, type SourceGraphReference, type SourceProvenance } from './source-provenance';
import { refreshAssertionReviews, remapAssertionReviews, type AssertionReview } from './knowledge-assertions';
import type { WebsiteProposal } from './website-import-model';

export type KnowledgeJob = {
  id: string; fileId?: string; sourceUrl?: string; operation?: 'source' | 'review' | 'website'; sourceName: string; sourceHash: string; baseDraftHash: string; baseRevision: number;
  status: 'running' | 'needs_review' | 'applied' | 'discarded' | 'failed' | 'interrupted';
  stage: 'extracting' | 'interpreting' | 'review'; claim: string; startedAt: number; updatedAt: number;
  message: string; candidateRevisionId?: string; appliedRevisionId?: string; paidAttempt?: boolean;
};
export type KnowledgeLedger = { schemaVersion: 1; jobs: KnowledgeJob[] };
export type SourceOrigin = { key: string; fileId: string; name: string; hash: string; entityIds: string[]; entityMap?: Record<string, string>; baseline: KnowledgeCatalog; provenance?: SourceProvenance };
export type SourceIdentityMatch = { id: string; sourceKey: string; incomingId: string; canonicalEntityId: string; incomingName: string; canonicalName: string;
  confidence: number; method: 'identifier-corroborated' | 'exact-name-kind' | 'alias' | 'token-similarity'; status: 'auto' | 'review'; decision?: 'pending' | 'approved' | 'rejected'; reason: string };
export type GraphValue = CatalogFact | CatalogRelationship;
export type GraphUpdate = { id: string; targetType: 'fact' | 'relationship'; kind: `${'fact' | 'relationship'}_${'changed' | 'conflict' | 'missing' | 'added'}`;
  targetId: string; entityName: string; previous: GraphValue | null; current: GraphValue | null; incoming: GraphValue | null; defaultChoice: 'keep' | 'incoming'; choice?: 'keep' | 'incoming';
  previousSource?: { sourceName: string; anchorId: string }; incomingSource?: { sourceName: string; anchorId: string } };
export type GraphCorrection = { id: string; targetType: 'fact' | 'relationship'; targetId: string; sourceKey: string; action: 'source-added' | 'source-updated' | 'source-removed' | 'publisher-kept' | 'source-accepted' | 'publisher-corrected';
  before: GraphValue | null; after: GraphValue | null; sourceName?: string; anchorIds?: string[]; recordedAt: number };
export type KnowledgeArtifact = { schemaVersion: 1; id: string; catalog: KnowledgeCatalog; origins: SourceOrigin[]; notes: string[]; updates?: SourceUpdate[]; website?: WebsiteProposal;
  updateAnchors?: SourceAnchor[]; updateContext?: SourceUpdateContext; identityMatches?: SourceIdentityMatch[]; graphUpdates?: GraphUpdate[]; correctionHistory?: GraphCorrection[]; identityRemaps?: Record<string, string>; assertionReviews?: AssertionReview[] };
export type KnowledgeCandidate = { id: string; catalog: KnowledgeCatalog; notes: string[]; sourceName: string; baseRevision: number; website?: WebsiteProposal;
  origins?: Pick<SourceOrigin, 'key' | 'name' | 'provenance'>[]; updates?: SourceUpdate[]; updateAnchors?: SourceAnchor[]; identityMatches?: SourceIdentityMatch[]; graphUpdates?: GraphUpdate[]; correctionHistory?: GraphCorrection[]; assertionReviews?: AssertionReview[] };
export const hashValue = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const sourceKey = (name: string) => name.trim().toLowerCase();
export const entityKey = (source: string, id: string) => `item-${hashValue([source, id.trim().toLowerCase()]).slice(0, 24)}`;

const identityToken = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const tokenSet = (value: string) => new Set(identityToken(value).split(/\s+/).filter(Boolean));
function tokenSimilarity(left: string, right: string) {
  const a = tokenSet(left); const b = tokenSet(right); if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(token => b.has(token)).length; return overlap / new Set([...a, ...b]).size;
}
function identityCandidate(incoming: CatalogEntity, existing: CatalogEntity[], allowAutomatic: boolean): { entity: CatalogEntity; confidence: number; method: SourceIdentityMatch['method']; status: SourceIdentityMatch['status']; reason: string } | undefined {
  const name = identityToken(incoming.name); const kind = identityToken(incoming.kind);
  if (!name || !kind) return undefined;
  const identified = existing.filter(entity => identityToken(entity.kind) === kind && identityToken(entity.name) === name
    && incoming.identifiers?.some(identifier => ['registration', 'isbn', 'gtin', 'publisher-id'].includes(identifier.scheme)
      && entity.identifiers?.some(other => identifier.scheme === other.scheme && identifier.value === other.value))
    && Object.entries(incoming.attributes).some(([field, value]) => value !== null && value !== '' && entity.attributes[field] === value)
    && !Object.entries(incoming.attributes).some(([field, value]) => value !== null && entity.attributes[field] != null && entity.attributes[field] !== value));
  if (allowAutomatic && identified.length === 1) return { entity: identified[0], confidence: 1, method: 'identifier-corroborated', status: 'auto', reason: 'A scoped identifier, name, type and supplied attribute agree, with no contradictory shared attributes. This is a deterministic match score, not calibrated certainty.' };
  const exact = existing.filter(entity => identityToken(entity.name) === name && identityToken(entity.kind) === kind);
  if (exact.length) return { entity: exact[0], confidence: 1, method: 'exact-name-kind', status: 'review', reason: `Name and type match${exact.length > 1 ? ' multiple records' : ''}, but do not establish identity. Review identifiers and source details before merging.` };
  const alias = existing.filter(entity => (entity.aliases ?? []).some(value => identityToken(value) === name) && identityToken(entity.kind) === kind);
  if (alias.length) return { entity: alias[0], confidence: 1, method: 'alias', status: 'review', reason: 'An alternate label and type match. An alias alone does not establish this source record’s identity.' };
  const fuzzy = existing.map(entity => ({ entity, confidence: tokenSimilarity(incoming.name, entity.name) })).filter(item => item.confidence >= 0.86).sort((a, b) => b.confidence - a.confidence);
  if (fuzzy.length && (fuzzy.length === 1 || fuzzy[0].confidence > fuzzy[1].confidence + 0.08)) return { entity: fuzzy[0].entity, confidence: fuzzy[0].confidence, method: 'token-similarity', status: 'review', reason: 'A high token similarity was found; publisher review is required before consolidation.' };
  return undefined;
}

type KnowledgeField = 'name' | 'kind' | 'summary' | `attributes.${string}`;
const updateId = z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/);
export const sourceIdentityMatchSchema = z.object({ id: updateId, sourceKey: z.string().min(1).max(255), incomingId: updateId, canonicalEntityId: updateId,
  incomingName: z.string().max(160), canonicalName: z.string().max(160), confidence: z.number().finite().min(0).max(1),
  method: z.enum(['identifier-corroborated', 'exact-name-kind', 'alias', 'token-similarity']), status: z.enum(['auto', 'review']), decision: z.enum(['pending', 'approved', 'rejected']).optional(), reason: z.string().max(500) }).strict();
export const identityMatchDecisionSchema = z.object({ id: updateId, action: z.enum(['approve', 'reject', 'alias']), alias: z.string().trim().min(1).max(160).optional() }).strict().superRefine((decision, context) => {
  if (decision.action === 'alias' && !decision.alias) context.addIssue({ code: 'custom', message: 'An alias is required.' });
  if (decision.action !== 'alias' && decision.alias) context.addIssue({ code: 'custom', message: 'Aliases are only accepted with an alias action.' });
});
export type IdentityMatchDecision = z.infer<typeof identityMatchDecisionSchema>;
const choiceSchema = z.enum(['keep', 'incoming']);
const sourceReferenceSchema = z.object({ sourceName: z.string().max(500), anchorId: updateId }).strict();
const updateValueSchema = z.union([z.string().max(1600), z.number().finite(), z.boolean(), z.null()]);
export const updateAnchorsSchema = z.array(sourceAnchorSchema).max(400);
export const updateContextSchema = z.object({ collections: z.array(catalogCollectionSchema).max(48), relationships: z.array(catalogRelationshipSchema).max(400), facts: z.array(catalogFactSchema).max(2000).optional(), capabilities: z.array(capabilityDefinitionSchema).max(20) }).strict();
export type SourceUpdateContext = z.infer<typeof updateContextSchema>;
export function validateKnowledgeUpdateContext(input: unknown): SourceUpdateContext {
  const context = updateContextSchema.parse(input);
  for (const entries of Object.values(context)) if (entries && new Set(entries.map(item => item.id)).size !== entries.length) throw new AppError('Source update references contain duplicate identifiers.');
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

const graphValueSchema = z.union([catalogFactSchema, catalogRelationshipSchema, z.null()]);
export const graphUpdateSchema = z.object({
  id: updateId, targetType: z.enum(['fact', 'relationship']), kind: z.enum(['fact_changed', 'fact_conflict', 'fact_missing', 'fact_added', 'relationship_changed', 'relationship_conflict', 'relationship_missing', 'relationship_added']),
  targetId: updateId, entityName: z.string().max(160), previous: graphValueSchema, current: graphValueSchema, incoming: graphValueSchema,
  defaultChoice: choiceSchema, choice: choiceSchema.optional(), previousSource: sourceReferenceSchema.optional(), incomingSource: sourceReferenceSchema.optional(),
}).strict().superRefine((update, context) => {
  if (update.kind.split('_', 1)[0] !== update.targetType) context.addIssue({ code: 'custom', message: 'Graph update kind does not match its target type.' });
  for (const value of [update.previous, update.current, update.incoming]) if (value && (update.targetType === 'fact' ? !('field' in value) : !('fromEntityId' in value))) context.addIssue({ code: 'custom', message: 'Graph update contains the wrong assertion type.' });
  const expected = update.kind.endsWith('_changed') || update.kind.endsWith('_added') ? 'incoming' : 'keep';
  if (update.defaultChoice !== expected) context.addIssue({ code: 'custom', message: 'Graph update has an invalid default.' });
});
export const graphCorrectionSchema = z.object({
  id: updateId, targetType: z.enum(['fact', 'relationship']), targetId: updateId, sourceKey: z.string().min(1).max(255),
  action: z.enum(['source-added', 'source-updated', 'source-removed', 'publisher-kept', 'source-accepted', 'publisher-corrected']),
  before: graphValueSchema, after: graphValueSchema, sourceName: z.string().max(255).optional(), anchorIds: z.array(updateId).max(8).optional(), recordedAt: z.number().int().nonnegative(),
}).strict();
export function validateGraphCorrections(input: unknown): GraphCorrection[] {
  const history = graphCorrectionSchema.array().max(500).parse(input);
  if (new Set(history.map(item => item.id)).size !== history.length) throw new AppError('Knowledge correction history contains duplicate identifiers.');
  return history;
}
export function validateGraphUpdates(input: unknown, _catalog?: KnowledgeCatalog, anchors?: SourceAnchor[]): GraphUpdate[] {
  const updates = graphUpdateSchema.array().max(2000).parse(input);
  if (new Set(updates.map(update => update.id)).size !== updates.length) throw new AppError('Graph source updates contain duplicate identifiers.');
  const knownAnchors = anchors ? new Set(anchors.map(anchor => anchor.id)) : undefined;
  for (const update of updates) {
    for (const reference of [update.previousSource, update.incomingSource]) if (reference && knownAnchors && !knownAnchors.has(reference.anchorId)) throw new AppError('A graph source update references an unavailable excerpt.');
    const values = [update.previous, update.current, update.incoming].filter((value): value is Exclude<GraphValue, null> => value !== null);
    for (const value of values) {
      if (update.targetType === 'fact') catalogFactSchema.parse(value); else catalogRelationshipSchema.parse(value);
      // Saved alternatives can refer to a removed entity. Validate their shape,
      // then validate references only when an alternative becomes current state.
    }
  }
  return updates;
}

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
        if (catalog) validateCatalog({ ...catalog, entities: [entity], collections: [], relationships: [], facts: [], capabilities: [] });
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
    && Object.entries(left.attributes).every(([key, value]) => Object.hasOwn(right.attributes, key) && right.attributes[key] === value)
    && JSON.stringify(left.aliases ?? []) === JSON.stringify(right.aliases ?? []) && JSON.stringify(left.identifiers ?? []) === JSON.stringify(right.identifiers ?? []);
}
function sourceReference(origin: SourceOrigin | undefined, entityId: string, field: string | undefined, anchors: Map<string, SourceAnchor>): { sourceName: string; anchorId: string } | undefined {
  const reference = origin?.provenance?.fields.find(item => item.entityId === entityId && item.field === (field ?? 'name'));
  const anchor = origin?.provenance?.anchors.find(item => reference?.anchorIds.includes(item.id));
  if (!anchor) return undefined;
  const anchorId = `anchor-${hashValue([origin!.key, origin!.hash, anchor.id]).slice(0, 32)}`;
  anchors.set(anchorId, { ...structuredClone(anchor), id: anchorId });
  return { sourceName: origin!.name, anchorId };
}

function graphSourceReference(origin: SourceOrigin | undefined, targetType: 'fact' | 'relationship', targetId: string, anchors: Map<string, SourceAnchor>): { sourceName: string; anchorId: string } | undefined {
  const references: SourceGraphReference[] = targetType === 'fact' ? origin?.provenance?.facts ?? [] : origin?.provenance?.relationships ?? [];
  const reference = references.find(item => item.targetId === targetId);
  const anchor = origin?.provenance?.anchors.find(item => reference?.anchorIds.includes(item.id));
  if (!anchor) return undefined;
  const anchorId = `anchor-${hashValue([origin!.key, origin!.hash, anchor.id]).slice(0, 32)}`;
  anchors.set(anchorId, { ...structuredClone(anchor), id: anchorId });
  return { sourceName: origin!.name, anchorId };
}

function graphEqual(left: GraphValue | null | undefined, right: GraphValue | null | undefined) {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
  return JSON.stringify(canonical(left ?? null)) === JSON.stringify(canonical(right ?? null));
}

function temporalOverlap(left: { validFrom?: string; validTo?: string }, right: { validFrom?: string; validTo?: string }) {
  const leftFrom = left.validFrom ?? ''; const rightFrom = right.validFrom ?? '';
  const leftTo = left.validTo ?? '\uffff'; const rightTo = right.validTo ?? '\uffff';
  return leftFrom <= rightTo && rightFrom <= leftTo;
}

function graphHistoryEntry(key: string, sourceName: string, targetType: 'fact' | 'relationship', targetId: string, action: GraphCorrection['action'], before: GraphValue | null, after: GraphValue | null, references: { previousSource?: { anchorId: string }; incomingSource?: { anchorId: string } } = {}): GraphCorrection {
  return { id: `correction-${randomUUID()}`, targetType, targetId, sourceKey: key, action,
    before: before ? structuredClone(before) : null, after: after ? structuredClone(after) : null, sourceName, anchorIds: [...new Set([references.previousSource?.anchorId, references.incomingSource?.anchorId].filter((id): id is string => !!id))], recordedAt: Date.now() };
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
export function mergeKnowledge(current: KnowledgeArtifact | null, incoming: KnowledgeCatalog, source: { fileId: string; name: string; hash: string; provenance?: SourceProvenance; replacesSourceKey?: string; modelInterpreted?: boolean }): KnowledgeArtifact {
  const previous = resolveSourceOrigin(current, source);
  // Keep the original namespace when a publisher explicitly replaces a renamed file.
  const key = previous?.key ?? sourceKey(source.name);
  const notes: string[] = [];
  const updates: SourceUpdate[] = [];
  const retainedAnchorIds = new Set(current?.correctionHistory?.flatMap(entry => entry.anchorIds ?? []) ?? []);
  const anchors = new Map<string, SourceAnchor>((current?.updateAnchors ?? []).filter(anchor => retainedAnchorIds.has(anchor.id)).map(anchor => [anchor.id, anchor]));
  const imported = validateCatalog(incoming);
  const identityMatches: SourceIdentityMatch[] = [];
  const existingEntities = current?.catalog.entities ?? [];
  const map = new Map<string, string>();
  const matchedCanonicalIds = new Set<string>();
  for (const entity of imported.entities) {
    const generated = entityKey(key, entity.id);
    // A source replacement keeps its deterministic source namespace whenever
    // possible. If an earlier cross-source match consolidated that namespace,
    // recover the saved canonical ID, never guess it from a renamed label.
    const retained = previous?.entityMap && Object.hasOwn(previous.entityMap, entity.id) ? previous.entityMap[entity.id] : previous?.baseline.entities.some(item => item.id === generated) ? generated : undefined;
    if (retained) { map.set(entity.id, retained); continue; }
    if (existingEntities.some(item => item.id === generated)) { map.set(entity.id, generated); continue; }
    // A model-supplied identifier is itself a claim awaiting review.
    const match = identityCandidate(entity, existingEntities, !source.modelInterpreted);
    if (match) {
      const matchRecord: SourceIdentityMatch = { id: `identity-${hashValue([key, entity.id, match.entity.id]).slice(0, 32)}`, sourceKey: key,
        incomingId: entity.id, canonicalEntityId: match.entity.id, incomingName: entity.name, canonicalName: match.entity.name,
        confidence: Number(match.confidence.toFixed(4)), method: match.method, status: match.status, reason: match.reason };
      const prior = current?.identityMatches?.find(item => item.id === matchRecord.id);
      if (prior?.decision === 'rejected') { map.set(entity.id, generated); continue; }
      if (!(match.status === 'auto' && matchedCanonicalIds.has(match.entity.id))) {
        identityMatches.push(matchRecord);
        if (match.status === 'auto') { matchedCanonicalIds.add(match.entity.id); map.set(entity.id, match.entity.id); continue; }
      }
    }
    map.set(entity.id, generated);
  }
  const entities = imported.entities.map(entity => ({ ...entity, id: map.get(entity.id)! }));
  const relationIds = new Map(imported.relationships.map(relation => [relation.id, `relation-${hashValue([key, relation.id]).slice(0, 24)}`]));
  const factIds = new Map((imported.facts ?? []).map(fact => [fact.id, `fact-${hashValue([key, fact.id]).slice(0, 24)}`]));
  const sourceCatalog = validateCatalog({ ...imported, id: randomUUID(), entities,
    collections: imported.collections.map(collection => ({ ...collection, id: `group-${hashValue([key, collection.id]).slice(0, 24)}`, ...(collection.parentIds ? { parentIds: collection.parentIds.map(id => `group-${hashValue([key, id]).slice(0, 24)}`) } : {}), entityIds: collection.entityIds.map(id => map.get(id)!) })),
    relationships: imported.relationships.map(relation => ({ ...relation, id: relationIds.get(relation.id)!, fromEntityId: map.get(relation.fromEntityId)!, toEntityId: map.get(relation.toEntityId)! })),
    facts: imported.facts?.map(fact => ({ ...fact, id: factIds.get(fact.id)!, entityId: map.get(fact.entityId)! })),
    jobs: imported.jobs.map(job => ({ ...job, id: `job-${hashValue([key, job.id]).slice(0, 24)}` })),
    capabilities: [],
  });
  const provenance = source.provenance ? validateSourceProvenance(source.provenance, imported) : undefined;
  const nextOrigin: SourceOrigin = { key, fileId: source.fileId, name: source.name, hash: source.hash,
    entityIds: sourceCatalog.entities.map(entity => entity.id), entityMap: Object.fromEntries(map), baseline: sourceCatalog,
    ...(provenance ? { provenance: { ...provenance, fields: provenance.fields.map(field => ({ ...field, entityId: map.get(field.entityId)! })),
      ...(provenance.facts ? { facts: provenance.facts.map(reference => ({ ...reference, targetId: factIds.get(reference.targetId)! })) } : {}),
      ...(provenance.relationships ? { relationships: provenance.relationships.map(reference => ({ ...reference, targetId: relationIds.get(reference.targetId)! })) } : {}),
    } } : {}),
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
  const result = current ? structuredClone(current.catalog) : { ...sourceCatalog, entities: [], collections: [], relationships: [], facts: [] };
  const definitions = new Map(result.attributes.map(attribute => [attribute.id, attribute]));
  for (const attribute of sourceCatalog.attributes) {
    const existing = definitions.get(attribute.id);
    if (existing && ['type', 'unit', 'currency'].some(key => existing[key as keyof typeof existing] !== attribute[key as keyof typeof attribute])) throw new AppError(`The attribute “${attribute.label}” has a different type or unit in another source. Rename that column or correct the source before combining it.`);
    definitions.set(attribute.id, existing ? { ...attribute, label: existing.label, ...(existing.aliases ? { aliases: existing.aliases } : {}) } : attribute);
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
    if (!baseline) {
      const identityMatch = identityMatches.find(match => match.status === 'auto' && match.canonicalEntityId === entity.id);
      if (identityMatch) {
        for (const [field, value] of Object.entries(entity.attributes)) {
          if (!Object.hasOwn(existing.attributes, field) || existing.attributes[field] === null) existing.attributes[field] = value;
          else if (value !== null && existing.attributes[field] !== value) notes.push(`The consolidated item “${existing.name}” has a conflicting ${field} value; the existing approved value was retained.`);
        }
        if (entity.summary && !existing.summary) existing.summary = entity.summary;
        existing.aliases = [...new Set([...(existing.aliases ?? []), ...(entity.aliases ?? [])])];
        if (existing.aliases.length > 12) throw new AppError('Consolidation exceeds 12 aliases. Review the source labels; none were truncated.');
        notes.push(`Automatically consolidated “${entity.name}” with “${existing.name}” using a scoped identifier and corroborating fields.`);
        continue;
      }
      notes.push(`Review the matching item “${entity.name}”; the existing record was retained.`); continue;
    }
    for (const field of ['name', 'summary', 'kind'] as const) {
      if (entity[field] !== baseline[field] && entity[field] !== existing[field]) addUpdate(existing[field] === baseline[field] ? 'changed' : 'conflict', entity, baseline, existing, entity, field);
      if (existing[field] === baseline[field]) existing[field] = entity[field];
      else if (existing[field] !== entity[field]) notes.push(`An earlier publisher ${field} correction for “${existing.name}” differs from the incoming source.`);
    }
    if (JSON.stringify(existing.blocks) === JSON.stringify(baseline.blocks)) existing.blocks = entity.blocks;
    else if (JSON.stringify(existing.blocks) !== JSON.stringify(entity.blocks)) notes.push(`Kept your detail blocks for “${existing.name}”.`);
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
    const keep = JSON.stringify(collection) !== JSON.stringify(baseline) || result.collections.some(child => child.parentIds?.includes(collection.id));
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
  const graphUpdates: GraphUpdate[] = [];
  const correctionHistory = [...(current?.correctionHistory ?? [])];
  const addGraphUpdate = (targetType: GraphUpdate['targetType'], kind: GraphUpdate['kind'], targetId: string, entityName: string, previousValue: GraphValue | null, currentValue: GraphValue | null, incomingValue: GraphValue | null, previousSource?: { sourceName: string; anchorId: string }, incomingSource?: { sourceName: string; anchorId: string }) => {
    graphUpdates.push({ id: `graph-update-${hashValue([key, source.hash, targetType, targetId, kind]).slice(0, 32)}`, targetType, kind, targetId, entityName,
      previous: previousValue ? structuredClone(previousValue) : null, current: currentValue ? structuredClone(currentValue) : null, incoming: incomingValue ? structuredClone(incomingValue) : null,
      defaultChoice: kind.endsWith('_changed') || kind.endsWith('_added') ? 'incoming' : 'keep', ...(previousSource ? { previousSource } : {}), ...(incomingSource ? { incomingSource } : {}) });
  };
  const relationshipLabel = (relation: CatalogRelationship) => result.entities.find(entity => entity.id === relation.fromEntityId)?.name ?? relation.fromEntityId;
  const relationshipKey = (relation: CatalogRelationship) => `${relation.fromEntityId}|${relation.toEntityId}|${relation.kind ?? relation.label}`;
  const factKey = (fact: CatalogFact) => `${fact.entityId}|${fact.field}`;
  const mergeGraphCollection = <T extends GraphValue>(targetType: 'fact' | 'relationship', incomingValues: T[], baselineValues: T[], currentValues: T[], keyFor: (value: T) => string, allowed: (value: T) => boolean) => {
    const target = targetType === 'fact' ? (result.facts ??= []) : result.relationships;
    const incomingIds = new Set(incomingValues.map(value => value.id));
    const baselineById = new Map(baselineValues.map(value => [value.id, value]));
    const sourceNameFor = (value: T) => targetType === 'fact' ? (value as CatalogFact).entityId : relationshipLabel(value as CatalogRelationship);
    for (const old of baselineValues) if (!incomingIds.has(old.id)) {
      const index = target.findIndex(value => value.id === old.id); if (index < 0) continue;
      const currentValue = target[index] as T;
      const previousSource = graphSourceReference(previous, targetType, old.id, anchors);
      addGraphUpdate(targetType, `${targetType}_missing`, old.id, sourceNameFor(old), old, currentValue, null, previousSource);
      notes.push(`The ${targetType} “${sourceNameFor(old)}” is absent from the replacement. Review whether to retain it.`);
    }
    for (const incoming of incomingValues) {
      if (!allowed(incoming)) continue;
      const index = target.findIndex(value => value.id === incoming.id); const baseline = baselineById.get(incoming.id); const currentValue = index >= 0 ? target[index] as T : undefined;
      const previousSource = baseline ? graphSourceReference(previous, targetType, baseline.id, anchors) : undefined;
      const incomingSource = graphSourceReference(nextOrigin, targetType, incoming.id, anchors);
      if (index < 0) {
        // A source replacement cannot silently resurrect a publisher deletion.
        if (baseline) {
          if (!graphEqual(baseline, incoming)) addGraphUpdate(targetType, `${targetType}_conflict`, incoming.id, sourceNameFor(incoming), baseline, null, incoming, previousSource, incomingSource);
          continue;
        }
        // Different sources can assert the same fact/edge under different IDs.
        // Overlapping temporal assertions with different values become an explicit review item.
        const collision = currentValues.find(value => keyFor(value) === keyFor(incoming) && temporalOverlap(value, incoming) && !graphEqual({ ...value, id: incoming.id }, incoming));
        if (collision) {
          addGraphUpdate(targetType, `${targetType}_conflict`, collision.id, sourceNameFor(incoming), collision, collision, incoming, undefined, incomingSource);
          continue;
        }
        if (targetType === 'fact') (result.facts ??= []).push(structuredClone(incoming as CatalogFact));
        else result.relationships.push(structuredClone(incoming as CatalogRelationship));
      } else if (!baseline) {
        if (!graphEqual(currentValue, incoming)) {
          addGraphUpdate(targetType, `${targetType}_conflict`, incoming.id, sourceNameFor(incoming), null, currentValue ?? null, incoming, undefined, incomingSource);
        }
      } else if (graphEqual(incoming, baseline)) {
        // No source change. Keep a publisher correction or the current assertion.
      } else if (graphEqual(currentValue, baseline)) {
        addGraphUpdate(targetType, `${targetType}_changed`, incoming.id, sourceNameFor(incoming), baseline, currentValue ?? null, incoming, previousSource, incomingSource);
        if (targetType === 'fact') (result.facts ??= [])[index] = structuredClone(incoming as CatalogFact);
        else result.relationships[index] = structuredClone(incoming as CatalogRelationship);
        correctionHistory.push(graphHistoryEntry(key, source.name, targetType, incoming.id, 'source-updated', baseline, incoming, { previousSource, incomingSource }));
      } else if (!graphEqual(currentValue, incoming)) {
        addGraphUpdate(targetType, `${targetType}_conflict`, incoming.id, sourceNameFor(incoming), baseline, currentValue ?? null, incoming, previousSource, incomingSource);
      }
    }
    if (targetType === 'fact') result.facts = target as CatalogFact[]; else result.relationships = target as CatalogRelationship[];
  };
  mergeGraphCollection('relationship', sourceCatalog.relationships, previous?.baseline.relationships ?? [], structuredClone(current?.catalog.relationships ?? []),
    relation => relationshipKey(relation as CatalogRelationship), relation => entityIds.has((relation as CatalogRelationship).fromEntityId) && entityIds.has((relation as CatalogRelationship).toEntityId));
  mergeGraphCollection('fact', sourceCatalog.facts ?? [], previous?.baseline.facts ?? [], structuredClone(current?.catalog.facts ?? []), fact => factKey(fact as CatalogFact), fact => entityIds.has((fact as CatalogFact).entityId));
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
  const updateContext = validateKnowledgeUpdateContext({ collections: [...collections.values()], relationships: [...relationships.values()], facts: [...new Map([...(catalog.facts ?? []), ...(sourceCatalog.facts ?? [])].map(fact => [fact.id, fact])).values()], capabilities: [...capabilities.values()] });
  const updateAnchors = updateAnchorsSchema.parse([...anchors.values()]);
  const previousIdentityMatches = current?.identityMatches ?? [];
  const allIdentityMatches = [...previousIdentityMatches.filter(match => !identityMatches.some(next => next.id === match.id)), ...identityMatches]
    .filter(match => catalog.entities.some(entity => entity.id === match.canonicalEntityId));
  const identityRemaps = { ...(current?.identityRemaps ?? {}), ...Object.fromEntries([...map].filter(([raw, canonical]) => entityKey(key, raw) !== canonical).map(([raw, canonical]) => [entityKey(key, raw), canonical])) };
  return { schemaVersion: 1, id: catalog.id, catalog, notes, identityRemaps, updates: validateKnowledgeUpdates(updates, catalog, updateContext, updateAnchors), updateContext, updateAnchors,
    ...(allIdentityMatches.length ? { identityMatches: allIdentityMatches } : {}), ...(graphUpdates.length ? { graphUpdates: validateGraphUpdates(graphUpdates, catalog, updateAnchors) } : {}),
    ...(correctionHistory.length ? { correctionHistory: validateGraphCorrections(correctionHistory) } : {}), origins: [
    ...(current?.origins.filter(origin => origin.key !== key) ?? []),
    nextOrigin,
  ] };
}

function remapEntityInOrigin(origin: SourceOrigin, fromId: string, toId: string): SourceOrigin {
  const remap = (value: KnowledgeCatalog): KnowledgeCatalog => validateCatalog({ ...value, entities: [...new Map(value.entities.map(entity => [entity.id === fromId ? toId : entity.id, { ...entity, id: entity.id === fromId ? toId : entity.id }])).values()],
    collections: value.collections.map(collection => ({ ...collection, entityIds: [...new Set(collection.entityIds.map(id => id === fromId ? toId : id))] })),
    relationships: value.relationships.map(relation => ({ ...relation, fromEntityId: relation.fromEntityId === fromId ? toId : relation.fromEntityId, toEntityId: relation.toEntityId === fromId ? toId : relation.toEntityId })).filter(relation => relation.fromEntityId !== relation.toEntityId),
    facts: value.facts?.map(fact => ({ ...fact, entityId: fact.entityId === fromId ? toId : fact.entityId })), capabilities: value.capabilities?.map(capability => ({ ...capability, entityIds: [...new Set(capability.entityIds.map(id => id === fromId ? toId : id))] })), });
  const baseline = remap(origin.baseline);
  const fields = new Map<string, SourceProvenance['fields'][number]>();
  for (const field of origin.provenance?.fields ?? []) {
    const entityId = field.entityId === fromId ? toId : field.entityId;
    const key = `${entityId}/${field.field}`;
    const retained = fields.get(key);
    fields.set(key, { ...field, entityId, anchorIds: [...new Set([...(retained?.anchorIds ?? []), ...field.anchorIds])] });
  }
  const provenance = origin.provenance ? validateSourceProvenance({ ...origin.provenance, fields: [...fields.values()], relationships: origin.provenance.relationships?.filter(reference => baseline.relationships.some(relation => relation.id === reference.targetId)) }, baseline) : undefined;
  return { ...origin, entityIds: [...new Set(origin.entityIds.map(id => id === fromId ? toId : id))], entityMap: Object.fromEntries(Object.entries(origin.entityMap ?? {}).map(([raw, id]) => [raw, id === fromId ? toId : id])), baseline, ...(provenance ? { provenance } : {}) };
}

export function remappedEntityId(id: string, remaps: Record<string, string> = {}): string {
  const seen = new Set<string>();
  while (Object.hasOwn(remaps, id)) {
    if (seen.has(id) || seen.size >= 100) throw new AppError('Identity remaps contain a cycle or exceed the supported bound.');
    seen.add(id); id = remaps[id];
  }
  return id;
}

function remapGraphValue(value: GraphValue | null, fromId: string, toId: string): GraphValue | null {
  if (!value) return null;
  if ('entityId' in value) return { ...value, entityId: value.entityId === fromId ? toId : value.entityId };
  const fromEntityId = value.fromEntityId === fromId ? toId : value.fromEntityId;
  const toEntityId = value.toEntityId === fromId ? toId : value.toEntityId;
  return fromEntityId === toEntityId ? null : { ...value, fromEntityId, toEntityId };
}

/** Apply a publisher decision to one review-only identity suggestion or add an explicit alias. */
export function resolveKnowledgeIdentity(artifact: KnowledgeArtifact, decisions: IdentityMatchDecision[]): KnowledgeArtifact {
  const parsed = identityMatchDecisionSchema.array().min(1).max(500).parse(decisions);
  if (new Set(parsed.map(decision => decision.id)).size !== parsed.length) throw new AppError('Choose each identity suggestion only once.');
  const matches = (artifact.identityMatches ?? []).map(match => ({ ...match }));
  for (const decision of parsed) if (!matches.some(match => match.id === decision.id)) throw new AppError('This identity suggestion is no longer available. Reload the proposal.', 409);
  const next = structuredClone(artifact);
  const catalog = structuredClone(artifact.catalog);
  const notes = [...artifact.notes];
  for (const decision of parsed) {
    const match = matches.find(item => item.id === decision.id)!;
    const canonical = catalog.entities.find(entity => entity.id === match.canonicalEntityId);
    if (!canonical) throw new AppError('The suggested canonical item is no longer available. Reload the proposal.', 409);
    if (decision.action === 'alias') {
      const alias = decision.alias!.trim();
      if (identityToken(alias) === identityToken(canonical.name) || canonical.aliases?.some(value => identityToken(value) === identityToken(alias))) continue;
      if ((canonical.aliases?.length ?? 0) >= 12) throw new AppError(`The item “${canonical.name}” already has the maximum number of aliases.`);
      canonical.aliases = [...new Set([...(canonical.aliases ?? []), alias])];
      notes.push(`Added “${alias}” as an approved alternate label for “${canonical.name}”.`);
      continue;
    }
    if (match.status !== 'review' || match.decision && match.decision !== 'pending') throw new AppError('This identity suggestion has already been decided. Reload the proposal.', 409);
    match.decision = decision.action === 'approve' ? 'approved' : 'rejected';
    if (decision.action === 'reject') { notes.push(`Rejected the suggested identity match “${match.incomingName}” → “${match.canonicalName}”.`); continue; }
    const incomingId = entityKey(match.sourceKey, match.incomingId);
    const incoming = catalog.entities.find(entity => entity.id === incomingId);
    if (!incoming || incoming.id === canonical.id) throw new AppError('The suggested incoming item is no longer available. Reload the proposal.', 409);
    for (const [field, value] of Object.entries(incoming.attributes)) if (!Object.hasOwn(canonical.attributes, field) || canonical.attributes[field] === null) canonical.attributes[field] = value;
    if (!canonical.summary && incoming.summary) canonical.summary = incoming.summary;
    canonical.aliases = [...new Map([...(canonical.aliases ?? []), incoming.name, ...(incoming.aliases ?? [])].filter(alias => identityToken(alias) !== identityToken(canonical.name)).map(alias => [identityToken(alias), alias])).values()];
    if (canonical.aliases.length > 12) throw new AppError('Consolidation would exceed 12 aliases. Review alternate labels first.');
    catalog.collections = catalog.collections.map(collection => ({ ...collection, entityIds: [...new Set(collection.entityIds.map(id => id === incomingId ? canonical.id : id))] }));
    catalog.relationships = catalog.relationships.map(relation => ({ ...relation, fromEntityId: relation.fromEntityId === incomingId ? canonical.id : relation.fromEntityId, toEntityId: relation.toEntityId === incomingId ? canonical.id : relation.toEntityId })).filter(relation => relation.fromEntityId !== relation.toEntityId);
    catalog.facts = catalog.facts?.map(fact => ({ ...fact, entityId: fact.entityId === incomingId ? canonical.id : fact.entityId }));
    catalog.capabilities = catalog.capabilities?.map(capability => ({ ...capability, entityIds: [...new Set(capability.entityIds.map(id => id === incomingId ? canonical.id : id))] }));
    catalog.entities = catalog.entities.filter(entity => entity.id !== incomingId);
    next.origins = next.origins.map(origin => remapEntityInOrigin(origin, incomingId, canonical.id));
    next.identityRemaps = { ...next.identityRemaps, [incomingId]: canonical.id };
    // Recorded history is immutable. Its historical entity IDs resolve through
    // identityRemaps; never rewrite what a publisher previously reviewed.
    next.updates = next.updates?.filter(update => update.entityId !== incomingId && update.entityId !== canonical.id);
    if (next.updateContext) next.updateContext = {
      ...next.updateContext,
      collections: next.updateContext.collections.map(collection => ({ ...collection, entityIds: [...new Set(collection.entityIds.map(id => id === incomingId ? canonical.id : id))] })),
      relationships: next.updateContext.relationships.map(value => remapGraphValue(value, incomingId, canonical.id)).filter((value): value is CatalogRelationship => !!value),
      facts: next.updateContext.facts?.map(value => ({ ...value, entityId: value.entityId === incomingId ? canonical.id : value.entityId })),
      capabilities: next.updateContext.capabilities.map(value => ({ ...value, entityIds: [...new Set(value.entityIds.map(id => id === incomingId ? canonical.id : id))] })),
    };
    next.graphUpdates = next.graphUpdates?.map(update => ({ ...update,
      previous: remapGraphValue(update.previous, incomingId, canonical.id), current: remapGraphValue(update.current, incomingId, canonical.id), incoming: remapGraphValue(update.incoming, incomingId, canonical.id),
    }));
    notes.push(`Approved and consolidated “${incoming.name}” with “${canonical.name}”.`);
  }
  catalog.id = randomUUID();
  const updatedMatches = matches.filter(match => catalog.entities.some(entity => entity.id === match.canonicalEntityId));
  const result = { ...next, id: catalog.id, catalog: validateCatalog(catalog), notes, identityMatches: updatedMatches };
  if (artifact.assertionReviews) {
    result.assertionReviews = remapAssertionReviews(artifact, result, id => remappedEntityId(id, result.identityRemaps));
    const aliasTargets = new Set(parsed.filter(decision => decision.action === 'alias').map(decision => `${remappedEntityId(matches.find(match => match.id === decision.id)!.canonicalEntityId, result.identityRemaps)}/aliases`));
    result.assertionReviews = result.assertionReviews.map(review => review.targetType === 'field' && aliasTargets.has(review.targetId) ? { ...review, origin: 'publisher', support: 'publisher', status: 'approved' } : review);
  }
  return result;
}

/** Resolve only recorded source alternatives; callers never submit replacement facts. */
export function resolveKnowledgeUpdates(artifact: KnowledgeArtifact, decisions: SourceUpdateDecision[]): KnowledgeArtifact {
  const parsed = sourceUpdateDecisionSchema.array().min(1).max(2700).parse(decisions);
  if (new Set(parsed.map(decision => decision.id)).size !== parsed.length) throw new AppError('Choose each source update only once.');
  const context = validateKnowledgeUpdateContext(artifact.updateContext ?? { collections: [], relationships: [], capabilities: [] });
  const anchors = updateAnchorsSchema.parse(artifact.updateAnchors ?? []);
  const updates = validateKnowledgeUpdates(artifact.updates ?? [], artifact.catalog, context, anchors);
  const graphUpdates = validateGraphUpdates(artifact.graphUpdates ?? [], artifact.catalog, anchors);
  // An unqualified field mirror and its fact are one decision, not two values
  // that can disagree after a publisher chooses a source alternative.
  for (const decision of [...parsed]) {
    const field = updates.find(update => update.id === decision.id && update.field);
    if (!field) continue;
    for (const graph of graphUpdates) if (graph.targetType === 'fact' && graph.current && 'field' in graph.current && graph.incoming && 'field' in graph.incoming
      && graph.current.entityId === field.entityId && graph.current.field === field.field && !graph.current.qualifiers?.length && !graph.current.validFrom && !graph.current.validTo
      && graph.current.value === field.current && graph.incoming.value === field.incoming && !parsed.some(item => item.id === graph.id)) parsed.push({ id: graph.id, choice: decision.choice });
  }
  if (parsed.some(decision => !updates.some(update => update.id === decision.id) && !graphUpdates.some(update => update.id === decision.id))) throw new AppError('This source update is no longer available. Reload the proposal.', 409);
  const catalog = structuredClone(artifact.catalog);
  for (const update of updates.filter(update => parsed.some(decision => decision.id === update.id))) {
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
  for (const update of graphUpdates.filter(update => parsed.some(decision => decision.id === update.id))) {
    const values = update.targetType === 'fact' ? catalog.facts ?? [] : catalog.relationships;
    const priorChoice = update.choice ?? update.defaultChoice;
    const expected = priorChoice === 'keep' ? update.current : update.incoming;
    const actual = values.find(value => value.id === (expected?.id ?? update.targetId)) ?? null;
    if (!graphEqual(actual, expected)) throw new AppError('This graph assertion was edited after its source update. Review the current proposal before resolving it.', 409);
  }
  for (const decision of parsed) {
    const fieldUpdate = updates.find(update => update.id === decision.id);
    if (fieldUpdate) fieldUpdate.choice = decision.choice;
    else graphUpdates.find(update => update.id === decision.id)!.choice = decision.choice;
  }
  for (const update of updates.filter(update => parsed.some(decision => decision.id === update.id))) {
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
  const correctionHistory = [...(artifact.correctionHistory ?? [])];
  for (const update of graphUpdates.filter(update => parsed.some(decision => decision.id === update.id))) {
    const choice = update.choice ?? update.defaultChoice;
    const values = update.targetType === 'fact' ? catalog.facts ?? (catalog.facts = []) : catalog.relationships;
    const index = values.findIndex(value => value.id === update.targetId || value.id === update.incoming?.id);
    const selected = choice === 'keep' ? update.current : update.incoming;
    if (index >= 0) values.splice(index, 1);
    if (selected) {
      // A source assertion may use a new stable ID after replacement. Remove
      // the target before inserting it so IDs and temporal alternatives remain
      // unambiguous in the published graph.
      const duplicate = values.findIndex(value => value.id === selected.id);
      if (duplicate >= 0) values.splice(duplicate, 1);
      if (update.targetType === 'fact') (catalog.facts ??= []).push(structuredClone(selected as CatalogFact));
      else catalog.relationships.push(structuredClone(selected as CatalogRelationship));
    }
    correctionHistory.push(graphHistoryEntry('publisher-review', update.incomingSource?.sourceName ?? update.previousSource?.sourceName ?? 'source', update.targetType, selected?.id ?? update.targetId,
      choice === 'incoming' ? 'source-accepted' : 'publisher-kept', update.current, selected, { previousSource: update.previousSource, incomingSource: update.incomingSource }));
    update.choice = choice;
  }
  if (!catalog.entities.length) throw new AppError('Keep at least one item in this proposal. To remove all knowledge, use Remove knowledge from draft.');
  const entityIds = new Set(catalog.entities.map(entity => entity.id));
  for (const update of updates.filter(update => parsed.some(decision => decision.id === update.id))) if (!update.field && entityIds.has(update.entityId)) {
    for (const fact of context.facts ?? []) if (fact.entityId === update.entityId && !catalog.facts?.some(item => item.id === fact.id)) (catalog.facts ??= []).push(structuredClone(fact));
    for (const collection of context.collections.filter(item => update.restoration!.collectionIds.includes(item.id))) {
      const index = catalog.collections.findIndex(item => item.id === collection.id);
      if (index >= 0) catalog.collections[index].entityIds = [...new Set([...collection.entityIds, ...catalog.collections[index].entityIds])]; else catalog.collections.push(structuredClone(collection));
    }
    // A retained edge may have been pooled by its other endpoint's update.
    // Restore only edges touching the item being restored, not every old edge.
    for (const relation of context.relationships.filter(item => item.fromEntityId === update.entityId || item.toEntityId === update.entityId)) if (!catalog.relationships.some(item => item.id === relation.id)) catalog.relationships.push(structuredClone(relation));
    for (const capability of context.capabilities.filter(item => update.restoration!.capabilityIds.includes(item.id))) {
      const index = catalog.capabilities?.findIndex(item => item.id === capability.id) ?? -1;
      if (index >= 0) catalog.capabilities![index].entityIds = [...new Set([...capability.entityIds, ...catalog.capabilities![index].entityIds])]; else (catalog.capabilities ??= []).push(structuredClone(capability));
    }
  }
  catalog.collections = catalog.collections.map(collection => ({ ...collection, entityIds: collection.entityIds.filter(id => entityIds.has(id)) }));
  catalog.relationships = catalog.relationships.filter(relation => entityIds.has(relation.fromEntityId) && entityIds.has(relation.toEntityId));
  catalog.facts = catalog.facts?.filter(fact => entityIds.has(fact.entityId));
  catalog.capabilities = catalog.capabilities?.filter(capability => !capability.entityIds.length || capability.entityIds.some(id => entityIds.has(id))).map(capability => ({ ...capability, entityIds: capability.entityIds.filter(id => entityIds.has(id)) }));
  catalog.id = randomUUID();
  const result = { ...structuredClone(artifact), id: catalog.id, catalog: validateCatalog(catalog), updates, graphUpdates, correctionHistory: validateGraphCorrections(correctionHistory) };
  if (artifact.assertionReviews) result.assertionReviews = refreshAssertionReviews(result, 'publisher');
  return result;
}
