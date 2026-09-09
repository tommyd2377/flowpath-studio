import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../lib/errors';
import { pendingStripeCheckout } from '../lib/launch-billing';

test('reloading billing exposes the same pending Stripe test checkout without a new checkout or payment grant', () => {
  const url = 'https://checkout.stripe.com/c/pay/cs_test_returning123#checkout';
  assert.deepEqual(pendingStripeCheckout([{ status: 'open', product: 'subscription-annual', url }]), {
    status: 'open', checkoutUrl: url, kind: 'subscription', cycle: 'annual', amountCents: 30000,
  });
  assert.deepEqual(pendingStripeCheckout([{ status: 'completed', product: 'subscription-annual', url: null }, { status: 'open', product: 'topup-25', url }]), {
    status: 'open', checkoutUrl: url, kind: 'topup', amountCents: 2500,
  });
  assert.deepEqual(pendingStripeCheckout([{ status: 'open', product: 'subscription-monthly', url: null }]), {
    status: 'awaiting-confirmation', kind: 'subscription', cycle: 'monthly', amountCents: 2900,
  });
  for (const status of ['dispatching', 'unknown'] as const) assert.deepEqual(pendingStripeCheckout([{ status, product: 'topup-10', url }]), {
    status: 'unknown', kind: 'topup', amountCents: 1000,
  });
  assert.equal(pendingStripeCheckout([{ status: 'completed', product: 'topup-10', url }, { status: 'expired', product: 'topup-50', url }]), undefined);
});

test('saved checkout recovery rejects foreign hosts, credentials and live payment paths', () => {
  for (const url of ['https://attacker.example/c/pay/cs_test_123', 'https://checkout.stripe.com.attacker.example/c/pay/cs_test_123',
    'https://name:password@checkout.stripe.com/c/pay/cs_test_123', 'https://checkout.stripe.com/c/pay/cs_live_123',
    'http://checkout.stripe.com/c/pay/cs_test_123', 'https://checkout.stripe.com:8443/c/pay/cs_test_123', 'invalid-url']) {
    assert.throws(() => pendingStripeCheckout([{ status: 'open', product: 'subscription-monthly', url }]), error => error instanceof AppError && error.status === 503);
  }
});
