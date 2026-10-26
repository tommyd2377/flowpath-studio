import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import WebSocket from 'ws';
import { createVoiceServer } from '../lib/voice-server';
import { createPaidVoiceStore } from '../lib/paid-voice-store';
import { createVoiceDeadline } from '../lib/voice-deadline';
import { paidFixture } from './paid-fixture';

const sdp = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
async function fixture() {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 900, 300);
  let finalize = true, duration = 12, scheduled = 0;
  const sent: string[] = [];
  class Socket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor(readonly id: string) { super(); queueMicrotask(() => this.emit('open')); }
    send(value: string) {
      sent.push(JSON.parse(value).type);
      if (JSON.parse(value).type === 'session.close' && finalize) queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({
        type: 'session.closed', session: { id: this.id }, usage: { seconds: duration },
      }))));
    }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  const options = { enabled: () => true, apiKey: () => 'synthetic-only', requireSettlement: true, now: f.now, closeMs: 5,
    publicOrigin: 'https://voice.example', connected: (id: string) => f.store.updateSegment(id, 'connected').then(() => undefined),
    resolveWaveform: async () => ({ ownerUid: f.guest.visitorId, accountSessionId: f.guest.visitorId, waveform: f.wave,
      isCurrent: () => true, paid: { actor: f.guest, choice: 'creator' as const } }),
    production: { store: createPaidVoiceStore(f.store, f.now), policy: () => ({ ownerDailySeconds: 3600, globalDailySeconds: 9000,
      globalConcurrency: 3, access: 'signed-in' as const, allowedUids: [] }), scheduleDeadline: async () => { scheduled++; } },
    requestProvider: (async () => Response.json({ session: { id: 'provider_fixture' }, transport: { sdp } }, { status: 201 })) as typeof fetch,
    socketFactory: (url: string) => new Socket(url.split('/').at(-2)!),
  };
  const req = (method: string, id?: string) => new Request(`https://voice.example/api/paid-session?waveformId=${f.wave.id}`, {
    method, headers: { host: 'voice.example', origin: 'https://voice.example', 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ sessionId: id, ...(method === 'POST' ? { sdp } : {}) }) }),
  });
  return { ...f, options, req, sent, scheduled: () => scheduled, setFinalization: (value: boolean) => { finalize = value; }, setDuration: (value: number) => { duration = value; } };
}

test('fresh paid deadline worker reattaches the persisted provider, closes upstream and atomically settles partial usage', async () => {
  const f = await fixture();
  // A crashed process left only durable state. A new worker has no browser or original socket.
  const call = await f.reserve(); await f.connect(call.id); f.advance(300_000);
  const worker = createVoiceServer(f.options);
  assert.equal(await worker.expireReservation(call.id), true);
  assert.ok(f.sent.includes('session.close'));
  assert.equal((await f.store.segment(call.id))?.charged, 12);
  assert.equal((await f.store.wallet('creator')).balance, 888);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
});

test('paid deadline refuses premature cleanup and retains unknown provider holds without admitting another call', async () => {
  const f = await fixture(); const call = await f.reserve(); const worker = createVoiceServer(f.options);
  assert.equal(await worker.expireReservation(call.id), false);
  f.advance(300_000); assert.equal(await worker.expireReservation(call.id), false);
  assert.equal((await f.store.publication(f.wave.id))?.held, 300);
  await assert.rejects(f.reserve(), /previous conversation/);
});

test('paid task authentication precedes closure, and a missing final provider event keeps durable holds occupied', async () => {
  const f = await fixture(); const call = await f.reserve(); await f.connect(call.id); f.advance(300_000); f.setFinalization(false);
  const worker = createVoiceServer(f.options);
  let attempts = 0;
  const deadline = createVoiceDeadline({ endpoint: 'https://voice.example/api/voice-expiry', queuePath: 'synthetic/queue', serviceAccount: 'expiry@synthetic.example' }, {
    createTask: async () => {}, verifyIdentity: async () => ({ aud: 'https://voice.example/api/voice-expiry', email: 'expiry@synthetic.example', email_verified: true }), now: f.now,
  });
  const request = (token: boolean) => new Request('https://voice.example/api/voice-expiry', { method: 'POST', headers: {
    host: 'voice.example', 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer synthetic.signed.token' } : {}),
  }, body: JSON.stringify({ sessionId: call.id }) });
  const close = async (id: string) => { attempts++; return worker.expireReservation(id); };
  assert.equal((await deadline.handle(request(false), close)).status, 401); assert.equal(attempts, 0);
  assert.equal((await deadline.handle(request(true), close)).status, 503); assert.equal(attempts, 1);
  assert.equal((await f.store.segment(call.id))?.state, 'uncertain');
  assert.equal((await f.store.publication(f.wave.id))?.held, 300);
  f.setFinalization(true);
  assert.equal((await deadline.handle(request(true), async id => createVoiceServer(f.options).expireReservation(id))).status, 200);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
});

test('paid admission schedules its deadline before provider creation and canceled setup releases its reservation', async () => {
  const f = await fixture(); const id = randomUUID();
  const server = createVoiceServer({ ...f.options, production: { ...f.options.production, scheduleDeadline: async () => { throw new Error('Synthetic deadline outage'); } } });
  assert.equal((await server.POST(f.req('POST', id))).status, 503);
  assert.equal((await f.store.segment(id))?.state, 'rejected');
  assert.equal((await f.store.wallet('creator')).balance, 900);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
  assert.equal(f.sent.length, 0);
});

test('admin continuation of a settled prepaid segment preserves its original deadline without debiting more funds', async () => {
  const { createProductionVoiceStore } = await import('../lib/production-voice-store');
  const { previousPaidAdminCall, activePaidAdminCall } = await import('../lib/paid-voice-store');
  const f = paidFixture();
  const actor = { ...f.owner, accountSessionId: 'founder-account-session' };
  f.db.rows.set(`ownerSessions/${actor.accountSessionId}`, { uid: actor.uid, state: 'active', expiresAt: f.now() + 3_600_000 });
  await f.credit(actor); await f.publish('visitor');
  const initial = await f.reserve(actor, 'self');
  const store = createProductionVoiceStore(f.db, f.now, previousPaidAdminCall, activePaidAdminCall);
  const admin = { ownerUid: actor.uid!, waveformId: f.wave.id, accountSessionId: actor.accountSessionId,
    admin: { uid: actor.uid!, accountSessionId: actor.accountSessionId, override: true, previousSessionId: initial.id } };
  const policy = { globalConcurrency: 3, globalDailySeconds: 90_000, ownerDailySeconds: 900, access: 'signed-in' as const, allowedUids: [] };
  await assert.rejects(store.reserve(admin, randomUUID(), policy), /previous conversation/);
  await f.connect(initial.id); f.advance(45_000);
  await f.store.settle(initial.id, { finalized: true, seconds: 45 });
  const before = await f.store.wallet(actor.uid!);
  const resumed = await store.reserve(admin, randomUUID(), policy);
  assert.equal(resumed.expiresAt, initial.createdAt + 900_000);
  assert.deepEqual(await f.store.wallet(actor.uid!), before);
  await assert.rejects(f.reserve(actor, 'self'), /previous conversation/);
  await store.finish(resumed.id, { finalized: true, seconds: 10 });
  const other = { ...admin, ownerUid: 'another-owner', admin: { ...admin.admin, uid: 'another-owner' } };
  await assert.rejects(store.reserve(other, randomUUID(), policy), /Sign in again|previous conversation/);
});
