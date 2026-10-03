import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { sampleContent } from '../lib/site-model';
import { planWorkspaceIntent, publishedWorkspace } from '../lib/visitor-workspace';

// Three source entries reproduce a real native catalog's duplicate named item.
// Splitting a requested field identifier previously selected all nine facts,
// exceeding the eight-match limit instead of returning its three price facts.
const catalog = validateCatalog({ schemaVersion: 1, id: 'source-fields', name: 'Source field fixture', description: '',
  attributes: [
    { id: 'source_price_unknown', label: 'Listed price (currency unconfirmed)', type: 'text' },
    { id: 'source_category', label: 'Category', type: 'text' },
    { id: 'source_price_terms', label: 'Conditions', type: 'text' },
  ],
  entities: [1, 2, 3].map(number => ({ id: `entry-${number}`, kind: 'item', name: 'Published Loaf', summary: 'Published item',
    attributes: { source_price_unknown: '$16.98', source_category: 'Bakery', source_price_terms: '22 oz' } })),
  facts: [], relationships: [], collections: [], jobs: [], capabilities: [],
});
const authority = publishedWorkspace(sampleContent('general'), catalog);
const state = emptyWorkspace(authority.publicationId);
function fields(query: string) {
  const result = planWorkspaceIntent(query, state, authority, undefined, catalog);
  assert.ok(result.batch, result.message);
  return result.batch.operations.flatMap(operation => operation.kind === 'add' ? operation.object.references : [])
    .filter(ref => ref.kind === 'fact').map(ref => authority.records.find(record => record.reference.id === ref.id)!.keywords);
}
test('complete source field identifiers retain only their own facts across duplicate source entries', () => {
  for (const field of ['source_price_unknown', 'source_category', 'source_price_terms']) {
    assert.deepEqual(fields(`Published Loaf: ${field.toUpperCase()}?`), Array(3).fill(`attributes.${field}`));
  }
});
test('ordinary field components and labels still match without broadening explicit identifiers', () => {
  assert.deepEqual(fields('Published Loaf: category'), Array(3).fill('attributes.source_category'));
  assert.deepEqual(fields('Published Loaf: conditions'), Array(3).fill('attributes.source_price_terms'));
  assert.deepEqual(fields('Published Loaf: unknown'), Array(3).fill('attributes.source_price_unknown'));
  const prices = fields('Published Loaf: price');
  assert.equal(prices.length, 6);
  assert.ok(prices.every(field => field === 'attributes.source_price_unknown' || field === 'attributes.source_price_terms'));
});
test('partial identifiers and confirmation or stock words do not select unrelated price facts', () => {
  for (const term of ['price_unknown', 'source_price', 'confirm', 'now']) {
    assert.deepEqual(fields(`Published Loaf: ${term}`), [], term);
  }
});


test('natural label words retain underscore-separated labels without requiring field-key overlap', () => {
  const labeled = validateCatalog({ ...catalog, id: 'label-separators', attributes: [{ id: 'code', label: 'Model_Year', type: 'text' }],
    entities: [{ id: 'item', kind: 'item', name: 'Published Item', summary: 'Published item', attributes: { code: '2026' } }] });
  const labels = publishedWorkspace(sampleContent('general'), labeled);
  const view = emptyWorkspace(labels.publicationId);
  for (const term of ['year', 'MODEL_YEAR']) {
    const result = planWorkspaceIntent(`Published Item: ${term}`, view, labels, undefined, labeled);
    assert.ok(result.batch);
    const refs = result.batch.operations.flatMap(operation => operation.kind === 'add' ? operation.object.references : []);
    assert.equal(refs.length, 1);
    assert.equal(refs[0].kind, 'fact');
  }
});
