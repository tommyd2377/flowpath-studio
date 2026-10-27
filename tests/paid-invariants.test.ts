import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { creationContentDigest } from '../lib/creation-safety';
import { createPaidStore } from '../lib/paid-store';
import { createPaidVoiceStore } from '../lib/paid-voice-store';
import { paidFixture } from './paid-fixture';

test('paid admission refuses nonfinite, fractional, negative and missing spending caps without writes', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const policies = [
    ...[NaN, Infinity, -1, 0, 1.5, 21].map(concurrency => ({ ...f.policy, concurrency })),
    ...[NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(dailySeconds => ({ ...f.policy, dailySeconds })),
    { concurrency: 3 } as typeof f.policy,
  ];
  for (const policy of policies) {
    const before = structuredClone(f.db.rows);
    await assert.rejects(f.store.capacity(policy), /Finite voice capacity and daily spending limits/);
    await assert.rejects(f.store.reserve(f.guest, f.wave.id, randomUUID(), 'creator', policy), /Finite voice capacity and daily spending limits/);
    assert.deepEqual(f.db.rows, before);
  }
  assert.match(await f.store.capacity({ concurrency: 3, dailySeconds: 0 }), /daily infrastructure/);
  await assert.rejects(f.store.reserve(f.guest, f.wave.id, randomUUID(), 'creator', { concurrency: 3, dailySeconds: 0 }), /daily infrastructure/);
});

test('concurrent admission cannot exceed the explicit platform cap, even across a store restart', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 900, 60);
  const policy = { concurrency: 3, dailySeconds: 100 };
  const restarted = createPaidStore(f.db, f.now);
  const attempts = await Promise.allSettled([f.store.reserve({ visitorId: 'a' }, f.wave.id, randomUUID(), 'creator', policy),
    restarted.reserve({ visitorId: 'b' }, f.wave.id, randomUUID(), 'creator', policy)]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.db.rows.get('voiceAdmission/global')?.reservedSeconds, 60);
  assert.equal((await f.store.publication(f.wave.id))?.held, 60);
});

test('malformed wallet, allowance and shared capacity data fail closed rather than erase spending bounds', async () => {
  for (const target of ['wallet', 'allowance', 'capacity'] as const) {
    const f = paidFixture(); await f.credit(); await f.publish('intro', 900, 60);
    if (target === 'wallet') {
      const wallet = [...f.db.rows.entries()].find(([key]) => key.startsWith('paidTestWallets'))!;
      f.db.rows.set(wallet[0], { ...wallet[1], balance: Infinity });
    } else if (target === 'allowance') {
      const call = await f.reserve(); await f.store.settle(call.id, { finalized: true, rejected: true });
      const person = [...f.db.rows.entries()].find(([key]) => key.startsWith('paidTestParticipants'))!;
      f.db.rows.set(person[0], { ...person[1], uses: { [f.wave.id]: { used: NaN, held: 0 } } });
    } else f.db.rows.set('voiceAdmission/global', { day: '2026-10-24', reservedSeconds: NaN, active: {} });
    const before = structuredClone(f.db.rows);
    await assert.rejects(f.reserve(), /accounting requires reconciliation|Capacity data requires review/);
    assert.deepEqual(f.db.rows, before);
  }
});

test('late creation persistence never downgrades uncertainty and duplicate connection events preserve first connection time', async () => {
  const f = paidFixture(); await f.credit(); await f.publish(); const call = await f.reserve();
  await f.store.settle(call.id, { finalized: false });
  await f.store.updateSegment(call.id, 'created', `provider_${call.id}`);
  assert.equal((await f.store.segment(call.id))?.state, 'uncertain');
  await f.store.updateSegment(call.id, 'connected'); const connectedAt = (await f.store.segment(call.id))?.connectedAt;
  f.advance(5000); await f.store.updateSegment(call.id, 'connected');
  assert.equal((await f.store.segment(call.id))?.connectedAt, connectedAt);
  assert.equal((f.db.rows.get('voiceAdmission/global')?.active as Record<string, string>)[call.id], 'uncertain');
});

test('confirmed creation cannot be treated as rejected setup and identity mismatch cannot settle a reservation', async () => {
  const f = paidFixture(); await f.credit(); await f.publish(); const call = await f.reserve(); await f.connect(call.id);
  const before = structuredClone(f.db.rows);
  await assert.rejects(f.store.settle(call.id, { finalized: true, rejected: true }), /provider authority/);
  await assert.rejects(f.store.settle(call.id, { finalized: true, seconds: 1, providerId: 'wrong_provider' }), /identifier mismatch/);
  assert.deepEqual(f.db.rows, before);
});

test('approval hooks protect save, publication, quote and reservation inside each transaction', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  let checks = 0;
  const guarded = createPaidStore(f.db, f.now, { assertWaveformAllowed: async (tx, ownerUid, waveform) => {
    checks++; assert.equal(ownerUid, f.owner.uid); assert.equal(waveform.id, f.wave.id);
    await tx.get('syntheticSafety/approval'); throw new Error('Synthetic content approval missing');
  } });
  for (const action of [() => guarded.saveWaveform(f.owner, f.wave),
    () => guarded.publish(f.owner, f.wave, { mode: 'creator', budgetSeconds: 900, allowanceSeconds: 300 }, true),
    () => guarded.quote(f.guest, f.wave.id, 'creator'),
    () => guarded.reserve(f.guest, f.wave.id, randomUUID(), 'creator', f.policy)]) {
    const before = structuredClone(f.db.rows);
    await assert.rejects(action(), /content approval missing/); assert.deepEqual(f.db.rows, before);
  }
  assert.equal(checks, 4);
  await guarded.publish(f.owner, f.wave, { mode: 'creator', budgetSeconds: 900, allowanceSeconds: 300 }, false);
  assert.equal((await f.store.publication(f.wave.id))?.published, false);
});

test('a reviewed concurrent edit cannot charge a hold for a stale resolved content version', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const digest = creationContentDigest(f.wave);
  const changed = { ...f.wave, initialPrompt: 'A separately approved newer prompt.' };
  const allowed = new Set([digest, creationContentDigest(changed)]);
  const guarded = createPaidStore(f.db, f.now, { assertWaveformAllowed: async (_tx, _uid, waveform) => {
    assert.ok(allowed.has(creationContentDigest(waveform)));
  } });
  await guarded.saveWaveform(f.owner, changed);
  await guarded.publish(f.owner, changed, (await guarded.publication(f.wave.id))!.settings, true);
  const before = structuredClone(f.db.rows);
  await assert.rejects(guarded.reserve(f.guest, f.wave.id, randomUUID(), 'creator', f.policy, digest), /waveform changed/);
  assert.deepEqual(f.db.rows, before);
  const current = await guarded.reserve(f.guest, f.wave.id, randomUUID(), 'creator', f.policy, creationContentDigest(changed));
  assert.equal(current.revision, (await guarded.publication(f.wave.id))?.revision);
});

test('paid adapter carries the exact content digest and configuration changes cancel setup before provider work', async () => {
  const f = paidFixture(); await f.credit(); await f.publish(); const oldDigest = creationContentDigest(f.wave);
  await f.store.publish(f.owner, { ...f.wave, name: 'New version' }, (await f.store.publication(f.wave.id))!.settings, true);
  const adapter = createPaidVoiceStore(f.store, f.now);
  const owner = { ownerUid: f.guest.visitorId, waveformId: f.wave.id, accountSessionId: f.guest.visitorId,
    paid: { actor: f.guest, choice: 'creator' as const, expectedContentDigest: oldDigest } };
  await assert.rejects(adapter.reserve(owner, randomUUID(), { globalConcurrency: 3, globalDailySeconds: 9000,
    ownerDailySeconds: 3600, access: 'signed-in', allowedUids: [] }), /waveform changed/);
  const call = await f.reserve();
  await f.store.publish(f.owner, { ...f.wave, name: 'Another new version' }, (await f.store.publication(f.wave.id))!.settings, true);
  assert.equal(await f.store.mayStart(call.id), false);
  await f.store.settle(call.id, { finalized: true, rejected: true });
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
});

test('saving an approved draft preserves published content, revision, visitor starts and finances until explicit publish', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const publication = (await f.store.publication(f.wave.id))!;
  const wallet = await f.store.wallet(f.owner.uid!);
  const visitorCall = await f.reserve();
  const draft = { ...f.wave, name: 'Private draft', initialPrompt: 'Draft instructions', textPanel: { type: 'text' as const, version: 2 as const } };
  await f.store.saveWaveform(f.owner, draft);
  const saved = (await f.store.publication(f.wave.id))!;
  assert.deepEqual(saved.waveform, publication.waveform);
  assert.deepEqual(saved.draft, draft);
  assert.equal(saved.revision, publication.revision);
  assert.equal(await f.store.mayStart(visitorCall.id), true);
  await f.store.settle(visitorCall.id, { finalized: true, rejected: true });
  assert.deepEqual(await f.store.wallet(f.owner.uid!), wallet);
  const before = structuredClone(f.db.rows);
  await assert.rejects(f.store.reserve(f.guest, f.wave.id, randomUUID(), 'creator', f.policy, undefined, true), /Only the owner/);
  assert.deepEqual(f.db.rows, before);
  await f.credit();
  const preview = await f.store.reserve(f.owner, f.wave.id, randomUUID(), 'self', f.policy, creationContentDigest(draft), true);
  assert.equal(preview.preview, true);
  assert.equal(await f.store.mayStart(preview.id), true);
  await f.store.saveWaveform(f.owner, { ...draft, name: 'Newer draft' });
  assert.equal(await f.store.mayStart(preview.id), false);
  await f.store.settle(preview.id, { finalized: true, rejected: true });
  await f.store.publish(f.owner, draft, saved.settings, true);
  assert.deepEqual((await f.store.publication(f.wave.id))!.waveform, draft);
});
