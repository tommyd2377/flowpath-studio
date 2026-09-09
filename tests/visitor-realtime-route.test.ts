import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('session route rejects cross-origin, oversized, command-channel and demo requests before spending', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-session-route-'));
  const environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'openai', VOICE_DATA_DIR: directory, OPENAI_API_KEY: 'offline-placeholder' };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Network forbidden by offline test.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { POST } = await import('../app/api/visitor/[slug]/session/route');
    await withDatabase(db => {
      const site = initialSite('general', 'Synthetic voice', 'synthetic-voice');
      site.published = structuredClone(site.draft); db.sites = [site];
    });
    const origin = 'http://127.0.0.1:3220';
    const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
    const send = (body: unknown, from = origin) => POST(new Request(`${origin}/api/visitor/synthetic-voice/session`, {
      method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ slug: 'synthetic-voice' }) });
    assert.equal((await send({ requestId: randomUUID(), sdp }, 'https://foreign.example')).status, 403);
    assert.equal((await send({ requestId: randomUUID(), sdp: sdp + 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), sdp, model: 'untrusted-model' })).status, 400);
    assert.equal((await send({ requestId: randomUUID(), sdp: 'x'.repeat(70_000) })).status, 413);
    const demo = await send({ requestId: randomUUID(), sdp });
    assert.equal(demo.status, 503);
    assert.match((await demo.json()).error, /demo preview/);
    assert.equal(await withDatabase(db => db.visitorUsage), undefined);
    assert.equal(network.mock.callCount(), 0);
  } finally { process.env = environment; await rm(directory, { recursive: true, force: true }); }
});
