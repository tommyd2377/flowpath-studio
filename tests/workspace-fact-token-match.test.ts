import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { applyWorkspaceBatch, emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { sampleContent } from '../lib/site-model';
import { objectInput, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact } from '../lib/visitor-workspace';

// Synthetic published values reproduce the recorded label/field collisions.
// They are not current prices, inventory or a source of availability authority.
const catalog = validateCatalog({
  schemaVersion: 1, id: 'fact-token-fixture', name: 'Synthetic grocery', description: '',
  attributes: [{ id: 'source_price_unknown', label: 'Listed price (currency unconfirmed)', type: 'text' }],
  entities: [
    { id: 'nova', kind: 'item', name: 'Nova Portions', summary: 'Nova portions with separately listed size terms.', attributes: { source_price_unknown: '$14.98' } },
    { id: 'bagels', kind: 'item', name: 'Toasting Bagels Six Pack', summary: 'Cinnamon bagels; select an option for availability.', attributes: { source_price_unknown: '$10.98' } },
    { id: 'babka', kind: 'item', name: 'Chocolate Babka Loaf', summary: 'Chocolate babka; select an option for availability.', attributes: { source_price_unknown: '$16.98' } },
    { id: 'coffee', kind: 'item', name: 'Roasted Coffee Bag', summary: 'Espresso-ground coffee; select an option for availability.', attributes: { source_price_unknown: '$16.98' } },
  ],
  facts: [], relationships: [], collections: [], jobs: [], capabilities: [],
});

function setup(input = catalog) {
  const authority = publishedWorkspace(sampleContent('general'), input);
  const state = emptyWorkspace(authority.publicationId);
  return { authority, state, plan: (query: string) => planWorkspaceIntent(query, state, authority, undefined, input) };
}

test('confirmation and stock questions do not select unrelated price facts through partial words', () => {
  const { authority, state } = setup();
  const record = authority.records.find(record => record.reference.kind === 'entity' && record.reference.id === 'nova')!;
  const original = applyWorkspaceBatch(state, workspaceBatch(state, [{ kind: 'add', object: objectInput(record) }]), authority).state;
  const before = structuredClone(original);
  for (const query of [
    'The Nova page starts at $14.98, so 2.5 pounds is $14.98. Confirm.',
    'Are cinnamon bagels, chocolate babka and espresso-ground coffee definitely in stock right now?',
    'Please confirm the Nova total.',
    'Are bagels in stock now?',
  ]) {
    assert.ok(retrieveKnowledge(catalog, { revisionId: catalog.id, query, includeBlocks: false }).facts.length, 'The retrieval gate is exercised');
    const reply = planWorkspaceIntent(query, original, authority, undefined, catalog);
    assert.equal(reply.batch, undefined, query);
    assert.ok(reply.message.trim(), 'An unmatched question keeps the explicit fallback');
    assert.deepEqual(original, before, 'Unmatched questions preserve the current view');
  }
});

test('literal labels and field components still select published facts with case and separator punctuation', () => {
  const { authority, state, plan } = setup();
  for (const query of ['Show me the PRICE!', 'What is the listed price for Nova Portions?', 'Nova Portions: price/currency?', 'Nova Portions: unconfirmed?', 'Nova Portions: source_price_unknown?']) {
    const reply = plan(query);
    assert.ok(reply.batch, query);
    const next = applyWorkspaceBatch(state, reply.batch, authority).state;
    assert.ok(next.objects.length > 0);
    assert.ok(next.objects.every(object => object.references.every(ref => ref.kind === 'fact')), query);
    if (query.includes('Nova Portions')) {
      assert.equal(next.objects.length, 1, 'Exact subjects keep facts scoped to that entity');
      assert.equal(workspaceFact(catalog, next.objects[0].references[0].id)?.value.value, '$14.98');
    }
  }
});

test('an exact named subject still falls back to its published detail without inventing stock', () => {
  const { authority, state, plan } = setup();
  const reply = plan('Are Nova Portions in stock now?');
  assert.ok(reply.batch);
  assert.equal(reply.message, '');
  const next = applyWorkspaceBatch(state, reply.batch, authority).state;
  assert.deepEqual(next.objects.map(object => object.references), [[{ kind: 'entity', id: 'nova', revisionId: catalog.id }]]);
  assert.equal(next.objects[0].component, 'detail');
});

test('fact labels retain complete numeric tokens and do not match different decimal or fraction values', () => {
  const numericCatalog = validateCatalog({ ...catalog, id: 'numeric-token-fixture', attributes: [],
    entities: [{ id: 'terms', kind: 'information', name: 'Published Terms', summary: 'Terms 100.50 100.99 109 1099 2.5 2.50 2/5 2/50', attributes: {} }],
    facts: [
      { id: 'amount', entityId: 'terms', field: 'properties.amount', value: 'Published condition', definition: { id: 'amount', label: '100.50', type: 'text' } },
      { id: 'code', entityId: 'terms', field: 'properties.code', value: 'Published condition', definition: { id: 'code', label: '1099', type: 'text' } },
      { id: 'size', entityId: 'terms', field: 'properties.size', value: 'Published condition', definition: { id: 'size', label: '2.5', type: 'text' } },
      { id: 'fraction', entityId: 'terms', field: 'properties.fraction', value: 'Published condition', definition: { id: 'fraction', label: '2/5', type: 'text' } },
      { id: 'grouped', entityId: 'terms', field: 'properties.grouped', value: 'Published condition', definition: { id: 'grouped', label: '1,000', type: 'text' } },
      { id: 'punctuation', entityId: 'terms', field: 'properties.punctuation', value: 'Published condition', definition: { id: 'punctuation', label: 'Code,500', type: 'text' } },
    ],
  });
  const { authority, state, plan } = setup(numericCatalog);
  for (const [query, id] of [['Show 100.50.', 'amount'], ['Show (1099).', 'code'], ['Show 2.5.', 'size'], ['Show 2/5.', 'fraction'], ['Show 1,000.', 'grouped'], ['Show 500.', 'punctuation']]) {
    const reply = plan(query);
    assert.ok(reply.batch, query);
    const next = applyWorkspaceBatch(state, reply.batch, authority).state;
    assert.deepEqual(next.objects.flatMap(object => object.references.map(ref => ref.id)), [id], query);
  }
  for (const query of ['Show 100.99.', 'Show 109.', 'Show 2.50.', 'Show 2/50.']) {
    const reply = plan(query);
    assert.equal(reply.batch, undefined, query);
    assert.ok(reply.message.trim(), query);
  }
});
