import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCatalog, validatePlan, type CatalogFilter } from '../packages/platform-ui/src/contracts.js';
import { defaultPresentation, filterEntities } from '../packages/platform-ui/src/catalog.js';
import { applyPresentationState, initialInteraction, planForIntent } from '../packages/platform-ui/src/interaction.js';
import { catalogPresentationJsonSchema, parseCatalogPresentation } from '../lib/catalog-presentation';

const fixture = (name = 'tequila') => validateCatalog(JSON.parse(readFileSync(new URL(`../fixtures/catalogs/${name}.json`, import.meta.url), 'utf8')));

test('filter updates are explicit, bounded and strictly validated before state changes', () => {
  const catalog = fixture('classes'); const plan = defaultPresentation(catalog);
  const current = { ...initialInteraction(catalog), filters: [{ attributeId: 'price', operator: 'lte' as const, value: 40 }], selectedIds: ['class-handbuilding'] };
  assert.equal(applyPresentationState(current, plan), current);
  const reset = validatePlan({ ...plan, stateUpdate: { filters: [] } }, catalog, catalog.id);
  assert.deepEqual(applyPresentationState(current, reset), { ...current, filters: [] });
  const valid = [{ attributeId: 'date', operator: 'gte', value: '2027-05-12' }, { attributeId: 'materials', operator: 'eq', value: true }];
  assert.doesNotThrow(() => validatePlan({ ...plan, stateUpdate: { filters: valid } }, catalog, catalog.id));
  for (const stateUpdate of [
    { filters: [{ attributeId: 'missing', operator: 'eq', value: 5 }] },
    { filters: [{ attributeId: 'price', operator: 'lte', value: '50' }] },
    { filters: [{ attributeId: 'price', operator: 'contains', value: 50 }] },
    { filters: [{ attributeId: 'date', operator: 'gte', value: '2027-02-29' }] },
    { filters: [{ attributeId: 'materials', operator: 'gt', value: true }] },
    { filters: [{ attributeId: 'price', operator: 'gte', value: null }] },
    { filters: Array.from({ length: 25 }, () => ({ attributeId: 'price', operator: 'lte', value: 50 })) },
    { filters: [], selectedIds: ['class-wheel'] }, { reset: true }, null,
  ]) assert.throws(() => validatePlan({ ...plan, stateUpdate }, catalog, catalog.id));
  assert.deepEqual(current.filters, [{ attributeId: 'price', operator: 'lte', value: 40 }]);
});

test('demo constraints replace the same bound, preserve unrelated criteria, and explicitly reset', () => {
  const catalog = fixture();
  const filters: CatalogFilter[] = [{ attributeId: 'price', operator: 'gte', value: 30 }, { attributeId: 'price', operator: 'lte', value: 40 }, { attributeId: 'abv', operator: 'gte', value: 40 }];
  const current = { ...initialInteraction(catalog), filters, selectedIds: ['agave-blanco'] };
  const next = planForIntent(catalog, 'up to $72', current);
  assert.deepEqual(next.stateUpdate?.filters, [filters[0], filters[2], { attributeId: 'price', operator: 'lte', value: 72 }]);
  assert.deepEqual(filterEntities(catalog, applyPresentationState(current, next).filters).map(entity => entity.id), ['agave-blanco', 'agave-reposado', 'agave-anejo']);
  assert.deepEqual(current.filters, filters);
  const strict = planForIntent(catalog, 'under $48', current);
  assert.equal(strict.stateUpdate?.filters.at(-1)?.operator, 'lt');
  assert.deepEqual(filterEntities(catalog, strict.stateUpdate!.filters).map(entity => entity.id), ['agave-blanco']);
  const over = planForIntent(catalog, 'over $48');
  assert.equal(over.stateUpdate?.filters[0].operator, 'gt');
  assert.deepEqual(filterEntities(catalog, over.stateUpdate!.filters).map(entity => entity.id), ['agave-anejo']);
  assert.deepEqual(planForIntent(catalog, 'show all', current).stateUpdate, { filters: [] });
  assert.ok(planForIntent(catalog, 'show all under $48').stateUpdate?.filters.length);
  assert.equal(planForIntent(catalog, 'show the first one', current).stateUpdate, undefined);
  assert.throws(() => planForIntent(catalog, 'under $1', current), /No published items/);
});

test('provider schema and parser carry filter replacements while old/null plans preserve filters', () => {
  const catalog = fixture(); const plan = defaultPresentation(catalog);
  const parse = (value: unknown) => parseCatalogPresentation(JSON.stringify({ status: 'ready', plan: value }), catalog);
  assert.deepEqual(parse({ ...plan, stateUpdate: null }), { status: 'ready', catalogPlan: plan });
  const reset = { ...plan, stateUpdate: { filters: [] } };
  assert.deepEqual(parse(reset), { status: 'ready', catalogPlan: reset });
  assert.throws(() => parse({ ...plan, stateUpdate: { filters: [{ attributeId: 'price', operator: 'gt', value: '30' }] } }));
  assert.throws(() => parse({ ...plan, stateUpdate: { filters: [], fabricated: true } }));
  const serialized = JSON.stringify(catalogPresentationJsonSchema(catalog));
  assert.match(serialized, /"stateUpdate"/);
  assert.match(serialized, /"attributeId":\{"type":"string","enum":\["price"/);
});
