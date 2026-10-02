import type { WebsiteCompositionSnapshot } from '@thevoice/platform-ui/website-composition';
import type { SiteContent } from './site-model';
import { visitorSettings } from './visitor-model';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);

/** Compact revision fingerprint; reference checks and the host's revision claim retain authority. */
function contentBinding(value: unknown) {
  const text = canonical(value);
  let forward = 2166136261, reverse = 5381;
  for (let index = 0; index < text.length; index++) {
    forward = Math.imul(forward ^ text.charCodeAt(index), 16777619);
    reverse = Math.imul(reverse, 33) ^ text.charCodeAt(text.length - index - 1);
  }
  return `content-v1:${text.length}:${(forward >>> 0).toString(16)}:${(reverse >>> 0).toString(16)}`;
}

/** Public-content revision fingerprint, not a security token. Immutable revisions bind knowledge/media. */
export function websiteCompositionSnapshot(content: SiteContent): WebsiteCompositionSnapshot {
  return {
    contentBinding: contentBinding({ name: content.name, tagline: content.tagline ?? '', headline: content.headline, description: content.description,
      hours: content.hours, contact: content.contact, accent: content.accent, logoAssetId: content.logoAssetId, sections: content.sections,
      welcomeMessage: content.welcomeMessage ?? '', greetingPoints: content.greetingPoints ?? [], visitorSpeaksFirst: content.visitorSpeaksFirst ?? false,
      assistantEnabled: visitorSettings(content).enabled, openingExperience: visitorSettings(content).openingExperience,
      // Publication fills absent opening defaults; normalize them here so publishing does not stale a plan.
      opening: { copyMode: content.opening?.copyMode ?? 'automatic', visibility: content.opening?.visibility ?? 'intro-only',
        highlights: content.opening?.highlights ?? [], featuredEntityIds: content.opening?.featuredEntityIds ?? [],
        initialSections: content.opening?.initialSections ?? [], initialAlbumIds: content.opening?.initialAlbumIds ?? [],
        initialAssetIds: content.opening?.initialAssetIds ?? [], capabilityIds: content.opening?.capabilityIds ?? [], tone: content.opening?.tone ?? 'warm' } }),
    knowledgeRevisionId: content.knowledgeRevisionId ?? null, catalogPublicationId: content.catalogPublicationId ?? null, mediaRevisionId: content.mediaRevisionId ?? null,
  };
}

/** Lightweight freshness check only; the host still validates current section/action/media references. */
export function compositionMatchesContent(content: SiteContent): boolean {
  const plan = content.websiteComposition;
  return !!plan && canonical(plan.snapshot) === canonical(websiteCompositionSnapshot(content))
    && (!content.style || canonical(plan.style) === canonical(content.style));
}
