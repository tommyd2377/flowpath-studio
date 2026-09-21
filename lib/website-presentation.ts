import type { WebsiteEntry, WebsiteSection } from '@thevoice/platform-ui';
import { websiteValueRole } from '@thevoice/platform-ui/site-design';
import { referenceKey, type WorkspaceAuthority, type WorkspaceRecord } from '@thevoice/platform-ui/workspace';
import type { CatalogFact, KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { SiteContent } from './site-model';
import { knowledgeFacts, selectFactValue, formatKnowledgeValue } from '@thevoice/platform-ui/knowledge';
import { knowledgeValueText } from './knowledge-display';

const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
/** Group names for navigation, without asserting that their source records are one identity. */
export function publishedNameGroup(record: WorkspaceRecord, authority: WorkspaceAuthority, catalog?: KnowledgeCatalog | null) {
  if (record.reference.kind !== 'entity' || !catalog) return [record];
  const matches = authority.records.filter(item => item.reference.kind === 'entity' && normalized(item.name) === normalized(record.name));
  return matches.length <= 12 ? matches : [record];
}

export function websiteEntry(record: WorkspaceRecord, media?: MediaLibrary | null): WebsiteEntry {
  const link = media?.associations.filter(link => record.reference.kind === 'entity' ? link.targetType === 'entity' && link.targetId === record.reference.id
    : record.reference.kind === 'source' && record.reference.id.startsWith('section:') && link.targetType === 'section' && link.targetId === record.reference.id.slice(8))
    .sort((a, b) => Number(b.primary) - Number(a.primary))[0];
  const photoId = record.reference.kind === 'photo' ? record.reference.id : link?.assetId;
  const asset = media?.assets.find(asset => asset.id === photoId);
  return { id: referenceKey(record.reference), name: record.name, body: record.body,
    ...(asset ? { caption: asset.caption, credit: asset.credit } : {}),
    ...(photoId && media?.assets.some(asset => asset.id === photoId) ? { imageAssetId: photoId } : {}),
    example: record.example || link?.role === 'example',
    eyebrow: record.reference.kind === 'fact' ? 'A closer look' : record.reference.kind === 'photo' ? 'Photography' : undefined };
}

/** Presentation deduplication never changes identities, facts, provenance, or publisher data. */
export function websiteSections(authority: WorkspaceAuthority, content: SiteContent, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null): WebsiteSection[] {
  return composeWebsiteSections(authority, content, catalog, media);
}

/** A deliberate site/initial selection is required for decorative opening media. */
export function websiteHeroId(content: SiteContent, media?: MediaLibrary | null) {
  const id = media?.associations.find(link => link.targetType === 'site' && link.primary)?.assetId ?? content.opening?.initialAssetIds?.[0];
  return id && id !== content.logoAssetId && media?.assets.some(asset => asset.id === id) ? id : undefined;
}

export function detailedWebsiteEntry(record: WorkspaceRecord, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null, context?: { facts: CatalogFact[]; asOf: string }): WebsiteEntry {
  const entry = websiteEntry(record, media);
  const entity = record.reference.kind === 'entity' ? catalog?.entities.find(entity => entity.id === record.reference.id) : undefined;
  if (!entity || !catalog) return entry;
  // Full page details are not subject to the assistant's bounded context window.
  // Both surfaces use the same fact selection and qualification rules.
  const facts = (context?.facts ?? knowledgeFacts(catalog)).filter(fact => fact.entityId === entity.id).map(fact => ({ ...fact, display: formatKnowledgeValue(fact.value, fact.definition ?? catalog.attributes.find(attribute => `attributes.${attribute.id}` === fact.field)) }));
  const groups = new Map<string, typeof facts>();
  for (const fact of facts) groups.set(fact.field, [...(groups.get(fact.field) ?? []), fact]);
  const asOf = context?.asOf ?? new Date().toISOString();
  const values = [...groups.values()].map(group => selectFactValue(group, asOf, catalog.attributes.find(attribute => `attributes.${attribute.id}` === group[0].field))).filter(value => !['name', 'summary'].includes(value.field)).map(value => {
    const definition = catalog.facts?.find(fact => value.factIds.includes(fact.id))?.definition ?? catalog.attributes.find(attribute => `attributes.${attribute.id}` === value.field);
    const label = definition?.label ?? value.field.replace(/^properties\./, '').replaceAll('-', ' ');
    return { label, text: knowledgeValueText(value, facts), role: websiteValueRole({ label, aliases: definition?.aliases }) };
  });
  return { ...entry, kind: entity.kind, blocks: entity.blocks, values };
}

/** Presentation groups exact references; names never establish identity or erase variants. */
export function composeWebsiteSections(authority: WorkspaceAuthority, content: SiteContent, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null): WebsiteSection[] {
  const sections: WebsiteSection[] = [], used = new Set<string>();
  const records = new Map(authority.records.map(record => [referenceKey(record.reference), record]));
  const entityRecords = new Map(authority.records.filter(record => record.reference.kind === 'entity').map(record => [record.reference.id, record]));
  const context = { facts: catalog ? knowledgeFacts(catalog) : [], asOf: new Date().toISOString() };
  const entryFor = (id: string) => {
    const record = entityRecords.get(id);
    return record ? detailedWebsiteEntry(record, catalog, media, context) : undefined;
  };
  const add = (id: string, title: string, kind: WebsiteSection['kind'], entries: WebsiteEntry[], parentTitle?: string) => {
    const unique = entries.filter(entry => !used.has(entry.id));
    unique.forEach(entry => used.add(entry.id));
    if (unique.length) sections.push({ id, title, kind, entries: unique, ...(parentTitle ? { parentTitle } : {}) });
  };
  const practical = /^(?:policy|policies|contact|location|hours|practical|information)$/i;
  const faq = /^(?:faq|question)$/i;
  const bookkeeping = /^(?:source_document|document|crawl|source)$/i;
  const narrative = /^(?:article|page|story|guide|topic|section|organization|person)$/i;
  const entities = catalog?.entities.filter(entity => !bookkeeping.test(entity.kind)) ?? [];
  const entries = (list: typeof entities) => list.flatMap(entity => entryFor(entity.id) ?? []);
  const manual = content.sections.flatMap(section => [...records.values()].find(record => record.reference.kind === 'source' && record.reference.id === `section:${section.id}`) ?? []);
  add('introduction', content.sections.length === 1 ? content.sections[0].title : 'About', 'stories', manual.filter(record => !/\?$/.test(record.name)).map(record => websiteEntry(record, media)));
  // Specific child collections lead, while a broad source-generated "All items" group is omitted.
  for (const collection of [...(catalog?.collections ?? [])].sort((a, b) => Number(Boolean(b.parentIds?.length)) - Number(Boolean(a.parentIds?.length)))) {
    if (/^all (?:items|records|content)$/i.test(collection.name)) continue;
    const members = entities.filter(entity => collection.entityIds.includes(entity.id) && !narrative.test(entity.kind) && !practical.test(entity.kind) && !faq.test(entity.kind));
    const parent = collection.parentIds?.map(id => catalog?.collections.find(item => item.id === id)?.name).filter(Boolean).join(' / ');
    add(`collection-${collection.id}`, collection.name, 'collection', entries(members), parent);
  }
  add('offerings', 'Explore', 'collection', entries(entities.filter(entity => !narrative.test(entity.kind) && !practical.test(entity.kind) && !faq.test(entity.kind))));
  add('stories', 'Discover more', 'stories', entries(entities.filter(entity => narrative.test(entity.kind))));
  add('information', 'Useful information', 'information', entries(entities.filter(entity => practical.test(entity.kind))));
  add('questions', 'Questions & answers', 'faq', [...entries(entities.filter(entity => faq.test(entity.kind))), ...manual.filter(record => /\?$/.test(record.name)).map(record => websiteEntry(record, media))]);
  // Existing reviewed PDF readers remain reachable. Private source captures are
  // never in this published authority and are not introduced by this renderer.
  add('documents', 'Read the document', 'collection', entries(catalog?.entities.filter(entity => entity.kind === 'document') ?? []));
  // Uploaded OCR originals are evidence. Only reviewed albums/associations create visual sections.
  for (const album of media?.albums ?? []) {
    add(`album-${album.id}`, album.title, 'photos', album.assetIds.filter(id => id !== content.logoAssetId).flatMap(id => authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === id) ?? []).map(record => websiteEntry(record, media)));
  }
  return sections;
}
