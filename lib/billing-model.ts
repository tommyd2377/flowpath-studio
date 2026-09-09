import { z } from 'zod';

export const LAUNCH_OFFER = Object.freeze({
  currency: 'USD' as const,
  monthlyPriceCents: 2_900,
  annualPriceCents: 30_000,
  includedMonthlyMicros: 10_000_000,
  topUpAmountsCents: [1_000, 2_500, 5_000] as const,
  sitesPerSubscription: 1,
});

export const BILLING_RECORD_LIMIT = 1_000;
export const billingIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/)
  .refine((value) => !(value in Object.prototype), 'Invalid billing identifier.');
const micros = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
export const billingTermSchema = z.enum(['monthly', 'annual']);
export type BillingTerm = z.infer<typeof billingTermSchema>;
export const topupAmountSchema = z.union([z.literal(1_000), z.literal(2_500), z.literal(5_000)]);
export const autoReplenishmentSettingsSchema = z.object({
  enabled: z.boolean(), amountCents: topupAmountSchema,
  thresholdMicros: micros.max(50_000_000),
  monthlyCeilingCents: z.number().int().nonnegative().max(1_000_000),
}).strict().refine((value) => !value.enabled || value.monthlyCeilingCents >= value.amountCents,
  'The monthly automatic top-up ceiling must cover at least one top-up.');
export type AutoReplenishmentSettings = z.infer<typeof autoReplenishmentSettingsSchema>;

export const paidSubscriptionSchema = z.object({
  eventId: billingIdSchema, paymentId: billingIdSchema,
  amountCents: z.number().int().positive(), currency: z.literal('USD'),
  term: billingTermSchema, startsAt: timestamp, endsAt: timestamp,
}).strict();
export type PaidSubscription = z.infer<typeof paidSubscriptionSchema>;
export const paidTopupSchema = z.object({
  eventId: billingIdSchema, paymentId: billingIdSchema,
  amountCents: topupAmountSchema, currency: z.literal('USD'),
  automaticAttemptId: billingIdSchema.optional(),
}).strict();
export type PaidTopup = z.infer<typeof paidTopupSchema>;

const paidTermSchema = z.object({
  paymentId: billingIdSchema, term: billingTermSchema, startsAt: timestamp, endsAt: timestamp,
}).strict();
const receiptSchema = z.discriminatedUnion('kind', [
  paidSubscriptionSchema.extend({ kind: z.literal('subscription') }),
  paidTopupSchema.extend({ kind: z.literal('topup') }),
]);
const reservationSchema = z.object({
  id: billingIdSchema, operation: z.string().min(1).max(100),
  rateCardVersion: z.string().min(1).max(100), createdAt: timestamp,
  maxMicros: micros.positive(), includedMicros: micros, purchasedMicros: micros,
  allowanceKey: z.string().min(1).max(200),
  status: z.enum(['held', 'unknown', 'settled', 'cancelled']), actualMicros: micros.nullable(),
  reportedMicros: micros.nullable(),
}).strict().refine((value) => value.includedMicros + value.purchasedMicros === value.maxMicros
  && (value.status === 'settled' ? value.actualMicros !== null && value.actualMicros <= value.maxMicros
    : value.status === 'cancelled' ? value.actualMicros === 0 : value.actualMicros === null)
  && (value.reportedMicros === null || (value.status === 'unknown' && value.reportedMicros > value.maxMicros)),
'Invalid usage reservation.');
const attemptSchema = z.object({
  id: billingIdSchema, amountCents: topupAmountSchema, createdAt: timestamp,
  month: z.string().regex(/^\d{4,6}-\d{2}$/),
  status: z.enum(['claimed', 'failed', 'unknown', 'paid']),
}).strict();
const boundedMap = <T extends z.ZodType>(schema: T) => z.record(billingIdSchema, schema)
  .refine((value) => Object.keys(value).length <= BILLING_RECORD_LIMIT, 'Billing record capacity reached.');

/** UTC anniversaries always use the original anchor, so Jan 31 → Feb 28 → Mar 31. */
export function addBillingMonths(anchor: number, months: number): number {
  const date = new Date(anchor);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months + 1, 0)).getUTCDate();
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, Math.min(date.getUTCDate(), lastDay),
    date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
}

export function validPaidPeriodDates(terms: { term: BillingTerm; startsAt: number; endsAt: number }[]): boolean {
  let previous: { term: BillingTerm; startsAt: number; endsAt: number } | null = null;
  let anchor = 0;
  return [...terms].sort((a, b) => a.startsAt - b.startsAt).every((term) => {
    if (!previous || previous.endsAt !== term.startsAt || previous.term !== term.term) anchor = term.startsAt;
    const start = new Date(term.startsAt), origin = new Date(anchor);
    const elapsed = (start.getUTCFullYear() - origin.getUTCFullYear()) * 12 + start.getUTCMonth() - origin.getUTCMonth();
    previous = term;
    return addBillingMonths(anchor, elapsed) === term.startsAt
      && addBillingMonths(anchor, elapsed + (term.term === 'monthly' ? 1 : 12)) === term.endsAt;
  });
}

export function allowancePeriodAt(terms: { paymentId: string; term: BillingTerm; startsAt: number; endsAt: number }[], at: number) {
  let previous: typeof terms[number] | null = null;
  let anchor = 0;
  for (const term of [...terms].sort((a, b) => a.startsAt - b.startsAt)) {
    if (!previous || previous.endsAt !== term.startsAt || previous.term !== term.term) anchor = term.startsAt;
    previous = term;
    if (term.startsAt <= at && at < term.endsAt) {
      const now = new Date(at), origin = new Date(anchor);
      let month = (now.getUTCFullYear() - origin.getUTCFullYear()) * 12 + now.getUTCMonth() - origin.getUTCMonth();
      if (addBillingMonths(anchor, month) > at) month--;
      const startsAt = addBillingMonths(anchor, month);
      return { key: `${term.paymentId}:${startsAt}`, startsAt, endsAt: Math.min(term.endsAt, addBillingMonths(anchor, month + 1)) };
    }
  }
  return null;
}

export const billingLedgerSchema = z.object({
  version: z.literal(1), siteId: billingIdSchema, revision: micros, updatedAt: timestamp,
  paidTerms: z.array(paidTermSchema).max(BILLING_RECORD_LIMIT), cancelAtPeriodEnd: z.boolean(),
  allowance: z.object({ key: z.string().min(1).max(200), startsAt: timestamp, endsAt: timestamp, remainingMicros: micros.max(LAUNCH_OFFER.includedMonthlyMicros) }).strict().nullable(),
  purchasedMicros: micros,
  receipts: boundedMap(receiptSchema), reservations: boundedMap(reservationSchema),
  automaticAttempts: boundedMap(attemptSchema),
  autoReplenishment: autoReplenishmentSettingsSchema,
  automaticPause: z.enum(['failed', 'unknown']).nullable(),
}).strict().superRefine((value, context) => {
  const invalid = (message: string) => context.addIssue({ code: 'custom', message });
  const terms = [...value.paidTerms].sort((a, b) => a.startsAt - b.startsAt);
  if (terms.some((term, index) => term.endsAt <= term.startsAt || (index > 0 && terms[index - 1].endsAt > term.startsAt))) {
    invalid('Paid subscription periods must not overlap.');
  }
  if (!validPaidPeriodDates(terms)) invalid('Invalid paid subscription anniversary.');
  const payments = new Map<string, z.infer<typeof receiptSchema>>();
  for (const [id, receipt] of Object.entries(value.receipts)) {
    if (id !== receipt.eventId) invalid('Invalid payment receipt key.');
    const prior = payments.get(receipt.paymentId);
    if (prior && JSON.stringify({ ...prior, eventId: receipt.eventId }) !== JSON.stringify(receipt)) invalid('Conflicting payment receipts.');
    payments.set(receipt.paymentId, receipt);
  }
  const termPayments = new Set<string>();
  for (const term of terms) {
    const payment = payments.get(term.paymentId);
    if (termPayments.has(term.paymentId) || payment?.kind !== 'subscription' || payment.term !== term.term
      || payment.startsAt !== term.startsAt || payment.endsAt !== term.endsAt
      || payment.amountCents !== (term.term === 'monthly' ? LAUNCH_OFFER.monthlyPriceCents : LAUNCH_OFFER.annualPriceCents)) invalid('Invalid paid subscription period.');
    termPayments.add(term.paymentId);
  }
  for (const payment of payments.values()) if (payment.kind === 'subscription' && !termPayments.has(payment.paymentId)) invalid('Subscription receipt is missing its paid period.');
  const active = allowancePeriodAt(terms, value.updatedAt);
  if (active) {
    if (!value.allowance || value.allowance.key !== active.key || value.allowance.startsAt !== active.startsAt
      || value.allowance.endsAt !== active.endsAt) invalid('Invalid current allowance period.');
  } else if (value.allowance !== null) invalid('Allowance requires a current paid period.');

  let expectedPurchased = [...payments.values()].reduce((total, payment) => total + (payment.kind === 'topup' ? payment.amountCents * 10_000 : 0), 0);
  let expectedIncluded = value.allowance ? LAUNCH_OFFER.includedMonthlyMicros : 0;
  for (const reservation of Object.values(value.reservations)) {
    const isHeld = reservation.status === 'held' || reservation.status === 'unknown';
    const actual = reservation.actualMicros ?? 0;
    const includedSpent = isHeld ? reservation.includedMicros : Math.min(actual, reservation.includedMicros);
    expectedPurchased -= isHeld ? reservation.purchasedMicros : actual - includedSpent;
    if (reservation.allowanceKey === value.allowance?.key) expectedIncluded -= includedSpent;
    const period = allowancePeriodAt(terms, reservation.createdAt);
    if (!period || reservation.createdAt > value.updatedAt || reservation.allowanceKey !== period.key) invalid('Usage reservation requires its original paid allowance period.');
  }
  if (expectedPurchased !== value.purchasedMicros || expectedIncluded !== (value.allowance?.remainingMicros ?? 0)) invalid('Billing balances do not match confirmed payments and usage.');
  for (const entries of [Object.entries(value.reservations), Object.entries(value.automaticAttempts)]) {
    if (entries.some(([id, record]) => id !== record.id)) invalid('Invalid billing record key.');
  }
});
export type BillingLedger = z.infer<typeof billingLedgerSchema>;
export type UsageReservation = BillingLedger['reservations'][string];

/** Formatting only: all debits, reservations and rates retain integer microdollars. */
export function formatUsdMicros(value: number): string {
  micros.parse(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 1_000_000);
}
