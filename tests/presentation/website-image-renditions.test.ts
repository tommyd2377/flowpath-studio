import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MediaImage, MediaProvider, type MediaImageProps } from '../../packages/platform-ui/src/MediaViews.js';
import { ContentCard, PublishedWebsite, type WebsiteSection } from '../../packages/platform-ui/src/PublishedWebsite.js';
import type { MediaLibrary } from '../../packages/platform-ui/src/media.js';

const source = (id: string, size: string) => `/synthetic/${id}/${size}.webp`;
const library: MediaLibrary = {
  schemaVersion: 1, id: 'website-image-renditions', albums: [], associations: [],
  assets: [
    { id: 'hero', width: 1800, height: 900, caption: 'Wide approved photograph', alt: 'Synthetic wide photograph' },
    { id: 'logo', width: 200, height: 200, caption: 'Publisher mark', alt: 'Synthetic publisher mark' },
    ...['gallery', 'project'].flatMap(group => [
      { id: `${group}-wide`, width: 1800, height: 900, caption: `${group} wide`, alt: 'Synthetic wide photograph' },
      { id: `${group}-portrait`, width: 900, height: 1800, caption: `${group} portrait`, alt: 'Synthetic portrait photograph' },
      { id: `${group}-square`, width: 1600, height: 1600, caption: `${group} square`, alt: 'Synthetic square photograph' },
    ]),
    { id: 'story', width: 1800, height: 1200, caption: 'Approved story photograph', alt: 'Synthetic story photograph' },
  ],
};

function imageFor(html: string, id: string, size: string) {
  const image = html.match(/<img\b[^>]*>/g)?.find(tag => tag.includes(`src="${source(id, size)}"`));
  assert.ok(image, `Expected ${size} image for ${id}`);
  return image;
}

test('media rendition and loading can vary independently while existing defaults retain their behavior', () => {
  const cases: { props: MediaImageProps; rendition: string; loading: string }[] = [
    { props: { assetId: 'hero' }, rendition: 'thumb', loading: 'lazy' },
    { props: { assetId: 'hero', size: 'display' }, rendition: 'display', loading: 'eager' },
    { props: { assetId: 'hero', size: 'display', loading: 'lazy' }, rendition: 'display', loading: 'lazy' },
    { props: { assetId: 'hero', loading: 'eager' }, rendition: 'thumb', loading: 'eager' },
  ];
  for (const { props, rendition, loading } of cases) {
    const html = renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl: source }, createElement(MediaImage, props)));
    const image = imageFor(html, 'hero', rendition);
    assert.match(image, new RegExp(`loading="${loading}"`));
    assert.match(image, /width="1800" height="900"/);
    assert.match(image, /alt="Synthetic wide photograph"/);
  }
});

for (const template of ['editorial', 'showcase', 'clarity'] as const) {
  test(`${template} website uses lazy display renditions for gallery, project and story frames, retaining an eager hero`, () => {
    const sections: WebsiteSection[] = [
      ...(['gallery', 'project'] as const).map(group => ({
        id: group, title: group === 'gallery' ? 'Photographs' : 'Projects', kind: group === 'gallery' ? 'photos' as const : 'collection' as const,
        entries: library.assets.filter(asset => asset.id.startsWith(`${group}-`)).map(asset => ({ id: `entry-${asset.id}`, name: asset.caption!, imageAssetId: asset.id, kind: group === 'project' ? 'project' : undefined })),
      })),
      { id: 'stories', title: 'Our process', kind: 'stories', entries: [{ id: 'story-entry', name: 'A considered process', body: 'Approved publisher description.', imageAssetId: 'story' }] },
    ];
    const requests: { id: string; size: string }[] = [];
    const html = renderToStaticMarkup(createElement(MediaProvider, {
      library, resolveAssetUrl(id, size) { requests.push({ id, size }); return source(id, size); },
    }, createElement(PublishedWebsite, {
      name: 'Synthetic studio', headline: 'Approved photography', description: '', template, assistantEnabled: false,
      logoAssetId: 'logo', hero: { id: 'hero-entry', name: 'Lead photograph', imageAssetId: 'hero' }, sections,
      onOpen() {}, onHome() {}, onInteraction() {},
    })));

    assert.equal(requests.length, library.assets.length);
    assert.deepEqual(requests.filter(request => request.size === 'thumb'), [{ id: 'logo', size: 'thumb' }]);
    assert.match(imageFor(html, 'hero', 'display'), /loading="eager"/);
    assert.match(imageFor(html, 'logo', 'thumb'), /loading="lazy"/);
    for (const asset of library.assets.filter(asset => !['hero', 'logo'].includes(asset.id))) {
      const image = imageFor(html, asset.id, 'display');
      assert.match(image, /loading="lazy"/);
      assert.match(image, new RegExp(`width="${asset.width}" height="${asset.height}"`));
    }
    if (template === 'showcase') assert.match(html, /data-website-composition="image-grid"/);
    if (template === 'editorial') assert.match(html, /data-website-composition="editorial-gallery"/);
  });
}

test('shared assistant content cards retain lazy thumbnails', () => {
  const html = renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl: source }, createElement(ContentCard, {
    entry: { id: 'assistant-entry', name: 'Approved photograph', imageAssetId: 'gallery-wide' }, onOpen() {},
  })));
  assert.match(imageFor(html, 'gallery-wide', 'thumb'), /loading="lazy"/);
  assert.doesNotMatch(html, /\/display\.webp/);
});

test('unavailable display renditions retain the image fallback without resolving unpublished assets', () => {
  const requests: string[] = [];
  const render = (assetId: string) => renderToStaticMarkup(createElement(MediaProvider, {
    library, resolveAssetUrl(id) { requests.push(id); throw new Error('Published image unavailable'); },
  }, createElement(MediaImage, { assetId, size: 'display', loading: 'lazy', interactive: false })));
  const html = render('gallery-portrait');
  assert.match(html, /class="platform-media-unavailable" role="img" aria-label="Synthetic portrait photograph"/);
  assert.match(html, /Photo unavailable/);
  assert.doesNotMatch(html, /<img\b/);
  assert.doesNotMatch(render('unpublished-photo'), /<img\b|platform-media-image/);
  assert.deepEqual(requests, ['gallery-portrait']);
});
