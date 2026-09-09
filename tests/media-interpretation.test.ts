import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { initialSite } from '../lib/local-store';
import { suggestMediaLocally, mergeMediaSuggestions } from '../lib/media-interpretation';
import { demoPresentation, presentationJsonSchema, presentationSummary, validatePresentation } from '../lib/site-presentation';

function fixture() {
  const site = initialSite('photographer');
  const ids = [randomUUID(), randomUUID()];
  site.files = ids.map((id, index) => ({ id, name: index ? 'IMG_1234.jpg' : 'Wedding garden.jpg', size: 40, mime: 'image/webp', uploadedAt: '2026-09-09', kind: 'image', image: { width: 800, height: 600, hash: 'a'.repeat(64) } }));
  const library: MediaLibrary = { schemaVersion: 1, id: randomUUID(), assets: [], albums: [], associations: [] };
  return { site, ids, library };
}

test('local photo suggestions are reviewable, scope explicit group context and preserve publisher metadata', () => {
  const { site, ids, library } = fixture();
  const first = suggestMediaLocally(site, { fileIds: ids, context: 'These photos show Wedding stories.', library }, null);
  assert.equal(first.mode, 'local');
  assert.equal(first.library.associations.length, 2);
  assert.ok(first.library.associations.every(link => link.targetId === 'weddings'));
  assert.equal(first.library.assets[1].caption, '');
  assert.equal(site.draft.mediaRevisionId, undefined);
  first.library.assets[0].caption = 'Publisher correction';
  const repeat = suggestMediaLocally(site, { fileIds: [ids[0]], context: '', library: first.library }, null);
  assert.equal(repeat.library.assets[0].caption, 'Publisher correction');
  assert.equal(repeat.library.associations.length, 2);
  assert.equal(library.assets.length, 0);
});

test('mixed/negative batch descriptions do not silently label every photo with one identity', () => {
  const { site, ids, library } = fixture();
  for (const context of ['These are not Wedding stories.', 'Only the first photo shows Wedding stories.', 'Wedding stories and Portrait sessions']) {
    assert.equal(suggestMediaLocally(site, { fileIds: ids, context, library }, null).library.associations.length, 0);
  }
  assert.throws(() => suggestMediaLocally(site, { fileIds: [randomUUID()], context: '', library }, null), /uploaded/);
  assert.throws(() => suggestMediaLocally(site, { fileIds: [ids[0], ids[0]], context: '', library }, null), /once/);
});

test('model photo suggestions reject incomplete, foreign, duplicate and unsupported target references', () => {
  const { site, ids } = fixture();
  const base = suggestMediaLocally(site, { fileIds: ids, context: '' }, null).library;
  base.assets[0].caption = 'Publisher correction';
  const photo = (id: string) => ({ id, caption: 'A garden', alt: 'Flowers in a garden', targetType: null, targetId: null, role: 'depicts', note: '' });
  for (const photos of [[photo(ids[0])], [photo(ids[0]), photo(ids[0])], [photo(ids[0]), photo(randomUUID())]]) {
    assert.throws(() => mergeMediaSuggestions({ photos }, base, site, ids, null));
  }
  assert.throws(() => mergeMediaSuggestions({ photos: [{ ...photo(ids[0]), targetType: 'entity', targetId: 'invented-product' }, photo(ids[1])] }, base, site, ids, null));
  const result = mergeMediaSuggestions({ photos: [photo(ids[0]), photo(ids[1])] }, base, site, ids, null);
  assert.equal(result.library.assets[0].caption, 'Publisher correction');
  assert.equal(result.library.assets[1].caption, 'A garden');
  assert.equal(base.assets[1].caption, '');
});

test('photo-first published sites select only existing album or photo references and preserve album order', () => {
  const { site, ids } = fixture();
  const library = suggestMediaLocally(site, { fileIds: ids, context: '' }, null).library;
  library.albums.push({ id: 'garden', title: 'Garden wedding', description: 'A wedding in the garden', assetIds: [...ids].reverse() });
  const plan = demoPresentation(site.draft, 'Show me your garden wedding album', [], library);
  assert.equal(plan.layout, 'gallery');
  assert.deepEqual(plan.sources, ['album:garden']);
  assert.deepEqual(library.albums[0].assetIds, [...ids].reverse());
  assert.equal(demoPresentation(site.draft, 'Show me your photos', [], library).layout, 'gallery');
  assert.throws(() => validatePresentation({ layout: 'gallery', status: 'ready', sources: ['photo:private-file'] }, site.draft, library));
  assert.throws(() => validatePresentation({ layout: 'cards', status: 'ready', sources: ['photos'] }, site.draft, library));
  assert.throws(() => validatePresentation(plan, site.draft));
  assert.ok(JSON.stringify(presentationJsonSchema(site.draft, library)).includes('album:garden'));
  const history = [{ role: 'assistant', text: presentationSummary(plan, site.draft, library) }];
  for (const query of ['show the second photo', 'show photos of the second one', 'the second one']) {
    assert.throws(() => demoPresentation(site.draft, query, history, library), /Open the photo/);
  }
  assert.deepEqual(demoPresentation(site.draft, 'show that again', history, library), plan);
  library.albums[0].title = 'First light';
  assert.deepEqual(demoPresentation(site.draft, 'photos of First light', history, library).sources, ['album:garden']);
});
