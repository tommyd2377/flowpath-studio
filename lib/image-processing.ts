import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from './errors';

export type ImageDetails = { width: number; height: number; hash: string; caption?: string; credit?: string };
const clean = (value: string, limit: number) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, limit);
function decodeText(bytes: Uint8Array) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** Read a small, known metadata vocabulary only; never execute XML or expose GPS/EXIF. */
export function imageDescriptions(metadata: { iptc?: Buffer; xmp?: Buffer }): { caption?: string; credit?: string } {
  const tags = new Map<number, string>();
  const iptc = metadata.iptc;
  if (iptc && iptc.length <= 256_000) for (let index = 0; index + 5 <= iptc.length;) {
    if (iptc[index] !== 0x1c) { index++; continue; }
    const record = iptc[index + 1]; const tag = iptc[index + 2]; const length = iptc.readUInt16BE(index + 3);
    if (length & 0x8000 || index + 5 + length > iptc.length) break;
    if (record === 2 && [120, 80, 116].includes(tag) && !tags.has(tag)) tags.set(tag, decodeText(iptc.subarray(index + 5, index + 5 + length)));
    index += 5 + length;
  }
  const xmp = metadata.xmp && metadata.xmp.length <= 256_000 ? metadata.xmp.toString('utf8') : '';
  const xmlText = (tag: string) => {
    const body = xmp.match(new RegExp(`<dc:${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/dc:${tag}>`, 'i'))?.[1] ?? '';
    return body.replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity]!)).replace(/\s+/g, ' ').trim();
  };
  const caption = clean(tags.get(120) || xmlText('description'), 2000);
  const credit = clean(tags.get(116) || xmlText('rights') || tags.get(80) || xmlText('creator'), 300);
  return { ...(caption ? { caption } : {}), ...(credit ? { credit } : {}) };
}

export async function processImage(bytes: Uint8Array): Promise<{ display: Buffer; thumbnail: Buffer; image: ImageDetails }> {
  try {
    const input = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error' });
    const metadata = await input.metadata();
    if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000 || (metadata.pages ?? 1) > 1) {
      throw new AppError('Use a still PNG, JPEG or WebP photo with at most 40 million pixels.');
    }
    // Sharp drops metadata by default. Both published variants are decoded,
    // orientation-corrected fresh encodings, never the original upload.
    const display = await input.autoOrient().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).timeout({ seconds: 10 }).toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(display.data).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).timeout({ seconds: 5 }).toBuffer();
    return { display: display.data, thumbnail, image: { width: display.info.width, height: display.info.height,
      hash: createHash('sha256').update(bytes).digest('hex'), ...imageDescriptions(metadata) } };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('This image could not be decoded within the photo limits. Use a valid still PNG, JPEG or WebP photo with at most 40 million pixels.');
  }
}
