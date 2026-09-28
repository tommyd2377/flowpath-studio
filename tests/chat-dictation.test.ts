import assert from 'node:assert/strict';
import test from 'node:test';
import { chatSpeechRecognition, createChatDictation, type ChatDictationState, type ChatSpeechRecognition, type ChatSpeechResultEvent } from '../lib/chat-dictation';

class FakeRecognition implements ChatSpeechRecognition {
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  lang = '';
  starts = 0;
  aborts = 0;
  onstart: ChatSpeechRecognition['onstart'] = null;
  onresult: ChatSpeechRecognition['onresult'] = null;
  onerror: ChatSpeechRecognition['onerror'] = null;
  onnomatch: ChatSpeechRecognition['onnomatch'] = null;
  onend: ChatSpeechRecognition['onend'] = null;
  start() { this.starts++; }
  abort() { this.aborts++; }
  result(...parts: [text: string, final: boolean][]) {
    this.onresult?.({ results: parts.map(([transcript, isFinal]) => ({ 0: { transcript }, isFinal })) });
  }
}

function harness(initialText = '') {
  const instances: FakeRecognition[] = [];
  const states: ChatDictationState[] = [];
  const updates: string[] = [];
  let text = initialText;
  const controller = createChatDictation({
    getRecognition: () => class extends FakeRecognition { constructor() { super(); instances.push(this); } },
    getText: () => text,
    onText: value => { text = value; updates.push(value); },
    onState: state => states.push(state),
  });
  return { controller, instances, states, updates, text: () => text, edit: (value: string) => { text = value; } };
}

test('dictation detects both browser APIs and starts only after a deliberate call', t => {
  assert.equal(chatSpeechRecognition({}), undefined);
  assert.equal(chatSpeechRecognition({ webkitSpeechRecognition: FakeRecognition }), FakeRecognition);
  class NativeRecognition extends FakeRecognition {}
  assert.equal(chatSpeechRecognition({ SpeechRecognition: NativeRecognition, webkitSpeechRecognition: FakeRecognition }), NativeRecognition);
  const h = harness(); t.after(h.controller.dispose);
  assert.equal(h.instances.length, 0);
  h.controller.start({ language: 'en-US' });
  assert.equal(h.instances.length, 1);
  assert.equal(h.instances[0].starts, 1);
  assert.equal(h.instances[0].lang, 'en-US');
  assert.equal(h.instances[0].interimResults, true);
  assert.equal(h.states.at(-1)?.status, 'starting');
  h.controller.start();
  assert.equal(h.instances.length, 1, 'repeated clicks do not create simultaneous recognizers');
  h.instances[0].onstart?.();
  assert.equal(h.states.at(-1)?.status, 'listening');
});

test('interim revisions and final events replace one dictated suffix without duplicates', t => {
  const h = harness('Find me'); t.after(h.controller.dispose); h.controller.start();
  const recognition = h.instances[0];
  recognition.result(['red', false]); assert.equal(h.text(), 'Find me red');
  recognition.result(['red flowers', false]); assert.equal(h.text(), 'Find me red flowers');
  recognition.result(['red flowers', true]); assert.equal(h.updates.length, 2);
  recognition.result(['red flowers', true], ['near me', false]); assert.equal(h.text(), 'Find me red flowers near me');
  recognition.result(['red flowers', true]); assert.equal(h.text(), 'Find me red flowers', 'removed interim words are removed from the draft');
  recognition.result(['red flowers', true], ['red flowers', true]);
  assert.equal(h.text(), 'Find me red flowers red flowers', 'intentional repetition at another result index is retained');
  recognition.onend?.();
  assert.equal(h.states.at(-1)?.status, 'idle');
  assert.equal(recognition.aborts, 0);
  assert.equal(h.instances.length, 1, 'end never restarts recognition');
});

test('typed whitespace is preserved and later clicks append to the existing draft', t => {
  const h = harness('First line\n'); t.after(h.controller.dispose); h.controller.start();
  h.instances[0].result(['  second line ', false]);
  assert.equal(h.text(), 'First line\nsecond line');
  h.controller.stop(); h.controller.start(); h.instances[1].result(['and more', true]);
  assert.equal(h.text(), 'First line\nsecond line and more');
});

test('manual draft edits cancel dictation before a queued result can overwrite them', t => {
  for (const sync of [false, true]) {
    const h = harness('Before'); t.after(h.controller.dispose); h.controller.start();
    const recognition = h.instances[0];
    recognition.result(['speech', false]);
    const lateResult = recognition.onresult!;
    h.edit('My corrected message');
    if (sync) h.controller.syncText(h.text());
    lateResult({ results: [{ 0: { transcript: 'late final' }, isFinal: true }] });
    assert.equal(h.text(), 'My corrected message');
    assert.equal(recognition.aborts, 1);
    assert.equal(h.states.at(-1)?.status, 'idle');
  }
});

test('stop and disposal preserve interim text and ignore callbacks from an old session', t => {
  const h = harness(); t.after(h.controller.dispose); h.controller.start();
  const old = h.instances[0];
  old.result(['review these words', false]);
  const lateResult = old.onresult!, lateEnd = old.onend!, lateStart = old.onstart!;
  h.controller.stop();
  assert.equal(old.aborts, 1); assert.equal(old.onresult, null);
  assert.equal(h.text(), 'review these words');
  h.controller.start(); const stateCount = h.states.length;
  lateStart(); lateEnd(); lateResult({ results: [] });
  assert.equal(h.states.length, stateCount);
  assert.equal(h.text(), 'review these words');
  const second = h.instances[1], afterDispose = second.onresult!;
  h.controller.dispose(); afterDispose({ results: [] }); h.controller.start();
  assert.equal(second.aborts, 1);
  assert.equal(h.instances.length, 2);
  assert.equal(h.states.length, stateCount, 'unmount does not update React state');
});

test('unsupported browsers and failures provide typing fallback without retries', t => {
  const states: ChatDictationState[] = [];
  const unsupported = createChatDictation({ getRecognition: () => undefined, getText: () => '', onText: () => assert.fail('no text'), onState: value => states.push(value) });
  unsupported.start(); assert.equal(states.at(-1)?.status, 'unsupported'); assert.match(states.at(-1)!.message, /type your message/);
  for (const [error, message] of [['not-allowed', /Microphone access was blocked/], ['service-not-allowed', /dictation service/], ['network', /connection/], ['audio-capture', /microphone is unavailable/], ['no-speech', /No speech/], ['language-not-supported', /language/]] as const) {
    const h = harness('Keep this'); t.after(h.controller.dispose); h.controller.start();
    h.instances[0].onerror?.({ error });
    assert.equal(h.states.at(-1)?.status, 'error'); assert.match(h.states.at(-1)!.message, message);
    assert.equal(h.instances[0].aborts, 1); assert.equal(h.instances.length, 1); assert.equal(h.text(), 'Keep this');
  }
});

test('synchronous permission failures and empty sessions keep chat usable', t => {
  const states: ChatDictationState[] = [];
  const denied = createChatDictation({ getRecognition: () => class extends FakeRecognition { start() { throw new DOMException('Denied', 'NotAllowedError'); } }, getText: () => '', onText: () => {}, onState: value => states.push(value) });
  t.after(denied.dispose); denied.start();
  assert.equal(states.at(-1)?.status, 'error'); assert.match(states.at(-1)!.message, /Microphone access was blocked/);
  const h = harness(); t.after(h.controller.dispose); h.controller.start(); h.instances[0].onend?.();
  assert.equal(h.states.at(-1)?.status, 'error'); assert.match(h.states.at(-1)!.message, /No speech/);
  h.controller.start(); h.instances[1].onnomatch?.(); assert.match(h.states.at(-1)!.message, /No speech/);
});

test('one attempt is bounded by time and the composer length limit', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness('Typed'); t.after(h.controller.dispose); h.controller.start();
  t.mock.timers.tick(60_000);
  assert.equal(h.instances[0].aborts, 1); assert.equal(h.states.at(-1)?.status, 'idle');
  assert.match(h.states.at(-1)!.message, /one minute/); assert.equal(h.text(), 'Typed');
  t.mock.timers.tick(120_000); assert.equal(h.instances.length, 1, 'timeout cannot retry');
  h.controller.start({ maxLength: 12 }); h.instances[1].result(['more words than fit', false]);
  assert.equal(h.text(), 'Typed more w'); assert.equal(h.instances[1].aborts, 1);
  assert.match(h.states.at(-1)!.message, /message is full/);
});

// The fake uses the native array-like event shape, without browser/microphone access.
const eventShape: ChatSpeechResultEvent = { results: { length: 1, 0: { 0: { transcript: 'example' }, isFinal: true } } };
test('native array-like result lists are accepted', t => {
  const h = harness(); t.after(h.controller.dispose); h.controller.start();
  h.instances[0].onresult?.(eventShape); assert.equal(h.text(), 'example');
});
