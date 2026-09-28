import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { WebsiteTemplate } from '@thevoice/platform-ui/site-design';

/** A reviewable layout recommendation, not a factual interpretation or a saved
 * publisher choice. Only semantic structure selects from implemented templates. */
export function recommendWebsiteDesign({ catalog, pageCount, discoveredImageCount }: {
  catalog?: KnowledgeCatalog; pageCount: number; discoveredImageCount: number;
}): { template: WebsiteTemplate; reason: string } {
  const entities = catalog?.entities.filter(entity => !['page', 'source_document'].includes(entity.kind)) ?? [];
  const offers = entities.filter(entity => ['offering', 'product', 'service'].includes(entity.kind));
  const projects = entities.filter(entity => entity.kind === 'project');
  const reading = entities.filter(entity => ['article', 'story', 'guide', 'biography'].includes(entity.kind));
  const known = new Set(entities.map(entity => entity.id));
  const largestCollection = Math.max(0, ...(catalog?.collections.map(collection => new Set(collection.entityIds.filter(id => known.has(id))).size) ?? []));
  if (offers.length >= 6) return {
    template: 'clarity', reason: 'Clarity gives a larger collection clear sections and a compact, scannable rhythm.',
  };
  if (projects.length > 0 && discoveredImageCount >= 2) return {
    template: 'showcase', reason: 'Showcase gives project-led content room for imagery. Discovered photos still need separate review and approval.',
  };
  if (largestCollection >= 8 || entities.length >= 18) return {
    template: 'clarity', reason: 'Clarity gives a larger collection clear sections and a compact, scannable rhythm.',
  };
  if (offers.length > 0 && offers.length >= reading.length) return {
    template: 'clarity', reason: 'Clarity keeps offerings, services and their details easy to find and compare.',
  };
  if (reading.length > 0) return {
    template: 'editorial', reason: 'Editorial gives longer stories and guides a comfortable reading pace.',
  };
  if (discoveredImageCount >= 4 && entities.length >= 2) return {
    template: 'showcase', reason: 'Showcase can support this small collection with imagery. Discovered photos still need separate review and approval.',
  };
  return pageCount > 8
    ? { template: 'clarity', reason: 'Clarity provides a clear starting point for this multi-page source; review the organization after import.' }
    : { template: 'editorial', reason: 'Editorial provides a restrained starting point for this smaller source; all templates remain available in Branding.' };
}
