import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { imageDescriptions, processImage } from '../lib/image-processing';
import { assertUploadAllowed, readUpload } from '../lib/file-validation';
import { initialSite, type StoredFile } from '../lib/local-store';
import { randomUUID } from 'node:crypto';

test('photo processing orients, bounds and re-encodes display/thumbnail without source metadata', async () => {
  const original = await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#54785a' } }).jpeg().withMetadata({ orientation: 6 }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Sample &amp; image</rdf:li></rdf:Alt></dc:description><dc:rights><rdf:Alt><rdf:li>Example photographer</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>').toBuffer();
  const result = await processImage(original);
  assert.equal(result.image.width, 600); assert.equal(result.image.height, 1200);
  assert.equal(result.image.caption, 'Sample & image'); assert.equal(result.image.credit, 'Example photographer');
  const display = await sharp(result.display).metadata(); const thumb = await sharp(result.thumbnail).metadata();
  assert.equal(display.format, 'webp'); assert.equal(thumb.format, 'webp'); assert.equal(thumb.height, 480);
  for (const variant of [display, thumb]) { assert.equal(variant.exif, undefined); assert.equal(variant.xmp, undefined); assert.equal(variant.iptc, undefined); assert.equal(variant.orientation, undefined); }
  assert.notDeepEqual(result.display, original);
  const upload = await readUpload(new Request('http://127.0.0.1/api/upload', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-site-revision': '1', 'x-file-name': 'photo.jpg' }, body: original }));
  assert.equal(upload.file.originalSize, original.length); assert.equal(upload.file.mime, 'image/webp');
  assert.equal(upload.file.size, Buffer.from(upload.file.data!, 'base64').length + Buffer.from(upload.file.thumbnailData!, 'base64').length);
});

test('image signatures alone are insufficient and unsupported or oversized-pixel images fail closed', async () => {
  await assert.rejects(() => readUpload(new Request('http://127.0.0.1/api/upload', { method: 'POST', headers: { 'content-type': 'image/png', 'x-site-revision': '1', 'x-file-name': 'broken.png' }, body: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) })), /could not be decoded/);
  await assert.rejects(() => processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')), /still PNG/);
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abc' } }).png().toBuffer();
  png.writeUInt32BE(7000, 16); png.writeUInt32BE(7000, 20);
  // Give the tiny fixture a valid IHDR CRC; no large pixel buffer is allocated.
  let crc = 0xffffffff;
  for (const byte of png.subarray(12, 29)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  png.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  await assert.rejects(() => processImage(png), /40 million pixels/);
});

test('bounded metadata extraction recognizes caption and credit while ignoring other IPTC fields', () => {
  const field = (tag: number, value: string) => { const bytes = Buffer.from(value); const header = Buffer.from([0x1c, 2, tag, 0, 0]); header.writeUInt16BE(bytes.length, 3); return Buffer.concat([header, bytes]); };
  assert.deepEqual(imageDescriptions({ iptc: Buffer.concat([field(120, 'An example arrangement'), field(116, 'Example credit'), field(90, 'Private city')]) }), { caption: 'An example arrangement', credit: 'Example credit' });
  assert.deepEqual(imageDescriptions({ iptc: Buffer.alloc(256_001), xmp: Buffer.alloc(256_001) }), {});
});

test('photo and document counts are independent and total storage includes originals', () => {
  const site = initialSite('general');
  const file: StoredFile = { id: randomUUID(), name: 'photo.webp', kind: 'image', mime: 'image/webp', size: 10, originalSize: 20, uploadedAt: new Date().toISOString() };
  site.files = Array.from({ length: 100 }, () => ({ ...file, id: randomUUID() }));
  assert.throws(() => assertUploadAllowed(site, 1, file), /100 photos/);
  assert.doesNotThrow(() => assertUploadAllowed(site, 1, { ...file, kind: 'text', originalSize: 0 }));
  site.files = [{ ...file, size: 1, originalSize: 100 * 1024 * 1024 }];
  assert.throws(() => assertUploadAllowed(site, 1, file), /100 MB total/);
});
