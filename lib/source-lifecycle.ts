import { randomUUID } from 'node:crypto';
import type { CatalogEntity, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { hashValue, type KnowledgeArtifact } from './knowledge-model';
import { catalogForPublication, refreshAssertionReviews } from './knowledge-assertions';
import { AppError } from './errors';
import type { SiteContent } from './site-model';

const same = (a: unknown, b: unknown) => hashValue(a ?? null) === hashValue(b ?? null);
const withoutId = <T extends { id: string }>(value: T) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'id'));

/** Withdraw evidence, retaining a private baseline as a tombstone for later imports. */
export function removeSourceContribution(current: KnowledgeArtifact, sourceKey: string): KnowledgeArtifact {
  const source = current.origins.find(origin => origin.key === sourceKey && !origin.retired);
  if (!source) throw new AppError('This source is no longer contributing to the draft. Reload its source review.', 409);
  const others = current.origins.filter(origin => origin.key !== sourceKey && !origin.retired);
  const catalog = structuredClone(catalogForPublication(current));
  const notes: string[] = [`Remove the contribution of “${source.name}”. Its original file and private review history are retained. Publish remains separate.`];
  catalog.entities = catalog.entities.flatMap(entity => {
    const baseline = source.baseline.entities.find(item => item.id === entity.id);
    if (!baseline) return [entity];
    const supported = others.flatMap(origin => origin.baseline.entities.find(item => item.id === entity.id) ?? []);
    const correctedFacts = catalog.facts?.some(fact => fact.entityId === entity.id && !source.baseline.facts?.some(old => same(withoutId(old), withoutId(fact))) && !others.some(origin => origin.baseline.facts?.some(old => same(withoutId(old), withoutId(fact)))));
    if (!supported.length && same(entity, baseline) && !correctedFacts) { notes.push(`Retire “${entity.name}”: only this source supported it.`); return []; }
    const next: CatalogEntity = { ...entity, attributes: { ...entity.attributes } };
    const retained: string[] = [];
    for (const field of ['summary', 'blocks', 'aliases', 'identifiers'] as const) {
      if (!same(entity[field], baseline[field])) { retained.push(field); continue; }
      const alternatives = supported.map(item => item[field]).filter(value => value !== undefined && value !== '');
      if (alternatives.some(value => same(value, entity[field]))) continue;
      const unambiguous = alternatives.length > 0 && alternatives.every(value => same(value, alternatives[0]));
      Object.assign(next, { [field]: unambiguous ? alternatives[0] : field === 'summary' ? '' : undefined });
      if (alternatives.length && !unambiguous) notes.push(`Conflicting support for ${entity.name} · ${field}. The field is left unknown for review.`);
    }
    for (const field of Object.keys(baseline.attributes)) {
      if (!same(entity.attributes[field], baseline.attributes[field])) { retained.push(field); continue; }
      const values = supported.map(item => item.attributes[field]).filter(value => value != null);
      if (values.some(value => same(value, entity.attributes[field]))) continue;
      next.attributes[field] = values.length && values.every(value => same(value, values[0])) ? values[0] : null;
      if (values.length > 1 && !values.every(value => same(value, values[0]))) notes.push(`Conflicting support for ${entity.name} · ${field}. No value was guessed.`);
    }
    if (retained.length || correctedFacts || entity.name !== baseline.name || entity.kind !== baseline.kind) notes.push(`Publisher corrections retained for “${entity.name}”. Unsupported unchanged details are retired; its stable identity remains.`);
    else notes.push(`“${entity.name}” remains supported by another source.`);
    return [next];
  });
  const entityIds = new Set(catalog.entities.map(entity => entity.id));
  catalog.facts = catalog.facts?.filter(fact => entityIds.has(fact.entityId) && (!source.baseline.facts?.some(old => same(withoutId(old), withoutId(fact))) || others.some(origin => origin.baseline.facts?.some(old => same(withoutId(old), withoutId(fact))))));
  catalog.relationships = catalog.relationships.filter(relation => entityIds.has(relation.fromEntityId) && entityIds.has(relation.toEntityId) && (!source.baseline.relationships.some(old => same(withoutId(old), withoutId(relation))) || others.some(origin => origin.baseline.relationships.some(old => same(withoutId(old), withoutId(relation))))));
  catalog.collections = catalog.collections.filter(collection => !source.baseline.collections.some(old => same(old, collection)) || others.some(origin => origin.baseline.collections.some(old => same(withoutId(old), withoutId(collection))))).map(collection => ({ ...collection, entityIds: collection.entityIds.filter(id => entityIds.has(id)) }));
  const collectionIds = new Set(catalog.collections.map(collection => collection.id));
  catalog.collections = catalog.collections.map(collection => ({ ...collection, ...(collection.parentIds ? { parentIds: collection.parentIds.filter(id => collectionIds.has(id)) } : {}) }));
  catalog.jobs = catalog.jobs.filter(job => !source.baseline.jobs.some(old => same(old, job)) || others.some(origin => origin.baseline.jobs.some(old => same(withoutId(old), withoutId(job)))));
  catalog.capabilities = catalog.capabilities?.filter(capability => !capability.entityIds.length || capability.entityIds.some(id => entityIds.has(id))).map(capability => ({ ...capability, entityIds: capability.entityIds.filter(id => entityIds.has(id)) }));
  if (same(catalog.description, source.baseline.description) && !others.some(origin => same(origin.baseline.description, catalog.description))) catalog.description = '';
  catalog.id = randomUUID();
  const artifact: KnowledgeArtifact = { ...current, id: catalog.id, catalog: validateCatalog(catalog),
    origins: current.origins.map(origin => origin.key === sourceKey ? { ...origin, retired: true } : origin),
    notes, updates: [], graphUpdates: [], identityMatches: current.identityMatches?.filter(match => entityIds.has(match.canonicalEntityId)),
    updateContext: { collections: [], relationships: [], capabilities: [] },
  };
  delete artifact.website;
  delete artifact.files;
  artifact.assertionReviews = refreshAssertionReviews(artifact, 'publisher', current.assertionReviews);
  return artifact;
}

export type SourceImpact = {
  added: string[]; updated: string[]; removed: string[]; conflicts: number; correctionsRetained: number;
  collections: string[]; images: number; opening: number; sections: string[];
};
/** Derived from the saved candidate and draft, never a client-authored change list. */
export function sourceImpact(before: KnowledgeCatalog | null, candidate: KnowledgeArtifact, content: SiteContent, media?: MediaLibrary | null): SourceImpact {
  const after = candidate.catalog, byId = new Map(before?.entities.map(entity => [entity.id, entity]) ?? []);
  const removed = before?.entities.filter(entity => !after.entities.some(item => item.id === entity.id)) ?? [];
  const removedIds = new Set(removed.map(entity => entity.id));
  const collections = [...new Set([...(before?.collections ?? []), ...after.collections].filter(collection => !same(before?.collections.find(item => item.id === collection.id), after.collections.find(item => item.id === collection.id))).map(collection => collection.name))];
  return { added: after.entities.filter(entity => !byId.has(entity.id)).map(entity => entity.name),
    updated: after.entities.filter(entity => byId.has(entity.id) && (!same(entity, byId.get(entity.id)) || !same(before?.facts?.filter(fact => fact.entityId === entity.id), after.facts?.filter(fact => fact.entityId === entity.id)))).map(entity => entity.name),
    removed: removed.map(entity => entity.name), collections,
    conflicts: (candidate.updates?.filter(update => update.kind === 'conflict').length ?? 0) + (candidate.graphUpdates?.filter(update => update.kind.endsWith('_conflict')).length ?? 0) + (candidate.identityMatches?.filter(match => match.status === 'review' && !match.decision).length ?? 0),
    correctionsRetained: candidate.notes.filter(note => /(?:correction.*retain|kept your|earlier publisher)/i.test(note)).length,
    images: media?.associations.filter(link => link.targetType === 'entity' && removedIds.has(link.targetId!)).length ?? 0,
    opening: (content.opening?.featuredEntityIds.filter(id => removedIds.has(id)).length ?? 0) + (content.greetingPoints?.filter(point => point?.kind === 'entity' && removedIds.has(point.id)).length ?? 0),
    sections: [...new Set([...(before?.entities ?? []), ...after.entities].filter(entity => entity.blocks?.length && !same(byId.get(entity.id), after.entities.find(item => item.id === entity.id))).map(entity => entity.name))],
  };
}
