import 'server-only';
import { AppError } from './errors';
import { getAppOrigin, getBackendMode } from './firebase/config';
import type { StripeTestConfiguration } from './billing-stripe';

/** Read only at runtime. No account setup, environment writes or live-mode fallback. */
export function stripeTestConfiguration(): { payment: StripeTestConfiguration; webhook: { secret: string; apiVersion: string } } | null {
  // Even a configured machine's local demo can never contact a payment service.
  if (getBackendMode() === 'demo' || !process.env.VOICE_STRIPE_MODE) return null;
  if (process.env.VOICE_STRIPE_MODE !== 'test') throw new AppError('Only Stripe test mode is supported by this launch preview.', 503);
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new AppError('Stripe test setup is incomplete. No charge was made.', 503);
    return value;
  };
  const apiVersion = required('STRIPE_API_VERSION');
  const secretKey = required('STRIPE_SECRET_KEY');
  if (!/^sk_test_[A-Za-z0-9_]{8,200}$/.test(secretKey)) throw new AppError('A Stripe test key is required. Live payments are disabled.', 503);
  const webhookSecret = required('STRIPE_WEBHOOK_SECRET');
  if (!/^whsec_[A-Za-z0-9_]{8,200}$/.test(webhookSecret)) throw new AppError('Stripe test webhook setup is incomplete.', 503);
  return { payment: { mode: 'test', secretKey, apiVersion, appOrigin: getAppOrigin(), prices: {
    'subscription-monthly': required('STRIPE_PRICE_MONTHLY'),
    'subscription-annual': required('STRIPE_PRICE_ANNUAL'),
    'topup-10': required('STRIPE_PRICE_TOPUP_10'),
    'topup-25': required('STRIPE_PRICE_TOPUP_25'),
    'topup-50': required('STRIPE_PRICE_TOPUP_50'),
  } }, webhook: { secret: webhookSecret, apiVersion } };
}
