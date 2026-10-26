import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveTextSession, type LiveTextState } from '../lib/live-text-session';

function setup() {
  let state: LiveTextState = { text: '', writing: false, visible: false, canUndo: false, message: '' };
  const sent: Record<string, unknown>[] = [];
  const session = createLiveTextSession({ onChange: next => { state = next; }, send: event => { sent.push(event); } });
  let time = 0, serial = 0;
  function transcript(delta: string) {
    const event = { type: 'session.input_transcript.delta', event_id: `input_${serial++}`, delta, start_ms: time, end_ms: time + 100 };
    time += 100;
    session.event(event);
    return event;
  }
  const backend = (event: Record<string, unknown>, delegation = 'delegation_1') => session.event({ type: 'response.event', delegation_id: delegation, event });
  const created = (id = 'response_1', delegation = 'delegation_1') => backend({ type: 'response.created', response: { id } }, delegation);
  const call = (action: string, text = '', callId = 'call_1', responseId = 'response_1', delegation = 'delegation_1') =>
    backend({ type: 'response.output_item.done', response_id: responseId,
      item: { type: 'function_call', name: 'update_text_box', call_id: callId, arguments: JSON.stringify({ action, text }) } }, delegation);
  const complete = (id = 'response_1', delegation = 'delegation_1') => backend({ type: 'response.completed', response: { id, status: 'completed' } }, delegation);
  const result = () => JSON.parse((sent.findLast(event => event.type === 'response.item.create')?.item as { output: string }).output);
  return { session, sent, transcript, backend, created, call, complete, result, state: () => state };
}

test('dictation starts empty and exact fragmented controls never enter the panel', () => {
  const h = setup();
  h.transcript('Ordinary conversation. ');
  assert.equal(h.state().text, '');
  assert.equal(h.state().visible, false);
  h.transcript('Start writ');
  assert.equal(h.state().writing, false);
  h.transcript('ing. Apples');
  assert.equal(h.state().writing, true);
  assert.equal(h.state().visible, true);
  assert.equal(h.state().text, 'Apples');
  h.transcript(', pears and ');
  h.transcript('oranges. Sto');
  assert.equal(h.state().text, 'Apples, pears and oranges. ');
  h.transcript('p dictation. Please tell me a story.');
  assert.equal(h.state().writing, false);
  assert.equal(h.state().visible, true);
  assert.equal(h.state().text, 'Apples, pears and oranges. ');
  h.session.event({ type: 'session.output_transcript.delta', delta: 'A story', start_ms: 0, end_ms: 20 });
  assert.equal(h.state().text, 'Apples, pears and oranges. ');
  h.transcript('Start dictation. More.');
  assert.equal(h.state().text, 'Apples, pears and oranges. More.');
});

test('ordinary words ending in control-prefix letters are streamed normally', () => {
  const h = setup();
  h.transcript('start writing');
  for (const word of ['First', ' frost', ' tests', '.']) h.transcript(word);
  assert.equal(h.state().text, 'First frost tests.');
});

test('ordinary speech, internal reads and cleanup do not reveal an unused panel', () => {
  const h = setup(); h.transcript('Hello, tell me a story.');
  h.created(); h.call('read'); h.call('clear', '', 'clear_1'); h.call('undo', '', 'undo_1');
  assert.equal(h.state().visible, false);
  h.session.finish();
  assert.equal(h.state().visible, false);
});

test('fragmented show and hide controls preserve text without capturing ordinary speech', () => {
  const h = setup();
  h.transcript('Start writing. Keep this. ');
  h.transcript('Hide the text '); h.transcript('box. Ignore this.');
  assert.equal(h.state().visible, false); assert.equal(h.state().writing, false);
  assert.equal(h.state().text, 'Keep this. ');
  h.transcript('Show text'); h.transcript(' box. Do not dictate this.');
  assert.equal(h.state().visible, true); assert.equal(h.state().writing, false);
  assert.equal(h.state().text, 'Keep this. ');
  h.transcript('Close text box');
  assert.equal(h.state().visible, false);
  assert.equal(h.sent.length, 0, 'presentation controls never request a new provider response or close voice');
});

test('local Hide flushes buffered text and prevents late operations from reopening it', () => {
  const h = setup(); h.transcript('Start writing. A fresh start'); h.created();
  h.session.action('hide'); h.call('replace', 'Late answer');
  assert.equal(h.state().text, 'A fresh start');
  assert.equal(h.state().visible, false); assert.equal(h.state().writing, false);
  assert.equal(h.result().status, 'superseded');
  h.session.finish(); h.session.action('show');
  assert.equal(h.state().visible, true); assert.equal(h.state().writing, false);
});

test('delegated display opens only on explicit display operations, while Hide retains data', () => {
  const h = setup(); h.created(); h.call('show');
  assert.equal(h.state().visible, true); assert.equal(h.state().writing, false);
  h.call('replace', 'Written answer.', 'replace_1');
  h.call('hide', '', 'hide_1');
  assert.equal(h.state().text, 'Written answer.'); assert.equal(h.state().visible, false);
  assert.equal(h.result().visible, false);
  h.created('response_2', 'delegation_2');
  h.call('read', '', 'read_1', 'response_2', 'delegation_2');
  assert.equal(h.state().visible, false);
  h.call('append', ' More.', 'append_1', 'response_2', 'delegation_2');
  assert.equal(h.state().visible, true); assert.equal(h.state().text, 'Written answer. More.');
});

test('a delegated Hide also supersedes older pending writes', () => {
  const h = setup(); h.created('response_old', 'delegation_old'); h.created();
  h.call('hide');
  h.call('replace', 'Do not reopen.', 'old_write', 'response_old', 'delegation_old');
  assert.equal(h.result().status, 'superseded');
  assert.equal(h.state().visible, false); assert.equal(h.state().text, '');
});

test('command recognition respects a word boundary split across transcript fragments', () => {
  const h = setup(); h.transcript('start writing');
  h.transcript('egg'); h.transcript('s');
  assert.equal(h.state().text, 'eggs');
  h.transcript(' re'); h.transcript('start writing');
  assert.equal(h.state().text, 'eggs restart writing');
  h.transcript(' '); h.transcript('stop writing');
  assert.equal(h.state().writing, false);
  assert.equal(h.state().text, 'eggs restart writing ');
});

test('local Stop and finish preserve a final ordinary word that resembles a command prefix', () => {
  for (const finish of [false, true]) {
    const h = setup(); h.transcript('start writing'); h.transcript('A fresh start');
    if (finish) h.session.finish(); else h.session.action('stop');
    assert.equal(h.state().text, 'A fresh start');
    assert.equal(h.state().writing, false);
  }
});

test('read does not discard a buffered fragmented stop command', () => {
  const h = setup(); h.transcript('start writing. Eggs '); h.transcript('stop writ');
  h.created(); h.call('read');
  h.transcript('ing');
  assert.equal(h.state().writing, false);
  assert.equal(h.state().text, 'Eggs ');
});

test('a delayed edit cannot replace dictation received since its panel read', () => {
  const h = setup();
  h.transcript('Start writing. First sentence.');
  h.created(); h.call('read'); h.complete();
  h.transcript(' Second sentence.');
  h.created('response_edit');
  h.call('replace', 'Shorter first sentence.', 'call_edit', 'response_edit');
  assert.equal(h.result().status, 'superseded');
  assert.equal(h.state().text, 'First sentence. Second sentence.');
});

test('duplicate, overlapping and out-of-order input is not appended twice', () => {
  const h = setup();
  h.transcript('start writing');
  const original = h.transcript('Hello');
  h.session.event(original);
  h.session.event({ ...original, event_id: 'old', delta: 'duplicated' });
  h.session.event({ ...original, event_id: 'overlap', start_ms: 150, end_ms: 250, delta: 'overlap' });
  assert.equal(h.state().text, 'Hello');
  h.transcript(' world');
  assert.equal(h.state().text, 'Hello world');
});

test('dictation is one undoable operation and local stop keeps the voice-independent panel paused', () => {
  const h = setup();
  h.transcript('start writing');
  h.transcript('One'); h.transcript(' two'); h.transcript(' three');
  h.session.action('stop');
  h.transcript('Not written');
  assert.equal(h.state().text, 'One two three');
  assert.equal(h.state().writing, false);
  h.session.action('undo');
  assert.equal(h.state().text, '');
  assert.equal(h.state().canUndo, false);
});

test('completed calls apply plain text and all outputs precede one response continuation', () => {
  const h = setup();
  h.created();
  h.call('replace', '<script>plain text</script>', 'call_1');
  h.call('append', '\nSecond line', 'call_2');
  assert.equal(h.state().text, '<script>plain text</script>\nSecond line');
  assert.deepEqual(h.sent.map(event => event.type), ['response.item.create', 'response.item.create']);
  h.complete(); h.complete();
  assert.deepEqual(h.sent.map(event => event.type), ['response.item.create', 'response.item.create', 'response.create']);
  assert.equal(h.result().status, 'applied');
});

test('partial arguments and duplicate calls cannot mutate or continue twice', () => {
  const h = setup();
  h.created();
  h.backend({ type: 'response.function_call_arguments.done', call_id: 'call_1', name: 'update_text_box', arguments: '{"action":"clear","text":""}' });
  assert.equal(h.sent.length, 0);
  h.call('append', 'Once'); h.call('append', 'Once');
  h.complete();
  h.call('append', 'Again', 'late_call');
  assert.equal(h.state().text, 'Once');
  assert.equal(h.sent.length, 2);
});

test('unknown response/delegation cannot execute tools', () => {
  const h = setup();
  h.call('replace', 'No response');
  h.created();
  h.call('replace', 'Wrong delegation', 'call_1', 'response_1', 'other_delegation');
  assert.equal(h.state().text, '');
  assert.equal(h.sent.length, 0);
});

test('local Stop, Clear and Undo supersede already-running responses', () => {
  for (const localAction of ['stop', 'clear', 'undo'] as const) {
    const h = setup();
    h.transcript('start writing. Existing');
    h.created();
    h.session.action(localAction);
    const expected = h.state().text;
    h.call('replace', 'Late result');
    h.complete();
    assert.equal(h.state().text, expected);
    assert.equal(h.result().status, 'superseded');
    assert.equal(h.state().writing, false);
  }
});

test('spoken stop supersedes pending start and generated writes', () => {
  const h = setup();
  h.transcript('start writing. Original. ');
  h.created();
  h.transcript('stop writing');
  h.call('start_dictation');
  assert.equal(h.state().writing, false);
  assert.equal(h.result().status, 'superseded');
  h.call('replace', 'Stale replacement', 'call_2');
  assert.equal(h.state().text, 'Original. ');
});

test('a known delegation keeps its old generation when its response arrives after Stop', () => {
  const h = setup(); h.transcript('start writing. Existing');
  h.session.event({ type: 'session.delegation.created', offset_ms: 101, delegation: { id: 'delegation_1', target: 'responses' } });
  h.session.action('stop'); h.created(); h.call('start_dictation');
  assert.equal(h.result().status, 'superseded');
  assert.equal(h.state().writing, false);
});

test('late delegation metadata at or before the transcript barrier rejects stale updates', () => {
  const h = setup(); h.transcript('start writing. Existing');
  h.session.action('stop'); h.created();
  h.session.event({ type: 'session.delegation.created', offset_ms: 50, delegation: { id: 'delegation_1', target: 'responses' } });
  h.call('replace', 'Stale');
  assert.equal(h.result().status, 'superseded');
  assert.equal(h.state().text, 'Existing');
  h.transcript('Put a new answer in the box.');
  h.session.event({ type: 'session.delegation.created', offset_ms: 200, delegation: { id: 'delegation_2', target: 'responses' } });
  h.created('response_2', 'delegation_2');
  h.call('replace', 'New answer', 'call_2', 'response_2', 'delegation_2');
  assert.equal(h.result().status, 'applied');
  assert.equal(h.state().text, 'New answer');
});

test('read returns the current panel and delegated editing uses the same undo stack', () => {
  const h = setup();
  h.transcript('start writing. Original.');
  h.created(); h.call('read');
  assert.equal(h.result().text, 'Original.');
  assert.equal(h.state().writing, true);
  h.call('replace', 'Edited.', 'call_2');
  assert.equal(h.state().writing, false);
  h.call('undo', '', 'call_3');
  assert.equal(h.state().text, 'Original.');
  h.call('clear', '', 'call_4');
  assert.equal(h.state().text, '');
});

test('invalid tools and arguments get rejected without executing anything else', () => {
  const h = setup(); h.created();
  const invalid = [
    { name: 'send_money', arguments: '{"action":"clear","text":""}' },
    { name: 'update_text_box', arguments: '{bad' },
    { name: 'update_text_box', arguments: '{"action":"clear","text":"","other":true}' },
    { name: 'update_text_box', arguments: '{"action":"clear","text":"unexpected"}' },
    { name: 'update_text_box', arguments: '{"action":"execute","text":"rm"}' },
    { name: 'update_text_box', arguments: JSON.stringify({ action: 'replace', text: 'x'.repeat(4_001) }) },
    { name: 'update_text_box', arguments: JSON.stringify({ action: 'replace', text: '\u0000' }) },
  ];
  invalid.forEach((item, index) => h.backend({ type: 'response.output_item.done', response_id: 'response_1',
    item: { ...item, type: 'function_call', call_id: `bad_${index}` } }));
  assert.equal(h.state().text, '');
  assert.equal(h.sent.length, invalid.length);
  for (const event of h.sent) assert.equal(JSON.parse((event.item as { output: string }).output).status, 'invalid_action');
});

test('incomplete function items and items received after a failed response cannot modify text', () => {
  const h = setup(); h.created();
  for (const status of ['incomplete', 'in_progress', null]) {
    h.backend({ type: 'response.output_item.done', response_id: 'response_1', item: { type: 'function_call', status,
      name: 'update_text_box', call_id: `call_${String(status)}`, arguments: '{"action":"replace","text":"Bad"}' } });
    assert.equal(h.result().status, 'not_completed');
  }
  h.backend({ type: 'response.failed', response: { id: 'response_1', status: 'failed' } });
  h.call('replace', 'Late failed item', 'late_failed');
  assert.equal(h.result().status, 'superseded');
  assert.equal(h.state().text, '');
});

test('size limits reject oversized append and pause dictation without silently truncating', () => {
  const h = setup(); h.created();
  h.call('replace', 'x'.repeat(4_000));
  h.call('append', 'extra', 'call_2');
  assert.equal(h.result().status, 'text_too_long');
  assert.equal(h.state().text.length, 4_000);
  h.transcript('start writing'); h.transcript('extra');
  assert.equal(h.state().text.length, 4_000);
  assert.equal(h.state().writing, false);
  assert.match(h.state().message, /full/);
});

test('undo history is bounded to ten edits', () => {
  const h = setup(); h.created();
  for (let index = 0; index < 12; index++) h.call('replace', `${index}`, `call_${index}`);
  for (let index = 0; index < 15; index++) h.session.action('undo');
  assert.equal(h.state().text, '1');
  assert.equal(h.state().canUndo, false);
});

test('finish preserves text, blocks late provider work and keeps local Clear/Undo available', () => {
  const h = setup(); h.transcript('start writing. Keep this'); h.created();
  h.session.finish(); h.session.finish();
  h.transcript('late'); h.call('replace', 'late'); h.complete();
  assert.equal(h.state().text, 'Keep this');
  assert.equal(h.state().writing, false);
  assert.equal(h.sent.length, 0);
  h.session.action('clear');
  assert.equal(h.state().text, '');
  h.session.action('undo');
  assert.equal(h.state().text, 'Keep this');
  assert.equal(h.sent.length, 0);
});

test('tool allowance stops further backend continuations without losing the current text', () => {
  const h = setup(); h.created();
  for (let index = 0; index < 65; index++) h.call('replace', `${index}`, `call_${index}`);
  assert.equal(h.state().text, '63');
  assert.equal(h.result().status, 'limit_reached');
  assert.match(h.state().message, /limit/);
  h.complete(); h.call('replace', 'late', 'call_late');
  assert.equal(h.sent.filter(event => event.type === 'response.create').length, 0);
  assert.equal(h.sent.length, 65);
});

test('failed responses do not trigger an automatic continuation', () => {
  const h = setup(); h.created(); h.call('replace', 'A result');
  h.backend({ type: 'response.failed', response: { id: 'response_1', status: 'failed' } });
  assert.deepEqual(h.sent.map(event => event.type), ['response.item.create']);
});

test('malformed event data cannot crash the voice host', () => {
  const h = setup();
  for (const event of [null, [], {}, { get type() { throw new Error('bad accessor'); } },
    { type: 'session.input_transcript.delta', delta: 'bad', start_ms: NaN, end_ms: Infinity },
    { type: 'session.input_transcript.delta', delta: 'bad', start_ms: 5, end_ms: 2 }]) {
    assert.doesNotThrow(() => h.session.event(event));
  }
  assert.equal(h.state().text, '');
});
