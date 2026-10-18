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
