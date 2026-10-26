import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createPaidStore } from '../lib/paid-store';
import { createPaidReconciliation, type PaidProviderEvidence } from '../lib/paid-reconciliation';
import { paidFixture } from './paid-fixture';

test('unknown provider outcome and lookup failures preserve holds across expiry, UTC rollover and restart', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('intro', 300, 300);
  const call = await f.reserve(); await f.connect(call.id);
  await f.store.settle(call.id, { finalized: false }); f.advance(2 * 86_400_000);
  const restarted = createPaidStore(f.db, f.now);
  let failLookup = false;
  const recovery = createPaidReconciliation(restarted, { environment: 'fixture', lookup: async () => {
    if (failLookup) throw new Error('Synthetic lookup unavailable');
    return { outcome: 'unknown' };
  } });
  const before = structuredClone(f.db.rows);
  const inspection = await recovery.resolve(call.id);
  assert.equal(inspection?.needsAuthority, true); assert.equal(inspection?.reserved, 300);
  assert.equal(inspection?.providerKnown, true); assert.equal(inspection?.connectionConfirmed, true);
  failLookup = true; await recovery.resolve(call.id);
  assert.deepEqual(f.db.rows, before);
  await assert.rejects(restarted.reserve({ visitorId: 'replacement' }, f.wave.id, randomUUID(), 'creator', f.policy), /confirmed cleanup/);
});

test('only request-bound confirmed no-creation authority releases an unknown-ID hold', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const call = await f.reserve(); await f.store.settle(call.id, { finalized: false });
  let lookupCount = 0;
  const recovery = createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => {
    lookupCount++; return { outcome: 'not-created', requestId: call.id, referenceId: 'fixture_no_creation' };
  } });
  await assert.rejects(f.store.settle(call.id, { finalized: true, rejected: true }), /provider authority/);
  const results = await Promise.all([recovery.resolve(call.id), recovery.resolve(call.id)]);
  assert.ok(results.every(result => result?.state === 'closed'));
  assert.equal((await f.store.wallet('creator')).balance, 900);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
  const ledger = [...f.db.rows.values()].filter(row => row.type === 'provider_reconciliation');
  assert.equal(ledger.length, 1); assert.equal(ledger[0].referenceId, 'fixture_no_creation');
  await recovery.resolve(call.id); assert.equal(lookupCount, 2);
});

test('no-creation claims cannot discard provider creation or confirmed connection evidence', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const call = await f.reserve(); await f.connect(call.id); await f.store.settle(call.id, { finalized: false });
  const before = structuredClone(f.db.rows);
  const recovery = createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => ({ outcome: 'not-created',
    requestId: call.id, referenceId: 'fixture_conflicting_authority' }) });
  await assert.rejects(recovery.resolve(call.id), /conflicts with this reservation/);
  assert.deepEqual(f.db.rows, before);
});

test('provider closure reconciliation settles once and records platform overshoot without charging beyond the hold', async () => {
  const f = paidFixture(); await f.credit(); await f.publish('creator', 60);
  const call = await f.reserve(); await f.connect(call.id); f.advance(75_000);
  await f.store.settle(call.id, { finalized: false });
  const recovery = createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => ({ outcome: 'closed',
    requestId: call.id, providerId: `provider_${call.id}`, referenceId: 'fixture_closed_authority', seconds: 70.1 }) });
  await Promise.all([recovery.resolve(call.id), recovery.resolve(call.id), f.store.settle(call.id, { finalized: true, seconds: 70.1 })]);
  assert.equal((await f.store.segment(call.id))?.charged, 60);
  assert.equal((await f.store.wallet('creator')).balance, 840);
  assert.equal((await f.store.publication(f.wave.id))?.held, 0);
  const segment = [...f.db.rows.entries()].find(([key]) => key.startsWith('paidTestSegments'))![1];
  assert.equal(segment.overshootSeconds, 11);
  assert.equal([...f.db.rows.values()].filter(row => row.type === 'usage_debit').length, 1);
});

test('authority for another request/provider, invalid reference and nonfinal duration cannot release funds', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const call = await f.reserve(); await f.connect(call.id); await f.store.settle(call.id, { finalized: false });
  const valid = { outcome: 'closed' as const, requestId: call.id, providerId: `provider_${call.id}`, referenceId: 'fixture_authority', seconds: 1 };
  for (const evidence of [{ ...valid, requestId: randomUUID() }, { ...valid, providerId: 'another_provider' },
    { ...valid, referenceId: '' }, { ...valid, seconds: NaN }, { ...valid, seconds: Infinity }, { ...valid, seconds: -1 }]) {
    const before = structuredClone(f.db.rows);
    const recovery = createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => evidence });
    await assert.rejects(recovery.resolve(call.id), /evidence|identity and final duration/);
    assert.deepEqual(f.db.rows, before);
  }
});

test('recovered provider identity is persisted but absent connection confirmation stays free', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const call = await f.reserve(); await f.store.settle(call.id, { finalized: false }); f.advance(10_000);
  const recovery = createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => ({ outcome: 'closed',
    requestId: call.id, providerId: 'provider_recovered', referenceId: 'fixture_recovered_authority', seconds: 5 }) });
  await recovery.resolve(call.id);
  const segment = await f.store.segment(call.id);
  assert.equal(segment?.providerId, 'provider_recovered'); assert.equal(segment?.charged, 0);
  assert.equal((await f.store.wallet('creator')).balance, 900);
});

test('reconciliation is fixture-only and never queries active or missing reservations', async () => {
  const f = paidFixture(); await f.credit(); await f.publish(); const call = await f.reserve();
  let lookups = 0;
  const options = { environment: 'fixture' as const, lookup: async (): Promise<PaidProviderEvidence> => { lookups++; return { outcome: 'unknown' }; } };
  assert.throws(() => createPaidReconciliation(f.store, { ...options, environment: 'live' as 'fixture' }), /fixture-only/);
  const recovery = createPaidReconciliation(f.store, options);
  assert.equal((await recovery.resolve(call.id))?.state, 'creating');
  assert.equal(await recovery.resolve(randomUUID()), null); assert.equal(lookups, 0);
});

test('a failed settlement transaction preserves its hold and successful retry debits exactly once', async () => {
  const f = paidFixture(); await f.credit(); await f.publish();
  const call = await f.reserve(); await f.connect(call.id); f.advance(5_000);
  await f.store.settle(call.id, { finalized: false });
  const before = structuredClone(f.db.rows);
  const broken = createPaidStore({ transaction: work => f.db.transaction(tx => work({ get: tx.get,
    set: (key, value) => { if ((value as { type?: string }).type === 'released_hold') throw new Error('Synthetic write failure'); tx.set(key, value); },
  })) }, f.now);
  const lookup = async (): Promise<PaidProviderEvidence> => ({ outcome: 'closed', requestId: call.id,
    providerId: `provider_${call.id}`, referenceId: 'fixture_retry_authority', seconds: 5 });
  await assert.rejects(createPaidReconciliation(broken, { environment: 'fixture', lookup }).resolve(call.id), /Synthetic write failure/);
  assert.deepEqual(f.db.rows, before);
  await createPaidReconciliation(f.store, { environment: 'fixture', lookup }).resolve(call.id);
  assert.equal((await f.store.wallet('creator')).balance, 895);
  assert.equal([...f.db.rows.values()].filter(row => row.type === 'provider_reconciliation').length, 1);
});

test('reversal debt preserves the original self-funded hold until confirmed settlement', async () => {
  const f = paidFixture(); const purchase = await f.credit(); await f.publish('visitor', 0);
  const call = await f.reserve(f.owner, 'self'); await f.connect(call.id); f.advance(5_000);
  await f.store.settle(call.id, { finalized: false });
  await f.store.reverse('evt_fixture_reversal', purchase.payment.paymentIntent, purchase.payment.amount);
  assert.equal((await f.store.wallet('creator')).held, 900);
  assert.equal((await f.store.wallet('creator')).balance, 0);
  f.advance(86_400_000);
  await createPaidReconciliation(f.store, { environment: 'fixture', lookup: async () => ({ outcome: 'closed',
    requestId: call.id, providerId: `provider_${call.id}`, referenceId: 'fixture_reversal_authority', seconds: 5 }) }).resolve(call.id);
  const wallet = await f.store.wallet('creator');
  assert.equal(wallet.held, 0); assert.equal(wallet.balance, -5); assert.equal(wallet.available, 0);
  assert.equal((await f.store.segment(call.id))?.payer, 'self');
  await assert.rejects(f.reserve(f.owner, 'self'), /Purchase minutes/);
});
