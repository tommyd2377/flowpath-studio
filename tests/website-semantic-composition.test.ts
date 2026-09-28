import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretWebsiteSource } from '../lib/ingestion';
import { unlinkedSourceProvenance } from '../lib/source-extractors';

const text = '# Workshop\nPractical lessons for new makers.\n## Classes\n### Woodworking basics\nSession: $40, Series: $150\nFour weekly sessions.\n### Finishing techniques\nSession: $35, Series: $120\nSupplies included.';
const pages = [{ url: 'https://workshop.example/classes', text }];
const provenance = unlinkedSourceProvenance({ text, format: 'html' });
const reply = { complete: true, issues: [], name: 'Workshop', description: '', attributes: [],
  entities: [{ id: 'workshop', name: 'Workshop', kind: 'business', summary: 'Practical lessons for new makers.', attributes: [] }],
  collections: [], relationships: [], facts: [], evidence: [], jobs: [] };

test('website interpretation composes explicit variants with remaining semantic knowledge in one request', async () => {
  let calls = 0;
  const result = await interpretWebsiteSource('Workshop', text, pages, provenance, async (input, structured) => {
    calls++;
    assert.equal(structured.entities.length, 2);
    assert.deepEqual((input.hostExtractedOfferings as { entities: unknown }).entities, structured.entities);
    assert.equal(input.source, text, 'the model still sees qualifications and conflicts in the full source');
    assert.equal(structured.attributes.filter(field => field.type === 'money').length, 2);
    return JSON.stringify({ ...reply, issues: ['Two source schedules disagree; confirm before publishing.'] });
  });
  assert.equal(calls, 1);
  assert.equal(result.catalog.entities.length, 3);
  assert.equal(result.catalog.entities.filter(entity => entity.kind === 'offering').length, 2);
  assert.ok(result.catalog.attributes.some(field => field.unit === 'Session'));
  assert.ok(result.catalog.attributes.some(field => field.unit === 'Series'));
  assert.match(result.notes.join(' '), /2 structured offerings/);
  assert.match(result.notes.join(' '), /Two source schedules disagree/);
  assert.ok(result.provenance.fields.some(field => field.field.startsWith('attributes.source_price_')));
});

test('website partial interpretation preserves its review flag and issues without retrying', async () => {
  let calls = 0;
  const result = await interpretWebsiteSource('Workshop', text, pages, provenance, async () => {
    calls++; return JSON.stringify({ ...reply, complete: false, issues: ['Policies are missing.'] });
  });
  assert.equal(calls, 1);
  assert.equal(result.incomplete, true);
  assert.match(result.notes.join(' '), /Policies are missing/);
  assert.equal(result.catalog.entities.length, 3);
});

test('pre-extracted offerings never bypass invalid semantic responses or trigger retries', async () => {
  for (const response of [JSON.stringify({ ...reply, complete: false, entities: [] }), '{invalid']) {
    let calls = 0;
    await assert.rejects(() => interpretWebsiteSource('Workshop', text, pages, provenance, async () => { calls++; return response; }), /incomplete|unreadable/);
    assert.equal(calls, 1);
  }
});
