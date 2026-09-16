import { z } from 'zod';

const id = z.string().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
export const videoSchema = z.object({
  id, title: z.string().trim().min(1).max(160), description: z.string().max(3000),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('file'), fileId: id }).strict(),
    z.object({ kind: z.literal('youtube'), videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }).strict(),
    z.object({ kind: z.literal('url'), url: z.string().url().max(2000).refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && /\.mp4$/i.test(url.pathname); }, 'Use a public HTTPS MP4 URL.') }).strict(),
  ]),
  posterAssetId: id.optional(), autoplay: z.boolean().default(false),
  transcript: z.array(z.object({ start: z.number().min(0).max(86400), end: z.number().min(0).max(86400), text: z.string().max(1000) }).strict().refine(cue => cue.end > cue.start)).max(120).optional(),
}).strict();
export type PublishedVideo = z.infer<typeof videoSchema>;
export function youtubeVideoId(value: string): string | null {
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) return null;
    const candidate = url.hostname === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) ? url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1] : null;
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch { return null; }
}
export const mediaAssetSchema = z.object({
  id, width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000),
  caption: z.string().max(2000), alt: z.string().max(1000), credit: z.string().max(300).optional(),
}).strict();
export const mediaAlbumSchema = z.object({
  id, title: z.string().trim().min(1).max(160), description: z.string().max(3000),
  assetIds: z.array(id).max(100), coverAssetId: id.optional(),
}).strict();
export const mediaAssociationSchema = z.object({
  id, assetId: id, targetType: z.enum(['site', 'entity', 'section']), targetId: id.optional(),
  role: z.enum(['depicts', 'example']), primary: z.boolean().optional(),
}).strict();
/** Published descriptions and references only. Storage paths and inferred identities stay host-owned. */
export const mediaLibrarySchema = z.object({
  schemaVersion: z.literal(1), id, assets: z.array(mediaAssetSchema).max(100),
  videos: z.array(videoSchema).max(20).optional(),
  albums: z.array(mediaAlbumSchema).max(24), associations: z.array(mediaAssociationSchema).max(300),
}).strict();
export type MediaAsset = z.infer<typeof mediaAssetSchema>;
export type MediaAlbum = z.infer<typeof mediaAlbumSchema>;
export type MediaAssociation = z.infer<typeof mediaAssociationSchema>;
export type MediaLibrary = z.infer<typeof mediaLibrarySchema>;
export type MediaTarget = { targetType: MediaAssociation['targetType']; targetId?: string };
export type AssetUrlResolver = (assetId: string, size: 'thumb' | 'display') => string;

function invalid(message: string): never { throw new z.ZodError([{ code: 'custom', path: [], message }]); }
function unique(values: string[], name: string) {
  if (new Set(values).size !== values.length) invalid(`Duplicate ${name}.`);
}
export function validateMediaLibrary(input: unknown, context?: { entityIds?: readonly string[]; sectionIds?: readonly string[] }): MediaLibrary {
  const stack = [{ value: input, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  let text = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 15000 || depth > 6) invalid('Media exceeds the supported size or depth.');
    if (typeof value === 'string') text += value.length;
    else if (value && typeof value === 'object') {
      if (seen.has(value)) invalid('Media must not contain cycles or shared object references.');
      seen.add(value);
      const entries = Object.entries(value);
      if (entries.length + nodes + stack.length > 15000) invalid('Media exceeds the supported size.');
      for (const [key, child] of entries) { text += key.length; stack.push({ value: child, depth: depth + 1 }); }
    }
    if (text > 500000) invalid('Media descriptions are too large.');
  }
  const library = mediaLibrarySchema.parse(input);
  unique(library.assets.map(asset => asset.id), 'asset identifiers');
  unique((library.videos ?? []).map(video => video.id), 'video identifiers');
  if (library.videos?.some(video => video.posterAssetId && !library.assets.some(asset => asset.id === video.posterAssetId))) invalid('A video poster must be an approved library image.');
  unique(library.albums.map(album => album.id), 'album identifiers');
  unique(library.associations.map(association => association.id), 'association identifiers');
  const assets = new Set(library.assets.map(asset => asset.id));
  for (const album of library.albums) {
    unique(album.assetIds, 'album asset references');
    if (album.assetIds.some(assetId => !assets.has(assetId))) invalid('An album references an unknown photo.');
    if (album.coverAssetId && !album.assetIds.includes(album.coverAssetId)) invalid('An album cover must belong to its album.');
  }
  const links: string[] = [];
  const primaries: string[] = [];
  for (const association of library.associations) {
    if (!assets.has(association.assetId)) invalid('An association references an unknown photo.');
    if (association.targetType === 'site' ? association.targetId !== undefined : !association.targetId) invalid('Only entity and section associations require a target identifier.');
    const allowed = association.targetType === 'entity' ? context?.entityIds : association.targetType === 'section' ? context?.sectionIds : undefined;
    if (allowed && !allowed.includes(association.targetId!)) invalid('An association references an unknown target.');
    const target = `${association.targetType}:${association.targetId ?? ''}`;
    links.push(`${target}:${association.assetId}`);
    if (association.primary) primaries.push(`${target}:${association.role}`);
  }
  unique(links, 'photo associations for the same target');
  unique(primaries, 'primary photos for the same target and role');
  return library;
}

/** Association order is publisher order, with explicitly chosen lead images first. */
export function mediaForTarget(library: MediaLibrary, target: MediaTarget, includeExamples = false): Array<{ asset: MediaAsset; association: MediaAssociation }> {
  const assets = new Map(library.assets.map(asset => [asset.id, asset]));
  return library.associations.filter(association => association.targetType === target.targetType
    && association.targetId === target.targetId && (includeExamples || association.role === 'depicts'))
    .sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false))
    .flatMap(association => { const asset = assets.get(association.assetId); return asset ? [{ asset, association }] : []; });
}

/** Explicit asset ordering wins; otherwise preserve the publisher's album/library ordering. */
export function galleryAssetIds(library: MediaLibrary, scope: { assetIds?: readonly string[]; albumId?: string; entityIds?: readonly string[] } = {}): string[] {
  const album = scope.albumId ? library.albums.find(item => item.id === scope.albumId) : undefined;
  if (scope.albumId && !album) return [];
  const known = new Set(library.assets.map(asset => asset.id));
  const linked = scope.entityIds?.length ? new Set(library.associations.filter(item => item.targetType === 'entity' && scope.entityIds!.includes(item.targetId!)).map(item => item.assetId)) : null;
  return [...(scope.assetIds ?? album?.assetIds ?? library.assets.map(asset => asset.id))]
    .filter(assetId => known.has(assetId) && (!album || album.assetIds.includes(assetId)) && (!linked || linked.has(assetId)));
}
