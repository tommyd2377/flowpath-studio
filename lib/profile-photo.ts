import sharp from 'sharp';
import { WAVEFORM_PHOTO_MAX_BYTES, WAVEFORM_PHOTO_MAX_DIMENSION } from './account-model';

function photoData(value: unknown): { format: string; bytes: Buffer } | null {
  if (typeof value !== 'string' || value.length > Math.ceil(WAVEFORM_PHOTO_MAX_BYTES / 3) * 4 + 32) return null;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > WAVEFORM_PHOTO_MAX_BYTES || bytes.toString('base64') !== match[2]) return null;
  const format = match[1];
  const matches = format === 'png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : format === 'jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return matches ? { format, bytes } : null;
}

/** Cheap validation for stored, server-normalized photos; never permits SVG or remote URLs. */
export function validProfilePhoto(value: unknown): value is string {
  return photoData(value) !== null;
}

/** Fully decode new uploads, then strip metadata and keep a small canonical raster. */
export async function normalizeProfilePhoto(value: string): Promise<string | null> {
  const data = photoData(value);
  if (!data) return null;
  try {
    const image = sharp(data.bytes, {
      failOn: 'warning', limitInputPixels: WAVEFORM_PHOTO_MAX_DIMENSION ** 2,
    });
    const metadata = await image.metadata();
    if (metadata.format !== data.format || (metadata.pages ?? 1) !== 1
      || !metadata.width || !metadata.height || metadata.width > WAVEFORM_PHOTO_MAX_DIMENSION
      || metadata.height > WAVEFORM_PHOTO_MAX_DIMENSION) return null;
    const bytes = await image.rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 }).toBuffer();
    return bytes.length <= WAVEFORM_PHOTO_MAX_BYTES ? `data:image/webp;base64,${bytes.toString('base64')}` : null;
  } catch { return null; }
}
