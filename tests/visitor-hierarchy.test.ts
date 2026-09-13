import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { interpretSourceWithProvenance, extractSource } from '../lib/source-extractors';
import { mergeKnowledge } from '../lib/knowledge-model';
import { adaptV1Catalog } from '@thevoice/platform-ui/collection-space';
import { validateCatalog } from '@thevoice/platform-ui/contracts';

test('heading documents and website HTML produce nested proposals with paragraph detail blocks', async () => {
  for (const [name, mime, text] of [['guide.txt', 'text/plain', '# Region\n## Museum\nA public history collection.\n\nA second paragraph for the same museum.'],
    ['guide.html', 'text/html', '<h1>Region</h1><h2>Museum</h2><p>A public history collection.</p><p>A second paragraph for the same museum.</p><script>privateInjected()</script>']]) {
    const extracted = await extractSource(name, mime, Buffer.from(text));
    const proposal = interpretSourceWithProvenance(name, extracted)!;
    assert.equal(proposal.catalog.entities.length, 1, 'paragraphs are not separate cards');
    assert.equal(proposal.catalog.collections.length, 2);
    assert.deepEqual(proposal.catalog.collections[1].parentIds, [proposal.catalog.collections[0].id]);
    assert.match(proposal.catalog.entities[0].blocks![0].text, /public history/);
    assert.doesNotMatch(JSON.stringify(proposal.catalog), /privateInjected/);
    assert.ok(proposal.provenance.anchors.length);
  }
});
test('cross-listing and removed memberships survive actual source merge and reimport', () => {
  const source = interpretSourceWithProvenance('items.txt', { format: 'text', text: '# Services\n## Projects\nName: Harbor\nIndustry: arts' })!;
  const catalog = source.catalog;
  const field = source.provenance.fields.find(field => field.field === 'attributes.industry')!;
  assert.equal(field.entityId, catalog.entities[0].id);
  const anchor = source.provenance.anchors.find(anchor => anchor.id === field.anchorIds[0])!;
  assert.equal(anchor.lineStart, 3); assert.equal(anchor.lineEnd, 4); assert.match(anchor.excerpt, /Industry: arts/);
  catalog.collections[0].entityIds = [catalog.entities[0].id];
  let merged = mergeKnowledge(null, catalog, { name: 'items.txt', fileId: randomUUID(), hash: 'first', provenance: source.provenance });
  const canonicalId = merged.catalog.entities[0].id;
  assert.equal(merged.catalog.collections.filter(collection => collection.entityIds.includes(canonicalId)).length, 2);
  merged.catalog.collections[1].entityIds = [];
  merged.catalog.collections[1].name = 'Reviewed work';
  merged = mergeKnowledge(merged, { ...catalog, description: 'Updated source' }, { name: 'items.txt', fileId: randomUUID(), hash: 'second', provenance: source.provenance });
  assert.equal(merged.catalog.entities.length, 1); assert.equal(merged.catalog.entities[0].id, canonicalId);
  assert.deepEqual(merged.catalog.collections[1].entityIds, []); assert.equal(merged.catalog.collections[1].name, 'Reviewed work');
  assert.throws(() => validateCatalog({ ...merged.catalog, collections: merged.catalog.collections.map((collection, index, all) => ({ ...collection, parentIds: [all[1 - index].id] })) }), /acyclic/);
  const publicSpace = adaptV1Catalog(merged.catalog, { siteId: 'site', revisionId: merged.id, indexRevision: merged.id }).space;
  assert.doesNotMatch(JSON.stringify(publicSpace), /anchorIds|provenance|sourceName|items.txt/);
});

test('legacy human labels become valid distinct task IDs without changing published records', () => {
  const kinds = ["Traveler's guide (regional)", 'A B', 'A20B', '博物館'.repeat(20), 'place'];
  const predicates = ['located in', 'located-in', 'legacy-predicate-1', 'à proximité', 'owns'];
  const units = ['/person', '-person', 'per person', 'per-person'];
  const catalog = validateCatalog({ schemaVersion: 1, id: randomUUID(), name: 'General publisher', description: '',
    attributes: units.map((unit, index) => ({ id: `price-${index}`, label: `Price ${index}`, type: 'money', currency: 'USD', unit })),
    entities: kinds.map((kind, index) => ({ id: `record-${index}`, name: `Item ${index}`, kind, summary: '', attributes: Object.fromEntries(units.map((_, index) => [`price-${index}`, 10])) })),
    collections: [], relationships: predicates.map((kind, index) => ({ id: `rel-${index}`, kind, label: `Relation ${index}`, fromEntityId: 'record-0', toEntityId: 'record-1' })), jobs: [], capabilities: [] });
  const publication = { siteId: 'site', revisionId: catalog.id, indexRevision: catalog.id };
  const adapted = adaptV1Catalog(catalog, publication);
  assert.deepEqual(adapted.legacy, catalog);
  assert.deepEqual(adapted.space.records.map(record => record.id), catalog.entities.map(entity => entity.id));
  assert.equal(new Set(adapted.space.records.map(record => record.type)).size, kinds.length);
  assert.equal(new Set(adapted.space.fields.map(field => field.basis)).size, units.length);
  assert.equal(new Set(adapted.space.relationshipTypes.map(type => type.id)).size, predicates.length);
  assert.equal(adapted.space.relationships.find(relation => relation.id === 'rel-4')?.predicateId, 'owns');
  for (const relation of adapted.space.relationships) assert.ok(adapted.space.relationshipTypes.some(type => type.id === relation.predicateId));
  const reversed = adaptV1Catalog({ ...catalog, entities: [...catalog.entities].reverse(), attributes: [...catalog.attributes].reverse(), relationships: [...catalog.relationships].reverse() }, publication).space;
  for (const relation of adapted.space.relationships) assert.equal(reversed.relationships.find(item => item.id === relation.id)?.predicateId, relation.predicateId);
  for (const record of adapted.space.records) assert.equal(reversed.records.find(item => item.id === record.id)?.type, record.type);
});
