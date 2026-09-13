import { z } from 'zod';
import type { WorkspaceState } from '@thevoice/platform-ui/workspace';
import { externalItemLabel } from '@thevoice/platform-ui/workspace';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export function publicWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && host.includes('.') && !host.endsWith('.') && !/^[\d.]+$/.test(host) && !host.includes(':')
      && !/(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host);
  } catch { return false; }
}
const url = z.string().max(2048).refine(publicWebUrl, 'Use a public HTTPS URL.');
export const exploreSettingsSchema = z.object({
  enabled: z.boolean(), images: z.boolean(), maps: z.boolean(),
  annotations: z.boolean().optional(),
  dailyLimit: z.number().int().min(1).max(100),
  allowedDomains: z.array(z.string().trim().toLowerCase().max(253).refine(value =>
    /^[a-z0-9.-]+$/.test(value) && !value.startsWith('.') && !value.endsWith('.') && publicWebUrl(`https://${value}`), 'Enter domains only, such as wikipedia.org.')).max(8),
}).strict();
export type ExploreSettings = z.infer<typeof exploreSettingsSchema>;
export const DEFAULT_EXPLORE_SETTINGS: ExploreSettings = { enabled: false, images: true, maps: true, annotations: false, dailyLimit: 10, allowedDomains: [] };
export function exploreSettings(content: { explore?: ExploreSettings }): ExploreSettings { return content.explore ?? DEFAULT_EXPLORE_SETTINGS; }
export function allowedSource(value: string, settings: ExploreSettings) {
  if (!publicWebUrl(value)) return false;
  const host = new URL(value).hostname;
  return !settings.allowedDomains.length || settings.allowedDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
}
export const exploreKindSchema = z.enum(['web', 'images', 'map']);
export type ExploreKind = z.infer<typeof exploreKindSchema>;
export const exploreMapSchema = z.object({
  label: z.string().trim().min(1).max(160), latitude: z.number().finite().min(-80).max(80),
  longitude: z.number().finite().min(-180).max(180), zoom: z.number().int().min(2).max(12),
}).strict();
export type ExploreMap = z.infer<typeof exploreMapSchema>;
const sourceSchema = z.object({ url, title: z.string().max(300) }).strict();
const citationSchema = sourceSchema.extend({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
const imageUrl = z.string().max(2048).refine(value => publicWebUrl(value) || value === '/explore-demo.svg');
const workspaceId = z.string().regex(/^[A-Za-z0-9_:-]{1,100}$/);
export const annotationTargetSchema = z.object({ publicationId: workspaceId, instanceId: workspaceId,
  reference: z.object({ kind: z.enum(['entity', 'source', 'fact']), id: workspaceId, revisionId: workspaceId }).strict(),
}).strict();
export type AnnotationTarget = z.infer<typeof annotationTargetSchema>;
export function annotationTargetForObject(state: WorkspaceState, instanceId: string): AnnotationTarget | undefined {
  const object = state.objects.find(object => object.instanceId === instanceId);
  if (!object || object.references.length !== 1 || !['detail', 'information'].includes(object.component)) return;
  const parsed = annotationTargetSchema.safeParse({ publicationId: state.publicationId, instanceId, reference: object.references[0] });
  return parsed.success ? parsed.data : undefined;
}
export function annotationMatches(target: AnnotationTarget, state: WorkspaceState) {
  const current = annotationTargetForObject(state, target.instanceId);
  return !!current && current.publicationId === target.publicationId && current.reference.kind === target.reference.kind
    && current.reference.id === target.reference.id && current.reference.revisionId === target.reference.revisionId;
}
export const exploreResultSchema = z.object({
  id, kind: exploreKindSchema, query: z.string().max(2000), fetchedAt: z.iso.datetime(), demo: z.boolean(),
  answer: z.string().max(12000), sources: z.array(sourceSchema).max(20), citations: z.array(citationSchema).max(40),
  images: z.array(z.object({ id, url: imageUrl, thumbnail: imageUrl, sourceUrl: url, caption: z.string().max(500) }).strict()).max(24),
  map: exploreMapSchema.nullable(),
  annotationTarget: annotationTargetSchema.optional(),
}).strict().superRefine((result, context) => {
  if (result.annotationTarget && result.kind !== 'web' || new Set(result.images.map(image => image.id)).size !== result.images.length
    || result.citations.some(c => c.end <= c.start || c.end > result.answer.length)
    || !result.demo && result.images.some(image => image.url.startsWith('/') || image.thumbnail.startsWith('/'))) {
    context.addIssue({ code: 'custom', message: 'Invalid search result references.' });
  }
});
export type ExploreResult = z.infer<typeof exploreResultSchema>;
// Browser observations contain no arbitrary URLs or external content to promote into facts.
export const exploreContextSchema = z.object({
  query: z.string().max(600).optional(),
  resultId: id, kind: exploreKindSchema, images: z.array(z.object({ id, caption: z.string().max(500) }).strict()).max(24),
  selectedImageId: id.nullable(), map: exploreMapSchema.nullable(),
  sources: z.array(z.object({ id, title: z.string().max(300) }).strict()).max(20).optional(),
  selectedSourceId: id.nullable().optional(),
  annotationTarget: annotationTargetSchema.optional(),
}).strict();
export type ExploreContext = z.infer<typeof exploreContextSchema>;
export const exploreCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['open_image', 'open_source']), id }).strict(),
  z.object({ kind: z.enum(['back', 'images', 'web', 'zoom_in', 'zoom_out']) }).strict(),
]);
export type ExploreCommand = z.infer<typeof exploreCommandSchema>;
export const exploreRequestSchema = z.object({ requestId: z.string().uuid(), query: z.string().trim().min(1).max(2000), kind: exploreKindSchema, annotationTarget: annotationTargetSchema.optional() }).strict();
export function mapForQuery(query: string): ExploreMap | null {
  const subject = query.trim().replace(/^(?:show(?: me)? |open |get )?(?:a |the )?map(?: of)? (?:the )?/i, '').replace(/[!?]$/, '').trim();
  if (/^(?:united states|usa|US|u\.s\.(?:a\.)?)$/i.test(subject)) return { label: 'United States overview', latitude: 39, longitude: -98, zoom: 3 };
  if (/^(?:world|earth|globe)$/i.test(subject)) return { label: 'World overview', latitude: 15, longitude: 0, zoom: 2 };
  return null;
}
export function mapEmbedUrl(map: ExploreMap) {
  const value = exploreMapSchema.parse(map);
  const span = 360 / 2 ** (value.zoom - 1);
  const bounds = [Math.max(-180, value.longitude - span), Math.max(-85, value.latitude - span / 2), Math.min(180, value.longitude + span), Math.min(85, value.latitude + span / 2)];
  return `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: bounds.join(','), layer: 'mapnik' })}`;
}
export function localExploreCommand(text: string, context: ExploreContext | undefined): ExploreCommand | null {
  if (!context) return null;
  if (/^(?:go |take me )?back[.!]?$/i.test(text) || /^(?:close|dismiss)(?: (?:the |that )?(?:photo|image|viewer))?[.!]?$/i.test(text)) return { kind: 'back' };
  if (/^(?:show(?: me)? |go back to )?(?:the )?(?:photos|images|gallery)[.!]?$/i.test(text)) return { kind: 'images' };
  if (/^zoom (?:in|out)[.!]?$/i.test(text)) return { kind: /in/i.test(text) ? 'zoom_in' : 'zoom_out' };
  return exploreReference(text, context)?.command ?? null;
}
/** An explicit but missing/ambiguous label must not fall through to a different object action. */
export function exploreReference(text: string, context: ExploreContext): { command?: ExploreCommand; error?: string } | null {
  const match = text.match(/^(?:open|show|enlarge|expand)(?: me)? (?:the )?(?:(photo|image|picture|result|source) )?(first|second|third|fourth|fifth|sixth|seventh|eighth|\d{1,2}|[a-f]\s*[1-4])(?: (one|photo|image|picture|result|source))?[.!]?$/i);
  if (match) {
    const label = match[2].replace(/\s/g, '').toUpperCase();
    const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'].indexOf(label.toLowerCase());
    const index = ordinal >= 0 ? ordinal : /^[A-F]/.test(label) ? Array.from({ length: 24 }, (_, i) => externalItemLabel(i)).indexOf(label) : Number(label) - 1;
    const source = /result|source/i.test(`${match[1]} ${match[3]}`) || !/photo|image|picture/i.test(`${match[1]} ${match[3]}`) && context.kind === 'web';
    if (!match[1] && !match[3] && context.kind === 'web' && context.images[index] && context.sources?.[index]) return { error: `Both an image and a source use that label. Say “image ${label}” or “result ${label}”.` };
    const item = source ? context.sources?.[index] : context.images[index];
    return item ? { command: { kind: source ? 'open_source' : 'open_image', id: item.id } } : { error: `That ${source ? 'result' : 'image'} was not returned. Choose one of the displayed labels.` };
  }
  return null;
}
export function exploreContextForResult(result: ExploreResult, kind = result.kind, selected: string | null = null): ExploreContext {
  return { resultId: result.id, query: result.query.slice(0, 600), kind, images: result.images.map(({ id, caption }) => ({ id, caption: caption.slice(0, 100) })),
    sources: result.sources.map((source, index) => ({ id: `source-${index + 1}`, title: source.title })),
    selectedImageId: result.images.some(image => image.id === selected) ? selected : null,
    selectedSourceId: selected?.startsWith('source-') ? selected : null, map: result.map,
    ...(result.annotationTarget ? { annotationTarget: result.annotationTarget } : {}) };
}
export function exploreKindForText(text: string): ExploreKind | null {
  if (/\bmap\b/i.test(text)) return 'map';
  if (/\b(?:web|online|internet|search|find)\b/i.test(text) && /\b(?:photos?|images?|pictures?)\b/i.test(text)) return 'images';
  if (/\b(?:search|look up|find on|browse)\b.*\b(?:web|online|internet)\b|\bweb search\b/i.test(text)) return 'web';
  return null;
}
export function demoExploreResult(query: string, kind: ExploreKind): ExploreResult {
  const map = kind === 'map' ? mapForQuery(query) : null;
  const resultId = crypto.randomUUID();
  return { id: resultId, query, kind, demo: true, fetchedAt: new Date().toISOString(),
    answer: kind === 'map' ? map ? 'Preview of the selected map area. Live maps use OpenStreetMap.' : 'Offline preview supports “United States” or “world”. Connected maps can locate other regions.' : 'Example results show how visitors can explore sources and open images. This preview does not search the web.',
    sources: [{ title: 'Example source · OpenStreetMap', url: 'https://www.openstreetmap.org/' }], citations: [], map,
    images: kind === 'images' ? ['Landscape illustration 1', 'Landscape illustration 2'].map((caption, index) => ({ id: `image-${resultId}-${index + 1}`, url: '/explore-demo.svg', thumbnail: '/explore-demo.svg', sourceUrl: 'https://www.openstreetmap.org/', caption: `${caption} · synthetic preview, not a search result` })) : [],
  };
}
