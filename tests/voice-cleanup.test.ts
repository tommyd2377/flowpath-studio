import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { PaidMemoryDatabase } from './paid-fixture';
import { createProductionVoiceStore, VOICE_CLEANUP_LEASE_MS, type VoicePolicy } from '../lib/production-voice-store';
import { createVoiceServer } from '../lib/voice-server';
import { getProductionVoiceServer } from '../lib/production-voice-runtime';
import { paidVoiceReady } from '../lib/paid-runtime';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('development reload replaces an older cached supervisor and then retains the current instance', () => {
  const shared = globalThis as typeof globalThis & {
    flowpathProductionVoiceServer?: ReturnType<typeof createVoiceServer>;
    flowpathProductionVoiceConfigVersion?: string;
    flowpathProductionVoiceFactory?: typeof createVoiceServer;
  };
  const savedServer = shared.flowpathProductionVoiceServer, savedVersion = shared.flowpathProductionVoiceConfigVersion, savedFactory = shared.flowpathProductionVoiceFactory;
  const env: Record<string, string | undefined> = process.env;
  const previous = env.NODE_ENV;
  try {
    env.NODE_ENV = 'development';
    const old = createVoiceServer({ enabled: () => false });
    shared.flowpathProductionVoiceServer = old;
    shared.flowpathProductionVoiceConfigVersion = 'creation-safety-v3-draft-publication-owner-recovery-v1';
    const updated = getProductionVoiceServer();
    assert.notEqual(updated, old);
    assert.equal(typeof updated.superviseReservation, 'function');
    assert.equal(getProductionVoiceServer(), updated, 'routine reads retain the current supervisor');
    shared.flowpathProductionVoiceFactory = () => old;
    assert.notEqual(getProductionVoiceServer(), updated, 'changed server code invalidates the dev cache even without a version-string edit');
  } finally {
    if (savedServer === undefined) delete shared.flowpathProductionVoiceServer; else shared.flowpathProductionVoiceServer = savedServer;
    if (savedVersion === undefined) delete shared.flowpathProductionVoiceConfigVersion; else shared.flowpathProductionVoiceConfigVersion = savedVersion;
    if (savedFactory === undefined) delete shared.flowpathProductionVoiceFactory; else shared.flowpathProductionVoiceFactory = savedFactory;
    if (previous === undefined) delete env.NODE_ENV; else env.NODE_ENV = previous;
  }
});

async function fixture(known = true) {
  const db = new PaidMemoryDatabase();
  let time = Date.UTC(2026, 9, 27, 12);
  const owner = { ownerUid: 'synthetic-owner', accountSessionId: 'synthetic-account', waveformId: randomUUID() };
  const policy: VoicePolicy = { ownerDailySeconds: 3600, globalDailySeconds: 3600, globalConcurrency: 1, access: 'signed-in', allowedUids: [] };
  db.rows.set(`ownerSessions/${owner.accountSessionId}`, { uid: owner.ownerUid, state: 'active', expiresAt: time + 3 * 86_400_000 });
  const store = createProductionVoiceStore(db, () => time), id = randomUUID();
  const reserved = await store.reserve(owner, id, policy);
  if (known) await store.created(id, 'synthetic-provider', reserved.expiresAt);
  const sockets: Socket[] = [];
  let finalize = true, open = true, replies = true;
  const sent: string[] = [];
  class Socket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor() { super(); sockets.push(this); queueMicrotask(() => { if (open) this.emit('open'); }); }
    final(seconds = 2.5) { this.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', session: { id: 'synthetic-provider' }, usage: { seconds } }))); }
    send(value: string) { const type = JSON.parse(value).type; sent.push(type); if (type === 'session.close' && finalize && replies) queueMicrotask(() => this.final()); }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  const options = { publicOrigin: 'https://voice.example', enabled: () => false, requestOwnedCleanup: true, apiKey: () => 'synthetic-key',
    now: () => time, connectMs: 5, closeMs: 5,
    resolveWaveform: async () => ({ ...owner, waveform: { name: 'Synthetic', initialPrompt: 'Keep it short.' }, isCurrent: () => true }),
    production: { store, policy: () => null, scheduleDeadline: async () => { throw new Error('Must not schedule'); } },
    requestProvider: (async () => { throw new Error('Cleanup must not create or use SIP hangup'); }) as typeof fetch,
    socketFactory: () => new Socket(),
  };
  const worker = () => createVoiceServer(options);
  const req = (method: string, signal?: AbortSignal) => new Request(`https://voice.example/api/session?waveformId=${owner.waveformId}`, {
    method, signal, headers: { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify({ sessionId: id }) }),
  });
  return { db, store, id, owner, reserved, policy, options, sockets, sent, worker, req,
    row: () => db.rows.get(`voiceConversations/${id}`)!, advance: (ms: number) => { time += ms; },
    setFinalize: (value: boolean) => { finalize = value; }, setOpen: (value: boolean) => { open = value; },
    setReplies: (value: boolean) => { replies = value; } };
}

test('hosted runtime rejects owner, admin and public starts despite an old live flag, before database/provider work', async () => {
  const env = { NODE_ENV: 'production', FLOWPATH_LIVE_ENABLED: '1', FLOWPATH_PUBLIC_ORIGIN: 'https://voice.example',
    FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio' };
  const previous = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  const priorFetch = globalThis.fetch;
  try {
    Object.assign(process.env, env);
    globalThis.fetch = async () => { throw new Error('Must not call any remote API'); };
    assert.equal(paidVoiceReady(), false, 'nonfixture paid entry remains independently closed');
    const owner = { ownerUid: 'synthetic-owner', accountSessionId: 'synthetic-session', waveform: { id: randomUUID(), name: 'Synthetic', initialPrompt: 'Keep it short.' }, isCurrent: () => true };
    for (const admin of [false, true]) {
      const server = getProductionVoiceServer(async () => owner, async () => admin ? {
        uid: owner.ownerUid, accountSessionId: owner.accountSessionId, testing: true, isCurrent: () => true,
      } : null);
      for (const personal of [false, true]) {
        const url = `https://voice.example/api/session${personal ? `?waveformId=${owner.waveform.id}` : ''}`;
        const headers = { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json' };
        const status = await (await server.GET(new Request(url, { headers }))).json();
        assert.equal(status.enabled, false);
        const post = await server.POST(new Request(url, { method: 'POST', headers, body: '{}' }));
        assert.ok([403, 503].includes(post.status));
      }
    }
  } finally {
    globalThis.fetch = priorFetch;
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('request-owned cleanup survives restart, awaits finalization and disposes before returning; replay is idempotent', async () => {
  const f = await fixture();
  // Cleanup is independent of new-start policy, saved content review and account revocation.
  f.db.rows.set(`ownerSessions/${f.owner.accountSessionId}`, { uid: f.owner.ownerUid, state: 'revoked' });
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), true);
  assert.equal(f.row().state, 'closed');
  assert.equal(f.row().seconds, 2.5);
  assert.deepEqual(f.sent, ['session.close']);
  assert.ok(f.sockets.every(socket => socket.readyState === WebSocket.CLOSED));
  const before = structuredClone(f.db.rows);
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), true);
  assert.deepEqual(f.db.rows, before);
  assert.equal(f.sockets.length, 1);
  assert.equal((f.db.rows.get('voiceAdmission/global')!).reservedSeconds, 900, 'cleanup never refunds admission budget');
});

test('duplicate concurrent delivery has one closer; busy delivery is retryable, never starts replacement', async () => {
  const f = await fixture(); f.setReplies(false);
  const first = f.worker().DELETE(f.req('DELETE'));
  await tick();
  const duplicate = await f.worker().DELETE(f.req('DELETE'));
  assert.equal(duplicate.status, 202);
  assert.equal(f.sockets.length, 1);
  f.sockets[0].final();
  assert.equal((await first).status, 200);
  assert.equal((await f.worker().DELETE(f.req('DELETE'))).status, 200);
  assert.equal(f.sockets.length, 1);
});

test('an owner pointer with a missing durable record cannot be reported as closed', async () => {
  const f = await fixture(); f.db.rows.delete(`voiceConversations/${f.id}`);
  await assert.rejects(f.store.previous(f.owner.ownerUid, f.owner.waveformId), /could not be verified/);
  assert.equal(f.sockets.length, 0);
  await assert.rejects(f.store.available(f.owner, f.policy), /previous/);
});

test('attach timeout, transport failure and absent finalization preserve holds and close every socket', async () => {
  for (const failure of ['attach', 'transport', 'finalization']) {
    const f = await fixture(); f.setFinalize(false);
    if (failure === 'attach') f.setOpen(false);
    const closing = f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId);
    await tick();
    if (failure === 'transport') f.sockets[0].emit('close');
    assert.equal(await closing, false);
    assert.equal(f.row().state, 'uncertain');
    assert.ok(f.sockets.every(socket => socket.readyState === WebSocket.CLOSED));
    await assert.rejects(f.store.reserve(f.owner, randomUUID(), f.policy), /cleanup|previous/);
    assert.equal((await f.worker().POST(f.req('POST'))).status, 503);
  }
});

test('local transport diagnosis reports only the bounded HTTP status, never raw provider data', async () => {
  for (const message of ['Unexpected server response: 404', 'private-provider-message synthetic-key']) {
    const f = await fixture(); f.setFinalize(false);
    const warnings: unknown[][] = [], original = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args); };
    try {
      const closing = createVoiceServer({ ...f.options, localRecoveryDiagnostics: true }).cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId);
      await tick();
      f.sockets[0].emit('error', new Error(message));
      assert.equal(await closing, false);
      assert.deepEqual(warnings, [['Local voice controller transport failed', { status: message.endsWith('404') ? 404 : null }]]);
      assert.equal(JSON.stringify(warnings).includes('synthetic-key'), false);
    } finally { console.warn = original; }
  }
});

test('deadline delay and repeated delivery do not extend caps or release unknown creation', async () => {
  const f = await fixture(false);
  assert.equal(await f.worker().expireReservation(f.id), false, 'early task cannot close');
  f.advance(900_000 + 86_400_000);
  for (let i = 0; i < 3; i++) assert.equal(await f.worker().expireReservation(f.id), false);
  assert.equal(f.sockets.length, 0);
  assert.equal(f.row().state, 'uncertain');
  assert.equal(f.row().expiresAt, f.reserved.expiresAt);
  await assert.rejects(f.store.reserve(f.owner, randomUUID(), f.policy), /cleanup|previous/);
});

test('a late creation ID after deadline is retained for cleanup without reviving admission', async () => {
  const f = await fixture(false); f.advance(900_000);
  assert.equal(await f.worker().expireReservation(f.id), false);
  assert.equal(await f.store.created(f.id, 'synthetic-provider', f.reserved.expiresAt), true);
  assert.equal(f.row().state, 'uncertain');
  assert.equal(f.row().providerId, 'synthetic-provider');
  assert.equal(await f.worker().expireReservation(f.id), true);
  assert.equal(f.row().state, 'closed');
});

test('crashed/expired cleanup ownership fences old controllers and late results, without forgiving usage', async () => {
  const f = await fixture();
  await f.store.cancel(f.owner.ownerUid, f.owner.waveformId, f.id);
  const crashed = await f.store.claimCleanup(f.id); assert.ok(crashed);
  assert.equal(await f.store.claimCleanup(f.id), null);
  const result = { finalized: true, providerId: 'synthetic-provider', seconds: 2.5 };
  await assert.rejects(f.store.finish(f.id, result), /ownership/);
  f.advance(VOICE_CLEANUP_LEASE_MS);
  await assert.rejects(f.store.finish(f.id, { ...result, cleanupEpoch: crashed.cleanup.epoch }), /ownership/);
  const replacement = await f.store.claimCleanup(f.id); assert.ok(replacement);
  assert.equal(replacement.cleanup.epoch, crashed.cleanup.epoch + 1);
  await assert.rejects(f.store.finish(f.id, { ...result, cleanupEpoch: crashed.cleanup.epoch }), /ownership/);
  await assert.rejects(f.store.reserve(f.owner, randomUUID(), f.policy), /previous/);
  await f.store.finish(f.id, { ...result, cleanupEpoch: replacement.cleanup.epoch });
  assert.equal(f.row().state, 'closed');
  assert.equal(f.row().seconds, 2.5);
});

test('failed settlement rolls back and a new process can retry only after the lease expires', async () => {
  const f = await fixture();
  const store = { ...f.store, finish: async () => { throw new Error('Synthetic persistence failure'); } };
  const server = createVoiceServer({ ...f.options, production: { ...f.options.production, store } });
  assert.equal(await server.cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), false);
  assert.notEqual(f.row().state, 'closed');
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), false);
  f.advance(VOICE_CLEANUP_LEASE_MS);
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), true);
  assert.equal(f.sockets.length, 2);
});

test('browser disconnect cannot claim successful cleanup without finalization', async () => {
  const f = await fixture(); f.setFinalize(false);
  const abort = new AbortController();
  const closing = f.worker().DELETE(f.req('DELETE', abort.signal));
  await tick(); abort.abort();
  assert.equal((await closing).status, 202);
  assert.equal(f.row().state, 'uncertain');
  assert.ok(f.sockets.every(socket => socket.readyState === WebSocket.CLOSED));
});

test('a cleanup lease never grants another owner or mismatched provider settlement authority', async () => {
  const f = await fixture();
  assert.equal(await f.worker().cancelReservation(f.id, 'another-owner', f.owner.waveformId), false);
  assert.equal(f.row().cleanup, undefined);
  await f.store.cancel(f.owner.ownerUid, f.owner.waveformId, f.id);
  const lease = await f.store.claimCleanup(f.id); assert.ok(lease);
  await assert.rejects(f.store.finish(f.id, { finalized: true, providerId: 'another-provider', seconds: 0, cleanupEpoch: lease.cleanup.epoch }), /identifier/);
  await assert.rejects(f.store.finish(f.id, { finalized: true, rejected: true, providerId: 'synthetic-provider', cleanupEpoch: lease.cleanup.epoch }), /finalization/);
  assert.notEqual(f.row().state, 'closed');
});

test('a late socket finalization cannot settle after its request lease expires', async () => {
  const f = await fixture(); f.setReplies(false);
  const closing = f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId);
  await tick();
  f.advance(VOICE_CLEANUP_LEASE_MS);
  f.sockets[0].final();
  assert.equal(await closing, false);
  assert.notEqual(f.row().state, 'closed');
  assert.ok(f.sockets.every(socket => socket.readyState === WebSocket.CLOSED));
  f.setReplies(true);
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), true);
  assert.equal(f.row().cleanup && (f.row().cleanup as { epoch: number }).epoch, 2);
});

test('missing cleanup capability and malformed ownership fail closed without provider operations', async () => {
  const f = await fixture();
  const unsupported = createVoiceServer({ ...f.options, production: { ...f.options.production, store: { ...f.store, claimCleanup: undefined } } });
  assert.equal(await unsupported.cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), false);
  assert.equal(f.sockets.length, 0);
  f.row().cleanup = { epoch: 1, until: Infinity };
  assert.equal(await f.worker().cancelReservation(f.id, f.owner.ownerUid, f.owner.waveformId), false);
  assert.equal(f.sockets.length, 0);
});
