import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createStripeTestPaymentAdapter, interpretTestStripeWebhook, type StripeTestConfiguration, type TestStripeExpectation } from '../lib/billing-stripe';
import { AppError } from '../lib/errors';

const now = Date.parse('2026-09-09T12:00:00Z'), sentAt = Math.floor(now / 1000);
const webhookSecret = 'whsec_SYNTHETIC_OFFLINE_FIXTURE_ONLY';
const apiVersion = '2025-03-31.basil';
const binding = { ownerId: 'synthetic-owner', siteId: 'synthetic-site', orderId: 'synthetic-order' };
const topup = { ...binding, customerId: 'cus_synthetic', kind: 'topup', checkoutId: 'cs_test_synthetic', amountCents: 2500 } as const;
const subscription = { ...binding, customerId: 'cus_synthetic', kind: 'subscription', invoiceId: 'in_synthetic', subscriptionId: 'sub_synthetic',
  priceId: 'price_synthetic', term: 'monthly', startsAt: sentAt, endsAt: sentAt + 30 * 86400, subscriptionStatus: 'active' } as const;
const envelope = (type: string, object: unknown) => ({ id: 'evt_synthetic', object: 'event', api_version: apiVersion, type, livemode: false, data: { object } });
const checkout = () => ({ id: topup.checkoutId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
  customer: topup.customerId, currency: 'usd', amount_total: topup.amountCents, payment_intent: 'pi_synthetic', metadata: binding });
const invoice = () => ({ id: subscription.invoiceId, object: 'invoice', livemode: false, status: 'paid', customer: subscription.customerId,
  currency: 'usd', amount_paid: 2900, amount_remaining: 0, collection_method: 'charge_automatically', billing_reason: 'subscription_create',
  parent: { type: 'subscription_details', subscription_details: { subscription: String(subscription.subscriptionId), metadata: binding } },
  lines: { has_more: false, data: [{ currency: 'usd', amount: 2900, quantity: 1, livemode: false,
    parent: { type: 'subscription_item_details', subscription_item_details: { subscription: subscription.subscriptionId, proration: false } },
    pricing: { type: 'price_details', price_details: { price: String(subscription.priceId) } }, period: { start: subscription.startsAt, end: subscription.endsAt } }] },
  payments: { has_more: false, data: [{ object: 'invoice_payment', invoice: subscription.invoiceId, status: 'paid', livemode: false,
    amount_paid: 2900, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_invoice_synthetic' } }] },
});
function signed(body: unknown, expected: TestStripeExpectation = topup, timestamp = sentAt) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${rawBody}`).digest('hex');
  return { mode: 'test' as const, rawBody, signature: `t=${timestamp},v1=${signature}`, webhookSecret, apiVersion, expected, now };
}
const status = (code: number) => (error: unknown) => error instanceof AppError && error.status === code;

test('signed test checkout confirms only its saved customer, publisher, site, order, amount and USD currency', () => {
  const input = signed(envelope('checkout.session.completed', checkout()));
  assert.deepEqual(interpretTestStripeWebhook(input), { ownerId: binding.ownerId, siteId: binding.siteId, mode: 'test', kind: 'topup',
    payment: { eventId: 'stripe-test:evt_synthetic', paymentId: 'stripe-test:pi_synthetic', amountCents: 2500, currency: 'USD' } });
  const altered = [
    { ...checkout(), customer: 'cus_other' }, { ...checkout(), amount_total: 1000 }, { ...checkout(), currency: 'eur' },
    { ...checkout(), metadata: { ...binding, ownerId: 'other-owner' } }, { ...checkout(), metadata: { ...binding, siteId: 'other-site' } },
    { ...checkout(), metadata: { ...binding, orderId: 'other-order' } }, { ...checkout(), payment_intent: null },
  ];
  for (const value of altered) assert.throws(() => interpretTestStripeWebhook(signed(envelope('checkout.session.completed', value))));
});

test('completed but unpaid checkout and failure events grant nothing; delayed confirmed payment keeps its payment identity', () => {
  for (const payment_status of ['unpaid', 'no_payment_required']) {
    assert.equal(interpretTestStripeWebhook(signed(envelope('checkout.session.completed', { ...checkout(), payment_status }))), null);
  }
  assert.equal(interpretTestStripeWebhook(signed(envelope('checkout.session.async_payment_failed', checkout()))), null);
  const early = interpretTestStripeWebhook(signed(envelope('checkout.session.completed', checkout())));
  const delayed = interpretTestStripeWebhook(signed({ ...envelope('checkout.session.async_payment_succeeded', checkout()), id: 'evt_later' }));
  assert.equal(early?.payment.paymentId, delayed?.payment.paymentId);
  assert.notEqual(early?.payment.eventId, delayed?.payment.eventId);
});

test('signature verification binds raw bytes, rejects v0-only, forged, old and future signatures, and accepts rotation signatures', () => {
  const input = signed(envelope('checkout.session.completed', checkout()));
  assert.throws(() => interpretTestStripeWebhook({ ...input, rawBody: `${input.rawBody} ` }), status(400));
  assert.throws(() => interpretTestStripeWebhook({ ...input, signature: input.signature.replace('v1=', 'v0=') }), status(400));
  assert.throws(() => interpretTestStripeWebhook({ ...input, signature: `t=${sentAt},v1=${'0'.repeat(64)}` }), status(400));
  assert.throws(() => interpretTestStripeWebhook({ ...input, signature: `${input.signature},t=${sentAt}` }), status(400));
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('checkout.session.completed', checkout()), topup, sentAt - 301)), status(400));
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('checkout.session.completed', checkout()), topup, sentAt + 301)), status(400));
  assert.ok(interpretTestStripeWebhook({ ...input, signature: `${input.signature},v1=${'0'.repeat(64)},v0=${'1'.repeat(64)}` }));
});

test('live objects, wrong API versions, connected accounts and oversized input fail closed', () => {
  const input = signed(envelope('checkout.session.completed', checkout()));
  assert.throws(() => interpretTestStripeWebhook({ ...input, mode: 'live' as 'test' }), status(503));
  assert.throws(() => interpretTestStripeWebhook({ ...input, webhookSecret: 'sk_live_SYNTHETIC_NOT_A_REAL_KEY' }), status(503));
  assert.throws(() => interpretTestStripeWebhook(signed({ ...envelope('checkout.session.completed', checkout()), livemode: true })), status(400));
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('checkout.session.completed', { ...checkout(), livemode: true }))));
  assert.throws(() => interpretTestStripeWebhook({ ...input, apiVersion: 'different-version' }), status(400));
  assert.throws(() => interpretTestStripeWebhook(signed({ ...envelope('checkout.session.completed', checkout()), account: 'acct_other' })), status(400));
  assert.throws(() => interpretTestStripeWebhook({ ...input, rawBody: 'x'.repeat(256_001) }), status(400));
});

test('paid subscription invoice requires a complete paid card-collection record and the saved plan period', () => {
  const result = interpretTestStripeWebhook(signed(envelope('invoice.paid', invoice()), subscription));
  assert.deepEqual(result, { ownerId: binding.ownerId, siteId: binding.siteId, mode: 'test', kind: 'subscription', payment: {
    eventId: 'stripe-test:evt_synthetic', paymentId: 'stripe-test:pi_invoice_synthetic', amountCents: 2900, currency: 'USD', term: 'monthly',
    startsAt: subscription.startsAt * 1000, endsAt: subscription.endsAt * 1000,
  } });
  const wrongPrice = invoice(); wrongPrice.lines.data[0].pricing.price_details.price = 'price_other';
  const wrongPeriod = invoice(); wrongPeriod.lines.data[0].period.end += 86400;
  const prorated = invoice(); prorated.lines.data[0].parent.subscription_item_details.proration = true;
  const openPayment = invoice(); openPayment.payments.data[0].status = 'open';
  const wrongSubscription = invoice(); wrongSubscription.parent.subscription_details.subscription = 'sub_other';
  for (const value of [wrongPrice, wrongPeriod, prorated, openPayment, wrongSubscription, { ...invoice(), amount_paid: 2800 },
    { ...invoice(), payments: { has_more: false, data: [] } }, { ...invoice(), lines: { has_more: true, data: invoice().lines.data } }]) {
    assert.throws(() => interpretTestStripeWebhook(signed(envelope('invoice.paid', value), subscription)));
  }
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('invoice.paid', invoice()), { ...subscription, subscriptionStatus: 'incomplete' as 'active' })));
  assert.equal(interpretTestStripeWebhook(signed(envelope('invoice.payment_failed', invoice()), subscription)), null);
  assert.equal(interpretTestStripeWebhook(signed(envelope('checkout.session.completed', checkout()), subscription)), null);
});

test('annual confirmed period grants the annual entitlement price with monthly allowance managed by the ledger', () => {
  const value = invoice();
  value.amount_paid = value.lines.data[0].amount = value.payments.data[0].amount_paid = 30000;
  value.lines.data[0].period.end = sentAt + 365 * 86400;
  const expected = { ...subscription, term: 'annual' as const, endsAt: value.lines.data[0].period.end };
  const result = interpretTestStripeWebhook(signed(envelope('invoice.paid', value), expected));
  assert.equal(result?.payment.amountCents, 30000);
  assert.ok(result?.kind === 'subscription');
  assert.equal(result.payment.term, 'annual');
});

test('a delayed automatic payment can reconcile only its saved attempt and paid amount', () => {
  const value = { id: 'pi_automatic', object: 'payment_intent', livemode: false, status: 'succeeded', customer: 'cus_synthetic', currency: 'usd', amount: 1000, amount_received: 1000,
    metadata: { ...binding, automaticAttemptId: 'automatic-request' } };
  const expected: TestStripeExpectation = { ...binding, customerId: 'cus_synthetic', kind: 'automatic-topup', paymentIntentId: 'pi_automatic', automaticAttemptId: 'automatic-request', amountCents: 1000 };
  const result = interpretTestStripeWebhook(signed(envelope('payment_intent.succeeded', value), expected));
  assert.deepEqual(result, { ownerId: binding.ownerId, siteId: binding.siteId, mode: 'test', kind: 'topup', payment: {
    eventId: 'stripe-test:evt_synthetic', paymentId: 'stripe-test:pi_automatic', amountCents: 1000, currency: 'USD', automaticAttemptId: 'automatic-request',
  } });
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('payment_intent.succeeded', { ...value, amount_received: 999 }), expected)), status(409));
  assert.throws(() => interpretTestStripeWebhook(signed(envelope('payment_intent.succeeded', { ...value, metadata: { ...value.metadata, automaticAttemptId: 'wrong-attempt' } }), expected)), status(409));
  assert.equal(interpretTestStripeWebhook(signed(envelope('payment_intent.payment_failed', value), expected)), null);
});

const configuration: StripeTestConfiguration = { mode: 'test', secretKey: 'sk_test_SYNTHETIC_OFFLINE_FIXTURE_ONLY', apiVersion,
  appOrigin: 'http://127.0.0.1:3220', prices: { 'subscription-monthly': 'price_monthly', 'subscription-annual': 'price_annual',
    'topup-10': 'price_topup10', 'topup-25': 'price_topup25', 'topup-50': 'price_topup50' } };
const checkoutResponse = () => ({ ...checkout(), mode: 'subscription', status: 'open', payment_status: 'unpaid', amount_total: 2900,
  customer: null, subscription: null, payment_intent: null, url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic' });
const subscriptionResponse = () => ({ id: 'sub_synthetic', object: 'subscription', livemode: false, customer: 'cus_synthetic', status: 'active',
  cancel_at_period_end: false, metadata: binding, default_payment_method: 'pm_synthetic', items: { has_more: false, data: [{
    current_period_start: sentAt, current_period_end: sentAt + 30 * 86400,
    price: { id: 'price_monthly', currency: 'usd', unit_amount: 2900, recurring: { interval: 'month', interval_count: 1 } },
  }] } });
function transport(results: { body: unknown; status?: number }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init ?? {} });
    const result = results.shift();
    assert.ok(result, 'Unexpected payment request or retry.');
    return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetcher };
}

test('Stripe REST checkout uses server price IDs, owner-bound metadata, stable idempotency and fixed local return origin', async () => {
  const fake = transport([{ body: checkoutResponse() }]);
  const adapter = createStripeTestPaymentAdapter(configuration, fake.fetcher);
  const result = await adapter.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'checkout-request-1' });
  assert.equal(result.url, 'https://checkout.stripe.com/c/pay/cs_test_synthetic');
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0], form = new URLSearchParams(call.init.body as string), headers = new Headers(call.init.headers);
  assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(call.init.method, 'POST'); assert.equal(call.init.redirect, 'error');
  assert.equal(headers.get('Idempotency-Key'), 'checkout-request-1');
  assert.equal(headers.get('Stripe-Version'), apiVersion);
  assert.equal(form.get('line_items[0][price]'), 'price_monthly');
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.equal(form.get('metadata[ownerId]'), binding.ownerId);
  assert.equal(form.get('subscription_data[metadata][siteId]'), binding.siteId);
  assert.equal(form.get('subscription_data[metadata][orderId]'), binding.orderId);
  assert.equal(form.get('payment_method_types[0]'), 'card');
  assert.equal(new URL(form.get('success_url')!).origin, configuration.appOrigin);
  assert.equal(new URL(form.get('cancel_url')!).origin, configuration.appOrigin);
  assert.equal(new URL(form.get('success_url')!).searchParams.get('session_id'), '{CHECKOUT_SESSION_ID}');
});

test('top-ups use payment Checkout, preserve its owner binding and never silently authorize future card use', async () => {
  const fake = transport([{ body: { ...checkout(), subscription: null, url: 'https://checkout.stripe.com/c/pay/cs_test_synthetic' } }]);
  const adapter = createStripeTestPaymentAdapter(configuration, fake.fetcher);
  await adapter.createCheckout({ ...binding, product: 'topup-25', idempotencyKey: 'topup-request-1', customerId: 'cus_synthetic' });
  const form = new URLSearchParams(fake.calls[0].init.body as string);
  assert.equal(form.get('mode'), 'payment'); assert.equal(form.get('line_items[0][price]'), 'price_topup25');
  assert.equal(form.get('customer'), 'cus_synthetic');
  assert.equal(form.get('payment_intent_data[metadata][orderId]'), binding.orderId);
  assert.equal(form.has('payment_intent_data[setup_future_usage]'), false);
});

test('Stripe REST adapter refuses live keys, untrusted origins, provider redirects and live responses without leaking errors or retrying', async () => {
  const unused = transport([]);
  assert.throws(() => createStripeTestPaymentAdapter({ ...configuration, secretKey: 'sk_live_SYNTHETIC_NOT_REAL' }, unused.fetcher), status(503));
  assert.throws(() => createStripeTestPaymentAdapter({ ...configuration, appOrigin: 'http://not-loopback.example' }, unused.fetcher), status(503));
  assert.throws(() => createStripeTestPaymentAdapter({ ...configuration, appOrigin: 'https://example.com/other' }, unused.fetcher), status(503));
  assert.equal(unused.calls.length, 0);
  for (const body of [{ ...checkoutResponse(), livemode: true }, { ...checkoutResponse(), url: 'https://attacker.example/checkout' }]) {
    const fake = transport([{ body }]);
    await assert.rejects(createStripeTestPaymentAdapter(configuration, fake.fetcher).createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'checkout-request-1' }));
    assert.equal(fake.calls.length, 1);
  }
  const failure = transport([{ status: 500, body: { error: { message: 'private customer details and secret' } } }]);
  await assert.rejects(createStripeTestPaymentAdapter(configuration, failure.fetcher).retrieveCheckout('cs_test_synthetic'), error => error instanceof AppError && !error.message.includes('private') && error.status === 503);
  assert.equal(failure.calls.length, 1);
  const customerAttention = transport([{ status: 402, body: { error: { message: 'private decline data' } } }]);
  await assert.rejects(createStripeTestPaymentAdapter(configuration, customerAttention.fetcher).retrieveCheckout('cs_test_synthetic'), status(402));
  assert.equal(customerAttention.calls.length, 1);
  let cancelled = false, sent = false;
  const oversized: typeof fetch = async () => new Response(new ReadableStream({
    pull(controller) { if (!sent) { sent = true; controller.enqueue(new Uint8Array(256_001)); } },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(createStripeTestPaymentAdapter(configuration, oversized).retrieveCheckout('cs_test_synthetic'), status(503));
  assert.equal(cancelled, true);
});

test('subscription cancellation waits until period end, checks customer before mutation and can be reversed', async () => {
  const fake = transport([{ body: subscriptionResponse() }, { body: { ...subscriptionResponse(), cancel_at_period_end: true } },
    { body: { ...subscriptionResponse(), cancel_at_period_end: true } }, { body: subscriptionResponse() }]);
  const adapter = createStripeTestPaymentAdapter(configuration, fake.fetcher);
  await adapter.setCancelAtPeriodEnd({ subscriptionId: 'sub_synthetic', customerId: 'cus_synthetic', cancel: true, idempotencyKey: 'cancel-request' });
  await adapter.setCancelAtPeriodEnd({ subscriptionId: 'sub_synthetic', customerId: 'cus_synthetic', cancel: false, idempotencyKey: 'resume-request' });
  assert.equal(new URLSearchParams(fake.calls[1].init.body as string).get('cancel_at_period_end'), 'true');
  assert.equal(new URLSearchParams(fake.calls[3].init.body as string).get('cancel_at_period_end'), 'false');
  assert.deepEqual(fake.calls.map(call => call.init.method), ['GET', 'POST', 'GET', 'POST']);
  const wrongOwner = transport([{ body: subscriptionResponse() }]);
  await assert.rejects(createStripeTestPaymentAdapter(configuration, wrongOwner.fetcher).setCancelAtPeriodEnd({ subscriptionId: 'sub_synthetic', customerId: 'cus_other', cancel: true, idempotencyKey: 'cancel-request' }), status(409));
  assert.equal(wrongOwner.calls.length, 1);
});

test('automatic top-up needs saved customer consent, a held spending allowance and matching payment-method ownership', async () => {
  const input = { ...binding, customerId: 'cus_synthetic', paymentMethodId: 'pm_synthetic', amountCents: 1000 as const, attemptId: 'automatic-request',
    consent: { id: 'consent-synthetic', customerId: 'cus_synthetic', paymentMethodId: 'pm_synthetic', acceptedAt: now, revoked: false }, reservedCeilingCents: 1000 };
  const fake = transport([{ body: { id: 'pm_synthetic', object: 'payment_method', livemode: false, customer: 'cus_synthetic' } },
    { body: { id: 'pi_automatic', object: 'payment_intent', livemode: false, status: 'succeeded', customer: 'cus_synthetic', currency: 'usd', amount: 1000, amount_received: 1000,
      metadata: { ...binding, automaticAttemptId: 'automatic-request' } } }]);
  const adapter = createStripeTestPaymentAdapter(configuration, fake.fetcher);
  await assert.rejects(adapter.createAutomaticTopup({ ...input, reservedCeilingCents: 0 }), status(409));
  await assert.rejects(adapter.createAutomaticTopup({ ...input, consent: { ...input.consent, revoked: true } }));
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(await adapter.createAutomaticTopup(input), { status: 'succeeded', paymentId: 'pi_automatic', amountCents: 1000 });
  const form = new URLSearchParams(fake.calls[1].init.body as string);
  assert.equal(form.get('off_session'), 'true'); assert.equal(form.get('confirm'), 'true');
  assert.equal(new Headers(fake.calls[1].init.headers).get('Idempotency-Key'), input.attemptId);
  const wrongOwner = transport([{ body: { id: 'pm_synthetic', object: 'payment_method', livemode: false, customer: 'cus_other' } }]);
  await assert.rejects(createStripeTestPaymentAdapter(configuration, wrongOwner.fetcher).createAutomaticTopup(input), status(409));
  assert.equal(wrongOwner.calls.length, 1);
});
