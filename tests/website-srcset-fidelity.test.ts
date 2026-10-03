import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractWebsiteImages } from '../lib/website-image-discovery';
import { prepareWebsiteImage } from '../lib/website-images';
import type { WebsiteTransport } from '../lib/website-fetch';

const page = 'https://www.poppysbrooklyn.com/cafe/';
const absolute = (value: string) => new URL(value, page).toString();

test('srcset preserves comma-bearing CDN path and query URLs as complete candidates', () => {
  const small = 'https://images.example.com/resize,width=400,quality=80/photo.jpg?crop=1,2,3,4';
  const large = 'https://images.example.com/resize,width=1600,quality=90/photo.jpg?crop=4,3,2,1';
  const [image] = extractWebsiteImages(`<img alt="Cafe" src="/fallback.jpg" srcset="${small} 400w, ${large} 1600w">`, page);
  assert.equal(image.url, large);
  assert.ok(image.variants?.includes(small));
  assert.ok(image.variants?.includes(absolute('/fallback.jpg')));
  assert.equal(image.alt, 'Cafe');
  assert.ok(image.variants?.every(url => url === small || url === large || url === absolute('/fallback.jpg')));
});

test('source data-srcset retains commas and HTML-encoded query separators', () => {
  const [image] = extractWebsiteImages('<picture><source data-srcset="https://cdn.example.com/a,b.webp?rect=1,2&amp;fit=crop 1x, https://cdn.example.com/c,d.webp?rect=3,4&amp;fit=crop 2x"></picture>', page);
  assert.equal(image.url, 'https://cdn.example.com/c,d.webp?rect=3,4&fit=crop');
  assert.ok(image.variants?.includes('https://cdn.example.com/a,b.webp?rect=1,2&fit=crop'));
});

test('ordinary width and density sets rank largest first and preserve src fallback', () => {
  const width = extractWebsiteImages('<img src="/fallback.jpg" srcset="/medium.jpg 800w, /small.jpg 320w, /large.jpg 1600w">', page)[0];
  assert.equal(width.url, absolute('/large.jpg'));
  assert.ok(width.variants?.includes(absolute('/fallback.jpg')));
  const density = extractWebsiteImages('<img src="/fallback.jpg" srcset="/one.jpg 1x, /half.jpg .5x, /three.jpg 3e0x">', page)[0];
  assert.equal(density.url, absolute('/three.jpg'));
  assert.ok(density.variants?.includes(absolute('/half.jpg')));
});

test('descriptorless comma-terminated candidates retain stable order; zero density is valid', () => {
  const plain = extractWebsiteImages('<img srcset="/one.jpg, /two.jpg, /three.jpg">', page)[0];
  assert.equal(plain.url, absolute('/one.jpg'));
  assert.deepEqual(new Set(plain.variants), new Set(['/one.jpg', '/two.jpg', '/three.jpg'].map(absolute)));
  assert.equal(extractWebsiteImages('<img srcset="/zero.jpg 0x">', page)[0].url, absolute('/zero.jpg'));
});

test('invalid duplicate, mixed, zero-width and negative-density descriptors are discarded', () => {
  for (const descriptor of ['200w 300w', '2x 3x', '400w 2x', '0w', '-1x', 'Infinityx', '2q']) {
    const [image] = extractWebsiteImages(`<img src="/fallback.jpg" srcset="/bad.jpg ${descriptor}, /good.jpg 100w">`, page);
    assert.equal(image.url, absolute('/good.jpg'), descriptor);
    assert.ok(!image.variants?.includes(absolute('/bad.jpg')), descriptor);
  }
});

test('invalid-only srcset uses src and unsafe data URLs produce no bogus relative fragments', () => {
  assert.equal(extractWebsiteImages('<img src="/fallback.jpg" srcset="/bad.jpg 400w 2x">', page)[0].url, absolute('/fallback.jpg'));
  assert.deepEqual(extractWebsiteImages('<img srcset="data:image/png;base64,AAAA 1x">', page), []);
  const [image] = extractWebsiteImages('<img src="/fallback.jpg" srcset="data:image/png;base64,AAAA 3x, javascript:alert(1) 4x, /good.jpg 1x">', page);
  assert.equal(image.url, absolute('/good.jpg'));
  assert.deepEqual(new Set(image.variants), new Set([absolute('/good.jpg'), absolute('/fallback.jpg')]));
});

test('responsive alternatives remain bounded while explicit original and source fallback survive', () => {
  const responsive = Array.from({ length: 30 }, (_, i) => `/responsive-${i}.jpg ${(i + 1) * 100}w`).join(', ');
  const [image] = extractWebsiteImages(`<img data-original="/original.jpg" src="/fallback.jpg" srcset="${responsive}">`, page);
  assert.equal(image.url, absolute('/original.jpg'));
  assert.ok((image.variants?.length ?? 0) <= 8);
  assert.ok(image.variants?.includes(absolute('/fallback.jpg')));
  assert.ok(image.variants?.includes(absolute('/responsive-29.jpg')));
});

test('only explicitly hidden 1x1 img trackers are excluded; ordinary noscript photos survive', () => {
  for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display: none"']) {
    assert.deepEqual(extractWebsiteImages(`<noscript><img width="1" height="1" ${hidden} src="/pixel.gif"></noscript>`, page), [], hidden);
  }
  const images = extractWebsiteImages('<img width="1" height="1" src="/texture.png"><img width="1" height="400" hidden src="/strip.png"><noscript><img width="1200" height="800" src="/cafe.jpg" alt="Cafe fallback"></noscript>', page);
  assert.deepEqual(images.map(image => image.url), ['/texture.png', '/strip.png', '/cafe.jpg'].map(absolute));
  assert.equal(images.at(-1)?.alt, 'Cafe fallback');
});

test('source srcset discovery downloads complete CDN URLs and retains exact larger original bytes', async () => {
  const largeUrl = 'https://images.example.com/resize,width=900,quality=90/cafe.png?crop=1,2,3,4';
  const smallUrl = 'https://images.example.com/resize,width=90,quality=70/cafe.png?crop=1,2,3,4';
  const large = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const small = await sharp(large).resize(90, 60).png().toBuffer();
  const html = `<h1>Cafe</h1><p>${'Published cafe photograph and seasonal menu. '.repeat(4)}</p><picture><source srcset="${smallUrl} 90w, ${largeUrl} 900w"><img src="${smallUrl}" alt="Cafe"></picture>`;
  const calls: string[] = [];
  const io: WebsiteTransport = {
    resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: async url => {
      const value = url.toString(); calls.push(value);
      const base = { remoteAddress: '93.184.216.34', status: 200 };
      if (url.pathname === '/robots.txt') return { ...base, contentType: 'text/plain', bytes: Buffer.from('') };
      if (value === page) return { ...base, contentType: 'text/html', bytes: Buffer.from(html) };
      if (value === largeUrl || value === smallUrl) return { ...base, contentType: 'image/png', bytes: value === largeUrl ? large : small };
      throw new Error(`Unexpected image URL: ${value}`);
    },
  };
  const image = await prepareWebsiteImage(new URL(page).origin, page, largeUrl, io);
  assert.deepEqual(Buffer.from(image.originalData!, 'base64'), large);
  assert.equal(image.image?.width, 900);
  assert.equal(image.image?.height, 600);
  assert.ok(calls.includes(largeUrl));
  assert.ok(calls.includes(smallUrl));
  assert.ok(calls.every(url => [page, new URL('/robots.txt', page).toString(), largeUrl, smallUrl].includes(url)), calls.join('\n'));
});

test('hidden pixel exclusion applies to img rather than picture source metadata', () => {
  const [image] = extractWebsiteImages('<picture><source width="1" height="1" hidden srcset="/real-photo.jpg 1200w"></picture>', page);
  assert.equal(image?.url, absolute('/real-photo.jpg'));
});

test('future-compatible height descriptor requires a width and rejects duplicate or density combinations', () => {
  for (const descriptor of ['1200w 800h', '800h 1200w']) {
    const [image] = extractWebsiteImages(`<img srcset="/large.jpg ${descriptor}, /small.jpg 400w">`, page);
    assert.equal(image.url, absolute('/large.jpg'), descriptor);
  }
  for (const descriptor of ['800h', '800h 0w', '1200w 800h 900h', '800h 2x', '2x 800h']) {
    const [image] = extractWebsiteImages(`<img src="/fallback.jpg" srcset="/bad.jpg ${descriptor}">`, page);
    assert.equal(image.url, absolute('/fallback.jpg'), descriptor);
  }
});

test('descriptor scanning uses ASCII whitespace and contains malformed parenthesized groups', () => {
  assert.equal(extractWebsiteImages('<img srcset="/large.jpg\t1200w,\n/small.jpg 400w">', page)[0].url, absolute('/large.jpg'));
  for (const malformed of ['1200w\u00a0800h', '(1200w, 800h)', '{1200w}', '(nested(1,2))']) {
    const [image] = extractWebsiteImages(`<img srcset="/bad.jpg ${malformed}, /good.jpg 100w">`, page);
    assert.equal(image.url, absolute('/good.jpg'), malformed);
    assert.deepEqual(image.variants, [absolute('/good.jpg')], malformed);
  }
  assert.equal(extractWebsiteImages('<img src="/fallback.jpg" srcset="/bad.jpg (1200w, /lost.jpg 400w">', page)[0].url, absolute('/fallback.jpg'));
});

test('numeric descriptor bounds reject non-finite ranks without rejecting valid zero or exponents', () => {
  for (const descriptor of ['1e999x', `${'9'.repeat(400)}w`, '-1e2x', '+2x', '1.x']) {
    assert.equal(extractWebsiteImages(`<img src="/fallback.jpg" srcset="/bad.jpg ${descriptor}">`, page)[0].url, absolute('/fallback.jpg'), descriptor);
  }
  for (const descriptor of ['-0x', '.5x', '1E+2x', '1e-999x', '0001w']) {
    assert.equal(extractWebsiteImages(`<img srcset="/valid.jpg ${descriptor}">`, page)[0]?.url, absolute('/valid.jpg'), descriptor);
  }
});
