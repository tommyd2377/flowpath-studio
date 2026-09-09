import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateCatalog, validatePlan } from '../packages/platform-ui/src/contracts.js';
import { comparisonPlan, detailPlan, initialInteraction, planForIntent } from '../packages/platform-ui/src/interaction.js';

const fixture = (name: string) => validateCatalog(JSON.parse(readFileSync(new URL(`../fixtures/catalogs/${name}.json`, import.meta.url), 'utf8')));

test('one deterministic planner supports three structurally different catalogs', () => {
  for (const name of ['tequila', 'bookstore', 'classes']) {
    const catalog = fixture(name);
    const all = planForIntent(catalog, 'show all');
    assert.ok(all.components.some(component => component.type === 'collection'));
    for (const job of catalog.jobs) assert.doesNotThrow(() => validatePlan(planForIntent(catalog, job.label), catalog, catalog.id));
  }
});

test('numeric constraints exclude unknown values and preserve strict wording', () => {
  const catalog = fixture('tequila');
  const under = planForIntent(catalog, 'under $48');
  assert.deepEqual(under.components.find(component => component.type === 'collection')?.entityIds, ['agave-blanco']);
  const inclusive = planForIntent(catalog, 'up to $48');
  assert.deepEqual(inclusive.components.find(component => component.type === 'collection')?.entityIds, ['agave-blanco', 'agave-reposado']);
  assert.throws(() => planForIntent(catalog, 'under $1'), /No published items/);
});

test('comparison honors runtime-owned selection and ordinal follow-ups honor current order', () => {
  const catalog = fixture('bookstore');
  const state = { ...initialInteraction(catalog), selectedIds: ['book-harbor-hardcover', 'book-harbor-paperback'], entityIds: ['book-gardens', 'book-harbor-paperback'] };
  const comparison = planForIntent(catalog, 'compare these', state);
  assert.deepEqual(comparison.components[0].entityIds, state.selectedIds);
  const detail = planForIntent(catalog, 'show me the second one', state);
  assert.equal(detail.components.find(component => component.type === 'detail')?.entityIds[0], 'book-harbor-paperback');
});

test('detail exposes explicit relationship references without inventing an action', () => {
  const catalog = fixture('classes');
  const plan = detailPlan(catalog, 'class-handbuilding');
  assert.ok(plan.components.some(component => component.type === 'relationships'));
  assert.ok(!plan.components.some(component => component.type === 'actions'));
  assert.throws(() => detailPlan(catalog, 'not-in-this-catalog'));
  assert.throws(() => comparisonPlan(catalog, ['class-wheel']));
});

test('snapshot identity is carried from runtime state into accepted plans', () => {
  const catalog = fixture('classes');
  const state = initialInteraction(catalog, 'published-revision-2');
  const plan = planForIntent(catalog, 'beginner under $70', state);
  assert.equal(plan.snapshotId, 'published-revision-2');
  assert.throws(() => validatePlan(plan, catalog, 'published-revision-3'), /stale catalog/);
  assert.deepEqual(plan.components.find(component => component.type === 'collection')?.entityIds, ['class-handbuilding', 'class-drawing']);
});
