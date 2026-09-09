import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTestPaymentAdapter, type TestPaymentProduct } from '../lib/billing-payments';
import { AppError } from '../lib/errors';

const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;
const ownerId = 'synthetic-publisher';
const request = (product: TestPaymentProduct = 'subscription-monthly') => ({ ownerId, product, idempotencyKey: randomUUID() });

test('test payments bind all five launch products to server-owned USD amounts and grant only after confirmation', () => {
  const adapter = createTestPaymentAdapter({ mode: 'test' });
  const products: [TestPaymentProduct, number][] = [['subscription-monthly', 2900], ['subscription-annual', 30000], ['topup-10', 1000], ['topup-25', 2500], ['topup-50', 5000]];
  for (const [product, amountCents] of products) {
    const checkout = adapter.createCheckout(request(product));
    assert.equal(checkout.amountCents, amountCents);
    assert.equal(checkout.currency, 'usd');
    assert.equal(adapter.getReceipt(checkout.id, ownerId), null);
    assert.equal(adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'pending' }).receipt, null);
    const confirmed = adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'succeeded' });
    assert.deepEqual(confirmed.receipt, { id: `test-payment:${checkout.id}`, provider: 'local-test', livemode: false, ownerId, product, currency: 'usd', amountCents, paidAt: confirmed.checkout.paidAt });
  }
});

test('failed checkout grants nothing and final outcomes never regress or silently retry', () => {
  const adapter = createTestPaymentAdapter({ mode: 'test' });
  const checkout = adapter.createCheckout(request('topup-50'));
  assert.equal(adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'failed' }).receipt, null);
  assert.equal(adapter.getReceipt(checkout.id, ownerId), null);
  assert.throws(() => adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'succeeded' }), status(409));
  assert.throws(() => adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'pending' }), status(409));
  const second = adapter.createCheckout(request('topup-50'));
  adapter.confirmCheckout({ checkoutId: second.id, ownerId, outcome: 'succeeded' });
  assert.throws(() => adapter.confirmCheckout({ checkoutId: second.id, ownerId, outcome: 'failed' }), status(409));
});

test('checkout and receipt identity survive replay and serialized restore without re-granting a new payment', () => {
  let clock = Date.parse('2026-09-09T12:00:00Z');
  const adapter = createTestPaymentAdapter({ mode: 'test', now: () => clock });
  const input = request(), first = adapter.createCheckout(input);
  assert.deepEqual(adapter.createCheckout(input), first);
  assert.throws(() => adapter.createCheckout({ ...input, product: 'topup-10' }), status(409));
  clock += 1000;
  const result = adapter.confirmCheckout({ checkoutId: first.id, ownerId, outcome: 'succeeded' });
  clock += 1000;
  assert.deepEqual(adapter.confirmCheckout({ checkoutId: first.id, ownerId, outcome: 'succeeded' }), result);
  const restored = createTestPaymentAdapter({ mode: 'test', state: JSON.parse(JSON.stringify(adapter.snapshot())), now: () => clock });
  assert.deepEqual(restored.createCheckout(input), result.checkout);
  assert.deepEqual(restored.getReceipt(first.id, ownerId), result.receipt);
  const otherOwner = restored.createCheckout({ ...input, ownerId: 'other-synthetic-owner' });
  assert.notEqual(otherOwner.id, first.id);
  assert.throws(() => restored.getReceipt(first.id, 'other-synthetic-owner'), status(404));
  assert.throws(() => restored.confirmCheckout({ checkoutId: first.id, ownerId: 'other-synthetic-owner', outcome: 'succeeded' }), status(404));
});

test('caller mutations, invented fields and corrupt persisted payment claims cannot alter server-owned checkouts', () => {
  const adapter = createTestPaymentAdapter({ mode: 'test' });
  const checkout = adapter.createCheckout(request());
  checkout.amountCents = 1; checkout.status = 'succeeded';
  const copied = adapter.snapshot(); copied.checkouts[0].status = 'succeeded';
  assert.equal(adapter.getReceipt(checkout.id, ownerId), null);
  assert.throws(() => createTestPaymentAdapter({ mode: 'test', state: copied }), status(503));
  const alteredPrice = adapter.snapshot(); alteredPrice.checkouts[0].amountCents = 1;
  assert.throws(() => createTestPaymentAdapter({ mode: 'test', state: alteredPrice }), status(503));
  const duplicate = adapter.snapshot(); duplicate.checkouts.push({ ...duplicate.checkouts[0] });
  assert.throws(() => createTestPaymentAdapter({ mode: 'test', state: duplicate }), status(503));
  assert.throws(() => adapter.createCheckout({ ...request(), amountCents: 1 } as Parameters<typeof adapter.createCheckout>[0]));
  assert.throws(() => adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'succeeded', receipt: { livemode: true } } as Parameters<typeof adapter.confirmCheckout>[0]));
  assert.throws(() => createTestPaymentAdapter({ mode: 'live' as 'test' }), status(503));
  assert.throws(() => createTestPaymentAdapter({ mode: 'test', now: () => NaN }).createCheckout(request()), status(503));
});

test('the bounded fixture history retains replay protection instead of evicting successful payment identities', () => {
  const adapter = createTestPaymentAdapter({ mode: 'test' });
  const input = request(), checkout = adapter.createCheckout(input);
  adapter.confirmCheckout({ checkoutId: checkout.id, ownerId, outcome: 'succeeded' });
  for (let i = 1; i < 1000; i++) adapter.createCheckout(request('topup-10'));
  assert.throws(() => adapter.createCheckout(request()), status(429));
  assert.equal(adapter.createCheckout(input).id, checkout.id);
  assert.ok(adapter.getReceipt(checkout.id, ownerId));
});
