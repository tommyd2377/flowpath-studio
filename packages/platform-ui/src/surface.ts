import { z } from 'zod';

const id = z.string().min(1).max(200);
export const surfaceRegionSchema = z.object({
  id, kind: z.enum(['information', 'record', 'collection', 'photo', 'video', 'comparison', 'research', 'artifact', 'map', 'chart', 'answer']),
  title: z.string().max(200), referenceIds: z.array(id).max(48),
  role: z.enum(['primary', 'supporting']), visible: z.boolean(), selectedId: id.nullable(),
  visibleReferenceIds: z.array(id).max(48).optional(),
  itemCount: z.number().int().nonnegative().max(10000).optional(),
  mapView: z.object({ latitude: z.number().min(-80).max(80), longitude: z.number().min(-180).max(180), zoom: z.number().min(2).max(12) }).strict().optional(),
}).strict();
export type SurfaceRegion = z.infer<typeof surfaceRegionSchema>;
/** Browser receipt, not factual authority. Values are resolved again by the server. */
export const informationSurfaceContextSchema = z.object({
  version: z.literal(1), stateId: id, requestId: id.nullable(), publicationId: id, tenantId: id,
  revision: z.number().int().nonnegative(), status: z.enum(['pending', 'committed']),
  layout: z.enum(['reading', 'media', 'split', 'comparison', 'collection', 'map']),
  subject: z.array(id).max(48), regions: z.array(surfaceRegionSchema).max(3),
  answer: z.string().max(8000), pendingRequestId: id.nullable(),
  previous: z.array(z.object({ stateId: id, title: z.string().max(200), subject: z.array(id).max(12) }).strict()).max(8),
  next: z.array(z.object({ stateId: id, title: z.string().max(200), subject: z.array(id).max(12) }).strict()).max(8).optional(),
  reading: z.object({ scrollTop: z.number().int().min(0).max(10000000), blockId: id.nullable() }).strict(),
}).strict();
export type InformationSurfaceContext = z.infer<typeof informationSurfaceContextSchema>;

/** Layout intent is semantic; publishers/models cannot supply CSS or coordinates. */
export function informationLayout(regions: Pick<SurfaceRegion, 'kind' | 'role'>[]): InformationSurfaceContext['layout'] {
  if (regions.some(region => region.role === 'primary' && region.kind === 'collection')) return 'collection';
  if (regions.length > 1) return 'split';
  const kind = regions[0]?.kind;
  return kind === 'map' ? 'map' : kind === 'comparison' ? 'comparison' : kind === 'collection' ? 'collection'
    : kind === 'photo' || kind === 'video' ? 'media' : 'reading';
}

/** Conservative serialized-byte accounting also bounds shared immutable data. */
export const SURFACE_HISTORY_ENTRIES = 16;
export const SURFACE_HISTORY_BYTES = 1_000_000;
export function retainSurfaceHistory<T>(past: readonly T[], previous: T): T[] {
  const entries = [...past, previous].slice(-SURFACE_HISTORY_ENTRIES);
  while (entries.length && new TextEncoder().encode(JSON.stringify(entries)).byteLength > SURFACE_HISTORY_BYTES) entries.shift();
  return entries;
}
