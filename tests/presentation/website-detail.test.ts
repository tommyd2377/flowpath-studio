import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WebsiteEntry } from '@thevoice/platform-ui';
import WebsiteDetailContent from '../../components/WebsiteDetailContent';

const render = (entry: WebsiteEntry) => renderToStaticMarkup(createElement(WebsiteDetailContent, { entry }));

test('website details put literal qualified values before long source blocks without changing the entry', () => {
  const entry: WebsiteEntry = { id: 'reviewed-course', name: 'Workshop', body: 'A reviewed workshop.', values: [
    { label: 'Fee', text: '$49 on the course page; $75 in the policy. Confirm the applicable fee.' },
    { label: 'Availability', text: 'The captured page says “Only 1 spot left”; this is not verified live availability.' },
    { label: 'Schedule', text: 'October 4–November 22. No year is stated.' },
  ], blocks: [
    { id: 'intro', kind: 'heading', text: 'The complete course description' },
    { id: 'body', kind: 'paragraph', text: 'A long imported paragraph. '.repeat(180) },
    { id: 'tail', kind: 'paragraph', text: 'Final qualification: no refunds, except the specifically stated credit policy.' },
  ] };
  const original = structuredClone(entry), html = render(entry);
  assert.match(html, /<section aria-label="Details and conditions"><h3>Details and conditions<\/h3><dl>/);
  for (const value of entry.values!) {
    assert.ok(html.includes(value.text));
    assert.ok(html.indexOf(value.text) < html.indexOf('The complete course description'));
    assert.equal(html.split(value.text).length - 1, 1);
  }
  assert.ok(html.includes(entry.blocks![1].text), 'long source paragraphs are not shortened');
  assert.ok(html.includes(entry.blocks![2].text), 'tail qualifications remain available');
  assert.deepEqual(entry, original, 'presentation cannot modify reviewed canonical content');
});

test('details retain unknown, denied and conflicting values without presenting them as verified', () => {
  const entry: WebsiteEntry = { id: 'program', name: 'Program', body: 'Approved description.', values: [
    { label: 'Eligibility', text: 'Unknown' },
    { label: 'Duration', text: 'Conflicting values. Two weeks. Four weeks — depends on clinical need.' },
    { label: 'Admission', text: 'Not asserted: guaranteed admission — screening: required' },
    { label: 'Literal <label>', text: '<script>untrusted content</script>' },
  ] };
  const html = render(entry);
  assert.match(html, /Unknown/);
  assert.match(html, /Conflicting values\. Two weeks\. Four weeks — depends on clinical need\./);
  assert.match(html, /Not asserted: guaranteed admission — screening: required/);
  assert.match(html, /Literal &lt;label&gt;/);
  assert.match(html, /&lt;script&gt;untrusted content&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>|Verified facts|Full description/);
  assert.ok(html.indexOf('screening: required') < html.indexOf('Approved description.'));
});

test('prose-only and summary-only details retain their previous reading content without an empty facts group', () => {
  const prose: WebsiteEntry = { id: 'article', name: 'Article', blocks: [
    { id: 'heading', kind: 'heading', text: '# Literal publisher heading' },
    { id: 'body', kind: 'paragraph', text: 'First line.\n\nSecond line with an important condition.' },
  ] };
  const html = render(prose);
  assert.match(html, /<h3># Literal publisher heading<\/h3>/);
  assert.ok(html.includes(prose.blocks![1].text));
  assert.doesNotMatch(html, /Details and conditions|Full description|<dl>/);
  assert.equal(render({ id: 'summary', name: 'Summary', body: 'Complete summary.' }), '<div class="website-detail-content"><p>Complete summary.</p></div>');
});

test('long imported tokens and URLs remain intact for layout wrapping without editing source text', () => {
  const token = 'PaymentAdmissionsInpatientOutpatientServicesLeave';
  const url = `https://example.test/admissions/${'complete-source-reference-'.repeat(6)}`;
  const entry: WebsiteEntry = { id: 'long-source', name: 'Imported program', values: [
    { label: 'Source', text: url },
  ], blocks: [
    { id: 'joined-navigation', kind: 'paragraph', text: token },
    { id: 'source-url', kind: 'paragraph', text: `Read the complete conditions: ${url}` },
    { id: 'tail', kind: 'paragraph', text: 'Admission requires screening; availability is not guaranteed.' },
  ] };
  const original = structuredClone(entry), html = render(entry);
  assert.ok(html.includes(`<dd>${url}</dd>`));
  assert.ok(html.includes(`<p>${token}</p>`));
  assert.ok(html.includes(`<p>Read the complete conditions: ${url}</p>`));
  assert.ok(html.includes(entry.blocks![2].text));
  assert.doesNotMatch(html, /<wbr|\u00ad|\u200b/, 'wrapping must not inject characters into copied source text');
  assert.deepEqual(entry, original);
});
