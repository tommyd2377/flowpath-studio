import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { createVoiceServer } from '../lib/voice-server';
import { createProductionVoiceStore, type VoiceDatabase, type VoiceOwner, type VoicePolicy, type VoiceTransaction } from '../lib/production-voice-store';

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
  const database: VoiceDatabase = {
    async transaction<T>(work: (tx: VoiceTransaction) => Promise<T>) {
      const previous = pending;
      let release!: () => void;
      pending = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const next = structuredClone(rows);
      try {
        const result = await work({ get: async path => next.get(path) ?? null, set: (path, value) => { next.set(path, structuredClone(value) as Record<string, unknown>); } });
        rows = next;
        return result;
      } finally { release(); }
    },
  };
  const store = createProductionVoiceStore(database, () => now);
  const sockets = new Set<SyntheticSocket>();
  class SyntheticSocket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor(readonly id: string) { super(); queueMicrotask(() => this.emit('open')); }
    send(text: string) {
      if (JSON.parse(text).type === 'session.close' && shouldFinalize) queueMicrotask(() => {
        for (const socket of sockets) if (socket.id === this.id) socket.emit('message', Buffer.from(JSON.stringify({
          type: 'session.closed', session: { id: this.id }, usage: { seconds: 2.5 },
        })));
      });
    }
    terminate() { sockets.delete(this); this.readyState = WebSocket.CLOSED; }
  }
  const calls: string[] = [];
  const scheduled: { id: string; expiresAt: number }[] = [];
  const options = {
    publicOrigin: origin, enabled: () => true, apiKey: () => 'synthetic-server-key', now: () => now,
    resolveWaveform: async () => ({ ...owner, waveform: { name: 'Synthetic', initialPrompt: 'Keep it short.' }, isCurrent: async () => true }),
    production: { store, policy: () => policy, scheduleDeadline: async (id: string, expiresAt: number) => { scheduled.push({ id, expiresAt }); } },
    requestProvider: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return Response.json({ session: { id: `live_synthetic_${calls.length}` }, transport: { type: 'webrtc', sdp } }, { status: 201 });
    }) as typeof fetch,
    socketFactory: (url: string) => { const socket = new SyntheticSocket(url.split('/').at(-2)!); sockets.add(socket); return socket; },
  };
  return { options, store, calls, scheduled, database, rows: () => rows, advance: (ms: number) => { now += ms; },
    setFinalization: (value: boolean) => { shouldFinalize = value; } };
}

test('public homepage cannot create paid voice and an incomplete policy reads no key', async () => {
  const f = fixture();
  const server = createVoiceServer({ ...f.options, apiKey: () => { throw new Error('Key must not be read'); }, production: { ...f.options.production, policy: () => null } });
  const home = await (await server.GET(request('GET', undefined, false))).json();
  assert.equal(home.enabled, false);
  assert.match(home.message, /Sign in/);
  assert.equal((await server.POST(request('POST', randomUUID(), false))).status, 403);
  assert.equal((await server.POST(request('POST', randomUUID()))).status, 503);
  assert.equal(f.calls.length, 0);
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
