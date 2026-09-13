import assert from 'node:assert/strict';
import test from 'node:test';
import { compileQueryIndex, QueryIndexCache } from '../lib/catalog-query-index';
import { evaluateQuery, projectField, QueryResultStore } from '../lib/catalog-query';
import { publisherVocabularies, taskFixture, fixtureQuery } from '../fixtures/visitor-tasks';
import { patchQuery, type Expression } from '@thevoice/platform-ui/query';

for (const vocabulary of publisherVocabularies) test(`${vocabulary.name}: one engine scopes/deduplicates, patches and ranks hard matches`, () => {
  const space = taskFixture(vocabulary), index = compileQueryIndex(space);
  const amount: Expression = { kind: 'field', id: 'amount', fieldId: vocabulary.field, op: 'gte', value: { type: 'number', value: 3, unit: 'units' } };
  const tags: Expression = { kind: 'field', id: 'tags', fieldId: vocabulary.tag, op: 'any', value: { type: 'enum', value: ['alpha'] } };
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [amount, tags] });
  assert.deepEqual(evaluateQuery(index, query).ordered, ['record-00003', 'record-00005', 'record-00007']);
  const patched = patchQuery({ current: query, past: [] }, { queryId: query.queryId, baseRevision: 0, operations: [{ op: 'replaceConstraint', nodeId: 'tags', expression: { ...tags, value: { type: 'enum', value: ['alpha', 'gamma'] } } }] });
  assert.deepEqual(evaluateQuery(index, patched.current).ordered, ['record-00003', 'record-00004', 'record-00005', 'record-00006', 'record-00007']);
  const preference = { ...amount, value: { type: 'number' as const, value: 0, unit: 'units' }, op: 'eq' as const };
  assert.deepEqual(evaluateQuery(index, { ...query, preferences: [{ expression: preference, weight: 10 }] }).ordered, evaluateQuery(index, query).ordered);
  const union = fixtureQuery(space); union.scope = { collectionId: vocabulary.branch, traversal: 'explicitUnion', include: ['cross'], path: ['root', vocabulary.branch] };
  assert.equal(evaluateQuery(index, union).ordered.length, 8);
  union.scope = { collectionId: vocabulary.branch, traversal: 'direct', path: ['root', vocabulary.branch] };
  assert.deepEqual(evaluateQuery(index, union).ordered, ['record-00000', 'record-00002', 'record-00004', 'record-00006']);
});
test('NOT preserves unknown; false differs from missing and conflict/conditional/stale remain explicit', () => {
  const space = taskFixture();
  space.records[3].assertions.push({ ...space.records[3].assertions[0], id: 'conflict', value: { type: 'number', value: 8, unit: 'units' } });
  space.records[4].assertions[0].conditions = ['Only with review']; space.records[5].assertions[0].validTo = '2020-01-01';
  const index = compileQueryIndex(space), field = space.fields[0].id;
  assert.deepEqual([2, 3, 4, 5].map(i => projectField(index, `record-0000${i}`, field, '2026-09-13').state), ['unknown', 'conflicting', 'conditional', 'stale']);
  const flag: Expression = { kind: 'field', id: 'flag-is-true', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: true } };
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, { kind: 'not', id: 'not', child: flag })).ordered, ['record-00001', 'record-00003', 'record-00005', 'record-00007']);
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, { kind: 'state', id: 'missing', fieldId: 'flag', state: 'unknown' })).ordered, ['record-00002']);
});
test('nested Boolean/list/relationship queries have declared direction; incompatible units fail', () => {
  const space = taskFixture(), index = compileQueryIndex(space), field = space.fields[0].id;
  const flag: Expression = { kind: 'field', id: 'f', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: false } };
  const relationship: Expression = { kind: 'relation', id: 'relation', predicateId: 'relates', direction: 'out', target: flag };
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, relationship)).ordered, ['record-00000']);
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, { ...relationship, direction: 'in' })).ordered, []);
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, { kind: 'any', id: 'or', children: [relationship, { kind: 'not', id: 'not', child: { ...flag, id: 'f2' } }] })).ordered, ['record-00000', 'record-00004', 'record-00006']);
  assert.throws(() => evaluateQuery(index, fixtureQuery(space, { kind: 'field', id: 'bad', fieldId: field, op: 'lt', value: { type: 'number', value: 10, unit: 'metres' } })), /measurement/);
  const all: Expression = { kind: 'field', id: 'all-tags', fieldId: space.fields[1].id, op: 'all', value: { type: 'enum', value: ['alpha', 'beta'] } };
  assert.deepEqual(evaluateQuery(index, fixtureQuery(space, all)).ordered, ['record-00001', 'record-00003', 'record-00005', 'record-00007']);
});
test('facets omit their own clause and zero-result alternatives require an explicit edit', () => {
  const space = taskFixture(), index = compileQueryIndex(space);
  const query = fixtureQuery(space, { kind: 'all', id: 'criteria', children: [{ kind: 'field', id: 'flag', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: true } }] });
  assert.deepEqual(evaluateQuery(index, query, { facets: ['flag'] }).facets[0], { fieldId: 'flag', values: [{ value: false, count: 4 }, { value: true, count: 3 }], unknown: 1, coverage: 'complete' });
  const impossible = fixtureQuery(space, { kind: 'field', id: 'budget', fieldId: space.fields[0].id, op: 'gt', value: { type: 'number', value: 1000, unit: 'units' } });
  const before = JSON.stringify(impossible), result = evaluateQuery(index, impossible);
  assert.deepEqual(result.ordered, []); assert.deepEqual(result.alternatives, [{ removeNodeId: 'budget', count: 8 }]); assert.equal(JSON.stringify(impossible), before);
});
test('page cursors and codes bind session, publication, scope, sort and revision', () => {
  const space = taskFixture(publisherVocabularies[0], 120), index = compileQueryIndex(space), query = fixtureQuery(space);
  let now = Date.now(); const results = new QueryResultStore(() => now), authority = { publication: space.publication, sessionId: 'session', entitlement: 'public' };
  const first = results.query(index, query, authority), second = results.query(index, query, authority, { cursor: first.nextCursor! });
  assert.equal(first.count.value, 120); assert.equal(first.items.length, 24); assert.equal(second.items[0].code, 'R25');
  assert.equal(results.resolve(second.resultSetId, 25, query, authority), 'record-00024');
  for (const changed of [{ ...query, revision: 1 }, { ...query, order: [{ fieldId: space.fields[0].id, direction: 'desc' as const }] }]) assert.throws(() => results.query(index, changed, authority, { cursor: first.nextCursor! }), /cursor/);
  assert.throws(() => results.query(index, query, { ...authority, sessionId: 'other' }, { cursor: first.nextCursor! }), /cursor/);
  assert.throws(() => results.query(index, query, { ...authority, publication: { ...authority.publication, siteId: 'other' } }), /authority/);
  now += 31 * 60_000; assert.throws(() => results.resolve(first.resultSetId, 1, query, authority), /Stale/);
  const cache = new QueryIndexCache(index.bytes); cache.set('one', index); cache.set('two', index); assert.equal(cache.get('one'), undefined); assert.equal(cache.sizeBytes, index.bytes);
});

test('facet and refinement pruning removes emptied Boolean wrappers without redefining explicit empty OR', () => {
  const space = taskFixture(), index = compileQueryIndex(space);
  const flag: Expression = { kind: 'field', id: 'flag', fieldId: 'flag', op: 'eq', value: { type: 'boolean', value: true } };
  const wrappers: Expression[] = [flag, { kind: 'any', id: 'or', children: [flag] }, { kind: 'all', id: 'and', children: [{ kind: 'not', id: 'not', child: { kind: 'any', id: 'or', children: [flag] } }] }];
  for (const where of wrappers) {
    const query = fixtureQuery(space, where), original = JSON.stringify(query);
    assert.deepEqual(evaluateQuery(index, query, { facets: ['flag'] }).facets[0], { fieldId: 'flag', values: [{ value: false, count: 4 }, { value: true, count: 3 }], unknown: 1, coverage: 'complete' });
    assert.equal(JSON.stringify(query), original);
  }
  const amount: Expression = { kind: 'field', id: 'minimum', fieldId: space.fields[0].id, op: 'gte', value: { type: 'number', value: 5, unit: 'units' } };
  const mixed = fixtureQuery(space, { kind: 'all', id: 'and', children: [{ kind: 'any', id: 'or', children: [flag] }, amount] });
  assert.deepEqual(evaluateQuery(index, mixed, { facets: ['flag'] }).facets[0].values, [{ value: false, count: 2 }, { value: true, count: 1 }]);
  const impossible = fixtureQuery(space, { kind: 'any', id: 'or', children: [{ ...amount, value: { type: 'number', value: 1000, unit: 'units' } }] });
  assert.deepEqual(evaluateQuery(index, impossible).alternatives, [{ removeNodeId: 'minimum', count: 8 }]);
  const empty = evaluateQuery(index, fixtureQuery(space, { kind: 'any', id: 'empty', children: [] }), { facets: ['flag'] });
  assert.deepEqual(empty.ordered, []); assert.deepEqual(empty.facets[0].values, []); assert.deepEqual(empty.alternatives, []);
});
