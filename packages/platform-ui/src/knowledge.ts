import { z } from 'zod';
import { catalogFilterSchema, temporalDateSchema, validateCatalog, validateCatalogFilters, type AttributeDefinition, type CatalogFact, type CatalogValue, type KnowledgeCatalog } from './contracts.js';
import { filterEntities } from './catalog.js';
import { validateMediaLibrary, type MediaLibrary } from './media.js';

const reference = z.string().min(1).max(80);
export const knowledgeQuerySchema = z.object({
  revisionId: reference, query: z.string().trim().max(2000).optional(), intent: z.enum(['discover', 'answer', 'compare', 'photos', 'relationships']).optional(),
  entityIds: z.array(reference).max(12).optional(), factIds: z.array(reference).max(40).optional(), assetIds: z.array(reference).max(12).optional(),
  asOf: temporalDateSchema.optional(), filters: z.array(catalogFilterSchema).max(24).optional(),
  expansion: z.number().int().min(0).max(2).optional(),
}).strict();
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export const KNOWLEDGE_LIMITS = Object.freeze({ entities: 12, facts: 40, relationships: 20, assets: 12, bytes: 32_000, expansion: 2 });
export type FactSelection = { entityId: string; field: string; status: 'known' | 'unknown' | 'conflict' | 'qualified' | 'out-of-time'; value: CatalogValue; factIds: string[]; display: string };
function format(value: CatalogValue, definition?: AttributeDefinition) {
  if (value === null) return 'Unknown';
  if (definition?.type === 'money' && typeof value === 'number') return `${definition.currency} ${value}${definition.unit ? ` / ${definition.unit}` : ''}`;
  return `${String(value)}${definition?.unit ? ` ${definition.unit}` : ''}`;
}
export function assertionActive(value: { validFrom?: string; validTo?: string }, asOf: string) {
  const time = Date.parse(asOf);
  const end = value.validTo ? Date.parse(value.validTo) + (value.validTo.length === 10 ? 86_399_999 : 0) : Infinity;
  return (!value.validFrom || Date.parse(value.validFrom) <= time) && end >= time;
}
/** The same rule drives legacy cards and query answers. Never choose a newest,
 * highest-confidence or last-imported claim to hide a disagreement. */
export function selectFactValue(facts: CatalogFact[], asOf: string, definition?: AttributeDefinition): FactSelection {
  temporalDateSchema.parse(asOf);
  if (!facts.length) throw new Error('Fact selection requires an assertion group.');
  const active = facts.filter(fact => assertionActive(fact, asOf));
  const plain = active.filter(fact => !fact.qualifiers?.length && fact.polarity !== 'denied' && !fact.expression);
  const values = new Set(plain.filter(fact => fact.value !== null).map(fact => JSON.stringify([fact.value, fact.definition?.type, fact.definition?.unit, fact.definition?.currency])));
  const denied = active.some(fact => fact.polarity === 'denied' && !fact.qualifiers?.length && plain.some(other => other.value !== null && other.value === fact.value));
  const status = !active.length ? 'out-of-time' : values.size > 1 || denied ? 'conflict' : active.some(fact => fact.qualifiers?.length || fact.polarity === 'denied') ? 'qualified'
    : values.size === 1 ? 'known' : 'unknown';
  const selected = status === 'known' ? plain.find(fact => fact.value !== null)! : undefined;
  const value = selected?.value ?? null;
  return { entityId: facts[0].entityId, field: facts[0].field, status, value, factIds: active.map(fact => fact.id),
    display: status === 'known' ? format(value, selected?.definition ?? definition) : status === 'conflict' ? 'Conflicting approved assertions' : status === 'qualified' ? 'See conditions and exceptions' : status === 'out-of-time' ? 'Unknown at this time' : 'Unknown' };
}
export function projectKnowledgeCatalog(input: KnowledgeCatalog, asOf = new Date().toISOString()): KnowledgeCatalog {
  const catalog = validateCatalog(input);
  temporalDateSchema.parse(asOf);
  const groups = new Map<string, CatalogFact[]>();
  for (const fact of catalog.facts ?? []) { const key = `${fact.entityId}/${fact.field}`; groups.set(key, [...(groups.get(key) ?? []), fact]); }
  return { ...catalog, entities: catalog.entities.map(entity => ({ ...entity, attributes: Object.fromEntries(Object.entries(entity.attributes).map(([key, value]) => {
    const facts = groups.get(`${entity.id}/attributes.${key}`);
    return [key, facts ? selectFactValue(facts, asOf, catalog.attributes.find(attribute => attribute.id === key)).value : value];
  })) })), relationships: catalog.relationships.filter(relation => assertionActive(relation, asOf) && relation.polarity !== 'denied' && !relation.qualifiers?.length) };
}
function tokens(text: string): string[] {
  const aliases: Record<string, string> = { where: 'location', address: 'location', venue: 'location', located: 'location', map: 'location', mail: 'email', cost: 'price', costs: 'price', picture: 'photo', pictures: 'photo', photos: 'photo', classes: 'class' };
  const stop = new Set(['a', 'an', 'and', 'are', 'at', 'can', 'do', 'for', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'show', 'the', 'to', 'what', 'with']);
  return [...new Set(text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(token => token && !stop.has(token)).map(token => aliases[token] ?? token))];
}
const score = (text: string, query: string[]) => { const words = new Set(tokens(text)); return query.reduce((total, word) => total + Number(words.has(word)), 0); };
/** Revision-scoped assertion references shared by retrieval and legacy workspace adapters. */
export function knowledgeFacts(catalog: KnowledgeCatalog): CatalogFact[] {
  // Legacy snapshots have no assertion layer. Stable synthetic references are
  // qualified by revisionId, and never persisted over an immutable publication.
  const facts = [...(catalog.facts ?? [])];
  const used = new Set(facts.map(fact => fact.id));
  for (const entity of catalog.entities) for (const [key, value] of Object.entries(entity.attributes)) {
    if (!facts.some(fact => fact.entityId === entity.id && fact.field === `attributes.${key}`)) {
      const stem = `legacy-${catalog.entities.indexOf(entity)}-${catalog.attributes.findIndex(attribute => attribute.id === key)}`;
      let id = stem; let suffix = 0;
      while (used.has(id)) id = `${stem}-${++suffix}`;
      used.add(id);
      facts.push({ id, entityId: entity.id, field: `attributes.${key}`, value });
    }
  }
  return facts;
}
/** Pure, deterministic retrieval over one ALREADY AUTHORIZED public snapshot.
 * Host code owns publication authorization; no source/provenance input exists. */
export function retrieveKnowledge(input: KnowledgeCatalog, request: KnowledgeQuery, mediaInput?: MediaLibrary | null) {
  const catalog = validateCatalog(input); const query = knowledgeQuerySchema.parse(request);
  if (query.revisionId !== catalog.id) throw new Error('Knowledge revision changed. Reload before retrieving.');
  const asOf = query.asOf ?? new Date().toISOString();
  const media = mediaInput ? validateMediaLibrary(mediaInput, { entityIds: catalog.entities.map(entity => entity.id) }) : null;
  const allFacts = knowledgeFacts(catalog);
  const knownEntities = new Set(catalog.entities.map(entity => entity.id));
  const unknownReferences = [...(query.entityIds ?? []).filter(id => !knownEntities.has(id)), ...(query.factIds ?? []).filter(id => !allFacts.some(fact => fact.id === id)), ...(query.assetIds ?? []).filter(id => !media?.assets.some(asset => asset.id === id))];
  if (unknownReferences.length) return { schemaVersion: 1 as const, revisionId: catalog.id, asOf, status: 'unresolved' as const, reason: 'Unknown references at this publication.', entities: [], facts: [], values: [], relationships: [], media: null, limits: KNOWLEDGE_LIMITS, omitted: { entities: 0, facts: 0, relationships: 0, assets: 0 } };
  const words = tokens(query.query ?? '');
  const fields = new Map(catalog.attributes.map(attribute => [attribute.id, attribute]));
  const factScore = (fact: CatalogFact) => score(`${fact.field} ${fact.definition?.label ?? fields.get(fact.field.slice(11))?.label ?? ''} ${fact.value ?? ''} ${fact.qualifiers?.map(qualifier => `${qualifier.predicate} ${qualifier.value}`).join(' ') ?? ''}`, words);
  const explicit = new Set([...(query.entityIds ?? []), ...allFacts.filter(fact => query.factIds?.includes(fact.id)).map(fact => fact.entityId),
    ...(media?.associations.filter(link => link.targetType === 'entity' && query.assetIds?.includes(link.assetId)).map(link => link.targetId!) ?? [])]);
  const projected = projectKnowledgeCatalog(catalog, asOf);
  const allowed = new Set(filterEntities(projected, validateCatalogFilters(query.filters ?? [], catalog)).map(entity => entity.id));
  const activeRelationships = catalog.relationships.filter(relation => assertionActive(relation, asOf));
  const relationshipScore = (entityId: string) => Math.max(0, ...activeRelationships
    .filter(relation => relation.fromEntityId === entityId || relation.toEntityId === entityId)
    .map(relation => score(`${relation.kind} ${relation.label} ${relation.inverseLabel ?? ''}`, words)));
  const ranked = catalog.entities.filter(entity => allowed.has(entity.id)).map(entity => ({ entity,
    score: explicit.has(entity.id) ? 100_000 : score(`${entity.name} ${(entity.aliases ?? []).join(' ')} ${entity.kind}`, words) * 10
      + score(entity.summary, words) + relationshipScore(entity.id) + Math.max(0, ...allFacts.filter(fact => fact.entityId === entity.id).map(factScore)) }))
    .filter(item => item.score > 0 || !words.length && !explicit.size).sort((a, b) => b.score - a.score || a.entity.id.localeCompare(b.entity.id));
  const selected = new Set(ranked.slice(0, KNOWLEDGE_LIMITS.entities).map(item => item.entity.id));
  for (let depth = 0; depth < (query.expansion ?? 1) && selected.size < KNOWLEDGE_LIMITS.entities; depth++) {
    const frontier = new Set(selected);
    for (const relation of activeRelationships) {
      if (relation.polarity === 'denied' || relation.qualifiers?.length) continue;
      for (const [from, to] of [[relation.fromEntityId, relation.toEntityId], [relation.toEntityId, relation.fromEntityId]]) if (frontier.has(from) && allowed.has(to) && selected.size < KNOWLEDGE_LIMITS.entities) selected.add(to);
    }
  }
  // Include endpoints needed to explain a directly related exception/denial,
  // without treating that edge as an unconditional path for further traversal.
  if ((query.expansion ?? 1) > 0) {
    const frontier = new Set(selected);
    for (const relation of activeRelationships.filter(relation => relation.polarity === 'denied' || relation.qualifiers?.length)) {
      for (const [from, to] of [[relation.fromEntityId, relation.toEntityId], [relation.toEntityId, relation.fromEntityId]]) if (frontier.has(from) && allowed.has(to) && selected.size < KNOWLEDGE_LIMITS.entities) selected.add(to);
    }
  }
  const requestedFields = query.factIds?.length ? new Set(allFacts.filter(fact => query.factIds!.includes(fact.id)).map(fact => `${fact.entityId}/${fact.field}`)) : null;
  const relevantFacts = allFacts.filter(fact => selected.has(fact.entityId) && (!requestedFields || requestedFields.has(`${fact.entityId}/${fact.field}`)))
    .sort((a, b) => Number(query.factIds?.includes(b.id) ?? false) - Number(query.factIds?.includes(a.id) ?? false) || factScore(b) - factScore(a) || a.id.localeCompare(b.id));
  const facts = relevantFacts.slice(0, KNOWLEDGE_LIMITS.facts).map(fact => ({ ...fact, active: assertionActive(fact, asOf), display: format(fact.value, fact.definition ?? fields.get(fact.field.slice(11))) }));
  const groups = new Map<string, CatalogFact[]>();
  // Evaluate ALL assertions in a returned group before bounding the evidence
  // list; truncation must never conceal a conflicting value.
  for (const fact of relevantFacts) { const key = `${fact.entityId}/${fact.field}`; groups.set(key, [...(groups.get(key) ?? []), fact]); }
  const values = [...groups.values()].filter(group => group.some(fact => facts.some(selected => selected.id === fact.id))).map(group => selectFactValue(group, asOf, fields.get(group[0].field.slice(11))));
  const relations = activeRelationships.filter(relation => selected.has(relation.fromEntityId) && selected.has(relation.toEntityId));
  const links = media?.associations.filter(link => link.targetType === 'entity' && selected.has(link.targetId!) || query.assetIds?.includes(link.assetId)) ?? [];
  const assets = media?.assets.filter(asset => links.some(link => link.assetId === asset.id) || query.intent === 'photos' && !selected.size) ?? [];
  const keptAssets = assets.slice(0, KNOWLEDGE_LIMITS.assets);
  const result = { schemaVersion: 1 as const, revisionId: catalog.id, asOf,
    status: (!selected.size ? 'unresolved' : values.some(value => value.status === 'conflict') || ranked.length > 1 && ranked[0].score === ranked[1].score && words.length > 0 && explicit.size === 0 ? 'ambiguous' : 'resolved') as 'unresolved' | 'ambiguous' | 'resolved',
    reason: selected.size ? 'Only approved publication content; conditions and unknowns must remain visible.' : 'No matching published knowledge.',
    entities: projected.entities.filter(entity => selected.has(entity.id)).map(entity => requestedFields ? { ...entity, attributes: Object.fromEntries(Object.entries(entity.attributes).filter(([field]) => requestedFields.has(`${entity.id}/attributes.${field}`))) } : entity), facts, values, relationships: relations.slice(0, KNOWLEDGE_LIMITS.relationships),
    media: media ? { revisionId: media.id, assets: keptAssets, associations: links.filter(link => keptAssets.some(asset => asset.id === link.assetId)) } : null,
    limits: KNOWLEDGE_LIMITS, omitted: { entities: Math.max(0, ranked.length - selected.size), facts: relevantFacts.length - facts.length, relationships: Math.max(0, relations.length - KNOWLEDGE_LIMITS.relationships), assets: Math.max(0, assets.length - keptAssets.length) } };
  // Fail explicitly rather than leak an unbounded context or return an
  // apparently complete answer after dropping assertions or qualifications.
  if (new TextEncoder().encode(JSON.stringify(result)).length > KNOWLEDGE_LIMITS.bytes) throw new Error('Knowledge context exceeds 32,000 bytes. Narrow the question or references.');
  return result;
}
