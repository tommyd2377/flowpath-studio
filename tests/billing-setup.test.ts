import assert from 'node:assert/strict';
import test from 'node:test';
import { stripeTestConfiguration } from '../lib/billing-setup';

test('Stripe test setup rejects live keys and incomplete setup; demo cannot opt into payment network access', () => {
  const environment = process.env;
  try {
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_synthetic' };
    assert.equal(stripeTestConfiguration(), null);
    process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'firebase' };
    assert.equal(stripeTestConfiguration(), null);
    process.env.VOICE_STRIPE_MODE = 'live';
    assert.throws(() => stripeTestConfiguration(), /Only Stripe test mode/);
    process.env.VOICE_STRIPE_MODE = 'test';
    assert.throws(() => stripeTestConfiguration(), /incomplete/);
    process.env.STRIPE_API_VERSION = '2026-09-01.clover';
    process.env.STRIPE_SECRET_KEY = 'sk_live_synthetic';
    assert.throws(() => stripeTestConfiguration(), /Live payments are disabled/);
  } finally { process.env = environment; }
});
