import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import { hashValue, resolveKnowledgeUpdates, type KnowledgeArtifact } from './knowledge-model';
import { validateSourceProvenance, type SourceProvenance } from './source-provenance';

/** Reserved source-container kinds in connected website interpretation, not business entities. */
export function isWebsiteSourceRecord(kind: string) {
  return ['page', 'webpage', 'web_page', 'website_page', 'source_page', 'source_document', 'crawl_report', 'import_report']
    .includes(kind.trim().toLowerCase().replace(/[\s-]+/g, '_'));
}

/** Enforce the source/visitor boundary before merge, including graph and evidence references. */
export function websiteVisitorCatalog(catalog: KnowledgeCatalog, provenance: SourceProvenance) {
  const entities = catalog.entities.filter(entity => !isWebsiteSourceRecord(entity.kind));
  if (!entities.length) throw new AppError('The website interpretation returned only source pages, without usable visitor content. Nothing was applied. Review the source or start a new interpretation.', 502);
  const ids = new Set(entities.map(entity => entity.id));
  const collections = catalog.collections.map(collection => ({ ...collection, entityIds: collection.entityIds.filter(id => ids.has(id)) }));
  // Empty parents still organize populated child collections; empty source-only branches do not.
  const keptCollections = new Set(collections.filter(collection => collection.entityIds.length).map(collection => collection.id));
  for (let pass = 0; pass < collections.length; pass++) for (const collection of collections) {
    if (keptCollections.has(collection.id)) collection.parentIds?.forEach(id => keptCollections.add(id));
  }
  const result = validateCatalog({ ...catalog, entities,
    collections: collections.filter(collection => keptCollections.has(collection.id)),
    relationships: catalog.relationships.filter(relation => ids.has(relation.fromEntityId) && ids.has(relation.toEntityId)),
    facts: catalog.facts?.filter(fact => ids.has(fact.entityId)),
    capabilities: catalog.capabilities?.filter(capability => !capability.entityIds.length || capability.entityIds.some(id => ids.has(id)))
      .map(capability => ({ ...capability, entityIds: capability.entityIds.filter(id => ids.has(id)) })),
  });
  return { catalog: result, provenance: validateSourceProvenance({ ...provenance,
    fields: provenance.fields.filter(field => ids.has(field.entityId)),
    facts: provenance.facts?.filter(reference => result.facts?.some(fact => fact.id === reference.targetId)),
    relationships: provenance.relationships?.filter(reference => result.relationships.some(relation => relation.id === reference.targetId)),
  }, result), removed: catalog.entities.length - entities.length };
}

export function unchangedWebsiteSourceCopies(current: KnowledgeArtifact | null, sourceName: string) {
  const origin = current?.origins.find(origin => origin.name === sourceName || origin.key === sourceName);
  const graphFor = (catalog: KnowledgeCatalog, id: string) => ({
    facts: catalog.facts?.filter(fact => fact.entityId === id) ?? [],
    relationships: catalog.relationships.filter(relation => relation.fromEntityId === id || relation.toEntityId === id),
  });
  return new Set(origin?.baseline.entities.filter(entity => isWebsiteSourceRecord(entity.kind)
    && current?.catalog.entities.some(saved => saved.id === entity.id && hashValue(saved) === hashValue(entity))
    && hashValue(graphFor(current.catalog, entity.id)) === hashValue(graphFor(origin.baseline, entity.id))).map(entity => entity.id));
}

/** Reimports retire unchanged legacy source copies in the proposal, retaining edits and Undo history. */
export function retireWebsiteSourceCopies(artifact: KnowledgeArtifact, current: KnowledgeArtifact | null, sourceName: string) {
  const removable = unchangedWebsiteSourceCopies(current, sourceName);
  const decisions = (artifact.updates ?? []).filter(update => update.kind === 'missing' && removable.has(update.entityId))
    .map(update => ({ id: update.id, choice: 'incoming' as const }));
  if (!decisions.length) return artifact;
  const result = resolveKnowledgeUpdates(artifact, decisions);
  result.notes.push(`${decisions.length} unchanged source-page copies retired from this proposal. Publisher-edited content was retained; source captures stay private.`);
  return result;
}

/** Versioned brief appended only to website interpretation; ordinary document readers stay unchanged. */
export const WEBSITE_CONTENT_BRIEF = `# Website content brief v2
Goal: turn the supplied business website into useful, editable FlowPath content for a visitor deciding what the business offers, why it fits, and how to contact it.
Organize around visitor needs, not the crawl's URL list. Return a small set of substantive article topics plus distinct offerings, people and places. Use one canonical entity per offering, with cross-listing in collections. Keep prices, sizes, qualifications, policies and substantive long-form information available in blocks and typed facts.
Source pages and crawl bookkeeping are private evidence. Do not emit page, webpage, source_page, source_document, website_page, import_report or crawl_report entities. Do not append a full-source reader to a website. Exclude repeated navigation, cookie notices, form controls and submission feedback, and copied source-page text already represented by topic content. Preserve substantive contact details, policies and qualifications wherever they appear, including headers and footers.
Keep each price, schedule or offering qualification beside the claim it limits. Preserve source conflicts and distinct location, size, unit or payment variants; never turn an empty-cart total or form placeholder into an offering. Missing years and extraction uncertainty stay explicit; do not infer current availability from dated or undated copy.
Example: Home, About, Services, and two URL aliases for Services should become business identity, a story article and distinct services, not five copied pages plus the services.
Use the publisher's supplied wording and identity. Unknown details stay unknown. Photos are placed separately by the controlled renderer using reviewed image references; never invent image URLs or infer depicted identity.
Success: useful content is retained once, source containers are absent, collections have clear visitor-facing labels, and every supplied evidence reference remains valid. The result is a proposal for review, not publication.`;
