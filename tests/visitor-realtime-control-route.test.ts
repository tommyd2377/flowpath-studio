import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

test('control POST preserves local live support, validates origin/body/auth, and never recreates a closed mailbox (offline)', async t => {
  const environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'openai' };
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden by offline test.'); });
  const { createVisitorRealtimeMailbox } = await import('../lib/visitor-realtime-mailbox');
  const { POST } = await import('../app/api/visitor/[slug]/session/control/route');
  const box = await createVisitorRealtimeMailbox({ slug: 'local-voice', siteId: randomUUID(), publicationKey: 'synthetic-hash', expiresAt: Date.now() + 60_000 });
  try {
    const origin = 'http://127.0.0.1:3220';
    const update = { seq: 1, interactionRevision: 0, viewRevision: 2, ready: true, context: {} };
    const send = (body: unknown, from = origin, slug = 'local-voice', aborted = false) => {
      const controller = new AbortController(); if (aborted) controller.abort();
      return POST(new Request(`${origin}/api/visitor/${slug}/session/control`, { method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }), { params: Promise.resolve({ slug }) });
    };
    assert.equal((await send({ control: box.capability, update }, 'https://foreign.example')).status, 403);
    assert.equal((await send({ control: box.capability, update, instructions: 'forbidden' })).status, 400);
    assert.equal((await send({ control: box.capability, update: { ...update, context: { transcript: 'forbidden' } } })).status, 400);
    assert.equal((await send({ control: box.capability, update, padding: 'x'.repeat(70_000) })).status, 413);
    assert.equal((await send({ control: box.capability, update }, origin, '../invalid')).status, 400);
    assert.equal((await send({ control: box.capability, update }, origin, 'local-voice', true)).status, 499);
    assert.equal((await send({ control: { ...box.capability, token: 'x'.repeat(43) }, update })).status, 403);
    const seen: unknown[] = [];
    box.subscribe(value => { seen.push(value); }, assert.fail);
    const response = await send({ control: box.capability, update }); assert.equal(response.status, 204); assert.equal(response.headers.get('cache-control'), 'no-store');
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [{ ...update, end: false }]);
    await box.close(); assert.equal((await send({ control: box.capability, update: { ...update, seq: 2 } })).status, 410);
    process.env.VOICE_BACKEND = 'firebase';
    const unavailable = await send({ control: box.capability, update });
    assert.equal(unavailable.status, 503); // No Firebase configuration must never fall back to the local adapter.
    assert.equal(network.mock.callCount(), 0);
  } finally { await box.close(); process.env = environment; }
});
