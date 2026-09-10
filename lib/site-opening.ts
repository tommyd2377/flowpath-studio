import { defaultPresentation } from '@thevoice/platform-ui/catalog';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { SiteContent } from './site-model';
import { AppError } from './errors';

export const DEFAULT_OPENING: NonNullable<SiteContent['opening']> = { highlights: [], featuredEntityIds: [], capabilityIds: [], tone: 'warm' };

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
    || opening.featuredEntityIds.some(id => !catalog?.entities.some(entity => entity.id === id))
    || opening.capabilityIds.some(id => !catalog?.capabilities?.some(capability => capability.id === id))) {
    throw new AppError('Some opening highlights or links are no longer in this catalog. Update Opening experience in Content before publishing.');
  }
  if (catalog && opening.capabilityIds.length !== (openingPresentation(content, catalog).components.find(item => item.type === 'actions')?.capabilityIds?.length ?? 0)) throw new AppError('These opening links apply to different items. Select compatible links before publishing.');
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
