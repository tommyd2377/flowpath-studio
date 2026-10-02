import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('composition route authenticates, bounds input, preserves revision and keeps demo completely offline', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'website-composition-route-')), environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'openai', VOICE_DATA_DIR: directory, OPENAI_API_KEY: 'synthetic-offline-placeholder' };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden by offline test.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { POST } = await import('../app/api/sites/[siteId]/website-composition/route');
    const site = initialSite('general', 'Synthetic route publisher', 'composition-route');
    await withDatabase(db => { db.sites = [site]; });
    const before = await withDatabase(db => structuredClone(db)), origin = 'http://127.0.0.1:3220';
    const send = (body: unknown, options: { siteId?: string; origin?: string; contentType?: string; raw?: boolean; signal?: AbortSignal } = {}) => POST(new Request(`${origin}/api/sites/${options.siteId ?? site.id}/website-composition`, {
      method: 'POST', headers: { origin: options.origin ?? origin, 'content-type': options.contentType ?? 'application/json' }, body: options.raw ? String(body) : JSON.stringify(body), signal: options.signal,
    }), { params: Promise.resolve({ siteId: options.siteId ?? site.id }) });
    const input = { revision: site.revision, mode: 'local' };
    const response = await send(input), result = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(result.mode, 'local');
    assert.equal(result.plan.version, 1); assert.ok(result.plan.snapshot.contentBinding);
    assert.equal((await send(input, { origin: 'https://foreign.example' })).status, 403);
    assert.equal((await send(input, { siteId: randomUUID() })).status, 404);
    assert.equal((await send(input, { siteId: 'invalid-site' })).status, 400);
    assert.equal((await send(input, { contentType: 'text/plain' })).status, 415);
    assert.equal((await send('{broken', { raw: true })).status, 400);
    assert.equal((await send({ ...input, model: 'untrusted-model' })).status, 400);
    assert.equal((await send({ ...input, revision: 0.5 })).status, 400);
    assert.equal((await send({ ...input, revision: site.revision + 1 })).status, 409);
    assert.equal((await send({ ...input, mode: 'openai' })).status, 400);
    assert.equal((await send('x'.repeat(1025), { raw: true })).status, 413);
    assert.equal((await send(input, { signal: AbortSignal.abort() })).status, 499);
    const ai = await send({ ...input, mode: 'ai' }); assert.equal(ai.status, 503); assert.match((await ai.json()).error, /local proposal/);
    assert.equal(network.mock.callCount(), 0); assert.deepEqual(await withDatabase(db => structuredClone(db)), before);
  } finally { process.env = environment; await rm(directory, { recursive: true, force: true }); }
});
