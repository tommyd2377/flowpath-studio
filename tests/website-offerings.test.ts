import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { addWebsiteOfferings, websiteOfferings } from '../lib/website-structure';

const url = 'https://menu.example/menu';
const menu = `<h1>Our Menu</h1><h2>Vegetable Specials</h2>
  <div><h4>Garden Pizza (Not Available Daily)</h4><div>Slice: $6.50, Pie: $39</div><p>Broccoli, peppers and mozzarella. Ask about today's selection.</p></div>
  <div><h4>Mushroom Pizza</h4><div>Slice: $7.50 Pie: $45</div><p>Roasted mushrooms and tomato sauce.</p></div>
  <h2>Sides</h2><div><h4>Small Fries</h4><div>$4.50</div><p>Seasoned potato fries.</p></div>`;

test('adjacent price blocks preserve one product with distinct typed unit prices and full description', () => {
  const page = extractWebsitePage(menu, url);
  const result = websiteOfferings([page]);
  assert.equal(result.entities.length, 3);
  const slice = result.attributes.find(field => field.unit === 'Slice')!;
  const pie = result.attributes.find(field => field.unit === 'Pie')!;
  assert.equal(slice.type, 'money');
  assert.equal(slice.currency, 'USD');
  assert.equal(result.entities[0].attributes[slice.id], 6.5);
  assert.equal(result.entities[0].attributes[pie.id], 39);
  assert.equal(result.entities[1].attributes[slice.id], 7.5);
  assert.equal(result.entities[1].attributes[pie.id], 45);
  assert.equal(result.entities[2].attributes.source_price_usd, 4.5);
  assert.match(result.entities[0].name, /Not Available Daily/);
  assert.match(result.entities[0].summary, /Broccoli, peppers and mozzarella/);
  assert.match(result.entities[0].summary, /availability is not verified/);
  assert.match(String(result.entities[0].attributes.source_category), /Vegetable Specials/);
  assert.match(result.notes[0], /3 price-bearing lines; 3 structured offerings; 0 price-bearing lines need manual review/);
  assert.equal(addWebsiteOfferings(websitePageCatalog([page]), [page]).catalog.entities.filter(entity => entity.kind === 'offering').length, 3);
});

test('adjacent prices do not infer units or repair source inconsistencies', () => {
  const result = websiteOfferings([{ url, text: '# Menu\n## Sides\n#### Cauliflower (Limited Inventory)\n$15 Plus Toppings\n10 inch base; topping prices vary.\n#### Seafood Special\nPie: $73\nDescription lists chicken and cheese.\n#### Seasonal Dessert\n$5=\n#### Another Item\nAsk about the menu.\nSlice: $4, Pie: $24\n#### Ranged Item\nSlice: $4-$6\n#### Duplicate Label\nCup: $4, Cup: $6' }]);
  assert.equal(result.entities.length, 2);
  assert.match(result.entities[0].summary, /Plus Toppings/);
  assert.match(result.entities[1].summary, /Description lists chicken/);
  assert.equal(result.attributes.some(field => field.unit === 'Slice'), false);
  assert.match(result.notes[0], /4 price-bearing lines need manual review/);
});

test('unit labels generalize across currencies and remain stable when descriptions or prices change', () => {
  const initial = websiteOfferings([{ url, text: '# Services\n## Repairs\n#### Consultation\nHalf hour: £25; Hour: £40\nBy appointment only.' }]);
  const changed = websiteOfferings([{ url, text: '# Services\n## Repairs\n#### Consultation\nHalf hour: £30; Hour: £50\nContact us for scheduling.' }]);
  assert.equal(initial.entities[0].id, changed.entities[0].id);
  assert.deepEqual(initial.attributes, changed.attributes);
  assert.equal(initial.attributes.find(field => field.unit === 'Half hour')?.currency, 'GBP');
  assert.match(initial.entities[0].summary, /By appointment only/);
});

test('a provider record with only one matching unit price does not hide another listed unit', () => {
  const page = extractWebsitePage(menu, url);
  const complete = addWebsiteOfferings(websitePageCatalog([page]), [page]).catalog;
  const offering = complete.entities.find(entity => entity.kind === 'offering')!;
  const originalId = offering.id;
  offering.id = 'provider-record';
  complete.collections = complete.collections.map(group => ({ ...group, entityIds: group.entityIds.map(id => id === originalId ? offering.id : id) }));
  assert.equal(addWebsiteOfferings(complete, [page]).catalog.entities.filter(entity => entity.kind === 'offering').length, 3);
  const pie = complete.attributes.find(field => field.unit === 'Pie')!;
  delete offering.attributes[pie.id];
  const supplemented = addWebsiteOfferings(complete, [page]).catalog;
  assert.equal(supplemented.entities.filter(entity => entity.kind === 'offering').length, 4);
  assert.equal(supplemented.entities.find(entity => entity.id === originalId)?.attributes[pie.id], 39);
});

test('unmatched prices remain visible when offering or attribute bounds are reached', () => {
  const products = Array.from({ length: 71 }, (_, index) => `#### Item ${index}\nCup: $4\nSynthetic description.`).join('\n');
  const bounded = websiteOfferings([{ url, text: '# Menu\n## Drinks\n' + products }]);
  assert.equal(bounded.entities.length, 70);
  assert.match(bounded.notes[0], /71 price-bearing lines; 70 structured offerings; 1 price-bearing lines need manual review/);
  const manyUnits = Array.from({ length: 24 }, (_, index) => `#### Item ${index}\nUnit ${index}: $4`).join('\n');
  const fields = websiteOfferings([{ url, text: '# Menu\n## Units\n' + manyUnits }]);
  assert.equal(fields.attributes.length, 24);
  assert.equal(fields.entities.length, 22);
  assert.match(fields.notes[0], /2 price-bearing lines need manual review/);
  assert.throws(() => websiteOfferings([{ url, text: products }], { strict: true }), /offering or attribute limit/);
  assert.throws(() => websiteOfferings([{ url, text: manyUnits }], { strict: true }), /offering or attribute limit/);
});

test('strict import rejects source truncation, contradictory duplicate identities and combined catalog limits', () => {
  const long = '# Menu\n#### Long Description\n$10\n' + 'Description '.repeat(100);
  assert.throws(() => websiteOfferings([{ url, text: long }], { strict: true }), /no truncated offering/);
  const duplicate = '# Menu\n## Sides\n#### Same Item\n$4\n#### Same Item\n$6';
  assert.throws(() => websiteOfferings([{ url, text: duplicate }], { strict: true }), /Conflicting source entries/);
  assert.equal(websiteOfferings([{ url, text: duplicate }]).entities.length, 0);
  const page = extractWebsitePage(menu, url);
  const full = websitePageCatalog([page]);
  full.entities = Array.from({ length: 99 }, (_, index) => ({ id: `article-${index}`, name: `Article ${index}`, kind: 'article', summary: '', attributes: {} }));
  assert.throws(() => addWebsiteOfferings(full, [page], { strict: true }), /100-item catalog limit/);
  full.entities = [];
  full.attributes = Array.from({ length: 24 }, (_, index) => ({ id: `custom-${index}`, label: `Custom ${index}`, type: 'text' }));
  assert.throws(() => addWebsiteOfferings(full, [page], { strict: true }), /attribute or collection limit/);
  assert.equal(websiteOfferings([{ url, text: '# Menu\n#### Broken Price\nCup: $1,2,3' }]).entities.length, 0);
});

test('deterministic evidence uses exact original page text and scoped line ranges', () => {
  const text = '# Menu\n\n## Drinks\n\n#### Local Tea\n\nCup: $4, Pot: $9\nBrewed fresh.\n#### Coffee ~ $5\nAvailable daily.';
  const result = websiteOfferings([{ url, text }]);
  assert.equal(result.evidence.length, 2);
  const money = result.evidence[0].fields.filter(field => field.field.startsWith('attributes.source_price_') && field.field !== 'attributes.source_price_terms');
  assert.equal(money.length, 2);
  assert.equal(money[0].lineStart, 7);
  for (const item of result.evidence) for (const field of item.fields) {
    assert.equal(item.pageUrl, url);
    assert.equal(field.excerpt, text.split('\n').slice(field.lineStart - 1, field.lineEnd).join('\n'));
    assert.ok(!['kind', 'summary'].includes(field.field));
  }
});

test('inline price headings retain ordinary descriptions and exact evidence', () => {
  const text = '# Menu\n## Vegetable Pies\n#### Garden Pie ~ $20\nBroccoli, peppers and mozzarella.\nPrepared in a shared kitchen.';
  const result = websiteOfferings([{ url, text }], { strict: true });
  assert.equal(result.entities.length, 1);
  assert.match(result.entities[0].summary, /Broccoli, peppers and mozzarella/);
  assert.match(String(result.entities[0].attributes.source_price_terms), /Prepared in a shared kitchen/);
  const fields = result.evidence[0].fields.filter(field => field.field === 'attributes.source_price_terms');
  assert.ok(fields.some(field => field.excerpt === 'Broccoli, peppers and mozzarella.'));
  assert.ok(fields.some(field => field.excerpt === 'Prepared in a shared kitchen.'));
});

test('strict merge rejects reserved IDs with missing or changed source fields', () => {
  const page = extractWebsitePage(menu, url);
  const original = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  const edited = structuredClone(original);
  edited.entities.find(entity => entity.kind === 'offering')!.attributes = {};
  assert.throws(() => addWebsiteOfferings(edited, [page], { strict: true }), /reserved source offering ID/);
  const changedSummary = structuredClone(original);
  changedSummary.entities.find(entity => entity.kind === 'offering')!.summary = 'Available every day.';
  assert.throws(() => addWebsiteOfferings(changedSummary, [page], { strict: true }), /reserved source offering ID/);
  assert.deepEqual(addWebsiteOfferings(original, [page], { strict: true }).catalog, original);
});

test('strict merge preserves source qualifications when another ID has only matching prices', () => {
  const page = extractWebsitePage(menu, url);
  const original = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  const host = original.entities.find(entity => entity.kind === 'offering')!;
  const hostId = host.id;
  const expectedTerms = host.attributes.source_price_terms;
  host.id = 'provider-priced-item';
  original.collections = original.collections.map(collection => ({ ...collection, entityIds: collection.entityIds.map(id => id === hostId ? host.id : id) }));
  assert.equal(addWebsiteOfferings(original, [page], { strict: true }).catalog.entities.filter(entity => entity.kind === 'offering').length, 3);
  delete host.attributes.source_price_terms;
  host.summary = 'Broccoli, peppers and mozzarella.';
  const merged = addWebsiteOfferings(original, [page], { strict: true }).catalog;
  assert.equal(merged.entities.filter(entity => entity.kind === 'offering').length, 4);
  assert.equal(merged.entities.find(entity => entity.id === hostId)?.attributes.source_price_terms, expectedTerms);
  assert.match(merged.entities.find(entity => entity.id === hostId)!.summary, /Not Available Daily/);
});

test('strict merge rejects incompatible definitions for reserved source attributes', () => {
  const page = extractWebsitePage(menu, url);
  const original = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }).catalog;
  for (const mismatch of [{ type: 'text' as const }, { currency: 'EUR' }, { unit: 'Pound' }]) {
    const changed = structuredClone(original);
    Object.assign(changed.attributes.find(field => field.unit === 'Slice')!, mismatch);
    assert.throws(() => addWebsiteOfferings(changed, [page], { strict: true }), /reserved source attribute definition/);
  }
});
