import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { htmlDocument } from '../lib/html-document';
import { extractWebsitePage } from '../lib/website-import';
import { websiteOfferings } from '../lib/website-structure';
import { bindWebsiteOfferingProvenance } from '../lib/website-offering-provenance';

const url = 'https://retailer.example/products';
const markup = '<main><h1>Gifts</h1><div role="group"><h2>Ornament</h2><p>$12</p><p>Hand painted.</p></div><div role="group"><p>Free delivery on this item</p><h2>Gift wrap</h2><p>$9</p><p>Four sheets.</p></div></main>';
const terms = (entity: ReturnType<typeof websiteOfferings>['entities'][number]) => String(entity.attributes.source_price_terms);

test('adjacent cards retain their own leading qualifications without changing source text', () => {
  const page = extractWebsitePage(markup, url);
  assert.equal(page.text, htmlDocument(markup).text);
  assert.equal(page.rawText, htmlDocument(markup).rawText);
  const result = websiteOfferings([page], { strict: true });
  assert.deepEqual(result.entities.map(entity => entity.name), ['Ornament', 'Gift wrap']);
  assert.equal(terms(result.entities[0]), 'Ornament $12 Hand painted.');
  assert.equal(terms(result.entities[1]), 'Free delivery on this item Gift wrap $9 Four sheets.');
});

test('scoping is structural across articles and list items, not badge vocabulary', () => {
  for (const tag of ['article', 'li']) {
    const page = extractWebsitePage(`<main><h1>Sessions</h1><${tag}><h2>Morning</h2><p>EUR 30</p><p>Bring a notebook.</p></${tag}><${tag}><p>Minimum age 18; advance registration required.</p><h2>Evening</h2><p>EUR 45</p></${tag}></main>`, url);
    const result = websiteOfferings([page], { strict: true });
    assert.doesNotMatch(terms(result.entities[0]), /Minimum age|advance registration/);
    assert.match(terms(result.entities[1]), /Minimum age 18; advance registration required/);
    assert.deepEqual(result.entities.map(entity => entity.attributes.source_price_eur), [30, 45]);
  }
});

test('nested wrappers preserve the complete explicit scope and duplicate card occurrences', () => {
  const card = '<li><article><div role="group"><p>Members only</p><h2>Notebook</h2><p>$5</p></div></article></li>';
  const page = extractWebsitePage(`<main><h1>Supplies</h1><ul>${card}${card}</ul></main>`, url);
  assert.equal(page.offeringScopes?.length, 2);
  assert.ok(page.offeringScopes![0].lineEnd < page.offeringScopes![1].lineStart);
  const result = websiteOfferings([page], { strict: true });
  assert.equal(result.entities.length, 1);
  assert.match(terms(result.entities[0]), /^Members only Notebook/);
});

test('nested policy headings and following qualifications remain attached to their offering', () => {
  for (const inner of ['li', 'div role="group"']) for (const qualification of ['Requires overnight shipping; no Friday dispatch.', 'Requires $20 Saturday surcharge; cannot ship on Friday.', 'No free delivery for orders under $100.']) {
    const end = inner.split(' ')[0];
    const page = extractWebsitePage(`<main><article><h2>Soup hamper</h2><p>$40</p><${inner}><h3>Delivery conditions</h3><p>${qualification}</p></${end}></article><p>Minimum 10 units required for Soup hamper.</p><article><p>Pickup only</p><h2>Bakery box</h2><p>$20</p></article></main>`, url);
    const result = websiteOfferings([page], { strict: true });
    assert.ok(terms(result.entities[0]).includes(qualification));assert.match(terms(result.entities[0]), /Minimum 10/);
    assert.doesNotMatch(terms(result.entities[0]), /Pickup only/);
    assert.match(terms(result.entities[1]), /^Pickup only/);
  }
});

test('an outer card badge does not leak across an inner single-heading wrapper', () => {
  const page = extractWebsitePage('<main><h2>First</h2><p>$10</p><article><p>Special delivery qualification</p><div role="group"><h2>Second</h2><p>$20</p></div></article></main>', url);
  const result = websiteOfferings([page], { strict: true });
  assert.doesNotMatch(terms(result.entities[0]), /Special delivery/);
  assert.match(terms(result.entities[1]), /^Special delivery/);
});

test('a nested priced policy heading cannot sever the parent offering conditions', () => {
  const page = extractWebsitePage('<main><article><h2>Soup hamper</h2><p>$40</p><div role="group"><h3>Minimum order $100</h3><p>Orders below this amount cannot be shipped.</p></div></article><article><p>Pickup only</p><h2>Bakery box</h2><p>$20</p></article></main>', url);
  const result = websiteOfferings([page], { strict: true });
  const hamper = result.entities.find(entity => entity.name === 'Soup hamper')!;
  assert.match(terms(hamper), /Minimum order \$100 Orders below this amount cannot be shipped/);
  assert.doesNotMatch(terms(hamper), /Pickup only/);
});

test('unscoped snapshots preserve legacy parsing and nested product conditions', () => {
  const text = '# Coffee\n$16.98\nWhole beans.\n## Instructions\nGrind before use.\n## Shipping\nCoffee-only orders, minimum four.';
  const unscoped = websiteOfferings([{ url, text }], { strict: true });
  const empty = websiteOfferings([{ url, text, offeringScopes: [] }], { strict: true });
  assert.deepEqual(empty, unscoped);
  assert.match(terms(unscoped.entities[0]), /Grind before use.*minimum four/);
  const page = extractWebsitePage('<article><h1>Coffee</h1><p>$16.98</p><h2>Instructions</h2><p>Grind before use.</p></article>', url);
  assert.equal(page.offeringScopes, undefined);
  assert.match(terms(websiteOfferings([page], { strict: true }).entities[0]), /Grind before use/);
});

test('a following scope bounds an unscoped offering before the next card qualification', () => {
  const page = extractWebsitePage('<main><h1>Services</h1><h2>Consultation</h2><p>GBP 50</p><p>One hour.</p><article><p>Travel charged separately</p><h2>Site visit</h2><p>GBP 100</p></article></main>', url);
  const result = websiteOfferings([page], { strict: true });
  assert.equal(terms(result.entities[0]), 'Consultation GBP 50 One hour.');
  assert.match(terms(result.entities[1]), /^Travel charged separately Site visit/);
});

test('ambiguous copied prose outside a card cannot establish its source range', () => {
  const card = '<p>Members only</p><h2>Notebook</h2><p>$5</p>';
  const page = extractWebsitePage(`<main><article>${card}</article><div>${card}</div></main>`, url);
  assert.equal(page.offeringScopes, undefined);
});

test('malformed, overlapping and changed source ranges fail closed without dropping reading text', () => {
  const original = extractWebsitePage(markup, url);
  for (const mutate of [
    (page: typeof original) => { page.offeringScopes![0].excerpt += 'Invented'; },
    (page: typeof original) => { page.offeringScopes![0].headingLine = 999; },
    (page: typeof original) => { page.offeringScopes!.push(page.offeringScopes![0]); },
  ]) {
    const page = structuredClone(original); mutate(page);
    assert.throws(() => websiteOfferings([page], { strict: true }), /card boundaries/);
    const result = websiteOfferings([page]);
    assert.equal(result.entities.length, 0);assert.match(result.notes.join(' '), /card boundaries/);
    assert.equal(page.text, original.text);
  }
});

test('exact provenance includes only the owning card qualification and preserves source offsets', () => {
  const page = extractWebsitePage(markup, url), extracted = websiteOfferings([page], { strict: true });
  const catalog = validateCatalog({ schemaVersion: 1, id: randomUUID(), name: 'Gifts', description: '', entities: extracted.entities, attributes: extracted.attributes, collections: extracted.collections, relationships: [], jobs: [] });
  const provenance = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [page], extracted);
  for (const anchor of provenance.anchors) assert.equal(page.text.slice(anchor.characterStart, anchor.characterEnd), anchor.excerpt);
  const excerpts = extracted.entities.map(entity => provenance.fields.filter(field => field.entityId === entity.id && field.field === 'attributes.source_price_terms').flatMap(field => field.anchorIds.map(id => provenance.anchors.find(anchor => anchor.id === id)!.excerpt)).join('\n'));
  assert.doesNotMatch(excerpts[0], /Free delivery/);assert.match(excerpts[1], /^Free delivery/);
});
