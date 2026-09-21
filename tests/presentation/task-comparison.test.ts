import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskComparison } from '@thevoice/platform-ui/task-components';
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
  assert.ok(html.includes('<article data-task-record="two"><h3>Second item</h3>'));
  assert.ok(html.includes('<dt>Price</dt><dd>Not specified</dd>'));
});
