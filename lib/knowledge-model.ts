import { createHash, randomUUID } from 'node:crypto';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';

export type KnowledgeJob = {
  id: string; fileId?: string; operation?: 'source' | 'review'; sourceName: string; sourceHash: string; baseDraftHash: string; baseRevision: number;
  status: 'running' | 'needs_review' | 'applied' | 'discarded' | 'failed' | 'interrupted';
  stage: 'extracting' | 'interpreting' | 'review'; claim: string; startedAt: number; updatedAt: number;
  message: string; candidateRevisionId?: string; appliedRevisionId?: string; paidAttempt?: boolean;
};
export type KnowledgeLedger = { schemaVersion: 1; jobs: KnowledgeJob[] };
export type SourceOrigin = { key: string; fileId: string; name: string; hash: string; entityIds: string[]; baseline: KnowledgeCatalog };
export type KnowledgeArtifact = { schemaVersion: 1; id: string; catalog: KnowledgeCatalog; origins: SourceOrigin[]; notes: string[] };
export type KnowledgeCandidate = { id: string; catalog: KnowledgeCatalog; notes: string[]; sourceName: string; baseRevision: number };
export const hashValue = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const sourceKey = (name: string) => name.trim().toLowerCase();
export const entityKey = (source: string, id: string) => `item-${hashValue([source, id.trim().toLowerCase()]).slice(0, 24)}`;

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

/** Three-way source merge: unchanged imported fields update; publisher overrides survive. */
export function mergeKnowledge(current: KnowledgeArtifact | null, incoming: KnowledgeCatalog, source: { fileId: string; name: string; hash: string }): KnowledgeArtifact {
  const key = sourceKey(source.name);
  const previous = current?.origins.find(origin => origin.key === key);
  const notes: string[] = [];
  const imported = validateCatalog(incoming);
  const map = new Map(imported.entities.map(entity => [entity.id, entityKey(key, entity.id)]));
  const entities = imported.entities.map(entity => ({ ...entity, id: map.get(entity.id)! }));
  const sourceCatalog = validateCatalog({ ...imported, id: randomUUID(), entities,
    collections: imported.collections.map(collection => ({ ...collection, id: `group-${hashValue([key, collection.id]).slice(0, 24)}`, entityIds: collection.entityIds.map(id => map.get(id)!) })),
    relationships: imported.relationships.map(relation => ({ ...relation, id: `relation-${hashValue([key, relation.id]).slice(0, 24)}`, fromEntityId: map.get(relation.fromEntityId)!, toEntityId: map.get(relation.toEntityId)! })),
    jobs: imported.jobs.map(job => ({ ...job, id: `job-${hashValue([key, job.id]).slice(0, 24)}` })),
    capabilities: [],
  });
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
      if (baseline) notes.push(`Kept your removal of “${entity.name}”.`);
      else result.entities.push(entity);
      continue;
    }
    if (!baseline) { notes.push(`Review the matching item “${entity.name}”; the existing record was retained.`); continue; }
    for (const field of ['name', 'summary', 'kind'] as const) {
      if (existing[field] === baseline[field]) existing[field] = entity[field];
      else if (existing[field] !== entity[field]) notes.push(`Kept your ${field} correction for “${existing.name}”.`);
    }
    for (const field of new Set([...Object.keys(baseline.attributes), ...Object.keys(entity.attributes)])) {
      if (existing.attributes[field] === baseline.attributes[field]) {
        if (field in entity.attributes) existing.attributes[field] = entity.attributes[field];
        else delete existing.attributes[field];
      } else if (existing.attributes[field] !== entity.attributes[field]) notes.push(`Kept your ${field} correction for “${existing.name}”.`);
    }
  }
  for (const old of previous?.baseline.entities ?? []) if (!sourceCatalog.entities.some(entity => entity.id === old.id)) notes.push(`“${old.name}” is absent from the updated source. It was retained for your review; remove it explicitly if appropriate.`);
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
  return { schemaVersion: 1, id: catalog.id, catalog, notes, origins: [
    ...(current?.origins.filter(origin => origin.key !== key) ?? []),
    { key, fileId: source.fileId, name: source.name, hash: source.hash, entityIds: sourceCatalog.entities.map(entity => entity.id), baseline: sourceCatalog },
  ] };
}
