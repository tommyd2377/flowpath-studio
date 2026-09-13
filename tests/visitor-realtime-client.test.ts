import assert from 'node:assert/strict';
import test from 'node:test';
import { readVisitorRealtimeEvents, visitorRealtimeEventSchema } from '../lib/visitor-realtime';

function stream(parts: string[]) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { parts.forEach(part => controller.enqueue(new TextEncoder().encode(part))); controller.close(); },
    cancel() { cancelled = true; },
  });
  return { body, cancelled: () => cancelled };
}

test('event stream handles split frames and requires a terminal event', async () => {
  const types: string[] = [];
  await readVisitorRealtimeEvents(stream(['{"type":"rea', 'dy"}\n{"type":"ended","message":"Done"}\n']).body, new AbortController().signal, event => { types.push(event.type); });
  assert.deepEqual(types, ['ready', 'ended']);
  await assert.rejects(readVisitorRealtimeEvents(stream(['{"type":"ready"}\n']).body, new AbortController().signal, () => undefined), /connection ended/);
});

test('malformed and oversized event frames fail closed without accepting plans', async () => {
  let accepted = 0;
  for (const value of ['{"type":"plan","revision":-1}\n', '{"type":"unexpected"}\n', 'x'.repeat(256001)]) {
    await assert.rejects(readVisitorRealtimeEvents(stream([value]).body, new AbortController().signal, () => { accepted++; }));
  }
  assert.equal(accepted, 0);
  assert.equal(visitorRealtimeEventSchema.safeParse({ type: 'speech_started' }).success, false);
  assert.equal(visitorRealtimeEventSchema.safeParse({ type: 'task_error', revision: 1, interactionRevision: 0, message: 'Image search could not finish.' }).success, true);
});

test('Stop cancels a pending reader immediately and late frames do not escape', async () => {
  const abort = new AbortController();
  let cancelled = false, accepted = 0;
  const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
  const reading = readVisitorRealtimeEvents(body, abort.signal, () => { accepted++; });
  abort.abort();
  await reading;
  assert.equal(cancelled, true);
  assert.equal(accepted, 0);
});

test('host rejection cancels the stream before subsequent events are handled', async () => {
  let cancelled = false, accepted = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"plan","revision":1,"interactionRevision":0,"presentation":{}}\n{"type":"ready"}\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(readVisitorRealtimeEvents(body, new AbortController().signal, () => { accepted++; throw new Error('Unpublished reference'); }), /Unpublished/);
  assert.equal(cancelled, true); assert.equal(accepted, 1);
});
