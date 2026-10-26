import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PaidMemoryDatabase } from './paid-fixture';
import { createProductionVoiceStore, type VoicePolicy } from '../lib/production-voice-store';
import { publicVoiceOwner, PUBLIC_VOICE_COOKIE } from '../lib/public-voice-identity';
import { demoBudgets } from '../lib/demo-budget';
import { localAppDatabase, localAppPath } from '../lib/local-app-runtime';

const policy: VoicePolicy = { ownerDailySeconds: 900, globalDailySeconds: 900, globalConcurrency: 3, access: 'signed-in', allowedUids: [], publicDemoSeconds: 180 };
const visitor = (page = randomUUID(), token = 'a') => publicVoiceOwner(new Request('https://voice.example/api/session', {
  headers: { cookie: `${PUBLIC_VOICE_COOKIE}=${token.repeat(64)}`, 'X-FlowPath-Demo': page },
}))!;
test('refresh keeps cancellation scope separate while stable visitor allowance is spent once', async () => {
  const db = new PaidMemoryDatabase(), store = createProductionVoiceStore(db);
  const first = visitor(), refreshed = visitor();
  assert.notEqual(first.ownerUid, refreshed.ownerUid);
  assert.equal(first.demoVisitorId, refreshed.demoVisitorId);
  const call = await store.reserve(first, randomUUID(), policy);
  await store.finish(call.id, { finalized: true, seconds: 0 });
  await assert.rejects(store.reserve(refreshed, randomUUID(), policy), /three-minute demo allowance has ended/);
  assert.equal(db.rows.get('voiceAdmission/global')?.reservedSeconds, 180);
});
test('concurrent refreshed pages cannot reserve two visitor allowances', async () => {
  const db = new PaidMemoryDatabase();
  const outcomes = await Promise.allSettled([createProductionVoiceStore(db).reserve(visitor(), randomUUID(), policy), createProductionVoiceStore(db).reserve(visitor(), randomUUID(), policy)]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
});
test('a cancellation tombstone consumes the stable allowance without creating a provider', async () => {
  const db = new PaidMemoryDatabase(), store = createProductionVoiceStore(db), owner = visitor();
  await store.cancel(owner.ownerUid, owner.waveformId, randomUUID(), owner.accountSessionId, owner.kind, policy, owner.demoVisitorId);
  await assert.rejects(store.reserve(visitor(), randomUUID(), policy), /allowance has ended/);
  assert.equal(db.rows.get('voiceDemoBudgets/studio')?.reservedSeconds, 180);
});
test('platform demo cap is independent, finite and never expands parent capacity', async () => {
  const db = new PaidMemoryDatabase(), store = createProductionVoiceStore(db);
  const limits = demoBudgets({ FLOWPATH_DEMO_STUDIO_DAILY_SECONDS: '180', FLOWPATH_DEMO_NEWS_DAILY_SECONDS: '360' }, { dailySeconds: 900, concurrency: 3 })!;
  assert.equal(limits.news.dailySeconds, 360);
  const scoped = { ...policy, demoBudgets: limits };
  const call = await store.reserve(visitor(), randomUUID(), scoped);
  await store.finish(call.id, { finalized: true, seconds: 0 });
  await assert.rejects(store.reserve(visitor(undefined, 'b'), randomUUID(), scoped), /demo budget/);
  for (const value of ['Infinity', '-1', '1.5', '1000']) assert.equal(demoBudgets({ FLOWPATH_DEMO_NEWS_DAILY_SECONDS: value }, { dailySeconds: 900, concurrency: 3 }), null);
  assert.equal(demoBudgets({}, { dailySeconds: 900, concurrency: 3 })?.news.dailySeconds, 0);
});
test('corrupt demo counters fail closed and do not consume global capacity', async () => {
  const db = new PaidMemoryDatabase();
  db.rows.set('voiceDemoBudgets/studio', { day: new Date().toISOString().slice(0, 10), reservedSeconds: -1, active: {} });
  await assert.rejects(createProductionVoiceStore(db).reserve(visitor(), randomUUID(), policy), /unavailable/);
  assert.equal(db.rows.has('voiceAdmission/global'), false);
});
test('local review transaction paths and account reads share one mapping', async () => {
  const db = new PaidMemoryDatabase();
  assert.equal(localAppPath('ownerWaveforms/uid'), 'ownerWaveforms/uid');
  assert.equal(localAppPath('ownerSessions/session'), 'ownerSessions/session');
  await localAppDatabase(db).transaction(async tx => { tx.set('creationSafetyOwners/uid', { reviewId: 'synthetic' }); });
  assert.ok(db.rows.has(localAppPath('creationSafetyOwners/uid')));
  assert.equal(db.rows.has('creationSafetyOwners/uid'), false);
});
test('settlement cannot erase corrupt demo capacity and release other calls', async () => {
  const db = new PaidMemoryDatabase(), store = createProductionVoiceStore(db);
  const call = await store.reserve(visitor(), randomUUID(), policy);
  db.rows.set('voiceDemoBudgets/studio', { day: new Date().toISOString().slice(0, 10), reservedSeconds: 180, active: 'corrupt' });
  await assert.rejects(store.finish(call.id, { finalized: true, seconds: 1 }), /unavailable/);
  assert.equal(db.rows.get('voiceDemoBudgets/studio')?.active, 'corrupt');
  assert.ok((db.rows.get('voiceAdmission/global')?.active as Record<string, string>)[call.id]);
});
