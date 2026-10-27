import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import WebSocket from 'ws';
import { createAccountServer } from '../lib/account-server';
import { createVoiceServer } from '../lib/voice-server';

const origin = 'http://127.0.0.1:3220';
const headers = { host: '127.0.0.1:3220', origin, 'content-type': 'application/json' };
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';

function request(path: string, method: string, body?: object, cookie?: string) {
  return new Request(`${origin}/api/${path}`, {
    method, headers: { ...headers, ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

class FakeSocket extends EventEmitter {
  readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
  constructor() {
    super();
    queueMicrotask(() => this.emit('open'));
  }
  send(text: string) {
    if (JSON.parse(text).type === 'session.close') queueMicrotask(() => this.emit('message', JSON.stringify({
      type: 'session.closed', session: { id: 'live_synthetic' }, usage: { seconds: 0 },
    })));
  }
  terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
}

for (const change of ['sign-out', 'account switch'] as const) for (const phase of ['after cleanup', 'during cleanup'] as const) {
  test(`a delayed private voice request cannot start ${phase} of ${change}`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'flowpath-account-voice-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    let providerCalls = 0;
    let ownershipResolved!: () => void;
    const resolved = new Promise<void>(resolve => { ownershipResolved = resolve; });
    let cleanupStarted!: () => void;
    const cleaning = new Promise<void>(resolve => { cleanupStarted = resolve; });
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>(resolve => { finishCleanup = resolve; });
    const accounts = createAccountServer({
      mode: 'local', development: () => true, localDirectory: directory,
      beforeAccountChange: async owner => {
        const closed = await server.cancelOwner(owner.uid);
        if (phase === 'during cleanup') { cleanupStarted(); await cleanup; }
        return closed;
      },
    });
    const server = createVoiceServer({
      enabled: () => true, apiKey: () => 'synthetic-key',
      resolveWaveform: async (req, id) => {
        const result = await accounts.resolveVoiceWaveform(req, id);
        ownershipResolved();
        return result;
      },
      requestProvider: (async () => {
        providerCalls++;
        return Response.json({ session: { id: 'live_synthetic' }, transport: { type: 'webrtc', sdp } }, { status: 201 });
      }) as typeof fetch,
      socketFactory: () => new FakeSocket(),
    });
    t.after(async () => { await server.cancelOwner('local-owner-a'); });
    const login = await accounts.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }));
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const saved = await accounts.waveformPUT(request('waveform', 'PUT', {
      name: 'Synthetic owner', initialPrompt: 'Keep replies concise.',
    }, cookie));
    const waveform = (await saved.json()).waveform;
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; } });
    const pending = server.POST(new Request(`${origin}/api/session?waveformId=${waveform.id}`, {
      method: 'POST', headers: { ...headers, cookie }, body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' }));
    await resolved;

    const changing = change === 'sign-out'
      ? accounts.accountDELETE(request('account', 'DELETE', undefined, cookie))
      : accounts.accountPOST(request('account', 'POST', { localAccount: 'owner-b' }, cookie));
    if (phase === 'during cleanup') await cleaning;
    else await changing;
    let response: Response;
    try {
      bodyController.enqueue(new TextEncoder().encode(JSON.stringify({ sessionId: randomUUID(), sdp })));
      bodyController.close();
      response = await pending;
    } finally { finishCleanup(); }

    const changed = await changing;
    assert.equal(changed.status, 200);
    assert.equal(await accounts.resolveOwner(request('account', 'GET', undefined, cookie)), null);
    assert.equal(response.status, 403);
    assert.equal(providerCalls, 0, 'revoked account sessions must not create a provider conversation');
    if (change === 'account switch') {
      const nextCookie = changed.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await accounts.resolveOwner(request('account', 'GET', undefined, nextCookie)))?.uid, 'local-owner-b');
    }
  });
}

test('a signed-in owner receives a review action instead of a false sign-in error; direct starts stay blocked', async t => {
  const { CreationSafetyError } = await import('../lib/creation-safety');
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-owner-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let needsReview = true, reviewsChecked = 0, providerCalls = 0;
  const accounts = createAccountServer({ mode: 'local', development: () => true, localDirectory: directory,
    checkWaveform: async () => { reviewsChecked++; if (needsReview) throw new CreationSafetyError('Exact version needs review'); } });
  const login = await accounts.accountPOST(request('account', 'POST', { localAccount: 'owner-a' }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const saved = await accounts.waveformPUT(request('waveform', 'PUT', { name: 'Franklin fixture', initialPrompt: 'A historical character.' }, cookie));
  const waveform = (await saved.json()).waveform;
  const voice = createVoiceServer({ enabled: () => true, apiKey: () => 'fixture',
    resolveWaveform: (req, id) => accounts.resolveVoiceWaveform(req, id, 'voice'),
    requestProvider: (async () => { providerCalls++; throw new Error('Must not start'); }) as typeof fetch });
  assert.equal((await accounts.waveformGET(request('waveform', 'GET', undefined, cookie))).status, 200);
  for (const method of ['GET', 'POST']) {
    const response = await voice[method as 'GET' | 'POST'](request(`session?waveformId=${waveform.id}`, method, method === 'POST' ? { sessionId: randomUUID(), sdp } : undefined, cookie));
    assert.equal(response.status, 409); const body = await response.json();
    assert.equal(body.reviewRequired, true); assert.match(body.error, /approved safety review/); assert.doesNotMatch(body.error, /Sign in/);
  }
  assert.equal(providerCalls, 0);
  const checked = reviewsChecked;
  const wrongId = await voice.GET(request(`session?waveformId=${randomUUID()}`, 'GET', undefined, cookie));
  assert.equal(wrongId.status, 403); assert.equal((await wrongId.json()).reviewRequired, undefined); assert.equal(reviewsChecked, checked);
  const cleanup = await voice.DELETE(request(`session?waveformId=${waveform.id}`, 'DELETE', { sessionId: randomUUID() }, cookie));
  assert.equal(cleanup.status, 200);
  needsReview = false;
  assert.equal((await (await voice.GET(request(`session?waveformId=${waveform.id}`, 'GET', undefined, cookie))).json()).enabled, true);
  assert.equal((await accounts.resolveOwner(request('account', 'GET', undefined, cookie)))?.uid, 'local-owner-a');
});
