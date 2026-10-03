import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compilePresentation } from '../../packages/platform-ui/src/compile.js';
import { preflightPresentation } from '../../packages/platform-ui/src/preflight.js';
import { FocusStage, FocusSurface, VoiceFocusBridge, platformLibrary } from '../../packages/platform-ui/src/components.js';
import { PresentationView } from '../../packages/platform-ui/src/Runtime.js';
import { validateCatalog, validatePlan, type PresentationPlan } from '../../packages/platform-ui/src/contracts.js';
import { defaultPresentation } from '../../packages/platform-ui/src/catalog.js';
import { detailPlan, comparisonPlan, initialInteraction } from '../../packages/platform-ui/src/interaction.js';
import { comparisonMissingnessCatalog } from '../helpers/v1-comparison-missingness.fixture';

const fixture = (name: string) => validateCatalog(JSON.parse(readFileSync(new URL(`../../fixtures/catalogs/${name}.json`, import.meta.url), 'utf8')));

test('all seven registered semantic components retain independent schema identities', () => {
  assert.equal(Object.keys(platformLibrary.components).length, 8);
  assert.ok(!('CriteriaControls' in platformLibrary.components));
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

test('comparison resolves the same attributes and labels missing values on desktop and mobile', () => {
  const catalog = fixture('tequila');
  const plan = comparisonPlan(catalog, ['agave-blanco', 'agave-small']);
  const html = renderToStaticMarkup(createElement(PresentationView, { catalog, plan, state: initialInteraction(catalog) }));
  assert.match(html, /scope="row">Price/);
  assert.match(html, /\$36\.00/);
  assert.doesNotMatch(html, /Not provided/);
  assert.match(html, /data-entity-id="agave-small">Not specified<\/td>/);
  assert.match(html, /platform-comparison-mobile/);
});

test('comparison missingness preserves source values and labels without inventing facts', () => {
  const catalog = comparisonMissingnessCatalog, before = structuredClone(catalog);
  const plan = comparisonPlan(catalog, catalog.entities.map(entity => entity.id));
  const html = renderToStaticMarkup(createElement(PresentationView, { catalog, plan, state: initialInteraction(catalog) }));
  const table = html.slice(html.indexOf('<table>'), html.indexOf('</table>'));
  assert.match(table, /<th scope="col"[^>]*data-entity-id="missing"/);
  for (const label of ['Material', 'Listed price', 'Machine washable', 'Additional fringe', 'Source qualifications']) {
    assert.ok(table.includes(`<th scope="row">${label}</th>`));
  }
  for (const value of ['100% wool', '$0.00', 'No', '0 cm', String(catalog.entities[0].attributes.terms)]) {
    assert.ok(table.includes(`data-entity-id="stated">${value}</td>`), value);
  }
  for (const id of ['missing', 'omitted']) {
    assert.equal((table.match(new RegExp(`data-entity-id="${id}">Not specified</td>`, 'g')) ?? []).length, 5);
    const article = html.match(new RegExp(`<article data-entity-id="${id}">([\\s\\S]*?)</article>`))![1];
    for (const label of ['Material', 'Listed price', 'Machine washable', 'Additional fringe', 'Source qualifications']) {
      assert.ok(article.includes(`<dt>${label}</dt><dd>Not specified</dd>`), `${id}: ${label}`);
    }
    assert.doesNotMatch(article, /100% wool|\$0\.00|<dd>No<\/dd>|0 cm/);
  }
  assert.doesNotMatch(html, /Live inventory|Unspecified for every item|Not provided/);
  assert.deepEqual(catalog, before, 'Rendering must not fill or change published attributes.');
});

test('plans cannot invent a registered destination or escape the snapshot', () => {
  const catalog = fixture('classes');
  const plan = defaultPresentation(catalog);
  assert.throws(() => validatePlan({ ...plan, components: [{ id: 'actions', type: 'actions', variant: 'compact', entityIds: [], attributeIds: [], capabilityIds: ['book-now'] }] }, catalog, catalog.id));
  assert.throws(() => compilePresentation(catalog, { ...plan, snapshotId: 'other-revision' }));
});

test('focused entity rendering exposes the shared non-modal return and disclosure contract', () => {
  const catalog = fixture('classes');
  const plan = detailPlan(catalog, catalog.entities[0].id);
  const state = { ...initialInteraction(catalog), focusedRef: { kind: 'entity' as const, id: catalog.entities[0].id }, focusOrigin: { reference: { kind: 'entity' as const, id: catalog.entities[0].id }, surface: 'collection' as const, focusKey: `entity:${catalog.entities[0].id}`, scrollTop: 18 } };
  const detail = createElement(PresentationView, { catalog, plan, state });
  const Surface = FocusSurface as unknown as (props: { reference?: typeof state.focusedRef; onClose?: () => void; title?: string }) => ReactNode;
  const Stage = FocusStage as unknown as (props: { focused?: boolean; onClose?: () => void; context?: ReactNode }) => ReactNode;
  const surface = createElement(Surface, { reference: state.focusedRef, onClose: () => {}, title: `Details of ${catalog.entities[0].name}` }, detail);
  const html = renderToStaticMarkup(createElement(Stage, { focused: true, onClose: () => {}, context: createElement('div', null, 'collection') }, surface));
  assert.match(html, /data-focus-stage="true"/);
  assert.match(html, /data-focus-surface="true"/);
  assert.match(html, /data-return-anchor="true"/);
  assert.match(html, /data-disclosure-stack="true"/);
  assert.match(html, /data-focus-scrim="true"/);
});

test('focus stage keeps the origin context mounted before a focused surface opens', () => {
  const Stage = FocusStage as unknown as (props: { focused?: boolean; onClose?: () => void; context?: ReactNode; children?: ReactNode }) => ReactNode;
  const html = renderToStaticMarkup(createElement(Stage, { focused: false, context: createElement('div', null, 'collection') }, null));
  assert.match(html, /data-focus-context="true"/);
  assert.match(html, /data-focus-layer="true"/);
  assert.doesNotMatch(html, /data-focus-scrim="true"/);
  assert.doesNotMatch(html, /data-focus-surface="true"/);
});

test('voice focus bridge exposes the runtime-owned focused reference', () => {
  const html = renderToStaticMarkup(createElement(VoiceFocusBridge, { reference: { kind: 'entity', id: 'class-handbuilding' }, status: 'Focused on a published item.' }));
  assert.match(html, /data-voice-focus-open="true"/);
  assert.match(html, /data-voice-focus-kind="entity"/);
  assert.match(html, /data-voice-focus-id="class-handbuilding"/);
});
