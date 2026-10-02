import { z } from 'zod';
import type { WebsiteSection } from '@thevoice/platform-ui';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { siteDesignSchema, WEBSITE_TEMPLATES, type SiteDesign, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import { WEBSITE_COMPOSITION_MAX_BINDING, WEBSITE_COMPOSITION_MAX_SECTIONS, websiteCompositionPlanSchema,
  type WebsiteCompositionAction, type WebsiteCompositionPlan, type WebsiteCompositionSnapshot } from '@thevoice/platform-ui/website-composition';
import type { SiteContent } from './site-model';
import { visitorSettings } from './visitor-model';
import { publishedWorkspace } from './visitor-workspace';
import { websiteHeroId, websiteSections } from './website-presentation';
import { compositionMatchesContent, websiteCompositionSnapshot } from './website-composition-snapshot';

export { compositionMatchesContent, websiteCompositionSnapshot } from './website-composition-snapshot';

const canonical = (value: unknown): string => JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child);
const styleRegistry = () => z.toJSONSchema(siteDesignSchema);
function invalid(message: string): never { throw new z.ZodError([{ code: 'custom', path: [], message }]); }

export type WebsiteCompositionManifest = {
  snapshot: WebsiteCompositionSnapshot;
  identity: { name: string; headline: string; description: string };
  style: SiteDesign | null;
  styleRegistry: ReturnType<typeof styleRegistry>;
  sections: Array<{ id: string; title: string; kind: WebsiteSection['kind']; navigation: boolean; labels: string[]; entryCount: number;
    sampleEntries: Array<{ id: string; name: string; text: string }>; omittedEntries: number; omittedTextCharacters: number }>;
  actions: WebsiteCompositionAction[];
  eligibleHeroAssets: Array<{ id: string; width: number; height: number; caption: string; alt: string; credit?: string; example: boolean }>;
  preferredHeroAssetId: string | null;
  guidance: string[];
};

function shortLabel(section: Pick<WebsiteSection, 'id' | 'title'> & Partial<Pick<WebsiteSection, 'entries'>>) {
  const labels: Record<string, string> = { introduction: 'About', offerings: 'Explore', stories: 'Stories', information: 'Information', questions: 'Questions', documents: 'Documents' };
  if (labels[section.id]) return labels[section.id];
  // A shared, reviewed record kind supports a concise destination name without new claims.
  if (section.entries?.length && section.entries.every(entry => entry.kind === 'service')) return 'Services';
  if (section.entries?.length && section.entries.every(entry => entry.kind === 'project')) return 'Work';
  const title = section.title.replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
  if (title.length <= 32) return title || 'Explore';
  const start = title.slice(0, 31), boundary = start.lastIndexOf(' ');
  return `${boundary >= 16 ? start.slice(0, boundary) : start}…`;
}

/** Only reviewed site/opening selections authorize a decorative hero. Album membership alone does not. */
export function eligibleWebsiteHeroAssets(content: SiteContent, media?: MediaLibrary | null) {
  const permitted = new Set([...(content.opening?.initialAssetIds ?? []), ...(media?.associations.filter(link => link.targetType === 'site').map(link => link.assetId) ?? [])]);
  return (media?.assets ?? []).filter(asset => asset.id !== content.logoAssetId && permitted.has(asset.id)).map(asset => ({ ...asset,
    example: !!media?.associations.some(link => link.assetId === asset.id && link.role === 'example') }));
}

/** Build from approved canonical sections; optional extra sections must be supplied consistently at review/apply/render. */
export function buildWebsiteCompositionManifest(content: SiteContent, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null, extraSections: WebsiteSection[] = []): WebsiteCompositionManifest {
  const sections = [...websiteSections(publishedWorkspace(content, catalog, media), content, catalog, media), ...extraSections];
  const snapshot = websiteCompositionSnapshot(content), eligibleHeroAssets = eligibleWebsiteHeroAssets(content, media);
  const actions: WebsiteCompositionAction[] = sections.map(section => {
    const label = shortLabel(section);
    return { actionId: `section:${section.id}`, kind: 'section', sectionId: section.id, labels: [label, `View ${label}`] };
  });
  if (content.contact.trim()) actions.push({ actionId: 'contact', kind: 'contact', labels: ['Contact', 'Get in touch'] });
  if (visitorSettings(content).enabled) actions.push({ actionId: 'assistant', kind: 'assistant', labels: ['Ask a question'] });
  const guidance: string[] = [];
  if (sections.length > WEBSITE_COMPOSITION_MAX_SECTIONS) guidance.push(`This website has ${sections.length} sections, above the ${WEBSITE_COMPOSITION_MAX_SECTIONS}-section planning limit. Keep the current website; no sections have been omitted.`);
  if (snapshot.contentBinding.length > WEBSITE_COMPOSITION_MAX_BINDING) guidance.push('The approved content exceeds the composition binding limit. Keep the current website; no content has been omitted.');
  if (new Set(sections.map(section => section.id)).size !== sections.length) guidance.push('Some sections have duplicate identifiers. Keep the current website until the references are corrected.');
  return { snapshot, identity: { name: content.name, headline: content.headline, description: content.description }, style: content.style ? structuredClone(content.style) : null,
    styleRegistry: styleRegistry(), actions, eligibleHeroAssets, preferredHeroAssetId: websiteHeroId(content, media) ?? null, guidance,
    sections: sections.map(section => {
      const sample = section.entries.slice(0, 2);
      const textFor = (entry: WebsiteSection['entries'][number]) => entry.body || entry.blocks?.map(block => block.text).join('\n') || '';
      return { id: section.id, title: section.title, kind: section.kind, navigation: section.navigation !== false && !!(section.entries.length || section.total), labels: [shortLabel(section)],
        entryCount: section.total ?? section.entries.length, sampleEntries: sample.map(entry => ({ id: entry.id, name: entry.name, text: textFor(entry).slice(0, 320) })),
        omittedEntries: Math.max(0, (section.total ?? section.entries.length) - sample.length), omittedTextCharacters: sample.reduce((total, entry) => total + Math.max(0, textFor(entry).length - 320), 0) };
    }) };
}

/** Strict schema, snapshot, style, navigation and host-action checks for any planner output. */
export function validateWebsiteCompositionPlan(input: unknown, manifest: WebsiteCompositionManifest): WebsiteCompositionPlan {
  if (manifest.guidance.length) invalid(manifest.guidance.join(' '));
  const plan = websiteCompositionPlanSchema.parse(input);
  if (canonical(plan.snapshot) !== canonical(manifest.snapshot)) invalid('This composition is stale. Generate a new proposal for the current content and revisions.');
  if (manifest.style && canonical(plan.style) !== canonical(manifest.style)) invalid('This composition changes saved publisher styling. Keep the existing style or review a separate styling change.');
  const ids = new Set(manifest.sections.map(section => section.id));
  if (plan.sectionOrder.length !== ids.size || new Set(plan.sectionOrder).size !== plan.sectionOrder.length || plan.sectionOrder.some(id => !ids.has(id))) invalid('The composition must keep every approved section exactly once.');
  const navigation = manifest.sections.filter(section => section.navigation);
  if (plan.navigation.length !== navigation.length || new Set(plan.navigation.map(item => item.sectionId)).size !== plan.navigation.length
    || plan.navigation.some(item => !navigation.some(section => section.id === item.sectionId && section.labels.includes(item.label)))) invalid('Navigation must retain every eligible destination and use its approved short label.');
  if (plan.primaryAction && !manifest.actions.some(action => action.actionId === plan.primaryAction!.actionId && action.labels.includes(plan.primaryAction!.label))) invalid('Choose a primary action and destination label from the approved action registry.');
  if (plan.heroAssetId && !manifest.eligibleHeroAssets.some(asset => asset.id === plan.heroAssetId)) invalid('The hero must be a reviewed opening photo, not a logo, source image or unrelated album photo.');
  return plan;
}

/** Offline proposal: content stays unchanged, and explicit publisher styling always wins. */
export function proposeWebsiteComposition(manifest: WebsiteCompositionManifest): WebsiteCompositionPlan {
  if (manifest.guidance.length) invalid(manifest.guidance.join(' '));
  const hero = manifest.eligibleHeroAssets.find(asset => asset.id === manifest.preferredHeroAssetId)
    ?? manifest.eligibleHeroAssets.find(asset => asset.width >= 1200 && asset.height >= 600 && asset.width / asset.height <= 3);
  const collection = manifest.sections.some(section => section.kind === 'collection'), reading = manifest.sections.some(section => section.kind === 'stories');
  const template: WebsiteTemplate = hero && manifest.sections.some(section => section.kind === 'photos') ? 'showcase' : !collection && reading ? 'editorial' : 'clarity';
  const style = manifest.style ?? { ...WEBSITE_TEMPLATES[template].defaults };
  const rank = (section: WebsiteCompositionManifest['sections'][number]) => section.kind === 'collection' && section.id !== 'documents' ? 0 : section.kind === 'photos' ? 1 : section.kind === 'stories' ? 2 : section.kind === 'information' ? 3 : section.kind === 'faq' ? 4 : 5;
  const ordered = manifest.sections.map((section, index) => ({ section, index })).sort((a, b) => rank(a.section) - rank(b.section) || a.index - b.index).map(item => item.section);
  const primary = manifest.actions.find(action => action.sectionId === ordered[0]?.id) ?? manifest.actions.find(action => action.kind === 'contact') ?? manifest.actions.find(action => action.kind === 'assistant');
  const reviewNotes = [manifest.style ? 'Your saved template, colors, typography, spacing, motion and opening choice are preserved.'
    : template === 'showcase' ? 'Showcase gives reviewed opening photography and visual collections a clear lead.' : template === 'editorial' ? 'Editorial gives the approved stories room for sustained reading.' : 'Clarity gives visitors a direct path to the available collections and information.',
  ordered[0] ? `Start with “${ordered[0].title.slice(0, 160)}”; keep every section, record and qualification available.` : 'No content sections are available yet. The existing contact or assistant destination remains available.'];
  if (hero) reviewNotes.push('The opening photo was selected from reviewed media. Check the preview for visual fit and crop; dimensions and labels cannot establish image quality or subject identity.');
  else reviewNotes.push('No suitable reviewed opening image was selected. The introduction remains readable without a decorative photo.');
  return validateWebsiteCompositionPlan({ version: 1, snapshot: manifest.snapshot, style, sectionOrder: ordered.map(section => section.id),
    navigation: ordered.filter(section => section.navigation).map(section => ({ sectionId: section.id, label: section.labels[0] })),
    primaryAction: primary ? { actionId: primary.actionId, label: primary.labels[0] } : null, heroAssetId: hero?.id ?? null, reviewNotes }, manifest);
}

/** Missing, rejected and stale saved plans retain the existing useful composition. */
export function resolveWebsiteComposition(content: SiteContent, catalog?: KnowledgeCatalog | null, media?: MediaLibrary | null, extraSections: WebsiteSection[] = []): WebsiteCompositionPlan | null {
  const input = content.websiteComposition;
  if (!input || !compositionMatchesContent(content)) return null;
  try { return validateWebsiteCompositionPlan(input, buildWebsiteCompositionManifest(content, catalog, media, extraSections)); } catch { return null; }
}

/** Never edit entry objects, facts, qualifications or headings. A mismatch keeps all original sections. */
export function applyWebsiteCompositionSections(sections: WebsiteSection[], plan: WebsiteCompositionPlan | null): Array<WebsiteSection & { navLabel?: string }> {
  if (!plan || plan.sectionOrder.length !== sections.length || new Set(plan.sectionOrder).size !== sections.length
    || plan.sectionOrder.some(id => !sections.some(section => section.id === id))) return sections;
  const labels = new Map(plan.navigation.map(item => [item.sectionId, item.label]));
  const byId = new Map(sections.map(section => [section.id, section]));
  return plan.sectionOrder.map(id => ({ ...byId.get(id)!, ...(labels.has(id) ? { navLabel: labels.get(id) } : {}) }));
}
