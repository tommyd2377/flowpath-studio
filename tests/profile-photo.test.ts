import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { normalizeProfilePhoto, validProfilePhoto } from '../lib/profile-photo';

test('common static raster encodings are decoded into the same bounded metadata-free format', async () => {
  const source = { create: { width: 32, height: 24, channels: 4 as const, background: '#b069e0' } };
  const examples = [
    ['png', await sharp(source).png().toBuffer()],
    ['jpeg', await sharp(source).jpeg().toBuffer()],
    ['jpeg', await sharp(source).jpeg({ progressive: true }).toBuffer()],
    ['webp', await sharp(source).webp().toBuffer()],
    ['webp', await sharp(source).webp({ lossless: true }).toBuffer()],
  ] as const;
  for (const [format, bytes] of examples) {
    const photo = `data:image/${format};base64,${bytes.toString('base64')}`;
    assert.equal(validProfilePhoto(photo), true);
    const normalized = await normalizeProfilePhoto(photo);
    assert.ok(normalized);
    assert.equal(validProfilePhoto(normalized), true);
    const metadata = await sharp(Buffer.from(normalized.split(',')[1], 'base64')).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 32);
    assert.equal(metadata.height, 24);
    assert.equal(metadata.exif, undefined);
  }
});

test('undecodable raster data is rejected even when its magic bytes look valid', async () => {
  const source = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#7353cb' } }).png().toBuffer();
  for (const count of [0, 1, 7, 8, 11, 12, 23, 32]) {
    const photo = `data:image/png;base64,${source.subarray(0, count).toString('base64')}`;
    assert.doesNotThrow(() => validProfilePhoto(photo));
    assert.equal(await normalizeProfilePhoto(photo), null);
  }
});
