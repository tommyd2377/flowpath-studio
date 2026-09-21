import { queryHash } from './catalog-query-index';
import { visitorDiagnostic } from './visitor-diagnostics';
import 'server-only';
import sharp from 'sharp';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { VisitorContext } from './visitor-request';
import { downloadPublishedFile, getPublished } from './site-store';
import { visitorTaskContext } from './visitor-task-context';

const prepared = new Map<string, { image_url: string; bytes: number }>();
const pending = new Map<string, Promise<{ image_url: string; bytes: number } | undefined>>();
let preparedBytes = 0;
/** One current, public photo in the existing turn; no new model call or private original. */
export async function activeCarouselImage(slug: string, context: VisitorContext, media: MediaLibrary | null | undefined, signal: AbortSignal, request?: string, traceId?: string) {
  // Be conservative: an unfamiliar question may still depend on the photo.
  if (request && !/\b(image|photo|picture|look|looking|see|visible|color|colour|appearance|depict|describe|this|that|it|foreground|background)\b/i.test(request)
    && /\b(hours?|contact|phone|email|address|polic(?:y|ies)|prices?|cost|availability|booking|appointments?|shipping|returns?|refunds?|delivery)\b/i.test(request)) return undefined;
  const carousel = context.carousel, card = context.surface?.regions.find(region => region.visible && region.kind === 'photo') ?? carousel?.cards.find(card => card.id === carousel.activeId);
  if (!carousel?.open || card?.kind !== 'photo' || !media) return undefined;
  let asset = media.assets.find(asset => card.referenceIds.some(id => id === asset.id || id === `photo:${media.id}:${asset.id}`));
  if (!asset && context.taskSession) {
    const { index } = await visitorTaskContext(slug);
    const assetId = card.referenceIds.map(id => index.records.get(id)).find(record => record?.type === 'published-photo')?.media?.assetId;
    asset = media.assets.find(asset => asset.id === assetId);
  }
  if (!asset) return undefined;
  const started = performance.now();
  signal.throwIfAborted();
  const authorize = async () => {
    signal.throwIfAborted();
    const site = await getPublished(slug);
    if (!site || site.content.mediaRevisionId !== media.id || !site.mediaFiles?.some(file => file.id === asset!.id && file.kind === 'image')) throw new Error('The current photo is no longer published.');
    return site;
  };
  const site = await authorize(), key = JSON.stringify([site.siteId, queryHash(site.content), media.id, asset.id]);
  let image = prepared.get(key);
  const cacheHit = Boolean(image);
  if (!image) {
    let work = pending.get(key);
    if (!work && pending.size < 8) {
      work = (async () => {
        const { file, bytes } = await downloadPublishedFile(slug, asset!.id, 'thumb');
        if (file.kind !== 'image') return;
        const image = await sharp(bytes).resize(512, 512, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
        if (image.length > 200_000) return;
        const value = { image_url: `data:image/jpeg;base64,${image.toString('base64')}`, bytes: image.length * 2 };
        while (prepared.size && (preparedBytes + value.bytes > 8 * 1024 * 1024 || prepared.size >= 32)) { const first = prepared.keys().next().value!; preparedBytes -= prepared.get(first)!.bytes; prepared.delete(first); }
        prepared.set(key, value); preparedBytes += value.bytes; return value;
      })().finally(() => pending.delete(key));
      pending.set(key, work);
    }
    image = await work;
  }
  await authorize(); signal.throwIfAborted();
  if (traceId) visitorDiagnostic({ traceId, channel: 'server', stage: 'image_prepare', status: 'succeeded', cacheHit, images: image ? 1 : 0, durationMs: performance.now() - started });
  // Model image input: distinguish current photo pixels from identity, published descriptions and business facts.
  return image ? { label: `Actual current photo ${asset.id}. Published description: ${asset.caption || asset.alt}. Describe visible appearance; do not infer identity, ingredients, price, availability or capabilities from appearance.`, image_url: image.image_url } : undefined;
}
