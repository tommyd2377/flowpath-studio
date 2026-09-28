import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type WebSocket from 'ws';
import { voiceTaskSpeech } from '../lib/visitor-voice-input';
import { navigationConfirmation } from '../lib/visitor-navigation';
import { createVisitorResponseConnection } from '../lib/visitor-response-connection';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { liveAnswer, liveTool, flushLive } from './helpers/live-fixture';

test('conversation and task controls have separate meanings', () => {
  for (const speech of ['Thanks for helping.', 'I am having a nice day.', 'Do not cancel that.', 'How is it', 'Stop talking about cancelling tasks.']) assert.equal(voiceTaskSpeech(speech), null, speech);
  for (const speech of ['How is it going?', 'Are you still working?', 'Any progress?']) assert.equal(voiceTaskSpeech(speech), 'status');
  assert.equal(voiceTaskSpeech('Keep working while we talk.'), 'continue');
  assert.equal(voiceTaskSpeech('Stop talking.'), 'quiet');
  assert.equal(voiceTaskSpeech('Cancel that.'), 'cancel');
  assert.equal(voiceTaskSpeech('Actually, show a different item.'), 'replace');
  assert.equal(voiceTaskSpeech('Go back to the main screen.'), 'replace');
});

test('only an entire simple navigation request can use a deterministic confirmation', () => {
  assert.equal(navigationConfirmation('Please open Arts and Crafts.', 'open', ['Arts and Crafts']), 'Opened.');
  assert.equal(navigationConfirmation('Close this panel', 'close'), 'Closed.');
  assert.equal(navigationConfirmation('Can you open up the Contact panel?', 'open', ['Contact']), 'Opened.');
  assert.equal(navigationConfirmation('Go back.', 'back'), 'You’re back in the previous view.');
  assert.equal(navigationConfirmation('Go back to the workspace.', 'unfocus'), 'You’re back in the workspace.');
  for (const text of ['Open Arts and Crafts and explain the price.', 'Open Arts and Crafts then show Contact.', 'Close this panel and open another.', 'Tell me about this panel.']) assert.equal(navigationConfirmation(text, text.startsWith('Close') ? 'close' : 'open', ['Arts and Crafts']), undefined);
  assert.equal(navigationConfirmation('Open Contact', 'open', ['Wedding stories']), undefined);
});

class Socket extends EventEmitter {
  readyState: 0 | 1 | 2 | 3 = 0; sent: Record<string, unknown>[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.emit('open'); }
  terminate() { this.readyState = 3; this.emit('close'); }
  frame(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
function connection() {
  const sockets: Socket[] = [];
  const transport = createVisitorResponseConnection('synthetic', url => { assert.equal(url, 'wss://api.openai.com/v1/responses'); const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; });
  return { ...transport, sockets };
}

test('voice streams model progress and reuses a connection with only the next tool result', async () => {
  const transport = connection(), phases: string[] = [], executed: string[] = [];
  assert.equal(transport.sockets.length, 0, 'Construction must not connect or warm up');
  const job = runVisitorTask({ channel: 'voice', model: 'synthetic', apiKey: 'synthetic', instructions: 'Published facts only.', context: { request: 'Find the item.' }, signal: new AbortController().signal,
    responseRequest: transport.request, onModelTiming: stage => phases.push(stage), tools: [{ type: 'function', name: 'lookup', description: '', parameters: {} }],
    execute: async name => { executed.push(name); return { data: { verified: true } }; } });
  await flushLive(); const socket = transport.sockets[0]; socket.open();
  assert.equal(socket.sent.length, 1); assert.equal(socket.sent[0].store, false);
  assert.equal(socket.sent[0].type, 'response.create'); assert.equal('stream' in socket.sent[0], false);
  socket.frame({ type: 'response.function_call_arguments.delta', delta: '{' });
  await flushLive(); assert.deepEqual(executed, [], 'Incomplete tool JSON cannot execute');
  assert.ok(phases.includes('model_output'), 'Progress arrives before completion');
  socket.frame({ type: 'response.completed', response: { id: 'resp_first', status: 'completed', output: [liveTool('lookup', {})] } });
  await flushLive(); assert.deepEqual(executed, ['lookup']); assert.equal(transport.sockets.length, 1);
  assert.equal(socket.sent[1].previous_response_id, 'resp_first');
  assert.deepEqual(socket.sent[1].input, [{ type: 'function_call_output', call_id: 'call_test', output: '{"verified":true}' }]);
  socket.frame({ type: 'response.completed', response: { id: 'resp_second', status: 'completed', output: [liveAnswer('Verified result.')] } });
  assert.equal((await job).text, 'Verified result.');
  transport.close(); assert.equal(socket.readyState, 3);
});

test('cancelling a streamed response rejects promptly and ignores every late frame', async () => {
  const transport = connection(), controller = new AbortController();
  const first = transport.request({ model: 'synthetic', input: [] }, controller.signal);
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const old = transport.sockets[0]; old.open(); controller.abort(); await cancelled;
  assert.equal(old.readyState, 3);
  const next = transport.request({ model: 'synthetic', input: [] }, new AbortController().signal);
  const current = transport.sockets[1]; current.open();
  old.frame({ type: 'response.completed', response: { id: 'obsolete', status: 'completed', output: [liveAnswer('Stale result')] } });
  current.frame({ type: 'response.completed', response: { id: 'current', status: 'completed', output: [liveAnswer('Current result')] } });
  assert.equal((await next).id, 'current'); assert.equal('previous_response_id' in current.sent[0], false);
  transport.close();
});

for (const readyState of [2, 3] as const) test(`a new voice request reconnects after socket state ${readyState}, without reusing its lost cache`, async () => {
  const transport = connection(), input = [{ role: 'user', content: 'Published synthetic item' }], output = [liveAnswer('Initial answer')];
  try {
    const first = transport.request({ model: 'synthetic', store: false, input }, new AbortController().signal);
    const old = transport.sockets[0]; old.open();
    old.frame({ type: 'response.completed', response: { id: 'old-cache', status: 'completed', output } }); await first;
    // Network state changes can be visible before ws dispatches its close event.
    old.readyState = readyState;
    const fullInput = [...input, ...output, { role: 'user', content: 'New independent follow-up' }];
    const next = transport.request({ model: 'synthetic', store: false, input: fullInput }, new AbortController().signal);
    assert.equal(transport.sockets.length, 2, 'Only the new request opens a fresh socket');
    const current = transport.sockets[1]; current.open(); old.emit('close');
    old.frame({ type: 'response.completed', response: { id: 'late', status: 'completed', output: [liveAnswer('Stale')] } });
    assert.equal(old.sent.length, 1, 'The completed request is never replayed');
    assert.equal(current.sent.length, 1); assert.equal('previous_response_id' in current.sent[0], false);
    assert.deepEqual(current.sent[0].input, fullInput); assert.equal(current.sent[0].store, false);
    await assert.rejects(transport.request({ input: [] }, new AbortController().signal), /temporarily unavailable/, 'Concurrent work cannot replace the pending request');
    current.frame({ type: 'response.completed', response: { id: 'new', status: 'completed', output: [liveAnswer('New answer')] } });
    assert.equal((await next).id, 'new');
  } finally { transport.close(); }
});

for (const failure of ['error', 'response.incomplete', 'disconnect', 'oversized'] as const) test(`a ${failure} stream never executes partial tools or retries`, async () => {
  const transport = connection(); let executed = 0, usage = 0;
  const job = runVisitorTask({ channel: 'voice', model: 'synthetic', apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal,
    responseRequest: transport.request, tools: [{ type: 'function', name: 'lookup', description: '', parameters: {} }], onUsage: () => { usage++; }, execute: async () => { executed++; return { data: {} }; } });
  const rejected = assert.rejects(job); await flushLive(); const socket = transport.sockets[0]; socket.open();
  socket.frame({ type: 'response.function_call_arguments.delta', delta: '{"reference":' });
  if (failure === 'disconnect') socket.terminate();
  else if (failure === 'oversized') socket.frame({ type: 'response.output_text.delta', delta: 'x'.repeat(256_001) });
  else socket.frame({ type: failure, status: 429, response: { status: 'incomplete', output: [liveTool('lookup', {})], usage: { total_tokens: 10 } } });
  await rejected; assert.equal(executed, 0); assert.equal(socket.sent.length, 1); assert.equal(transport.sockets.length, 1);
  assert.equal(usage, failure === 'response.incomplete' ? 1 : 0); transport.close();
});
