import assert from 'node:assert/strict';
import test from 'node:test';
import { knownAttributes, usefulAttributes } from '../packages/platform-ui/src/catalog';
import { validateCatalog } from '../packages/platform-ui/src/contracts';

test('display helpers omit unknown facts and sparse fields', () => {
  const catalog = validateCatalog({
    schemaVersion: 1, id: 'display-catalog', name: 'Display catalog', description: '', capabilities: [], collections: [], relationships: [], jobs: [],
    attributes: [
      { id: 'county', label: 'County', type: 'text' },
      { id: 'website', label: 'Website', type: 'text' },
      { id: 'one-off', label: 'One-off', type: 'text' },
    ],
    entities: [
      { id: 'one', kind: 'place', name: 'One', summary: '', attributes: { county: 'Orange', website: null, 'one-off': 'Only here' } },
      { id: 'two', kind: 'place', name: 'Two', summary: '', attributes: { county: 'Dutchess', website: 'example.org', 'one-off': null } },
    ],
  });
  assert.deepEqual(knownAttributes(catalog.entities[0], catalog.attributes).map(attribute => attribute.id), ['county', 'one-off']);
  assert.deepEqual(usefulAttributes(catalog).map(attribute => attribute.id), ['county']);
});
