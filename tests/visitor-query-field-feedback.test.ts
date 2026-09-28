import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldDescriptorSchema, validateQueryFields, type FieldDescriptor } from '@thevoice/platform-ui/query';
import { fixtureQuery, publisherVocabularies, taskFixture } from '../fixtures/visitor-tasks';
import { queryFieldFeedback } from '../lib/visitor-query-field-feedback';

test('rejected fields include exact published candidates for nested criteria, preferences and sort in every vocabulary', () => {
  for (const vocabulary of publisherVocabularies) {
    const space = taskFixture(vocabulary), fields = space.fields.map(field => ({ ...field, id: `attributes.${field.id}` }));
    const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [
      { kind: 'any', id: 'alternatives', children: [{ kind: 'not', id: 'not-flag', child: { kind: 'field', id: 'flag-choice', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } } }] },
      { kind: 'relation', id: 'relationship', predicateId: 'relates', direction: 'out', target: { kind: 'state', id: 'known-tag', fieldId: vocabulary.tag, state: 'known' } },
    ] });
    query.preferences = [{ expression: { kind: 'state', id: 'known-size', fieldId: vocabulary.field, state: 'known' }, weight: 1 }];
    query.order = [{ fieldId: vocabulary.field, direction: 'desc' }];
    const before = structuredClone(query), feedback = queryFieldFeedback(query, fields);
    assert.deepEqual(feedback.references.map(reference => reference.requestedId), ['flag', vocabulary.tag, vocabulary.field]);
    assert.ok(feedback.references.every(reference => reference.match === 'candidate' && reference.omittedCandidates === 0));
    assert.deepEqual(feedback.references.map(reference => reference.candidateIds), [['attributes.flag'], [`attributes.${vocabulary.tag}`], [`attributes.${vocabulary.field}`]]);
    assert.deepEqual(feedback.fields.find(field => field.id === `attributes.${vocabulary.field}`), {
      id: `attributes.${vocabulary.field}`, label: vocabulary.field, type: 'number', cardinality: 'one', unit: 'units',
      currency: undefined, basis: undefined, operations: ['eq', 'lt', 'lte', 'gt', 'gte'], filter: true, sort: true,
    });
    assert.deepEqual(query, before, 'Discovery must not rewrite or implicitly accept rejected IDs');
    assert.throws(() => validateQueryFields(query, fields, space.relationshipTypes), /Unsupported filter field/);
    const sortOnly = fixtureQuery(space); sortOnly.order = [{ fieldId: vocabulary.field, direction: 'asc' }];
    assert.equal(queryFieldFeedback(sortOnly, fields).references[0].requestedId, vocabulary.field);
    assert.throws(() => validateQueryFields(sortOnly, fields, space.relationshipTypes), /sort/i);
  }
});

test('field discovery preserves price basis, ambiguous aliases and unknown IDs without selecting a replacement', () => {
  const space = taskFixture();
  const money = (id: string, basis: string, aliases: string[] = []): FieldDescriptor => fieldDescriptorSchema.parse({
    id, label: 'Published price', aliases, recordTypes: ['service'], type: 'money', cardinality: 'one', currency: 'EUR', basis,
    operations: ['eq', 'lt', 'lte'], filter: true, sort: true, facet: false, coverage: { known: 4, total: 5 },
  });
  const fields = [money('services.price', 'appointment', ['session-cost']), money('products.price', 'unit', ['unit cost'])];
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [
    { kind: 'state', id: 'ambiguous', fieldId: 'price', state: 'known' },
    { kind: 'state', id: 'alias', fieldId: 'session_cost', state: 'known' },
    { kind: 'state', id: 'unrelated', fieldId: 'best-price', state: 'known' },
  ] });
  query.order = [{ fieldId: 'services.price', direction: 'desc' }];
  const feedback = queryFieldFeedback(query, fields);
  assert.deepEqual(feedback.references.map(reference => [reference.requestedId, reference.match, reference.candidateIds]), [
    ['price', 'ambiguous', ['services.price', 'products.price']],
    ['session_cost', 'candidate', ['services.price']],
    ['best-price', 'unknown', []],
    ['services.price', 'exact', ['services.price']],
  ]);
  assert.deepEqual(feedback.fields.map(field => [field.id, field.currency, field.basis]), [['services.price', 'EUR', 'appointment'], ['products.price', 'EUR', 'unit']]);
  assert.throws(() => validateQueryFields(query, fields, []), /Unsupported filter field/);
  const exact = fixtureQuery(space); exact.order = [{ fieldId: 'price', direction: 'desc' }];
  const withExact = queryFieldFeedback(exact, [...fields, money('price', 'hour')]);
  assert.deepEqual(withExact.references, [{ requestedId: 'price', match: 'exact', candidateIds: ['price'], omittedCandidates: 0 }]);
  const disabled = [{ ...fields[0], sort: false }];
  assert.equal(queryFieldFeedback(exact, disabled).fields[0].sort, false);
});

test('published field discovery is bounded and reports every omitted reference or candidate explicitly', () => {
  const space = taskFixture(), base = space.fields[0];
  const fields = Array.from({ length: 12 }, (_, i) => ({ ...base, id: `namespace${i}.amount`, label: 'Amount', aliases: ['measure'] }));
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: Array.from({ length: 10 }, (_, i) => ({
    kind: 'state' as const, id: `state-${i}`, fieldId: i === 0 ? 'amount' : `unknown${i}`, state: 'known' as const,
  })) });
  const feedback = queryFieldFeedback(query, fields);
  assert.equal(feedback.references.length, 8); assert.equal(feedback.omittedReferences, 2);
  assert.equal(feedback.fields.length, 6);
  assert.deepEqual(feedback.references[0], { requestedId: 'amount', match: 'ambiguous', candidateIds: fields.slice(0, 6).map(field => field.id), omittedCandidates: 6 });
  assert.ok(feedback.references.slice(1).every(reference => reference.match === 'unknown' && reference.candidateIds.length === 0));
  assert.ok(Buffer.byteLength(JSON.stringify(feedback)) < 4000, 'No full registry or unrelated values are duplicated into the tool error');
});
