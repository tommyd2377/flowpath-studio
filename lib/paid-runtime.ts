import { accountServer } from './account-runtime';
import { createPaidStore, type PaidStore } from './paid-store';
import { createPaidApi } from './paid-api';
import { DEFAULT_PACK } from './paid-model';
import { createStripeTest } from './stripe-test';
import { configuredPublicOrigin } from './request-origin';
import { localAppOrigin } from './local-app-runtime';
import { applicationDatabase } from './application-database';
import { creationReviewStore, creationSafetyEnabled } from './creation-runtime';
import { CreationSafetyError } from './creation-safety';
import { productionVoicePolicy } from './production-voice-store';
import { localStripeSandboxOrigin } from './paid-local-sandbox';

export const paidFixtures = process.env.NODE_ENV === 'development' && process.env.FLOWPATH_ACCOUNT_MODE === 'local' && process.env.FLOWPATH_PAID_FIXTURES === '1';
const localStripeOrigin = localStripeSandboxOrigin(process.env);
export const paidEnabled = paidFixtures || !!localStripeOrigin || process.env.FLOWPATH_PAID_TEST_ENABLED === '1' && process.env.FLOWPATH_ACCOUNT_MODE === 'firebase';
// No live processing or paid voice switch: a documented bounded provider cutoff is still required.
export const paidVoiceReady = () => paidFixtures;
const shared = globalThis as typeof globalThis & { flowpathPaidStore?: PaidStore };
export function getPaidStore() {
  if (!paidEnabled) throw new Error('Paid test preview is disabled');
  return shared.flowpathPaidStore ??= createPaidStore(applicationDatabase(), Date.now, {
    assertWaveformAllowed: async (tx, uid, waveform) => {
      if (creationSafetyEnabled()) await creationReviewStore().requireAllowed(tx, uid, waveform);
      else if (waveform.textPanel) throw new CreationSafetyError('Text display is paused until safety review is available.', 503);
    },
  });
}
export function getPaidApi() {
  const store = getPaidStore();
  const pack = { ...DEFAULT_PACK, priceId: process.env.FLOWPATH_STRIPE_TEST_PRICE_ID ?? '' };
  // Optional server-only configuration, never reads files or emits credential values.
  const seconds = Number(process.env.FLOWPATH_PACK_SECONDS ?? DEFAULT_PACK.seconds);
  const amount = Number(process.env.FLOWPATH_PACK_CENTS ?? DEFAULT_PACK.amount);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400 || !Number.isSafeInteger(amount) || amount < 50 || amount > 100_000) throw new Error('Invalid minute pack configuration');
  pack.seconds = seconds; pack.amount = amount;
  const publicOrigin = configuredPublicOrigin(process.env.FLOWPATH_PUBLIC_ORIGIN);
  const checkoutOrigin = localStripeOrigin ?? publicOrigin;
  const stripe = !paidFixtures && checkoutOrigin && pack.priceId && process.env.FLOWPATH_STRIPE_TEST_ACCOUNT_ID ? createStripeTest({
    accountId: process.env.FLOWPATH_STRIPE_TEST_ACCOUNT_ID, pack, origin: checkoutOrigin,
    key: () => process.env.FLOWPATH_STRIPE_TEST_KEY, webhookSecret: () => process.env.FLOWPATH_STRIPE_TEST_WEBHOOK_SECRET,
  }, store) : undefined;
  return { ...createPaidApi({ store, accounts: accountServer, enabled: paidEnabled, fixtures: paidFixtures,
    publicOrigin, trustedProxyHost: process.env.FLOWPATH_TRUSTED_PROXY_HOST, pack, stripe, voiceReady: paidVoiceReady,
    adminVoiceReady: () => !!localAppOrigin() && !!productionVoicePolicy(process.env) && !!process.env.OPENAI_API_KEY }), stripe };
}
