import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compilePresentation } from '../../packages/platform-ui/src/compile.js';
import { preflightPresentation } from '../../packages/platform-ui/src/preflight.js';
import { platformLibrary } from '../../packages/platform-ui/src/components.js';
import { PresentationView } from '../../packages/platform-ui/src/Runtime.js';
import { validateCatalog, validatePlan, type PresentationPlan } from '../../packages/platform-ui/src/contracts.js';
import { defaultPresentation } from '../../packages/platform-ui/src/catalog.js';
import { detailPlan, comparisonPlan, initialInteraction } from '../../packages/platform-ui/src/interaction.js';

const fixture = (name: string) => validateCatalog(JSON.parse(readFileSync(new URL(`../../fixtures/catalogs/${name}.json`, import.meta.url), 'utf8')));

test('all eight registered semantic components retain independent schema identities', () => {
  assert.equal(Object.keys(platformLibrary.components).length, 9);
  for (const name of ['tequila', 'bookstore', 'classes']) {
    const catalog = fixture(name);
    const plan = defaultPresentation(catalog);
    const parsed = preflightPresentation(compilePresentation(catalog, plan));
    assert.equal(parsed.root?.props.sections && (parsed.root.props.sections as unknown[]).length, plan.components.length);
    assert.deepEqual(parsed.meta.errors, []);
    assert.deepEqual(parsed.meta.unresolved, []);
  }
});

test('the real OpenUI parser rejects unknown components, unresolved references and active expressions', () => {
  const catalog = fixture('tequila');
  const valid = compilePresentation(catalog, defaultPresentation(catalog));
  for (const program of [
    'root = CatalogCanvas([])',
    'root = CatalogCanvas([missing])',
    'root = CatalogCanvas([UnknownThing()])',
    `${valid}\nremote = Query("network", {})`,
    `${valid}\nwrite = Mutation("submit", {})`,
    `${valid}\n$active = "state"`,
    'root = CatalogCanvas([',
  ]) assert.throws(() => preflightPresentation(program));
});

test('inserted sections keep existing OpenUI statement identities', () => {
  const catalog = fixture('bookstore');
  const plan = defaultPresentation(catalog);
  const before = preflightPresentation(compilePresentation(catalog, plan));
  const composed: PresentationPlan = { ...plan, components: [
    { id: 'selection', type: 'selection', variant: 'compact', entityIds: [], attributeIds: [] },
    ...plan.components,
    { id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: ['book-harbor-hardcover', 'book-harbor-paperback'], attributeIds: ['price', 'format'] },
  ] };
  const after = preflightPresentation(compilePresentation(catalog, composed));
  const identities = (value: typeof before) => (value.root!.props.sections as { statementId: string; typeName: string }[]).map(section => `${section.typeName}:${section.statementId}`);
  assert.ok(identities(before).every(identity => identities(after).includes(identity)));
  assert.equal(identities(after).length, identities(before).length + 2);
});

test('hostile publisher strings remain escaped React data, never OpenUI instructions or HTML', () => {
  const catalog = fixture('tequila');
  const hostile = 'A title ");\nroot = Query("steal", {})\n<script>alert("bad")</script>';
  catalog.entities[0].name = hostile;
  catalog.entities[0].summary = hostile;
  const safe = validateCatalog(catalog);
  const plan = detailPlan(safe, safe.entities[0].id);
  const program = compilePresentation(safe, plan);
  assert.ok(!program.includes(hostile));
  const html = renderToStaticMarkup(createElement(PresentationView, { catalog: safe, plan, state: initialInteraction(safe) }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|<iframe/);
});

test('comparison resolves the same attributes and leaves missing values empty on desktop and mobile', () => {
  const catalog = fixture('tequila');
  const plan = comparisonPlan(catalog, ['agave-blanco', 'agave-small']);
  const html = renderToStaticMarkup(createElement(PresentationView, { catalog, plan, state: initialInteraction(catalog) }));
  assert.match(html, /scope="row">Price/);
  assert.match(html, /\$36\.00/);
  assert.doesNotMatch(html, /Not provided/);
  assert.match(html, /data-entity-id="agave-small"><\/td>/);
  assert.match(html, /platform-comparison-mobile/);
});

test('plans cannot invent a registered destination or escape the snapshot', () => {
  const catalog = fixture('classes');
  const plan = defaultPresentation(catalog);
  assert.throws(() => validatePlan({ ...plan, components: [{ id: 'actions', type: 'actions', variant: 'compact', entityIds: [], attributeIds: [], capabilityIds: ['book-now'] }] }, catalog, catalog.id));
  assert.throws(() => compilePresentation(catalog, { ...plan, snapshotId: 'other-revision' }));
});
