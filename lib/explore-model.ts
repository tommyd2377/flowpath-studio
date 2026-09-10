import { z } from 'zod';

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
  dailyLimit: z.number().int().min(1).max(100),
  allowedDomains: z.array(z.string().trim().toLowerCase().max(253).refine(value =>
    /^[a-z0-9.-]+$/.test(value) && !value.startsWith('.') && !value.endsWith('.') && publicWebUrl(`https://${value}`), 'Enter domains only, such as wikipedia.org.')).max(8),
}).strict();
export type ExploreSettings = z.infer<typeof exploreSettingsSchema>;
export const DEFAULT_EXPLORE_SETTINGS: ExploreSettings = { enabled: false, images: true, maps: true, dailyLimit: 10, allowedDomains: [] };
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
export const exploreResultSchema = z.object({
  id, kind: exploreKindSchema, query: z.string().max(2000), fetchedAt: z.iso.datetime(), demo: z.boolean(),
  answer: z.string().max(12000), sources: z.array(sourceSchema).max(20), citations: z.array(citationSchema).max(40),
  images: z.array(z.object({ id, url: imageUrl, thumbnail: imageUrl, sourceUrl: url, caption: z.string().max(500) }).strict()).max(8),
  map: exploreMapSchema.nullable(),
}).strict().superRefine((result, context) => {
  if (new Set(result.images.map(image => image.id)).size !== result.images.length
    || result.citations.some(c => c.end <= c.start || c.end > result.answer.length)
    || !result.demo && result.images.some(image => image.url.startsWith('/') || image.thumbnail.startsWith('/'))) {
    context.addIssue({ code: 'custom', message: 'Invalid search result references.' });
  }
});
export type ExploreResult = z.infer<typeof exploreResultSchema>;
// Browser observations contain no arbitrary URLs or external content to promote into facts.
export const exploreContextSchema = z.object({
  resultId: id, kind: exploreKindSchema, images: z.array(z.object({ id, caption: z.string().max(500) }).strict()).max(8),
  selectedImageId: id.nullable(), map: exploreMapSchema.nullable(),
}).strict();
export type ExploreContext = z.infer<typeof exploreContextSchema>;
export const exploreCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open_image'), id }).strict(),
  z.object({ kind: z.enum(['back', 'images', 'web', 'zoom_in', 'zoom_out']) }).strict(),
]);
export type ExploreCommand = z.infer<typeof exploreCommandSchema>;
export const exploreRequestSchema = z.object({ requestId: z.string().uuid(), query: z.string().trim().min(1).max(2000), kind: exploreKindSchema }).strict();
export function mapForQuery(query: string): ExploreMap | null {
  if (/\b(united states|usa)\b|\bu\.s\.(?:a\.)?/i.test(query) || /\bUS\b/.test(query)) return { label: 'United States overview', latitude: 39, longitude: -98, zoom: 3 };
  if (/\b(world|earth|globe)\b/i.test(query)) return { label: 'World overview', latitude: 15, longitude: 0, zoom: 2 };
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
  const match = text.match(/^(?:open|show|enlarge)(?: me)? (?:the )?(?:(?:photo|image|picture) )?(first|second|third|fourth|fifth|sixth|seventh|eighth|[1-8])(?: (?:one|photo|image|picture))?[.!]?$/i);
  if (match) {
    const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'].indexOf(match[1].toLowerCase());
    const image = context.images[ordinal >= 0 ? ordinal : Number(match[1]) - 1];
    if (image) return { kind: 'open_image', id: image.id };
  }
  return null;
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
