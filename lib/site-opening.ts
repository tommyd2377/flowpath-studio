import { defaultPresentation } from '@thevoice/platform-ui/catalog';
import { galleryAssetIds, type MediaLibrary } from '@thevoice/platform-ui/media';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { SiteContent } from './site-model';
import { AppError } from './errors';
import { validatePresentation, type SitePresentation } from './site-presentation';

export type OpeningVisibility = 'intro-only' | 'publisher-selected' | 'legacy';
export const DEFAULT_OPENING: NonNullable<SiteContent['opening']> = {
  visibility: 'intro-only', highlights: [], featuredEntityIds: [], initialSections: [], initialAlbumIds: [], initialAssetIds: [], capabilityIds: [], tone: 'warm',
};

/** Missing visibility means a pre-policy snapshot; keep that snapshot's opening intact. */
export function openingVisibility(content: SiteContent): OpeningVisibility {
  return content.opening?.visibility ?? 'legacy';
}

export function publicationContent(content: SiteContent): SiteContent {
  const opening = content.opening ?? DEFAULT_OPENING;
  return { ...content, opening: { ...DEFAULT_OPENING, ...opening, visibility: opening.visibility ?? 'intro-only' } };
}

export function openingCopy(content: SiteContent, catalog?: KnowledgeCatalog | null) {
  if (content.opening?.copyMode === 'personalized') return { headline: content.headline, description: content.description };
  // Compose only from the current snapshot; never generate facts or make a paid call on page load.
  if (catalog) return { headline: catalog.name, description: catalog.description || `Explore ${catalog.entities.length} published items and find what matters to you.` };
  return { headline: `Explore ${content.name}`, description: content.sections.length
    ? `Discover ${content.sections.slice(0, 3).map(section => section.title).join(', ')}. Ask a question or browse at your own pace.`
    : 'Ask a question or browse the information on this site at your own pace.' };
}

export function validateOpening(content: SiteContent, catalog: KnowledgeCatalog | null) {
  const opening = content.opening;
  if (!opening) return;
  if (new Set(opening.featuredEntityIds).size !== opening.featuredEntityIds.length || new Set(opening.capabilityIds).size !== opening.capabilityIds.length
    || new Set(opening.initialSections ?? []).size !== (opening.initialSections ?? []).length
    || new Set(opening.initialAlbumIds ?? []).size !== (opening.initialAlbumIds ?? []).length
    || new Set(opening.initialAssetIds ?? []).size !== (opening.initialAssetIds ?? []).length
    || opening.featuredEntityIds.some(id => !catalog?.entities.some(entity => entity.id === id))
    || opening.capabilityIds.some(id => !catalog?.capabilities?.some(capability => capability.id === id))
    || (opening.initialSections ?? []).some(id => !content.sections.some(section => section.id === id))) {
    throw new AppError('Some opening highlights or links are no longer in this catalog. Update Opening experience in Content before publishing.');
  }
  if (opening.initialAlbumIds?.length || opening.initialAssetIds?.length) {
    // The publish route supplies media separately when a photo selection exists.
    // A second, explicit media check lives in validateOpeningWithMedia below.
    if (!content.mediaRevisionId) throw new AppError('Opening photos require a published photo revision. Update Opening experience in Content before publishing.');
  }
  if (catalog && opening.capabilityIds.length) {
    const selected = new Set(opening.featuredEntityIds);
    const scoped = (catalog.capabilities ?? []).filter(item => opening.capabilityIds.includes(item.id) && item.entityIds.length);
    const compatible = scoped.reduce<string[] | null>((ids, capability) => {
      const allowed = capability.entityIds.filter(id => !selected.size || selected.has(id));
      return ids === null ? allowed : ids.filter(id => allowed.includes(id));
    }, null);
    if (scoped.length && !compatible?.length) throw new AppError('These opening links apply to different items. Select compatible links before publishing.');
  }
}

/** Validate references that live in the immutable media revision. */
export function validateOpeningWithMedia(content: SiteContent, catalog: KnowledgeCatalog | null, media?: MediaLibrary | null) {
  validateOpening(content, catalog);
  const opening = content.opening;
  if (!opening || (!(opening.initialAlbumIds?.length) && !(opening.initialAssetIds?.length))) return;
  if (!media) throw new AppError('Opening photos are not available in the selected media revision. Update Opening experience before publishing.');
  const albumIds = new Set(media.albums.map(album => album.id));
  const assetIds = new Set(media.assets.map(asset => asset.id));
  if ((opening.initialAlbumIds ?? []).some(id => !albumIds.has(id)) || (opening.initialAssetIds ?? []).some(id => !assetIds.has(id))) {
    throw new AppError('Some opening photos or albums are no longer in this media revision. Update Opening experience in Content before publishing.');
  }
}

/** Initial non-catalog sources for the catalog-less compatibility host. */
export function openingInitialSourceIds(content: SiteContent, media?: MediaLibrary | null): string[] {
  if (openingVisibility(content) !== 'publisher-selected') return [];
  const opening = content.opening ?? DEFAULT_OPENING;
  return [
    ...(opening.initialSections ?? []).map(id => `section:${id}`),
    ...(opening.initialAlbumIds ?? []).flatMap(id => media?.albums.some(album => album.id === id) ? [`album:${id}`] : []),
    ...(opening.initialAssetIds ?? []).flatMap(id => media?.assets.some(asset => asset.id === id) ? [`photo:${id}`] : []),
  ];
}

/** Compose only explicitly selected legacy sources for hosts without a catalog. */
export function openingInitialSourcePresentation(content: SiteContent, media?: MediaLibrary | null): SitePresentation | null {
  const sourceIds = openingInitialSourceIds(content, media);
  if (!sourceIds.length) return null;
  const photoIds = sourceIds.filter(id => /^(?:album|photo):/.test(id));
  const textIds = sourceIds.filter(id => !/^(?:album|photo):/.test(id));
  const selected = textIds.length ? textIds : photoIds;
  if (!selected.length) return null;
  try {
    return validatePresentation({ layout: photoIds.length && !textIds.length ? 'gallery' : selected.length === 1 ? 'detail' : 'cards', sources: selected, status: 'ready' }, content, media);
  } catch {
    return null;
  }
}

/** Compose only explicitly selected initial catalog/media references. */
export function openingInitialPresentation(content: SiteContent, catalog: KnowledgeCatalog, media?: MediaLibrary | null): PresentationPlan | null {
  if (openingVisibility(content) !== 'publisher-selected') return null;
  const opening = content.opening ?? DEFAULT_OPENING;
  const featured = opening.featuredEntityIds.filter(id => catalog.entities.some(entity => entity.id === id));
  const selectedAssets = [...(opening.initialAlbumIds ?? []).flatMap(id => media?.albums.find(album => album.id === id)?.assetIds ?? []), ...(opening.initialAssetIds ?? [])];
  const assetIds = media ? galleryAssetIds(media, { assetIds: [...new Set(selectedAssets)] }) : [];
  const components: PresentationPlan['components'] = [];
  if (featured.length) {
    const base = defaultPresentation(catalog);
    const collection = base.components.find(component => component.type === 'collection');
    if (collection) components.push({ ...collection, entityIds: featured });
  }
  if (assetIds.length) components.push({ id: 'gallery', type: 'gallery', variant: 'grid', entityIds: [], attributeIds: [], assetIds });
  const capabilityIds = opening.capabilityIds.filter(id => catalog.capabilities?.some(capability => capability.id === id));
  if (capabilityIds.length) {
    const scoped = (catalog.capabilities ?? []).filter(item => capabilityIds.includes(item.id) && item.entityIds.length);
    const entityIds = scoped.length ? scoped[0].entityIds.filter(id => scoped.every(item => item.entityIds.includes(id)) && (!featured.length || featured.includes(id))) : [];
    if (!scoped.length || entityIds.length || !featured.length) components.push({ id: 'actions', type: 'actions', variant: 'compact', entityIds, attributeIds: [], capabilityIds });
  }
  if (!components.length) return null;
  return validatePlan({ schemaVersion: 1, snapshotId: catalog.id, operation: 'discover', components, transition: { type: 'none' } }, catalog, catalog.id, media);
}

export function openingPresentation(content: SiteContent, catalog: KnowledgeCatalog): PresentationPlan {
  const plan = defaultPresentation(catalog);
  const featured = content.opening?.featuredEntityIds.filter(id => catalog.entities.some(entity => entity.id === id)) ?? [];
  if (featured.length) plan.components = plan.components.map(component => component.type === 'collection' ? { ...component, entityIds: featured } : component);
  let capabilityIds = content.opening?.capabilityIds.filter(id => catalog.capabilities?.some(capability => capability.id === id)) ?? [];
  if (capabilityIds.length) {
    // Entity-scoped destinations remain attached to their declared entities.
    const scoped = (catalog.capabilities ?? []).filter(item => capabilityIds.includes(item.id) && item.entityIds.length);
    const entityIds = scoped.length ? scoped[0].entityIds.filter(id => scoped.every(item => item.entityIds.includes(id))) : [];
    if (scoped.length && !entityIds.length) capabilityIds = capabilityIds.filter(id => !scoped.some(item => item.id === id));
    if (capabilityIds.length) plan.components.push({ id: 'actions', type: 'actions', variant: 'compact', entityIds, attributeIds: [], capabilityIds });
  }
  return validatePlan(plan, catalog, catalog.id);
}
