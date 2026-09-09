import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createFirestoreStripeTestRepository, createStripeTestBillingService, stripeBillingAccountSchema, type StripeBillingAccount, type StripeBillingRepository } from '../lib/billing-stripe-store';
import { createStripeTestPaymentAdapter, type StripeTestConfiguration } from '../lib/billing-stripe';
import { AppError } from '../lib/errors';

const start = Date.parse('2026-09-09T12:00:00Z');
const binding = { ownerId: 'owner-one', siteId: 'site-one' };
const webhook = { secret: 'whsec_synthetic_test_only', apiVersion: '2026-08-27.dahlia' };
const config: StripeTestConfiguration = { mode: 'test', secretKey: 'sk_test_synthetic_test_only', apiVersion: webhook.apiVersion, appOrigin: 'http://127.0.0.1:3220',
  prices: { 'subscription-monthly': 'price_monthly', 'subscription-annual': 'price_annual', 'topup-10': 'price_ten', 'topup-25': 'price_twentyfive', 'topup-50': 'price_fifty' } };
class Repository implements StripeBillingRepository {
  state: StripeBillingAccount | undefined;
  inside = false;
  queue: Promise<unknown> = Promise.resolve();
  transact<T>(request: typeof binding, update: (stored: unknown | undefined) => { state?: StripeBillingAccount; value: T }): Promise<T> {
    const run = this.queue.then(() => {
      if (request.ownerId !== binding.ownerId || request.siteId !== binding.siteId) throw new AppError('Site not found.', 404);
      this.inside = true;
      try {
        const result = update(this.state === undefined ? undefined : structuredClone(this.state));
        if (result.state) this.state = stripeBillingAccountSchema.parse(structuredClone(result.state));
        return structuredClone(result.value);
      } finally { this.inside = false; }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
function harness() {
  const repository = new Repository();
  let clock = start, calls = 0, creates = 0, automaticCalls = 0, lostCheckout = false, lostCancellation = false, automaticOutcome = 'succeeded', canceled = false, status = 'active';
  let subscriptionId = 'sub_one';
  const checkouts = new Map<string, Record<string, unknown>>();
  let subscriptionOrderId = '', subscriptionProduct = 'subscription-monthly';
  let lastAutomatic: { id: string; metadata: Record<string, string>; amount: number } | null = null;
  const metadata = () => ({ ...binding, orderId: subscriptionOrderId });
  const subscription = () => ({ id: subscriptionId, object: 'subscription', livemode: false, customer: 'cus_one', status,
    cancel_at_period_end: canceled, metadata: metadata(), default_payment_method: 'pm_one',
    items: { has_more: false, data: [{ current_period_start: Math.floor(start / 1000), current_period_end: Math.floor(Date.parse('2026-10-09T12:00:00Z') / 1000),
      price: { id: config.prices[subscriptionProduct as keyof typeof config.prices], currency: 'usd', unit_amount: subscriptionProduct === 'subscription-monthly' ? 2900 : 30000,
        recurring: { interval: subscriptionProduct === 'subscription-monthly' ? 'month' : 'year', interval_count: 1 } } }] } });
  const invoice = () => ({ id: 'in_one', object: 'invoice', livemode: false, status: 'paid', customer: 'cus_one', currency: 'usd', amount_paid: 2900,
    amount_remaining: 0, collection_method: 'charge_automatically', billing_reason: 'subscription_create',
    parent: { type: 'subscription_details', subscription_details: { subscription: subscriptionId, metadata: metadata() } },
    lines: { has_more: false, data: [{ currency: 'usd', amount: 2900, quantity: 1, livemode: false,
      parent: { type: 'subscription_item_details', subscription_item_details: { subscription: subscriptionId, proration: false } },
      pricing: { type: 'price_details', price_details: { price: 'price_monthly' } }, period: { start: Math.floor(start / 1000), end: Math.floor(Date.parse('2026-10-09T12:00:00Z') / 1000) } }] },
    payments: { has_more: false, data: [{ object: 'invoice_payment', invoice: 'in_one', status: 'paid', livemode: false, amount_paid: 2900, currency: 'usd', payment: { type: 'payment_intent', payment_intent: 'pi_subscription' } }] } });
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(repository.inside, false, 'network must never happen inside retryable transaction');
    calls++;
    const path = new URL(String(url)).pathname, form = new URLSearchParams(String(init?.body ?? ''));
    let value: unknown;
    if (path === '/v1/checkout/sessions') {
      creates++;
      const id = `cs_${creates}`, mode = form.get('mode')!;
      const product = Object.entries(config.prices).find(([, price]) => price === form.get('line_items[0][price]'))![0];
      if (mode === 'subscription') { subscriptionOrderId = form.get('metadata[orderId]')!; subscriptionProduct = product; }
      value = { id, object: 'checkout.session', livemode: false, mode, status: 'open', payment_status: 'unpaid',
        amount_total: product === 'subscription-monthly' ? 2900 : product === 'subscription-annual' ? 30000 : Number(product.slice(6)) * 100,
        currency: 'usd', customer: 'cus_one', subscription: mode === 'subscription' ? subscriptionId : null, payment_intent: mode === 'payment' ? `pi_${id}` : null,
        metadata: { ownerId: form.get('metadata[ownerId]'), siteId: form.get('metadata[siteId]'), orderId: form.get('metadata[orderId]') }, url: `https://checkout.stripe.com/c/pay/${id}` };
      checkouts.set(id, value as Record<string, unknown>);
      if (lostCheckout) throw new Error('Synthetic transport lost its reply');
    } else if (path.startsWith('/v1/checkout/sessions/')) value = checkouts.get(path.split('/').at(-1)!);
    else if (path.startsWith('/v1/subscriptions/')) {
      if (init?.method === 'POST') { canceled = form.get('cancel_at_period_end') === 'true'; if (lostCancellation) throw new Error('Synthetic cancellation response lost'); }
      value = subscription();
    }
    else if (path.startsWith('/v1/invoices/')) value = invoice();
    else if (path.startsWith('/v1/payment_methods/')) value = { id: 'pm_one', object: 'payment_method', livemode: false, customer: 'cus_one' };
    else if (path === '/v1/payment_intents') {
      automaticCalls++;
      const meta = { ...binding, orderId: form.get('metadata[orderId]')!, automaticAttemptId: form.get('metadata[automaticAttemptId]')! };
      const amount = Number(form.get('amount'));
      lastAutomatic = { id: `pi_auto_${automaticCalls}`, metadata: meta, amount };
      if (automaticOutcome === 'unknown') throw new Error('Synthetic payment confirmation lost');
      if (automaticOutcome === 'failed') return new Response('{}', { status: 402 });
      value = { ...lastAutomatic, object: 'payment_intent', livemode: false, customer: 'cus_one', currency: 'usd', status: automaticOutcome,
        amount_received: automaticOutcome === 'succeeded' ? amount : 0 };
    } else throw new Error(`Unexpected mocked endpoint ${path}`);
    return Response.json(value);
  };
  const service = createStripeTestBillingService({ repository, provider: createStripeTestPaymentAdapter(config, fetcher), prices: config.prices, webhook, now: () => clock });
  function signed(type: string, object: unknown, eventId = `evt_${type.replaceAll('.', '_')}`) {
    const rawBody = JSON.stringify({ id: eventId, object: 'event', api_version: webhook.apiVersion, type, livemode: false, data: { object } });
    const timestamp = Math.floor(clock / 1000), hash = createHmac('sha256', webhook.secret).update(`${timestamp}.${rawBody}`).digest('hex');
    return { rawBody, signature: `t=${timestamp},v1=${hash}` };
  }
  function complete(id: string) {
    const checkout = checkouts.get(id)!;
    Object.assign(checkout, { status: 'complete', payment_status: 'paid', url: null });
    return checkout;
  }
  async function activate() {
    const order = await service.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'subscription-request' });
    complete(order.checkoutId!);
    await service.reconcileWebhook(signed('invoice.paid', invoice()));
    return order;
  }
  return { repository, service, signed, complete, invoice, activate,
    counters: () => ({ calls, creates, automaticCalls }), setLostCheckout: () => { lostCheckout = true; }, setAutomatic: (outcome: string) => { automaticOutcome = outcome; },
    setLostCancellation: () => { lostCancellation = true; },
    setClock: (at: number) => { clock = at; }, endSubscription: () => { status = 'canceled'; canceled = true; }, newSubscription: () => { subscriptionId = 'sub_two'; status = 'active'; canceled = false; },
    lastAutomatic: () => lastAutomatic,
  };
}

test('unconfigured and unauthorized test billing creates no payment or balance', async () => {
  const repository = new Repository(), service = createStripeTestBillingService({ repository, now: () => start });
  assert.equal((await service.read(binding)).configured, false);
  assert.equal(await service.hasTestAccount(binding), false);
  assert.equal(repository.state, undefined);
  await assert.rejects(service.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'first' }), /not configured/);
  const h = harness();
  await assert.rejects(h.service.createCheckout({ ...binding, ownerId: 'another-owner', product: 'subscription-monthly', idempotencyKey: 'first' }), /Site not found/);
  assert.equal(h.counters().calls, 0);
});

test('concurrent checkout requests claim durable idempotency before exactly one provider dispatch', async () => {
  const h = harness();
  const input = { ...binding, product: 'subscription-monthly' as const, idempotencyKey: 'same-request' };
  const results = await Promise.all([h.service.createCheckout(input), h.service.createCheckout(input)]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(h.counters().creates, 1);
  assert.equal(Object.keys(h.repository.state!.orders).length, 1);
  assert.equal(h.repository.state!.ledger.paidTerms.length, 0);
  await assert.rejects(h.service.createCheckout({ ...input, product: 'subscription-annual' }), /already used/);
  await assert.rejects(h.service.createCheckout({ ...input, idempotencyKey: 'different' }), /existing test checkout/);
});

test('checkout redirects grant nothing; verified paid invoice grants exactly once with bound site and customer', async () => {
  const h = harness();
  const order = await h.service.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'start' });
  h.complete(order.checkoutId!);
  await h.service.reconcileCheckout({ ...binding, orderId: order.id, checkoutId: order.checkoutId! });
  assert.equal(h.repository.state!.ledger.paidTerms.length, 0);
  const event = h.signed('invoice.paid', h.invoice());
  await h.service.reconcileWebhook(event);
  await h.service.reconcileWebhook(event);
  assert.equal(h.repository.state!.ledger.paidTerms.length, 1);
  assert.equal(h.repository.state!.ledger.allowance?.remainingMicros, 10_000_000);
  const calls = h.counters().calls;
  await assert.rejects(h.service.reconcileWebhook({ ...event, signature: 'invalid' }), /signature/);
  assert.equal(h.counters().calls, calls, 'unverified events must not trigger provider reads');
  await assert.rejects(h.service.reconcileWebhook(h.signed('invoice.paid', { ...h.invoice(), customer: 'cus_other' }, 'evt_other')), /does not match/);
  assert.equal(h.repository.state!.ledger.paidTerms.length, 1);
});

test('unknown checkout creation stays pending without retry and recovers through a signed completed checkout', async () => {
  const h = harness(); h.setLostCheckout();
  const input = { ...binding, product: 'subscription-monthly' as const, idempotencyKey: 'lost' };
  await assert.rejects(h.service.createCheckout(input), /must be reconciled/);
  const retry = await h.service.createCheckout(input);
  assert.equal(retry.status, 'unknown'); assert.equal(h.counters().creates, 1);
  await h.service.reconcileWebhook(h.signed('checkout.session.completed', h.complete('cs_1')));
  assert.equal(h.repository.state!.orders[retry.id].checkoutId, 'cs_1');
  assert.equal(h.repository.state!.ledger.paidTerms.length, 0);
  await h.service.reconcileWebhook(h.signed('invoice.paid', h.invoice()));
  assert.equal(h.repository.state!.ledger.paidTerms.length, 1);
});

test('prepaid checkout credit is granted only from a paid signed receipt and duplicate payment events do not regrant', async () => {
  const h = harness(); await h.activate();
  const order = await h.service.createCheckout({ ...binding, product: 'topup-25', idempotencyKey: 'topup' });
  assert.equal(h.repository.state!.ledger.purchasedMicros, 0);
  const checkout = h.complete(order.checkoutId!);
  await h.service.reconcileWebhook(h.signed('checkout.session.completed', checkout));
  await h.service.reconcileWebhook(h.signed('checkout.session.async_payment_succeeded', checkout, 'evt_delayed'));
  assert.equal(h.repository.state!.ledger.purchasedMicros, 25_000_000);
});

test('automatic consent is explicit, threshold updates alone do not charge, and concurrent usage can trigger one top-up only', async () => {
  const h = harness(); await h.activate();
  let view = await h.service.read(binding);
  await h.service.setReplenishment({ ...binding, revision: view.ledger.revision,
    settings: { enabled: true, amountCents: 1000, thresholdMicros: 50_000_000, monthlyCeilingCents: 5000 } });
  assert.equal(h.counters().automaticCalls, 0);
  const input = { ...binding, id: 'usage-one', maxMicros: 1_000_000, operation: 'synthetic-chat', rateCardVersion: 'test-v1' };
  const reserved = await Promise.all([h.service.reserveUsage(input), h.service.reserveUsage(input)]);
  assert.equal(reserved.filter(value => value.acquired).length, 1);
  assert.equal(h.counters().automaticCalls, 1);
  assert.equal(h.repository.state!.ledger.purchasedMicros, 10_000_000);
  await h.service.settleUsage({ ...binding, id: 'usage-one', actualMicros: 500_000 });
  assert.equal(h.counters().automaticCalls, 1);
  view = await h.service.read(binding);
  await assert.rejects(h.service.reserveUsage({ ...input, id: 'invalid', maxMicros: -1 }));
  assert.equal(h.counters().automaticCalls, 1);
  assert.equal(view.ledger.reservations['usage-one'].actualMicros, 500_000);
});

test('unknown automatic payment retains ceiling, blocks more attempts, and signed delayed success reconciles its credit', async () => {
  const h = harness(); await h.activate();
  await h.service.setReplenishment({ ...binding, revision: h.repository.state!.ledger.revision,
    settings: { enabled: true, amountCents: 1000, thresholdMicros: 50_000_000, monthlyCeilingCents: 5000 } });
  h.setAutomatic('unknown');
  await h.service.reserveUsage({ ...binding, id: 'unknown-usage', maxMicros: 1, operation: 'synthetic-chat', rateCardVersion: 'test-v1' });
  assert.equal(h.repository.state!.ledger.automaticPause, 'unknown');
  assert.equal(h.repository.state!.ledger.purchasedMicros, 0);
  await h.service.reserveUsage({ ...binding, id: 'second-usage', maxMicros: 1, operation: 'synthetic-chat', rateCardVersion: 'test-v1' });
  assert.equal(h.counters().automaticCalls, 1);
  const automatic = h.lastAutomatic()!;
  const payload = { ...automatic, object: 'payment_intent', livemode: false, customer: 'cus_one', currency: 'usd', status: 'succeeded', amount_received: automatic.amount };
  await h.service.reconcileWebhook(h.signed('payment_intent.succeeded', payload));
  await h.service.reconcileWebhook(h.signed('payment_intent.succeeded', payload));
  assert.equal(h.repository.state!.ledger.purchasedMicros, 10_000_000);
  assert.equal(h.repository.state!.ledger.automaticPause, null);
});

test('cancellation uses revision guards, preserves paid access, and immediately revokes automatic top-ups', async () => {
  const h = harness(); await h.activate();
  await h.service.setReplenishment({ ...binding, revision: h.repository.state!.ledger.revision,
    settings: { enabled: true, amountCents: 1000, thresholdMicros: 50_000_000, monthlyCeilingCents: 5000 } });
  const revision = h.repository.state!.ledger.revision;
  await assert.rejects(h.service.setCancellation({ ...binding, cancel: true, revision: revision - 1, idempotencyKey: 'stale' }), /Billing changed/);
  await h.service.setCancellation({ ...binding, cancel: true, revision, idempotencyKey: 'cancel' });
  assert.equal(h.repository.state!.ledger.cancelAtPeriodEnd, true);
  assert.equal(h.repository.state!.ledger.autoReplenishment.enabled, false);
  assert.equal(h.repository.state!.consent?.revoked, true);
  assert.equal((await h.service.read(binding)).ledger.allowance?.remainingMicros, 10_000_000);
  await h.service.reserveUsage({ ...binding, id: 'still-paid', maxMicros: 1, operation: 'synthetic-chat', rateCardVersion: 'test-v1' });
  assert.equal(h.counters().automaticCalls, 0);
  await assert.rejects(h.service.setReplenishment({ ...binding, revision: h.repository.state!.ledger.revision,
    settings: { enabled: true, amountCents: 1000, thresholdMicros: 1_000_000, monthlyCeilingCents: 5000 } }), /Resume/);
});

test('expired subscriptions can restart only after provider verifies the previous subscription ended', async () => {
  const h = harness(); await h.activate(); h.setClock(Date.parse('2026-10-10T12:00:00Z'));
  await assert.rejects(h.service.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'not-ended' }), /already has a subscription/);
  h.endSubscription();
  const order = await h.service.createCheckout({ ...binding, product: 'subscription-monthly', idempotencyKey: 'restart' });
  assert.equal(order.status, 'open');
  assert.equal(h.counters().creates, 2);
  assert.equal(h.repository.state!.ledger.paidTerms.length, 1, 'new checkout has not granted a second period');
});

test('unknown cancellation reports pending rather than success and can reconcile a matching provider outcome', async () => {
  const h = harness(); await h.activate();
  await h.service.setReplenishment({ ...binding, revision: h.repository.state!.ledger.revision,
    settings: { enabled: true, amountCents: 1000, thresholdMicros: 50_000_000, monthlyCeilingCents: 5000 } });
  const request = { ...binding, cancel: true, revision: h.repository.state!.ledger.revision, idempotencyKey: 'lost-cancel' };
  h.setLostCancellation();
  await assert.rejects(h.service.setCancellation(request), /must be reconciled/);
  assert.equal(h.repository.state!.ledger.autoReplenishment.enabled, false);
  assert.equal(h.repository.state!.consent?.revoked, true);
  const calls = h.counters().calls;
  await assert.rejects(h.service.setCancellation(request), /awaiting reconciliation/);
  assert.equal(h.counters().calls, calls, 'pending cancellation must not automatically redispatch');
  await h.service.reconcileSubscription(binding);
  assert.equal(h.repository.state!.cancellations['lost-cancel'].status, 'confirmed');
  assert.equal(h.repository.state!.ledger.cancelAtPeriodEnd, true);
  await h.service.setCancellation(request);
});

test('Firestore adapter validates owner and isolated test state inside retryable transactions', async () => {
  const h = harness(); await h.activate();
  const records = new Map<string, Record<string, unknown>>([['voiceSites/site-one', { ownerId: binding.ownerId }]]);
  type Ref = { path: string };
  let passes = 0;
  const fake = {
    collection(name: string) { return { doc(id: string) { return { path: `${name}/${id}` }; } }; },
    async runTransaction<T>(callback: (transaction: { getAll(...refs: Ref[]): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }[]>; set(ref: Ref, value: Record<string, unknown>): void }) => Promise<T>) {
      const execute = async (commit: boolean) => {
        passes++;
        const writes = new Map<string, Record<string, unknown>>();
        const result = await callback({ getAll: async (...refs) => refs.map(ref => ({ exists: records.has(ref.path), data: () => records.get(ref.path) })),
          set: (ref, value) => { writes.set(ref.path, value); } });
        if (commit) for (const [key, value] of writes) records.set(key, value);
        return result;
      };
      await execute(false); // Firestore may replay a transaction callback after a conflict.
      return execute(true);
    },
  };
  const repository = createFirestoreStripeTestRepository(fake as unknown as Parameters<typeof createFirestoreStripeTestRepository>[0]);
  await repository.transact(binding, () => ({ state: h.repository.state!, value: 'saved' }));
  const accountRecord = [...records.entries()].find(([path]) => path.startsWith('voiceStripeTestBilling/'))!;
  assert.equal(accountRecord[1].mode, 'stripe-test');
  assert.equal(typeof accountRecord[1].state, 'string');
  assert.equal(passes, 2);
  const service = createStripeTestBillingService({ repository, now: () => start });
  assert.equal((await service.read(binding)).ledger.paidTerms.length, 1);
  records.set('voiceSites/site-one', { ownerId: 'someone-else' });
  await assert.rejects(service.read(binding), /Site not found/);
  records.set('voiceSites/site-one', { ownerId: binding.ownerId });
  records.set(accountRecord[0], { ...accountRecord[1], state: '{}' });
  await assert.rejects(service.read(binding), /temporarily unavailable/);
});
