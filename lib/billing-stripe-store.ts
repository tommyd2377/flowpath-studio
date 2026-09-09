import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { z } from 'zod';
import { AppError } from './errors';
import { autoReplenishmentSettingsSchema, billingIdSchema, billingLedgerSchema, LAUNCH_OFFER, type AutoReplenishmentSettings } from './billing-model';
import { applyPaidSubscription, applyPaidTopup, billingSummary, claimAutoReplenishment, currentBillingLedger,
  failAutoReplenishment, reserveUsage as reserveLedgerUsage, setAutoReplenishment, setCancelAtPeriodEnd, settleUsage as settleLedgerUsage } from './billing-ledger';
import { interpretTestStripeWebhook, verifyTestStripeWebhookEnvelope, type createStripeTestPaymentAdapter,
  type StripeTestCheckout, type StripeTestConfiguration, type StripeTestSubscription, type TestStripeExpectation } from './billing-stripe';
import type { TestPaymentProduct } from './billing-payments';

const bindingSchema = z.object({ ownerId: z.string().min(1).max(128), siteId: billingIdSchema }).strict();
type Binding = z.infer<typeof bindingSchema>;
const reference = z.string().min(1).max(160).regex(/^[A-Za-z0-9_]+$/);
const productSchema = z.enum(['subscription-monthly', 'subscription-annual', 'topup-10', 'topup-25', 'topup-50']);
const orderSchema = z.object({
  id: billingIdSchema, idempotencyKey: billingIdSchema, product: productSchema, priceId: reference,
  createdAt: z.number().int().nonnegative(), status: z.enum(['dispatching', 'open', 'unknown', 'completed', 'expired']),
  checkoutId: reference.nullable(), url: z.string().url().nullable(), customerId: reference.nullable(), subscriptionId: reference.nullable(),
}).strict();
export type StripeBillingOrder = z.infer<typeof orderSchema>;
const cancellationSchema = z.object({ id: billingIdSchema, cancel: z.boolean(), status: z.enum(['pending', 'confirmed', 'unknown']) }).strict();
const consentSchema = z.object({ id: billingIdSchema, customerId: reference, paymentMethodId: reference,
  acceptedAt: z.number().int().positive(), revoked: z.boolean() }).strict();
export const stripeBillingAccountSchema = z.object({
  version: z.literal(1), mode: z.literal('stripe-test'), ownerId: z.string().min(1).max(128), siteId: billingIdSchema,
  ledger: billingLedgerSchema, orders: z.record(billingIdSchema, orderSchema),
  customerId: reference.nullable(), subscriptionId: reference.nullable(), subscriptionOrderId: billingIdSchema.nullable(),
  consent: consentSchema.nullable(), cancellations: z.record(billingIdSchema, cancellationSchema),
}).strict().superRefine((value, context) => {
  if (value.siteId !== value.ledger.siteId || Object.keys(value.orders).length > 1000 || Object.keys(value.cancellations).length > 1000
    || Object.entries(value.orders).some(([id, order]) => id !== order.id)) context.addIssue({ code: 'custom', message: 'Invalid test billing account.' });
});
export type StripeBillingAccount = z.infer<typeof stripeBillingAccountSchema>;
export interface StripeBillingRepository {
  /** The repository MUST authorize site ownership in this same transaction. No external I/O in the callback. */
  transact<T>(binding: Binding, update: (stored: unknown | undefined) => { state?: StripeBillingAccount; value: T }): Promise<T>;
}

/** Separate collection cannot be interpreted as production money or provider spending authorization. */
export function createFirestoreStripeTestRepository(db: Pick<Firestore, 'collection' | 'runTransaction'>): StripeBillingRepository {
  return {
    async transact<T>(binding: Binding, update: (stored: unknown | undefined) => { state?: StripeBillingAccount; value: T }): Promise<T> {
      const { ownerId, siteId } = bindingSchema.parse(binding);
      const key = createHash('sha256').update(JSON.stringify([ownerId, siteId])).digest('hex');
      const siteRef = db.collection('voiceSites').doc(siteId), accountRef = db.collection('voiceStripeTestBilling').doc(key);
      return db.runTransaction(async transaction => {
        const [site, saved] = await transaction.getAll(siteRef, accountRef);
        if (!site.exists || site.data()?.ownerId !== ownerId) throw new AppError('Site not found.', 404);
        let stored: unknown;
        if (saved.exists) {
          const record = saved.data();
          if (record?.mode !== 'stripe-test' || record.ownerId !== ownerId || record.siteId !== siteId || typeof record.state !== 'string') throw new AppError('Test billing records are temporarily unavailable.', 503);
          try { stored = JSON.parse(record.state); } catch { throw new AppError('Test billing records are temporarily unavailable.', 503); }
        }
        const result = update(stored);
        if (result.state) {
          const state = stripeBillingAccountSchema.parse(result.state);
          if (state.ownerId !== ownerId || state.siteId !== siteId) throw new AppError('Test billing ownership mismatch.', 409);
          const serialized = JSON.stringify(state);
          if (Buffer.byteLength(serialized) > 750_000) throw new AppError('Test billing records need archival before continuing.', 503);
          transaction.set(accountRef, { mode: 'stripe-test', ownerId, siteId, state: serialized });
        }
        return result.value;
      }, { maxAttempts: 3 });
    },
  };
}

type Provider = ReturnType<typeof createStripeTestPaymentAdapter>;
const productAmount = (product: TestPaymentProduct) => product === 'subscription-monthly' ? LAUNCH_OFFER.monthlyPriceCents
  : product === 'subscription-annual' ? LAUNCH_OFFER.annualPriceCents : product === 'topup-10' ? 1000 : product === 'topup-25' ? 2500 : 5000;
const isSubscription = (product: TestPaymentProduct) => product.startsWith('subscription-');
const mismatch = () => new AppError('Stripe payment does not match this site’s saved order.', 409);

/** Injected test-only transport. Nothing is configured, charged, or fetched at module load. */
export function createStripeTestBillingService(options: {
  repository: StripeBillingRepository; provider?: Provider; prices?: StripeTestConfiguration['prices'];
  webhook?: { secret: string; apiVersion: string }; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const provider = () => {
    if (!options.provider || !options.prices) throw new AppError('Stripe test payments are not configured. No charge was made.', 503);
    return options.provider;
  };
  const configured = Boolean(options.provider && options.prices && options.webhook);
  function account(stored: unknown | undefined, binding: Binding, at: number): StripeBillingAccount {
    if (stored === undefined) return { version: 1, mode: 'stripe-test', ...binding, ledger: currentBillingLedger(undefined, binding.siteId, at), orders: {},
      customerId: null, subscriptionId: null, subscriptionOrderId: null, consent: null, cancellations: {} };
    const parsed = stripeBillingAccountSchema.safeParse(stored);
    if (!parsed.success || parsed.data.ownerId !== binding.ownerId || parsed.data.siteId !== binding.siteId) throw new AppError('Test billing records are temporarily unavailable.', 503);
    return { ...parsed.data, ledger: currentBillingLedger(parsed.data.ledger, binding.siteId, at) };
  }
  async function read(binding: Binding) {
    bindingSchema.parse(binding);
    const at = now();
    return options.repository.transact(binding, stored => {
      const state = account(stored, binding, at);
      return { ...(stored === undefined ? {} : { state }), value: { configured, ledger: state.ledger, orders: Object.values(state.orders), hasTestAccount: stored !== undefined } };
    });
  }
  async function saved(binding: Binding) {
    const at = now();
    return options.repository.transact(bindingSchema.parse(binding), stored => {
      if (stored === undefined) throw new AppError('Test billing account was not found.', 404);
      const state = account(stored, binding, at);
      return { state, value: state };
    });
  }
  function checkCheckout(checkout: StripeTestCheckout, state: StripeBillingAccount, order: StripeBillingOrder) {
    if (checkout.livemode !== false || checkout.metadata.ownerId !== state.ownerId || checkout.metadata.siteId !== state.siteId || checkout.metadata.orderId !== order.id
      || checkout.mode !== (isSubscription(order.product) ? 'subscription' : 'payment') || checkout.currency !== 'usd' || checkout.amount_total !== productAmount(order.product)
      || (order.checkoutId && order.checkoutId !== checkout.id) || (state.customerId && state.customerId !== checkout.customer)) throw mismatch();
    if (checkout.url) {
      const url = new URL(checkout.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.port || url.username || url.password) throw mismatch();
    }
  }
  function attachCheckout(state: StripeBillingAccount, order: StripeBillingOrder, checkout: StripeTestCheckout) {
    checkCheckout(checkout, state, order);
    order.checkoutId = checkout.id; order.url = checkout.status === 'open' ? checkout.url : null;
    order.customerId = checkout.customer; order.subscriptionId = checkout.subscription;
    if (checkout.customer) state.customerId = checkout.customer;
    if (isSubscription(order.product) && checkout.subscription) {
      if (state.subscriptionId && state.subscriptionId !== checkout.subscription) throw mismatch();
      state.subscriptionId = checkout.subscription; state.subscriptionOrderId = order.id;
    }
    if (order.status !== 'completed') order.status = checkout.status === 'expired' ? 'expired' : 'open';
  }
  function checkSubscription(subscription: StripeTestSubscription, state: StripeBillingAccount, order: StripeBillingOrder) {
    const item = subscription.items.data[0];
    if (subscription.livemode !== false || subscription.id !== state.subscriptionId || subscription.customer !== state.customerId
      || subscription.metadata.ownerId !== state.ownerId || subscription.metadata.siteId !== state.siteId || subscription.metadata.orderId !== order.id
      || item.price.id !== order.priceId || item.price.unit_amount !== productAmount(order.product)
      || item.price.recurring.interval !== (order.product === 'subscription-annual' ? 'year' : 'month')) throw mismatch();
  }
  async function reconcileCheckout(input: Binding & { orderId: string; checkoutId: string }) {
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    const initial = await saved(binding), order = initial.orders[billingIdSchema.parse(input.orderId)];
    if (!order) throw new AppError('Test checkout was not found.', 404);
    const checkout = await provider().retrieveCheckout(reference.parse(input.checkoutId));
    checkCheckout(checkout, initial, order);
    return options.repository.transact(binding, stored => {
      const state = account(stored, binding, now()), current = state.orders[input.orderId];
      if (!current) throw mismatch();
      attachCheckout(state, current, checkout);
      return { state, value: current };
    });
  }
  async function createCheckout(input: Binding & { product: TestPaymentProduct; idempotencyKey: string }) {
    const transport = provider();
    if (!configured) throw new AppError('Stripe test payment confirmation is not configured. No charge was made.', 503);
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    const product = productSchema.parse(input.product), key = billingIdSchema.parse(input.idempotencyKey);
    const orderId = createHash('sha256').update(JSON.stringify([binding.ownerId, binding.siteId, key])).digest('hex');
    const at = now();
    const snapshot = await options.repository.transact(binding, stored => ({ value: account(stored, binding, at) }));
    let endedSubscription: string | null = null;
    if (isSubscription(product) && snapshot.subscriptionId && snapshot.subscriptionOrderId && !billingSummary(snapshot.ledger, at).active) {
      const subscription = await transport.retrieveSubscription(snapshot.subscriptionId);
      checkSubscription(subscription, snapshot, snapshot.orders[snapshot.subscriptionOrderId]);
      if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') endedSubscription = subscription.id;
    }
    const claim = await options.repository.transact(binding, stored => {
      const state = account(stored, binding, at), previous = state.orders[orderId];
      if (previous) {
        if (previous.product !== product || previous.idempotencyKey !== key) throw new AppError('This checkout request was already used.', 409);
        return { state, value: { dispatch: false, order: previous, customerId: state.customerId } };
      }
      if (endedSubscription && state.subscriptionId === endedSubscription && !billingSummary(state.ledger, at).active) {
        const endedOrder = state.subscriptionOrderId ? state.orders[state.subscriptionOrderId] : null;
        if (endedOrder && endedOrder.status !== 'completed') { endedOrder.status = 'expired'; endedOrder.url = null; }
        state.subscriptionId = null; state.subscriptionOrderId = null;
        if (state.consent) state.consent.revoked = true;
        state.ledger = setAutoReplenishment(state.ledger, { ...state.ledger.autoReplenishment, enabled: false }, at);
      }
      if (Object.keys(state.orders).length >= 1000) throw new AppError('Test checkout history needs archival.', 503);
      if (Object.values(state.orders).some(order => ['dispatching', 'unknown', 'open'].includes(order.status))) throw new AppError('Finish or reconcile the existing test checkout before starting another.', 409);
      if (isSubscription(product) && (state.subscriptionId || billingSummary(state.ledger, at).active)) throw new AppError('This site already has a subscription.', 409);
      if (!isSubscription(product) && !billingSummary(state.ledger, at).active) throw new AppError('Activate this site’s subscription before adding usage credit.', 402);
      const order = orderSchema.parse({ id: orderId, idempotencyKey: key, product, priceId: options.prices![product], createdAt: at,
        status: 'dispatching', checkoutId: null, url: null, customerId: state.customerId, subscriptionId: null });
      state.orders[orderId] = order;
      return { state, value: { dispatch: true, order, customerId: state.customerId } };
    });
    if (!claim.dispatch) return claim.order;
    let checkout: StripeTestCheckout;
    try { checkout = await transport.createCheckout({ ...binding, orderId, product, idempotencyKey: orderId, ...(claim.customerId ? { customerId: claim.customerId } : {}) }); }
    catch (error) {
      await options.repository.transact(binding, stored => {
        const state = account(stored, binding, now()), order = state.orders[orderId];
        if (order?.status === 'dispatching') order.status = 'unknown';
        return { state, value: undefined };
      });
      throw error;
    }
    return options.repository.transact(binding, stored => {
      const state = account(stored, binding, now()), order = state.orders[orderId];
      if (!order) throw mismatch();
      attachCheckout(state, order, checkout);
      return { state, value: order };
    });
  }

  async function reconcileWebhook(input: { rawBody: string; signature: string }) {
    if (!options.webhook) throw new AppError('Stripe test webhooks are not configured.', 503);
    const verification = { mode: 'test' as const, ...input, webhookSecret: options.webhook.secret, apiVersion: options.webhook.apiVersion, now: now() };
    const event = verifyTestStripeWebhookEnvelope(verification);
    if (!['invoice.paid', 'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'payment_intent.succeeded', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) return { applied: false };
    const payload = z.record(z.string(), z.unknown()).parse(event.data.object);
    const metadata = event.type === 'invoice.paid'
      ? (payload.parent as { subscription_details?: { metadata?: unknown } } | undefined)?.subscription_details?.metadata : payload.metadata;
    const located = bindingSchema.extend({ orderId: billingIdSchema }).passthrough().parse(metadata);
    const binding = { ownerId: located.ownerId, siteId: located.siteId };
    if (event.type === 'payment_intent.succeeded') {
      const initial = await saved(binding), attempt = initial.ledger.automaticAttempts[located.orderId];
      if (!attempt || located.automaticAttemptId !== attempt.id || !initial.customerId) throw mismatch();
      const payment = interpretTestStripeWebhook({ ...verification, expected: {
        ownerId: located.ownerId, siteId: located.siteId, orderId: located.orderId, kind: 'automatic-topup', customerId: initial.customerId,
        paymentIntentId: reference.parse(payload.id), automaticAttemptId: attempt.id, amountCents: attempt.amountCents,
      } });
      if (!payment || payment.kind !== 'topup') return { applied: false };
      return options.repository.transact(binding, stored => {
        const state = account(stored, binding, now());
        if (state.customerId !== initial.customerId) throw mismatch();
        state.ledger = applyPaidTopup(state.ledger, payment.payment, now());
        return { state, value: { applied: true } };
      });
    }
    if (event.type.startsWith('customer.subscription.')) {
      const initial = await saved(binding);
      if (initial.subscriptionId !== payload.id || initial.subscriptionOrderId !== located.orderId) throw mismatch();
      await reconcileSubscription(binding);
      return { applied: false };
    }
    let initial = await saved(binding), order = initial.orders[located.orderId];
    if (!order) throw new AppError('The test checkout must be reconciled before confirming this payment.', 409);
    const checkoutId = order.checkoutId ?? (event.type.startsWith('checkout.session.') ? reference.parse(payload.id) : null);
    if (!checkoutId) throw new AppError('The test checkout must be reconciled before confirming this payment.', 409);
    await reconcileCheckout({ ...binding, orderId: order.id, checkoutId });
    initial = await saved(binding); order = initial.orders[order.id];
    if (!initial.customerId) throw mismatch();
    let expected: TestStripeExpectation;
    let cancellation: boolean | null = null;
    if (isSubscription(order.product)) {
      if (event.type !== 'invoice.paid') return { applied: false };
      if (!initial.subscriptionId) throw mismatch();
      const transport = provider();
      const [subscription, invoice] = await Promise.all([transport.retrieveSubscription(initial.subscriptionId), transport.retrieveInvoice(reference.parse(payload.id))]);
      checkSubscription(subscription, initial, order);
      if (subscription.status !== 'active' || invoice.customer !== initial.customerId || invoice.parent.subscription_details.subscription !== initial.subscriptionId) throw mismatch();
      const line = invoice.lines.data[0];
      expected = { ...located, kind: 'subscription', customerId: initial.customerId, invoiceId: invoice.id, subscriptionId: initial.subscriptionId,
        priceId: order.priceId, term: order.product === 'subscription-annual' ? 'annual' : 'monthly', startsAt: line.period.start, endsAt: line.period.end, subscriptionStatus: 'active' };
      cancellation = subscription.cancel_at_period_end;
    } else expected = { ...located, kind: 'topup', customerId: initial.customerId, checkoutId: order.checkoutId!, amountCents: productAmount(order.product) as 1000 | 2500 | 5000 };
    const payment = interpretTestStripeWebhook({ ...verification, expected });
    if (!payment) return { applied: false };
    return options.repository.transact(binding, stored => {
      const state = account(stored, binding, now()), current = state.orders[order.id];
      if (!current || current.checkoutId !== order.checkoutId || current.customerId !== initial.customerId
        || (payment.kind === 'subscription' && state.subscriptionId !== initial.subscriptionId)) throw mismatch();
      state.ledger = payment.kind === 'subscription' ? applyPaidSubscription(state.ledger, payment.payment, now()) : applyPaidTopup(state.ledger, payment.payment, now());
      if (cancellation !== null) {
        state.ledger = setCancelAtPeriodEnd(state.ledger, cancellation, now());
        if (cancellation) {
          state.ledger = setAutoReplenishment(state.ledger, { ...state.ledger.autoReplenishment, enabled: false }, now());
          if (state.consent) state.consent.revoked = true;
        }
      }
      current.status = 'completed'; current.url = null;
      return { state, value: { applied: true } };
    });
  }

  async function reconcileSubscription(binding: Binding) {
    const initial = await saved(binding);
    if (!initial.subscriptionId || !initial.subscriptionOrderId) return read(binding);
    const subscription = await provider().retrieveSubscription(initial.subscriptionId);
    checkSubscription(subscription, initial, initial.orders[initial.subscriptionOrderId]);
    await options.repository.transact(binding, stored => {
      const state = account(stored, binding, now());
      if (state.subscriptionId !== initial.subscriptionId) throw mismatch();
      const cancel = subscription.cancel_at_period_end || subscription.status === 'canceled';
      state.ledger = setCancelAtPeriodEnd(state.ledger, cancel, now());
      if (cancel) {
        state.ledger = setAutoReplenishment(state.ledger, { ...state.ledger.autoReplenishment, enabled: false }, now());
        if (state.consent) state.consent.revoked = true;
      }
      for (const request of Object.values(state.cancellations)) if (request.status !== 'confirmed' && request.cancel === cancel) request.status = 'confirmed';
      return { state, value: undefined };
    });
    return read(binding);
  }

  async function setCancellation(input: Binding & { cancel: boolean; idempotencyKey: string; revision: number }) {
    const transport = provider();
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    const key = billingIdSchema.parse(input.idempotencyKey);
    const initial = await saved(binding);
    if (!initial.subscriptionId || !initial.customerId) throw new AppError('There is no Stripe subscription to change.', 409);
    const claim = await options.repository.transact(binding, stored => {
      const state = account(stored, binding, now()), previous = state.cancellations[key];
      if (previous) {
        if (previous.cancel !== input.cancel) throw new AppError('This subscription change request was already used.', 409);
        if (previous.status !== 'confirmed') throw new AppError('The subscription change is awaiting reconciliation. No new request was sent.', 409);
        return { state, value: false };
      }
      if (state.ledger.revision !== input.revision) throw new AppError('Billing changed. Reload before saving.', 409);
      if (Object.values(state.cancellations).some(item => item.status !== 'confirmed')) throw new AppError('A subscription change is awaiting reconciliation.', 409);
      if (Object.keys(state.cancellations).length >= 1000) throw new AppError('Subscription change history needs archival.', 503);
      state.cancellations[key] = cancellationSchema.parse({ id: key, cancel: input.cancel, status: 'pending' });
      if (input.cancel) {
        state.ledger = setAutoReplenishment(state.ledger, { ...state.ledger.autoReplenishment, enabled: false }, now());
        if (state.consent) state.consent.revoked = true;
      }
      return { state, value: true };
    });
    if (!claim) return read(binding);
    try {
      const subscription = await transport.setCancelAtPeriodEnd({ subscriptionId: initial.subscriptionId, customerId: initial.customerId, cancel: input.cancel,
        idempotencyKey: createHash('sha256').update(JSON.stringify([binding, key])).digest('hex') });
      if (!initial.subscriptionOrderId) throw mismatch();
      checkSubscription(subscription, initial, initial.orders[initial.subscriptionOrderId]);
      if (subscription.cancel_at_period_end !== input.cancel) throw mismatch();
      await options.repository.transact(binding, stored => {
        const state = account(stored, binding, now());
        state.ledger = setCancelAtPeriodEnd(state.ledger, subscription.cancel_at_period_end, now());
        if (subscription.cancel_at_period_end) {
          state.ledger = setAutoReplenishment(state.ledger, { ...state.ledger.autoReplenishment, enabled: false }, now());
          if (state.consent) state.consent.revoked = true;
        }
        state.cancellations[key].status = 'confirmed';
        return { state, value: undefined };
      });
    } catch (error) {
      await options.repository.transact(binding, stored => {
        const state = account(stored, binding, now()); state.cancellations[key].status = 'unknown'; return { state, value: undefined };
      });
      throw error;
    }
    return read(binding);
  }

  async function setReplenishment(input: Binding & { settings: AutoReplenishmentSettings; revision: number }) {
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    const settings = autoReplenishmentSettingsSchema.parse(input.settings), initial = await saved(binding);
    let consent: z.infer<typeof consentSchema> | null = initial.consent ? { ...initial.consent, revoked: !settings.enabled } : null;
    if (settings.enabled) {
      if (!initial.customerId || !initial.subscriptionId || !initial.subscriptionOrderId) throw new AppError('A paid subscription and saved test payment method are required.', 409);
      const subscription = await provider().retrieveSubscription(initial.subscriptionId);
      checkSubscription(subscription, initial, initial.orders[initial.subscriptionOrderId]);
      if (subscription.status !== 'active' || !subscription.default_payment_method) throw new AppError('No saved test payment method is available for automatic top-ups.', 409);
      consent = { id: randomUUID(), customerId: initial.customerId, paymentMethodId: subscription.default_payment_method, acceptedAt: now(), revoked: false };
    }
    await options.repository.transact(binding, stored => {
      const state = account(stored, binding, now());
      if (state.ledger.revision !== input.revision || state.customerId !== initial.customerId || state.subscriptionId !== initial.subscriptionId) throw new AppError('Billing changed. Reload before saving.', 409);
      if (!billingSummary(state.ledger, now()).active) throw new AppError('An active paid subscription is required.', 402);
      if (settings.enabled && state.ledger.cancelAtPeriodEnd) throw new AppError('Resume the subscription before enabling automatic top-ups.', 409);
      state.ledger = setAutoReplenishment(state.ledger, settings, now()); state.consent = consent;
      return { state, value: undefined };
    });
    return read(binding);
  }

  async function replenish(binding: Binding, operationId: string) {
    if (!configured) return;
    const attemptId = createHash('sha256').update(JSON.stringify(['automatic', binding.ownerId, binding.siteId, operationId])).digest('hex'), at = now();
    const claim = await options.repository.transact(binding, stored => {
      const state = account(stored, binding, at), summary = billingSummary(state.ledger, at), settings = summary.autoReplenishment;
      if (state.ledger.automaticAttempts[attemptId] || !summary.active || summary.cancelAtPeriodEnd || !settings.enabled || summary.automaticPause || summary.reconciliationRequired || !state.consent || state.consent.revoked
        || !state.customerId || state.customerId !== state.consent.customerId || summary.totalAvailableMicros > settings.thresholdMicros
        || summary.automaticCommittedCents + settings.amountCents > settings.monthlyCeilingCents
        || Object.values(state.ledger.automaticAttempts).some(item => item.status === 'claimed' || item.status === 'unknown')) return { state, value: null };
      state.ledger = claimAutoReplenishment(state.ledger, { id: attemptId }, at);
      return { state, value: { amountCents: settings.amountCents, customerId: state.customerId, consent: state.consent } };
    });
    if (!claim) return;
    try {
      const result = await provider().createAutomaticTopup({ ...binding, orderId: attemptId, customerId: claim.customerId, paymentMethodId: claim.consent.paymentMethodId,
        amountCents: claim.amountCents, attemptId, consent: claim.consent, reservedCeilingCents: claim.amountCents });
      await options.repository.transact(binding, stored => {
        const state = account(stored, binding, now());
        state.ledger = result.status === 'succeeded' ? applyPaidTopup(state.ledger, {
          eventId: `stripe-test:automatic:${result.paymentId}`, paymentId: `stripe-test:${result.paymentId}`, amountCents: claim.amountCents, currency: 'USD', automaticAttemptId: attemptId,
        }, now()) : failAutoReplenishment(state.ledger, { id: attemptId, outcome: 'unknown' }, now());
        return { state, value: undefined };
      });
    } catch (error) {
      await options.repository.transact(binding, stored => {
        const state = account(stored, binding, now());
        if (state.ledger.automaticAttempts[attemptId]?.status !== 'paid') state.ledger = failAutoReplenishment(state.ledger, { id: attemptId, outcome: error instanceof AppError && error.status === 402 ? 'failed' : 'unknown' }, now());
        return { state, value: undefined };
      });
      // No automatic retry. The ledger holds the pending ceiling and reports the pause.
    }
  }
  async function reserveUsage(input: Binding & { id: string; maxMicros: number; operation: string; rateCardVersion: string }) {
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    z.object({ id: billingIdSchema, maxMicros: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), operation: z.string().min(1).max(100), rateCardVersion: z.string().min(1).max(100) })
      .parse(input);
    const initial = await saved(binding);
    if (initial.ledger.reservations[input.id]) reserveLedgerUsage(initial.ledger, { id: input.id, maxMicros: input.maxMicros, operation: input.operation, rateCardVersion: input.rateCardVersion }, now());
    else await replenish(binding, input.id);
    const acquired = await options.repository.transact(binding, stored => {
      const state = account(stored, binding, now());
      const existed = Boolean(state.ledger.reservations[input.id]);
      state.ledger = reserveLedgerUsage(state.ledger, { id: input.id, maxMicros: input.maxMicros, operation: input.operation, rateCardVersion: input.rateCardVersion }, now());
      return { state, value: !existed };
    });
    return { ...await read(binding), acquired };
  }
  async function settleUsage(input: Binding & { id: string; actualMicros: number | null }) {
    const binding = bindingSchema.parse({ ownerId: input.ownerId, siteId: input.siteId });
    await options.repository.transact(binding, stored => {
      const state = account(stored, binding, now()); state.ledger = settleLedgerUsage(state.ledger, { id: input.id, actualMicros: input.actualMicros }, now());
      return { state, value: undefined };
    });
    return read(binding);
  }
  return { read, createCheckout, reconcileCheckout, reconcileSubscription, reconcileWebhook, setCancellation, setReplenishment, reserveUsage, settleUsage,
    async hasTestAccount(binding: Binding) { return (await read(binding)).hasTestAccount; } };
}
