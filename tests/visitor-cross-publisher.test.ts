import test from 'node:test';
import assert from 'node:assert/strict';
import { taskFixture, publisherVocabularies, fixtureQuery } from '../fixtures/visitor-tasks';
import { compileQueryIndex } from '../lib/catalog-query-index';
import { evaluateQuery, compatibleComparisonFields } from '../lib/catalog-query';
import { patchQuery, type Expression, type FieldDescriptor } from '@thevoice/platform-ui/query';
import type { PublicationSpace } from '@thevoice/platform-ui/collection-space';

function field(space: PublicationSpace, descriptor: Omit<FieldDescriptor, 'coverage' | 'aliases' | 'recordTypes' | 'cardinality' | 'filter' | 'sort' | 'facet'>, values: (string | number | boolean | null)[]) {
  space.fields.push({ ...descriptor, aliases: [], recordTypes: [], cardinality: 'one', filter: true, sort: true, facet: true, coverage: { known: values.filter(value => value !== null).length, total: space.records.length } });
  space.records.forEach((record, i) => record.assertions.push({ id: `${descriptor.id}-${i}`, fieldId: descriptor.id, value: values[i] === null ? null : { type: descriptor.type, value: values[i], ...(descriptor.unit ? { unit: descriptor.unit } : {}), ...(descriptor.currency ? { currency: descriptor.currency } : {}), ...(descriptor.basis ? { basis: descriptor.basis } : {}) }, authority: 'publisher', polarity: 'affirmed', conditions: [] }));
}
test('media archive: date correction preserves nested topic and author OR with no unpublished records', () => {
  const space = taskFixture(publisherVocabularies[0]);
  field(space, { id: 'published-on', label: 'Publication date', type: 'date', operations: ['gte', 'lt'] }, ['2026-01-01', '2026-09-01', null, '2026-09-10', '2026-08-01', '2026-09-12', '2026-07-01', '2026-09-13']);
  const author: Expression = { kind: 'any', id: 'authors-or', children: [{ kind: 'field', id: 'author-a', fieldId: 'authors', op: 'any', value: { type: 'enum', value: ['alpha'] } }, { kind: 'field', id: 'author-b', fieldId: 'authors', op: 'any', value: { type: 'enum', value: ['beta'] } }] };
  const recent: Expression = { kind: 'field', id: 'recent', fieldId: 'published-on', op: 'gte', value: { type: 'date', value: '2026-09-09' } };
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [recent, author] }); query.scope = { collectionId: 'child', traversal: 'direct', path: ['root', 'topic', 'child'] };
  const index = compileQueryIndex(space); assert.deepEqual(evaluateQuery(index, query).ordered, ['record-00003', 'record-00005', 'record-00007']);
  const edited = patchQuery({ current: query, past: [] }, { queryId: query.queryId, baseRevision: 0, operations: [{ op: 'replaceConstraint', nodeId: 'recent', expression: { ...recent, value: { type: 'date', value: '2026-09-12' } } }] });
  assert.deepEqual(edited.current.scope, query.scope); assert.deepEqual(edited.current.where.kind === 'all' && edited.current.where.children[1], author); assert.deepEqual(evaluateQuery(index, edited.current).ordered, ['record-00005', 'record-00007']);
  assert.equal(index.records.has('premium-unpublished'), false);
});
test('portfolio and products: deliverables/preferences and currency/basis-safe compatible accessories', () => {
  const portfolio = taskFixture(publisherVocabularies[1]);
  field(portfolio, { id: 'deliverable', label: 'Deliverable', type: 'enum', operations: ['eq'] }, ['identity', 'web', 'web', 'identity', 'web', 'identity', 'web', 'web']);
  const query = fixtureQuery(portfolio, { kind: 'all', id: 'criteria', children: [{ kind: 'field', id: 'industry', fieldId: 'industries', op: 'any', value: { type: 'enum', value: ['alpha'] } }, { kind: 'field', id: 'deliverable', fieldId: 'deliverable', op: 'eq', value: { type: 'enum', value: 'identity' } }] });
  query.preferences = [{ expression: { kind: 'field', id: 'preferred', fieldId: 'deliverable-count', op: 'eq', value: { type: 'number', value: 5, unit: 'units' } }, weight: 3 }];
  assert.deepEqual(evaluateQuery(compileQueryIndex(portfolio), query).ordered, ['record-00005', 'record-00003']);
  const products = taskFixture(publisherVocabularies[2]); field(products, { id: 'cost', label: 'Price', type: 'money', currency: 'USD', basis: 'item', operations: ['lte'] }, [20, 80, null, 90, 110, 30, 200, 500]);
  const budget: Expression = { kind: 'field', id: 'budget', fieldId: 'cost', op: 'lte', value: { type: 'money', value: 100, currency: 'USD', basis: 'item' } };
  const compatible: Expression = { kind: 'relation', id: 'compatible', predicateId: 'relates', direction: 'out', target: budget };
  const index = compileQueryIndex(products); assert.deepEqual(evaluateQuery(index, fixtureQuery(products, compatible)).ordered, ['record-00000']);
  assert.throws(() => evaluateQuery(index, fixtureQuery(products, { ...budget, value: { ...budget.value, basis: 'hour' } })), /basis/);
  assert.throws(() => evaluateQuery(index, fixtureQuery(products, { ...budget, value: { ...budget.value, currency: 'EUR' } })), /basis/);
});
test('travel, education and sparse sources keep unknowns apart from documented accessibility and time-zone schedules', () => {
  const travel = taskFixture(publisherVocabularies[3]), index = compileQueryIndex(travel);
  const accessible: Expression = { kind: 'field', id: 'documented', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: true } };
  const result = evaluateQuery(index, fixtureQuery(travel, accessible)); assert.deepEqual(result.ordered, ['record-00000', 'record-00004', 'record-00006']); assert.equal(result.exclusions.unknown, 1);
  const education = taskFixture(publisherVocabularies[4]); field(education, { id: 'level', label: 'Course level', type: 'enum', operations: ['eq'] }, ['advanced', 'beginner', null, 'beginner', 'advanced', 'beginner', 'advanced', 'advanced']);
  field(education, { id: 'starts-at', label: 'Session start', type: 'date', timeZone: 'America/New_York', operations: ['gte', 'lt'] }, ['2026-09-15T17:00:00-04:00', '2026-09-15T18:00:00-04:00', null, '2026-09-16T18:00:00-04:00', '2026-09-15T19:00:00-04:00', '2026-09-15T20:00:00-04:00', '2026-09-15T21:00:00-04:00', '2026-09-17T20:00:00-04:00']);
  const query = fixtureQuery(education, { kind: 'all', id: 'criteria', children: [{ kind: 'field', id: 'level', fieldId: 'level', op: 'eq', value: { type: 'enum', value: 'beginner' } }, { kind: 'field', id: 'from', fieldId: 'starts-at', op: 'gte', value: { type: 'date', value: '2026-09-15T18:00:00-04:00' } }, { kind: 'field', id: 'to', fieldId: 'starts-at', op: 'lt', value: { type: 'date', value: '2026-09-16T00:00:00-04:00' } }] });
  assert.deepEqual(evaluateQuery(compileQueryIndex(education), query).ordered, ['record-00001', 'record-00005']);
  assert.throws(() => evaluateQuery(index, fixtureQuery(travel, { ...accessible, fieldId: 'live-availability' })), /Unsupported/);
  travel.records.forEach(record => record.assertions = record.assertions.filter(fact => fact.fieldId !== 'flag'));
  const sparse = evaluateQuery(compileQueryIndex(travel), fixtureQuery(travel, { kind: 'not', id: 'not', child: accessible })); assert.equal(sparse.ordered.length, 0); assert.equal(sparse.exclusions.unknown, 8);
});
test('derived collections materialize authorized source scopes; mixed type prices never become compatible fields', () => {
  const space = taskFixture();
  space.collections.push({ id: 'derived', kind: 'derived', name: 'Reviewed reading shortlist', introduction: '', view: 'list', derived: { scope: { collectionId: 'topic', traversal: 'descendants', path: ['root', 'topic'] }, where: { kind: 'field', id: 'minimum', fieldId: 'reading-minutes', op: 'gte', value: { type: 'number', value: 5, unit: 'units' } }, asOf: '2026-09-13' } }); space.edges.push({ parentId: 'root', childId: 'derived' });
  const index = compileQueryIndex(space), query = fixtureQuery(space); query.scope = { collectionId: 'derived', traversal: 'direct', path: ['root', 'derived'] };
  assert.deepEqual(evaluateQuery(index, query).ordered, ['record-00005', 'record-00006', 'record-00007']); assert.equal(evaluateQuery(index, fixtureQuery(space)).ordered.length, 8);
  const price = (id: string, type: string, basis: string): FieldDescriptor => ({ id, label: 'Price', aliases: [], recordTypes: [type], type: 'money', currency: 'USD', basis, cardinality: 'one', operations: ['lte'], filter: true, sort: true, facet: true, coverage: { known: 1, total: 1 } });
  assert.deepEqual(compatibleComparisonFields([price('purchase-price', 'product', 'item'), price('service-rate', 'service', 'hour')], ['product', 'service']), []);
});
