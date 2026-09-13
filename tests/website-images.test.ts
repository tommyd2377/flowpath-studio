import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { extractWebsiteImages } from '../lib/website-image-discovery';
import { prepareWebsiteImage } from '../lib/website-images';
import { discoverWebsite } from '../lib/website-import';
import type { WebsiteTransport } from '../lib/website-fetch';

const root = 'https://shop.example/';
const html = `<h1>Bakery</h1><p>${'Fresh cakes and pastries made for our neighborhood. '.repeat(4)}</p><img data-src="https://cdn.example/cake.png?size=900" alt="Chocolate cake">`;
async function fixture(options: { location?: string; type?: string; privateDNS?: boolean; robots?: string; invalid?: boolean } = {}) {
  const bytes = await sharp({ create: { width: 12, height: 10, channels: 3, background: '#aabbcc' } }).png().toBuffer();
  const calls: string[] = [];
  const io: WebsiteTransport = {
    resolve: async host => [{ address: options.privateDNS && host === 'cdn.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
    connect: async url => {
      calls.push(url.toString());
      const base = { remoteAddress: '93.184.216.34', status: 200 };
      if (url.pathname === '/robots.txt') return { ...base, contentType: 'text/plain', bytes: Buffer.from(options.robots || '') };
      if (url.hostname === 'shop.example') return { ...base, status: url.pathname === '/' ? 200 : 404, contentType: 'text/html', bytes: Buffer.from(html) };
      return { ...base, status: options.location ? 302 : 200, location: options.location, contentType: options.type || 'image/png', bytes: options.invalid ? Buffer.from('not an image') : bytes };
    },
  };
  return { io, calls };
}

test('finds lazy, responsive, background and metadata images; rejects unsafe URLs and deduplicates', () => {
  const result = extractWebsiteImages(`<img src="/a.png" alt="A &amp; B"><img src="/a.png"><img data-src="//cdn.example/lazy.jpg"><source srcset="/small.webp 200w, /large.webp 1200w"><meta property="og:image" content="/social.png"><div style="background-image:url('/back.jpg')"></div><img src="http://cdn.example/bad.jpg"><img src="https://127.0.0.1/a.png"><script>const x='<img src="/secret.png">'</script>`, root);
  assert.deepEqual(result.map(image => image.url), [root + 'a.png', 'https://cdn.example/lazy.jpg', root + 'large.webp', root + 'social.png', root + 'back.jpg']);
  assert.equal(result[0].alt, 'A & B'); assert.ok(result.every(image => image.pageUrl === root));
});

test('discovery exposes image references and import creates independent sanitized copies', async () => {
  const { io } = await fixture();
  const discovery = await discoverWebsite(root, io);
  assert.equal(discovery.images?.length, 1);
  const image = await prepareWebsiteImage(root, root, discovery.images![0].url, io);
  assert.equal(image.mime, 'image/webp'); assert.equal(image.image?.caption, 'Chocolate cake');
  assert.equal((await sharp(Buffer.from(image.data!, 'base64')).metadata()).format, 'webp');
  assert.ok(image.originalData); assert.ok(image.thumbnailData);
  const again = await prepareWebsiteImage(root, root, discovery.images![0].url, io);
  assert.equal(image.image?.hash, again.image?.hash);
});

test('rejects unreferenced URLs, foreign source pages, private DNS and unsafe redirects before download', async () => {
  const first = await fixture();
  await assert.rejects(prepareWebsiteImage(root, root, 'https://cdn.example/other.png', first.io), /no longer referenced/);
  assert.ok(!first.calls.some(url => url.includes('cdn.example')));
  await assert.rejects(prepareWebsiteImage(root, 'https://other.example/', 'https://cdn.example/cake.png?size=900', first.io), /source/);
  for (const options of [{ privateDNS: true }, { location: 'https://127.0.0.1/secret' }, { robots: 'User-agent: *\nDisallow: /' }, { type: 'image/svg+xml' }, { invalid: true }]) {
    const { io } = await fixture(options);
    await assert.rejects(prepareWebsiteImage(root, root, 'https://cdn.example/cake.png?size=900', io));
  }
});

test('compares decoded dimensions across original, responsive and lazy variants and retains exact best bytes', async () => {
  const images = new Map<string, Buffer>();
  for (const [path, width] of [['/original.png', 2500], ['/responsive.png', 120], ['/lazy.png', 240], ['/thumb.png', 24]] as const) {
    images.set(path, await sharp({ create: { width, height: 10, channels: 3, background: '#bbaacc' } }).png().toBuffer());
  }
  const source = `${html}<img data-original="https://cdn.example/original.png" data-src="https://cdn.example/lazy.png" src="https://cdn.example/thumb.png" srcset="https://cdn.example/responsive.png 5000w" alt="Full cake">`;
  const { io } = await fixture();
  const connect = io.connect;
  io.connect = async (url, address, signal) => url.pathname === '/' ? { remoteAddress: address.address, status: 200, contentType: 'text/html', bytes: Buffer.from(source) }
    : images.has(url.pathname) ? { remoteAddress: address.address, status: 200, contentType: 'image/png', bytes: images.get(url.pathname)! } : connect(url, address, signal);
  const result = await prepareWebsiteImage(root, root, 'https://cdn.example/original.png', io);
  assert.deepEqual(Buffer.from(result.originalData!, 'base64'), images.get('/original.png'));
  assert.equal(result.image?.width, 2000); // Optimized display is separate from the retained 2500px original.
  images.delete('/original.png');
  const fallback = await prepareWebsiteImage(root, root, 'https://cdn.example/original.png', io);
  assert.deepEqual(Buffer.from(fallback.originalData!, 'base64'), images.get('/lazy.png'));
});

test('quoted gallery markup does not hide originals or responsive candidates', () => {
  const [image] = extractWebsiteImages('<img data-sub-html="<span>Gallery</span>" data-original="/original.png" data-full-src="/full.png" data-src="/lazy.png" data-lazy-src="/lazy-small.png" src="/thumb.png" srcset="/medium.png 800w, /large.png 2400w" alt="Cake &amp; cream">', root);
  assert.equal(image.url, root + 'original.png');
  assert.equal(image.alt, 'Cake & cream');
  assert.ok(image.variants?.includes(root + 'large.png'));
  assert.ok(image.variants?.includes(root + 'medium.png'));
  assert.ok(image.variants?.includes(root + 'full.png'));
  assert.equal(image.variants?.length, 7);
  assert.ok(image.variants?.includes(root + 'thumb.png'));
  assert.ok(image.variants?.includes(root + 'lazy-small.png'));
});

test('common builder transformations retain original candidates before optimized copies', async()=>{
 const {originalImageCandidates}=await import('../lib/website-image-discovery');
 assert.equal(originalImageCandidates('https://static.wixstatic.com/media/cake.jpg/v1/fill/w_400,h_300/cake.jpg',root)[0],'https://static.wixstatic.com/media/cake.jpg');
 assert.equal(originalImageCandidates('https://images.squarespace-cdn.com/content/v1/cake.jpg?format=500w',root)[0],'https://images.squarespace-cdn.com/content/v1/cake.jpg');
 assert.deepEqual(originalImageCandidates('https://x.assetcdn.net/2.0/123/wp-content/uploads/cake-300x200.jpg?lossy=2&webp=1',root),['https://shop.example/wp-content/uploads/cake.jpg','https://x.assetcdn.net/2.0/123/wp-content/uploads/cake-300x200.jpg']);
});

test('downloads a larger WordPress original instead of its CDN preview and retains exact bytes', async()=>{
 const original=await sharp({create:{width:1200,height:800,channels:3,background:'#123456'}}).png().toBuffer();
 const preview=await sharp(original).resize(120,80).webp().toBuffer();
 const imageUrl='https://x.assetcdn.net/2.0/123/wp-content/uploads/cake-120x80.png?lossy=2&webp=1';
 const io:WebsiteTransport={resolve:async()=>[{address:'93.184.216.34',family:4}],connect:async u=>({remoteAddress:'93.184.216.34',status:200,contentType:u.hostname==='shop.example'?'image/png':'image/webp',bytes:u.hostname==='shop.example'?original:preview})};
 const result=await prepareWebsiteImage(root,root,imageUrl,io,{url:imageUrl,pageUrl:root,alt:'Cake',variants:[imageUrl]});
 assert.deepEqual(Buffer.from(result.originalData!,'base64'),original);assert.equal(result.image?.width,1200);
});
