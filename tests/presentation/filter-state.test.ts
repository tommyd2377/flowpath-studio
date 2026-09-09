import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CatalogExplorer } from '../../packages/platform-ui/src/Runtime.js';
import { validateCatalog, type PresentationPlan } from '../../packages/platform-ui/src/contracts.js';
import { defaultPresentation } from '../../packages/platform-ui/src/catalog.js';

const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));

test('mount plans apply filters before rendering and explain the actual operator', () => {
  const plan: PresentationPlan = { ...defaultPresentation(catalog), stateUpdate: { filters: [{ attributeId: 'price', operator: 'gt', value: 48 }] } };
  const html = renderToStaticMarkup(createElement(CatalogExplorer, { catalog, plan, showComposer: false }));
  assert.match(html, /Example Añejo/);
  assert.doesNotMatch(html, /Example Blanco|Example Reposado/);
  assert.match(html, /Over.*\$48\.00/);
  assert.match(html, />Over<\/span><input/);
  assert.match(html, /value="48"/);
});

test('invalid mount updates retain an unfiltered useful view and an error', () => {
  const plan = { ...defaultPresentation(catalog), stateUpdate: { filters: [{ attributeId: 'price', operator: 'gte', value: 'bad' }] } } as unknown as PresentationPlan;
  const html = renderToStaticMarkup(createElement(CatalogExplorer, { catalog, plan, showComposer: false }));
  assert.match(html, /Example Blanco/);
  assert.match(html, /could not be validated/);
});
