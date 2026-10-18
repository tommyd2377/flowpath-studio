import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { createVoiceServer } from '../lib/voice-server';
import { voiceSessionConfig } from '../lib/voice-config';

const origin = 'http://127.0.0.1:3220';
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';
const tick = () => new Promise(resolve => setImmediate(resolve));

function request(method: string, body?: object, extra: RequestInit = {}) {
  return new Request(`${origin}/api/session`, {
    method, headers: { host: '127.0.0.1:3220', origin, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), ...extra,
  });
}

class FakeSocket extends EventEmitter {
  readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
  sent: Record<string, unknown>[] = [];
  finalize = true;
  constructor(readonly providerId: string, open = true) {
    super();
    if (!open) this.readyState = WebSocket.CONNECTING;
    queueMicrotask(() => this.emit(open ? 'open' : 'error', new Error('Synthetic error')));
  }
  send(text: string) {
    const event = JSON.parse(text);
    this.sent.push(event);
    if (event.type === 'session.close' && this.finalize) queueMicrotask(() => this.emit('message', JSON.stringify({
      type: 'session.closed', session: { id: this.providerId }, usage: { seconds: 4 },
    })));
  }
  terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  event(event: object) { this.emit('message', JSON.stringify(event)); }
}

function harness(extra: Parameters<typeof createVoiceServer>[0] = {}) {
  const calls: { url: string; options: RequestInit }[] = [];
  const sockets: FakeSocket[] = [];
  const server = createVoiceServer({
    enabled: () => true, apiKey: () => 'synthetic-key', closeMs: 10,
    requestProvider: (async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith('/hangup')) return new Response(null, { status: 200 });
      return Response.json({ session: { id: `live_synthetic_${calls.length}` }, transport: { type: 'webrtc', sdp } }, { status: 201 });
    }) as typeof fetch,
    socketFactory: url => {
      const socket = new FakeSocket(url.split('/').at(-2)!);
      sockets.push(socket);
      return socket;
    },
    ...extra,
  });
  return { server, calls, sockets };
}

function privateRequest(method: string, waveformId: string, body?: object, owner = 'owner-a') {
  return new Request(`${origin}/api/session?waveformId=${encodeURIComponent(waveformId)}`, {
    method, headers: { host: '127.0.0.1:3220', origin, 'content-type': 'application/json', 'x-test-owner': owner },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('private voice admission verifies ownership before reading a key or creating a provider session', async () => {
  const waveformId = randomUUID();
  const server = createVoiceServer({
    enabled: () => true,
    resolveWaveform: async () => null,
    apiKey: () => { throw new Error('Unauthorized requests must not read a key'); },
    requestProvider: () => { throw new Error('Unauthorized requests must not start voice'); },
  });
  assert.equal((await server.GET(privateRequest('GET', waveformId))).status, 403);
  assert.equal((await server.POST(privateRequest('POST', waveformId, { sessionId: randomUUID(), sdp }))).status, 403);
  assert.equal((await server.DELETE(privateRequest('DELETE', waveformId, { sessionId: randomUUID() }))).status, 403);
  assert.equal((await server.GET(privateRequest('GET', '../someone-else'))).status, 400);
});

test('saved instructions are loaded server-side per conversation and the personal greeting follows that identity', async () => {
  const waveformId = randomUUID();
  let initialPrompt = 'You are the synthetic library assistant. Keep replies short.';
  const { server, calls, sockets } = harness({
    resolveWaveform: async (req, id) => req.headers.get('x-test-owner') === 'owner-a' && id === waveformId
      ? { ownerUid: 'owner-a', waveform: { name: 'Library', initialPrompt }, isCurrent: () => true } : null,
  });
  const first = randomUUID();
  assert.equal((await server.POST(privateRequest('POST', waveformId, { sessionId: first, sdp }))).status, 201);
  const firstConfig = JSON.parse(String(calls[0].options.body)).session;
  assert.match(firstConfig.instructions, /synthetic library assistant/);
  assert.deepEqual(firstConfig.input, []);
  assert.equal(firstConfig.store, false);
  initialPrompt = 'You are the synthetic garden assistant.';
  assert.equal(sockets[0].sent.length, 0, 'editing settings sends no instructions into an active conversation');
  sockets[0].event({ type: 'session.started' });
  assert.match(String(sockets[0].sent[0].content), /saved waveform identity/);
  assert.equal((await server.DELETE(privateRequest('DELETE', waveformId, { sessionId: first }))).status, 200);
  const second = randomUUID();
  assert.equal((await server.POST(privateRequest('POST', waveformId, { sessionId: second, sdp }))).status, 201);
  assert.match(JSON.parse(String(calls[1].options.body)).session.instructions, /synthetic garden assistant/);
  assert.doesNotMatch(firstConfig.instructions, /garden assistant/);
  await server.DELETE(privateRequest('DELETE', waveformId, { sessionId: second }));
});

test('a private conversation cannot be closed anonymously or by another owner and logout confirms teardown', async () => {
  const waveformId = randomUUID(), otherId = randomUUID(), sessionId = randomUUID();
  const { server, calls } = harness({
    resolveWaveform: async (req, id) => {
      const owner = req.headers.get('x-test-owner');
      return (owner === 'owner-a' && id === waveformId) || (owner === 'owner-b' && id === otherId)
        ? { ownerUid: owner!, waveform: { name: 'Synthetic', initialPrompt: 'Keep it short.' }, isCurrent: () => true } : null;
    },
  });
  await server.POST(privateRequest('POST', waveformId, { sessionId, sdp }));
  assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 403);
  assert.equal((await server.DELETE(privateRequest('DELETE', waveformId, { sessionId }, 'owner-b'))).status, 403);
  assert.equal((await server.DELETE(privateRequest('DELETE', otherId, { sessionId }, 'owner-b'))).status, 403);
  assert.equal(await server.cancelOwner('owner-b'), true);
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, false, 'another owner cannot end the active session');
  assert.equal(await server.cancelOwner('owner-a'), true);
  assert.equal(calls.length, 1, 'confirmed logout cleanup makes no REST fallback request');
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, true);
});

test('logout during provider creation cancels late creation and blocks account switching until it closes', async () => {
  const waveformId = randomUUID(), sessionId = randomUUID();
  let release!: (response: Response) => void;
  const waiting = new Promise<Response>(resolve => { release = resolve; });
  const { server, calls } = harness({
    resolveWaveform: async () => ({ ownerUid: 'owner-a', waveform: { name: 'Synthetic', initialPrompt: 'Hello.' }, isCurrent: () => true }),
    requestProvider: (async () => waiting) as typeof fetch,
  });
  const pending = server.POST(privateRequest('POST', waveformId, { sessionId, sdp }));
  await tick();
  assert.equal(await server.cancelOwner('owner-a'), false);
  release(Response.json({ session: { id: 'live_late_owner' }, transport: { type: 'webrtc', sdp } }));
  assert.equal((await pending).status, 409);
  assert.equal(await server.cancelOwner('owner-a'), true);
  assert.equal(calls.length, 0, 'injected synthetic provider replaces all external traffic');
});

test('offline gate never reads a key, requests microphone work, or calls a provider', async () => {
  const server = createVoiceServer({ enabled: () => false,
    apiKey: () => { throw new Error('Key must not be read'); },
    requestProvider: () => { throw new Error('No provider'); },
  });
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, false);
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 503);
});

test('localhost and origin protection reject remote or cross-origin requests', async () => {
  const { server, calls } = harness();
  assert.equal((await server.GET(new Request('https://flowpathapp.com/api/session', { headers: { host: 'flowpathapp.com' } }))).status, 403);
  const headerSets: Record<string, string>[] = [
    { host: '127.0.0.1:3220', origin: 'http://attacker.example' },
    { host: '127.0.0.1:3220' },
    { host: 'attacker.example', origin },
    { host: '127.0.0.1:3220', origin, 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of headerSets) assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }, { headers }))).status, 403);
  assert.equal(calls.length, 0);
});

test('Next normalized loopback URLs retain the browser host origin and exact port', async () => {
  const server = createVoiceServer({ enabled: () => false });
  const headers = { host: '127.0.0.1:3220', origin, 'content-type': 'application/json' };
  const readiness = await server.GET(new Request('http://localhost:3220/api/session', { headers }));
  assert.equal(readiness.status, 200);
  assert.equal((await readiness.json()).enabled, false);
  assert.equal((await server.POST(new Request('http://localhost:3220/api/session', {
    method: 'POST', headers, body: JSON.stringify({ sessionId: randomUUID(), sdp }),
  }))).status, 503);
  assert.equal((await server.GET(new Request('http://localhost:3225/api/session', { headers }))).status, 403);
});

test('create sends one audio-only GPT-Live request with no backend, tools, or history', async () => {
  const { server, calls, sockets } = harness();
  const sessionId = randomUUID();
  const response = await server.POST(request('POST', { sessionId, sdp }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.sessionId, sessionId);
  assert.equal(body.sdp, sdp);
  assert.equal(typeof body.expiresAt, 'number');
  assert.equal(JSON.stringify(body).includes('live_synthetic'), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/live/sessions');
  assert.deepEqual(JSON.parse(String(calls[0].options.body)), {
    session: voiceSessionConfig(), transport: { type: 'webrtc', sdp },
  });
  assert.deepEqual(voiceSessionConfig().delegation, { type: 'client' });
  assert.deepEqual(voiceSessionConfig().client.data_channel.allowed_client_events, ['session.close']);
  sockets[0].event({ type: 'session.started' });
  sockets[0].event({ type: 'session.started' });
  assert.equal(sockets[0].sent.filter(event => event.event_id === 'flowpath_greeting').length, 1);
  assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 200);
  assert.equal(calls.length, 1, 'confirmed sideband close needs no REST fallback');
});

test('SDP, request size, local UUID, and extra-field validation prevent paid creation', async () => {
  const { server, calls } = harness();
  for (const body of [
    { sessionId: randomUUID(), sdp: `${sdp}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n` },
    { sessionId: 'live_provider_id', sdp },
    { sessionId: randomUUID(), sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' },
    { sessionId: randomUUID(), sdp: `${sdp}${'a'.repeat(70_000)}` },
    { sessionId: randomUUID(), sdp, model: 'anything' },
  ]) assert.equal((await server.POST(request('POST', body))).status, 400);
  assert.equal(calls.length, 0);
});

test('one active conversation and three starts per minute bound this local process', async () => {
  const { server, calls } = harness({ now: () => 100_000, maxStarts: 10 });
  for (let i = 0; i < 3; i++) {
    const sessionId = randomUUID();
    assert.equal((await server.POST(request('POST', { sessionId, sdp }))).status, 201);
    assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 409);
    assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 200);
    assert.equal((await server.POST(request('POST', { sessionId, sdp }))).status, 409);
  }
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 429);
  assert.equal(calls.length, 3);
});

test('unexpected delegation has one deterministic unavailable reply and no backend call', async () => {
  const { server, calls, sockets } = harness();
  const sessionId = randomUUID();
  await server.POST(request('POST', { sessionId, sdp }));
  const event = { type: 'session.delegation.created', delegation: { id: 'delegation_synthetic', target: 'client' } };
  sockets[0].event(event); sockets[0].event(event);
  assert.equal(sockets[0].sent.length, 1);
  assert.equal(sockets[0].sent[0].type, 'session.commentary.append');
  assert.equal(sockets[0].sent[0].delegation_id, 'delegation_synthetic');
  assert.match(String(sockets[0].sent[0].content), /unavailable/);
  assert.equal(calls.length, 1);
  await server.DELETE(request('DELETE', { sessionId }));
});

test('the live test budget counts starts across minutes and includes failed attempts', async () => {
  let time = 100_000;
  const { server, calls } = harness({ now: () => time, maxStarts: 2 });
  for (let i = 0; i < 2; i++) {
    const sessionId = randomUUID();
    assert.equal((await server.POST(request('POST', { sessionId, sdp }))).status, 201);
    assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 200);
    time += 61_000;
  }
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, false);
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 429);
  assert.equal(calls.length, 2);

  let failures = 0;
  const failed = harness({ maxStarts: 1, requestProvider: (async () => {
    failures++;
    return new Response(null, { status: 400 });
  }) as typeof fetch });
  assert.equal((await failed.server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 502);
  assert.equal((await failed.server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 429);
  assert.equal(failures, 1);
});

test('cancel during creation keeps the late provider ID for confirmed teardown', async () => {
  let complete!: (value: Response) => void;
  const { server, calls } = harness({ requestProvider: (async (url, options) => {
    calls.push({ url: String(url), options: options ?? {} });
    return new Promise<Response>(resolve => { complete = resolve; });
  }) as typeof fetch });
  const sessionId = randomUUID();
  const start = server.POST(request('POST', { sessionId, sdp }));
  await tick();
  assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 202);
  complete(Response.json({ session: { id: 'live_late' }, transport: { type: 'webrtc', sdp } }, { status: 201 }));
  assert.equal((await start).status, 409);
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, true);
  assert.equal(calls.length, 1);
});

test('cancel arriving before POST leaves a tombstone without starting a provider', async () => {
  const { server, calls } = harness();
  const sessionId = randomUUID();
  await server.DELETE(request('DELETE', { sessionId }));
  assert.equal((await server.POST(request('POST', { sessionId, sdp }))).status, 409);
  assert.equal(calls.length, 0);
});

test('aborted browser creation also closes the late provider session', async () => {
  let complete!: (value: Response) => void;
  const { server, sockets } = harness({ requestProvider: (() => new Promise<Response>(resolve => { complete = resolve; })) as typeof fetch });
  const controller = new AbortController();
  const start = server.POST(request('POST', { sessionId: randomUUID(), sdp }, { signal: controller.signal }));
  await tick(); controller.abort();
  complete(Response.json({ session: { id: 'live_late_abort' }, transport: { type: 'webrtc', sdp } }, { status: 201 }));
  assert.equal((await start).status, 409);
  assert.equal(sockets[0].sent[0].type, 'session.close');
});

test('missing final event triggers one fallback and blocks future starts', async () => {
  const { server, calls, sockets } = harness();
  const sessionId = randomUUID();
  await server.POST(request('POST', { sessionId, sdp }));
  sockets[0].finalize = false;
  assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 503);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /live_synthetic_1\/hangup$/);
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, false);
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 503);
  assert.equal(calls.length, 2);
});

test('ambiguous creation and sideband failure both fail closed without retrying', async () => {
  const missing = harness({ requestProvider: (async () => { throw new Error('Synthetic timeout'); }) as typeof fetch });
  assert.equal((await missing.server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 502);
  assert.equal((await (await missing.server.GET(request('GET'))).json()).enabled, false);
  const { server, calls } = harness({ socketFactory: url => new FakeSocket(url.split('/').at(-2)!, false) });
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 502);
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, false);
  assert.equal(calls.length, 2);
});

test('server absolute cap closes a lost browser without requiring another HTTP request', async () => {
  const { server, sockets } = harness({ sessionMs: 10 });
  await server.POST(request('POST', { sessionId: randomUUID(), sdp }));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(sockets[0].sent.some(event => event.type === 'session.close'));
  assert.equal((await (await server.GET(request('GET'))).json()).enabled, true);
});

test('a failed REST teardown stays blocked and is not automatically retried', async () => {
  let creates = 0, hangups = 0;
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'synthetic-key', closeMs: 1,
    requestProvider: (async url => {
      if (String(url).endsWith('/hangup')) { hangups++; throw new Error('Synthetic hangup failure'); }
      creates++;
      return Response.json({ session: { id: 'live_failed_hangup' }, transport: { type: 'webrtc', sdp } }, { status: 201 });
    }) as typeof fetch,
    socketFactory: () => { const socket = new FakeSocket('live_failed_hangup'); socket.finalize = false; return socket; },
  });
  const sessionId = randomUUID();
  assert.equal((await server.POST(request('POST', { sessionId, sdp }))).status, 201);
  assert.equal((await server.DELETE(request('DELETE', { sessionId }))).status, 503);
  assert.equal((await server.POST(request('POST', { sessionId: randomUUID(), sdp }))).status, 503);
  await server.DELETE(request('DELETE', { sessionId }));
  assert.equal(creates, 1);
  assert.equal(hangups, 1);
});
