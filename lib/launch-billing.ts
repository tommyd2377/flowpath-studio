import 'server-only';
import { getFirestore } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from './firebase/admin';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { getSite } from './site-store';
import { AppError } from './errors';
import { assertTestBillingAccess, billingActionSchema, billingView, changeBilling, readBilling } from './billing-store';
import { stripeTestConfiguration } from './billing-setup';
import { createStripeTestPaymentAdapter } from './billing-stripe';
import { createFirestoreStripeTestRepository, createStripeTestBillingService, type StripeBillingOrder } from './billing-stripe-store';
import type { BillingView } from './billing-view';
import type { TestPaymentProduct } from './billing-payments';
import { billingSummary } from './billing-ledger';
import { LAUNCH_OFFER } from './billing-model';

/** Expose only a previously created checkout. A return URL never creates or confirms a payment. */
export function pendingStripeCheckout(orders: readonly Pick<StripeBillingOrder, 'status' | 'product' | 'url'>[]): BillingView['pendingCheckout'] {
  const order = orders.find(item => ['dispatching', 'open', 'unknown'].includes(item.status));
  if (!order) return undefined;
  const cycle = order.product === 'subscription-monthly' ? 'monthly' : order.product === 'subscription-annual' ? 'annual' : undefined;
  const amountCents = cycle === 'monthly' ? LAUNCH_OFFER.monthlyPriceCents : cycle === 'annual' ? LAUNCH_OFFER.annualPriceCents
    : order.product === 'topup-10' ? LAUNCH_OFFER.topUpAmountsCents[0] : order.product === 'topup-25' ? LAUNCH_OFFER.topUpAmountsCents[1] : LAUNCH_OFFER.topUpAmountsCents[2];
  const details: Omit<NonNullable<BillingView['pendingCheckout']>, 'status' | 'checkoutUrl'> = {
    kind: cycle ? 'subscription' : 'topup', amountCents, ...(cycle ? { cycle } : {}),
  };
  if (order.status !== 'open') return { ...details, status: 'unknown' };
  // Reconciliation clears the hosted URL when Stripe reports Checkout complete;
  // only the independently verified payment webhook can finish the ledger grant.
  if (!order.url) return { ...details, status: 'awaiting-confirmation' };
  let url: URL;
  try { url = new URL(order.url); } catch { throw new AppError('The saved Stripe test checkout address is invalid.', 503); }
  if (url.origin !== 'https://checkout.stripe.com' || url.username || url.password
    || !/^\/(?:c\/)?pay\/cs_test_[a-zA-Z0-9]+(?:\/|$)/.test(url.pathname)) throw new AppError('The saved Stripe test checkout address is invalid.', 503);
  return { ...details, status: 'open', checkoutUrl: url.href };
}

export function configuredStripeBilling() {
  const configuration = stripeTestConfiguration();
  if (!configuration) return null;
  return createStripeTestBillingService({
    repository: createFirestoreStripeTestRepository(getFirestore(getFirebaseAdminApp())),
    provider: createStripeTestPaymentAdapter(configuration.payment), prices: configuration.payment.prices,
    webhook: configuration.webhook,
  });
}

export async function readLaunchBilling(user: WorkspaceUser, siteId: string): Promise<BillingView> {
  await getSite(user, siteId);
  if (getBackendMode() === 'demo') return readBilling(user, siteId);
  const service = configuredStripeBilling();
  if (!service) return readBilling(user, siteId);
  const binding = { ownerId: user.uid, siteId };
  let saved = await service.read(binding);
  // Refresh only already known provider objects, with no Checkout/charge retry.
  const checkout = saved.orders.find(order => order.checkoutId && ['open', 'unknown'].includes(order.status));
  if (checkout?.checkoutId) {
    await service.reconcileCheckout({ ...binding, orderId: checkout.id, checkoutId: checkout.checkoutId });
    saved = await service.read(binding);
  }
  if (saved.orders.some(order => order.subscriptionId)) saved = await service.reconcileSubscription(binding);
  const pendingCheckout = pendingStripeCheckout(saved.orders);
  return { ...billingView(saved.ledger, 'preview', Date.now()), checkoutProvider: 'stripe', ...(pendingCheckout ? { pendingCheckout } : {}) };
}

export async function assertLaunchPublication(user: WorkspaceUser, siteId: string) {
  if (getBackendMode() === 'demo') return assertTestBillingAccess(siteId, 'publish');
  const service = configuredStripeBilling();
  if (!service) return;
  const saved = await service.read({ ownerId: user.uid, siteId });
  if (saved.hasTestAccount && !billingSummary(saved.ledger, Date.now()).active) {
    throw new AppError('Confirm this site’s Stripe test subscription before publishing. Your draft remains available.', 402);
  }
}

export async function changeLaunchBilling(user: WorkspaceUser, siteId: string, raw: unknown): Promise<{ billing: BillingView; checkoutUrl?: string }> {
  await getSite(user, siteId);
  const command = billingActionSchema.parse(raw);
  if (getBackendMode() === 'demo') return { billing: await changeBilling(user, siteId, command) };
  const service = configuredStripeBilling();
  if (!service) throw new AppError('Stripe test payments are not connected. No charge was made.', 503);
  const binding = { ownerId: user.uid, siteId };
  if (command.action === 'activate' || command.action === 'topup') {
    const product = (command.action === 'activate' ? `subscription-${command.cycle}` : `topup-${command.amountCents / 100}`) as TestPaymentProduct;
    const order = await service.createCheckout({ ...binding, product, idempotencyKey: command.idempotencyKey });
    if (!order.url) throw new AppError('Stripe has not confirmed a checkout destination. Refresh billing before continuing; no credit has been added.', 409);
    return { billing: await readLaunchBilling(user, siteId), checkoutUrl: order.url };
  }
  if (command.action === 'replenishment') {
    await service.setReplenishment({ ...binding, revision: command.revision, settings: { enabled: command.enabled,
      amountCents: command.amountCents, thresholdMicros: command.thresholdCents * 10_000, monthlyCeilingCents: command.monthlyCeilingCents } });
  } else if (command.action === 'cancel' || command.action === 'resume') {
    await service.setCancellation({ ...binding, cancel: command.action === 'cancel', revision: command.revision,
      idempotencyKey: `${command.action}:${siteId}:${command.revision}` });
  } else throw new AppError('Synthetic usage is available only in the local billing preview.', 403);
  return { billing: await readLaunchBilling(user, siteId) };
}
