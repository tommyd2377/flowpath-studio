import { randomUUID } from 'node:crypto';
import { AppError } from './errors';
import { readLimitedBody } from './http';
import type { StoredFile, StoredSite } from './local-store';
import { processImage } from './image-processing';

export async function readUpload(request: Request): Promise<{ revision: number; file: StoredFile }> {
  const revisionHeader = request.headers.get('x-site-revision') || '';
  const revision = Number(revisionHeader);
  if (!/^[1-9]\d*$/.test(revisionHeader) || !Number.isSafeInteger(revision)) throw new AppError('A valid site revision is required.');
  const mime = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';
  const data = Buffer.from(await readLimitedBody(request, ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? 10 * 1024 * 1024 : 2 * 1024 * 1024));
  let name: string;
  try { name = decodeURIComponent(request.headers.get('x-file-name') || '').replace(/[\\/\x00-\x1f\x7f]/g, '').trim().slice(0, 120); }
  catch { throw new AppError('The file name is not valid.'); }
  if (!name || !data.length) throw new AppError('Choose a non-empty file.');
  const validImage = mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || mime === 'image/jpeg' && data[0] === 255 && data[1] === 216 && data[2] === 255
    || mime === 'image/webp' && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  const validPdf = mime === 'application/pdf' && data.toString('ascii', 0, 5) === '%PDF-';
  const validText = ['text/plain', 'text/csv'].includes(mime) && data.length <= 256 * 1024 && !data.includes(0);
  if (!validImage && !validPdf && !validText) throw new AppError('Use PNG, JPEG or WebP photos up to 10 MB, PDFs up to 2 MB, or CSV and text files up to 256 KB.');
  if (validImage) {
    const { display, thumbnail, image } = await processImage(data);
    return { revision, file: { id: randomUUID(), name, mime: 'image/webp', kind: 'image', uploadedAt: new Date().toISOString(),
      size: display.length + thumbnail.length, originalSize: data.length, image,
      data: display.toString('base64'), thumbnailData: thumbnail.toString('base64'), originalData: data.toString('base64') } };
  }
  let text: string | undefined;
  if (validText) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(data).slice(0, 20000); }
    catch { throw new AppError('Text files must use UTF-8 encoding.'); }
  }
  return { revision, file: { id: randomUUID(), name, mime, size: data.length,
    kind: validImage ? 'image' : validPdf ? 'pdf' : 'text', uploadedAt: new Date().toISOString(),
    data: data.toString('base64'), ...(validText ? { text } : {}) } };
}

export function assertUploadAllowed(site: StoredSite, revision: number, file: StoredFile) {
  if (site.revision !== revision) throw new AppError('This site changed in another tab. Reload the site before trying again.', 409);
  if (file.kind === 'image' ? site.files.filter(item => item.kind === 'image').length >= 100 : site.files.filter(item => item.kind !== 'image').length >= 20) throw new AppError('Each site supports 100 photos and 20 other source files.');
  if (site.files.reduce((total, item) => total + item.size + (item.originalSize ?? 0), 0) + file.size + (file.originalSize ?? 0) > 100 * 1024 * 1024) throw new AppError('This site supports 100 MB total, including private photo originals and display sizes.');
}

export function fileResponse(file: StoredFile, bytes: Uint8Array) {
  const name = file.kind === 'image' && file.mime === 'image/webp' ? `${file.name.replace(/\.[^.]+$/, '')}.webp` : file.name;
  return new Response(bytes as BodyInit, { headers: {
    'Content-Type': file.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
    'Content-Disposition': `${file.kind === 'image' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Content-Security-Policy': "default-src 'none'; sandbox",
  } });
}
