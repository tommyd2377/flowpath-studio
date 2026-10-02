import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWebsitePage } from '../lib/website-import';

const title = 'Gourmet Tastes of New York! Shop for Gifts, Coffee, Smoked Fish & More Today! Zabar\'s is New York';
const logo = '<a class="logo-home brand" href="/" title="Zabars Home"><img class="d-lg-none mobile-logo" src="/images/Zabars-mobile-logo.png" alt="Zabars"></a>';
const document = (body: string, metadata = '') => `<html><head><title>${title}</title>${metadata}</head><body>${body}<main><h1>Gourmet gifts</h1><p>Read our store information, product descriptions and shipping conditions.</p></main></body></html>`;
const page = (body: string, metadata = '') => extractWebsitePage(document(body, metadata), 'https://www.zabars.com/shipping-info-charges.html');

test('explicit Zabar’s homepage logo identifies the publisher without guessing from its SEO title', () => {
  const result = page(logo);
  assert.equal(result.name, 'Zabars'); // Exact source alt; do not invent an apostrophe.
  assert.equal(result.title, title);
  assert.equal(result.headline, 'Gourmet gifts');
});

test('structured publisher and site-name metadata retain precedence over a logo', () => {
  assert.equal(page(logo, '<meta property="og:site_name" content="Explicit site name">').name, 'Explicit site name');
  assert.equal(page(logo, '<meta property="og:site_name" content="Explicit site name"><script type="application/ld+json">{"@type":"Organization","name":"Explicit organization"}</script>').name, 'Explicit organization');
});

test('identical desktop/mobile logo names are unambiguous; conflicting names retain title fallback', () => {
  assert.equal(page(logo + logo.replace('mobile-logo', 'desktop-logo')).name, 'Zabars');
  assert.equal(page(logo + logo.replace('alt="Zabars"', 'alt="Another publisher"')).name, title.slice(0, 80));
});

test('unmarked images and generic logo labels do not establish publisher identity', () => {
  const unmarked = '<a href="/"><img src="/photo.jpg" alt="Different publisher"></a>';
  assert.equal(page(unmarked).name, title.slice(0, 80));
  for (const name of ['', 'Logo', 'Company logo', 'Site logo', 'Home', 'Homepage', 'Image', 'Logo image', 'Home logo', 'Company name', 'Brand logo image']) {
    assert.equal(page(logo.replace('alt="Zabars"', `alt="${name}"`)).name, title.slice(0, 80));
  }
});

test('external, non-home, query, fragment and credentialed links do not supply publisher identity', () => {
  for (const href of ['https://partner.example/', '/coffee', '/?campaign=partner', '/#sponsor', 'https://user@www.zabars.com/']) {
    assert.equal(page(logo.replace('href="/"', `href="${href}"`)).name, title.slice(0, 80));
  }
});

test('hidden logo labels cannot conflict with the visible publisher identity', () => {
  const hidden = logo.replace('alt="Zabars"', 'alt="Hidden partner"');
  assert.equal(page(logo + `<div hidden>${hidden}</div>`).name, 'Zabars');
  assert.equal(page(logo + `<div aria-hidden="true">${hidden}</div>`).name, 'Zabars');
  assert.equal(page(`<div hidden>${logo}</div>`).name, title.slice(0, 80));
});

test('logo labels preserve decoded characters and image-level explicit logo markers', () => {
  assert.equal(page('<a href="/"><img class="site-logo" src="/mark.png" alt="R&amp;D"></a>').name, 'R&D');
  assert.equal(page(logo.replace('alt="Zabars"', 'alt="Actual Publisher Logo"')).name, 'Actual Publisher Logo');
});
