import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('dictation route rejects cross-origin, malformed, oversized, aborted and offline requests without provider calls or quota', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-dictation-route-')), environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'openai', VOICE_DATA_DIR: directory, OPENAI_API_KEY: 'offline-placeholder' };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden by offline test.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { POST } = await import('../app/api/visitor/[slug]/dictation/route');
    await withDatabase(db => { const site = initialSite('general', 'Dictation fixture', 'dictation-fixture'); site.published = structuredClone(site.draft); db.sites = [site]; });
    const origin = 'http://127.0.0.1:3220', audio = Buffer.alloc(9600).toString('base64');
    const send = (body: unknown, options: { from?: string; slug?: string; contentType?: string; raw?: boolean; signal?: AbortSignal } = {}) => POST(new Request(`${origin}/api/visitor/${options.slug ?? 'dictation-fixture'}/dictation`, {
      method: 'POST', headers: { origin: options.from ?? origin, 'content-type': options.contentType ?? 'application/json' }, body: options.raw ? String(body) : JSON.stringify(body), signal: options.signal,
    }), { params: Promise.resolve({ slug: options.slug ?? 'dictation-fixture' }) });
    assert.equal((await send({ requestId: randomUUID(), audio }, { from: 'https://foreign.example' })).status, 403);
    assert.equal((await send({ requestId: randomUUID(), audio }, { slug: 'invalid slug' })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), audio }, { contentType: 'text/plain' })).status, 415);
    assert.equal((await send('{invalid', { raw: true })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), audio, model: 'untrusted-model' })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), audio: 'A'.repeat(1_300_001) })).status, 413);
    assert.equal((await send({ requestId: randomUUID(), audio: `${audio}\n` })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), audio: Buffer.alloc(9601).toString('base64') })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), audio }, { signal: AbortSignal.abort() })).status, 499);
    const demo = await send({ requestId: randomUUID(), audio });
    assert.equal(demo.status, 503); assert.equal(demo.headers.get('Cache-Control'), 'no-store'); assert.match((await demo.json()).error, /demo preview/);
    assert.equal(await withDatabase(db => db.visitorUsage), undefined); assert.equal(network.mock.callCount(), 0);
  } finally { process.env = environment; await rm(directory, { recursive: true, force: true }); }
});
