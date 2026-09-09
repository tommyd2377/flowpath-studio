import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from './errors';
import { LAUNCH_OFFER } from './billing-model';

const productSchema = z.enum(['subscription-monthly', 'subscription-annual', 'topup-10', 'topup-25', 'topup-50']);
export type TestPaymentProduct = z.infer<typeof productSchema>;
const offers: Record<TestPaymentProduct, number> = {
  'subscription-monthly': LAUNCH_OFFER.monthlyPriceCents, 'subscription-annual': LAUNCH_OFFER.annualPriceCents,
  'topup-10': LAUNCH_OFFER.topUpAmountsCents[0], 'topup-25': LAUNCH_OFFER.topUpAmountsCents[1], 'topup-50': LAUNCH_OFFER.topUpAmountsCents[2],
};
const ownerIdSchema = z.string().min(1).max(128);
const checkoutSchema = z.object({
  id: z.string().uuid(), ownerId: ownerIdSchema, product: productSchema,
  idempotencyKey: z.string().uuid(), mode: z.literal('test'),
  currency: z.literal('usd'), amountCents: z.number().int().positive(),
  status: z.enum(['pending', 'succeeded', 'failed']),
  createdAt: z.iso.datetime(), paidAt: z.iso.datetime().nullable(),
}).strict().superRefine((value, context) => {
  if (value.amountCents !== offers[value.product]) context.addIssue({ code: 'custom', message: 'Payment price does not match the offer.' });
  if ((value.status === 'succeeded') !== (value.paidAt !== null)) context.addIssue({ code: 'custom', message: 'Payment status and confirmation disagree.' });
  if (value.paidAt && value.paidAt < value.createdAt) context.addIssue({ code: 'custom', message: 'Payment confirmation precedes checkout.' });
});
export type TestCheckout = z.infer<typeof checkoutSchema>;
const stateSchema = z.object({ version: z.literal(1), checkouts: z.array(checkoutSchema).max(1000) }).strict().superRefine((value, context) => {
  const ids = new Set<string>(), keys = new Set<string>();
  for (const checkout of value.checkouts) {
    const key = JSON.stringify([checkout.ownerId, checkout.idempotencyKey]);
    if (ids.has(checkout.id) || keys.has(key)) context.addIssue({ code: 'custom', message: 'Duplicate checkout identity.' });
    ids.add(checkout.id); keys.add(key);
  }
});
export type TestPaymentState = z.infer<typeof stateSchema>;
export type TestPaymentReceipt = {
  id: string; provider: 'local-test'; livemode: false; ownerId: string;
  product: TestPaymentProduct; currency: 'usd'; amountCents: number; paidAt: string;
};

/** No payment service, credentials, payment details, or network access. Never use for real entitlements. */
export function createTestPaymentAdapter(options: { mode: 'test'; state?: unknown; now?: () => number }) {
  if (options.mode !== 'test') throw new AppError('Real payments are not configured.', 503);
  const parsed = stateSchema.safeParse(options.state ?? { version: 1, checkouts: [] });
  if (!parsed.success) throw new AppError('Test payment records are temporarily unavailable.', 503);
  const state = parsed.data;
  const now = options.now ?? Date.now;
  const timestamp = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new AppError('Test payment clock is unavailable.', 503);
    return new Date(value).toISOString();
  };
  const findCheckout = (checkoutId: string, ownerId: string) => {
    const checkout = state.checkouts.find(value => value.id === checkoutId && value.ownerId === ownerId);
    if (!checkout) throw new AppError('Test checkout was not found.', 404);
    return checkout;
  };
  const receipt = (checkout: TestCheckout): TestPaymentReceipt | null => checkout.status === 'succeeded' && checkout.paidAt ? {
    id: `test-payment:${checkout.id}`, provider: 'local-test', livemode: false,
    ownerId: checkout.ownerId, product: checkout.product, currency: checkout.currency,
    amountCents: checkout.amountCents, paidAt: checkout.paidAt,
  } : null;

  return {
    mode: 'test' as const,
    createCheckout(input: { ownerId: string; product: TestPaymentProduct; idempotencyKey: string }): TestCheckout {
      const request = z.object({ ownerId: ownerIdSchema, product: productSchema, idempotencyKey: z.string().uuid() }).strict().parse(input);
      const existing = state.checkouts.find(value => value.ownerId === request.ownerId && value.idempotencyKey === request.idempotencyKey);
      if (existing) {
        if (existing.product !== request.product) throw new AppError('This checkout request was already used for another purchase.', 409);
        return structuredClone(existing);
      }
      // Retain replay protection; reaching the local fixture bound never discards payment identities.
      if (state.checkouts.length >= 1000) throw new AppError('The local test payment history is full.', 429);
      const checkout: TestCheckout = { ...request, id: randomUUID(), mode: 'test', currency: 'usd', amountCents: offers[request.product], status: 'pending', createdAt: timestamp(), paidAt: null };
      state.checkouts.push(checkout);
      return structuredClone(checkout);
    },
    /** Call only from an authenticated, explicitly synthetic checkout action. Persist with the ledger atomically. */
    confirmCheckout(input: { checkoutId: string; ownerId: string; outcome: 'succeeded' | 'pending' | 'failed' }): { checkout: TestCheckout; receipt: TestPaymentReceipt | null } {
      const request = z.object({ checkoutId: z.string().uuid(), ownerId: ownerIdSchema, outcome: z.enum(['succeeded', 'pending', 'failed']) }).strict().parse(input);
      const checkout = findCheckout(request.checkoutId, request.ownerId);
      if (checkout.status !== 'pending' && checkout.status !== request.outcome) throw new AppError('This test checkout already has a final result. Create a new checkout to try again.', 409);
      if (checkout.status === 'pending' && request.outcome !== 'pending') {
        const paidAt = request.outcome === 'succeeded' ? timestamp() : null;
        if (paidAt && paidAt < checkout.createdAt) throw new AppError('Test payment clock is unavailable.', 503);
        checkout.status = request.outcome;
        checkout.paidAt = paidAt;
      }
      return { checkout: structuredClone(checkout), receipt: receipt(checkout) };
    },
    /** A browser-supplied receipt is never accepted as proof. Read the server-held confirmed checkout. */
    getReceipt(checkoutId: string, ownerId: string): TestPaymentReceipt | null {
      return receipt(findCheckout(z.string().uuid().parse(checkoutId), ownerIdSchema.parse(ownerId)));
    },
    snapshot(): TestPaymentState { return structuredClone(state); },
  };
}
