import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeInput } from '../lib/practice-contract';
import { quizPractice } from '../lib/practice-quiz';

const passage = {
  id: 'source_1',
  documentId: '7f680b0e-89aa-415b-9e24-d83bd598ef89',
  filename: 'Franklin notes.txt',
  quote: 'Benjamin Franklin was born in Boston in 1706.',
};
const context = { sources: [passage] };
const input = (action: string, fields: Partial<PracticeInput> = {}): PracticeInput => ({
  action, title: '', prompt: '', detail: '', score: 0, sourceId: '', ...fields,
});
const ask = input('question', { prompt: 'Where was Franklin born?', sourceId: passage.id });
const grade = input('grade', { score: 2, detail: 'Boston is correct.' });

test('quiz requires a verified source and hides the answer passage until feedback', () => {
  const quiz = quizPractice.create();
  assert.equal(quiz.apply(ask, { sources: [] }).ok, false);
  assert.equal(quiz.apply(ask, context).ok, true);
  assert.equal(quiz.state().prompt, ask.prompt);
  assert.equal(quiz.state().source, undefined);
  assert.equal(quiz.state().detail, '');
  assert.equal(quiz.apply(grade, context).ok, true);
  assert.deepEqual(quiz.state().source, passage);
  assert.match(quiz.state().detail, /Boston is correct/);
});

test('a superseding result with a recycled source ID cannot supply evidence for an open question', () => {
  const quiz = quizPractice.create();
  quiz.apply(ask, context);
  assert.equal(quiz.apply(grade, { sources: [{ ...passage, quote: 'An unrelated passage.' }] }).ok, false);
  assert.equal(quiz.state().source, undefined);
  assert.equal(quiz.apply(grade, context).ok, true);
});

test('the quiz scores each question once and keeps a bounded, independent running tally', () => {
  const quiz = quizPractice.create();
  assert.equal(quiz.apply(grade, context).ok, false);
  for (const score of [2, 1, 0, 2, 1]) {
    assert.equal(quiz.apply(ask, context).ok, true);
    assert.equal(quiz.apply(input('next'), context).ok, false);
    assert.equal(quiz.apply(input('grade', { detail: 'Practice feedback.', score: 99 }), context).ok, false);
    assert.equal(quiz.apply(input('grade', { detail: 'Practice feedback.', score }), context).ok, true);
    assert.equal(quiz.apply(grade, context).ok, false);
    if (!quiz.state().progress.includes('Quiz complete')) assert.equal(quiz.apply(input('next'), context).ok, true);
  }
  assert.equal(quiz.state().progress, 'Quiz complete · 5 answered · 6/10 points');
  assert.equal(quiz.apply(ask, context).ok, false);
  assert.equal(quizPractice.create().state().progress, 'Up to 5 questions');
});

test('finishing early counts answered questions only and restart clears prior scores and sources', () => {
  const quiz = quizPractice.create();
  quiz.apply(ask, context);
  quiz.apply(grade, context);
  quiz.apply(input('next'), context);
  quiz.apply(ask, context);
  assert.equal(quiz.apply(input('finish'), context).ok, true);
  assert.equal(quiz.state().progress, '1 answered · 2/2 points');
  assert.equal(quiz.state().source, undefined);
  assert.equal(quiz.apply(input('restart'), context).ok, true);
  assert.equal(quiz.state().progress, 'Up to 5 questions');
  assert.equal(quiz.state().source, undefined);
});
