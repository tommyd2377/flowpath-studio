import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { createStripeTest } from '../lib/stripe-test';
import { paidFixture } from './paid-fixture';

const secret = 'whsec_synthetic_fixture_only';
function signed(event: object, timestamp: number, change = '') {
  const raw = JSON.stringify(event);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  return new Request('http://127.0.0.1:3220/api/billing/webhook', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` }, body: raw + change });
}
async function fixture() {
  const f = paidFixture(); const id = randomUUID();
  const purchase = await f.store.beginPurchase(f.owner, id, `/p/${f.wave.id}`, f.pack);
  const metadata = { purchaseId: id, uid: 'creator', packId: f.pack.id, seconds: '900', priceId: f.pack.priceId, accountId: 'acct_flowpath' };
  const session = { id: 'cs_test_flowpath', livemode: false, mode: 'payment', payment_status: 'paid',
    payment_intent: 'pi_flowpath', amount_total: 500, currency: 'usd', client_reference_id: 'creator', metadata };
  const requests: { url: string; body?: string; idempotency?: string | null }[] = [];
  const api = (async (input, options) => {
    const url = String(input); requests.push({ url, body: options?.body?.toString(), idempotency: new Headers(options?.headers).get('Idempotency-Key') });
    if (url.endsWith('/account')) return Response.json({ id: 'acct_flowpath' });
    if (url.includes('/prices/')) return Response.json({ id: f.pack.priceId, livemode: false, type: 'one_time', active: true, currency: 'usd', unit_amount: 500 });
    if (url.endsWith('/checkout/sessions')) return Response.json({ id: session.id, livemode: false, url: 'https://checkout.stripe.com/c/pay/cs_test_flowpath' });
    if (url.includes('/line_items')) return Response.json({ data: [{ quantity: 1, price: { id: f.pack.priceId } }] });
    if (url.includes('/payment_intents/')) return Response.json({ id: 'pi_flowpath', livemode: false, status: 'succeeded', amount_received: 500, currency: 'usd' });
    if (url.includes('/charges/')) return Response.json({ livemode: false, payment_intent: 'pi_flowpath', currency: 'usd', amount_refunded: 500, amount: 500 });
    return Response.json(session);
  }) as typeof fetch;
  const config = { accountId: 'acct_flowpath', pack: f.pack, origin: 'https://flowpath.example', key: () => 'rk_test_synthetic_fixture', webhookSecret: () => secret };
  const stripe = createStripeTest(config, f.store, api, f.now);
  const stamp = () => Math.floor(f.now() / 1000);
  const event = (type: string, value: object = session, eid = randomUUID().replaceAll('-', '')) => ({ id: `evt_${eid}`, type, livemode: false, data: { object: value } });
  return { ...f, stripe, config, session, purchase, requests, api, stamp, event };
}

test('Stripe checkout is server-priced, test-only, account-checked and idempotent with safe return URLs', async () => {
  const f = await fixture(); await f.stripe.checkout(f.purchase);
  const call = f.requests.find(r => r.url.endsWith('/checkout/sessions'))!;
  const form = new URLSearchParams(call.body);
  assert.equal(form.get('line_items[0][price]'), f.pack.priceId);
  assert.equal(form.get('line_items[0][quantity]'), '1');
  assert.equal(form.get('mode'), 'payment'); assert.equal(form.get('payment_method_types[0]'), 'card');
  assert.equal(form.get('success_url'), `https://flowpath.example/p/${f.wave.id}?checkout=returned`);
  assert.equal(call.idempotency, `flowpath-test-${f.purchase.id}`);
  const before = f.requests.length; await f.stripe.checkout((await f.store.purchase(f.purchase.id))!); assert.equal(f.requests.length, before);
  const bad = createStripeTest({ ...f.config, key: () => 'sk_live_never_allowed' }, f.store, f.api, f.now);
  await assert.rejects(bad.checkout(f.purchase), /sandbox credentials/);
});

test('raw signature verification rejects tampering, old timestamps, wrong accounts and live events', async () => {
  const f = await fixture(); const event = f.event('checkout.session.completed');
  assert.equal((await f.stripe.webhook(signed(event, f.stamp(), ' '))).status, 400);
  assert.equal((await f.stripe.webhook(signed(event, f.stamp() - 301))).status, 400);
  assert.equal((await f.stripe.webhook(signed({ ...event, livemode: true }, f.stamp()))).status, 400);
  assert.equal((await f.stripe.webhook(signed({ ...event, account: 'acct_other' }, f.stamp()))).status, 400);
  assert.equal((await f.store.wallet('creator')).balance, 0);
});

test('only canonical successful test payments grant credit, replay safely and reverse with compensating entries', async () => {
  const f = await fixture(); const event = f.event('checkout.session.completed');
  assert.equal((await f.stripe.webhook(signed(event, f.stamp()))).status, 200);
  assert.equal((await f.stripe.webhook(signed(event, f.stamp()))).status, 200);
  assert.equal((await f.stripe.webhook(signed(f.event('checkout.session.async_payment_succeeded'), f.stamp()))).status, 200);
  assert.equal((await f.store.wallet('creator')).balance, 900);
  const refund = f.event('charge.refunded', { id: 'ch_fixture' });
  assert.equal((await f.stripe.webhook(signed(refund, f.stamp()))).status, 200);
  assert.equal((await f.stripe.webhook(signed(refund, f.stamp()))).status, 200);
  assert.equal((await f.store.wallet('creator')).balance, 0);
  assert.ok(f.requests.every(r => !r.url.includes('/refunds')));
});

test('pending, failed and mismatched payments never grant minutes; later valid success reconciles', async () => {
  const f = await fixture();
  const pending = f.event('checkout.session.completed', { ...f.session, payment_status: 'unpaid' });
  assert.equal((await f.stripe.webhook(signed(pending, f.stamp()))).status, 200);
  assert.equal((await f.store.wallet('creator')).balance, 0);
  await f.stripe.webhook(signed(f.event('checkout.session.async_payment_failed'), f.stamp()));
  assert.equal((await f.store.purchase(f.purchase.id))?.status, 'failed');
  f.session.amount_total = 501;
  assert.equal((await f.stripe.webhook(signed(f.event('checkout.session.async_payment_succeeded'), f.stamp()))).status, 503);
  assert.equal((await f.store.wallet('creator')).balance, 0);
  f.session.amount_total = 500;
  assert.equal((await f.stripe.webhook(signed(f.event('checkout.session.async_payment_succeeded'), f.stamp()))).status, 200);
  assert.equal((await f.store.wallet('creator')).balance, 900);
});
