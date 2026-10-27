import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { createVoiceServer } from '../lib/voice-server';
import { createProductionVoiceStore, UNMETERED_LOCAL_DEADLINE, type VoiceDatabase, type VoiceOwner, type VoicePolicy, type VoiceTransaction } from '../lib/production-voice-store';
import { PUBLIC_VOICE_COOKIE, PUBLIC_VOICE_SECONDS, publicVoiceOwner } from '../lib/public-voice-identity';
import { PUBLIC_GREETING_INSTRUCTIONS } from '../lib/voice-config';

const origin = 'https://voice.example';
const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const owner: VoiceOwner = { ownerUid: 'synthetic-owner', waveformId: randomUUID(), accountSessionId: 'synthetic-account-hash' };
const policy: VoicePolicy = { ownerDailySeconds: 9_000, globalDailySeconds: 18_000, globalConcurrency: 2, access: 'signed-in', allowedUids: [] };
const request = (method: string, id?: string, personal = true, signal?: AbortSignal) => new Request(
  `http://internal/api/session${personal ? `?waveformId=${owner.waveformId}` : ''}`, {
    method, headers: { host: 'voice.example', origin, 'content-type': 'application/json' }, signal,
    ...(method === 'GET' ? {} : { body: JSON.stringify({ sessionId: id, ...(method === 'POST' ? { sdp } : {}) }) }),
  },
);
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(finalize = true) {
  let shouldFinalize = finalize;
  let now = 100_000;
  let rows = new Map<string, Record<string, unknown>>([
    [`ownerSessions/${owner.accountSessionId}`, { uid: owner.ownerUid, state: 'active', expiresAt: 100_000_000 }],
  ]);
  let pending = Promise.resolve();
  const reads: string[] = [];
  const database: VoiceDatabase = {
    async transaction<T>(work: (tx: VoiceTransaction) => Promise<T>) {
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const next = structuredClone(rows);
      try {
        const result = await work({ get: async path => { reads.push(path); return next.get(path) ?? null; }, set: (path, value) => { next.set(path, structuredClone(value) as Record<string, unknown>); } });
        rows = next;
        return result;
      } finally { release(); }
    },
  };
  const store = createProductionVoiceStore(database, () => now);
  const sockets = new Set<SyntheticSocket>();
  const sent: Record<string, unknown>[] = [];
  class SyntheticSocket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor(readonly id: string) { super(); queueMicrotask(() => this.emit('open')); }
    send(text: string) {
      const event = JSON.parse(text);
      sent.push(event);
      if (event.type === 'session.close' && shouldFinalize) queueMicrotask(() => {
        for (const socket of sockets) if (socket.id === this.id) socket.emit('message', Buffer.from(JSON.stringify({
          type: 'session.closed', session: { id: this.id }, usage: { seconds: 2.5 },
        })));
      });
    }
    terminate() { sockets.delete(this); this.readyState = WebSocket.CLOSED; }
  }
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const scheduled: { id: string; expiresAt: number }[] = [];
  const options = {
    publicOrigin: origin, enabled: () => true, apiKey: () => 'synthetic-server-key', now: () => now,
    resolveWaveform: async () => ({ ...owner, waveform: { name: 'Synthetic', initialPrompt: 'Keep it short.' }, isCurrent: async () => true }),
    production: { store, policy: () => policy, scheduleDeadline: async (id: string, expiresAt: number) => { scheduled.push({ id, expiresAt }); } },
    requestProvider: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url));
      if (init?.body) payloads.push(JSON.parse(String(init.body)));
      return Response.json({ session: { id: `live_synthetic_${calls.length}` }, transport: { type: 'webrtc', sdp } }, { status: 201 });
    }) as typeof fetch,
    socketFactory: (url: string) => { const socket = new SyntheticSocket(url.split('/').at(-2)!); sockets.add(socket); return socket; },
  };
  return { options, store, calls, scheduled, database, reads, payloads, sent,
    started: () => { for (const socket of sockets) socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.started' }))); },
    rows: () => rows, advance: (ms: number) => { now += ms; },
    setFinalization: (value: boolean) => { shouldFinalize = value; } };
}

const visitorToken = 'a'.repeat(64);
function visitorRequest(method: string, id?: string, token = visitorToken, personal = false, page?: string) {
  const req = request(method, id, personal);
  const headers = new Headers(req.headers);
  headers.set('cookie', `${PUBLIC_VOICE_COOKIE}=${token}`);
  if (page !== undefined) headers.set('X-FlowPath-Demo', page);
  return new Request(req, { headers });
}
function visitorFixture(overrides: Partial<VoicePolicy> = {}) {
  const f = fixture();
  let currentPolicy: VoicePolicy = { ...policy, globalDailySeconds: 3_600, publicDemoSeconds: PUBLIC_VOICE_SECONDS, ...overrides };
  let privateLookups = 0;
  const options = { ...f.options, resolvePublicVisitor: publicVoiceOwner,
    resolveWaveform: async () => { privateLookups++; return null; },
    production: { ...f.options.production, policy: () => currentPolicy } };
  return { ...f, options, privateLookups: () => privateLookups,
    disableDemo: () => { currentPolicy = { ...policy, globalDailySeconds: 3_600 }; } };
}

test('the homepage stays paused without public admission and an incomplete policy reads no key', async () => {
  const f = fixture();
  const server = createVoiceServer({ ...f.options, apiKey: () => { throw new Error('Key must not be read'); }, production: { ...f.options.production, policy: () => null } });
  const home = await (await server.GET(request('GET', undefined, false))).json();
  assert.equal(home.enabled, false);
  assert.match(home.message, /Sign in/);
  assert.equal((await server.POST(request('POST', randomUUID(), false))).status, 403);
  assert.equal((await server.POST(request('POST', randomUUID()))).status, 503);
  assert.equal(f.calls.length, 0);
});

test('paid cleanup waits for connection persistence and never confirms settlement after a ledger failure', async () => {
  const f = fixture(), id = randomUUID();
  let connected!: () => void, failSettlement = true, settlements = 0;
  const persisted = new Promise<void>(resolve => { connected = resolve; });
  const options = { ...f.options, requireSettlement: true, connected: () => persisted,
    production: { ...f.options.production, store: { ...f.store, finish: async (...args: Parameters<typeof f.store.finish>) => {
      settlements++; if (failSettlement) throw new Error('Synthetic ledger outage'); return f.store.finish(...args);
    } } } };
  const server = createVoiceServer(options);
  assert.equal((await server.POST(request('POST', id))).status, 201);
  f.started();
  const cleanup = server.DELETE(request('DELETE', id)); await tick();
  assert.equal(settlements, 0);
  connected();
  assert.equal((await cleanup).status, 202);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'active');
  failSettlement = false;
  assert.equal(await createVoiceServer(options).cancelReservation(id, owner.ownerUid, owner.waveformId), true);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
});

test('public voice requires its existing visitor cookie before admission and never looks up Firebase identity', async () => {
  const f = visitorFixture();
  const server = createVoiceServer({ ...f.options, apiKey: () => { throw new Error('Missing cookies must not read a key'); } });
  const home = await (await server.GET(request('GET', undefined, false))).json();
  assert.equal(home.enabled, false);
  assert.match(home.message, /cookies/i);
  assert.equal((await server.POST(request('POST', randomUUID(), false))).status, 403);
  assert.equal((await server.DELETE(request('DELETE', randomUUID(), false))).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal(f.scheduled.length, 0);
  assert.equal(f.privateLookups(), 0);
  assert.equal(f.reads.length, 0);
});

test('a public visitor receives the welcome prompt and a durable three-minute deadline without Firebase auth', async () => {
  const f = visitorFixture(), id = randomUUID();
  const server = createVoiceServer(f.options);
  const ready = await (await server.GET(visitorRequest('GET'))).json();
  assert.equal(ready.enabled, true);
  const response = await server.POST(visitorRequest('POST', id));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).expiresAt, 280_000);
  assert.deepEqual(f.scheduled, [{ id, expiresAt: 280_000 }]);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.kind, 'visitor');
  assert.equal(f.rows().get('voiceAdmission/global')?.reservedSeconds, 180);
  const config = f.payloads[0].session as { instructions: string };
  assert.match(config.instructions, /FlowPath Studio/);
  assert.doesNotMatch(config.instructions, /owner's waveform named|Keep it short/);
  f.started();
  const greeting = f.sent.find(event => event.event_id === 'flowpath_greeting');
  assert.equal(greeting?.content, PUBLIC_GREETING_INSTRUCTIONS);
  assert.equal(f.privateLookups(), 0);
  assert.equal(f.reads.some(path => path.startsWith('ownerSessions/')), false);
  f.advance(180_000);
  assert.equal(await server.expireReservation(id), true);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  assert.equal((await server.DELETE(visitorRequest('DELETE', id))).status, 200);
  assert.equal((await server.POST(visitorRequest('POST', randomUUID()))).status, 429, 'one visitor receives one three-minute reservation per day');
  assert.equal(f.calls.length, 1);
});

test('refreshing preserves the three-minute visitor allowance while separate visitors share global limits', async () => {
  const f = visitorFixture({ globalDailySeconds: 360, globalConcurrency: 1 });
  const server = createVoiceServer(f.options);
  const firstPage = randomUUID(), nextPage = randomUUID(), firstCall = randomUUID(), nextCall = randomUUID();
  const onPage = (page: string, method: string, id?: string) => visitorRequest(method, id, visitorToken, false, page);
  assert.equal((await server.POST(onPage(firstPage, 'POST', firstCall))).status, 201);
  assert.equal(f.scheduled[0].expiresAt - 100_000, 180_000);
  assert.equal((await server.POST(onPage(nextPage, 'POST', randomUUID()))).status, 409, 'refreshing cannot bypass shared concurrency');
  assert.equal((await server.DELETE(onPage(nextPage, 'DELETE', firstCall))).status, 403, 'a refreshed page cannot close a different page identity');
  assert.equal((await server.DELETE(onPage(firstPage, 'DELETE', firstCall))).status, 200);
  const usedPage = await (await server.GET(onPage(firstPage, 'GET'))).json();
  assert.equal(usedPage.enabled, false);
  assert.match(usedPage.message, /three-minute demo allowance has ended/);
  assert.equal((await server.POST(onPage(firstPage, 'POST', randomUUID()))).status, 429, 'the same page cannot start another allowance');
  const nextInstance = createVoiceServer(f.options);
  assert.equal((await (await nextInstance.GET(onPage(nextPage, 'GET'))).json()).enabled, false);
  assert.equal((await nextInstance.POST(onPage(nextPage, 'POST', nextCall))).status, 429);
  assert.equal(f.rows().get('voiceAdmission/global')?.reservedSeconds, 180);
  const secondVisitor = (method: string) => visitorRequest(method, nextCall, 'b'.repeat(64), false, nextPage);
  assert.equal((await nextInstance.POST(secondVisitor('POST'))).status, 201);
  assert.equal((await nextInstance.DELETE(secondVisitor('DELETE'))).status, 200);
  for (const page of [firstPage, randomUUID()]) {
    const exhaustedGlobal = await (await nextInstance.GET(onPage(page, 'GET'))).json();
    assert.equal(exhaustedGlobal.enabled, false);
    assert.equal(exhaustedGlobal.message, 'The shared daily voice limit has been reached. Please try again tomorrow.');
  }
  const before = structuredClone(f.rows());
  assert.equal((await server.POST(onPage(randomUUID(), 'POST', randomUUID()))).status, 429, 'fresh pages still consume the original finite global budget');
  assert.equal(f.rows().get('voiceAdmission/global')?.reservedSeconds, 360);
  assert.deepEqual(f.rows(), before);
  assert.equal(f.calls.length, 2);
  assert.equal(f.reads.some(path => path.startsWith('ownerSessions/')), false);
});

test('legacy no-header public calls retain cleanup authority without granting it to a new page', async () => {
  const f = visitorFixture(), legacyId = randomUUID(), page = randomUUID(), pageId = randomUUID();
  const server = createVoiceServer(f.options);
  assert.equal((await server.POST(visitorRequest('POST', legacyId))).status, 201);
  assert.equal((await server.DELETE(visitorRequest('DELETE', legacyId, visitorToken, false, page))).status, 403);
  assert.equal((await server.DELETE(visitorRequest('DELETE', legacyId))).status, 200);
  assert.equal((await server.POST(visitorRequest('POST', pageId, visitorToken, false, page))).status, 429, 'legacy cookie cannot refresh its allowance');
  const secondToken = 'b'.repeat(64);
  assert.equal((await server.POST(visitorRequest('POST', pageId, secondToken, false, page))).status, 201);
  assert.equal((await server.DELETE(visitorRequest('DELETE', pageId, secondToken))).status, 403);
  assert.equal((await server.DELETE(visitorRequest('DELETE', pageId, secondToken, false, page))).status, 200);
  assert.equal(f.calls.length, 2);
});

test('invalid public page headers cannot admit, cancel or read a provider key', async () => {
  const f = visitorFixture();
  const server = createVoiceServer({ ...f.options, apiKey: () => { throw new Error('Invalid page must not read a key'); } });
  for (const page of ['', 'not-a-uuid', `${randomUUID()}, ${randomUUID()}`]) {
    const ready = await (await server.GET(visitorRequest('GET', undefined, visitorToken, false, page))).json();
    assert.equal(ready.enabled, false);
    assert.equal((await server.POST(visitorRequest('POST', randomUUID(), visitorToken, false, page))).status, 403);
    assert.equal((await server.DELETE(visitorRequest('DELETE', randomUUID(), visitorToken, false, page))).status, 403);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.scheduled.length, 0);
  assert.equal(f.reads.length, 0);
});

test('public visitors cannot use a private waveform or cancel another visitor or member conversation', async () => {
  const f = visitorFixture(), publicId = randomUUID();
  const server = createVoiceServer(f.options);
  assert.equal((await server.GET(visitorRequest('GET', undefined, visitorToken, true))).status, 403);
  assert.equal((await server.POST(visitorRequest('POST', randomUUID(), visitorToken, true))).status, 403);
  assert.equal((await server.POST(visitorRequest('POST', publicId))).status, 201);
  assert.equal((await server.DELETE(visitorRequest('DELETE', publicId, 'b'.repeat(64)))).status, 403);
  assert.equal(f.rows().get(`voiceConversations/${publicId}`)?.state, 'active');
  assert.equal((await server.DELETE(visitorRequest('DELETE', publicId))).status, 200);
  const memberId = randomUUID();
  const memberServer = createVoiceServer({ ...f.options, resolveWaveform: async () => ({
    ...owner, waveform: { name: 'Private owner', initialPrompt: 'Private instructions.' }, isCurrent: () => true,
  }) });
  assert.equal((await memberServer.POST(request('POST', memberId))).status, 201);
  assert.equal((await server.DELETE(visitorRequest('DELETE', memberId))).status, 403);
  assert.equal(f.rows().get(`voiceConversations/${memberId}`)?.state, 'active');
  assert.equal((await memberServer.DELETE(request('DELETE', memberId))).status, 200);
  assert.equal(f.calls.length, 2);
});

test('a visitor can close its conversation after public starts are disabled', async () => {
  const f = visitorFixture(), id = randomUUID();
  const server = createVoiceServer(f.options);
  assert.equal((await server.POST(visitorRequest('POST', id))).status, 201);
  f.disableDemo();
  const readiness = await (await server.GET(visitorRequest('GET'))).json();
  assert.equal(readiness.enabled, false);
  assert.match(readiness.message, /paused/i);
  assert.equal((await server.POST(visitorRequest('POST', randomUUID()))).status, 503);
  assert.equal((await server.DELETE(visitorRequest('DELETE', id))).status, 200);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  assert.equal(f.calls.length, 1);
});

test('public cancellation before creation preserves the visitor tombstone without a provider start', async () => {
  const f = visitorFixture(), id = randomUUID();
  const server = createVoiceServer(f.options);
  assert.equal((await server.DELETE(visitorRequest('DELETE', id))).status, 200);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.kind, 'visitor');
  assert.equal(f.rows().get('voiceAdmission/global')?.reservedSeconds, 180);
  assert.equal((await server.POST(visitorRequest('POST', id))).status, 409);
  assert.equal(f.calls.length, 0);
});

test('voice readiness, admission and closure share the explicit proxy host guard', async () => {
  const f = fixture(), id = randomUUID();
  const proxyHost = 'synthetic-backend-123456.us-east4.run.app';
  const server = createVoiceServer({ ...f.options, trustedProxyHost: proxyHost });
  const forwarded = (method: string, changes: Record<string, string> = {}) => {
    const req = request(method, id);
    const headers = new Headers(req.headers);
    headers.set('host', proxyHost);
    headers.set('x-forwarded-host', 'voice.example');
    for (const [name, value] of Object.entries(changes)) headers.set(name, value);
    return new Request(req, { headers });
  };
  const invalidHeaders: Record<string, string>[] = [
    { host: 'untrusted.run.app' }, { 'x-forwarded-host': '' },
    { 'x-forwarded-host': 'voice.example, voice.example' }, { 'x-forwarded-host': 'attacker.example' },
    { 'x-forwarded-host': 'https://voice.example' }, { origin: 'https://attacker.example' },
    { 'sec-fetch-site': 'cross-site' },
  ];
  for (const headers of invalidHeaders) {
    assert.equal((await server.GET(forwarded('GET', headers))).status, 403);
    assert.equal((await server.POST(forwarded('POST', headers))).status, 403);
    assert.equal((await server.DELETE(forwarded('DELETE', headers))).status, 403);
  }
  assert.equal(f.calls.length, 0, 'invalid forwarding never reaches the provider');
  assert.equal((await server.GET(forwarded('GET'))).status, 200);
  assert.equal((await server.POST(forwarded('POST'))).status, 201);
  assert.equal((await server.DELETE(forwarded('DELETE'))).status, 200);
  assert.equal(f.calls.length, 1);
});

test('production starts only after its durable deadline is scheduled and returns the admission deadline', async () => {
  const f = fixture(), id = randomUUID();
  const server = createVoiceServer({ ...f.options, requestProvider: (async (...args) => {
    assert.deepEqual(f.scheduled, [{ id, expiresAt: 1_000_000 }]);
    const reservation = f.rows().get(`voiceConversations/${id}`);
    assert.equal(reservation?.state, 'creating');
    f.advance(2_000);
    return f.options.requestProvider(...args);
  }) as typeof fetch });
  const response = await server.POST(request('POST', id));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.expiresAt, 1_000_000);
  assert.equal(body.providerId, undefined);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.providerId, 'live_synthetic_1');
  assert.doesNotMatch(JSON.stringify(f.rows().get(`voiceConversations/${id}`)), /synthetic-server-key|Keep it short|v=0|instructions|audio/);
  assert.equal((await server.DELETE(request('DELETE', id))).status, 200);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.seconds, 2.5);
});

test('deadline scheduling failure makes no provider call and does not return a connection', async () => {
  const f = fixture(), id = randomUUID();
  const server = createVoiceServer({ ...f.options, production: { ...f.options.production, scheduleDeadline: async () => { throw new Error('Synthetic scheduler unavailable'); } } });
  assert.equal((await server.POST(request('POST', id))).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'rejected');
  assert.equal(f.rows().get('voiceAdmission/global')?.reservedSeconds, 900);
});

test('a fresh instance can confirm another instance’s voice closure and sign-out cleanup', async () => {
  const f = fixture(), id = randomUUID();
  const first = createVoiceServer(f.options), second = createVoiceServer(f.options);
  assert.equal((await first.POST(request('POST', id))).status, 201);
  assert.equal(await second.cancelOwner(owner.ownerUid), true);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  assert.equal(f.calls.length, 1, 'cleanup attaches to the existing provider and never starts another');
  assert.equal((await (await first.GET(request('GET'))).json()).enabled, true);
});

test('an independent deadline closes a known orphan but never treats an unknown creation as closed', async () => {
  const f = fixture(), id = randomUUID();
  const first = createVoiceServer(f.options);
  await first.POST(request('POST', id));
  const fresh = createVoiceServer(f.options);
  assert.equal(await fresh.expireReservation(id), false, 'an early replay cannot close the call');
  f.advance(900_000);
  assert.equal(await fresh.expireReservation(id), true);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  const unknown = randomUUID();
  await f.store.reserve(owner, unknown, policy);
  f.advance(900_000);
  assert.equal(await createVoiceServer(f.options).expireReservation(unknown), false);
  assert.equal(f.rows().get(`voiceConversations/${unknown}`)?.state, 'uncertain');
  assert.equal(f.calls.length, 1);
});

test('ambiguous creation remains blocked after a server restart with no automatic retry', async () => {
  const f = fixture(), id = randomUUID();
  let attempts = 0;
  const server = createVoiceServer({ ...f.options, requestProvider: (async () => { attempts++; throw new Error('Synthetic network uncertainty'); }) as typeof fetch });
  assert.equal((await server.POST(request('POST', id))).status, 502);
  const fresh = createVoiceServer(f.options);
  const readiness = await (await fresh.GET(request('GET'))).json();
  assert.equal(readiness.enabled, false);
  assert.match(readiness.message, /confirmed cleanup/);
  assert.equal((await fresh.POST(request('POST', randomUUID()))).status, 503);
  assert.equal(attempts, 1);
  assert.equal(f.calls.length, 0);
});

test('account invalidation while scheduling prevents the paid creation', async () => {
  const f = fixture(), id = randomUUID();
  const server = createVoiceServer({ ...f.options, production: { ...f.options.production, scheduleDeadline: async () => {
    await f.database.transaction(async tx => { tx.set(`ownerSessions/${owner.accountSessionId}`, { uid: owner.ownerUid, state: 'changing', expiresAt: 100_000_000 }); });
  } } });
  assert.equal((await server.POST(request('POST', id))).status, 409);
  assert.equal(f.calls.length, 0);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'rejected');
});

test('provider-ID persistence failure still closes the known provider through confirmed finalization', async () => {
  const f = fixture(), id = randomUUID();
  const server = createVoiceServer({ ...f.options, production: { ...f.options.production, store: { ...f.store, created: async () => { throw new Error('Synthetic database failure'); } } } });
  assert.equal((await server.POST(request('POST', id))).status, 502);
  assert.equal(f.calls.length, 1, 'confirmed sideband cleanup needs no REST fallback');
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.seconds, 2.5);
});

test('failed initial provider-ID persistence retains the known ID through uncertain cleanup for a fresh deadline worker', async () => {
  const f = fixture(false), id = randomUUID();
  const first = createVoiceServer({ ...f.options, closeMs: 1, production: {
    ...f.options.production, store: { ...f.store, created: async () => { throw new Error('Synthetic database failure'); } },
  } });
  assert.equal((await first.POST(request('POST', id))).status, 502);
  const uncertain = f.rows().get(`voiceConversations/${id}`);
  assert.equal(uncertain?.state, 'uncertain');
  assert.equal(uncertain?.providerId, 'live_synthetic_1');
  assert.equal(f.calls.length, 2, 'one creation and one fallback hangup');
  f.advance(900_000);
  f.setFinalization(true);
  assert.equal(await createVoiceServer(f.options).expireReservation(id), true);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.seconds, 2.5);
  assert.equal(f.calls.length, 2, 'deadline recovery attaches to the known ID without another creation');
});

test('cross-instance cancellation during creation closes a late provider before returning SDP', async () => {
  const f = fixture(), id = randomUUID();
  let resolve!: (response: Response) => void;
  const pendingProvider = new Promise<Response>(done => { resolve = done; });
  const first = createVoiceServer({ ...f.options, requestProvider: (async () => pendingProvider) as typeof fetch });
  const pending = first.POST(request('POST', id));
  await tick();
  const second = createVoiceServer(f.options);
  assert.equal((await second.DELETE(request('DELETE', id))).status, 202);
  resolve(Response.json({ session: { id: 'live_late_synthetic' }, transport: { type: 'webrtc', sdp } }, { status: 201 }));
  assert.equal((await pending).status, 409);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'closed');
});

test('unconfirmed cross-instance teardown keeps durable blocking even after a REST acknowledgment', async () => {
  const f = fixture(false), id = randomUUID();
  const first = createVoiceServer({ ...f.options, closeMs: 1 });
  assert.equal((await first.POST(request('POST', id))).status, 201);
  const second = createVoiceServer({ ...f.options, closeMs: 1 });
  assert.equal(await second.cancelOwner(owner.ownerUid), false);
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.state, 'uncertain');
  assert.equal(f.rows().get(`voiceConversations/${id}`)?.seconds, undefined);
  assert.equal(f.calls.length, 2, 'one create plus one bounded REST hangup, without a new session');
  assert.match(f.calls[1], /\/hangup$/);
  const readiness = await (await createVoiceServer(f.options).GET(request('GET'))).json();
  assert.equal(readiness.enabled, false);
  assert.match(readiness.message, /confirmed cleanup/);
  // End the original synthetic control so its startup watchdog has no later work.
  await first.DELETE(request('DELETE', id));
});

test('admin headers cannot grant privileges and a normal public admin call retains the demo deadline', async () => {
  const f = fixture();
  const makeRequest = (method: string, id?: string, admin = false) => {
    const req = request(method, id, false);
    req.headers.set('cookie', `${PUBLIC_VOICE_COOKIE}=${'a'.repeat(64)}`);
    if (admin) req.headers.set('X-FlowPath-Admin', 'continue');
    return req;
  };
  const publicOptions = { ...f.options, resolvePublicVisitor: publicVoiceOwner,
    production: { ...f.options.production, policy: () => ({ ...policy, publicDemoSeconds: 180 }) } };
  const nonAdmin = createVoiceServer(publicOptions);
  assert.equal((await nonAdmin.GET(makeRequest('GET', undefined, true))).status, 403);
  assert.equal((await nonAdmin.POST(makeRequest('POST', randomUUID(), true))).status, 403);
  assert.equal(f.calls.length, 0);
  let testing = false;
  const admin = createVoiceServer({ ...publicOptions, resolveAdmin: async () => ({ uid: owner.ownerUid, accountSessionId: owner.accountSessionId, testing, isCurrent: () => true }) });
  assert.equal((await admin.GET(makeRequest('GET', undefined, true))).status, 403, 'a header cannot override the saved off setting');
  const id = randomUUID();
  const result = await (await admin.POST(makeRequest('POST', id))).json();
  assert.equal(result.adminEligible, true);
  assert.equal(result.adminOverride, false);
  assert.equal(result.expiresAt, 100_000 + 180_000);
  assert.equal(result.adminDeadline, 100_000 + 900_000);
  f.started();
  assert.equal((await admin.DELETE(makeRequest('DELETE', id))).status, 200);
  f.advance(180_000);
  const normal = await (await admin.GET(makeRequest('GET'))).json();
  assert.equal(normal.enabled, false);
  assert.equal(normal.adminLimit, true);
  testing = true;
  const resume = makeRequest('POST', randomUUID(), true);
  resume.headers.set('X-FlowPath-Continue', id);
  const resumed = await (await admin.POST(resume)).json();
  assert.equal(resumed.expiresAt, result.adminDeadline);
  assert.equal(resumed.adminOverride, true);
  f.started();
  const close = makeRequest('DELETE', resumed.sessionId, true);
  close.headers.set('X-FlowPath-Continue', id);
  assert.equal((await admin.DELETE(close)).status, 200);
});

test('saved admin testing starts a 15-minute public conversation directly with no privileged request header', async () => {
  const f = fixture();
  const server = createVoiceServer({ ...f.options, resolvePublicVisitor: publicVoiceOwner,
    resolveAdmin: async () => ({ uid: owner.ownerUid, accountSessionId: owner.accountSessionId, testing: true, isCurrent: () => true }),
    production: { ...f.options.production, policy: () => ({ ...policy, ownerDailySeconds: 1, publicDemoSeconds: 180 }) } });
  const req = request('POST', randomUUID(), false);
  req.headers.set('cookie', `${PUBLIC_VOICE_COOKIE}=${'b'.repeat(64)}`);
  const response = await server.POST(req);
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.adminOverride, true);
  assert.equal(result.expiresAt, 100_000 + 900_000);
  assert.equal(f.scheduled[0].expiresAt, result.expiresAt);
  f.started();
  const close = request('DELETE', result.sessionId, false);
  close.headers.set('cookie', req.headers.get('cookie')!);
  assert.equal((await server.DELETE(close)).status, 200);
});

test('normal durable admission does not inherit the old three-start development harness budget', async () => {
  const f = fixture();
  const server = createVoiceServer(f.options);
  for (let index = 0; index < 4; index++) {
    const id = randomUUID();
    assert.equal((await server.POST(request('POST', id))).status, 201);
    f.started();
    assert.equal((await server.DELETE(request('DELETE', id))).status, 200);
    f.advance(61_000);
  }
  assert.equal(f.calls.filter(url => url.endsWith('/live/sessions')).length, 4);
});

test('local unmetered founder starts have no restart throttle or app deadline and still close normally', async () => {
  const f = fixture();
  const server = createVoiceServer({ ...f.options,
    resolveAdmin: async () => ({ uid: owner.ownerUid, accountSessionId: owner.accountSessionId, testing: true, isCurrent: () => true }),
    production: { ...f.options.production, policy: () => ({ ...policy, globalDailySeconds: 900, unmeteredAdminTesting: true }) } });
  for (let index = 0; index < 5; index++) {
    const id = randomUUID();
    const response = await server.POST(request('POST', id));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).expiresAt, UNMETERED_LOCAL_DEADLINE);
    assert.equal(f.scheduled.length, 0, 'no local expiry task or overflowing timer is installed');
    f.started();
    assert.equal((await server.DELETE(request('DELETE', id))).status, 200);
  }
  assert.equal(f.calls.filter(url => url.endsWith('/live/sessions')).length, 5);
});

test('a preview query cannot select a draft or published snapshot without corresponding server authority', async () => {
  const f = fixture(); const server = createVoiceServer(f.options);
  const scoped = (value: string) => {
    const base = request('GET');
    return new Request(`${base.url}&preview=${value}`, { headers: base.headers });
  };
  assert.equal((await server.GET(scoped('draft'))).status, 403);
  assert.equal((await server.GET(scoped('published'))).status, 403);
  assert.equal((await server.GET(scoped('invalid'))).status, 400);
  assert.equal((await server.GET(scoped('draft&preview=published'))).status, 400);
  assert.equal(f.calls.length, 0);
});
