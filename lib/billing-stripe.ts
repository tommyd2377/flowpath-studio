import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
import { billingIdSchema, billingTermSchema, LAUNCH_OFFER, paidSubscriptionSchema, paidTopupSchema, topupAmountSchema, type PaidSubscription, type PaidTopup } from './billing-model';
import type { TestPaymentProduct } from './billing-payments';

const reference = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_]+$/);
const seconds = z.number().int().nonnegative().max(8_640_000_000_000);
const binding = { ownerId: z.string().min(1).max(128), siteId: billingIdSchema, orderId: billingIdSchema, customerId: reference };
const expectationSchema = z.discriminatedUnion('kind', [
  z.object({ ...binding, kind: z.literal('topup'), checkoutId: reference, amountCents: topupAmountSchema }).strict(),
  z.object({ ...binding, kind: z.literal('automatic-topup'), paymentIntentId: reference, automaticAttemptId: billingIdSchema, amountCents: topupAmountSchema }).strict(),
  z.object({ ...binding, kind: z.literal('subscription'), invoiceId: reference, subscriptionId: reference,
    priceId: reference, term: billingTermSchema, startsAt: seconds, endsAt: seconds, subscriptionStatus: z.literal('active') }).strict(),
]);
export type TestStripeExpectation = z.infer<typeof expectationSchema>;
export type TestStripePayment = { ownerId: string; siteId: string; mode: 'test' } &
  ({ kind: 'topup'; payment: PaidTopup } | { kind: 'subscription'; payment: PaidSubscription });

const productSchema = z.enum(['subscription-monthly', 'subscription-annual', 'topup-10', 'topup-25', 'topup-50']);
const metadataSchema = z.object({ ownerId: z.string().min(1).max(128), siteId: billingIdSchema, orderId: billingIdSchema });
const checkoutResponseSchema = z.object({ id: reference, object: z.literal('checkout.session'), livemode: z.literal(false),
  mode: z.enum(['subscription', 'payment']), status: z.enum(['open', 'complete', 'expired']), payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  amount_total: z.number().int().nonnegative(), currency: z.literal('usd'), customer: reference.nullable(), subscription: reference.nullable(),
  payment_intent: reference.nullable(), metadata: metadataSchema, url: z.string().url().nullable(),
});
const subscriptionResponseSchema = z.object({ id: reference, object: z.literal('subscription'), livemode: z.literal(false), customer: reference,
  status: z.enum(['active', 'incomplete', 'incomplete_expired', 'trialing', 'past_due', 'unpaid', 'canceled', 'paused']),
  cancel_at_period_end: z.boolean(), metadata: metadataSchema, default_payment_method: reference.nullable(),
  items: z.object({ has_more: z.literal(false), data: z.array(z.object({ current_period_start: seconds, current_period_end: seconds,
    price: z.object({ id: reference, currency: z.literal('usd'), unit_amount: z.number().int().positive(), recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1) }) }) })).length(1) }),
});
const invoiceResponseSchema = z.object({ id: reference, object: z.literal('invoice'), livemode: z.literal(false), status: z.literal('paid'),
    customer: reference, currency: z.literal('usd'), amount_paid: z.number().int().positive(), amount_remaining: z.literal(0),
    collection_method: z.literal('charge_automatically'), billing_reason: z.enum(['subscription_create', 'subscription_cycle']),
    parent: z.object({ type: z.literal('subscription_details'), subscription_details: z.object({ subscription: reference, metadata: metadataSchema }) }),
    lines: z.object({ has_more: z.literal(false), data: z.array(z.object({
      currency: z.literal('usd'), amount: z.number().int().positive(), quantity: z.literal(1), livemode: z.literal(false),
      parent: z.object({ type: z.literal('subscription_item_details'), subscription_item_details: z.object({ subscription: reference, proration: z.literal(false) }) }),
      pricing: z.object({ type: z.literal('price_details'), price_details: z.object({ price: reference }) }),
      period: z.object({ start: seconds, end: seconds }),
    })).length(1) }),
    payments: z.object({ has_more: z.literal(false), data: z.array(z.object({
      object: z.literal('invoice_payment'), invoice: reference, status: z.literal('paid'), livemode: z.literal(false),
      amount_paid: z.number().int().positive(), currency: z.literal('usd'),
      payment: z.object({ type: z.literal('payment_intent'), payment_intent: reference }),
    })).length(1) }),
});
export type StripeTestInvoice = z.infer<typeof invoiceResponseSchema>;
export type StripeTestCheckout = z.infer<typeof checkoutResponseSchema>;
export type StripeTestSubscription = z.infer<typeof subscriptionResponseSchema>;

export type StripeTestConfiguration = {
  mode: 'test'; secretKey: string; apiVersion: string; appOrigin: string;
  prices: Record<TestPaymentProduct, string>;
};

/** Actual Stripe REST protocol, limited to injected TEST credentials. Callers must persist the request before dispatch. */
export function createStripeTestPaymentAdapter(configuration: StripeTestConfiguration, fetcher: typeof fetch = fetch) {
  const config = z.object({ mode: z.literal('test'), secretKey: z.string().regex(/^sk_test_[A-Za-z0-9_]{8,200}$/),
    apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/), appOrigin: z.string().url(), prices: z.record(productSchema, reference) }).strict().safeParse(configuration);
  if (!config.success) throw new AppError('Stripe test payments are not configured.', 503);
  const origin = new URL(config.data.appOrigin);
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)))) throw new AppError('The payment return origin is invalid.', 503);
  const amount = (product: TestPaymentProduct) => product === 'subscription-monthly' ? LAUNCH_OFFER.monthlyPriceCents
    : product === 'subscription-annual' ? LAUNCH_OFFER.annualPriceCents
      : product === 'topup-10' ? LAUNCH_OFFER.topUpAmountsCents[0] : product === 'topup-25' ? LAUNCH_OFFER.topUpAmountsCents[1] : LAUNCH_OFFER.topUpAmountsCents[2];
  const request = async (path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`https://api.stripe.com/v1/${path}`, { method: form ? 'POST' : 'GET', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${config.data.secretKey}`, 'Stripe-Version': config.data.apiVersion,
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': billingIdSchema.parse(idempotencyKey) } : {}) }, body: form?.toString() });
    } catch { throw new AppError('Stripe did not confirm the test payment request. Its result must be reconciled before retrying.', 503); }
    // Provider messages may contain customer or payment details. Never include them in an application error.
    if (!response.ok) throw new AppError(response.status === 402 ? 'The test payment needs customer attention. No credit has been added.' : 'Stripe could not confirm the test payment request.', response.status === 402 ? 402 : 503);
    let result: unknown;
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let text = '', bytes = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 256_000) { await reader.cancel(); throw new Error(); }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        result = JSON.parse(text);
      } finally { reader.releaseLock(); }
    } catch { throw new AppError('Stripe returned an invalid test payment response.', 503); }
    if (!result || typeof result !== 'object' || !('livemode' in result) || result.livemode !== false) throw new AppError('A non-test payment response was rejected.', 503);
    return result;
  };
  const putMetadata = (form: URLSearchParams, value: z.infer<typeof metadataSchema>, prefix = 'metadata') => {
    for (const [key, item] of Object.entries(value)) form.set(`${prefix}[${key}]`, item);
  };
  const checkout = (value: unknown) => {
    const result = checkoutResponseSchema.parse(value);
    if (result.url) {
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com' || url.username || url.password || url.port) throw new AppError('Stripe returned an invalid checkout destination.', 503);
    }
    return result;
  };
  return {
    mode: 'test' as const,
    async createCheckout(input: { ownerId: string; siteId: string; orderId: string; product: TestPaymentProduct; idempotencyKey: string; customerId?: string }): Promise<StripeTestCheckout> {
      const value = metadataSchema.extend({ product: productSchema, idempotencyKey: billingIdSchema, customerId: reference.optional() }).strict().parse(input);
      const metadata = metadataSchema.parse(value), isSubscription = value.product.startsWith('subscription-');
      const success = new URL('/', origin), cancel = new URL('/', origin);
      success.searchParams.set('billing', 'success'); success.searchParams.set('siteId', value.siteId);
      cancel.searchParams.set('billing', 'cancelled'); cancel.searchParams.set('siteId', value.siteId);
      const form = new URLSearchParams({ mode: isSubscription ? 'subscription' : 'payment',
        success_url: `${success.toString()}&session_id={CHECKOUT_SESSION_ID}`, cancel_url: cancel.toString(),
        client_reference_id: value.orderId, 'line_items[0][price]': config.data.prices[value.product], 'line_items[0][quantity]': '1', 'payment_method_types[0]': 'card' });
      if (value.customerId) form.set('customer', value.customerId);
      else if (!isSubscription) form.set('customer_creation', 'always');
      putMetadata(form, metadata); putMetadata(form, metadata, isSubscription ? 'subscription_data[metadata]' : 'payment_intent_data[metadata]');
      const result = checkout(await request('checkout/sessions', form, value.idempotencyKey));
      if (result.mode !== (isSubscription ? 'subscription' : 'payment') || result.amount_total !== amount(value.product)
        || result.metadata.ownerId !== value.ownerId || result.metadata.siteId !== value.siteId || result.metadata.orderId !== value.orderId
        || (value.customerId && result.customer !== value.customerId)) throw new AppError('Stripe checkout does not match the saved order.', 409);
      return result;
    },
    async retrieveCheckout(id: string): Promise<StripeTestCheckout> { return checkout(await request(`checkout/sessions/${reference.parse(id)}`)); },
    async retrieveInvoice(id: string): Promise<StripeTestInvoice> { return invoiceResponseSchema.parse(await request(`invoices/${reference.parse(id)}`)); },
    async retrieveSubscription(id: string): Promise<StripeTestSubscription> { return subscriptionResponseSchema.parse(await request(`subscriptions/${reference.parse(id)}`)); },
    async setCancelAtPeriodEnd(input: { subscriptionId: string; customerId: string; cancel: boolean; idempotencyKey: string }): Promise<StripeTestSubscription> {
      const value = z.object({ subscriptionId: reference, customerId: reference, cancel: z.boolean(), idempotencyKey: billingIdSchema }).strict().parse(input);
      const current = subscriptionResponseSchema.parse(await request(`subscriptions/${value.subscriptionId}`));
      if (current.customer !== value.customerId || current.status === 'canceled') throw new AppError('The subscription does not match this customer or has ended.', 409);
      const result = subscriptionResponseSchema.parse(await request(`subscriptions/${value.subscriptionId}`, new URLSearchParams({ cancel_at_period_end: String(value.cancel) }), value.idempotencyKey));
      if (result.id !== value.subscriptionId || result.customer !== value.customerId || result.cancel_at_period_end !== value.cancel) throw new AppError('Stripe did not confirm the subscription change.', 503);
      return result;
    },
    async createAutomaticTopup(input: { ownerId: string; siteId: string; orderId: string; customerId: string; paymentMethodId: string; amountCents: 1000 | 2500 | 5000; attemptId: string; consent: { id: string; customerId: string; paymentMethodId: string; acceptedAt: number; revoked: boolean }; reservedCeilingCents: number }): Promise<{ status: 'succeeded' | 'pending'; paymentId: string; amountCents: number }> {
      const value = metadataSchema.extend({ customerId: reference, paymentMethodId: reference, amountCents: topupAmountSchema, attemptId: billingIdSchema,
        consent: z.object({ id: billingIdSchema, customerId: reference, paymentMethodId: reference, acceptedAt: z.number().int().positive(), revoked: z.literal(false) }).strict(),
        reservedCeilingCents: z.number().int().nonnegative(), }).strict().parse(input);
      if (value.consent.customerId !== value.customerId || value.consent.paymentMethodId !== value.paymentMethodId || value.consent.acceptedAt > Date.now()
        || value.reservedCeilingCents < value.amountCents) throw new AppError('Automatic test payment permission or spending reservation is missing.', 409);
      const paymentMethod = z.object({ id: reference, object: z.literal('payment_method'), livemode: z.literal(false), customer: reference.nullable() }).parse(await request(`payment_methods/${value.paymentMethodId}`));
      if (paymentMethod.id !== value.paymentMethodId || paymentMethod.customer !== value.customerId) throw new AppError('The saved payment method belongs to another customer.', 409);
      const form = new URLSearchParams({ amount: String(value.amountCents), currency: 'usd', customer: value.customerId, payment_method: value.paymentMethodId,
        off_session: 'true', confirm: 'true', 'payment_method_types[0]': 'card' });
      putMetadata(form, metadataSchema.parse(value)); form.set('metadata[automaticAttemptId]', value.attemptId);
      const result = z.object({ id: reference, object: z.literal('payment_intent'), livemode: z.literal(false), status: z.string(), customer: reference,
        currency: z.literal('usd'), amount: z.number().int(), amount_received: z.number().int(), metadata: metadataSchema.extend({ automaticAttemptId: billingIdSchema }) }).parse(await request('payment_intents', form, value.attemptId));
      if (result.customer !== value.customerId || result.amount !== value.amountCents || result.metadata.automaticAttemptId !== value.attemptId
        || result.metadata.ownerId !== value.ownerId || result.metadata.siteId !== value.siteId || result.metadata.orderId !== value.orderId
        || (result.status === 'succeeded' && result.amount_received !== value.amountCents)) throw new AppError('The automatic test payment does not match its reservation.', 409);
      return { status: result.status === 'succeeded' ? 'succeeded' : 'pending', paymentId: result.id, amountCents: value.amountCents };
    },
  };
}

export type TestStripeWebhookInput = {
  mode: 'test'; rawBody: string; signature: string; webhookSecret: string; apiVersion: string; now?: number;
};

/** Authenticate the raw event before a service performs any provider reconciliation requests. */
export function verifyTestStripeWebhookEnvelope(input: TestStripeWebhookInput) {
  if (input.mode !== 'test') throw new AppError('Real payments are not configured.', 503);
  if (!/^whsec_[a-zA-Z0-9_]{8,200}$/.test(input.webhookSecret)) throw new AppError('A test webhook signing secret is required.', 503);
  if (typeof input.rawBody !== 'string' || Buffer.byteLength(input.rawBody) > 256_000 || !input.rawBody.length
    || typeof input.signature !== 'string' || input.signature.length > 4096) throw new AppError('Invalid payment event.', 400);
  const parts = input.signature.split(',').map(value => value.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't');
  const signatures = parts.filter(([key, value]) => key === 'v1' && /^[a-f0-9]{64}$/.test(value ?? ''));
  if (timestamps.length !== 1 || !/^\d{1,13}$/.test(timestamps[0][1] ?? '') || !signatures.length) throw new AppError('Invalid payment event signature.', 400);
  const sentAt = Number(timestamps[0][1]), now = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(now) || Math.abs(now - sentAt) > 300) throw new AppError('Payment event signature has expired.', 400);
  const digest = createHmac('sha256', input.webhookSecret).update(`${timestamps[0][1]}.${input.rawBody}`).digest();
  if (!signatures.some(([, signature]) => timingSafeEqual(digest, Buffer.from(signature, 'hex')))) throw new AppError('Invalid payment event signature.', 400);
  let body: unknown;
  try { body = JSON.parse(input.rawBody); } catch { throw new AppError('Invalid payment event.', 400); }
  const envelope = z.object({ id: reference, object: z.literal('event'), api_version: z.string(), type: z.string().max(100),
    livemode: z.literal(false), account: z.never().optional(), context: z.never().optional(), data: z.object({ object: z.unknown() }) }).safeParse(body);
  if (!envelope.success || envelope.data.api_version !== input.apiVersion) throw new AppError('Unsupported test payment event.', 400);
  return envelope.data;
}

/** Server-owned expectations only. Stripe seconds are converted to ledger milliseconds. */
export function interpretTestStripeWebhook(input: TestStripeWebhookInput & { expected: TestStripeExpectation }): TestStripePayment | null {
  const event = verifyTestStripeWebhookEnvelope(input), expected = expectationSchema.parse(input.expected);
  const match = (condition: boolean) => { if (!condition) throw new AppError('Payment does not match the saved order.', 409); };
  const matchesMetadata = (value: z.infer<typeof metadataSchema>) => value.ownerId === expected.ownerId && value.siteId === expected.siteId && value.orderId === expected.orderId;
  const common = { ownerId: expected.ownerId, siteId: expected.siteId, mode: 'test' as const };

  if (expected.kind === 'automatic-topup') {
    if (event.type !== 'payment_intent.succeeded') return null;
    const payment = z.object({ id: reference, object: z.literal('payment_intent'), livemode: z.literal(false), status: z.literal('succeeded'),
      customer: reference, currency: z.literal('usd'), amount: z.number().int().positive(), amount_received: z.number().int().positive(),
      metadata: metadataSchema.extend({ automaticAttemptId: billingIdSchema }) }).parse(event.data.object);
    match(payment.id === expected.paymentIntentId && payment.customer === expected.customerId && payment.amount === expected.amountCents
      && payment.amount_received === expected.amountCents && matchesMetadata(payment.metadata) && payment.metadata.automaticAttemptId === expected.automaticAttemptId);
    return { ...common, kind: 'topup', payment: paidTopupSchema.parse({ eventId: `stripe-test:${event.id}`, paymentId: `stripe-test:${payment.id}`,
      amountCents: expected.amountCents, currency: 'USD', automaticAttemptId: expected.automaticAttemptId }) };
  }

  if (expected.kind === 'topup') {
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return null;
    const checkout = z.object({ id: reference, object: z.literal('checkout.session'), livemode: z.literal(false),
      mode: z.literal('payment'), status: z.literal('complete'), payment_status: z.string(),
      customer: reference, currency: z.literal('usd'), amount_total: z.number().int().positive(),
      payment_intent: reference.nullable(), metadata: metadataSchema }).parse(event.data.object);
    match(checkout.id === expected.checkoutId && checkout.customer === expected.customerId && checkout.amount_total === expected.amountCents && matchesMetadata(checkout.metadata));
    if (checkout.payment_status !== 'paid') return null;
    match(checkout.payment_intent !== null);
    return { ...common, kind: 'topup', payment: paidTopupSchema.parse({ eventId: `stripe-test:${event.id}`, paymentId: `stripe-test:${checkout.payment_intent}`, amountCents: expected.amountCents, currency: 'USD' }) };
  }

  if (event.type !== 'invoice.paid') return null;
  const invoice = invoiceResponseSchema.parse(event.data.object);
  const line = invoice.lines.data[0], paid = invoice.payments.data[0];
  const amountCents = expected.term === 'monthly' ? LAUNCH_OFFER.monthlyPriceCents : LAUNCH_OFFER.annualPriceCents;
  match(invoice.id === expected.invoiceId && invoice.customer === expected.customerId
    && invoice.parent.subscription_details.subscription === expected.subscriptionId && matchesMetadata(invoice.parent.subscription_details.metadata)
    && invoice.amount_paid === amountCents && line.amount === amountCents && paid.amount_paid === amountCents && paid.invoice === invoice.id
    && line.parent.subscription_item_details.subscription === expected.subscriptionId && line.pricing.price_details.price === expected.priceId
    && expected.startsAt < expected.endsAt && line.period.start === expected.startsAt && line.period.end === expected.endsAt);
  return { ...common, kind: 'subscription', payment: paidSubscriptionSchema.parse({
    eventId: `stripe-test:${event.id}`, paymentId: `stripe-test:${paid.payment.payment_intent}`,
    amountCents, currency: 'USD', term: expected.term, startsAt: expected.startsAt * 1000, endsAt: expected.endsAt * 1000,
  }) };
}
