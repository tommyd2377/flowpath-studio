import assert from 'node:assert/strict';
import test from 'node:test';
import { lessonsPractice } from '../lib/practice-lessons';
import type { PracticeInput } from '../lib/practice-contract';

const source = {
  id: 'source_1', documentId: '8df31a01-9fa5-4e32-8630-0b51742abb44',
  filename: 'Franklin notes.txt', quote: 'Franklin was a printer before he became a diplomat.',
};
const context = { sources: [source] };
const input = (action: string, fields: Partial<PracticeInput> = {}): PracticeInput => ({
  action, title: '', prompt: '', detail: 'A concise explanation.', score: 0, sourceId: '', ...fields,
});

test('Guided Lessons begins on request, advances one step and finishes with a separate recap', () => {
  const lesson = lessonsPractice.create();
  assert.equal(lesson.apply(input('step'), context).ok, false);
  assert.equal(lesson.apply(input('start', { title: 'Franklin', sourceId: source.id }), context).ok, true);
  assert.deepEqual(lesson.state().source, source);
  assert.equal(lesson.state().progress, 'Step 1');
  assert.equal(lesson.apply(input('start', { title: 'Other topic' }), context).ok, false);
  assert.equal(lesson.apply(input('step', { prompt: 'What changed?', detail: 'He later served as a diplomat.' }), context).ok, true);
  assert.equal(lesson.state().progress, 'Step 2');
  assert.equal(lesson.state().source, undefined);
  assert.equal(lesson.apply(input('finish', { detail: 'We covered Franklin’s change of career.' }), context).ok, true);
  assert.deepEqual(lesson.state(), {
    title: 'Franklin', prompt: '', detail: 'We covered Franklin’s change of career.', progress: 'Complete · 2 steps',
  });
  assert.equal(lesson.apply(input('step'), context).ok, false);
  assert.equal(lesson.apply(input('start', { title: 'Printing' }), context).ok, true);
  assert.equal(lesson.state().progress, 'Step 1');
});

test('Guided Lessons enforces the step and text bounds and uses current Knowledge sources', () => {
  const lesson = lessonsPractice.create();
  assert.equal(lesson.apply(input('start', { title: 'Printing', detail: ' '.repeat(501) }), context).ok, false);
  assert.equal(lesson.apply(input('start', { title: 'Printing', sourceId: source.id }), { sources: [] }).ok, false);
  assert.equal(lesson.apply(input('start', { title: 'Printing', sourceId: 'source_9' }), context).ok, false);
  assert.equal(lesson.state().progress, 'Ready');
  assert.equal(lesson.apply(input('start', { title: 'Printing' }), context).ok, true);
  for (let step = 2; step <= 6; step++) assert.equal(lesson.apply(input('step'), context).ok, true);
  assert.equal(lesson.apply(input('step'), context).ok, false);
  assert.equal(lesson.state().progress, 'Step 6 · Last step');
  assert.equal(lesson.apply(input('finish', { detail: 'x'.repeat(501) }), context).ok, false);
  assert.equal(lesson.apply(input('finish'), context).ok, true);
  assert.equal(lessonsPractice.create().state().progress, 'Ready');
});
