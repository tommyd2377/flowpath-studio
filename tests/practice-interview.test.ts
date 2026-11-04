import assert from 'node:assert/strict';
import test from 'node:test';
import type { PracticeInput } from '../lib/practice-contract';
import { interviewPractice } from '../lib/practice-interview';

function setup() {
  const controller = interviewPractice.create();
  return {
    state: controller.state,
    apply: (action: string, fields: Partial<Omit<PracticeInput, 'action'>> = {}) => controller.apply({
      action, title: '', prompt: '', detail: '', score: 0, sourceId: '', ...fields,
    }, { sources: [] }),
  };
}

const firstQuestion = 'How would you investigate a checkout regression after a release?';
const firstFeedback = 'You narrowed down the likely release. Next time, name one signal you would check before rolling back.';

test('a role-specific practice run shows one question and its feedback at a time, then completes', () => {
  const interview = setup();
  assert.deepEqual(interview.apply('start', { title: 'Site Reliability Engineer', prompt: firstQuestion }), { ok: true });
  assert.deepEqual(interview.state(), {
    title: 'Site Reliability Engineer', prompt: firstQuestion, detail: '', progress: 'Question 1 of 3',
  });

  assert.deepEqual(interview.apply('feedback', { detail: firstFeedback }), { ok: true });
  assert.equal(interview.state().prompt, firstQuestion);
  assert.equal(interview.state().detail, firstFeedback);
  assert.equal(interview.state().progress, '1 of 3 answered');

  const secondQuestion = 'How would you reduce alert fatigue for an on-call team?';
  assert.deepEqual(interview.apply('question', { prompt: secondQuestion }), { ok: true });
  assert.deepEqual(interview.state(), {
    title: 'Site Reliability Engineer', prompt: secondQuestion, detail: '', progress: 'Question 2 of 3',
  });
  assert.deepEqual(interview.apply('feedback', {
    detail: 'You identified noisy alerts. Explain how you would check that the new thresholds still catch incidents.',
  }), { ok: true });

  assert.deepEqual(interview.apply('question', { prompt: 'How would you run a blameless incident review?' }), { ok: true });
  assert.equal(interview.state().progress, 'Question 3 of 3');
  assert.deepEqual(interview.apply('feedback', {
    detail: 'Your timeline is clear. Add an owner and a deadline for the highest-priority follow-up.',
  }), { ok: true, message: 'Interview practice complete.' });
  assert.equal(interview.state().progress, '3 of 3 answered');
  assert.equal(interview.apply('question', { prompt: 'How would you set an error budget?' }).ok, false);
  assert.equal(interview.apply('feedback', { detail: firstFeedback }).ok, false);
  assert.equal(interview.state().progress, '3 of 3 answered');
});

test('invalid or out-of-order actions leave the current interview step intact', () => {
  const interview = setup();
  const idle = interview.state();
  assert.equal(interview.apply('feedback', { detail: firstFeedback }).ok, false);
  assert.equal(interview.apply('start', { title: ' ', prompt: firstQuestion }).ok, false);
  assert.equal(interview.apply('start', { title: 'x'.repeat(81), prompt: firstQuestion }).ok, false);
  assert.equal(interview.apply('start', { title: 'Engineer', prompt: 'x'.repeat(241) }).ok, false);
  assert.deepEqual(interview.state(), idle);

  assert.equal(interview.apply('start', { title: ' Engineer ', prompt: ` ${firstQuestion} ` }).ok, true);
  const active = interview.state();
  assert.equal(active.title, 'Engineer');
  assert.equal(active.prompt, firstQuestion);
  assert.equal(interview.apply('start', { title: 'Engineer', prompt: firstQuestion }).ok, false);
  assert.equal(interview.apply('question', { prompt: 'How would you handle an outage?' }).ok, false);
  assert.equal(interview.apply('feedback', { detail: ' ' }).ok, false);
  assert.equal(interview.apply('feedback', { detail: 'x'.repeat(361) }).ok, false);
  assert.deepEqual(interview.state(), active);

  assert.equal(interview.apply('feedback', { detail: firstFeedback }).ok, true);
  const coached = interview.state();
  assert.equal(interview.apply('feedback', { detail: firstFeedback }).ok, false);
  assert.equal(interview.apply('question', { prompt: firstQuestion }).ok, false);
  assert.equal(interview.apply('hire', { detail: 'Recommend this candidate.' }).ok, false);
  assert.deepEqual(interview.state(), coached);
});

test('practice keeps only the current question and coaching, and a fresh drill starts empty', () => {
  const interview = setup();
  const unusedText = 'Synthetic answer text that should never enter the view.';
  interview.apply('start', { title: 'Engineer', prompt: firstQuestion, detail: unusedText });
  interview.apply('feedback', { title: unusedText, prompt: unusedText, detail: firstFeedback, score: 5, sourceId: 'source_1' });
  assert.deepEqual(interview.state(), {
    title: 'Engineer', prompt: firstQuestion, detail: firstFeedback, progress: '1 of 3 answered',
  });
  const snapshot = interview.state();
  snapshot.detail = unusedText;
  assert.equal(interview.state().detail, firstFeedback);

  assert.deepEqual(interview.apply('finish'), { ok: true });
  assert.deepEqual(interview.state(), {
    title: 'Engineer', prompt: 'Practice ended.', detail: '', progress: '1 of 3 answered',
  });
  assert.equal(interview.apply('question', { prompt: 'How would you handle an outage?' }).ok, false);
  assert.deepEqual(interview.apply('start', {
    title: 'Line Cook', prompt: 'How do you prioritize tickets when several orders arrive together?',
  }), { ok: true });
  assert.equal(interview.state().progress, 'Question 1 of 3');
  assert.equal(interview.state().detail, '');
  assert.equal(setup().state().progress, 'Ready');
});
