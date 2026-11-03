import sharp from 'sharp';
import { validateVisualDisplay, VISUAL_IMAGE_MAX_BYTES, VISUAL_IMAGE_MAX_DIMENSION, type VisualDisplayConfiguration } from './visual-display';

/** Bounded inline data uses existing waveform storage, without buckets or arbitrary fetches. */
export async function normalizeVisualDisplay(input: unknown, existing?: VisualDisplayConfiguration | null): Promise<VisualDisplayConfiguration | null> {
  const parsed = validateVisualDisplay(input);
  if (!parsed.ok) throw new Error('Use up to four named PNG, JPEG or WebP pictures with descriptions.');
  if (!parsed.value) return null;
  const images = [];
  for (const image of parsed.value.images) {
    if (existing?.images.some(i => i.src === image.src)) { images.push(image); continue; }
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(image.src)!;
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > VISUAL_IMAGE_MAX_BYTES || bytes.toString('base64') !== match[2]) throw new Error('Picture size is invalid.');
    const raster = sharp(bytes, { failOn: 'warning', limitInputPixels: VISUAL_IMAGE_MAX_DIMENSION ** 2 });
    const metadata = await raster.metadata();
    if (metadata.format !== match[1] || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height
      || metadata.width > VISUAL_IMAGE_MAX_DIMENSION || metadata.height > VISUAL_IMAGE_MAX_DIMENSION) throw new Error('Choose a static raster picture up to 1024 pixels.');
    let normalized: Buffer | undefined;
    // A browser-compressed upload can grow when re-encoded at a higher quality.
    for (const quality of [80, 60, 40, 20]) {
      const output = await raster.clone().rotate().webp({ quality }).toBuffer();
      if (output.length <= VISUAL_IMAGE_MAX_BYTES) { normalized = output; break; }
    }
    if (!normalized) throw new Error('Picture is too detailed. Choose a smaller picture.');
    images.push({ ...image, src: `data:image/webp;base64,${normalized.toString('base64')}` });
  }
  const result = validateVisualDisplay({ type: 'visual', version: 1, images });
  if (!result.ok) throw new Error('Picture collection exceeds its size limit.');
  return result.value;
}
