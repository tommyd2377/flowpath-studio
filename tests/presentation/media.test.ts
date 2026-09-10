import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaForTarget, galleryAssetIds, validateMediaLibrary, type MediaLibrary } from '../../packages/platform-ui/src/media.js';
import { MediaProvider, MediaGallery, EntityMedia } from '../../packages/platform-ui/src/MediaViews.js';
import { validateCatalog, validatePlan, type PresentationPlan } from '../../packages/platform-ui/src/contracts.js';
import { initialInteraction, planForIntent, galleryPlanForIntent } from '../../packages/platform-ui/src/interaction.js';
import { compilePresentation } from '../../packages/platform-ui/src/compile.js';
import { preflightPresentation } from '../../packages/platform-ui/src/preflight.js';
import { PresentationView } from '../../packages/platform-ui/src/Runtime.js';

const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../../fixtures/catalogs/bookstore.json', import.meta.url), 'utf8')));
const targetId = catalog.entities[0].id;
const otherId = catalog.entities[1].id;
const source = (id: string, size: string) => `/images/${id}?size=${size}`;
function fixture(): MediaLibrary {
  return { schemaVersion: 1, id: 'media-revision-1', assets: [
    { id: 'photo-1', width: 1600, height: 900, caption: 'The reading room', alt: 'A reading room with books' },
    { id: 'photo-2', width: 900, height: 1600, caption: 'A book cover', alt: 'The publisher’s book cover', credit: 'Publisher' },
    { id: 'photo-3', width: 1200, height: 1200, caption: 'An example reading group', alt: 'Readers around a table' },
  ], albums: [{ id: 'album-1', title: 'Inside the shop', description: 'Our space and books', assetIds: ['photo-2', 'photo-1'], coverAssetId: 'photo-1' }], associations: [
    { id: 'link-1', assetId: 'photo-1', targetType: 'entity', targetId, role: 'depicts' },
    { id: 'link-2', assetId: 'photo-2', targetType: 'entity', targetId, role: 'depicts', primary: true },
    { id: 'link-3', assetId: 'photo-3', targetType: 'entity', targetId: otherId, role: 'example' },
  ] };
}

test('media references, dimensions, covers and target kinds are strict and bounded', () => {
  const library = fixture();
  assert.deepEqual(validateMediaLibrary(library, { entityIds: catalog.entities.map(entity => entity.id) }), library);
  for (const mutate of [
    (value: MediaLibrary) => { value.assets[0].width = 0; },
    (value: MediaLibrary) => { value.assets[0].id = value.assets[1].id; },
    (value: MediaLibrary) => { value.albums[0].assetIds.push('missing'); },
    (value: MediaLibrary) => { value.albums[0].coverAssetId = 'photo-3'; },
    (value: MediaLibrary) => { value.associations[0].assetId = 'missing'; },
    (value: MediaLibrary) => { delete value.associations[0].targetId; },
    (value: MediaLibrary) => { value.associations[0].targetType = 'site'; },
    (value: MediaLibrary) => { value.associations[0].targetId = 'missing'; },
    (value: MediaLibrary) => { value.associations[0].primary = true; },
  ]) { const invalid = structuredClone(library); mutate(invalid); assert.throws(() => validateMediaLibrary(invalid, { entityIds: catalog.entities.map(entity => entity.id) })); }
  assert.throws(() => validateMediaLibrary({ ...library, assets: Array.from({ length: 101 }, (_, index) => ({ ...library.assets[0], id: `photo-${index}` })) }));
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => validateMediaLibrary(cyclic));
});

test('one photo can serve several targets without changing album order or confusing examples with exact photos', () => {
  const library = fixture();
  library.associations.push({ id: 'site-photo', assetId: 'photo-1', targetType: 'site', role: 'depicts' });
  const valid = validateMediaLibrary(library);
  assert.deepEqual(mediaForTarget(valid, { targetType: 'entity', targetId }).map(item => item.asset.id), ['photo-2', 'photo-1']);
  assert.deepEqual(mediaForTarget(valid, { targetType: 'entity', targetId: otherId }), []);
  assert.equal(mediaForTarget(valid, { targetType: 'entity', targetId: otherId }, true)[0].association.role, 'example');
  assert.deepEqual(galleryAssetIds(valid, { albumId: 'album-1' }), ['photo-2', 'photo-1']);
  assert.deepEqual(galleryAssetIds(valid, { albumId: 'album-1', entityIds: [otherId] }), []);
  assert.deepEqual(galleryAssetIds(valid, { albumId: 'unknown' }), []);
});

test('controlled galleries reject unpublished photos, incorrect contexts and absent media', () => {
  const library = fixture();
  const plan = planForIntent(catalog, 'show photos', initialInteraction(catalog), library);
  const gallery = plan.components[0];
  assert.equal(gallery.type, 'gallery');
  assert.throws(() => validatePlan(plan, catalog, catalog.id));
  for (const component of [
    { ...gallery, assetIds: ['unpublished-photo'] },
    { ...gallery, albumId: 'unknown' },
    { ...gallery, albumId: 'album-1', assetIds: ['photo-3'] },
    { ...gallery, entityIds: [targetId], assetIds: ['photo-3'] },
    { ...gallery, assetIds: [] },
    { ...gallery, attributeIds: [catalog.attributes[0].id] },
  ]) assert.throws(() => validatePlan({ ...plan, components: [component] }, catalog, catalog.id, library));
  assert.throws(() => validatePlan({ ...plan, snapshotId: 'stale' }, catalog, catalog.id, library));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...gallery, id: 'collection', type: 'collection', assetIds: ['photo-1'] }] }, catalog, catalog.id, library));
});

test('runtime shortlist can join a seven-section gallery composition without exceeding the parser boundary', () => {
  const library = fixture();
  const catalogWithAction = validateCatalog({ ...catalog, capabilities: [{ id: 'visit', kind: 'link', label: 'Visit publisher', url: 'https://example.com/books', entityIds: [targetId] }] });
  const plan: PresentationPlan = { schemaVersion: 1, snapshotId: catalog.id, operation: 'discover', transition: { type: 'reveal' }, components: [
    { id: 'collection', type: 'collection', variant: 'grid', entityIds: [], attributeIds: [] },
    { id: 'criteria', type: 'criteria', variant: 'compact', entityIds: [], attributeIds: [catalog.attributes[0].id] },
    { id: 'detail', type: 'detail', variant: 'expanded', entityIds: [targetId], attributeIds: [] },
    { id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: [targetId, otherId], attributeIds: [catalog.attributes[0].id] },
    { id: 'relationships', type: 'relationships', variant: 'list', entityIds: [targetId], attributeIds: [] },
    { id: 'actions', type: 'actions', variant: 'compact', entityIds: [targetId], attributeIds: [], capabilityIds: ['visit'] },
    { id: 'gallery', type: 'gallery', variant: 'grid', entityIds: [targetId], attributeIds: [] },
  ] };
  validatePlan(plan, catalogWithAction, catalog.id, library);
  plan.components.push({ id: 'selection', type: 'selection', variant: 'compact', entityIds: [], attributeIds: [] });
  const parsed = preflightPresentation(compilePresentation(catalogWithAction, plan, catalog.id, library));
  assert.equal((parsed.root!.props.sections as unknown[]).length, 8);
  assert.equal(parsed.meta.statementCount, 9);
  assert.throws(() => validatePlan({ ...plan, components: [...plan.components, plan.components[0]] }, catalogWithAction, catalog.id, library));
});

test('photo intents follow publisher associations and visible entity ordering, with honest no-match behavior', () => {
  const library = fixture();
  const state = { ...initialInteraction(catalog), entityIds: [otherId, targetId] };
  const plan = planForIntent(catalog, 'show photos of the second item', state, library);
  assert.deepEqual(plan.components[0].entityIds, [targetId]);
  assert.deepEqual(galleryAssetIds(library, plan.components[0]), ['photo-1', 'photo-2']);
  assert.equal(planForIntent(catalog, 'photos of Inside the shop', state, library).components[0].albumId, 'album-1');
  const namedAlbum = fixture(); namedAlbum.albums[0].title = 'First light';
  assert.equal(planForIntent(catalog, 'photos of First light', state, namedAlbum).components[0].albumId, 'album-1');
  assert.equal(galleryPlanForIntent(catalog, 'compare books', state, library), null);
  for (const query of ['show the second photo', 'photos of the second one', 'show the third image', 'the first album']) assert.throws(() => planForIntent(catalog, query, state, library), /Open a photo or name its album/);
  assert.throws(() => planForIntent(catalog, 'photos of an unknown castle', state, library), /No published photos/);
  assert.throws(() => planForIntent(catalog, 'photos of this', { ...state, focusedId: catalog.entities.at(-1)!.id }, library), /no published photos/i);
});

test('real parser and shared SSR render galleries without injecting publisher captions into OpenUI code', () => {
  const library = fixture();
  library.assets[0].caption = '<script>alert(1)</script> "); root = Query("remote", {})';
  const plan: PresentationPlan = planForIntent(catalog, 'show photos', initialInteraction(catalog), library);
  const code = compilePresentation(catalog, plan, catalog.id, library);
  assert.ok(!code.includes(library.assets[0].caption));
  const parsed = preflightPresentation(code);
  assert.deepEqual(parsed.meta.errors, []);
  assert.equal((parsed.root!.props.sections as { typeName: string }[])[0].typeName, 'PhotoGallery');
  const html = renderToStaticMarkup(createElement(PresentationView, { catalog, plan, state: initialInteraction(catalog), media: library, resolveAssetUrl: source }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /width="1600" height="900"/);
  assert.match(html, /loading="lazy"/);
  assert.doesNotMatch(html, /<dialog/);
  assert.match(html, /photo-1\?size=display/);
});

test('standalone gallery and host entity images share resolution and explicit example labels', () => {
  const library = fixture();
  const standalone = renderToStaticMarkup(createElement(MediaGallery, { library, resolveAssetUrl: source, albumId: 'album-1' }));
  assert.ok(standalone.indexOf('A book cover') < standalone.indexOf('The reading room'));
  assert.ok(!standalone.includes('An example reading group'));
  const exact = renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl: source }, createElement(EntityMedia, { targetId: otherId })));
  assert.doesNotMatch(exact, /<img/);
  const example = renderToStaticMarkup(createElement(MediaProvider, { library, resolveAssetUrl: source }, createElement(EntityMedia, { targetId: otherId, includeExamples: true, interactive: false })));
  assert.match(example, /Example photo/);
  assert.doesNotMatch(example, /<button/);
  const scoped = renderToStaticMarkup(createElement(MediaGallery, { library, resolveAssetUrl: source, entityIds: [otherId] }));
  assert.match(scoped, /Example photo/);
  assert.doesNotMatch(scoped, /A book cover/);
  const all = renderToStaticMarkup(createElement(MediaGallery, { library, resolveAssetUrl: source }));
  assert.match(all, /Example photo/);
  const exactScope = renderToStaticMarkup(createElement(MediaGallery, { library, resolveAssetUrl: source, entityIds: [targetId] }));
  assert.doesNotMatch(exactScope, /Example photo/);
});
