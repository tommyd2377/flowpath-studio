import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MinutePack } from './paid-model';
import type { PaidStore, Purchase } from './paid-store';
import { boundedText, paidResponse } from './paid-http';

type StripeObject = Record<string, unknown>;
export type StripeTestConfig = { accountId: string; pack: MinutePack; origin: string; key: () => string | undefined; webhookSecret: () => string | undefined };
const object = (v: unknown): StripeObject => v && typeof v === 'object' && !Array.isArray(v) ? v as StripeObject : {};

/** Native Stripe REST boundary: test credentials only; no Connect header, subscriptions or refund API. */
export function createStripeTest(config: StripeTestConfig, store: PaidStore, request: typeof fetch = fetch, now = Date.now) {
  async function api(endpoint: string, body?: URLSearchParams, idempotencyKey?: string) {
    const key = config.key();
    if (!key || !/^(?:sk|rk)_test_/.test(key)) throw new Error('Stripe sandbox credentials are not configured.');
    const response = await request(`https://api.stripe.com/v1/${endpoint}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Stripe sandbox request failed. No automatic retry was attempted.');
    return object(await response.json());
  }
  async function verifyAccount() {
    if (!/^acct_[A-Za-z0-9]+$/.test(config.accountId) || (await api('account')).id !== config.accountId) throw new Error('Stripe sandbox account does not match FlowPath Studio.');
  }
  return {
    async checkout(purchase: Purchase) {
      if (purchase.checkoutUrl) return purchase.checkoutUrl;
      await verifyAccount();
      const price = await api(`prices/${encodeURIComponent(purchase.pack.priceId)}`);
      if (price.livemode !== false || price.active !== true || price.type !== 'one_time' || price.currency !== purchase.pack.currency
        || price.unit_amount !== purchase.pack.amount) throw new Error('Stripe sandbox price does not match the configured pack.');
      const meta = { purchaseId: purchase.id, uid: purchase.uid, packId: purchase.pack.id,
        seconds: String(purchase.pack.seconds), priceId: purchase.pack.priceId, accountId: config.accountId };
      const body = new URLSearchParams({ mode: 'payment', 'line_items[0][price]': purchase.pack.priceId,
        'line_items[0][quantity]': '1', 'payment_method_types[0]': 'card', client_reference_id: purchase.uid,
        success_url: `${config.origin}${purchase.destination}?checkout=returned`, cancel_url: `${config.origin}${purchase.destination}?checkout=canceled`,
        expires_at: String(Math.floor(purchase.createdAt / 1000) + 1800) });
      for (const [key, value] of Object.entries(meta)) { body.set(`metadata[${key}]`, value); body.set(`payment_intent_data[metadata][${key}]`, value); }
      const session = await api('checkout/sessions', body, `flowpath-test-${purchase.id}`);
      if (session.livemode !== false || typeof session.id !== 'string' || !/^cs_test_/.test(session.id)
        || typeof session.url !== 'string' || new URL(session.url).origin !== 'https://checkout.stripe.com') throw new Error('Unexpected Stripe checkout response.');
      await store.checkoutCreated(purchase.id, session.id, session.url);
      return session.url;
    },
    async webhook(request: Request) {
      let raw: string;
      try { raw = await boundedText(request, 262_144); } catch { return paidResponse({ error: 'Invalid event body.' }, 400); }
      const secret = config.webhookSecret();
      if (!secret || !secret.startsWith('whsec_')) return paidResponse({ error: 'Sandbox webhook is not configured.' }, 503);
      const signature = request.headers.get('stripe-signature') ?? '';
      const times = signature.split(',').filter(x => x.startsWith('t=')).map(x => x.slice(2));
      const signatures = signature.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
      if (times.length !== 1 || !/^\d+$/.test(times[0]) || Math.abs(now() / 1000 - Number(times[0])) > 300) return paidResponse({ error: 'Invalid event signature.' }, 400);
      const expected = createHmac('sha256', secret).update(`${times[0]}.${raw}`).digest();
      if (!signatures.some(sig => /^[a-f0-9]{64}$/.test(sig) && timingSafeEqual(expected, Buffer.from(sig, 'hex')))) return paidResponse({ error: 'Invalid event signature.' }, 400);
      try {
        const event = object(JSON.parse(raw));
        if (event.livemode !== false || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event.id)
          || event.account !== undefined && event.account !== config.accountId) return paidResponse({ error: 'Wrong event environment or account.' }, 400);
        const value = object(object(event.data).object);
        const metadata = object(value.metadata);
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
          if (value.payment_status !== 'paid') return paidResponse({ received: true, pending: true });
          // Retrieve canonical test objects; a redirect or stale event snapshot is never fulfillment authority.
          await verifyAccount();
          const session = await api(`checkout/sessions/${encodeURIComponent(String(value.id))}`);
          const m = object(session.metadata);
          const intent = await api(`payment_intents/${encodeURIComponent(String(session.payment_intent))}`);
          if (session.livemode !== false || intent.livemode !== false || session.mode !== 'payment' || session.payment_status !== 'paid'
            || intent.status !== 'succeeded' || intent.amount_received !== session.amount_total || intent.currency !== session.currency
            || m.accountId !== config.accountId || session.client_reference_id !== m.uid || typeof m.purchaseId !== 'string'
            || typeof m.uid !== 'string' || typeof m.packId !== 'string' || typeof m.priceId !== 'string') throw new Error('Invalid payment');
          const items = await api(`checkout/sessions/${encodeURIComponent(String(session.id))}/line_items?limit=2`);
          const lines = Array.isArray(items.data) ? items.data.map(object) : [];
          if (lines.length !== 1 || lines[0].quantity !== 1 || object(lines[0].price).id !== m.priceId) throw new Error('Invalid pack');
          await store.fulfill(event.id, m.purchaseId, { checkoutId: String(session.id), paymentIntent: String(session.payment_intent),
            uid: m.uid, amount: Number(session.amount_total), currency: String(session.currency), packId: m.packId, seconds: Number(m.seconds), priceId: m.priceId });
        } else if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
          if (metadata.accountId === config.accountId && typeof metadata.purchaseId === 'string') await store.failPurchase(metadata.purchaseId, String(value.id));
        } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created' || event.type === 'charge.dispute.closed') {
          await verifyAccount();
          const chargeId = event.type === 'charge.refunded' ? value.id : value.charge;
          const charge = await api(`charges/${encodeURIComponent(String(chargeId))}`);
          if (charge.livemode !== false || charge.currency !== 'usd' || typeof charge.payment_intent !== 'string') throw new Error('Invalid reversal');
          // A dispute freezes the full credit even if later won; manual audited restoration is required.
          const amount = event.type === 'charge.refunded' ? Number(charge.amount_refunded) : Number(charge.amount);
          await store.reverse(event.id, charge.payment_intent, amount);
        }
        return paidResponse({ received: true });
      } catch { return paidResponse({ error: 'Sandbox event could not be reconciled. Retry delivery after configuration is checked.' }, 503); }
    },
  };
}
