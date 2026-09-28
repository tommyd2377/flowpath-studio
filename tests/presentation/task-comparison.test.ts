import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskComparison } from '../../packages/platform-ui/src/TaskComponents.js';
import { websiteTaskFixture } from '../../fixtures/visitor-tasks';

test('responsive comparisons preserve qualified and one-sided values by field ID', () => {
  const space = websiteTaskFixture('products', 2), price = space.fields.find(field => field.id === 'price')!;
  const fields = [price, { ...price, id: 'terms', label: 'Conditions' }, { ...price, id: 'irrelevant', label: 'Unrelated field' }];
  const html = renderToStaticMarkup(createElement(TaskComparison, { comparison: { fields, rows: [
    { id: 'one', name: 'First item', values: [{ fieldId: 'terms', text: 'Starting estimate; extra work may cost more.' }, { fieldId: 'price', text: '50 USD' }] },
    { id: 'two', name: 'Second item', values: [{ fieldId: 'price', text: 'unknown' }, { fieldId: 'terms', text: 'By appointment only.' }] },
  ] } }));
  assert.equal(html.includes('Unrelated field'), false);
  assert.ok(html.includes('<th scope="col" data-task-record="one">First item</th>'));
  assert.ok(html.includes('<th scope="row">Price</th><td>50 USD</td><td>Not specified</td>'));
  assert.ok(html.includes('Starting estimate; extra work may cost more.'));
  assert.ok(html.includes('By appointment only.'));
  assert.match(html, /<table aria-label="Compare two items by attribute">/);
  assert.match(html, /<th colSpan="2" scope="rowgroup" id="([^"]+)-field-0">Price<\/th>/);
  const [, columnId] = /<th scope="col" id="([^"]+)" data-task-record="two">Second item<\/th>/.exec(html)!;
  const [, fieldId] = /scope="rowgroup" id="([^"]+)">Price<\/th>/.exec(html)!;
  assert.ok(html.includes(`<td headers="${columnId} ${fieldId}">Not specified</td>`), 'each value names both its item and field header');
  assert.equal(html.includes('<article'), false, 'a two-item mobile comparison keeps each attribute together');
});

test('larger mobile comparisons retain every item and qualified value as labeled records', () => {
  const space = websiteTaskFixture('services', 3);
  const field = { ...space.fields[0], id: 'terms', label: 'Conditions' };
  const rows = ['one', 'two', 'three'].map(id => ({ id, name: `Service ${id}`, values: [{ fieldId: 'terms', text: `Scope ${id}; materials charged separately.` }] }));
  const html = renderToStaticMarkup(createElement(TaskComparison, { comparison: { fields: [field], rows } }));
  for (const row of rows) {
    assert.ok(html.includes(`<article data-task-record="${row.id}"><h3>${row.name}</h3>`));
    assert.ok(html.includes(`<dt>Conditions</dt><dd>${row.values[0].text}</dd>`));
  }
  assert.equal(html.includes('Compare two items by attribute'), false);
});
