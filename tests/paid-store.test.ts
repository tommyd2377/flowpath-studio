import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPaidStore } from '../lib/paid-store';
import { createPaidVoiceStore } from '../lib/paid-voice-store';
import { DEFAULT_PACK, paymentSettings, returnDestination } from '../lib/paid-model';
import { paidFixture } from './paid-fixture';

test('the only default pack is $5 USD for 900 seconds and return destinations cannot escape', () => {
  assert.equal(DEFAULT_PACK.amount, 500); assert.equal(DEFAULT_PACK.seconds, 900);
  for (const v of ['https://evil.example', '//evil.example', '/account?returnTo=https://evil.example', '/p/../../x', '/p/123']) assert.equal(returnDestination(v), '/account');
  assert.throws(() => paymentSettings({ mode: 'creator', allowanceSeconds: 60, budgetSeconds: Infinity }));
  for (const minutes of [5, 10, 15]) assert.equal(paymentSettings({ mode: 'intro', allowanceSeconds: minutes * 60, budgetSeconds: 900 }).allowanceSeconds, minutes * 60);
});

test('private publications reject anonymous IDs and owner edits cannot be forged', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('creator', 900, 300, false);
  await assert.rejects(f.reserve(), /unavailable/);
  await assert.rejects(f.store.publish({ uid: 'other', visitorId: 'other' }, f.wave, { mode: 'visitor', budgetSeconds: 0, allowanceSeconds: 300 }, true), /another account/);
  assert.equal((await f.store.wallet('creator')).balance, 900);
});

test('creator-funded access has no per-visitor allowance but respects finite allocated funds', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('creator', 420);
  const s = await f.reserve(); assert.equal(s.reserved, 420); assert.equal(s.payerUid, 'creator'); assert.equal(s.allowance, null);
  assert.equal((await f.store.wallet('creator')).available, 480);
  await f.connect(s.id); f.advance(12_100);
  await f.store.settle(s.id, { finalized: true, seconds: 12.1, providerId: s.providerId });
  assert.equal((await f.store.segment(s.id))?.charged, 13);
  assert.equal((await f.store.wallet('creator')).balance, 887);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
  assert.equal((await f.reserve()).reserved, 407);
});

test('introductory time is cumulative across refresh, reconnect and store restart', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 900, 300);
  const first = await f.reserve(); await f.connect(first.id); f.advance(125_000);
  await f.store.settle(first.id, { finalized: true, seconds: 125 });
  const restarted = createPaidStore(f.db, f.now);
  const second = await restarted.reserve(f.guest, f.wave.id, randomUUID(), 'creator', f.policy);
  assert.equal(second.reserved, 175);
  await f.connect(second.id); f.advance(175_000); await restarted.settle(second.id, { finalized: true, seconds: 175 });
  await assert.rejects(restarted.quote(f.guest, f.wave.id, 'creator'), /Sponsored time has ended/);
  assert.equal((await f.store.wallet('creator')).balance, 600);
});

test('anonymous allowance merges once into an account and multiple identities conservatively add consumption', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 900, 300);
  for (const [visitorId, seconds] of [['one', 100], ['two', 90]] as const) {
    const s = await f.reserve({ visitorId }); await f.connect(s.id); f.advance(seconds * 1000);
    await f.store.settle(s.id, { finalized: true, seconds });
    await f.store.link(visitorId, 'listener'); await f.store.link(visitorId, 'listener');
  }
  assert.equal((await f.store.quote({ visitorId: 'two', uid: 'listener' }, f.wave.id, 'creator')).seconds, 110);
  await assert.rejects(f.store.link('two', 'different-account'), /previous conversation/);
  const active = await f.reserve({ visitorId: 'three' });
  await assert.rejects(f.store.link('three', 'listener'), /previous conversation/);
  await f.store.settle(active.id, { finalized: true, rejected: true });
});

test('visitor pays requires sign-in and explicit payer selection; no fallback after sponsor depletion', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('visitor', 0);
  await assert.rejects(f.reserve(), /account and available paid minutes/);
  await assert.rejects(f.reserve(f.guest, 'self'), /account and available paid minutes/);
  const listener = { visitorId: 'listener-browser', uid: 'listener' }; await f.store.link(listener.visitorId, listener.uid); await f.credit(listener);
  const s = await f.reserve(listener, 'self'); assert.equal(s.payerUid, 'listener');
  await f.connect(s.id); f.advance(2_000); await f.store.settle(s.id, { finalized: true, seconds: 2 });
  assert.equal((await f.store.wallet('listener')).balance, 898);
  assert.equal((await f.store.wallet('creator')).balance, 900);
  await f.publish('intro', 1, 1);
  const sponsor = await f.reserve(); await f.connect(sponsor.id); f.advance(1_000); await f.store.settle(sponsor.id, { finalized: true, seconds: 1 });
  await assert.rejects(f.reserve(listener), /Sponsored time has ended/);
  assert.equal((await f.store.wallet('listener')).balance, 898);
});

test('budget allocations across waveforms and simultaneous visitors cannot double spend', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('creator', 600);
  await assert.rejects(f.store.publish(f.owner, { ...f.wave, id: randomUUID() }, { mode: 'creator', budgetSeconds: 400, allowanceSeconds: 300 }, true), /reduce the sponsorship budget/);
  await f.store.link(f.owner.visitorId, f.owner.uid!);
  const attempts = await Promise.allSettled([f.reserve({ visitorId: 'a' }), f.reserve({ visitorId: 'b' }), f.reserve(f.owner, 'self')]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 2);
  assert.equal((await f.store.wallet('creator')).held, 300);
  assert.equal((await f.store.wallet('creator')).allocated, 600);
  assert.equal((await f.store.wallet('creator')).available, 0);
});

test('settings changes and unpublishing never reassign an existing payer or block its cleanup', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 600, 300);
  const s = await f.reserve(); await f.connect(s.id);
  await f.publish('visitor', 0, 300, false);
  await assert.rejects(f.reserve({ visitorId: 'new' }), /unavailable/);
  f.advance(10_000); await f.store.settle(s.id, { finalized: true, seconds: 10 });
  assert.equal((await f.store.segment(s.id))?.payerUid, 'creator');
  assert.equal((await f.store.segment(s.id))?.charged, 10);
  assert.equal((await f.store.wallet('creator')).allocated, 0);
  assert.equal((await f.store.publication(f.wave.id))?.spent, 10);
});

test('failed setup is free; rounding is once per segment and provider overshoot is never charged', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('creator', 60);
  const failed = await f.reserve(); f.advance(1000); await f.store.settle(failed.id, { finalized: true, seconds: 1 });
  assert.equal((await f.store.wallet('creator')).balance, 900);
  const call = await f.reserve(); await f.connect(call.id); f.advance(70_000);
  await f.store.settle(call.id, { finalized: true, seconds: 70 });
  assert.equal((await f.store.segment(call.id))?.charged, 60);
  const snapshot = structuredClone(f.db.rows);
  await f.store.settle(call.id, { finalized: true, seconds: 100 }); assert.deepEqual(f.db.rows, snapshot);
  const ledger = [...f.db.rows.entries()].filter(([p]) => p.startsWith('paidTestLedger'));
  assert.ok(ledger.some(([, v]) => v.type === 'released_hold' && v.seconds === 60));
});

test('unconfirmed closure, missing provider IDs and elapsed deadlines retain holds across restarts', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const s = await f.reserve(); await f.store.settle(s.id, { finalized: false }); f.advance(86_400_000);
  const restarted = createPaidStore(f.db, f.now);
  assert.equal((await restarted.segment(s.id))?.state, 'uncertain');
  await assert.rejects(restarted.reserve({ visitorId: 'other' }, f.wave.id, randomUUID(), 'creator', f.policy), /confirmed cleanup/);
  assert.equal((await f.store.publication(f.wave.id))?.held, 900);
  await restarted.settle(s.id, { finalized: true, rejected: true });
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
});

test('durable paid cancellation cannot target another visitor and pre-cancel defeats late creation', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const adapter = createPaidVoiceStore(f.store, f.now);
  const s = await f.reserve();
  await assert.rejects(adapter.cancel('other', f.wave.id, s.id), /another waveform/);
  assert.equal((await adapter.cancel(s.viewer, f.wave.id, s.id))?.canceled, true);
  assert.equal(await f.store.mayStart(s.id), false);
  await f.store.settle(s.id, { finalized: true, rejected: true });
  const id = randomUUID(); await adapter.cancel(f.guest.visitorId, f.wave.id, id, f.guest.visitorId);
  await assert.rejects(f.reserve(f.guest, 'creator', id), /already been used/);
});

test('purchase fulfillment is atomic/idempotent across duplicates, reordered failures and concurrent events', async () => {
  const f = paidFixture(); const credited = await f.credit();
  await Promise.all([f.store.fulfill('evt_replay1', credited.id, credited.payment), f.store.fulfill('evt_replay2', credited.id, credited.payment)]);
  await f.store.failPurchase(credited.id, credited.payment.checkoutId);
  assert.equal((await f.store.wallet('creator')).balance, 900);
  assert.equal((await f.store.purchase(credited.id))?.status, 'paid');
  await assert.rejects(f.store.fulfill('evt_bad', credited.id, { ...credited.payment, amount: 1000 }), /does not match/);
  const listener = { uid: 'listener', visitorId: 'listener' };
  await assert.rejects(f.store.beginPurchase(listener, credited.id, '/account', f.pack), /another account/);
});

test('pending checkouts cannot silently return someone to a different waveform', async () => {
  const f = paidFixture();
  const id = randomUUID(); await f.store.beginPurchase(f.owner, id, `/p/${f.wave.id}`, f.pack);
  await assert.rejects(f.store.beginPurchase(f.owner, randomUUID(), `/p/${randomUUID()}`, f.pack), /another waveform/);
  await assert.rejects(f.store.beginPurchase(f.owner, id, '/account', f.pack), /another waveform/);
});

test('refunds, reversals before fulfillment, duplicate and stale events produce compensating debt without money movement', async () => {
  const f = paidFixture(); const p = await f.credit(); await f.publish('creator', 900);
  const call = await f.reserve(); await f.connect(call.id); f.advance(600_000); await f.store.settle(call.id, { finalized: true, seconds: 600 });
  await f.store.reverse('evt_refund', p.payment.paymentIntent, 500);
  await f.store.reverse('evt_refund_repeat', p.payment.paymentIntent, 500);
  await f.store.reverse('evt_stale', p.payment.paymentIntent, 100);
  assert.equal((await f.store.wallet('creator')).balance, -600);
  await assert.rejects(f.reserve(), /Sponsored time has ended/);
  const g = paidFixture(); const id = randomUUID(); await g.store.beginPurchase(g.owner, id, '/account', g.pack);
  await g.store.reverse('evt_early', `pi_${id}`, 250);
  await g.store.fulfill('evt_late', id, { ...p.payment, checkoutId: `cs_test_${id}`, paymentIntent: `pi_${id}` });
  assert.equal((await g.store.wallet('creator')).balance, 450);
});

test('account revocation, capacity limits, duplicate tabs and abuse throttling are separate from money', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const s = await f.reserve(); await assert.rejects(f.reserve(), /previous conversation/);
  await assert.rejects(f.store.reserve({ visitorId: 'other' }, f.wave.id, randomUUID(), 'creator', { concurrency: 1, dailySeconds: 9000 }), /connections are in use/);
  await f.store.settle(s.id, { finalized: true, rejected: true });
  await assert.rejects(f.store.reserve(f.guest, f.wave.id, randomUUID(), 'creator', { concurrency: 3, dailySeconds: 900 }), /daily infrastructure/);
  await f.store.link('secure-browser', 'secure');
  await assert.rejects(f.store.reserve({ visitorId: 'secure-browser', uid: 'secure', accountSessionId: 'missing' }, f.wave.id, randomUUID(), 'creator', f.policy), /Sign in again/);
  for (let i = 0; i < 2; i++) { const call = await f.reserve(); await f.store.settle(call.id, { finalized: true, rejected: true }); }
  await assert.rejects(f.reserve(), /wait a minute/);
});

test('admin unfunded publication preserves existing sponsored holds without crediting a wallet or admitting free visitors', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 600, 300);
  const call = await f.reserve();
  const before = await f.store.wallet(f.owner.uid!);
  const publication = await f.store.publish(f.owner, f.wave, { mode: 'intro', allowanceSeconds: 300, budgetSeconds: 0 }, true, true);
  assert.equal(publication.settings.budgetSeconds, call.reserved);
  assert.equal(publication.held, call.reserved);
  const after = await f.store.wallet(f.owner.uid!);
  assert.equal(after.balance, before.balance); assert.equal(after.held, before.held);
  assert.equal(after.allocated, call.reserved);
  await assert.rejects(f.reserve({ visitorId: 'another-visitor' }), /Sponsored time has ended/);
  await f.connect(call.id); f.advance(10_000);
  await f.store.settle(call.id, { finalized: true, seconds: 10 });
  assert.equal((await f.store.segment(call.id))?.payerUid, f.owner.uid);
});
