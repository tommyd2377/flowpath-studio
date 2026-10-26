import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_SESSION_COLLECTION } from '../lib/production-account-session';
import {
  createProductionVoiceStore, productionVoicePolicy, VoiceAdmissionError,
  voiceReservationSeconds, type VoiceDatabase, type VoiceOwner, type VoicePolicy, type VoiceTransaction,
} from '../lib/production-voice-store';
import { VOICE_SESSION_SECONDS } from '../lib/voice-config';
import { PUBLIC_VOICE_SECONDS, PUBLIC_WAVEFORM_ID } from '../lib/public-voice-identity';

/** Separate store instances share serialized transactions, including rollback on errors. */
class MemoryVoiceDatabase implements VoiceDatabase {
  readonly reads: string[] = [];
  private rows = new Map<string, Record<string, unknown>>();
  private pending: Promise<void> = Promise.resolve();

  constructor(seed: [string, Record<string, unknown>][]) {
    this.rows = new Map(structuredClone(seed));
  }

  snapshot() { return structuredClone([...this.rows]); }

  async transaction<T>(work: (tx: VoiceTransaction) => Promise<T>): Promise<T> {
    const previous = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>(resolve => { release = resolve; });
    await previous;
    const next = new Map(structuredClone([...this.rows]));
    try {
      const result = await work({
        get: async path => { this.reads.push(path); return structuredClone(next.get(path) ?? null); },
        set: (path, value) => { next.set(path, structuredClone(value) as Record<string, unknown>); },
      });
      this.rows = next;
      return result;
    } finally { release(); }
  }
}

const start = Date.UTC(2026, 9, 18, 12);
const owner = (id: string): VoiceOwner => ({
  ownerUid: `owner-${id}`, waveformId: `waveform-${id}`, accountSessionId: `account-${id}`,
});
const visitor = (hex = 'a'): VoiceOwner => {
  const accountSessionId = hex.repeat(64);
  return { kind: 'visitor', ownerUid: `visitor:${accountSessionId}`, accountSessionId, waveformId: PUBLIC_WAVEFORM_ID };
};
const accountPath = (value: VoiceOwner) => `${ACCOUNT_SESSION_COLLECTION}/${value.accountSessionId}`;
const policy: VoicePolicy = {
  ownerDailySeconds: 3_600, globalDailySeconds: 9_000, globalConcurrency: 3,
  access: 'signed-in', allowedUids: [],
};
const publicPolicy = { ...policy, publicDemoSeconds: 180 };
const env = {
  FLOWPATH_LIVE_ENABLED: '1', FLOWPATH_VOICE_OWNER_DAILY_SECONDS: '900',
  FLOWPATH_VOICE_GLOBAL_DAILY_SECONDS: '1800', FLOWPATH_VOICE_GLOBAL_CONCURRENCY: '1',
  FLOWPATH_VOICE_ACCESS: 'signed-in',
};
function database(...owners: VoiceOwner[]) {
  return new MemoryVoiceDatabase(owners.map(value => [accountPath(value), {
    uid: value.ownerUid, state: 'active', expiresAt: start + 3 * 86_400_000,
  }]));
}
function admissionError(status: number, message?: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof VoiceAdmissionError);
    assert.equal(error.status, status);
    if (message) assert.match(error.message, message);
    return true;
  };
}

test('production voice stays off until explicit complete bounded policy is configured', () => {
  assert.equal(VOICE_SESSION_SECONDS, 900);
  assert.equal(productionVoicePolicy({}), null);
  for (const key of Object.keys(env)) {
    assert.equal(productionVoicePolicy({ ...env, [key]: undefined }), null, key);
  }
  for (const override of [
    { FLOWPATH_LIVE_ENABLED: '0' },
    { FLOWPATH_VOICE_OWNER_DAILY_SECONDS: '899' },
    { FLOWPATH_VOICE_GLOBAL_DAILY_SECONDS: '899' },
    { FLOWPATH_VOICE_OWNER_DAILY_SECONDS: '900.5' },
    { FLOWPATH_VOICE_GLOBAL_DAILY_SECONDS: '9007199254740992' },
    { FLOWPATH_VOICE_GLOBAL_CONCURRENCY: '0' },
    { FLOWPATH_VOICE_GLOBAL_CONCURRENCY: '21' },
    { FLOWPATH_VOICE_GLOBAL_CONCURRENCY: '1.5' },
    { FLOWPATH_VOICE_ACCESS: 'public' },
    { FLOWPATH_VOICE_ACCESS: 'invite-only', FLOWPATH_VOICE_ALLOWED_UIDS: ' , ' },
  ]) assert.equal(productionVoicePolicy({ ...env, ...override }), null);
  assert.deepEqual(productionVoicePolicy(env), {
    ownerDailySeconds: 900, globalDailySeconds: 1_800, globalConcurrency: 1,
    access: 'signed-in', allowedUids: [],
  });
  assert.deepEqual(productionVoicePolicy({
    ...env, FLOWPATH_VOICE_ACCESS: 'invite-only', FLOWPATH_VOICE_ALLOWED_UIDS: ' owner-a,owner-b , ',
  })?.allowedUids, ['owner-a', 'owner-b']);
});

test('invitation admission rejects other owners without writing reservations', async () => {
  const a = owner('a'), b = owner('b'), db = database(a, b);
  const store = createProductionVoiceStore(db, () => start);
  const invitation: VoicePolicy = { ...policy, access: 'invite-only', allowedUids: [a.ownerUid] };
  const before = db.snapshot();
  await assert.rejects(store.available(b, invitation), admissionError(403, /invitation/));
  await assert.rejects(store.reserve(b, 'uninvited', invitation), admissionError(403, /invitation/));
  assert.deepEqual(db.snapshot(), before);
  assert.equal((await store.reserve(a, 'invited', invitation)).state, 'creating');
});

test('two server instances atomically admit only one call at a global concurrency of one', async () => {
  const a = owner('a'), b = owner('b'), db = database(a, b);
  const first = createProductionVoiceStore(db, () => start);
  const second = createProductionVoiceStore(db, () => start);
  const singleSlot = { ...policy, globalConcurrency: 1 };
  const attempts = await Promise.allSettled([
    first.reserve(a, 'concurrent-a', singleSlot), second.reserve(b, 'concurrent-b', singleSlot),
  ]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  const failure = attempts.find(result => result.status === 'rejected');
  assert.ok(failure?.status === 'rejected');
  admissionError(409, /connections are in use/)(failure.reason);
  const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
  assert.equal(global?.reservedSeconds, 900);
  assert.equal(Object.keys(global?.active as object).length, 1);
  assert.equal(db.snapshot().filter(([path]) => path.startsWith('voiceConversations/')).length, 1);
});

test('each owner gets one active reservation even when the global pool has spare slots', async () => {
  const a = owner('a'), b = owner('b'), db = database(a, b);
  const first = createProductionVoiceStore(db, () => start);
  const second = createProductionVoiceStore(db, () => start);
  await first.reserve(a, 'owner-first', policy);
  await assert.rejects(second.reserve(a, 'owner-second', policy), admissionError(409, /previous conversation/));
  await second.reserve(b, 'other-owner', policy);
  await first.finish('owner-first', { finalized: true, seconds: 2 });
  await second.reserve(a, 'owner-after-close', policy);
});

test('every attempt reserves all 900 seconds with no refund for short or rejected calls', async () => {
  const a = owner('a'), b = owner('b'), c = owner('c'), db = database(a, b, c);
  const store = createProductionVoiceStore(db, () => start);
  const bounded = { ...policy, ownerDailySeconds: 900, globalDailySeconds: 1_800 };
  const call = await store.reserve(a, 'short-call', bounded);
  assert.equal(call.expiresAt - call.createdAt, 900_000);
  await store.created(call.id, 'synthetic-provider', call.expiresAt);
  await store.finish(call.id, { finalized: true, seconds: 1 });
  await assert.rejects(store.reserve(a, 'owner-over-budget', bounded), admissionError(429));
  await store.reserve(b, 'provider-rejected', bounded);
  await store.finish('provider-rejected', { finalized: true, rejected: true });
  const rejected = await db.transaction(tx => tx.get('voiceConversations/provider-rejected'));
  assert.equal(rejected?.state, 'rejected');
  const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
  assert.equal(global?.reservedSeconds, 1_800);
  assert.deepEqual(global?.active, {});
  await assert.rejects(store.reserve(c, 'global-over-budget', bounded), admissionError(429));
});

test('a used identifier cannot create another call or alter quotas after confirmed closure', async () => {
  const a = owner('a'), db = database(a);
  const first = createProductionVoiceStore(db, () => start);
  await first.reserve(a, 'one-use', policy);
  await first.finish('one-use', { finalized: true, seconds: 1 });
  const before = db.snapshot();
  const restarted = createProductionVoiceStore(db, () => start);
  await assert.rejects(restarted.reserve(a, 'one-use', policy), admissionError(409, /already been used/));
  assert.deepEqual(db.snapshot(), before);
});

test('uncertain cleanup blocks all instances and survives expiry and a day change until confirmed closure', async () => {
  const a = owner('a'), b = owner('b'), db = database(a, b);
  let now = start;
  const first = createProductionVoiceStore(db, () => now);
  await first.reserve(a, 'uncertain-call', policy);
  await first.created('uncertain-call', 'synthetic-provider', start + 900_000);
  await first.finish('uncertain-call', { finalized: false });
  now += 86_400_000;
  const restarted = createProductionVoiceStore(db, () => now);
  await assert.rejects(restarted.available(b, policy), admissionError(503, /confirmed cleanup/));
  await assert.rejects(restarted.reserve(b, 'after-restart', policy), admissionError(503));
  const uncertain = await db.transaction(tx => tx.get('voiceConversations/uncertain-call'));
  assert.equal(uncertain?.state, 'uncertain');
  await restarted.finish('uncertain-call', { finalized: true, seconds: 900 });
  await restarted.available(a, policy);
  await restarted.reserve(b, 'confirmed-cleanup', policy);
});

test('expiry alone never releases pending or active reservations', async () => {
  for (const state of ['creating', 'active'] as const) {
    const a = owner('a'), b = owner('b'), db = database(a, b);
    let now = start;
    const first = createProductionVoiceStore(db, () => now);
    const call = await first.reserve(a, state, { ...policy, globalConcurrency: 1 });
    if (state === 'active') await first.created(state, 'synthetic-provider', call.expiresAt);
    now = call.expiresAt + 1;
    const restarted = createProductionVoiceStore(db, () => now);
    await assert.rejects(restarted.available(b, { ...policy, globalConcurrency: 1 }), admissionError(409));
    await assert.rejects(restarted.available(a, policy), admissionError(409, /previous conversation/));
    await restarted.finish(state, { finalized: true, seconds: 900 });
    await restarted.available(b, { ...policy, globalConcurrency: 1 });
  }
});

test('account invalidation and reservation serialize together rather than trusting a previous availability check', async () => {
  for (const state of ['changing', 'revoked']) {
    const a = owner(state), db = database(a);
    const store = createProductionVoiceStore(db, () => start);
    await store.available(a, policy);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const changing = db.transaction(async tx => {
      const auth = await tx.get(accountPath(a));
      tx.set(accountPath(a), { ...auth, state, changeUntil: start - 1 });
      await gate;
    });
    const reservation = store.reserve(a, `invalid-${state}`, policy);
    release();
    await changing;
    await assert.rejects(reservation, admissionError(403, /Sign in again/));
    assert.deepEqual(db.snapshot().map(([path]) => path), [accountPath(a)]);
  }
});

test('missing, expired, or wrong-owner account sessions cannot reserve a conversation', async () => {
  const a = owner('a');
  for (const auth of [null, { uid: a.ownerUid, state: 'active', expiresAt: start },
    { uid: 'another-owner', state: 'active', expiresAt: start + 10_000 }]) {
    const db = new MemoryVoiceDatabase(auth ? [[accountPath(a), auth]] : []);
    const store = createProductionVoiceStore(db, () => start);
    const before = db.snapshot();
    await assert.rejects(store.reserve(a, 'bad-account', policy), admissionError(403));
    assert.deepEqual(db.snapshot(), before);
  }
});

test('cross-instance cancellation persists during creation and active playback without releasing the slot', async () => {
  for (const state of ['creating', 'active'] as const) {
    const a = owner('a'), b = owner('b'), db = database(a, b);
    const first = createProductionVoiceStore(db, () => start);
    const second = createProductionVoiceStore(db, () => start);
    await first.reserve(a, state, policy);
    if (state === 'active') assert.equal(await first.created(state, 'synthetic-provider', start + 900_000), false);
    await assert.rejects(second.cancel(b.ownerUid, a.waveformId, state), admissionError(403));
    await assert.rejects(second.cancel(a.ownerUid, 'wrong-waveform', state), admissionError(403));
    const canceled = await second.cancel(a.ownerUid, a.waveformId);
    assert.equal(canceled?.canceled, true);
    assert.equal(canceled?.state, state);
    const restarted = createProductionVoiceStore(db, () => start);
    assert.equal((await restarted.cancel(a.ownerUid, a.waveformId, state))?.canceled, true);
    await assert.rejects(restarted.available(a, policy), admissionError(409));
    if (state === 'creating') assert.equal(await first.created(state, 'synthetic-provider', start + 900_000), true);
    const persisted = await db.transaction(tx => tx.get(`voiceConversations/${state}`));
    assert.equal(persisted?.canceled, true);
    assert.equal(persisted?.providerId, 'synthetic-provider');
    await first.finish(state, { finalized: true, seconds: 2 });
    await restarted.available(a, policy);
    assert.equal((await restarted.cancel(a.ownerUid, a.waveformId, state))?.state, 'closed');
  }
});

test('a pending call may start only while uncanceled, before its deadline, with the current active account', async () => {
  for (const invalidation of ['canceled', 'deadline', 'changing', 'revoked', 'expired', 'wrong-owner']) {
    const a = owner('a'), db = database(a);
    let now = start;
    const store = createProductionVoiceStore(db, () => now);
    assert.equal(await store.mayStart('missing'), false);
    const call = await store.reserve(a, 'pending', policy);
    assert.equal(await store.mayStart(call.id), true);
    if (invalidation === 'canceled') await store.cancel(a.ownerUid, a.waveformId, call.id);
    else if (invalidation === 'deadline') now = call.expiresAt;
    else await db.transaction(async tx => {
      const auth = await tx.get(accountPath(a));
      tx.set(accountPath(a), {
        ...auth,
        ...(invalidation === 'expired' ? { expiresAt: now } : invalidation === 'wrong-owner'
          ? { uid: 'another-owner' } : { state: invalidation }),
      });
    });
    const restarted = createProductionVoiceStore(db, () => now);
    assert.equal(await restarted.mayStart(call.id), false, invalidation);
  }
  const a = owner('a'), db = database(a);
  const store = createProductionVoiceStore(db, () => start);
  const call = await store.reserve(a, 'active', policy);
  await store.created(call.id, 'synthetic-provider', call.expiresAt);
  assert.equal(await store.mayStart(call.id), false, 'an active call cannot be started again');
});

test('deadline expiry records cancellation without releasing guards until confirmed cleanup', async () => {
  for (const state of ['creating', 'active'] as const) {
    const a = owner('a'), b = owner('b'), db = database(a, b);
    let now = start;
    const store = createProductionVoiceStore(db, () => now);
    assert.equal(await store.expire('missing'), null);
    const call = await store.reserve(a, state, { ...policy, globalConcurrency: 1 });
    if (state === 'active') await store.created(call.id, 'synthetic-provider', call.expiresAt);
    const before = db.snapshot();
    await assert.rejects(store.expire(call.id), /deadline has not arrived/);
    assert.deepEqual(db.snapshot(), before);
    now = call.expiresAt;
    const restarted = createProductionVoiceStore(db, () => now);
    const expired = await restarted.expire(call.id);
    assert.equal(expired?.canceled, true);
    const expiredState = state === 'creating' ? 'uncertain' : 'active';
    assert.equal(expired?.state, expiredState);
    const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
    assert.deepEqual(global?.active, { [state]: expiredState });
    const status = state === 'creating' ? 503 : 409;
    await assert.rejects(restarted.available(b, { ...policy, globalConcurrency: 1 }), admissionError(status));
    await assert.rejects(restarted.available(a, policy), admissionError(status));
    if (state === 'creating') await assert.rejects(restarted.available(b, policy), admissionError(503));
    else await restarted.available(b, policy);
    await restarted.finish(call.id, { finalized: true, seconds: 900 });
    const closed = await restarted.expire(call.id);
    assert.equal(closed?.state, 'closed');
    await restarted.available(b, { ...policy, globalConcurrency: 1 });
  }
});

test('cancellation beating creation on another instance saves a one-use tombstone without reserving allowance', async () => {
  const a = owner('a'), db = database(a);
  const first = createProductionVoiceStore(db, () => start);
  const second = createProductionVoiceStore(db, () => start);
  assert.equal(await first.cancel(a.ownerUid, a.waveformId, 'without-account'), null);
  const canceled = await first.cancel(a.ownerUid, a.waveformId, 'canceled-before-post', a.accountSessionId);
  assert.equal(canceled?.state, 'rejected');
  assert.equal(canceled?.canceled, true);
  assert.equal(canceled?.accountSessionId, a.accountSessionId);
  assert.equal(await second.mayStart('canceled-before-post'), false);
  await assert.rejects(second.reserve(a, 'canceled-before-post', policy), admissionError(409, /already been used/));
  assert.equal(await db.transaction(tx => tx.get('voiceAdmission/global')), null);
  assert.equal(db.snapshot().filter(([path]) => path.startsWith('voiceOwners/')).length, 0);
  await second.available(a, policy);
  await second.reserve(a, 'fresh-identifier', policy);
  const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
  assert.equal(global?.reservedSeconds, 900);
  assert.deepEqual(global?.active, { 'fresh-identifier': 'creating' });
});

test('confirmed closure requires valid final usage and terminal records cannot regress to uncertain or active', async () => {
  const a = owner('a'), db = database(a);
  const store = createProductionVoiceStore(db, () => start);
  const call = await store.reserve(a, 'validated-usage', policy);
  await store.created(call.id, 'synthetic-provider', call.expiresAt);
  const before = db.snapshot();
  for (const seconds of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    await assert.rejects(store.finish(call.id, { finalized: true, seconds }), /Confirmed final usage/);
    assert.deepEqual(db.snapshot(), before);
  }
  await store.finish(call.id, { finalized: true, seconds: 0 });
  const closed = db.snapshot();
  await store.finish(call.id, { finalized: false });
  await store.finish(call.id, { finalized: true, rejected: true });
  await assert.rejects(store.created(call.id, 'another-provider', call.expiresAt), /no longer creating/);
  assert.deepEqual(db.snapshot(), closed);

  await store.reserve(a, 'provider-rejection', policy);
  await store.finish('provider-rejection', { finalized: true, rejected: true });
  const rejected = db.snapshot();
  await store.finish('provider-rejection', { finalized: false });
  await store.finish('provider-rejection', { finalized: true, seconds: 1 });
  await assert.rejects(store.created('provider-rejection', 'another-provider', call.expiresAt), /no longer creating/);
  assert.deepEqual(db.snapshot(), rejected);
});

test('corrupt owner or global allowance counters fail closed without new reservations or quota resets', async () => {
  for (const scope of ['global', 'owner']) {
    for (const reservedSeconds of [Number.NaN, -1, undefined]) {
      const a = owner('a'), db = database(a);
      const store = createProductionVoiceStore(db, () => start);
      await store.reserve(a, 'completed', policy);
      await store.finish('completed', { finalized: true, seconds: 1 });
      const path = scope === 'global' ? 'voiceAdmission/global'
        : db.snapshot().find(([key]) => key.startsWith('voiceOwners/'))![0];
      await db.transaction(async tx => { tx.set(path, { ...await tx.get(path), reservedSeconds }); });
      const corrupted = db.snapshot();
      const restarted = createProductionVoiceStore(db, () => start);
      await assert.rejects(restarted.available(a, policy), /Invalid voice allowance/);
      await assert.rejects(restarted.reserve(a, 'blocked', policy), /Invalid voice allowance/);
      assert.deepEqual(db.snapshot(), corrupted);
    }
  }
});

test('malformed active guards fail closed instead of treating corrupted state as an empty pool', async () => {
  for (const scope of ['global', 'owner']) {
    for (const active of [[], ['synthetic'], undefined]) {
      const a = owner('a'), db = database(a);
      const store = createProductionVoiceStore(db, () => start);
      await store.reserve(a, 'completed', policy);
      await store.finish('completed', { finalized: true, seconds: 1 });
      const path = scope === 'global' ? 'voiceAdmission/global'
        : db.snapshot().find(([key]) => key.startsWith('voiceOwners/'))![0];
      await db.transaction(async tx => { tx.set(path, { ...await tx.get(path), active }); });
      const corrupted = db.snapshot();
      const restarted = createProductionVoiceStore(db, () => start);
      await assert.rejects(restarted.available(a, policy), /Invalid voice admission state/);
      await assert.rejects(restarted.reserve(a, 'blocked', policy), /Invalid voice admission state/);
      assert.deepEqual(db.snapshot(), corrupted);
    }
  }
});

test('a failed synthetic transaction rolls back all writes and does not poison subsequent transactions', async () => {
  const db = database();
  await assert.rejects(db.transaction(async tx => {
    tx.set('synthetic/partial', { written: true });
    throw new Error('Synthetic failed transaction');
  }), /Synthetic failed transaction/);
  assert.deepEqual(db.snapshot(), []);
  await db.transaction(async tx => { tx.set('synthetic/committed', { written: true }); });
  assert.deepEqual(db.snapshot(), [['synthetic/committed', { written: true }]]);
});

test('uncertain cleanup can recover a missing known provider ID but cannot replace it or accept an invalid ID', async () => {
  const a = owner('a'), db = database(a);
  const store = createProductionVoiceStore(db, () => start);
  await store.reserve(a, 'recover-known-provider', policy);
  await store.finish('recover-known-provider', { finalized: false, providerId: 'live_known_synthetic' });
  const before = db.snapshot();
  const call = await db.transaction(tx => tx.get('voiceConversations/recover-known-provider'));
  assert.equal(call?.providerId, 'live_known_synthetic');
  await assert.rejects(store.finish('recover-known-provider', { finalized: false, providerId: 'live_different_synthetic' }), /does not match/);
  await assert.rejects(store.finish('recover-known-provider', { finalized: false, providerId: '../invalid' }), /Invalid provider/);
  assert.deepEqual(db.snapshot(), before);
  await store.finish('recover-known-provider', { finalized: true, seconds: 2, providerId: 'live_known_synthetic' });
  assert.equal((await db.transaction(tx => tx.get('voiceConversations/recover-known-provider')))?.state, 'closed');
});

test('the public demo is an explicit 180-second opt-in and does not change member policy', () => {
  assert.equal(productionVoicePolicy(env)?.publicDemoSeconds, undefined);
  assert.equal(productionVoicePolicy({ ...env, FLOWPATH_PUBLIC_DEMO_ENABLED: '0' })?.publicDemoSeconds, undefined);
  assert.equal(productionVoicePolicy({ ...env, FLOWPATH_PUBLIC_DEMO_ENABLED: 'true' })?.publicDemoSeconds, undefined);
  assert.equal(productionVoicePolicy({ ...env, FLOWPATH_PUBLIC_DEMO_ENABLED: '1' })?.publicDemoSeconds, PUBLIC_VOICE_SECONDS);
  assert.equal(PUBLIC_VOICE_SECONDS, 180);
  assert.equal(voiceReservationSeconds(owner('member'), publicPolicy), 900);
  assert.equal(voiceReservationSeconds(visitor(), publicPolicy), 180);
});

test('a valid visitor reserves 180 seconds without account-session reads or invitation membership', async () => {
  const guest = visitor(), db = database();
  const store = createProductionVoiceStore(db, () => start);
  const invitationPolicy: VoicePolicy = { ...publicPolicy, access: 'invite-only', allowedUids: ['unrelated-member'] };
  await store.available(guest, invitationPolicy);
  const call = await store.reserve(guest, 'public-demo', invitationPolicy);
  assert.equal(call.kind, 'visitor');
  assert.equal(call.expiresAt - call.createdAt, 180_000);
  assert.equal(await store.mayStart(call.id), true);
  assert.equal(db.reads.some(path => path.startsWith(`${ACCOUNT_SESSION_COLLECTION}/`)), false);
  assert.equal(db.snapshot().some(([path]) => path.startsWith(`${ACCOUNT_SESSION_COLLECTION}/`)), false);
  assert.equal((await db.transaction(tx => tx.get('voiceAdmission/global')))?.reservedSeconds, 180);
});

test('visitor and member duration reservations share the global budget while retaining separate daily limits', async () => {
  const guest = visitor(), member = owner('member'), db = database(member);
  const store = createProductionVoiceStore(db, () => start);
  const demo = await store.reserve(guest, 'visitor-duration', publicPolicy);
  const personal = await store.reserve(member, 'member-duration', publicPolicy);
  assert.equal(demo.expiresAt - demo.createdAt, 180_000);
  assert.equal(personal.expiresAt - personal.createdAt, 900_000);
  assert.equal((await db.transaction(tx => tx.get('voiceAdmission/global')))?.reservedSeconds, 1_080);
  await store.finish(demo.id, { finalized: true, seconds: 1 });
  await assert.rejects(store.reserve(guest, 'second-visitor-demo', publicPolicy), admissionError(429));
  await store.finish(personal.id, { finalized: true, seconds: 1 });
  assert.equal((await store.reserve(member, 'second-member-call', publicPolicy)).expiresAt - start, 900_000);
});

test('visitor allowance is never refunded for early endings or rejected attempts', async () => {
  const a = visitor('a'), b = visitor('b'), c = visitor('c'), db = database();
  const store = createProductionVoiceStore(db, () => start);
  const bounded = { ...publicPolicy, globalDailySeconds: 360 };
  await store.reserve(a, 'short-public-call', bounded);
  await store.finish('short-public-call', { finalized: true, seconds: 1 });
  await assert.rejects(store.reserve(a, 'public-refund-attempt', bounded), admissionError(429));
  await store.reserve(b, 'rejected-public-call', bounded);
  await store.finish('rejected-public-call', { finalized: true, rejected: true });
  await assert.rejects(store.reserve(b, 'rejected-refund-attempt', bounded), admissionError(429));
  await assert.rejects(store.reserve(c, 'visitor-global-budget', bounded), admissionError(429));
  assert.equal((await db.transaction(tx => tx.get('voiceAdmission/global')))?.reservedSeconds, 360);
});

test('visitor and member admission races obey the same global concurrency guard', async () => {
  const member = owner('member'), guest = visitor(), db = database(member);
  const first = createProductionVoiceStore(db, () => start), second = createProductionVoiceStore(db, () => start);
  const bounded = { ...publicPolicy, globalConcurrency: 1 };
  const attempts = await Promise.allSettled([
    first.reserve(guest, 'visitor-concurrent', bounded), second.reserve(member, 'member-concurrent', bounded),
  ]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  const failure = attempts.find(value => value.status === 'rejected');
  assert.ok(failure?.status === 'rejected');
  admissionError(409, /connections are in use/)(failure.reason);
  const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
  assert.equal(Object.keys(global?.active as object).length, 1);
  assert.ok(global?.reservedSeconds === 180 || global?.reservedSeconds === 900);
});

test('visitors and members cannot overspend the shared global allowance in either order', async () => {
  for (const visitorFirst of [true, false]) {
    const member = owner('member'), guest = visitor(), db = database(member);
    const store = createProductionVoiceStore(db, () => start);
    const bounded = { ...publicPolicy, globalDailySeconds: 900 };
    await store.reserve(visitorFirst ? guest : member, 'first-budget-user', bounded);
    await store.finish('first-budget-user', { finalized: true, seconds: 1 });
    await assert.rejects(store.reserve(visitorFirst ? member : guest, 'second-budget-user', bounded), admissionError(429));
  }
});

test('missing or malformed public policy and visitor capabilities fail closed', async () => {
  const db = database(), guest = visitor(), store = createProductionVoiceStore(db, () => start);
  for (const seconds of [undefined, 0, -1, NaN, Infinity, 1.5, 901]) {
    await assert.rejects(store.reserve(guest, `disabled-demo-${seconds}`, { ...policy, publicDemoSeconds: seconds }), admissionError(503));
  }
  const invalid = [
    { ...guest, ownerUid: 'visitor:somebody-else' },
    { ...guest, accountSessionId: 'A'.repeat(64), ownerUid: `visitor:${'A'.repeat(64)}` },
    { ...guest, accountSessionId: 'a'.repeat(63), ownerUid: `visitor:${'a'.repeat(63)}` },
    { ...guest, waveformId: 'private-waveform' },
    { ...guest, kind: 'member' },
  ];
  for (const value of invalid) await assert.rejects(store.reserve(value as VoiceOwner, 'invalid-public-capability', publicPolicy), admissionError(403));
  await assert.rejects(store.reserve({ ...guest, kind: undefined }, 'missing-public-kind', publicPolicy), admissionError(403, /Sign in/));
  assert.equal(db.snapshot().length, 0);
});

test('public cancellation isolates visitor capabilities and preserves visitor tombstones', async () => {
  const a = visitor('a'), b = visitor('b'), db = database(), store = createProductionVoiceStore(db, () => start);
  await store.reserve(a, 'private-to-visitor-a', publicPolicy);
  const before = db.snapshot();
  await assert.rejects(store.cancel(b.ownerUid, b.waveformId, 'private-to-visitor-a', b.accountSessionId, b.kind), admissionError(403));
  await assert.rejects(store.cancel(a.ownerUid, a.waveformId, 'private-to-visitor-a', b.accountSessionId, 'visitor'), admissionError(403));
  assert.deepEqual(db.snapshot(), before);
  const canceled = await store.cancel(b.ownerUid, b.waveformId, 'visitor-tombstone', b.accountSessionId, b.kind, publicPolicy);
  assert.equal(canceled?.kind, 'visitor');
  assert.equal(canceled?.ownerUid, b.ownerUid);
  assert.equal(canceled?.state, 'rejected');
  await assert.rejects(store.reserve(b, 'visitor-tombstone', publicPolicy), admissionError(409, /already been used/));
  assert.equal((await db.transaction(tx => tx.get('voiceAdmission/global')))?.reservedSeconds, 360);
  const ownCanceled = await store.cancel(a.ownerUid, a.waveformId, 'private-to-visitor-a', a.accountSessionId, a.kind);
  assert.equal(ownCanceled?.canceled, true);
  assert.equal(await store.mayStart('private-to-visitor-a'), false);
});

test('unknown public calls keep all admission blocked across restarts and midnight', async () => {
  const guest = visitor(), member = owner('member'), db = database(member);
  let now = start;
  const store = createProductionVoiceStore(db, () => now);
  await store.reserve(guest, 'unknown-public-call', publicPolicy);
  await store.finish('unknown-public-call', { finalized: false });
  now += 86_400_000;
  const restarted = createProductionVoiceStore(db, () => now);
  await assert.rejects(restarted.available(visitor('b'), publicPolicy), admissionError(503, /confirmed cleanup/));
  await assert.rejects(restarted.available(member, publicPolicy), admissionError(503, /confirmed cleanup/));
  await restarted.finish('unknown-public-call', { finalized: true, seconds: 180 });
  await restarted.available(guest, publicPolicy);
});

test('a stored visitor cannot start after its deadline or with corrupted capability metadata', async () => {
  const guest = visitor(), db = database();
  let now = start;
  const store = createProductionVoiceStore(db, () => now);
  const call = await store.reserve(guest, 'visitor-validity', publicPolicy);
  assert.equal(await store.mayStart(call.id), true);
  now = call.expiresAt;
  assert.equal(await store.mayStart(call.id), false);
  now = start;
  await db.transaction(async tx => {
    const value = await tx.get('voiceConversations/visitor-validity');
    tx.set('voiceConversations/visitor-validity', { ...value, ownerUid: 'visitor:different-cookie' });
  });
  await assert.rejects(store.mayStart(call.id), /Invalid durable voice/);
  assert.equal(db.reads.some(path => path.startsWith(`${ACCOUNT_SESSION_COLLECTION}/`)), false);
});

test('unknown visitor cancellation consumes one attempt and cannot create unlimited tombstones', async () => {
  const guest = visitor(), db = database(), store = createProductionVoiceStore(db, () => start);
  const canceled = await store.cancel(guest.ownerUid, guest.waveformId, 'first-visitor-precancel', guest.accountSessionId, guest.kind, publicPolicy);
  assert.equal(canceled?.state, 'rejected');
  const before = db.snapshot();
  for (let index = 0; index < 30; index++) {
    await assert.rejects(store.cancel(guest.ownerUid, guest.waveformId, `other-visitor-precancel-${index}`,
      guest.accountSessionId, guest.kind, publicPolicy), admissionError(429));
  }
  assert.deepEqual(db.snapshot(), before, 'rejected cancellation attempts write nothing');
  const global = await db.transaction(tx => tx.get('voiceAdmission/global'));
  assert.equal(global?.reservedSeconds, 180);
  assert.deepEqual(global?.active, {}, 'a tombstone consumes allowance without occupying an active slot');
  assert.equal(before.filter(([path]) => path.startsWith('voiceConversations/')).length, 1);
  assert.equal(db.reads.some(path => path.startsWith(`${ACCOUNT_SESSION_COLLECTION}/`)), false);
  await assert.rejects(store.reserve(guest, 'first-visitor-precancel', publicPolicy), admissionError(409, /already been used/));
  await assert.rejects(store.reserve(guest, 'new-visitor-creation', publicPolicy), admissionError(429));
});

test('unknown cancellations from fresh visitors share the same finite global attempt allowance', async () => {
  const db = database(), store = createProductionVoiceStore(db, () => start);
  const bounded = { ...publicPolicy, globalDailySeconds: 360 };
  for (const [index, hex] of ['a', 'b'].entries()) {
    const guest = visitor(hex);
    await store.cancel(guest.ownerUid, guest.waveformId, `global-precancel-${index}`, guest.accountSessionId, guest.kind, bounded);
  }
  const before = db.snapshot(), third = visitor('c');
  await assert.rejects(store.cancel(third.ownerUid, third.waveformId, 'global-precancel-over-budget',
    third.accountSessionId, third.kind, bounded), admissionError(429));
  assert.deepEqual(db.snapshot(), before);
  assert.equal(before.filter(([path]) => path.startsWith('voiceConversations/')).length, 2);
  assert.equal((await db.transaction(tx => tx.get('voiceAdmission/global')))?.reservedSeconds, 360);
  assert.equal(db.reads.some(path => path.startsWith(`${ACCOUNT_SESSION_COLLECTION}/`)), false);
});

test('paused public demos create no unknown cancellation tombstones while known calls remain cancellable', async () => {
  const guest = visitor(), db = database(), store = createProductionVoiceStore(db, () => start);
  for (const currentPolicy of [undefined, policy, { ...publicPolicy, publicDemoSeconds: 0 }]) {
    assert.equal(await store.cancel(guest.ownerUid, guest.waveformId, 'paused-public-cancel', guest.accountSessionId,
      guest.kind, currentPolicy), null);
  }
  assert.deepEqual(db.snapshot(), []);
  await store.reserve(guest, 'known-public-call', publicPolicy);
  const known = await store.cancel(guest.ownerUid, guest.waveformId, 'known-public-call', guest.accountSessionId, guest.kind);
  assert.equal(known?.canceled, true);
  assert.equal(known?.state, 'creating');
});

test('admin sees the ordinary public limit, then explicitly continues within the original 15 minutes across instances', async () => {
  let clock = start;
  const db = database(owner('admin'));
  const regular = { ...visitor(), admin: { uid: owner('admin').ownerUid, accountSessionId: owner('admin').accountSessionId, override: false } };
  const first = createProductionVoiceStore(db, () => clock);
  const call = await first.reserve(regular, 'normal-demo', publicPolicy);
  assert.equal(call.expiresAt, start + 180_000);
  assert.equal(call.admin?.deadline, start + 900_000);
  const admin = { ...regular, admin: { ...regular.admin, override: true, previousSessionId: call.id } };
  await assert.rejects(first.reserve(admin, 'too-soon', publicPolicy), /previous conversation must close/);
  await first.created(call.id, 'synthetic_provider', call.expiresAt);
  await first.finish(call.id, { finalized: true, seconds: 180 });
  clock += 180_000;
  await assert.rejects(first.available(regular, publicPolicy), admissionError(429, /three-minute/));
  const restarted = createProductionVoiceStore(db, () => clock);
  const continuation = await restarted.reserve(admin, 'admin-continuation', publicPolicy);
  assert.equal(continuation.expiresAt, start + 900_000);
  await restarted.created(continuation.id, 'synthetic_admin', continuation.expiresAt);
  await restarted.finish(continuation.id, { finalized: true, seconds: 720 });
  clock = start + 900_000;
  await assert.rejects(restarted.reserve({ ...admin, admin: { ...admin.admin, previousSessionId: continuation.id } }, 'past-cap', publicPolicy), /overall 15-minute/);
});

test('admin continuation remains bound to its account, waveform and confirmed cleanup; global guards still apply', async () => {
  const db = database(owner('a'), owner('b'));
  const store = createProductionVoiceStore(db, () => start);
  const regular = { ...owner('a'), admin: { uid: owner('a').ownerUid, accountSessionId: owner('a').accountSessionId, override: false } };
  const call = await store.reserve(regular, 'initial-admin', policy);
  await store.finish(call.id, { finalized: true, seconds: 1 });
  const admin = { ...regular, admin: { ...regular.admin, override: true, previousSessionId: call.id } };
  await assert.rejects(store.reserve({ ...admin, waveformId: 'another-waveform' }, 'other-wave', policy), /previous conversation/);
  await assert.rejects(store.reserve({ ...owner('b'), admin: { ...admin.admin, uid: owner('b').ownerUid, accountSessionId: owner('b').accountSessionId } }, 'other-account', policy), /previous conversation/);
  await assert.rejects(store.reserve(admin, 'global-cap', { ...policy, globalDailySeconds: 900 }), /shared test limit.*15-minute block/);
  await assert.rejects(store.reserve({ ...admin, admin: { ...admin.admin, accountSessionId: 'revoked' } }, 'revoked-admin', policy), /Sign in again/);
});

test('admin budget messages explain a partial block without refunding or resetting reservations', async () => {
  const a = owner('admin');
  const admin = { ...a, admin: { uid: a.ownerUid, accountSessionId: a.accountSessionId, override: true } };
  const db = database(a);
  await db.transaction(async tx => { tx.set('voiceAdmission/global', { day: new Date(start).toISOString().slice(0, 10), reservedSeconds: 3060, active: {} }); });
  const store = createProductionVoiceStore(db, () => start);
  const bounded = { ...policy, globalDailySeconds: 3600 };
  const before = db.snapshot();
  await assert.rejects(store.available(admin, bounded), admissionError(429, /9 minutes left.*15-minute block.*even if you end early/));
  await assert.rejects(store.reserve(admin, 'does-not-fit', bounded), admissionError(429));
  assert.deepEqual(db.snapshot(), before);
  const call = await store.reserve(admin, 'fits-approved-budget', { ...bounded, globalDailySeconds: 7200 });
  assert.equal(call.expiresAt, start + 900_000);
  const global = db.snapshot().find(([path]) => path === 'voiceAdmission/global')![1];
  assert.equal(global.reservedSeconds, 3960, 'the old reservations remain intact');
});

test('sign-out can cancel the founder homepage session and revoked admin sessions cannot reach the provider', async () => {
  const adminOwner = owner('admin');
  const db = database(adminOwner);
  const store = createProductionVoiceStore(db, () => start);
  const regular = { ...visitor(), admin: { uid: adminOwner.ownerUid, accountSessionId: adminOwner.accountSessionId, override: false } };
  const call = await store.reserve(regular, 'founder-home', publicPolicy);
  const canceled = await store.cancel(adminOwner.ownerUid, undefined);
  assert.equal(canceled?.id, call.id);
  assert.equal(canceled?.canceled, true);
  assert.equal(await store.mayStart(call.id), false);
  await store.finish(call.id, { finalized: true, rejected: true });
  const pending = await store.reserve(regular, 'new-founder-home', publicPolicy).catch(() => null);
  // The public page's allowance remains consumed after cancellation.
  assert.equal(pending, null);
  const anotherPage = { ...visitor('b'), admin: regular.admin };
  const next = await store.reserve(anotherPage, 'revoked-after-admission', publicPolicy);
  await db.transaction(async tx => { tx.set(accountPath(adminOwner), { uid: adminOwner.ownerUid, state: 'revoked', expiresAt: start + 900_000 }); });
  assert.equal(await store.mayStart(next.id), false);
});
