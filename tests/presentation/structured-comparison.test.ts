import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichAnswer } from '@thevoice/platform-ui/answer';
import { TaskComparison } from '@thevoice/platform-ui/task-components';
import { fieldDescriptorSchema } from '@thevoice/platform-ui/query';
import { comparisonOptions, comparisonProse, comparisonQualifications, comparisonTable } from '../helpers/structured-comparison.fixture';

test('an answer receipt and readable prose are not evidence of the requested comparison table', () => {
  const html = renderToStaticMarkup(createElement(RichAnswer, { text: comparisonProse }));
  assert.match(html, /<ul>/);
  assert.doesNotMatch(html, /<table|platform-task-comparison-records|platform-comparison-mobile/);
  for (const option of comparisonOptions) assert.ok(html.includes(option));
});

test('a grounded three-option rich answer renders an accessible table and retains qualifications', () => {
  const html = renderToStaticMarkup(createElement(RichAnswer, { text: comparisonTable }));
  assert.match(html, /role="region" aria-label="Answer table" tabindex="0"/);
  assert.match(html, /<table>/); assert.equal((html.match(/<tr>/g) ?? []).length, 4);
  for (const option of comparisonOptions) assert.ok(html.includes(`<td>${option}</td>`));
  assert.ok(html.includes(comparisonQualifications));
  assert.doesNotMatch(html, /<button|<form|<iframe|<script/);
});

test('canonical three-record comparison renders the same options as a table and mobile cards', () => {
  const comparison = { fields: [fieldDescriptorSchema.parse({ id: 'description', label: 'Published description', aliases: [], recordTypes: ['service'], type: 'text', cardinality: 'one', operations: [], filter: false, sort: false, facet: false, coverage: { known: 3, total: 3 } })], rows: comparisonOptions.map((name, index) => ({
    id: `synthetic-${index}`, name, values: [{ fieldId: 'description', text: `${name} description.` }],
  })) };
  const html = renderToStaticMarkup(createElement(TaskComparison, { comparison }));
  assert.match(html, /aria-label="Selection comparison"/); assert.match(html, /<table/);
  assert.match(html, /platform-task-comparison-records/);
  for (const option of comparisonOptions) assert.ok(html.includes(option));
  assert.equal((html.match(/data-task-record="synthetic-/g) ?? []).length, 6);
});
