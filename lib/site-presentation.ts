import { z } from 'zod';
import type { SiteContent } from './site-model';
import type { MediaLibrary } from '@thevoice/platform-ui/media';

// A render plan contains references, never generated HTML, code, links, or facts.
export const presentationSchema = z.object({
  layout: z.enum(['detail', 'cards', 'comparison', 'gallery']),
  sources: z.array(z.string().min(1).max(100)).min(1).max(6),
  status: z.enum(['ready', 'unavailable']),
}).strict();
export type SitePresentation = z.infer<typeof presentationSchema>;
export type PresentationSource = { id: string; kind: 'overview' | 'section' | 'hours' | 'contact' | 'album' | 'photos' | 'photo'; title: string; body: string };

export function presentationSources(content: SiteContent, media?: MediaLibrary | null): PresentationSource[] {
  return [
    { id: 'overview', kind: 'overview', title: content.headline || content.name, body: content.description },
    ...content.sections.map(section => ({ id: `section:${section.id}`, kind: 'section' as const, title: section.title, body: section.body })),
    ...(content.hours ? [{ id: 'hours', kind: 'hours' as const, title: 'Hours & availability', body: content.hours }] : []),
    ...(content.contact ? [{ id: 'contact', kind: 'contact' as const, title: 'Get in touch', body: content.contact }] : []),
    ...(media?.assets.length ? [{ id: 'photos', kind: 'photos' as const, title: 'Photos', body: 'Browse the published photos and albums.' },
      ...media.albums.filter(album => album.assetIds.length).map(album => ({ id: `album:${album.id}`, kind: 'album' as const, title: album.title, body: album.description.slice(0, 600) })),
      ...media.assets.map(asset => ({ id: `photo:${asset.id}`, kind: 'photo' as const, title: asset.caption.slice(0, 160) || 'Photo',
        body: JSON.stringify({ description: asset.alt.slice(0, 300), connections: media.associations.filter(link => link.assetId === asset.id).map(link => ({
          role: link.role, subject: link.targetType === 'site' ? content.name : link.targetType === 'section' ? content.sections.find(section => section.id === link.targetId)?.title ?? 'Unspecified section' : 'Catalog item',
        })) }) }))] : []),
  ];
}

export function validatePresentation(value: unknown, content: SiteContent, media?: MediaLibrary | null): SitePresentation {
  const plan = presentationSchema.parse(value);
  const sources = presentationSources(content, media);
  const ids = new Set(sources.map(source => source.id));
  const photoKinds = new Set(['photos', 'photo', 'album']);
  if (plan.layout === 'gallery' ? !media?.assets.length || plan.sources.some(id => !photoKinds.has(sources.find(source => source.id === id)?.kind ?? ''))
    : plan.sources.some(id => photoKinds.has(sources.find(source => source.id === id)?.kind ?? ''))) throw new Error('Photo sources require a gallery.');
  if (plan.sources.some(id => !ids.has(id)) || new Set(plan.sources).size !== plan.sources.length
    || plan.layout === 'detail' && plan.sources.length !== 1
    || plan.layout === 'comparison' && plan.sources.length < 2) throw new Error('Invalid site presentation.');
  return plan;
}

export function presentationJsonSchema(content: SiteContent, media?: MediaLibrary | null) {
  const schema = z.toJSONSchema(presentationSchema, { target: 'draft-7' });
  delete schema.$schema;
  // Constrain selection to this exact published snapshot, then validate again.
  const sources = schema.properties?.sources;
  if (sources && typeof sources === 'object') sources.items = { type: 'string', enum: presentationSources(content, media).map(source => source.id) };
  return schema;
}

export const presentationInstructions = `Choose the published sources that answer the visitor's request and arrange them as a visual site view. Use detail for one item, cards for several related items, comparison for two or more items requested side by side. Use gallery only for published photo/album/photos sources; use the photos source only for a request for all photos, otherwise choose matching photo or album IDs. Never mix photo sources into other layouts. Respect the approved photo connections: example means illustrative, never proof of the exact offering or location. Do not infer photo positions from the order of these source records; for an ordinal photo request without a named subject, use unavailable. Select at most six sources, with no duplicates. Use history to resolve follow-ups such as "the second one" or "show that again". If the requested information is not published, set status to unavailable and select contact if available, otherwise overview. Never treat similar information as proof of a missing price, date, booking, or availability. Do not generate business facts or a chat response. Only select sources and a layout.`;

export function presentationSummary(plan: SitePresentation, content: SiteContent, media?: MediaLibrary | null) {
  const sources = presentationSources(content, media);
  return `View: ${JSON.stringify(plan)}. Showing ${plan.sources.map(id => sources.find(source => source.id === id)!.title).join('; ')}.`;
}

// Deterministic owner preview: no provider calls and no invented content.
export function demoPresentation(content: SiteContent, text: string, history: { role: string; text: string }[] = [], media?: MediaLibrary | null): SitePresentation {
  const catalog = presentationSources(content, media);
  const query = text.toLowerCase();
  let previousPlan: SitePresentation | undefined;
  const previous = history.filter(item => item.role === 'assistant').at(-1)?.text.match(/View: (\{[^\n]+?\})\./)?.[1];
  if (previous) {
    try { previousPlan = validatePresentation(JSON.parse(previous), content, media); }
    catch { /* A changed preview may invalidate an earlier source. */ }
  }
  const photoQuery = /\b(photos?|pictures?|images?|albums?|gallery|galleries)\b/.test(query);
  const namedPhotoSubject = media?.albums.some(album => query.includes(album.title.toLowerCase()))
    || media?.assets.some(asset => asset.caption.length > 5 && query.includes(asset.caption.toLowerCase()));
  if (!namedPhotoSubject && /\b(first|second|third|fourth|fifth|sixth)\b/.test(query) && (photoQuery || previousPlan?.layout === 'gallery')) {
    throw new Error('Open the photo you mean, or name its album. Photo positions can change as you browse.');
  }
  const selected: string[] = [];
  if (/\b(hours|open|available|availability|time)\b/.test(query) && content.hours) selected.push('hours');
  if (/\b(contact|email|phone|reach|touch)\b/.test(query) && content.contact) selected.push('contact');
  const stop = new Set(['tell', 'about', 'show', 'more', 'your', 'what', 'with', 'that', 'this', 'please', 'compare']);
  const words = query.split(/\W+/).filter(word => word.length > 3 && !stop.has(word));
  if (media?.assets.length && photoQuery) {
    const terms = words.filter(word => !['photos', 'photo', 'pictures', 'picture', 'images', 'image', 'albums', 'album', 'gallery', 'galleries', 'have', 'available', 'some', 'show', 'please', 'browse'].includes(word));
    const albums = media.albums.filter(album => album.assetIds.length && (query.includes(album.title.toLowerCase()) || terms.some(term => `${album.title} ${album.description}`.toLowerCase().includes(term))));
    const photos = media.assets.filter(asset => terms.some(term => `${asset.caption} ${asset.alt}`.toLowerCase().includes(term)));
    const refs = albums.length ? albums.map(album => `album:${album.id}`) : photos.map(photo => `photo:${photo.id}`);
    if (refs.length || !terms.length) return validatePresentation({ layout: 'gallery', sources: refs.length ? refs.slice(0, 6) : ['photos'], status: 'ready' }, content, media);
  }
  for (const source of catalog.filter(source => source.kind === 'section')) {
    if (words.some(word => source.title.toLowerCase().includes(word))) selected.push(source.id);
  }
  const compare = /\b(compare|comparison|versus|vs|difference)\b|side by side/.test(query);
  if (compare && selected.length < 2) {
    for (const source of catalog.filter(source => source.kind === 'section').slice(0, 3)) if (!selected.includes(source.id)) selected.push(source.id);
  }
  if (!selected.length && /\b(more|that|those|again|first|second|third)\b/.test(query)) {
    if (previousPlan) {
      if (previousPlan.layout === 'gallery') return previousPlan;
      const index = /\bsecond\b/.test(query) ? 1 : /\bthird\b/.test(query) ? 2 : /\bfirst\b/.test(query) ? 0 : -1;
      selected.push(...(index >= 0 && previousPlan.sources[index] ? [previousPlan.sources[index]] : previousPlan.sources));
    }
  }
  const overview = !query.trim() || /\b(overview|everything|hello|hi)\b|about (you|the (site|studio))/.test(query);
  const unavailable = !selected.length && !overview;
  if (!selected.length) selected.push(unavailable && content.contact ? 'contact' : 'overview');
  const sources = selected.slice(0, 6);
  return { layout: compare && sources.length > 1 ? 'comparison' : sources.length > 1 ? 'cards' : 'detail', sources, status: unavailable ? 'unavailable' : 'ready' };
}
