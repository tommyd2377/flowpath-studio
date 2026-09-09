import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationView } from '../../packages/platform-ui/src/Runtime.js';
import { MediaProvider, MediaImage } from '../../packages/platform-ui/src/MediaViews.js';
import { validateCatalog } from '../../packages/platform-ui/src/contracts.js';
import { comparisonPlan, detailPlan, initialInteraction } from '../../packages/platform-ui/src/interaction.js';

const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));

test('comparison and relationship visibility markers refer to their actual published entities', () => {
  const plan = comparisonPlan(catalog, ['class-handbuilding', 'class-wheel']);
  const comparison = renderToStaticMarkup(createElement(PresentationView, { catalog, plan, state: initialInteraction(catalog) }));
  assert.match(comparison, /<th scope="col" data-entity-id="class-wheel"/);
  assert.match(comparison, /<td data-entity-id="class-wheel"/);
  assert.match(comparison, /<article data-entity-id="class-handbuilding"/);
  const detail = renderToStaticMarkup(createElement(PresentationView, { catalog, plan: detailPlan(catalog, 'class-handbuilding'), state: initialInteraction(catalog) }));
  assert.match(detail, /<button type="button" data-entity-id="instructor-lane"/);
});

test('rendered media identifies its published photo source rather than inferred entity identity', () => {
  const library = { schemaVersion: 1 as const, id: 'media', assets: [{ id: 'photo-one', width: 800, height: 600, caption: 'Example photo', alt: 'Synthetic fixture' }], albums: [], associations: [] };
  const html = renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl: () => '/example.webp' }, createElement(MediaImage, { assetId: 'photo-one', interactive: false })));
  assert.match(html, /data-source-id="photo:photo-one"/);
  assert.doesNotMatch(html, /data-entity-id/);
});
