import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_OPENING, openingCopy, openingInitialPresentation, openingInitialSourceIds, openingInitialSourcePresentation, openingPresentation, openingVisibility, publicationContent, validateOpening, validateOpeningWithMedia } from '../lib/site-opening';

test('automatic opening follows catalog content and supports explicit personalization', () => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));
  const content = sampleContent('photographer');
  assert.deepEqual(openingCopy(content, catalog), { headline: catalog.name, description: catalog.description });
  assert.deepEqual(openingCopy({ ...content, opening: { ...DEFAULT_OPENING, copyMode: 'personalized' } }, catalog), { headline: content.headline, description: content.description });
  assert.equal(openingCopy(content).headline, `Explore ${content.name}`);
  assert.equal(openingCopy(content).description.includes('Wedding and portrait photography'), false);
});

test('opening references compose shared components and cannot invent links', () => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));
  const content = { ...sampleContent('photographer'), opening: { ...DEFAULT_OPENING, highlights: ['Explore at your own pace'], featuredEntityIds: [catalog.entities[0].id] } };
  validateOpening(content, catalog);
  const plan = openingPresentation(content, catalog);
  assert.deepEqual(plan.components.find(component => component.type === 'collection')?.entityIds, content.opening.featuredEntityIds);
  assert.throws(() => validateOpening({ ...content, opening: { ...content.opening, capabilityIds: ['invented-checkout'] } }, catalog));
  assert.throws(() => validateOpening(content, null));
  assert.deepEqual(openingPresentation(content, { ...catalog, entities: catalog.entities.slice(1), collections: [], relationships: [] }).components[0].entityIds, []);
});

test('opening visibility is explicit, publish normalization is backward compatible, and selected refs stay bounded', () => {
  const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/classes.json', import.meta.url), 'utf8')));
  const legacy = sampleContent('photographer');
  assert.equal(openingVisibility(legacy), 'legacy');
  assert.equal(publicationContent(legacy).opening?.visibility, 'intro-only');
  const intro = { ...legacy, opening: { ...DEFAULT_OPENING, visibility: 'intro-only' as const, featuredEntityIds: [catalog.entities[0].id] } };
  assert.equal(openingInitialPresentation(intro, catalog), null);
  const media = { schemaVersion: 1 as const, id: 'media-opening', assets: [{ id: 'photo-opening', width: 1200, height: 800, caption: 'Opening photo', alt: 'A published opening photo' }], albums: [], associations: [] };
  const selected = { ...intro, opening: { ...intro.opening, visibility: 'publisher-selected' as const, initialAssetIds: ['photo-opening'] }, mediaRevisionId: media.id };
  validateOpeningWithMedia(selected, catalog, media);
  const plan = openingInitialPresentation(selected, catalog, media);
  assert.deepEqual(plan?.components.find(component => component.type === 'collection')?.entityIds, [catalog.entities[0].id]);
  assert.deepEqual(plan?.components.find(component => component.type === 'gallery')?.assetIds, ['photo-opening']);
  const selectedSources = { ...selected, opening: { ...selected.opening, initialSections: [selected.sections[0].id] } };
  assert.deepEqual(openingInitialSourceIds(selectedSources, media), ['section:' + selected.sections[0].id, 'photo:photo-opening']);
  assert.deepEqual(openingInitialSourcePresentation(selectedSources, media)?.sources, ['section:' + selected.sections[0].id]);
  assert.throws(() => validateOpeningWithMedia({ ...selected, opening: { ...selected.opening, initialAssetIds: ['missing-photo'] } }, catalog, media), /photos or albums/);
  assert.throws(() => validateOpening({ ...selected, opening: { ...selected.opening, initialSections: ['missing-section'] } }, catalog), /highlights or links/);
});
