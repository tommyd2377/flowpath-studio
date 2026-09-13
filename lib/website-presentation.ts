import type { WebsiteEntry, WebsiteSection } from '@thevoice/platform-ui';
import { referenceKey, type WorkspaceAuthority, type WorkspaceRecord } from '@thevoice/platform-ui/workspace';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { SiteContent } from './site-model';

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
  return { id: referenceKey(record.reference), name: record.name, body: record.body,
    ...(photoId && media?.assets.some(asset => asset.id === photoId) ? { imageAssetId: photoId } : {}),
    example: record.example || link?.role === 'example',
    eyebrow: record.reference.kind === 'fact' ? 'A closer look' : record.reference.kind === 'photo' ? 'Photography' : undefined };
}

/** Presentation deduplication never changes identities, facts, provenance, or publisher data. */
export function websiteSections(authority: WorkspaceAuthority, content: SiteContent, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null): WebsiteSection[] {
  const sections: WebsiteSection[] = [], used = new Set<string>();
  const take = (records: WorkspaceRecord[]) => records.flatMap(record => {
    const group = publishedNameGroup(record, authority, catalog), key = referenceKey(group[0].reference);
    if (used.has(key)) return [];
    group.forEach(item => used.add(referenceKey(item.reference)));
    return [{ ...websiteEntry(group[0], media), ...(group.length > 1 ? { eyebrow: `${group.length} published entries` } : {}) }];
  });
  const sources = authority.records.filter(record => record.reference.kind === 'source' && record.reference.id.startsWith('section:'));
  if (sources.length) sections.push({ id: 'about', title: 'Discover', kind: 'stories', entries: take(sources) });
  // Substantial reading sections lead; named records remain available for requests and search.
  const narratives = (catalog?.entities ?? []).filter(entity => entity.blocks?.some(block => block.text.trim()) && entity.kind !== 'document');
  for (const entity of narratives) {
    const record = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === entity.id);
    if (!record) continue;
    const entries = take([record]).map(entry => ({ ...entry, blocks: entity.blocks }));
    if (entries.length) sections.push({ id: `article-${entity.id}`, title: entity.name, kind: 'stories', entries });
  }
  for (const collection of [...(catalog?.collections ?? [])].sort((a, b) => Number(Boolean(b.parentIds?.length)) - Number(Boolean(a.parentIds?.length)))) {
    const entries = take(collection.entityIds.flatMap(id => authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === id) ?? []));
    if (entries.length && collection.entityIds.every(id => catalog?.entities.find(entity => entity.id === id)?.kind === 'page')) {
      for (const entry of entries) sections.push({ id: `page-${entry.id.replaceAll(':', '-')}`, title: entry.name, kind: 'stories', entries: [entry] });
    } else if (entries.length) sections.push({ id: `collection-${collection.id}`, title: collection.name, kind: 'collection', entries });
  }
  const remaining = take(authority.records.filter(record => record.reference.kind === 'entity' && !catalog?.entities.some(entity => entity.id === record.reference.id && entity.kind === 'document')));
  if (remaining.length) sections.push({ id: 'more', title: sections.some(section => section.kind === 'collection') ? 'More to discover' : 'Explore', kind: 'collection', entries: remaining });
  for (const entity of catalog?.entities.filter(entity => entity.kind === 'document') ?? []) {
    const record = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === entity.id);
    if (!record) continue;
    const entries = take([record]);
    if (entries.length) sections.push({ id: `document-${entity.id}`, title: 'Read the document', kind: 'collection', entries });
  }
  for (const album of media?.albums ?? []) {
    const entries = take(album.assetIds.filter(id => id !== content.logoAssetId).flatMap(id => authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === id) ?? []));
    if (entries.length) sections.push({ id: `album-${album.id}`, title: album.title, description: album.description, kind: 'photos', entries });
  }
  const photos = take(authority.records.filter(record => record.reference.kind === 'photo' && record.reference.id !== content.logoAssetId));
  if (photos.length) sections.push({ id: 'photos', title: 'In pictures', kind: 'photos', entries: photos });
  // Spread reviewed site photography through the page without inventing entity associations.
  const contentSections = sections.filter(section => section.kind !== 'photos');
  const photoSections = sections.filter(section => section.kind === 'photos');
  if (contentSections.length < 2 || !media) return sections;
  const heroId = media.associations.find(link => link.targetType === 'site' && link.primary)?.assetId ?? content.opening?.initialAssetIds?.[0]
    ?? media.albums.flatMap(album => album.assetIds).find(id => id !== content.logoAssetId) ?? media.assets.find(asset => asset.id !== content.logoAssetId)?.id;
  const placed = new Set(contentSections.flatMap(section => section.entries.flatMap(entry => entry.imageAssetId ? [entry.imageAssetId] : [])));
  const eligible = new Set(media.associations.filter(link => link.targetType === 'site').map(link => link.assetId));
  const distributed = new Set<string>();
  const result: WebsiteSection[] = [];
  let strips = 0;
  for (const [index, section] of contentSections.entries()) {
    result.push(section);
    if (index % 2 !== 0 || index === contentSections.length - 1 || strips >= 3) continue;
    const album = photoSections.find(section => section.entries.some(entry => entry.imageAssetId && eligible.has(entry.imageAssetId)
      && !placed.has(entry.imageAssetId) && entry.imageAssetId !== heroId && entry.imageAssetId !== content.logoAssetId && !distributed.has(entry.id)));
    const entries = album?.entries.filter(entry => entry.imageAssetId && eligible.has(entry.imageAssetId) && !placed.has(entry.imageAssetId)
      && entry.imageAssetId !== heroId && entry.imageAssetId !== content.logoAssetId && !distributed.has(entry.id)).slice(0, 4);
    if (!album || !entries?.length) continue;
    entries.forEach(entry => distributed.add(entry.id));
    result.push({ ...album, id: `${album.id}-highlights-${strips++}`, navigation: false, entries });
  }
  for (const section of photoSections) {
    const entries = section.entries.filter(entry => !distributed.has(entry.id));
    if (entries.length) result.push({ ...section, entries });
  }
  return result;
}
