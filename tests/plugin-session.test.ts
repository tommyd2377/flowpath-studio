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
  backend({ type: 'response.created', response: { id: 'response_1' } });
  const call = (display: boolean, name = 'search_waveform_knowledge', callId = 'call_1') => backend({ type: 'response.output_item.done', response_id: 'response_1',
    item: { type: 'function_call', name, call_id: callId, arguments: JSON.stringify({ query: 'When does the museum open?', display }) } });
  const complete = () => backend({ type: 'response.completed', response: { id: 'response_1', status: 'completed' } });
  return { session, sent, backend, call, complete, state: () => state, searched: () => searched, resolve: () => resolve(result) };
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
