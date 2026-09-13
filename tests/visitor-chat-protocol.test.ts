import test from 'node:test';
import assert from 'node:assert/strict';
import { readVisitorChatEvents } from '../lib/visitor-chat-protocol';

const error = { type: 'error', message: 'Synthetic failure' };
function stream(text: string) { return new ReadableStream<Uint8Array>({ start(controller) { for (const part of [text.slice(0, 7), text.slice(7)]) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }); }
test('chat event stream supports split frames and preserves terminal failures', async () => {
  const received: unknown[] = [];
  await readVisitorChatEvents(stream(`${JSON.stringify(error)}\n`), new AbortController().signal, async event => { received.push(event); });
  assert.deepEqual(received, [error]);
});
test('chat event stream rejects a truncated task and unregistered event', async () => {
  await assert.rejects(readVisitorChatEvents(stream(''), new AbortController().signal, async () => {}), /before completion/);
  await assert.rejects(readVisitorChatEvents(stream('{"type":"run_arbitrary_code"}\n'), new AbortController().signal, async () => {}));
});
test('chat cancellation prevents accepting any result', async () => {
  const controller = new AbortController(); controller.abort(); let accepted = false;
  await assert.rejects(readVisitorChatEvents(stream(`${JSON.stringify(error)}\n`), controller.signal, async () => { accepted = true; }), { name: 'AbortError' });
  assert.equal(accepted, false);
});
