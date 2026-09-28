import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogDiagram, diagramRelationshipLabel } from '@thevoice/platform-ui/diagram-model';
import classes from '../fixtures/catalogs/classes.json';
import bookstore from '../fixtures/catalogs/bookstore.json';

test('catalog maps preserve stable references and relationship direction across publisher domains', () => {
  for (const catalog of [classes, bookstore]) {
    const root = catalog.relationships[0].fromEntityId, map = catalogDiagram(catalog, root);
    assert.equal(map.nodes[0].entity.id, root);
    for (const edge of map.relationships) {
      assert.deepEqual(edge, catalog.relationships.find(item => item.id === edge.id));
      assert.ok(map.nodes.some(node => node.entity.id === edge.fromEntityId));
      assert.ok(map.nodes.some(node => node.entity.id === edge.toEntityId));
    }
    assert.deepEqual(map, catalogDiagram(catalog, root));
  }
  assert.throws(() => catalogDiagram(classes, 'private-item'), /Unknown diagram item/);
  assert.throws(() => catalogDiagram({ ...classes, relationships: [{ id: 'broken', fromEntityId: 'class-wheel', toEntityId: 'unknown', label: 'Invented' }] }, 'class-wheel'), /Unknown relationship entity/);
});

test('maps bound nodes and edges even with cycles, and report omitted results', () => {
  const entities = Array.from({ length: 30 }, (_, index) => ({ id: `item-${index}`, name: `Item ${index}`, kind: 'example', summary: '', attributes: {} }));
  const relationships = entities.slice(1).map(entity => ({ id: `edge-${entity.id}`, fromEntityId: 'item-0', toEntityId: entity.id, label: 'Related to' }));
  relationships.push({ id: 'cycle', fromEntityId: 'item-1', toEntityId: 'item-0', label: 'Returns to' });
  const map = catalogDiagram({ schemaVersion: 1, id: 'bounded', name: 'Bounded', description: '', attributes: [], entities, relationships, collections: [], jobs: [] }, 'item-0');
  assert.equal(map.nodes.length, 12); assert.equal(map.omitted, 18);
  assert.ok(map.relationships.length <= 24);
  assert.equal(map.nodes.filter(node => node.entity.id === 'item-0').length, 1);
});

test('relationship text keeps denial, qualifications and time information', () => {
  const text = diagramRelationshipLabel({ id: 'condition', fromEntityId: 'first', toEntityId: 'second', label: 'Available at', polarity: 'denied',
    qualifiers: [{ predicate: 'season', value: 'winter' }], validFrom: '2026-01-01', validTo: '2026-03-31', observedAt: '2026-01-01', confidence: .8 });
  assert.match(text, /^Not: Available at/); assert.match(text, /season: winter/); assert.match(text, /from 2026-01-01; until 2026-03-31; observed 2026-01-01; confidence 80%/);
});
