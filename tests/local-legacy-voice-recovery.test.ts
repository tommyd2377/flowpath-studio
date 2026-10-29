import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { recoverLegacyLocalHold } from '../lib/local-legacy-voice-recovery';
import { createProductionVoiceStore, type VoiceOwner, type VoicePolicy } from '../lib/production-voice-store';
import { PaidMemoryDatabase } from './paid-fixture';

const env = { NODE_ENV: 'development', FLOWPATH_LOCAL_APP: '1', FLOWPATH_LOCAL_APP_ORIGIN: 'http://localhost:3220',
  FLOWPATH_ACCOUNT_MODE: 'firebase', FLOWPATH_FIRESTORE_EDITION: 'standard', FLOWPATH_FIREBASE_PROJECT_ID: 'flowpath-studio',
  FLOWPATH_PUBLIC_ORIGIN: '', FLOWPATH_PAID_FIXTURES: '0' };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const profile = async (work: () => Promise<void>) => {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  try { await work(); } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};
async function fixture() {
  const db = new PaidMemoryDatabase(); let now = 2_000_000;
  const owner: VoiceOwner = { ownerUid: 'synthetic-founder', waveformId: randomUUID(), accountSessionId: 'synthetic-account',
    admin: { uid: 'synthetic-founder', accountSessionId: 'synthetic-account', override: true } };
  const policy: VoicePolicy = { ownerDailySeconds: 900, globalDailySeconds: 900, globalConcurrency: 1, access: 'signed-in', allowedUids: [], unmeteredAdminTesting: true };
  db.rows.set('ownerSessions/synthetic-account', { uid: owner.ownerUid, state: 'active', expiresAt: 20_000_000 });
  const store = createProductionVoiceStore(db, () => now), id = randomUUID();
  const call = await store.reserve(owner, id, policy);
  await store.created(id, 'synthetic-legacy-provider', call.expiresAt);
  await store.cancel(owner.ownerUid, owner.waveformId, id);
  await store.finish(id, { finalized: false }); now += 1_000_000;
  return { db, store, id, owner, policy, now: () => now, row: () => db.rows.get(`voiceConversations/${id}`)! };
}

test('legacy local repair is read-only by default and requires the exact approved call fingerprint', async () => profile(async () => {
  const f = await fixture(), before = structuredClone(f.db.rows);
  const plan = await recoverLegacyLocalHold(f.db, f.owner, undefined, f.now());
  assert.equal(plan.applied, false); assert.equal(plan.otherOpenHolds, 0);
  assert.deepEqual(f.db.rows, before);
  await assert.rejects(recoverLegacyLocalHold(f.db, f.owner, 'wrong', f.now()), /approved legacy call changed/);
  assert.deepEqual(f.db.rows, before);
}));

test('explicit local quarantine preserves unknown usage, counters and all unrelated data without marking closure', async () => profile(async () => {
  const f = await fixture(); f.db.rows.set('unrelated/data', { keep: true });
  const plan = await recoverLegacyLocalHold(f.db, f.owner, undefined, f.now());
  const result = await recoverLegacyLocalHold(f.db, f.owner, plan.fingerprint, f.now());
  assert.equal(result.applied, true); assert.equal(f.row().state, 'uncertain'); assert.equal(f.row().seconds, undefined);
  assert.equal((f.row().localRecovery as { finalUsageConfirmed: boolean }).finalUsageConfirmed, false);
  assert.equal(f.db.rows.get('voiceAdmission/global')!.reservedSeconds, 900);
  assert.equal(f.db.rows.get(`voiceOwners/${hash(f.owner.ownerUid)}`)!.reservedSeconds, 900);
  assert.deepEqual(f.db.rows.get('unrelated/data'), { keep: true });
  await f.store.available(f.owner, f.policy);
  await assert.rejects(recoverLegacyLocalHold(f.db, f.owner, plan.fingerprint, f.now()), /pointers/);
}));

test('fresh, foreign, active, metered and leased calls cannot be quarantined', async () => profile(async () => {
  for (const kind of ['fresh', 'foreign', 'active', 'metered', 'leased']) {
    const f = await fixture();
    if (kind === 'fresh') f.row().createdAt = f.now() - 100;
    if (kind === 'foreign') f.row().ownerUid = 'another-owner';
    if (kind === 'active') f.row().state = 'active';
    if (kind === 'metered') (f.row().admin as { unmeteredLocal?: boolean }).unmeteredLocal = false;
    if (kind === 'leased') f.row().cleanup = { epoch: 1, until: f.now() + 20_000 };
    const before = structuredClone(f.db.rows);
    await assert.rejects(recoverLegacyLocalHold(f.db, f.owner, undefined, f.now()), /eligible/);
    assert.deepEqual(f.db.rows, before);
  }
  const f = await fixture(); const environment: Record<string, string | undefined> = process.env; environment.NODE_ENV = 'production';
  await assert.rejects(recoverLegacyLocalHold(f.db, f.owner, undefined, f.now()), /localhost runtime/);
}));

test('a later failed closer cannot restore the quarantined lock; confirmed usage remains reconcilable', async () => profile(async () => {
  const f = await fixture();
  const plan = await recoverLegacyLocalHold(f.db, f.owner, undefined, f.now());
  await recoverLegacyLocalHold(f.db, f.owner, plan.fingerprint, f.now());
  const replacement = randomUUID(); await f.store.reserve(f.owner, replacement, f.policy);
  const claim = await f.store.claimCleanup(f.id); assert.ok(claim);
  await f.store.finish(f.id, { finalized: false, providerId: claim.providerId, cleanupEpoch: claim.cleanup.epoch });
  assert.equal((f.db.rows.get('voiceAdmission/global')!.active as Record<string, unknown>)[f.id], undefined);
  await f.store.finish(f.id, { finalized: true, seconds: 4.25, providerId: claim.providerId, cleanupEpoch: claim.cleanup.epoch });
  assert.equal(f.row().state, 'closed'); assert.equal(f.row().seconds, 4.25);
  assert.equal(f.db.rows.get(`voiceOwners/${hash(f.owner.ownerUid)}`)!.active, replacement);
}));
