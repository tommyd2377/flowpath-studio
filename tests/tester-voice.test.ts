import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { PaidMemoryDatabase } from './paid-fixture';
import { createTesterVoiceStore, TESTER_CONTROL_LEASE_MS } from '../lib/tester-voice-store';
import { UNMETERED_LOCAL_DEADLINE, type VoiceOwner, type VoicePolicy } from '../lib/production-voice-store';
import { PUBLIC_WAVEFORM_ID } from '../lib/public-voice-identity';
import { createVoiceServer } from '../lib/voice-server';
import { hostedTesterDemo } from '../lib/tester-voice-config';
import { voiceSessionConfig } from '../lib/voice-config';
import { readFileSync } from 'node:fs';

function fixture() {
  const db = new PaidMemoryDatabase(); let now = Date.UTC(2026, 9, 27, 12);
  const personal = (uid = 'tester', founder = false): VoiceOwner => {
    db.rows.set(`ownerSessions/${uid}-session`, { uid, state: 'active', expiresAt: now + 5 * 86_400_000 });
    db.rows.set(`waveformMembers/${uid}`, { state: 'active' });
    db.rows.set(`ownerWaveforms/${uid}`, { id: `${uid}-wave` });
    return { ownerUid: uid, accountSessionId: `${uid}-session`, waveformId: `${uid}-wave`, tester: { uid, accountSessionId: `${uid}-session`, founder } };
  };
  const intro = (uid = 'tester') => {
    const owner = personal(uid, false), token = createHash('sha256').update(uid).digest('hex');
    return { ...owner, kind: 'visitor' as const, ownerUid: `visitor:${token}`, accountSessionId: token, waveformId: PUBLIC_WAVEFORM_ID };
  };
  const store = () => createTesterVoiceStore(db, () => now);
  const connect = async (s: ReturnType<typeof store>, id: string) => {
    const call = db.rows.get(`voiceConversations/${id}`)!;
    if (!call.providerId) await s.created(id, `provider_${id}`, call.expiresAt as number);
    await s.beginConnection(call as unknown as VoiceOwner, id);
    return s.confirmConnection(id, await s.connectionDeadline(id));
  };
  const finish = async (s: ReturnType<typeof store>, id: string, seconds: number) => {
    if (db.rows.get(`voiceConversations/${id}`)!.connectedAt === undefined) await connect(s, id);
    await s.finish(id, { finalized: true, seconds, providerId: db.rows.get(`voiceConversations/${id}`)!.providerId as string });
  };
  return { db, personal, intro, store, finish, connect, now: () => now, advance: (ms: number) => { now += ms; } };
}

test('tester allowance is cumulative by UID across refresh, login, waveform changes, restarts and days', async () => {
  const f = fixture(), owner = f.personal(), first = f.store();
  const call = await first.reserve(owner, 'one'); await f.connect(first, call.id); assert.equal(call.expiresAt - f.now(), 180_000);
  f.advance(60_000); await f.finish(first, call.id, 50);
  const second = f.store();
  const resumed = await second.reserve(owner, 'two'); await f.connect(second, resumed.id); assert.equal(resumed.expiresAt - f.now(), 120_000);
  f.advance(120_000); await f.finish(second, resumed.id, 110);
  f.advance(86_400_000); const again = f.personal();
  again.accountSessionId = 'new-session'; again.tester!.accountSessionId = 'new-session';
  f.db.rows.set('ownerSessions/new-session', { uid: again.ownerUid, state: 'active', expiresAt: f.now() + 86_400_000 });
  await assert.rejects(f.store().reserve(again, 'three'), /beta demo has ended/);
});

test('selected daily personal allowance renews by UTC day, while existing holds remain tied to the starting day', async () => {
  const f = fixture(), owner = f.personal(), store = createTesterVoiceStore(f.db, f.now, 'daily');
  await store.reserve(owner, 'daily'); await f.finish(store, 'daily', 180);
  await assert.rejects(store.reserve(owner, 'same-day'), /ended for today/);
  f.advance(86_400_000);
  assert.equal((await createTesterVoiceStore(f.db, f.now, 'daily').reserve(owner, 'next-day')).expiresAt - f.now(), 180_000);
});

test('founder owns an unlimited personal call; intro is capped for the same verified founder', async () => {
  const f = fixture(), founder = f.personal('founder', true), store = f.store();
  const call = await store.reserve(founder, 'founder-call');
  assert.equal(call.expiresAt, UNMETERED_LOCAL_DEADLINE);
  assert.equal(call.controlExpiresAt, f.now() + TESTER_CONTROL_LEASE_MS);
  await f.finish(store, call.id, 1000);
  const intro = f.intro('founder');
  const welcome = await store.reserve(intro, 'founder-intro');
  assert.equal(welcome.expiresAt - f.now(), 180_000);
  await f.finish(store, welcome.id, 180);
  await assert.rejects(store.reserve(intro, 'again'), /introduction allowance/);
  await store.available(founder);
});

test('intro is separate from created-waveform allowance and rejects founder override metadata', async () => {
  const f = fixture(), store = f.store(), intro = f.intro();
  await store.reserve(intro, 'intro'); await f.finish(store, 'intro', 180);
  const own = await store.reserve(f.personal(), 'own'); assert.equal(own.expiresAt - f.now(), 180_000);
  await assert.rejects(store.available({ ...intro, tester: { ...intro.tester!, founder: true } }), /Tester identity/);
});

test('membership, durable session, ownership and current content remain server authoritative', async () => {
  const f = fixture(), owner = f.personal(), store = f.store();
  f.db.rows.set('waveformMembers/tester', { state: 'revoked' });
  await assert.rejects(store.reserve(owner, 'non-member'), /invited account/);
  f.db.rows.set('waveformMembers/tester', { state: 'active' });
  await assert.rejects(store.reserve({ ...owner, waveformId: 'someone-else' }, 'wrong-owner'), /another account/);
  f.db.rows.set('ownerSessions/tester-session', { uid: 'another', state: 'active', expiresAt: f.now() + 60_000 });
  await assert.rejects(store.reserve(owner, 'bad-session'), /invited account/);
  const guarded = createTesterVoiceStore(f.db, f.now, 'beta', async () => { throw new Error('Changed moderation version'); });
  f.personal(); await assert.rejects(guarded.reserve(owner, 'changed'), /Changed moderation/);
  assert.equal([...f.db.rows.keys()].some(key => key.startsWith('voiceConversations/')), false);
});

test('cross-instance races allow only one session per UID and retain unknown-provider holds', async () => {
  const f = fixture(), owner = f.personal();
  const attempts = await Promise.allSettled([f.store().reserve(owner, 'a'), f.store().reserve(owner, 'b')]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  const call = (attempts.find(value => value.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<ReturnType<typeof f.store>['reserve']>>>).value;
  await f.store().finish(call.id, { finalized: false });
  f.advance(86_400_000);
  await assert.rejects(f.store().reserve(f.personal('other'), 'other'), /confirmed cleanup/);
  const held = [...f.db.rows].find(([path]) => path.startsWith('voiceTesterAllowances/'))![1];
  assert.equal(held.heldSeconds, 180);
});

test('heartbeat extends only a live authenticated lease; stale tasks skip; stopped clients expire across restart', async () => {
  const f = fixture(), owner = f.personal('founder', true), store = f.store();
  const call = await store.reserve(owner, 'lease'); await store.created(call.id, 'provider_lease', call.expiresAt); await f.connect(store, call.id);
  f.advance(20_000); const proposed = await store.heartbeat(owner, call.id);
  assert.equal(proposed.schedule, true);
  assert.equal(f.db.rows.get('voiceConversations/lease')!.controlExpiresAt, call.controlExpiresAt, 'proposal does not extend before task creation');
  await f.store().heartbeat(owner, call.id, proposed.controlExpiresAt);
  f.advance(25_000); assert.equal(await f.store().expire(call.id), null, 'old task does not close a renewed call');
  f.advance(31_000); const expired = await f.store().expire(call.id); assert.equal(expired?.canceled, true);
  await assert.rejects(f.store().heartbeat(owner, call.id), /lease ended/);
  await assert.rejects(f.store().reserve(owner, 'replacement'), /previous conversation/);
});

test('signout, revocation, other accounts and cleanup fencing prevent renewal or stale settlement', async () => {
  const f = fixture(), owner = f.personal('founder', true), store = f.store();
  const call = await store.reserve(owner, 'revocation'); await store.created(call.id, 'provider_revocation', call.expiresAt); await f.connect(store, call.id);
  await assert.rejects(store.heartbeat(f.personal('different'), call.id), /lease ended/);
  f.db.rows.set('ownerSessions/founder-session', { uid: 'founder', state: 'changing', expiresAt: f.now() + 60_000 });
  await assert.rejects(store.heartbeat(owner, call.id), /invited account/);
  await store.cancel('founder'); const claim = await store.claimCleanup(call.id); assert.ok(claim);
  await assert.rejects(store.finish(call.id, { finalized: true, seconds: 2, providerId: 'provider_revocation' }), /stale finalization/);
  await store.finish(call.id, { finalized: true, seconds: 2, providerId: 'provider_revocation', cleanupEpoch: claim.cleanup.epoch });
  assert.equal(await store.claimCleanup(call.id), null);
});

test('bounded global concurrency is separate from any OpenAI daily budget', async () => {
  const f = fixture(), store = f.store();
  await store.reserve(f.personal('a'), 'a'); await store.reserve(f.personal('b'), 'b');
  await assert.rejects(store.reserve(f.personal('c'), 'c'), /connections are in use/);
  await f.finish(store, 'a', 180); await store.reserve(f.personal('c'), 'c');
});

test('hosted opt-in requires exact project/origin/safety and explicit allowance period; infrastructure keeps zero idle', () => {
  const env = { NODE_ENV: 'production', FLOWPATH_HOSTED_TESTER_DEMO: '1', FLOWPATH_LIVE_ENABLED: '1', FLOWPATH_PAID_TEST_ENABLED: '0',
    FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
    FLOWPATH_PUBLIC_ORIGIN: 'https://flowpath.studio', FLOWPATH_TESTER_ALLOWANCE_PERIOD: 'daily', FLOWPATH_CREATION_SAFETY_ENABLED: '1', FLOWPATH_CREATION_POLICY_PRESET: 'conservative-v3' };
  assert.equal(hostedTesterDemo(env), true);
  for (const key of ['FLOWPATH_HOSTED_TESTER_DEMO', 'FLOWPATH_TESTER_ALLOWANCE_PERIOD', 'FLOWPATH_CREATION_SAFETY_ENABLED', 'FLOWPATH_CREATION_POLICY_PRESET']) assert.equal(hostedTesterDemo({ ...env, [key]: undefined }), false);
  assert.equal(hostedTesterDemo({ ...env, FLOWPATH_PAID_TEST_ENABLED: '1' }), false);
  assert.equal(hostedTesterDemo({ ...env, FLOWPATH_TESTER_ALLOWANCE_PERIOD: 'beta' }), false);
  assert.equal(hostedTesterDemo({ ...env, FLOWPATH_PUBLIC_ORIGIN: 'https://attacker.example' }), false);
  const yaml = readFileSync(new URL('../apphosting.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /minInstances: 0/); assert.match(yaml, /maxInstances: 2/); assert.match(yaml, /cpuAlwaysAllocated: false/);
  const config = voiceSessionConfig(undefined, false, true);
  assert.ok(config.client.data_channel.allowed_client_events.includes('session.instructions.append'));
});

test('hosted start leaves no socket/timer after HTTP; deadline and close run on a fresh server', async () => {
  const f = fixture(); const uid = 'tester', id = randomUUID(); const owner = f.personal(uid);
  const waveform = { id: randomUUID(), name: 'Test', initialPrompt: 'Be brief.' }; owner.waveformId = waveform.id;
  f.db.rows.set('ownerWaveforms/tester', { id: waveform.id });
  const store = f.store(); let providerStarts = 0, sockets = 0, schedules = 0, scheduleFailure = false;
  const policy: VoicePolicy = { ownerDailySeconds: 900, globalDailySeconds: 3600, globalConcurrency: 2, access: 'signed-in', allowedUids: [] };
  class Socket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor() { super(); sockets++; queueMicrotask(() => { this.emit('open'); this.emit('message', Buffer.from(JSON.stringify({ type: 'session.started', session: { id: 'provider' } }))); }); }
    send(value: string) { assert.equal(JSON.parse(value).type, 'session.close'); queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', session: { id: 'provider' }, usage: { seconds: 2 } })))); }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  const worker = () => createVoiceServer({ enabled: () => true, apiKey: () => 'fixture', publicOrigin: 'https://voice.example', requestScopedDemo: true, requestOwnedCleanup: true,
    now: f.now, resolveWaveform: async () => ({ ...owner, waveform, isCurrent: () => true }),
    production: { store, policy: () => policy, heartbeat: store.heartbeat, beginConnection: store.beginConnection, confirmConnection: async id => store.confirmConnection(id, await store.connectionDeadline(id)), scheduleDeadline: async () => { schedules++; if (scheduleFailure) throw new Error('task unavailable'); } },
    socketFactory: () => new Socket(), requestProvider: (async () => { providerStarts++; return Response.json({ session: { id: 'provider' }, transport: { sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } }); }) as typeof fetch });
  const req = (method: string, body: object) => new Request(`https://voice.example/api/session?waveformId=${waveform.id}`, { method, headers: { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify(body) });
  const response = await worker().POST(req('POST', { sessionId: id, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }));
  assert.equal(response.status, 201);
  const { voiceConnectionReader } = await import('../lib/voice-connection'); const frames = voiceConnectionReader(response);
  assert.equal((await frames.next()).browserControl, true); await frames.next(); await frames.cancel();
  assert.equal(sockets, 1); assert.equal(providerStarts, 1); assert.equal(schedules, 1);
  f.advance(20_000); scheduleFailure = true;
  assert.equal((await worker().PATCH(req('PATCH', { sessionId: id }))).status, 503);
  assert.equal(f.db.rows.get(`voiceConversations/${id}`)!.controlExpiresAt, f.now() + 25_000, 'failed scheduling cannot renew the hold');
  assert.equal((await worker().DELETE(req('DELETE', { sessionId: id }))).status, 200);
  assert.equal(sockets, 2); assert.equal(providerStarts, 1);
  assert.equal((await worker().DELETE(req('DELETE', { sessionId: id }))).status, 200);
});

test('server scope never passes a founder admin override into the introductory allowance', async () => {
  const f = fixture(), intro = f.intro('founder'), store = f.store(), id = randomUUID();
  const policy: VoicePolicy = { ownerDailySeconds: 900, globalDailySeconds: 3600, globalConcurrency: 2, publicDemoSeconds: 180, access: 'signed-in', allowedUids: [] };
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'fixture', publicOrigin: 'https://voice.example', requestScopedDemo: true, requestOwnedCleanup: true,
    now: f.now, resolvePublicVisitor: async () => intro,
    resolveAdmin: async () => ({ uid: 'founder', accountSessionId: 'founder-session', testing: true, isCurrent: () => true }),
    production: { store, policy: () => policy, heartbeat: store.heartbeat, beginConnection: store.beginConnection, confirmConnection: async id => store.confirmConnection(id, await store.connectionDeadline(id)), scheduleDeadline: async () => {} },
    socketFactory: () => {
      const socket = new EventEmitter() as EventEmitter & { readyState: 0 | 1 | 2 | 3; send: () => void; terminate: () => void };
      socket.readyState = WebSocket.OPEN; socket.send = () => {}; socket.terminate = () => { socket.readyState = WebSocket.CLOSED; };
      queueMicrotask(() => { socket.emit('open'); socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.started', session: { id: 'provider_intro' } }))); });
      return socket;
    },
    requestProvider: (async () => Response.json({ session: { id: 'provider_intro' }, transport: { sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } })) as typeof fetch });
  const headers = { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json', accept: 'application/x-ndjson', 'X-FlowPath-Admin': 'continue' };
  const ready = await (await server.GET(new Request('https://voice.example/api/session', { headers }))).json();
  assert.equal(ready.enabled, true); assert.equal(ready.adminEligible, undefined);
  const response = await server.POST(new Request('https://voice.example/api/session', { method: 'POST', headers,
    body: JSON.stringify({ sessionId: id, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }) }));
  assert.equal(response.status, 201); const { voiceConnectionReader } = await import('../lib/voice-connection'); const frames = voiceConnectionReader(response); const body = await frames.next(); await frames.next(); await frames.cancel();
  assert.ok(typeof body.expiresAt === 'number'); assert.equal(body.expiresAt - f.now(), 180_000); assert.equal(body.adminOverride, false);
  assert.equal(f.db.rows.get(`voiceConversations/${id}`)?.admin, undefined);
});

test('code grants unlock anonymous intro only; re-entry and new page IDs cannot replenish or duplicate daily time', async () => {
  const f = fixture(), original = f.intro('browser'), guest = { ...original, tester: undefined, demoVisitorId: 'a'.repeat(64), demoGrant: 'b'.repeat(64) };
  f.db.rows.set(`voiceDemoAccess/${guest.demoGrant}`, { state: 'active', expiresAt: f.now() + 86_400_000 });
  const store = createTesterVoiceStore(f.db, f.now, 'daily', undefined, true);
  await assert.rejects(store.reserve({ ...guest, demoGrant: undefined }, 'no-code'), /demo code/);
  await store.available(guest); assert.equal([...f.db.rows.keys()].some(path => path.startsWith('voiceTesterAllowances/')), false);
  const call = await store.reserve(guest, 'anonymous');
  const otherPage = { ...guest, ownerUid: `visitor:${'c'.repeat(64)}`, accountSessionId: 'c'.repeat(64) };
  await assert.rejects(store.reserve(otherPage, 'another-tab'), /previous conversation/);
  await store.created(call.id, 'provider_anonymous', call.expiresAt);
  await store.beginConnection(guest, call.id); await store.confirmConnection(call.id, await store.connectionDeadline(call.id));
  f.advance(180_000); await store.finish(call.id, { finalized: true, seconds: 180, providerId: 'provider_anonymous' });
  f.db.rows.set(`voiceDemoAccess/${'d'.repeat(64)}`, { state: 'active', expiresAt: f.now() + 86_400_000 });
  await assert.rejects(store.reserve({ ...otherPage, demoGrant: 'd'.repeat(64) }, 're-entered'), /introduction allowance/);
});

test('meter begins on provider-confirmed connection, never on access, reservation or a client heartbeat', async () => {
  const f = fixture(), owner = f.personal(), store = f.store(), call = await store.reserve(owner, 'delayed');
  await store.created(call.id, 'provider_delayed', call.expiresAt);
  f.advance(20_000); await assert.rejects(store.heartbeat(owner, call.id), /lease ended/);
  await store.beginConnection(owner, call.id); const meter = await store.connectionDeadline(call.id);
  assert.equal(meter.expiresAt - f.now(), 180_000); await store.confirmConnection(call.id, meter);
  assert.equal(f.db.rows.get(`voiceConversations/${call.id}`)!.connectedAt, f.now());
  f.advance(10_000); await store.finish(call.id, { finalized: true, seconds: 10, providerId: 'provider_delayed' });
  assert.equal((await store.reserve(owner, 'remaining')).expiresAt - f.now(), 170_000);
});

test('pre-start cancellation has a bounded durable barrier and failed setup releases unused time', async () => {
  const f = fixture(), owner = f.personal(), store = f.store();
  await store.preCancel(owner, 'early'); await assert.rejects(store.reserve(owner, 'early'), /canceled/);
  assert.equal([...f.db.rows.keys()].some(path => path.startsWith('voiceConversations/')), false);
  f.advance(10_001); const call = await store.reserve(owner, 'failed');
  await store.finish(call.id, { finalized: true, rejected: true });
  assert.equal((await f.store().reserve(owner, 'retry-after-failure')).expiresAt - f.now(), 180_000);
});

test('connection confirmation waits for provider session.started inside the active request, then detaches', async () => {
  const f = fixture(), owner = f.personal(), store = f.store(), id = randomUUID(), waveId = randomUUID();
  owner.waveformId = waveId; f.db.rows.set('ownerWaveforms/tester', { id: waveId });
  const call = await store.reserve(owner, id); await store.created(id, 'provider_connection', call.expiresAt);
  const sockets: Socket[] = [];
  class Socket extends EventEmitter {
    readyState: 0 | 1 | 2 | 3 = WebSocket.OPEN;
    constructor() { super(); sockets.push(this); queueMicrotask(() => this.emit('open')); }
    send() { throw new Error('Startup observation must not issue a greeting or close'); }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'fixture', publicOrigin: 'https://voice.example', requestScopedDemo: true, requestOwnedCleanup: true,
    now: f.now, socketFactory: () => new Socket(), resolveWaveform: async () => ({ ...owner, waveform: { name: 'Fixture', initialPrompt: 'Be brief.' }, isCurrent: () => true }),
    production: { store, policy: () => null, scheduleDeadline: async () => {}, heartbeat: store.heartbeat, beginConnection: store.beginConnection,
      confirmConnection: async id => store.confirmConnection(id, await store.connectionDeadline(id)) },
    requestProvider: (async () => { throw new Error('No new provider request'); }) as typeof fetch });
  const response = await server.PATCH(new Request(`https://voice.example/api/session?waveformId=${waveId}`, { method: 'PATCH',
    headers: { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json', accept: 'application/x-ndjson' }, body: JSON.stringify({ sessionId: id, connect: true }) }));
  assert.equal(response.status, 200);
  const { voiceConnectionReader } = await import('../lib/voice-connection'); const frames = voiceConnectionReader(response);
  assert.equal((await frames.next()).ready, true); assert.equal(f.db.rows.get(`voiceConversations/${id}`)!.connectedAt, undefined);
  f.advance(20_000);
  sockets[0].emit('message', Buffer.from(JSON.stringify({ type: 'session.started', session: { id: 'provider_connection' } })));
  assert.equal((await frames.next()).expiresAt, f.now() + 180_000);
  assert.equal(f.db.rows.get(`voiceConversations/${id}`)!.connectedAt, f.now());
  await frames.cancel(); assert.equal(sockets[0].readyState, WebSocket.CLOSED);
});

test('demo-code admission rejects direct readiness/start requests before provider or credential access', async () => {
  const server = createVoiceServer({ authorizeStart: async () => false, enabled: () => true,
    apiKey: () => { throw new Error('Must not inspect runtime key'); }, requestProvider: (async () => { throw new Error('No provider request'); }) as typeof fetch });
  const origin = 'http://127.0.0.1:3220', headers = { host: '127.0.0.1:3220', origin };
  assert.equal((await (await server.GET(new Request(`${origin}/api/session`, { headers }))).json()).enabled, false);
  assert.equal((await server.POST(new Request(`${origin}/api/session`, { method: 'POST', headers, body: '{}' }))).status, 403);
});


test('provider initialization charge without a confirmed connection does not consume visitor demo time', async () => {
  const f = fixture(), owner = f.personal(), store = f.store(), call = await store.reserve(owner, 'initialization-only');
  await store.created(call.id, 'provider_initialization', call.expiresAt);
  f.advance(20_000); await store.cancel(owner.ownerUid, owner.waveformId, call.id); const claim = await store.claimCleanup(call.id);
  await store.finish(call.id, { finalized: true, seconds: 15, providerId: 'provider_initialization', cleanupEpoch: claim!.cleanup.epoch });
  assert.equal((await store.reserve(owner, 'next')).expiresAt - f.now(), 180_000);
});
