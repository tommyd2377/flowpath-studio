import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWebsitePage, websitePageCatalog } from '../lib/website-import';
import { websiteOfferings } from '../lib/website-structure';

const url = 'https://workshop.example/programs';
const extract = (text: string) => websiteOfferings([{ url, text }], { strict: true });

test('a price heading separated from child headings by prose does not price those instructions', () => {
  const page = extractWebsitePage(`<main><h1>Annual Craft Program</h1><h2>Autumn through spring</h2>
    <h4>Program fee: $12,450 per year</h4><p>Students develop their craft through guided practice and independent projects.</p>
    <h5>Submit your portfolio after completing the form.</h5><h5>For details, email office@workshop.example</h5>
    <h2>Application</h2><p>Materials and travel are additional. Admission requires review.</p></main>`, url);
  const result = websiteOfferings([page], { strict: true });
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.evidence, []);
  assert.match(result.notes[0], /1 price-bearing lines; 0 structured offerings; 1 price-bearing lines need manual review/);
  const reading = websitePageCatalog([page]).entities[0].blocks!.map(block => 'text' in block ? block.text : '').join('\n');
  assert.match(reading, /Program fee: \$12,450 per year/);
  assert.match(reading, /Materials and travel are additional. Admission requires review./);
});

test('intervening prose leaves an ambiguous priced branch for review rather than creating its generic price label', () => {
  const result = extract('# Services\n## Annual fee — CAD $90\nIncludes the following conditions.\n### Eligibility\nApproval required.\n## Consultation ~ CAD $25\nBy appointment only.');
  assert.deepEqual(result.entities.map(entity => entity.name), ['Consultation']);
  assert.equal(result.entities[0].attributes.source_price_cad, 25);
  assert.match(result.notes[0], /2 price-bearing lines; 1 structured offerings; 1 price-bearing lines need manual review/);
});

test('immediate descriptive children cannot establish a shared price without explicit per-item wording', () => {
  const result = extract('# Program\n## Tuition — USD 500\n### How to apply\nSubmit an application.\n### Payment schedule\nContact the office.\n## Single servings — $7\n### Chocolate\n### Vanilla');
  assert.deepEqual(result.entities, []);
  assert.match(result.notes[0], /2 price-bearing lines; 0 structured offerings; 2 price-bearing lines need manual review/);
});

test('an incidental each in the title is not a shared-price qualification', () => {
  const result = extract('# Programs\n## Skills for each season — USD 500\n### Application steps\nSubmit your materials.');
  assert.deepEqual(result.entities, []);
});

test('direct shared-price children retain literal prices, currency evidence and qualifications', () => {
  const result = extract('# Menu\nPrices in CAD.\n## Single servings — $7 each\n\n### Chocolate\nAvailable Wednesdays.\n### Vanilla\nContains dairy.\n## Other servings — $8 each\n### Strawberry\nOnly in summer.');
  assert.deepEqual(result.entities.map(entity => [entity.name, entity.attributes.source_price_cad]), [['Chocolate', 7], ['Vanilla', 7], ['Strawberry', 8]]);
  assert.deepEqual(result.evidence[0].fields.filter(field => field.field === 'attributes.source_price_cad').map(field => field.excerpt), ['## Single servings — $7 each', 'Prices in CAD.']);
  assert.match(result.entities[0].summary, /Available Wednesdays/);
  assert.match(result.entities[1].summary, /Contains dairy/);
});

test('shared prices do not pass through a named item into nested descriptive headings', () => {
  const result = extract('# Menu\n## Single servings — $7 each\n### Chocolate\nAvailable Wednesdays.\n#### Ingredients\nContains dairy.\n#### Collection instructions\nBring your receipt.\n### Vanilla\nMade to order.\n## Contact\n### Directions\nUse the east entrance.');
  assert.deepEqual(result.entities.map(entity => entity.name), ['Chocolate', 'Vanilla']);
  assert.deepEqual(result.entities.map(entity => entity.attributes.source_price_unknown), ['$7', '$7']);
  assert.equal(result.attributes.some(field => field.type === 'money'), false);
  assert.match(result.entities[0].summary, /Contains dairy/);
  assert.match(result.entities[0].summary, /Bring your receipt/);
  assert.doesNotMatch(result.entities[0].summary, /Made to order|east entrance/);
  assert.ok(result.evidence[0].fields.some(field => field.field === 'attributes.source_price_terms' && field.excerpt === 'Contains dairy.'));
  assert.ok(result.evidence[0].fields.some(field => field.field === 'attributes.source_price_terms' && field.excerpt === 'Bring your receipt.'));
  assert.match(result.notes.join(' '), /unconfirmed currency/);
});

test('adjacent prices retain descendant qualifications and exact source ranges', () => {
  const text = '# Menu\n## Chocolate box\n$20\n### Ingredients\nContains dairy.\n### Collection\nBring your receipt.\n## Vanilla box\n$25\nAvailable Sundays.';
  const result = extract(text);
  assert.deepEqual(result.entities.map(entity => entity.name), ['Chocolate box', 'Vanilla box']);
  assert.match(result.entities[0].summary, /Contains dairy.*Bring your receipt/);
  assert.doesNotMatch(result.entities[0].summary, /Available Sundays/);
  const terms = result.evidence[0].fields.find(field => field.field === 'attributes.source_price_terms')!;
  assert.equal(terms.excerpt, text.split('\n').slice(terms.lineStart - 1, terms.lineEnd).join('\n'));
  assert.match(terms.excerpt, /### Ingredients\nContains dairy/);
  assert.match(terms.excerpt, /### Collection\nBring your receipt/);
});

test('a skipped item remains a heading boundary for subsequent instructions', () => {
  const result = websiteOfferings([{ url, text: `# Menu\n## Portions — $7 each\n### ${'Long name '.repeat(20)}\n#### Preparation\nAsk the kitchen.\n### Vanilla\nOnly on weekends.` }]);
  assert.deepEqual(result.entities.map(entity => entity.name), ['Vanilla']);
  assert.match(result.notes.join(' '), /no truncated offering was accepted/);
});

test('uppercase per-item terms are price qualifications, not conflicting currency markers', () => {
  const result = extract('# Menu\nPrices in CAD.\n## Small portions — $7 EACH\n### Chocolate\n## Large portions — $9 APIECE\n### Vanilla');
  assert.deepEqual(result.entities.map(entity => entity.attributes.source_price_cad), [7, 9]);
  assert.equal(result.attributes.some(field => field.id === 'source_price_unknown'), false);
});

test('a directly stated price under a nested heading overrides the shared tier without pricing sibling instructions', () => {
  const result = extract('# Menu\nPrices in AUD.\n## Tasting portions — $7 each\n### Chocolate\n#### Gift box\n$20\nBox contains four pieces.\n#### Shipping instructions\nContact the studio.\n### Vanilla\nOnly on weekends.');
  assert.deepEqual(result.entities.map(entity => [entity.name, entity.attributes.source_price_aud]), [['Chocolate', 7], ['Gift box', 20], ['Vanilla', 7]]);
  assert.match(result.entities[1].summary, /Box contains four pieces/);
});

test('standalone heading and adjacent prices remain extractable without inventing missing currency', () => {
  const result = extract('# Sessions\n## Introductory session — $40\nMaterials are additional.\n## Follow-up\nHalf hour: $25; Hour: $45\nPrior attendance required.');
  assert.deepEqual(result.entities.map(entity => entity.name), ['Introductory session', 'Follow-up']);
  assert.equal(result.entities[0].attributes.source_price_unknown, '$40');
  assert.equal(result.attributes.some(field => field.type === 'money'), false);
  assert.match(result.entities[1].summary, /Prior attendance required/);
});
