import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { catalogValueSchema, isSafeCapabilityUrl, validateCatalog, validatePlan, type KnowledgeCatalog } from '../packages/platform-ui/src/contracts.js';
import { defaultPresentation, filterEntities, formatAttribute } from '../packages/platform-ui/src/catalog.js';

const fixture = (name: string): KnowledgeCatalog => validateCatalog(JSON.parse(readFileSync(new URL(`../fixtures/catalogs/${name}.json`, import.meta.url), 'utf8')));
const copy = <T,>(value: T): T => structuredClone(value);

for (const name of ['tequila', 'bookstore', 'classes']) {
  test(`${name}: shared semantic catalog and initial presentation validate`, () => {
    const catalog = fixture(name);
    assert.equal(defaultPresentation(catalog).snapshotId, catalog.id);
    assert.ok(catalog.entities.length >= 4);
    assert.equal(catalog.capabilities?.length, 0);
    assert.ok(catalog.relationships.length > 0);
  });
}

test('catalog rejects duplicate IDs, unknown fields, dangling references and incorrectly typed attributes', () => {
  const catalog = fixture('tequila');
  const mutations: ((value: KnowledgeCatalog) => void)[] = [
    value => { value.entities.push(copy(value.entities[0])); },
    value => { value.entities[0].attributes.invented = 'yes'; },
    value => { value.entities[0].attributes.price = '36'; },
    value => { value.collections[0].entityIds.push('not-published'); },
    value => { value.relationships[0].toEntityId = 'not-published'; },
    value => { value.jobs[0].attributeIds.push('not-published'); },
    value => { delete value.attributes[0].currency; },
    value => { value.entities[0].attributes.abv = Number.POSITIVE_INFINITY; },
  ];
  for (const mutate of mutations) { const value = copy(catalog); mutate(value); assert.throws(() => validateCatalog(value)); }
  assert.throws(() => validateCatalog({ ...catalog, inventedCapability: 'purchase' }));
  assert.equal(catalogValueSchema.safeParse(Number.NaN).success, false);
});

test('valid leap dates survive and impossible dates do not', () => {
  const catalog = fixture('classes');
  catalog.entities[0].attributes.date = '2028-02-29';
  assert.doesNotThrow(() => validateCatalog(catalog));
  for (const invalid of ['2027-02-29', '2027-04-31', '2027-13-01', 'next Tuesday']) {
    catalog.entities[0].attributes.date = invalid;
    assert.throws(() => validateCatalog(catalog));
  }
});

test('oversized, cyclic and deeply nested untrusted payloads fail before schema parsing', () => {
  const catalog = fixture('tequila');
  catalog.entities = Array.from({ length: 101 }, (_, index) => ({ ...copy(catalog.entities[0]), id: `entity-${index}` }));
  assert.throws(() => validateCatalog(catalog));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => validateCatalog(cycle), /cycles/);
  let deep: unknown = 'leaf'; for (let i = 0; i < 15; i++) deep = { nested: deep };
  assert.throws(() => validateCatalog(deep), /depth/);
  assert.throws(() => validateCatalog({ content: 'x'.repeat(500001) }), /text size/);
});

test('unknown price cannot pass budget filtering; explicit unknown filtering is possible', () => {
  const catalog = fixture('tequila');
  assert.deepEqual(filterEntities(catalog, [{ attributeId: 'price', operator: 'lte', value: 50 }]).map(entity => entity.id), ['agave-blanco', 'agave-reposado']);
  assert.deepEqual(filterEntities(catalog, [{ attributeId: 'price', operator: 'eq', value: null }]).map(entity => entity.id), ['agave-small']);
  assert.throws(() => filterEntities(catalog, [{ attributeId: 'profile', operator: 'gte', value: 'oak' }]));
  assert.throws(() => filterEntities(catalog, [{ attributeId: 'invented', operator: 'eq', value: 'yes' }]));
});

test('classes combine typed constraints without treating schedule as capacity', () => {
  const catalog = fixture('classes');
  const result = filterEntities(catalog, [{ attributeId: 'level', operator: 'eq', value: 'beginner' }, { attributeId: 'materials', operator: 'eq', value: true }, { attributeId: 'date', operator: 'lte', value: '2027-05-12' }]);
  assert.deepEqual(result.map(entity => entity.id), ['class-handbuilding']);
  assert.equal(catalog.capabilities?.length, 0);
});

test('formatters expose unknowns and retain currency, numeric units, booleans and dates', () => {
  assert.equal(formatAttribute(null, { id: 'price', label: 'Price', type: 'money', currency: 'USD' }), 'Not provided');
  assert.equal(formatAttribute(12.5, { id: 'price', label: 'Price', type: 'money', currency: 'USD' }), '$12.50');
  assert.equal(formatAttribute(750, { id: 'volume', label: 'Volume', type: 'number', unit: 'ml' }), '750 ml');
  assert.equal(formatAttribute(false, { id: 'included', label: 'Included', type: 'boolean' }), 'No');
  assert.equal(formatAttribute('2027-05-12', { id: 'date', label: 'Date', type: 'date' }), 'May 12, 2027');
});

test('presentation uses existing references and stable registered identity', () => {
  const catalog = fixture('bookstore');
  const plan = {
    schemaVersion: 1, snapshotId: catalog.id, operation: 'compare',
    components: [{ id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: ['book-harbor-hardcover', 'book-harbor-paperback'], attributeIds: ['price', 'format'] }],
    transition: { type: 'expand', targetComponentId: 'comparison' },
  };
  assert.doesNotThrow(() => validatePlan(plan, catalog, catalog.id));
  assert.throws(() => validatePlan(plan, catalog, 'new-revision'), /stale/);
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], url: 'https://example.com/pay' }] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], entityIds: ['not-published', 'book-harbor-paperback'] }] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], entityIds: ['book-harbor-hardcover'] }] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], id: 'random-identity' }] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], variant: 'grid' }] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [copy(plan.components[0]), copy(plan.components[0])] }, catalog, catalog.id));
  assert.throws(() => validatePlan({ ...plan, transition: { type: 'focus', targetComponentId: 'detail' } }, catalog, catalog.id));
});

test('collection scope cannot reference another collection; detail requires exactly one entity', () => {
  const catalog = fixture('bookstore');
  const plan = defaultPresentation(catalog);
  plan.components = [{ id: 'collection', type: 'collection', variant: 'grid', entityIds: [], attributeIds: [], collectionId: 'books' }];
  assert.doesNotThrow(() => validatePlan(plan, catalog, catalog.id));
  plan.components[0].entityIds = ['author-rivera'];
  assert.throws(() => validatePlan(plan, catalog, catalog.id));
  plan.components = [{ id: 'detail', type: 'detail', variant: 'expanded', entityIds: [], attributeIds: [] }];
  assert.throws(() => validatePlan(plan, catalog, catalog.id));
});

test('only explicitly registered HTTPS capabilities can appear, with entity scope preserved', () => {
  for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]', 'https://server.internal', 'https://localhost', 'https://example.com:8080', 'https://127.0.0.1.nip.io']) assert.equal(isSafeCapabilityUrl(url), false, url);
  assert.equal(isSafeCapabilityUrl('https://example.com/catalog'), true);
  const catalog = fixture('tequila');
  catalog.capabilities = [{ id: 'publisher-details', kind: 'link', label: 'Publisher details', url: 'https://example.com/catalog', entityIds: ['agave-blanco'] }];
  const validated = validateCatalog(catalog);
  const plan = { schemaVersion: 1, snapshotId: catalog.id, operation: 'act', components: [{ id: 'actions', type: 'actions', variant: 'list', entityIds: ['agave-blanco'], attributeIds: [], capabilityIds: ['publisher-details'] }], transition: { type: 'reveal' } };
  assert.doesNotThrow(() => validatePlan(plan, validated, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], capabilityIds: ['invented-checkout'] }] }, validated, catalog.id));
  assert.throws(() => validatePlan({ ...plan, components: [{ ...plan.components[0], entityIds: ['agave-anejo'] }] }, validated, catalog.id));
});
