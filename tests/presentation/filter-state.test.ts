import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogExplorer } from '../../packages/platform-ui/src/Runtime.js';
import { validateCatalog, type PresentationPlan } from '../../packages/platform-ui/src/contracts.js';
import { defaultPresentation } from '../../packages/platform-ui/src/catalog.js';

const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));

test('mount plans apply voice constraints before rendering with editable manual filters', () => {
  const plan: PresentationPlan = { ...defaultPresentation(catalog), stateUpdate: { filters: [{ attributeId: 'price', operator: 'gt', value: 48 }] } };
  const html = renderToStaticMarkup(createElement(CatalogExplorer, { catalog, plan, showComposer: false }));
  assert.match(html, /Example Añejo/);
  assert.doesNotMatch(html, /Example Blanco|Example Reposado/);
  assert.match(html, /REFINED FOR YOU/);
  assert.match(html, /Refine the collection/);
});

test('invalid mount updates retain an unfiltered useful view and an error', () => {
  const plan = { ...defaultPresentation(catalog), stateUpdate: { filters: [{ attributeId: 'price', operator: 'gte', value: 'bad' }] } } as unknown as PresentationPlan;
  const html = renderToStaticMarkup(createElement(CatalogExplorer, { catalog, plan, showComposer: false }));
  assert.match(html, /Example Blanco/);
  assert.match(html, /could not be validated/);
});

test('published cards omit unknown attributes instead of rendering placeholder values', () => {
  const sparse = validateCatalog({
    schemaVersion: 1, id: 'sparse-catalog', name: 'Sparse catalog', description: '', capabilities: [], collections: [], relationships: [], jobs: [],
    attributes: [{ id: 'county', label: 'County', type: 'text' }, { id: 'website', label: 'Website', type: 'text' }],
    entities: [
      { id: 'one', kind: 'place', name: 'One', summary: 'First place.', attributes: { county: 'Orange', website: null } },
      { id: 'two', kind: 'place', name: 'Two', summary: 'Second place.', attributes: { county: null, website: 'example.org' } },
    ],
  });
  const html = renderToStaticMarkup(createElement(CatalogExplorer, { catalog: sparse, showComposer: false }));
  assert.doesNotMatch(html, /Not provided/);
  assert.match(html, /Orange/);
  assert.match(html, /example\.org/);
});
