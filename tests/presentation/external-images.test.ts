import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExternalSearchResults, type ExternalSearchResult } from '../../packages/platform-ui/src/ExternalSearchResults.js';
import { externalItemLabel } from '../../packages/platform-ui/src/workspace.js';

const result: ExternalSearchResult = { id: 'synthetic-images', kind: 'images', query: 'Synthetic design reference images', fetchedAt: '2026-09-19T12:00:00.000Z', demo: true,
  answer: 'These reference images are examples, not verified publisher photographs.', sources: [], citations: [], map: null,
  images: Array.from({ length: 7 }, (_, index) => ({ id: `image-${index}`, url: `https://example.com/image-${index}.jpg`, thumbnail: `https://example.com/thumb-${index}.jpg`, sourceUrl: `https://example.com/source-${index}`, caption: `Synthetic reference ${index + 1}` })) };
const render = (value: ExternalSearchResult, surface = true) => renderToStaticMarkup(createElement(ExternalSearchResults, { result: value, kind: value.kind, selected: null,
  surface, showViewer: false, onInteraction() {}, onCommand() {} }));

test('surface image grids lead with a compact count while preserving image codes, accessible guidance and source evidence', () => {
  const html = render(result);
  assert.match(html, /data-image-grid="true" data-item-count="7"/);
  assert.match(html, /class="platform-external-imageCount" aria-label="7 images for Synthetic design reference images">7 images<\/h3>/);
  assert.doesNotMatch(html, /<h3>Synthetic design reference images<\/h3>/);
  assert.match(html, /class="platform-sr-only">Open an image by number or code/);
  const guidance = /<p id="([^"]+)" class="platform-sr-only">/.exec(html); assert.ok(guidance);
  assert.ok(html.includes(`aria-describedby="${guidance[1]}"`));
  assert.ok(html.indexOf('class="platform-external-gallery"') < html.indexOf(result.answer), 'Accompanying qualifications remain below the visual results');
  for (const [index, image] of result.images.entries()) {
    assert.ok(html.includes(`data-external-label="${externalItemLabel(index)}"`));
    assert.ok(html.includes(`aria-label="Open image ${index + 1}: ${image.caption} (${externalItemLabel(index)})"`));
    assert.ok(html.includes(`href="${image.sourceUrl}"`));
  }
  assert.ok(html.includes(result.answer));
});

test('empty images and ordinary web results retain explanatory text and do not request expanded image-grid sizing', () => {
  for (const value of [{ ...result, images: [], answer: 'No matching images were returned.' }, { ...result, kind: 'web' as const }]) {
    const html = render(value);
    assert.doesNotMatch(html, /data-image-grid|platform-external-imageCount/);
    assert.ok(html.includes(value.answer)); assert.ok(html.includes(value.query));
  }
  const standalone = render(result, false);
  assert.doesNotMatch(standalone, /data-image-grid|platform-external-imageCount/);
  assert.match(standalone, /class="platform-external-help">Open an image by number or code/);
});
