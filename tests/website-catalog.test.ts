import test from 'node:test';
import assert from 'node:assert/strict';
import { websiteTaskFixture } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { websiteCatalogEntry } from '../lib/website-catalog';
import { addPublishedMedia } from '@thevoice/platform-ui/collection-space';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';

test('v2 website pages retain kinds and approved price qualifications within the card bound', () => {
  const space = websiteTaskFixture('services', 3);
  const price = space.fields.find(field => field.id === 'price')!;
  price.label = 'Listed price (USD)';
  space.fields.push({ ...space.fields[0], id: 'another', label: 'Other attribute' });
  space.fields.unshift(space.fields.pop()!);
  const record = space.records[1];
  record.assertions.push({ ...record.assertions[0], id: 'another-value', fieldId: 'another' });
  record.assertions.find(fact => fact.fieldId === 'price')!.conditions = ['Minimum two sessions; additional charges may apply'];
  const index = compileQueryIndex(space), original = structuredClone(space);
  const entry = websiteCatalogEntry(record, index);
  assert.equal(entry.kind, 'service');
  assert.equal(websiteCatalogEntry({ ...record, type: 'type-service' }, index).kind, 'service');
  assert.ok(entry.values!.length <= 4);
  assert.equal(entry.values![0].role, 'price');
  assert.match(entry.values![0].text, /Conditions apply.*Minimum two sessions; additional charges may apply/);
  assert.equal(entry.blocks, undefined, 'page projection does not hydrate prose');
  assert.equal(websiteCatalogEntry(record, index, { detail: true }).blocks?.[0].text, record.blocks[0].text);
  assert.deepEqual(space, original);
});

test('v2 published videos use video identities and approved posters, never the video ID as an image', () => {
  const media = validateMediaLibrary({ schemaVersion: 1, id: 'media',
    assets: [{ id: 'poster', width: 800, height: 600, caption: 'Film poster', alt: 'Reviewed poster' }],
    videos: [{ id: 'film', title: 'Our process', description: 'Reviewed film', source: { kind: 'url', url: 'https://media.example/film.mp4' }, posterAssetId: 'poster' }],
    albums: [], associations: [],
  });
  const space = addPublishedMedia(websiteTaskFixture('products', 2), media), index = compileQueryIndex(space);
  const video = space.records.find(record => record.type === 'published-video')!;
  const entry = websiteCatalogEntry(video, index, { media });
  assert.equal(entry.videoId, 'film'); assert.equal(entry.imageAssetId, 'poster'); assert.equal(entry.eyebrow, 'Watch');
  const missingPoster = websiteCatalogEntry(video, index);
  assert.equal(missingPoster.videoId, 'film'); assert.equal(missingPoster.imageAssetId, undefined);
  const photo = space.records.find(record => record.type === 'published-photo')!;
  assert.equal(websiteCatalogEntry(photo, index).imageAssetId, 'poster');
  assert.equal(websiteCatalogEntry(photo, index).videoId, undefined);
  assert.equal(websiteCatalogEntry({ ...photo, media: { assetId: 'film', role: 'depicts' } }, index, { media }).videoId, undefined, 'video identity never comes from a same-named photo alone');
});
