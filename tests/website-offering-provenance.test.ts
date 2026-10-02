import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { websiteOfferings } from '../lib/website-structure';
import { bindWebsiteOfferingProvenance } from '../lib/website-offering-provenance';
import { refreshAssertionReviews } from '../lib/knowledge-assertions';
import { mergeKnowledge } from '../lib/knowledge-model';
import { MAX_SOURCE_EXCERPT } from '../lib/source-provenance';

const page = { url: 'https://restaurant.example/menu', text: '# Menu\n\n## Pizzas\n\n#### Garden Pizza\nSlice: $6.50, Pie: $39\nPeppers and mushrooms. Not available daily.\n\n#### Plain Pizza\nSlice: $3.50, Pie: $25.50' };
function fixture(pages = [page]) {
  const extracted = websiteOfferings(pages, { strict: true });
  const catalog = validateCatalog({ schemaVersion: 1, id: randomUUID(), name: 'Restaurant', description: '',
    entities: extracted.entities, attributes: extracted.attributes, collections: extracted.collections, relationships: [], jobs: [] });
  return { extracted, catalog, pages };
}

test('structured prices retain exact page-local lines and field support without approving assertions', () => {
  const { extracted, catalog, pages } = fixture();
  const provenance = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, pages, extracted);
  const slice = extracted.attributes.find(attribute => attribute.label.startsWith('Listed Slice price'))!;
  const reference = provenance.fields.find(field => field.entityId === catalog.entities[0].id && field.field === `attributes.${slice.id}`)!;
  const anchor = provenance.anchors.find(anchor => anchor.id === reference.anchorIds[0])!;
  assert.equal(anchor.excerpt, 'Slice: $6.50, Pie: $39');
  assert.equal(anchor.lineStart, 6);
  assert.equal(anchor.lineEnd, 6);
  assert.match(anchor.label, /restaurant\.example\/menu/);
  for (const source of provenance.anchors) assert.equal(page.text.slice(source.characterStart, source.characterEnd), source.excerpt);
  const category = provenance.fields.find(field => field.entityId === catalog.entities[0].id && field.field === 'attributes.source_category')!;
  assert.deepEqual(category.anchorIds.map(id => provenance.anchors.find(anchor => anchor.id === id)!.excerpt), ['# Menu', '## Pizzas']);
  assert.ok(!provenance.fields.some(field => ['kind', 'summary', 'identifiers'].includes(field.field)));
  const artifact = mergeKnowledge(null, catalog, { fileId: randomUUID(), name: 'Website restaurant.example', hash: 'source-hash', provenance, modelInterpreted: true });
  const reviews = refreshAssertionReviews(artifact, 'model');
  assert.ok(reviews.some(review => review.targetId.endsWith(`/attributes.${slice.id}`) && review.support === 'anchored'));
  assert.ok(reviews.filter(review => review.targetId.endsWith('/kind') || review.targetId.endsWith('/summary')).every(review => review.support === 'unsupported'));
  assert.ok(reviews.every(review => review.status === 'pending'));
});

test('same-named offerings on separate source pages keep distinct exact price evidence', () => {
  const pages = [page, { url: 'https://restaurant.example/seasonal', text: page.text.replace('$6.50', '$8.50') }];
  const { extracted, catalog } = fixture(pages);
  const provenance = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, pages, extracted);
  const slice = extracted.attributes.find(attribute => attribute.label.startsWith('Listed Slice price'))!;
  for (const [index, expected] of [[0, '$6.50'], [2, '$8.50']] as const) {
    const reference = provenance.fields.find(field => field.entityId === catalog.entities[index].id && field.field === `attributes.${slice.id}`)!;
    assert.match(provenance.anchors.find(anchor => anchor.id === reference.anchorIds[0])!.excerpt, new RegExp(expected.replace('$', '\\$')));
  }
});

test('model references are preserved and rebinding is idempotent without mutating inputs', () => {
  const { extracted, catalog, pages } = fixture();
  catalog.entities.push({ id: 'business', kind: 'organization', name: 'Restaurant', summary: '', attributes: {} });
  const original = { anchors: [{ id: 'model-anchor', format: 'html' as const, label: 'Business', excerpt: 'Restaurant', lineStart: 1, lineEnd: 1 }], fields: [{ entityId: 'business', field: 'name', anchorIds: ['model-anchor'] }] };
  const snapshot = structuredClone(original);
  const bound = bindWebsiteOfferingProvenance(catalog, original, pages, extracted);
  assert.deepEqual(bound.fields.find(field => field.entityId === 'business'), original.fields[0]);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(bindWebsiteOfferingProvenance(catalog, bound, pages, extracted), bound);
});

test('changed values and incompatible price definitions never inherit parser evidence', () => {
  const { extracted, catalog, pages } = fixture();
  const slice = extracted.attributes.find(attribute => attribute.label.startsWith('Listed Slice price'))!;
  const original = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, pages, extracted);
  const changed = structuredClone(catalog);
  changed.entities[0].name = 'Different product';
  changed.entities[0].attributes[slice.id] = 'Slice: $99';
  let bound = bindWebsiteOfferingProvenance(changed, original, pages, extracted);
  assert.ok(!bound.fields.some(field => field.entityId === changed.entities[0].id && ['name', `attributes.${slice.id}`].includes(field.field)));
  Object.assign(changed.attributes.find(attribute => attribute.id === slice.id)!, { type: 'money', currency: 'EUR', unit: 'Slice' });
  bound = bindWebsiteOfferingProvenance(changed, bound, pages, extracted);
  assert.ok(!bound.fields.some(field => field.field === `attributes.${slice.id}`));
});

test('unknown, shifted, fabricated and ambiguous captured locations fail closed', () => {
  const { extracted, catalog, pages } = fixture();
  for (const mutate of [
    (copy: typeof extracted) => { copy.evidence[0].pageUrl = 'https://restaurant.example/missing'; },
    (copy: typeof extracted) => { copy.evidence[0].fields[0].lineStart++; },
    (copy: typeof extracted) => { copy.evidence[0].fields[0].excerpt = 'Fabricated source'; },
  ]) {
    const copy = structuredClone(extracted); mutate(copy);
    assert.throws(() => bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, pages, copy), /captured source evidence/);
  }
  assert.throws(() => bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [...pages, { ...page, text: 'Different capture' }], extracted), /captured source evidence/);
});

test('long exact excerpts are segmented completely and excessive field evidence fails closed', () => {
  const { extracted, catalog } = fixture();
  const text = 'Garden Pizza ' + 'Long original source '.repeat(100);
  const copy = structuredClone(extracted);
  copy.evidence = [{ entityId: catalog.entities[0].id, pageUrl: page.url, fields: [{ field: 'name', lineStart: 1, lineEnd: 1, excerpt: text }] }];
  const bound = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [{ url: page.url, text }], copy);
  assert.equal(bound.anchors.map(anchor => anchor.excerpt).join(''), text);
  assert.ok(bound.anchors.every(anchor => anchor.excerpt.length <= MAX_SOURCE_EXCERPT && !anchor.truncated));
  const oversized = 'x'.repeat(MAX_SOURCE_EXCERPT * 8 + 1);
  copy.evidence[0].fields[0].excerpt = oversized;
  assert.throws(() => bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [{ url: page.url, text: oversized }], copy), /evidence limit/);
});

test('legacy heading and inherited tier prices also retain complete exact source evidence', () => {
  const pages = [{ url: page.url, text: '# Bakery\n## Cakes\n### Single servings — $7\n#### Chocolate\nAvailable Wednesdays.\n## Catering\n### Half Sheet — $150*\n*Starting price; additional charges apply.' }];
  const { extracted, catalog } = fixture(pages);
  const bound = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, pages, extracted);
  assert.equal(catalog.entities.length, 2);
  const price = bound.fields.find(field => field.entityId === catalog.entities[0].id && field.field === 'attributes.source_price_unknown')!;
  assert.equal(bound.anchors.find(anchor => anchor.id === price.anchorIds[0])!.excerpt, '### Single servings — $7');
  assert.ok(bound.anchors.some(anchor => anchor.excerpt === '*Starting price; additional charges apply.'));
});
