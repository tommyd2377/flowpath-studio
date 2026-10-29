import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveTextSession, type LiveTextState } from '../lib/live-text-session';
import { PLUGINS, validKnowledgeResult } from '../lib/plugin-contract';
import { voiceSessionConfig } from '../lib/voice-config';

const result = { revision: 1, passages: [{ id: 'source_1', documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', filename: 'Guide.txt', quote: 'The synthetic museum opens at nine.' }] };
function setup(textEnabled = true) {
  let state: LiveTextState, resolve!: (value: unknown) => void, searched = 0;
  const sent: Record<string, unknown>[] = [];
  const session = createLiveTextSession({ textEnabled, onChange: next => { state = next; }, send: event => { sent.push(event); },
    searchKnowledge: async () => { searched++; return new Promise(done => { resolve = done; }); } });
  const backend = (event: Record<string, unknown>) => session.event({ type: 'response.event', delegation_id: 'delegation_1', event });
  let responseNumber = 0, responseId = '';
  const created = () => { responseId = `response_${++responseNumber}`; backend({ type: 'response.created', response: { id: responseId } }); };
  created();
  const call = (display: boolean, name = 'search_waveform_knowledge', callId = 'call_1') => backend({ type: 'response.output_item.done', response_id: responseId,
    item: { type: 'function_call', name, call_id: callId, arguments: JSON.stringify({ query: 'When does the museum open?', display }) } });
  const complete = () => backend({ type: 'response.completed', response: { id: responseId, status: 'completed' } });
  return { session, sent, backend, created, call, complete, state: () => state, searched: () => searched, resolve: () => resolve(result) };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('source DTOs reject undeclared provider fields and invented links', () => {
  assert.equal(validKnowledgeResult(result), true);
  assert.equal(validKnowledgeResult({ ...result, storeId: 'private-provider-store' }), false);
  assert.equal(validKnowledgeResult({ ...result, passages: [{ ...result.passages[0], url: 'https://unverified.invalid' }] }), false);
});

test('the registry has one owner per tool and Knowledge works without a display plugin', async () => {
  const tools = PLUGINS.flatMap(p => [...p.tools]); assert.equal(new Set(tools).size, tools.length);
  const config = voiceSessionConfig({ name: 'Guide', initialPrompt: 'Be helpful.', knowledge: true });
  assert.equal(config.delegation.responses.model, 'gpt-6-luna');
  assert.deepEqual(config.delegation.responses.tools.map(t => t.name), ['search_waveform_knowledge']);
  assert.ok(!config.client.data_channel.allowed_server_events.some(e => e.type === 'session.input_transcript.delta'));
  const h = setup(false); h.call(true); h.complete(); h.resolve(); await tick();
  assert.equal(h.state().visible, false); assert.equal(h.sent.length, 2);
  const output = JSON.parse((h.sent[0].item as { output: string }).output); assert.equal(output.displayed, false); assert.equal(output.passages.length, 1);
});

test('async search returns exactly one output before one continuation and explicit display carries verified sources', async () => {
  const h = setup(); h.call(true); h.call(true); h.complete();
  assert.equal(h.sent.length, 0); assert.equal(h.searched(), 1); assert.equal(h.state().visible, true); assert.equal(h.state().pending, true);
  h.resolve(); await tick(); h.complete();
  assert.deepEqual(h.sent.map(e => e.type), ['response.item.create', 'response.create']);
  assert.equal(h.state().visible, true); assert.deepEqual(h.state().sources, result.passages);
  assert.equal(h.state().pending, false);
  assert.match(h.state().text, /museum opens/);
  h.session.action('clear'); assert.equal(h.state().sources?.length, 0);
  h.session.action('undo'); assert.deepEqual(h.state().sources, result.passages);
});

test('spoken Q&A never opens Text Box; unregistered tools cannot be acknowledged by it', async () => {
  const h = setup(); h.call(false, 'foreign_plugin'); assert.equal(h.sent.length, 0);
  h.call(false); h.complete(); h.resolve(); await tick(); assert.equal(h.state().visible, false); assert.equal(h.state().text, '');
});

test('hide, newer text and session finish protect against late search display', async () => {
  for (const action of ['hide', 'dictate', 'finish'] as const) {
    const h = setup(); h.call(true); h.complete();
    if (action === 'hide') h.session.action('hide');
    else if (action === 'dictate') h.session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. My newer words.', start_ms: 0, end_ms: 100 });
    else h.session.finish();
    h.resolve(); await tick();
    assert.equal(h.state().sources?.length, 0);
    assert.equal(h.state().visible, action !== 'hide');
    if (action === 'dictate') assert.equal(h.state().text, 'My newer words.');
    if (action === 'finish') assert.equal(h.sent.length, 0);
  }
});

test('notes and sourced Knowledge retain independent text and Undo across display switches and call end', async () => {
  const h = setup();
  h.session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. Keep my notes. Stop writing.', start_ms: 0, end_ms: 100 });
  assert.equal(h.state().display, 'text');
  const notes = h.state().text;
  h.created(); h.call(true); h.complete();
  assert.equal(h.state().display, 'knowledge'); assert.equal(h.state().writing, false);
  h.resolve(); await tick();
  assert.deepEqual(h.state().sources, result.passages);
  h.session.display('text');
  assert.equal(h.state().text, notes); assert.equal(h.state().sources?.length, 0);
  h.session.action('clear'); h.session.action('undo'); assert.equal(h.state().text, notes);
  h.session.display('knowledge');
  assert.match(h.state().text, /museum opens/);
  h.session.action('clear'); h.session.action('undo'); assert.deepEqual(h.state().sources, result.passages);
  h.session.finish(); h.session.display('text');
  assert.equal(h.state().text, notes); assert.equal(h.searched(), 1);
  h.session.display('knowledge'); assert.deepEqual(h.state().sources, result.passages);
});

test('selecting the current display is inert; leaving pending Knowledge rejects its later result', async () => {
  const h = setup(); h.call(true); h.complete();
  h.session.display('knowledge'); h.resolve(); await tick();
  assert.deepEqual(h.state().sources, result.passages);
  const pending = setup(); pending.call(true); pending.complete(); pending.session.display('text');
  pending.resolve(); await tick();
  assert.equal(pending.state().display, 'text'); assert.equal(pending.state().text, '');
  pending.session.display('knowledge'); assert.equal(pending.state().sources?.length, 0);
});

test('editing a sourced answer creates Text Box text while preserving the original Knowledge passages', async () => {
  const h = setup(); h.call(true); h.complete(); h.resolve(); await tick();
  h.created();
  h.backend({ type: 'response.output_item.done', item: { type: 'function_call', name: 'update_text_box', call_id: 'edit_source',
    arguments: JSON.stringify({ action: 'replace', text: 'A shorter answer.' }) } });
  assert.equal(h.state().display, 'text'); assert.equal(h.state().text, 'A shorter answer.'); assert.equal(h.state().sources?.length, 0);
  h.session.display('knowledge'); assert.deepEqual(h.state().sources, result.passages);
  h.session.display('text'); h.session.action('undo'); assert.deepEqual(h.state().sources, result.passages);
});

test('requesting sources pauses dictation; Start writing restores notes without adding to source passages', async () => {
  const h = setup();
  h.session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. Notes first.', start_ms: 0, end_ms: 100 });
  h.created(); h.call(true); h.complete(); h.resolve(); await tick();
  assert.equal(h.state().writing, false); assert.equal(h.state().display, 'knowledge');
  h.session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. More notes.', start_ms: 101, end_ms: 200 });
  assert.equal(h.state().display, 'text'); assert.equal(h.state().text, 'Notes first.More notes.');
  h.session.display('knowledge'); assert.deepEqual(h.state().sources, result.passages);
});

test('an older concurrent search cannot replace the latest displayed Knowledge result', async () => {
  let state: LiveTextState;
  const release: Array<(value: unknown) => void> = [];
  const session = createLiveTextSession({ onChange: next => { state = next; }, send: () => {},
    searchKnowledge: async () => new Promise(resolve => release.push(resolve)) });
  for (let i = 0; i < 2; i++) {
    const event = (event: object) => session.event({ type: 'response.event', delegation_id: `delegation_${i}`, event });
    event({ type: 'response.created', response: { id: `response_${i}` } });
    event({ type: 'response.output_item.done', response_id: `response_${i}`, item: { type: 'function_call', name: 'search_waveform_knowledge',
      call_id: `call_${i}`, arguments: JSON.stringify({ query: 'Hours', display: true }) } });
    event({ type: 'response.completed', response: { id: `response_${i}`, status: 'completed' } });
  }
  release[0](result); await tick(); assert.equal(state!.pending, true); assert.equal(state!.text, '');
  const latest = { ...result, passages: [{ ...result.passages[0], quote: 'The latest verified passage.' }] };
  release[1](latest); await tick(); assert.deepEqual(state!.sources, latest.passages); assert.equal(state!.pending, false);
});

test('voice restart carries both display buffers and Undo, but no pending search or dictation authority', async () => {
  const old = setup();
  old.session.event({ type: 'session.input_transcript.delta', delta: 'Start writing. Keep these notes. Stop writing.', start_ms: 0, end_ms: 100 });
  old.created(); old.call(true); old.complete(); old.resolve(); await tick();
  old.session.finish();
  let state!: LiveTextState;
  const next = createLiveTextSession({ workspace: old.session.workspace(), onChange: value => { state = value; }, send: () => {} });
  assert.equal(state.display, 'knowledge'); assert.equal(state.visible, true); assert.equal(state.pending, false);
  assert.equal(state.writing, false); assert.deepEqual(state.sources, result.passages);
  assert.equal(state.sources, old.state().sources, 'immutable sources keep the reader’s scroll anchor across restart');
  next.display('text'); assert.match(state.text, /Keep these notes/);
  next.action('clear'); next.action('undo'); assert.match(state.text, /Keep these notes/);
  next.event({ type: 'session.input_transcript.delta', delta: 'Not dictated automatically.', start_ms: 0, end_ms: 100 });
  assert.doesNotMatch(state.text, /automatically/);
  next.event({ type: 'session.input_transcript.delta', delta: 'Start writing. New words.', start_ms: 100, end_ms: 200 });
  assert.match(state.text, /New words/);
  next.display('knowledge'); assert.deepEqual(state.sources, result.passages);
  const pending = setup(); pending.call(true); pending.complete(); pending.session.finish();
  const resumed = createLiveTextSession({ workspace: pending.session.workspace(), onChange: value => { state = value; }, send: () => assert.fail('old tool output must not cross calls') });
  pending.resolve(); await tick();
  assert.equal(state.pending, false); assert.equal(state.text, '');
  resumed.finish(); next.finish();
});
