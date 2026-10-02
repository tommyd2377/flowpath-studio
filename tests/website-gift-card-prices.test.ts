import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { addWebsiteOfferings, websiteOfferings } from '../lib/website-structure';

const url = 'https://restaurant.example/shop';
const extract = (text: string) => websiteOfferings([{ url, text }], { strict: true });

test('an ambiguous zero-price gift card stays in source evidence without host merge asserting a free offer', () => {
  const page = extractWebsitePage(`<main><h1>Shop</h1><h2>E-Gift Card (Restaurant)</h2><p>$0.00</p>
    <p>Purchase through our external provider. Not accepted at the station restaurant.</p>
    <a href="/products/gift-card">Gift card details</a><h2>Racing Hat</h2><p>$29.99</p></main>`, url);
  const original = structuredClone(page);
  const result = websiteOfferings([page], { strict: true });
  assert.deepEqual(result.entities.map(entity => entity.name), ['Racing Hat']);
  assert.match(result.notes.join(' '), /1 zero-priced gift-card entries need manual review/);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].entityId, result.entities[0].id);
  assert.deepEqual(page, original);
  const merged = addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true });
  assert.deepEqual(merged.catalog.entities.filter(entity => entity.kind === 'offering').map(entity => entity.name), ['Racing Hat']);
  assert.match(JSON.stringify(merged.catalog.entities[0].blocks), /Not accepted at the station restaurant/);
  assert.match(page.rawText!, /\$0\.00/);
  assert.ok(page.links.some(link => link.url.endsWith('/products/gift-card')));
});

test('adjacent, inline and inherited zero gift-card amounts remain unresolved across currency forms', () => {
  for (const text of [
    '# Shop\n## Gift Card\nUSD 0.00',
    '# Shop\n## Gift Card — CAD $0.00',
    '# Shop\n## E-Gift Card (Restaurant) — £0',
    '# Shop\n## Gift Certificate\n€0.00',
    '# Shop\n## Gift Card\nPrice: USD 0',
    '# Shop\n## Gift Card\nStandard: USD 0',
    '# Shop\n## Digital Gift Card — Choose Amount\nUSD 0\nPurchase through the external provider.',
    '# Shop\n## E-Gift Card - Restaurant\nUSD 0',
    '# Shop\n## Cards — USD 0 each\n### Digital Gift Card',
  ]) {
    const result = extract(text);
    assert.deepEqual(result.entities, [], text);
    assert.deepEqual(result.evidence, [], text);
    assert.match(result.notes.join(' '), /zero-priced gift-card entries need manual review/);
  }
});

test('a skipped zero card remains a boundary and cannot price its instructions or change the next offer', () => {
  const result = extract('# Shop\n## E-Gift Card\nUSD 0\n### How to purchase\nVisit our provider.\n## Cookbook\nUSD 40\nShipping costs extra.');
  assert.deepEqual(result.entities.map(entity => [entity.name, entity.attributes.source_price_usd]), [['Cookbook', 40]]);
  assert.match(result.entities[0].summary, /Shipping costs extra/);
  assert.doesNotMatch(result.entities[0].summary, /provider/);
});

test('nonzero cards, ordinary free items and card accessories retain their actual prices', () => {
  const result = extract('# Shop\n## Gift Card\nUSD 25\n## Water\nUSD 0\n## Museum admission — USD 0\n## Gift Card Holder\nUSD 0\n## Gift Card - Holder\nUSD 0');
  assert.deepEqual(result.entities.map(entity => [entity.name, entity.attributes.source_price_usd]), [
    ['Gift Card', 25], ['Water', 0], ['Museum admission', 0], ['Gift Card Holder', 0], ['Gift Card - Holder', 0],
  ]);
  assert.doesNotMatch(result.notes.join(' '), /zero-priced gift-card/);
});

test('explicit free-card promotions retain their adjacent restrictions without inferring face value', () => {
  const result = extract('# Promotions\n## Free Gift Card\nUSD 0\nOnly with a qualifying purchase. Value must be confirmed.\n## Digital Gift Card\nUSD 0\nThis gift card is free with a qualifying purchase.\nNot accepted at the station restaurant.');
  assert.equal(result.entities.length, 2);
  assert.match(result.entities[0].summary, /Only with a qualifying purchase.*Value must be confirmed/);
  assert.match(result.entities[1].summary, /free with a qualifying purchase.*Not accepted at the station/);
  assert.equal(result.attributes.some(attribute => /face.?value/i.test(attribute.id)), false);
  for (const entity of result.entities) assert.equal(entity.attributes.source_price_usd, 0);
});

test('shipping, fee statements, negation and sibling promotions do not establish a free card', () => {
  for (const description of [
    'Free shipping.', 'No activation fee.', 'This gift card is not free.',
    'This gift card is free shipping only.', 'Do not assume this gift card is free.',
  ]) assert.deepEqual(extract(`# Shop\n## Gift Card\nUSD 0\n${description}`).entities, [], description);
  const siblings = extract('# Shop\n## Gift Card\nUSD 0\n## Free sample\nUSD 0\nThis gift card is free.');
  assert.deepEqual(siblings.entities.map(entity => entity.name), ['Free sample']);
  assert.deepEqual(extract('# Shop\n## Free Gift Card\nUSD 0\nThis gift card is not free.').entities, []);
  assert.deepEqual(extract('# Shop\n## Free Gift Card\nUSD 0\nNote: This gift card is not free. Pay its value at checkout.').entities, []);
  assert.deepEqual(extract("# Shop\n## Free Gift Card\nUSD 0\nThis gift card isn't free.").entities, []);
});

test('explicitly labeled issuance fees and positive stored value are kept as separate source fields', () => {
  const result = extract('# Shop\n## Gift Card\nActivation: USD 0; Face value: USD 50\nRedeem only at the named restaurant.');
  assert.equal(result.entities.length, 1);
  for (const [unit, amount] of [['Activation', 0], ['Face value', 50]] as const) {
    const field = result.attributes.find(attribute => attribute.unit === unit)!;
    assert.equal(result.entities[0].attributes[field.id], amount);
  }
  assert.match(result.entities[0].summary, /Redeem only at the named restaurant/);
});
