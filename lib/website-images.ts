import 'server-only';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors';
import { assertPublicWebsiteUrl, fetchWebsiteBytes, type WebsiteTransport } from './website-fetch';
import { readWebsiteImageSource } from './website-import';
import { originalImageCandidates } from './website-image-discovery';
import { processImage } from './image-processing';
import type { WebsiteImage } from './website-import-model';
import type { StoredFile } from './local-store';

/** Revalidate provenance before downloading; every CDN/redirect uses pinned public DNS. */
export async function prepareWebsiteImage(root: string, pageUrl: string, imageUrl: string, io?: WebsiteTransport, captured?: WebsiteImage): Promise<StoredFile> {
  const page = captured ? { images: [captured] } : await readWebsiteImageSource(root, pageUrl, io);
  const url = assertPublicWebsiteUrl(imageUrl).toString();
  const candidate = page.images.find(image => image.url === url);
  if (!candidate) throw new AppError('This image is no longer referenced by the source page. Discover the website again.');
  const signal = AbortSignal.timeout(45_000);
  let best: { bytes: Uint8Array; processed: Awaited<ReturnType<typeof processImage>>; pixels: number } | undefined;
  let lastError: unknown;
  const variants = [...new Set([...originalImageCandidates(candidate.url, pageUrl), ...(candidate.variants ?? [candidate.url])])].slice(0, 11);
  for (const variant of variants) {
    if (signal.aborted) break;
    try {
      const bytes = await downloadImage(variant, io, signal);
      const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' }).metadata();
      const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
      if (!best || pixels > best.pixels) best = { bytes, pixels, processed: await processImage(bytes) };
    } catch (error) { lastError = error; }
  }
  if (!best) throw lastError instanceof AppError ? lastError : new AppError('No supported image variant could be downloaded within the photo limits.');
  const { processed, bytes } = best;

  return { id: randomUUID(), name: `website-${processed.image.hash.slice(0, 12)}.webp`, mime: 'image/webp', kind: 'image', uploadedAt: new Date().toISOString(),
    size: processed.display.length + processed.thumbnail.length, originalSize: bytes.length,
    image: { ...processed.image, ...(candidate.alt ? { caption: candidate.alt } : {}) }, data: processed.display.toString('base64'),
    thumbnailData: processed.thumbnail.toString('base64'), originalData: Buffer.from(bytes).toString('base64') };
}

async function downloadImage(value: string, io: WebsiteTransport | undefined, signal: AbortSignal) {
  let url = value;
  const visited = new Set<string>();
  for (let hop = 0; hop <= 3; hop++) {
    if (visited.has(url)) throw new AppError('Image redirect loop.');
    visited.add(url);
    const response = await fetchWebsiteBytes(url, io, signal, 10 * 1024 * 1024);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      url = assertPublicWebsiteUrl(new URL(response.location, url).toString()).toString(); continue;
    }
    if (response.status !== 200) throw new AppError(`Image returned HTTP ${response.status}.`);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(response.contentType)) throw new AppError('Only still PNG, JPEG and WebP images can be imported.');
    return response.bytes;
  }
  throw new AppError('Image exceeded the redirect limit.');
}
