import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MediaProvider } from '../../packages/platform-ui/src/MediaViews.js';
import { PublishedWebsite, type WebsiteEntry, type WebsiteSection } from '../../packages/platform-ui/src/PublishedWebsite.js';
import type { MediaLibrary } from '../../packages/platform-ui/src/media.js';
import type { WebsiteTemplate } from '../../packages/platform-ui/src/site-design.js';

const library: MediaLibrary = {
  schemaVersion: 1, id: 'image-placement', associations: [], albums: [], assets: [
    { id: 'opening', width: 1134, height: 709, caption: 'Complete illustrative collage', alt: 'Synthetic collage with content at every edge' },
    { id: 'wide', width: 1800, height: 900, caption: 'Wide photograph', alt: 'Synthetic landscape' },
    { id: 'portrait', width: 500, height: 2000, caption: 'Tall photograph', alt: 'Synthetic portrait' },
    { id: 'panorama', width: 3000, height: 600, caption: 'Panorama', alt: 'Synthetic panorama' },
  ],
};
const opening: WebsiteEntry = { id: 'photo:opening', name: 'Opening collage', imageAssetId: 'opening', caption: 'Complete illustrative collage', example: true, credit: 'Synthetic test artwork' };
const photo = (assetId: string): WebsiteEntry => ({ id: `photo:${assetId}`, name: `Photograph ${assetId}`, imageAssetId: assetId });
const album = (entries: WebsiteEntry[]): WebsiteSection => ({ id: 'album', title: 'Reviewed album', kind: 'photos', entries });
const source = (id: string, size: string) => `/synthetic/${id}/${size}.webp`;

function render(sections: WebsiteSection[], options: { template?: WebsiteTemplate; hero?: WebsiteEntry | null; failImages?: boolean } = {}) {
  return renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl(id, size) {
    if (options.failImages) throw new Error('Image unavailable');
    return source(id, size);
  } }, createElement(PublishedWebsite, {
    name: 'Synthetic publisher', headline: 'Approved image compositions', description: '', assistantEnabled: false,
    template: options.template ?? 'clarity', websiteMotion: 'expressive', hero: options.hero === null ? undefined : options.hero ?? opening,
    sections, onOpen() {}, onHome() {}, onInteraction() {},
  })));
}

function card(html: string, id: string) {
  const result = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(markup => markup.includes(`data-workspace-content="${id}"`));
  assert.ok(result, `Expected a manually accessible card for ${id}`);
  return result;
}

for (const template of ['editorial', 'showcase', 'clarity'] as const) {
  test(`${template} keeps full gallery compositions and replaces the repeated opening image with an accessible reference`, () => {
    const sections = [album([opening, photo('wide'), photo('portrait'), photo('panorama')])], before = structuredClone(sections);
    const html = render(sections, { template });
    assert.equal((html.match(/src="\/synthetic\/opening\/display.webp"/g) ?? []).length, 1);
    assert.match(html, /data-photo-count="3"/);
    assert.match(html, /4 photos/);
    assert.match(html, /href="#[^"]*-album"/);
    const reference = card(html, opening.id);
    for (const text of ['Opening photograph', opening.name, opening.caption!, opening.credit!, 'Illustrative example', 'View photograph']) assert.ok(reference.includes(text), text);
    assert.match(reference, /data-opening-photo="true"/);
    assert.match(reference, /aria-label="Open Opening collage"/);
    assert.doesNotMatch(reference, /<img\b|platform-media-image|platform-website-image-frame/);
    assert.ok(html.indexOf('data-workspace-content="photo:wide"') < html.indexOf('data-workspace-content="photo:opening"'));
    for (const [id, ratio] of [['wide', '2'], ['portrait', '0.8'], ['panorama', '2.2']]) {
      const imageCard = card(html, `photo:${id}`);
      assert.match(imageCard, /data-fit="contain"/);
      assert.ok(imageCard.includes(`--website-gallery-ratio:${ratio}`));
      assert.match(imageCard, /loading="lazy"/);
      assert.match(imageCard, /\/display.webp/);
      assert.doesNotMatch(imageCard, /data-website-depth|data-website-frame/);
    }
    assert.deepEqual(sections, before, 'rendering retains canonical album order and every entry');
  });
}

test('one-photo albums keep their section, count and opening reference; one alternative reserves a single photo column', () => {
  const single = render([album([opening])]);
  assert.match(single, /data-photo-count="0"/);
  assert.match(single, /1 photo/);
  assert.match(card(single, opening.id), /Opening photograph/);
  const pair = render([album([opening, photo('wide')])]);
  assert.match(pair, /data-photo-count="1"/);
  assert.match(pair, /2 photos/);
  assert.match(card(pair, 'photo:wide'), /data-fit="contain"/);
});

test('opening deduplication leaves record and story illustrations in their own contexts', () => {
  const html = render([
    album([opening, photo('wide')]),
    { id: 'projects', title: 'Projects', kind: 'collection', entries: [{ ...opening, id: 'project:one', kind: 'project' }] },
    { id: 'stories', title: 'Stories', kind: 'stories', entries: [{ ...opening, id: 'story:one', body: 'Approved story context.' }] },
  ]);
  assert.equal((html.match(/src="\/synthetic\/opening\/display.webp"/g) ?? []).length, 3);
  assert.match(card(html, 'project:one'), /data-fit="cover"/);
  assert.doesNotMatch(card(html, 'project:one'), /data-opening-photo/);
  assert.match(html, /Approved story context/);
});

test('without a resolved approved hero, galleries retain their normal image and no opening reference', () => {
  for (const hero of [null, { ...opening, imageAssetId: 'unpublished' }]) {
    const html = render([album([opening])], { hero });
    assert.match(card(html, opening.id), /src="\/synthetic\/opening\/display.webp"/);
    assert.doesNotMatch(html, /data-opening-photo="true"|Opening photograph/);
  }
});

test('failed image resolution preserves unavailable fallbacks and the opening reference action', () => {
  const html = render([album([opening, photo('wide')])], { failImages: true });
  assert.equal((html.match(/Photo unavailable/g) ?? []).length, 2);
  assert.match(card(html, opening.id), /aria-label="Open Opening collage"/);
  assert.match(card(html, 'photo:wide'), /Photo unavailable/);
  assert.doesNotMatch(html, /<img\b/);
});

test('photo alternatives lead the bounded preview while every entry remains available through expansion', () => {
  const alternatives = Array.from({ length: 9 }, (_, index) => ({ ...photo('wide'), id: `alternative:${index}`, name: `Alternative ${index}` }));
  const section = album([opening, ...alternatives]), before = structuredClone(section);
  const html = render([section]);
  assert.match(html, /10 photos/);
  assert.match(html, /Explore all 10/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-workspace-content="alternative:7"/);
  assert.doesNotMatch(html, /data-workspace-content="alternative:8"|data-opening-photo="true"/);
  assert.deepEqual(section, before);
});
