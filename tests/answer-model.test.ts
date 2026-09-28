import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCitedAnswer } from '@thevoice/platform-ui/answer-model';

test('citation offsets use supplied evidence, deduplicate sources and preserve surrounding Markdown', () => {
  const text = '**Materials included.** [one] Then choose a date. [two]';
  const first = { url: 'https://example.com/guide', title: 'Guide' }, second = { url: 'https://example.com/dates', title: 'Dates' };
  const result = prepareCitedAnswer(text, [first, first, second, { url: 'javascript:alert(1)', title: 'Unsafe' }], [
    { ...second, start: text.indexOf('[two]'), end: text.length },
    { ...first, start: text.indexOf('[one]'), end: text.indexOf('[one]') + 5 },
    { ...first, start: -1, end: 1 },
    { url: 'https://example.com/not-supplied', title: 'Unverified', start: 0, end: 3 },
  ]);
  assert.deepEqual(result.sources, [first, second]);
  assert.equal(result.markdown, '**Materials included.** [1](<https://example.com/guide>) Then choose a date. [2](<https://example.com/dates>)');
});

test('overlapping, malformed and out-of-range citations cannot replace unrelated answer text', () => {
  const source = { url: 'https://example.com/guide', title: 'Guide' };
  const result = prepareCitedAnswer('Answer [ref].', [source], [
    { ...source, start: 7, end: 12 }, { ...source, start: 8, end: 11 },
    { ...source, start: 0.5, end: 4 }, { ...source, start: 12, end: 200 },
  ]);
  assert.equal(result.markdown, 'Answer [1](<https://example.com/guide>).');
});
