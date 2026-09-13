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
  for (const collection of catalog?.collections ?? []) {
    const entries = take(collection.entityIds.flatMap(id => authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === id) ?? []));
    if (entries.length) sections.push({ id: `collection-${collection.id}`, title: collection.name, kind: 'collection', entries });
  }
  const remaining = take(authority.records.filter(record => record.reference.kind === 'entity'));
  if (remaining.length) sections.push({ id: 'more', title: sections.some(section => section.kind === 'collection') ? 'More to discover' : 'Explore', kind: 'collection', entries: remaining });
  for (const album of media?.albums ?? []) {
    const entries = take(album.assetIds.flatMap(id => authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === id) ?? []));
    if (entries.length) sections.push({ id: `album-${album.id}`, title: album.title, description: album.description, kind: 'photos', entries });
  }
  const photos = take(authority.records.filter(record => record.reference.kind === 'photo' && record.reference.id !== content.logoAssetId));
  if (photos.length) sections.push({ id: 'photos', title: 'In pictures', kind: 'photos', entries: photos });
  return sections;
}
