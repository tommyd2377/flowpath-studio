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
  const finish = async (s: ReturnType<typeof store>, id: string, seconds: number) => {
    await s.created(id, `provider_${id}`, db.rows.get(`voiceConversations/${id}`)!.expiresAt as number);
    await s.finish(id, { finalized: true, seconds, providerId: `provider_${id}` });
  };
  return { db, personal, intro, store, finish, now: () => now, advance: (ms: number) => { now += ms; } };
}

test('tester allowance is cumulative by UID across refresh, login, waveform changes, restarts and days', async () => {
  const f = fixture(), owner = f.personal(), first = f.store();
  const call = await first.reserve(owner, 'one'); assert.equal(call.expiresAt - f.now(), 180_000);
  f.advance(60_000); await f.finish(first, call.id, 50);
  const second = f.store();
  const resumed = await second.reserve(owner, 'two'); assert.equal(resumed.expiresAt - f.now(), 120_000);
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
  const call = await store.reserve(owner, 'lease'); await store.created(call.id, 'provider_lease', call.expiresAt);
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
  const call = await store.reserve(owner, 'revocation'); await store.created(call.id, 'provider_revocation', call.expiresAt);
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
    constructor() { super(); sockets++; queueMicrotask(() => this.emit('open')); }
    send(value: string) { assert.equal(JSON.parse(value).type, 'session.close'); queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ type: 'session.closed', session: { id: 'provider' }, usage: { seconds: 2 } })))); }
    terminate() { this.readyState = WebSocket.CLOSED; }
  }
  const worker = () => createVoiceServer({ enabled: () => true, apiKey: () => 'fixture', publicOrigin: 'https://voice.example', requestScopedDemo: true, requestOwnedCleanup: true,
    now: f.now, resolveWaveform: async () => ({ ...owner, waveform, isCurrent: () => true }),
    production: { store, policy: () => policy, heartbeat: store.heartbeat, scheduleDeadline: async () => { schedules++; if (scheduleFailure) throw new Error('task unavailable'); } },
    socketFactory: () => new Socket(), requestProvider: (async () => { providerStarts++; return Response.json({ session: { id: 'provider' }, transport: { sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } }); }) as typeof fetch });
  const req = (method: string, body: object) => new Request(`https://voice.example/api/session?waveformId=${waveform.id}`, { method, headers: { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await worker().POST(req('POST', { sessionId: id, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }));
  assert.equal(response.status, 201); assert.equal((await response.json()).browserControl, true);
  assert.equal(sockets, 0); assert.equal(providerStarts, 1); assert.equal(schedules, 1);
  f.advance(20_000); scheduleFailure = true;
  assert.equal((await worker().PATCH(req('PATCH', { sessionId: id }))).status, 503);
  assert.equal(f.db.rows.get(`voiceConversations/${id}`)!.controlExpiresAt, f.now() + 25_000, 'failed scheduling cannot renew the hold');
  assert.equal((await worker().DELETE(req('DELETE', { sessionId: id }))).status, 200);
  assert.equal(sockets, 1); assert.equal(providerStarts, 1);
  assert.equal((await worker().DELETE(req('DELETE', { sessionId: id }))).status, 200);
});

test('server scope never passes a founder admin override into the introductory allowance', async () => {
  const f = fixture(), intro = f.intro('founder'), store = f.store(), id = randomUUID();
  const policy: VoicePolicy = { ownerDailySeconds: 900, globalDailySeconds: 3600, globalConcurrency: 2, publicDemoSeconds: 180, access: 'signed-in', allowedUids: [] };
  const server = createVoiceServer({ enabled: () => true, apiKey: () => 'fixture', publicOrigin: 'https://voice.example', requestScopedDemo: true, requestOwnedCleanup: true,
    now: f.now, resolvePublicVisitor: async () => intro,
    resolveAdmin: async () => ({ uid: 'founder', accountSessionId: 'founder-session', testing: true, isCurrent: () => true }),
    production: { store, policy: () => policy, heartbeat: store.heartbeat, scheduleDeadline: async () => {} },
    socketFactory: () => { throw new Error('No background socket'); },
    requestProvider: (async () => Response.json({ session: { id: 'provider_intro' }, transport: { sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' } })) as typeof fetch });
  const headers = { host: 'voice.example', origin: 'https://voice.example', 'content-type': 'application/json', 'X-FlowPath-Admin': 'continue' };
  const ready = await (await server.GET(new Request('https://voice.example/api/session', { headers }))).json();
  assert.equal(ready.enabled, true); assert.equal(ready.adminEligible, undefined);
  const response = await server.POST(new Request('https://voice.example/api/session', { method: 'POST', headers,
    body: JSON.stringify({ sessionId: id, sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n' }) }));
  assert.equal(response.status, 201); const body = await response.json();
  assert.equal(body.expiresAt - f.now(), 180_000); assert.equal(body.adminOverride, false);
  assert.equal(f.db.rows.get(`voiceConversations/${id}`)?.admin, undefined);
});
