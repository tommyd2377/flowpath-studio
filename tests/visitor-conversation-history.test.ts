import assert from 'node:assert/strict';
import test from 'node:test';
import { VisitorConversationHistory } from '../lib/visitor-conversation-history';
import { MAX_VISITOR_HISTORY_MESSAGES, MAX_VISITOR_HISTORY_BYTES, MAX_VISITOR_MESSAGE_CHARACTERS, visitorHistoryBytes } from '../lib/visitor-conversation-bounds';
import { visitorHistorySchema, visitorRequestSchema } from '../lib/visitor-request';

test('completed answers survive revisions of the following user caption in conversational order', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  history.transcript(connection, { id: 'first', role: 'user', text: 'What are the delivery conditions?', revision: 1 });
  history.append([{ role: 'assistant', text: 'The published delivery minimum is $25; delivery is local only.' }]);
  history.transcript(connection, { id: 'second', role: 'user', text: 'What about', revision: 2 });
  history.transcript(connection, { id: 'second', role: 'user', text: 'What about the larger option?', revision: 2 });
  history.transcript(connection, { id: 'second', role: 'user', text: 'What about the larger option? Use the same delivery conditions.', revision: 3 });
  assert.deepEqual(history.snapshot(), [
    { role: 'user', text: 'What are the delivery conditions?' },
    { role: 'assistant', text: 'The published delivery minimum is $25; delivery is local only.' },
    { role: 'user', text: 'What about the larger option? Use the same delivery conditions.' },
  ]);
  assert.equal(history.transcript(connection, { id: 'second', role: 'user', text: 'An older correction', revision: 2 }), false);
  assert.equal(history.snapshot().at(-1)?.text, 'What about the larger option? Use the same delivery conditions.');
});

test('a correction to an earlier caption preserves intervening answers and later turns', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  history.transcript(connection, { id: 'first', role: 'user', text: 'Which room?', revision: 1 });
  history.append([{ role: 'assistant', text: 'The first-floor meeting room is available for inquiries.' }]);
  history.transcript(connection, { id: 'second', role: 'user', text: 'Tell me the capacity.', revision: 2 });
  history.transcript(connection, { id: 'first', role: 'user', text: 'Which meeting room?', revision: 1 });
  assert.deepEqual(history.snapshot().map(item => item.text), ['Which meeting room?', 'The first-floor meeting room is available for inquiries.', 'Tell me the capacity.']);
});

test('reconnection retains completed dialogue, accepts reused caption IDs and ignores the old connection', () => {
  const history = new VisitorConversationHistory(), first = history.beginVoice();
  history.transcript(first, { id: 'caption', role: 'user', text: 'What is the cancellation policy?', revision: 1 });
  history.append([{ role: 'assistant', text: 'Cancellation is allowed before the published deadline.' }]);
  const before = history.snapshot(), pending = history.checkpoint();
  history.endVoice();
  assert.deepEqual(history.snapshot(), before);
  assert.equal(history.append([{ role: 'assistant', text: 'An unfinished answer' }], pending), false);
  const second = history.beginVoice();
  assert.deepEqual(history.snapshot(), before);
  assert.equal(history.transcript(first, { id: 'caption', role: 'user', text: 'Late old connection text', revision: 2 }), false);
  history.transcript(second, { id: 'caption', role: 'user', text: 'Does the same deadline apply to a larger reservation?', revision: 1 });
  assert.deepEqual(history.snapshot(), [...before, { role: 'user', text: 'Does the same deadline apply to a larger reservation?' }]);
});

test('Back, Forward, Home and clearing the display invalidate unfinished writes without forgetting completed conversation', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  history.transcript(connection, { id: 'first', role: 'user', text: 'What is the group size limit?', revision: 1 });
  history.append([{ role: 'assistant', text: 'The published group limit is 12 people.' }]);
  const completed = history.snapshot();
  for (const navigation of ['Back', 'Forward', 'Home', 'Clear workspace']) {
    const pending = history.checkpoint();
    history.invalidatePending();
    assert.equal(history.append([{ role: 'assistant', text: `Late answer after ${navigation}` }], pending), false);
    assert.deepEqual(history.snapshot(), completed);
  }
  history.transcript(connection, { id: 'next', role: 'user', text: 'Compare it with the other group option.', revision: 2 });
  assert.equal(history.append([{ role: 'assistant', text: 'The other published option allows 8 people.' }], history.checkpoint()), true);
  assert.deepEqual(history.snapshot().slice(0, 2), completed);
});

test('aborted completions and raw assistant captions cannot enter completed answer history', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice(), controller = new AbortController();
  history.transcript(connection, { id: 'first', role: 'user', text: 'What is the price?', revision: 1 });
  controller.abort();
  assert.equal(history.append([{ role: 'assistant', text: 'A cancelled answer' }], history.checkpoint(), controller.signal), false);
  assert.equal(history.transcript(connection, { id: 'output', role: 'assistant', text: 'A possibly unheard fragment', revision: 1 }), false);
  assert.deepEqual(history.snapshot(), [{ role: 'user', text: 'What is the price?' }]);
});

test('accepted backend completion is retained without a display change and survives the next caption', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  history.transcript(connection, { id: 'first', role: 'user', text: 'What are the opening hours?', revision: 1 });
  assert.equal(history.answer(connection, { revision: 1, text: 'The published opening time is 9am.' }), true);
  assert.equal(history.answer(connection, { revision: 1, text: 'A duplicate event must not replace the answer.' }), false);
  history.transcript(connection, { id: 'second', role: 'user', text: 'What about', revision: 2 });
  history.transcript(connection, { id: 'second', role: 'user', text: 'What about the other location?', revision: 2 });
  assert.deepEqual(history.snapshot(), [
    { role: 'user', text: 'What are the opening hours?' },
    { role: 'assistant', text: 'The published opening time is 9am.' },
    { role: 'user', text: 'What about the other location?' },
  ]);
});

test('accepted answers are scoped to their connection and deduplicated even after history eviction', () => {
  const history = new VisitorConversationHistory(), first = history.beginVoice();
  for (let revision = 1; revision <= MAX_VISITOR_HISTORY_MESSAGES + 1; revision++) assert.equal(history.answer(first, { revision, text: `Completed answer ${revision}` }), true);
  assert.equal(history.snapshot().length, MAX_VISITOR_HISTORY_MESSAGES);
  assert.equal(history.answer(first, { revision: 1, text: 'An evicted answer cannot return.' }), false);
  history.endVoice();
  assert.equal(history.answer(first, { revision: 10, text: 'A late answer after ending voice.' }), false);
  const second = history.beginVoice();
  assert.equal(history.answer(first, { revision: 10, text: 'A late answer from the old connection.' }), false);
  assert.equal(history.answer(second, { revision: 1, text: 'A new connection may reuse the backend revision.' }), true);
  assert.equal(history.snapshot().at(-1)?.text, 'A new connection may reuse the backend revision.');
});

test('both caption and completed answer paths retain the newest complete messages within character and byte limits', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  for (let index = 0; index < 20; index++) {
    history.transcript(connection, { id: `user:${index}`, role: 'user', text: `Question ${index}: ${'x'.repeat(2500)}`, revision: index });
    history.answer(connection, { revision: index, text: `Answer ${index}: ${'y'.repeat(2500)}` });
  }
  const retained = history.snapshot();
  assert.ok(retained.length <= MAX_VISITOR_HISTORY_MESSAGES);
  assert.ok(retained.every(item => item.text.length === MAX_VISITOR_MESSAGE_CHARACTERS));
  assert.ok(visitorHistoryBytes(retained) <= MAX_VISITOR_HISTORY_BYTES);
  assert.ok(retained.at(-1)!.text.startsWith('Answer 19:'));
  assert.ok(visitorHistoryBytes([{ role: 'user', text: 'x'.repeat(2000) }, ...retained]) > MAX_VISITOR_HISTORY_BYTES, 'The latest fitting complete suffix fills the byte budget');
  assert.equal(history.transcript(connection, { id: 'user:0', role: 'user', text: 'An evicted caption cannot return.', revision: 20 }), false);
  const detached = history.snapshot(); detached[0].text = 'Changed externally'; detached.length = 0;
  assert.deepEqual(history.snapshot(), retained);
});

test('twelve exchanges retain an earlier hypothetical assumption through navigation, chat and resumed voice', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  const assumption = 'For this hypothetical workshop, assume 7 guests and a 12% materials allowance; these are not published terms.';
  for (let index = 0; index < 12; index++) {
    history.transcript(connection, { id: `turn:${index}`, role: 'user', text: index ? `Compare workshop option ${index}.` : assumption, revision: index });
    history.answer(connection, { revision: index, text: `Here is workshop comparison ${index}, using your hypothetical assumptions.` });
  }
  for (const navigation of ['Home', 'Back', 'Forward']) {
    const pending = history.checkpoint(); history.invalidatePending();
    assert.equal(history.append([{ role: 'assistant', text: `Stale answer after ${navigation}` }], pending), false);
  }
  history.endVoice();
  const request = visitorRequestSchema.parse({ kind: 'chat', requestId: '00000000-0000-4000-8000-000000000001', text: 'Use the same guest count and allowance for option 12.', history: history.snapshot() });
  assert.equal(request.history.length, 24);
  assert.equal(request.history[0].text, assumption);
  history.append([{ role: 'user', text: 'Change only the hypothetical guest count to 9.' }, { role: 'assistant', text: 'Using 9 guests and the same hypothetical 12% allowance.' }]);
  const resumed = history.beginVoice();
  assert.equal(history.transcript(connection, { id: 'late', role: 'user', text: 'A callback from the ended connection.', revision: 99 }), false);
  assert.equal(history.transcript(resumed, { id: 'turn:0', role: 'user', text: 'Now compare the next option with those assumptions.', revision: 0 }), true);
  const voiceHistory = visitorHistorySchema.parse(history.snapshot());
  assert.equal(voiceHistory[0].text, assumption);
  assert.equal(voiceHistory.at(-3)?.text, 'Change only the hypothetical guest count to 9.');
});

test('history schema accepts the shared message limit and rejects excess serialized UTF-8 or escaped content', () => {
  const maximum = Array.from({ length: MAX_VISITOR_HISTORY_MESSAGES }, (_, index) => ({ role: 'user' as const, text: `Message ${index}` }));
  assert.equal(visitorHistorySchema.parse(maximum).length, MAX_VISITOR_HISTORY_MESSAGES);
  assert.equal(visitorHistorySchema.safeParse([...maximum, maximum[0]]).success, false);
  assert.equal(visitorHistorySchema.safeParse([{ role: 'user', text: 'x'.repeat(MAX_VISITOR_MESSAGE_CHARACTERS + 1) }]).success, false);
  for (const text of ['界'.repeat(2000), '\u0001'.repeat(2000)]) {
    const oversized = Array.from({ length: 4 }, () => ({ role: 'user' as const, text }));
    assert.ok(visitorHistoryBytes(oversized) > MAX_VISITOR_HISTORY_BYTES);
    assert.equal(visitorHistorySchema.safeParse(oversized).success, false);
    const history = new VisitorConversationHistory(); history.append(oversized);
    assert.ok(history.snapshot().length < oversized.length);
    assert.deepEqual(visitorHistorySchema.parse(history.snapshot()), history.snapshot());
  }
});

test('a growing caption correction reapplies the byte bound without reviving evicted entries or splitting a character', () => {
  const history = new VisitorConversationHistory(), connection = history.beginVoice();
  history.transcript(connection, { id: 'old', role: 'user', text: 'The oldest caption.', revision: 1 });
  history.append(Array.from({ length: 11 }, (_, index) => ({ role: 'assistant', text: `Answer ${index}: ${'x'.repeat(1980)}` })));
  history.transcript(connection, { id: 'latest', role: 'user', text: 'A short current caption.', revision: 2 });
  const correction = `${'界'.repeat(1999)}🪵`;
  assert.equal(history.transcript(connection, { id: 'latest', role: 'user', text: correction, revision: 3 }), true);
  const retained = history.snapshot();
  assert.equal(retained.at(-1)!.text, '界'.repeat(1999));
  assert.ok(visitorHistoryBytes(retained) <= MAX_VISITOR_HISTORY_BYTES);
  assert.ok(retained.length < 13);
  assert.equal(history.transcript(connection, { id: 'old', role: 'user', text: 'An evicted earlier caption.', revision: 4 }), false);
  assert.equal(history.transcript(connection, { id: 'latest', role: 'user', text: 'An older short correction.', revision: 2 }), false);
  assert.deepEqual(history.snapshot(), retained);
});
