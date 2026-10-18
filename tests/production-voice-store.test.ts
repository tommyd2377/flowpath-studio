import assert from 'node:assert/strict';
import test from 'node:test';
import { ACCOUNT_SESSION_COLLECTION } from '../lib/production-account-session';
import {
  createProductionVoiceStore, productionVoicePolicy, VoiceAdmissionError,
  type VoiceDatabase, type VoiceOwner, type VoicePolicy, type VoiceTransaction,
} from '../lib/production-voice-store';
import { VOICE_SESSION_SECONDS } from '../lib/voice-config';

/** Separate store instances share serialized transactions, including rollback on errors. */
class MemoryVoiceDatabase implements VoiceDatabase {
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
        get: async path => structuredClone(next.get(path) ?? null),
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
const accountPath = (value: VoiceOwner) => `${ACCOUNT_SESSION_COLLECTION}/${value.accountSessionId}`;
const policy: VoicePolicy = {
  ownerDailySeconds: 3_600, globalDailySeconds: 9_000, globalConcurrency: 3,
  access: 'signed-in', allowedUids: [],
};
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
