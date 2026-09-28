import test from 'node:test';
import assert from 'node:assert/strict';
import { readVisitorResponse } from '../lib/visitor-response-stream';

const frame = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const completed = { type: 'response.completed', response: { status: 'completed', output: [], usage: { total_tokens: 10 } } };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function stream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }), { headers: { 'content-type': 'text/event-stream' } });
  return { response, get controller() { return controller; }, get cancelled() { return cancelled; } };
}

test('terminal SSE returns before the tail ends, then releases at EOF without cancelling the connection', async () => {
  const source = stream(), events: unknown[] = [];
  source.controller.enqueue(frame(completed));
  const result = await readVisitorResponse(source.response, new AbortController().signal, event => events.push(event));
  assert.deepEqual(result, completed.response); assert.equal(source.cancelled, 0);
  assert.equal(source.response.body!.locked, true, 'The bounded background drain owns the remaining body');
  source.controller.enqueue(frame({ type: 'response.function_call_arguments.delta', delta: '{"untrusted":true}' }));
  source.controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
  source.controller.close(); await flush();
  assert.deepEqual(events, [completed], 'Post-terminal data cannot execute or produce another result');
  assert.equal(source.cancelled, 0); assert.equal(source.response.body!.locked, false);
});

test('all terminal statuses consume a finite tail and JSON EOF releases the reader normally', async () => {
  for (const status of ['completed', 'incomplete', 'failed']) {
    const source = stream();
    source.controller.enqueue(frame({ type: `response.${status}`, response: { status, output: [] } })); source.controller.close();
    assert.equal((await readVisitorResponse(source.response, new AbortController().signal)).status, status);
    await flush(); assert.equal(source.cancelled, 0); assert.equal(source.response.body!.locked, false);
  }
  const response = Response.json(completed.response);
  assert.deepEqual(await readVisitorResponse(response, new AbortController().signal), completed.response);
  assert.equal(response.body!.locked, false);
});

test('a stalled terminal tail is cancelled without delaying or changing the completed result', async () => {
  const source = stream(); source.controller.enqueue(frame(completed));
  assert.deepEqual(await readVisitorResponse(source.response, new AbortController().signal), completed.response);
  assert.equal(source.cancelled, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(source.cancelled, 1); assert.equal(source.response.body!.locked, false);
});

for (const where of ['buffered', 'later'] as const) test(`an oversized ${where} terminal tail is cancelled, never parsed`, async () => {
  const source = stream(), tail = new TextEncoder().encode('x'.repeat(8193)), events: unknown[] = [];
  source.controller.enqueue(where === 'buffered' ? new Uint8Array([...frame(completed), ...tail]) : frame(completed));
  assert.deepEqual(await readVisitorResponse(source.response, new AbortController().signal, event => events.push(event)), completed.response);
  if (where === 'later') source.controller.enqueue(tail);
  await flush(); assert.equal(source.cancelled, 1); assert.equal(source.response.body!.locked, false); assert.deepEqual(events, [completed]);
});

test('cancellation and a dropped terminal tail release resources without retracting a completed answer', async () => {
  for (const action of ['abort', 'drop'] as const) {
    const source = stream(), controller = new AbortController(); source.controller.enqueue(frame(completed));
    const result = await readVisitorResponse(source.response, controller.signal);
    if (action === 'abort') controller.abort(); else source.controller.error(new Error('Synthetic tail disconnect'));
    await flush(); assert.deepEqual(result, completed.response); assert.equal(source.response.body!.locked, false);
    if (action === 'abort') assert.equal(source.cancelled, 1);
  }
});

test('an endless zero-byte tail cannot starve the cleanup deadline', async () => {
  let pulls = 0, cancelled = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(pulls++ === 0 ? frame(completed) : new Uint8Array()); },
    cancel() { cancelled++; },
  }), { headers: { 'content-type': 'text/event-stream' } });
  assert.deepEqual(await readVisitorResponse(response, new AbortController().signal), completed.response);
  await flush(); assert.equal(cancelled, 1); assert.equal(response.body!.locked, false);
  assert.ok(pulls <= 66, 'Bound reads plus at most one stream-prefetched chunk');
});

test('a partial or malformed SSE response still fails and releases its reader', async () => {
  const partial = stream(); partial.controller.enqueue(frame({ type: 'response.output_text.delta', delta: 'Incomplete answer' })); partial.controller.close();
  await assert.rejects(readVisitorResponse(partial.response, new AbortController().signal), /did not finish/);
  assert.equal(partial.response.body!.locked, false);
  const malformed = stream(); malformed.controller.enqueue(frame({ type: 'response.completed', response: null }));
  await assert.rejects(readVisitorResponse(malformed.response, new AbortController().signal), /did not finish/);
  assert.equal(malformed.cancelled, 1); assert.equal(malformed.response.body!.locked, false);
});
