import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { adaptV1Catalog, validatePublicationSpace } from '@thevoice/platform-ui/collection-space';
import { expressionSchema, fieldDescriptorSchema, patchQuery, querySpecSchema, validateQueryFields } from '@thevoice/platform-ui/query';
import { capabilityDescriptorSchema } from '@thevoice/platform-ui/task';

const publication = { siteId: 'site-a', revisionId: 'revision-a', indexRevision: 'index-a' };
test('every legacy catalog adapts with original entity IDs, assertions and lossless legacy data', async () => {
  for (const file of await readdir('fixtures/catalogs')) {
    if (!file.endsWith('.json')) continue;
    const catalog = JSON.parse(await readFile(`fixtures/catalogs/${file}`, 'utf8'));
    const adapted = adaptV1Catalog(catalog, publication);
    assert.deepEqual(adapted.legacy, catalog);
    assert.deepEqual(adapted.space.records.map(record => record.id), catalog.entities.map((entity: { id: string }) => entity.id));
    assert.equal(new Set(adapted.space.memberships.map(member => member.recordId)).size, catalog.entities.length);
    assert.ok(adapted.space.records.every(record => record.assertions.every(fact => fact.authority === 'publisher')));
    assert.throws(() => validatePublicationSpace({ ...adapted.space, memberships: [...adapted.space.memberships, { collectionId: adapted.space.rootId, recordId: 'other-site-record' }] }), /membership/);
    const child = adapted.space.collections.find(collection => collection.id !== adapted.space.rootId)!;
    assert.throws(() => validatePublicationSpace({ ...adapted.space, edges: [...adapted.space.edges, { parentId: child.id, childId: adapted.space.rootId }] }));
  }
});
test('bounded strict expressions reject cycles, excess depth, duplicate IDs and unsupported fields', () => {
  const cyclic = { kind: 'not', id: 'cycle', child: {} }; cyclic.child = cyclic;
  assert.equal(expressionSchema.safeParse(cyclic).success, false);
  assert.equal(expressionSchema.safeParse({ kind: 'all', id: 'root', children: Array.from({ length: 25 }, (_, i) => ({ kind: 'state', id: `s${i}`, fieldId: 'x', state: 'unknown' })) }).success, false);
  assert.equal(expressionSchema.safeParse({ kind: 'all', id: 'root', children: [{ kind: 'state', id: 'root', fieldId: 'x', state: 'unknown' }] }).success, false);
  const query = querySpecSchema.parse({ version: 2, queryId: 'q', revision: 0, publication, scope: { collectionId: 'root', traversal: 'descendants', path: ['root'] }, where: { kind: 'state', id: 's', fieldId: 'private', state: 'unknown' }, preferences: [], order: [], asOf: '2026-09-13', timeZone: 'UTC' });
  assert.throws(() => validateQueryFields(query, [], []), /Unsupported/);
});
test('query edits preserve independent constraints; undo/fork keep host revisions', () => {
  const where = { kind: 'all', id: 'criteria', children: ['budget', 'size'].map(id => ({ kind: 'field', id, fieldId: id, op: 'gte', value: { type: 'number', value: 50 } })) };
  const original = querySpecSchema.parse({ version: 2, queryId: 'q', revision: 0, publication, scope: { collectionId: 'root', traversal: 'descendants', path: ['root'] }, where, preferences: [], order: [], asOf: '2026-09-13', timeZone: 'UTC' });
  const replaced = patchQuery({ current: original, past: [] }, { queryId: 'q', baseRevision: 0, operations: [{ op: 'replaceConstraint', nodeId: 'size', expression: { ...where.children[1], value: { type: 'number', value: 80 } } }] });
  assert.deepEqual('children' in replaced.current.where && replaced.current.where.children[0], where.children[0]);
  assert.throws(() => patchQuery(replaced, { queryId: 'q', baseRevision: 0, operations: [{ op: 'undo' }] }), /changed/);
  const undo = patchQuery(replaced, { queryId: 'q', baseRevision: 1, operations: [{ op: 'undo' }] });
  assert.deepEqual(undo.current.where, original.where); assert.equal(undo.current.revision, 2);
  assert.equal(patchQuery(undo, { queryId: 'q', baseRevision: 2, operations: [{ op: 'fork' }] }, 'new-q').current.queryId, 'new-q');
});
test('descriptors reject incompatible operations and arbitrary executable config', () => {
  assert.equal(fieldDescriptorSchema.safeParse({ id: 'flag', label: 'Flag', aliases: [], recordTypes: [], type: 'boolean', cardinality: 'one', operations: ['lt'], filter: true, sort: true, facet: true, coverage: { known: 0, total: 0 } }).success, false);
  assert.equal(capabilityDescriptorSchema.safeParse({ id: 'arbitrary', endpoint: 'https://example.com/execute' }).success, false);
});

test('v1 migration retains registered links and shares authorized photo records across albums without identity collision', () => {
  const legacy = { schemaVersion: 1 as const, id: 'catalog', name: 'Publisher', description: '', attributes: [], entities: [{ id: 'photo-a', kind: 'project', name: 'Actual project', summary: '', attributes: {} }], collections: [], relationships: [], jobs: [], capabilities: [{ id: 'contact', kind: 'link' as const, label: 'Contact publisher', url: 'https://example.com/contact', entityIds: ['photo-a'] }] };
  const media = { schemaVersion: 1 as const, id: 'media', assets: [{ id: 'photo-a', width: 640, height: 480, caption: 'Reviewed illustration', alt: 'Example photo' }], albums: ['album-a', 'album-b'].map(id => ({ id, title: id, description: '', assetIds: ['photo-a'] })), associations: [{ id: 'example', assetId: 'photo-a', targetType: 'entity' as const, targetId: 'photo-a', role: 'example' as const }] };
  const { space } = adaptV1Catalog(legacy, publication, media);
  assert.deepEqual(space.links, legacy.capabilities); assert.equal(space.records.find(record => record.id === 'photo-a')!.name, 'Actual project');
  const photos = space.records.filter(record => record.media); assert.equal(photos.length, 1); assert.equal(photos[0].media!.assetId, 'photo-a'); assert.equal(photos[0].media!.role, 'example');
  assert.equal(space.memberships.filter(member => member.recordId === photos[0].id).length, 3); assert.equal(space.collections.find(collection => collection.id === 'album-a')!.view, 'gallery');
  assert.throws(() => validatePublicationSpace({ ...space, links: [{ ...space.links[0], entityIds: ['private-record'] }] }), /publisher link/);
});
