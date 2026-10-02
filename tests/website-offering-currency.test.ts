import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { addWebsiteOfferings, websiteOfferings } from '../lib/website-structure';
import { bindWebsiteOfferingProvenance } from '../lib/website-offering-provenance';

const url = 'https://classes.example/prices';
const extract = (text: string) => websiteOfferings([{ url, text }], { strict: true });

for (const currency of ['CAD', 'AUD', 'USD']) {
  test(`explicit ${currency} page declaration supports a dollar price and exact currency evidence`, () => {
    const page = extractWebsitePage(`<h1>Classes</h1><p>Prices in ${currency}.</p><h2>Ceramics</h2><p>$40</p><p>Per person; materials extra. Booking is required.</p>`, url);
    const result = websiteOfferings([page], { strict: true });
    assert.equal(result.entities.length, 1);
    const field = result.attributes.find(attribute => attribute.type === 'money')!;
    assert.equal(field.currency, currency);
    assert.equal(result.entities[0].attributes[field.id], 40);
    assert.match(result.entities[0].summary, /Per person; materials extra. Booking is required./);
    assert.match(result.notes[0], /0 price-bearing lines need manual review/);
    const evidence = result.evidence[0].fields.filter(item => item.field === `attributes.${field.id}`);
    assert.deepEqual(evidence.map(item => item.excerpt), ['$40', `Prices in ${currency}.`]);
    assert.doesNotThrow(() => addWebsiteOfferings(websitePageCatalog([page]), [page], { strict: true }));
  });

  for (const literal of [`${currency} $40`, `$40 ${currency}`, `${currency} 40`]) {
    test(`explicit inline and adjacent ${literal} retains amount and stated currency`, () => {
      const result = extract(`# Classes\n## Ceramics ~ ${literal}\nMaterials extra.\n## Drawing\nHalf hour: ${literal}; Hour: ${currency} 75\nBy appointment only.`);
      assert.equal(result.entities.length, 2);
      assert.equal(result.entities[0].name, 'Ceramics');
      const price = result.attributes.find(field => !field.unit && field.type === 'money')!;
      assert.equal(price.currency, currency);
      assert.equal(result.entities[0].attributes[price.id], 40);
      for (const [unit, value] of [['Half hour', 40], ['Hour', 75]] as const) {
        const field = result.attributes.find(field => field.unit === unit)!;
        assert.equal(field.currency, currency);
        assert.equal(result.entities[1].attributes[field.id], value);
      }
      assert.match(result.entities[1].summary, /By appointment only/);
      assert.match(result.notes[0], /0 price-bearing lines need manual review/);
    });
  }
}

test('page, section and item scopes stay isolated across sibling headings and pages', () => {
  const text = '# Classes\nAll prices are in CAD.\n## Canada\n### Ceramics\n$40\n### Drawing\n$50\nCurrency: AUD\n### Painting\n$60\n## Australia\nPrices in AUD.\n### Ceramics\n$70\n## Other classes\n### Ceramics\n$80';
  const result = websiteOfferings([{ url, text }, { url: url + '/other', text: '# Other classes\n## Ceramics\n$90' }], { strict: true });
  assert.deepEqual(result.entities.map(entity => [entity.attributes.source_price_cad, entity.attributes.source_price_aud, entity.attributes.source_price_unknown]), [
    [40, undefined, undefined], [undefined, 50, undefined], [60, undefined, undefined], [undefined, 70, undefined], [80, undefined, undefined], [undefined, undefined, '$90'],
  ]);
  assert.match(result.notes[0], /6 price-bearing lines; 6 structured offerings; 1 price-bearing lines need manual review/);
});

test('conflicting or unsupported scoped declarations retain literal prices for review', () => {
  for (const declaration of ['Prices in CAD.\nPrices in AUD.', 'Prices in CAD or USD.', 'Currency: NZD', 'Prices are shown in NZD.']) {
    const result = extract(`# Classes\nPrices in USD.\n## Regional classes\n${declaration}\n### Ceramics\n$40 per person\nMaterials extra.`);
    assert.equal(result.entities[0].attributes.source_price_unknown, '$40');
    assert.equal(result.attributes.some(field => field.type === 'money'), false);
    assert.match(result.entities[0].summary, /\$40 per person/);
    assert.match(result.entities[0].summary, /Materials extra/);
    assert.match(result.notes.join(' '), /unconfirmed currency.*no currency or conversion was inferred/);
  }
});

test('unsupported, malformed and conflicting inline markers cannot inherit a different currency', () => {
  for (const literal of ['NZD $40', '$40 NZD', 'NZUSD $40', '$40 USDNZ', 'NZ$40', 'USD 40 CAD', 'NZD £40', 'CAD $40 AUD', 'EUR $40']) {
    const result = extract(`# Classes\nPrices in CAD.\n## Ceramics ~ ${literal}`);
    assert.equal(result.entities.length, 1, literal);
    assert.equal(result.entities[0].name, 'Ceramics', literal);
    assert.equal(result.entities[0].attributes.source_price_unknown, literal);
    assert.equal(result.attributes.some(field => field.type === 'money'), false, literal);
    assert.match(result.notes.join(' '), /unconfirmed currency/);
  }
});

test('ordinary names and labeled prices preserve declared currencies without interpreting uppercase item numbers as prices', () => {
  const result = extract('# Menu\nPrices are listed in AUD.\n## Apple Pie $40\n## Room rental\nPrice: $50\n## ROOM 2');
  assert.equal(result.entities.length, 2);
  assert.equal(result.entities[0].name, 'Apple Pie');
  assert.equal(result.entities[0].attributes.source_price_aud, 40);
  const labeled = result.attributes.find(field => field.unit === 'Price')!;
  assert.equal(labeled.currency, 'AUD');
  assert.equal(result.entities[1].attributes[labeled.id], 50);
});

test('uppercase per and plus qualifications remain literal terms, not currency markers', () => {
  const result = extract('# Classes\nPrices in CAD.\n## Ceramics\n$40 PER person\n## Drawing\nCAD $50 PLUS materials');
  assert.equal(result.entities[0].attributes.source_price_cad, 40);
  assert.equal(result.entities[1].attributes.source_price_cad, 50);
  assert.match(result.entities[0].summary, /\$40 PER person/);
  assert.match(result.entities[1].summary, /CAD \$50 PLUS materials/);
});

test('unfamiliar uppercase words next to dollar prices do not erase item names', () => {
  const result = extract('# Menu\nPrices in CAD.\n## TEA $4\n## Apple PIE $40');
  assert.deepEqual(result.entities.map(entity => entity.name), ['TEA', 'Apple PIE']);
  assert.deepEqual(result.entities.map(entity => entity.attributes.source_price_unknown), ['TEA $4', 'PIE $40']);
  assert.match(result.notes.join(' '), /unconfirmed currency/);
});

test('an explicit item price overrides scope without changing a sibling or converting its amount', () => {
  const result = extract('# Classes\nPrices in CAD.\n## Ceramics ~ AUD $40\n## Drawing\n$50\n## Painting\nUSD $60');
  assert.equal(result.entities[0].attributes.source_price_aud, 40);
  assert.equal(result.entities[1].attributes.source_price_cad, 50);
  assert.equal(result.entities[2].attributes.source_price_usd, 60);
  assert.deepEqual(result.evidence[0].fields.filter(field => field.field === 'attributes.source_price_aud').map(field => field.excerpt), ['## Ceramics ~ AUD $40']);
});

test('inherited tiers retain the currency that belongs to the source amount', () => {
  const result = extract('# Bakery\nPrices in CAD.\n## Cakes\n### Single servings — $7\n#### Chocolate\nCurrency: AUD\nAvailable Wednesdays.\n#### Vanilla\n## Catering\nPrices in AUD.\n### Half Sheet — $150*\n*Starting price; additional charges apply.');
  assert.deepEqual(result.entities.map(entity => [entity.attributes.source_price_cad, entity.attributes.source_price_aud]), [[7, undefined], [7, undefined], [undefined, 150]]);
  const evidence = result.evidence[0].fields.filter(field => field.field === 'attributes.source_price_cad');
  assert.deepEqual(evidence.map(field => field.excerpt), ['### Single servings — $7', 'Prices in CAD.']);
  assert.match(result.entities[2].summary, /additional charges apply/);
});

test('preamble and heading declarations support scoped variants with exact original-line evidence', () => {
  const result = extract('Currency: CAD\n# Menu\n## Tea ~ Small - $4 | Large - $9\n# Prices (AUD)\n## Coffee ~ Small - $5 | Large - $10');
  assert.deepEqual(result.entities.map(entity => [entity.attributes.source_price_cad, entity.attributes.source_price_aud]), [[4, undefined], [9, undefined], [undefined, 5], [undefined, 10]]);
  assert.deepEqual(result.evidence[1].fields.filter(field => field.field === 'attributes.source_price_cad').map(field => field.excerpt), ['## Tea ~ Small - $4 | Large - $9', 'Currency: CAD']);
  assert.deepEqual(result.evidence[3].fields.filter(field => field.field === 'attributes.source_price_aud').map(field => field.excerpt), ['## Coffee ~ Small - $5 | Large - $10', '# Prices (AUD)']);
});

test('bare dollars retain their literal units and conditions across adjacent, heading and tier prices', () => {
  const result = extract('# Menu\n## Tea\nCup: $4.00; Pot: $9\nOnly with food.\n## Cake ~ from $7*\n*Starting price; additional charges apply.\n## Ice cream — $5\n### Vanilla\nOnly on weekends.');
  assert.equal(result.entities.length, 3);
  assert.equal(result.attributes.some(field => field.type === 'money' || field.currency), false);
  assert.deepEqual(Object.values(result.entities[0].attributes).filter(value => typeof value === 'string' && /^(Cup|Pot):/.test(value)), ['Cup: $4.00', 'Pot: $9']);
  assert.equal(result.entities[1].attributes.source_price_unknown, '$7');
  assert.equal(result.entities[2].attributes.source_price_unknown, '$5');
  assert.match(result.entities[0].summary, /Only with food/);
  assert.match(result.entities[1].summary, /Starting price; additional charges apply/);
  assert.match(result.entities[2].summary, /Only on weekends/);
  assert.match(result.notes[0], /3 price-bearing lines; 3 structured offerings; 3 price-bearing lines need manual review/);
  assert.doesNotThrow(() => validateCatalog({ schemaVersion: 1, id: 'ambiguous-prices', name: 'Menu', description: '', entities: result.entities,
    attributes: result.attributes, collections: result.collections, relationships: [], jobs: [] }));
});

test('scoped currency anchors retain exact blank-line offsets and idempotent provenance binding', () => {
  const page = { url, text: '# Classes\n\nPrices in CAD.\n\n## Ceramics\n\n$40\nMaterials extra.' };
  const extracted = websiteOfferings([page], { strict: true });
  const catalog = validateCatalog({ schemaVersion: 1, id: 'scoped-prices', name: 'Classes', description: '', entities: extracted.entities,
    attributes: extracted.attributes, collections: extracted.collections, relationships: [], jobs: [] });
  const bound = bindWebsiteOfferingProvenance(catalog, { anchors: [], fields: [] }, [page], extracted);
  const price = bound.fields.find(field => field.field === 'attributes.source_price_cad')!;
  assert.deepEqual(price.anchorIds.map(id => bound.anchors.find(anchor => anchor.id === id)!.excerpt), ['$40', 'Prices in CAD.']);
  assert.deepEqual(price.anchorIds.map(id => bound.anchors.find(anchor => anchor.id === id)!.lineStart), [7, 3]);
  for (const anchor of bound.anchors) assert.equal(page.text.slice(anchor.characterStart, anchor.characterEnd), anchor.excerpt);
  assert.deepEqual(bindWebsiteOfferingProvenance(catalog, bound, [page], extracted), bound);
});
