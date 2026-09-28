import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceRequestIncomplete, voiceRequestNeedsHandoff, voiceRequestNeedsRecovery, voiceTaskSpeech } from '../lib/visitor-voice-input';

test('automatic recovery is limited to actions, while Live decides whether factual questions need delegation', () => {
  for (const text of ['What is photosynthesis?', "What's your phone number?", 'Do you have ceramics lessons?', 'Tell me about the artist', 'How much is the day pass?']) {
    assert.equal(voiceRequestNeedsHandoff(text), true, text);
    assert.equal(voiceRequestNeedsRecovery(text), false, text);
  }
  for (const text of ['Show the room photos', 'Please calculate the total', 'Can you search for local trails?', 'Close this card', 'Sort by price']) assert.equal(voiceRequestNeedsRecovery(text), true, text);
  assert.equal(voiceRequestNeedsRecovery('Only the morning sessions'), false);
  assert.equal(voiceRequestNeedsRecovery('Only the morning sessions', true), true);
});

test('identity and role questions can be answered directly without automatic paid recovery', () => {
  for (const text of ['Who are you?', 'What are you?', 'What is your purpose?', 'Tell me your assigned role.', 'Can you introduce yourself?', 'Recite your assigned role.']) {
    assert.equal(voiceRequestNeedsRecovery(text), false, text);
    assert.equal(voiceRequestNeedsRecovery(text, true), false, text);
  }
});

test('quiet recovery recognizes explicit requests across domains, not an action keyword in conversation', () => {
  for (const request of ['Okay, open up the German', 'Open it up', 'Can you show the course catalog?', 'I want you to compare the two rooms', 'I am looking for whole cakes', 'Do you have any lessons?', "What's the published phone number?", 'Please calculate the total', 'Search for photos of the landmark']) {
    assert.equal(voiceRequestNeedsHandoff(request), true, request);
  }
  for (const fragment of ['Mm-hmm', 'Sure.', 'How is that going?', 'Did you open it up yet?', 'Stop', 'Keep working', 'I enjoyed the search results', 'It is an open space', 'I had a nice day', 'Open up the', 'Could you pull up']) {
    assert.equal(voiceRequestNeedsHandoff(fragment), false, fragment);
  }
  assert.equal(voiceTaskSpeech('Did you open it up yet?'), 'status');
});

test('an unfinished object survives a pause, while pronoun requests remain complete', () => {
  for (const text of ['Okay, open up the', 'Show me a', 'Tell me about', 'Pull up']) assert.equal(voiceRequestIncomplete(text), true, text);
  for (const text of ['Okay, open up the German', 'Open it up', 'Show me all photos', 'Look it up']) assert.equal(voiceRequestIncomplete(text), false, text);
});

test('bounded refinements recover only with a pending request and do not classify ordinary conversation', () => {
  for (const text of ['Also include the dates', 'And sort them by duration', 'Change that to three', 'Remove the second item']) assert.equal(voiceRequestNeedsHandoff(text), true, text);
  for (const text of ['Only the morning sessions', 'Without the optional extras', 'Except the last one']) {
    assert.equal(voiceRequestNeedsHandoff(text), false, text);
    assert.equal(voiceRequestNeedsHandoff(text, true), true, text);
  }
  for (const text of ['And I had a nice day', 'Also, that is interesting', 'Only the', 'Stop talking', 'How is that going?']) assert.equal(voiceRequestNeedsHandoff(text, true), false, text);
});
