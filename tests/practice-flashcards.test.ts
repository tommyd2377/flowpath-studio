import assert from 'node:assert/strict';
import test from 'node:test';
import { flashcardsPractice } from '../lib/practice-flashcards';
import type { PracticeInput } from '../lib/practice-contract';

const passage = { id: 'source_1', documentId: '92b99a41-8e0a-46dc-8f90-9d3777857741', filename: 'facts.txt', quote: 'A day has 24 hours.' };

function practice() {
  const deck = flashcardsPractice.create();
  const act = (action: string, fields: Partial<Omit<PracticeInput, 'action'>> = {}) =>
    deck.apply({ action, title: '', prompt: '', detail: '', score: 0, sourceId: '', ...fields }, { sources: [passage] });
  return { act, state: deck.state };
}

test('flashcards hide their answers and verified sources until explicit reveal', () => {
  const { act, state } = practice();
  const fields = { prompt: 'How many hours are in a day?', detail: '24', sourceId: 'source_1' };
  assert.equal(act('card', { ...fields, sourceId: 'invented' }).ok, false);
  assert.equal(act('card', fields).ok, true);
  assert.equal(state().prompt, fields.prompt);
  assert.equal(state().detail, '');
  assert.equal(state().source, undefined);
  assert.equal(act('next').ok, false);
  assert.equal(act('card', { prompt: 'Overwrite?', detail: 'No' }).ok, false);
  assert.equal(act('reveal').ok, true);
  assert.equal(act('reveal').ok, true);
  assert.equal(state().detail, '24');
  assert.deepEqual(state().source, passage);
  assert.equal(act('finish').ok, true);
  assert.match(state().prompt, /1 of 1 card/);
});

test('flashcards generate distinct cards and replay a completed deck without spoiling it', () => {
  const { act, state } = practice();
  assert.equal(act('start').ok, true);
  assert.equal(act('card', { prompt: 'One   plus one?', detail: 'Two' }).ok, true);
  assert.equal(act('start').ok, false);
  assert.equal(act('reveal').ok, true);
  assert.equal(act('next').ok, true);
  assert.equal(act('card', { prompt: ' one plus one? ', detail: '2' }).ok, false);
  assert.equal(act('card', { prompt: 'Two plus two?', detail: 'Four' }).ok, true);
  assert.equal(act('finish').ok, true);
  assert.match(state().prompt, /1 of 2 cards/);
  assert.equal(act('review').ok, true);
  assert.equal(state().prompt, 'One   plus one?');
  assert.equal(state().detail, '');
  assert.equal(act('reveal').ok, true);
  assert.equal(act('next').ok, true);
  assert.equal(state().prompt, 'Two plus two?');
  assert.equal(state().detail, '');
  assert.equal(act('reveal').ok, true);
  assert.equal(act('next').ok, true);
  assert.match(state().prompt, /2 of 2 cards/);
});

test('flashcards bound the deck and keep attempts in their own session', () => {
  const { act, state } = practice();
  assert.equal(act('card', { prompt: 'X'.repeat(281), detail: 'Short answer' }).ok, false);
  for (let index = 1; index <= 12; index++) {
    assert.equal(act('card', { prompt: `Prompt ${index}`, detail: 'Short answer' }).ok, true);
    assert.equal(act('reveal').ok, true);
    assert.equal(act('next').ok, true);
  }
  assert.equal(state().progress, 'Complete');
  assert.equal(act('card', { prompt: 'Thirteenth card', detail: 'No' }).ok, false);
  assert.equal(practice().act('review').ok, false);
});
