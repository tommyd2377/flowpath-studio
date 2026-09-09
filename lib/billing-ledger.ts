import { AppError } from './errors';
import {
  allowancePeriodAt, autoReplenishmentSettingsSchema, BILLING_RECORD_LIMIT, billingIdSchema, billingLedgerSchema,
  LAUNCH_OFFER, paidSubscriptionSchema, paidTopupSchema, validPaidPeriodDates,
  type AutoReplenishmentSettings, type BillingLedger, type PaidSubscription, type PaidTopup,
} from './billing-model';

export { addBillingMonths } from './billing-model';

function validNow(now: number) {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new AppError('Invalid billing timestamp.');
}
function amount(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) throw new AppError('Usage must be an integer number of microdollars.');
}
function add(a: number, b: number) { const value = a + b; amount(value); return value; }
function capacity(value: object) {
  if (Object.keys(value).length >= BILLING_RECORD_LIMIT) throw new AppError('Billing records need archival before more usage can be authorized.', 503);
}
function activeTerm(ledger: BillingLedger, now: number) { return ledger.paidTerms.find((term) => term.startsAt <= now && now < term.endsAt); }
function refresh(ledger: BillingLedger, now: number) {
  const period = allowancePeriodAt(ledger.paidTerms, now);
  if (!period) { ledger.allowance = null; return; }
  if (ledger.allowance?.key !== period.key) ledger.allowance = { ...period, remainingMicros: LAUNCH_OFFER.includedMonthlyMicros };
}
function prepare(value: BillingLedger, now: number): BillingLedger {
  validNow(now);
  const parsed = billingLedgerSchema.safeParse(value);
  if (!parsed.success || parsed.data.updatedAt > now) throw new AppError('Billing usage is temporarily unavailable.', 503);
  refresh(parsed.data, now);
  return parsed.data;
}
function finish(original: BillingLedger, next: BillingLedger, now: number): BillingLedger {
  if (JSON.stringify(original) === JSON.stringify(next)) return next;
  next.revision = add(original.revision, 1);
  next.updatedAt = now;
  return billingLedgerSchema.parse(next);
}
export function createBillingLedger(siteId: string, now: number): BillingLedger {
  validNow(now);
  return billingLedgerSchema.parse({
    version: 1, siteId, revision: 0, updatedAt: now, paidTerms: [], cancelAtPeriodEnd: false,
    allowance: null, purchasedMicros: 0, receipts: {}, reservations: {}, automaticAttempts: {},
    autoReplenishment: { enabled: false, amountCents: 1_000, thresholdMicros: 2_000_000, monthlyCeilingCents: 5_000 },
    automaticPause: null,
  });
}
export function currentBillingLedger(value: unknown, siteId: string, now: number): BillingLedger {
  if (value === undefined) return createBillingLedger(siteId, now);
  const parsed = billingLedgerSchema.safeParse(value);
  if (!parsed.success || parsed.data.siteId !== siteId) throw new AppError('Billing usage is temporarily unavailable.', 503);
  return finish(parsed.data, prepare(parsed.data, now), now);
}

function paymentReplay(ledger: BillingLedger, receipt: BillingLedger['receipts'][string]): boolean {
  const previousEvent = ledger.receipts[receipt.eventId];
  if (previousEvent) {
    if (JSON.stringify(previousEvent) !== JSON.stringify(receipt)) throw new AppError('Payment event conflicts with an existing receipt.', 409);
    return true;
  }
  const previousPayment = Object.values(ledger.receipts).find((entry) => entry.paymentId === receipt.paymentId);
  if (previousPayment) {
    if (JSON.stringify({ ...previousPayment, eventId: receipt.eventId }) !== JSON.stringify(receipt)) throw new AppError('Payment conflicts with an existing receipt.', 409);
    capacity(ledger.receipts);
    ledger.receipts[receipt.eventId] = receipt;
    return true;
  }
  capacity(ledger.receipts);
  return false;
}

/** Call only with a server-verified successful payment, never browser checkout input. */
export function applyPaidSubscription(value: BillingLedger, input: PaidSubscription, now: number): BillingLedger {
  const ledger = prepare(value, now);
  const event = paidSubscriptionSchema.parse(input);
  if (event.amountCents !== (event.term === 'monthly' ? LAUNCH_OFFER.monthlyPriceCents : LAUNCH_OFFER.annualPriceCents)
    || !validPaidPeriodDates([...ledger.paidTerms.filter((term) => term.paymentId !== event.paymentId), event])) {
    throw new AppError('The confirmed subscription does not match the launch offer.', 409);
  }
  const receipt = { ...event, kind: 'subscription' as const };
  if (paymentReplay(ledger, receipt)) return finish(value, ledger, now);
  if (ledger.paidTerms.some((term) => event.startsAt < term.endsAt && event.endsAt > term.startsAt)) {
    throw new AppError('This subscription payment overlaps an already paid period.', 409);
  }
  capacity(ledger.paidTerms);
  ledger.paidTerms.push({ paymentId: event.paymentId, term: event.term, startsAt: event.startsAt, endsAt: event.endsAt });
  ledger.paidTerms.sort((a, b) => a.startsAt - b.startsAt);
  ledger.receipts[event.eventId] = receipt;
  refresh(ledger, now);
  return finish(value, ledger, now);
}

/** Purchased credit rolls over, including while the subscription is inactive. */
export function applyPaidTopup(value: BillingLedger, input: PaidTopup, now: number): BillingLedger {
  const ledger = prepare(value, now);
  const event = paidTopupSchema.parse(input);
  const receipt = { ...event, kind: 'topup' as const };
  if (paymentReplay(ledger, receipt)) return finish(value, ledger, now);
  if (event.automaticAttemptId) {
    const attempt = ledger.automaticAttempts[event.automaticAttemptId];
    if (!attempt || attempt.amountCents !== event.amountCents || attempt.status === 'paid' || attempt.status === 'failed') {
      throw new AppError('Automatic payment does not match a pending attempt.', 409);
    }
    attempt.status = 'paid';
    if (!Object.values(ledger.automaticAttempts).some((entry) => entry.status === 'unknown')) ledger.automaticPause = null;
  }
  ledger.purchasedMicros = add(ledger.purchasedMicros, event.amountCents * 10_000);
  ledger.receipts[event.eventId] = receipt;
  return finish(value, ledger, now);
}

export function setCancelAtPeriodEnd(value: BillingLedger, cancel: boolean, now: number): BillingLedger {
  if (typeof cancel !== 'boolean') throw new AppError('Invalid cancellation preference.');
  const ledger = prepare(value, now);
  ledger.cancelAtPeriodEnd = cancel;
  return finish(value, ledger, now);
}

export function reserveUsage(value: BillingLedger, input: { id: string; maxMicros: number; operation: string; rateCardVersion: string }, now: number): BillingLedger {
  const ledger = prepare(value, now);
  billingIdSchema.parse(input.id);
  amount(input.maxMicros, true);
  const existing = ledger.reservations[input.id];
  if (existing) {
    if (existing.maxMicros !== input.maxMicros || existing.operation !== input.operation || existing.rateCardVersion !== input.rateCardVersion) {
      throw new AppError('Usage reservation conflicts with an existing request.', 409);
    }
    return finish(value, ledger, now);
  }
  if (Object.values(ledger.reservations).some((entry) => entry.reportedMicros !== null)) {
    throw new AppError('An unexpected usage overrun needs reconciliation before more AI usage can be authorized.', 402);
  }
  if (!activeTerm(ledger, now) || !ledger.allowance) throw new AppError('An active paid subscription is required for AI usage.', 402);
  if (add(ledger.allowance.remainingMicros, ledger.purchasedMicros) < input.maxMicros) throw new AppError('AI credit is insufficient for this request. Add prepaid credit to continue.', 402);
  capacity(ledger.reservations);
  const includedMicros = Math.min(input.maxMicros, ledger.allowance.remainingMicros);
  const purchasedMicros = input.maxMicros - includedMicros;
  ledger.allowance.remainingMicros -= includedMicros;
  ledger.purchasedMicros -= purchasedMicros;
  ledger.reservations[input.id] = {
    ...input, includedMicros, purchasedMicros, allowanceKey: ledger.allowance.key,
    createdAt: now, status: 'held', actualMicros: null, reportedMicros: null,
  };
  return finish(value, ledger, now);
}

/** A null observation retains the entire hold until trusted usage is reconciled. */
export function settleUsage(value: BillingLedger, input: { id: string; actualMicros: number | null }, now: number): BillingLedger {
  const ledger = prepare(value, now);
  const reservation = ledger.reservations[input.id];
  if (!reservation) throw new AppError('Usage reservation was not found.', 404);
  if (input.actualMicros === null) {
    if (reservation.status === 'held') reservation.status = 'unknown';
    return finish(value, ledger, now);
  }
  amount(input.actualMicros);
  if (reservation.status === 'settled' || reservation.status === 'cancelled') {
    if (reservation.actualMicros !== input.actualMicros) throw new AppError('Usage settlement conflicts with an existing result.', 409);
    return finish(value, ledger, now);
  }
  if (input.actualMicros > reservation.maxMicros) {
    if (reservation.reportedMicros !== null && reservation.reportedMicros !== input.actualMicros) throw new AppError('Reported usage conflicts with an existing overrun.', 409);
    reservation.status = 'unknown';
    reservation.reportedMicros = input.actualMicros;
    return finish(value, ledger, now);
  }
  const includedSpent = Math.min(input.actualMicros, reservation.includedMicros);
  const purchasedSpent = input.actualMicros - includedSpent;
  if (ledger.allowance?.key === reservation.allowanceKey) ledger.allowance.remainingMicros += reservation.includedMicros - includedSpent;
  ledger.purchasedMicros = add(ledger.purchasedMicros, reservation.purchasedMicros - purchasedSpent);
  reservation.actualMicros = input.actualMicros;
  reservation.reportedMicros = null;
  reservation.status = 'settled';
  return finish(value, ledger, now);
}

/** Only call after proving the provider was not invoked; unknown usage cannot cancel. */
export function cancelUsage(value: BillingLedger, id: string, now: number): BillingLedger {
  const reservation = value.reservations[id];
  if (!reservation) throw new AppError('Usage reservation was not found.', 404);
  if (reservation.status === 'unknown') throw new AppError('Unknown usage must be reconciled before releasing its hold.', 409);
  if (reservation.status === 'settled') throw new AppError('Settled usage cannot be cancelled.', 409);
  const ledger = settleUsage(value, { id, actualMicros: 0 }, now);
  ledger.reservations[id].status = 'cancelled';
  // settleUsage already advances the revision; an identical cancellation remains a no-op.
  return ledger;
}

export function setAutoReplenishment(value: BillingLedger, settings: AutoReplenishmentSettings, now: number): BillingLedger {
  const ledger = prepare(value, now);
  ledger.autoReplenishment = autoReplenishmentSettingsSchema.parse(settings);
  // An explicit user save can rearm a definitive failure, but cannot resolve an unknown charge.
  if (settings.enabled && ledger.automaticPause === 'failed') ledger.automaticPause = null;
  return finish(value, ledger, now);
}
function calendarMonth(now: number) { return new Date(now).toISOString().slice(0, 7); }
function automaticCommittedCents(ledger: BillingLedger, now: number) {
  return Object.values(ledger.automaticAttempts).filter((attempt) => attempt.month === calendarMonth(now) && attempt.status !== 'failed')
    .reduce((total, attempt) => add(total, attempt.amountCents), 0);
}

/** Claims are committed by the store before any payment attempt. Manual top-ups do not use this ceiling. */
export function claimAutoReplenishment(value: BillingLedger, input: { id: string }, now: number): BillingLedger {
  const ledger = prepare(value, now);
  billingIdSchema.parse(input.id);
  if (ledger.automaticAttempts[input.id]) return finish(value, ledger, now);
  const settings = ledger.autoReplenishment;
  if (!activeTerm(ledger, now) || !settings.enabled || ledger.automaticPause
    || Object.values(ledger.reservations).some((entry) => entry.reportedMicros !== null)
    || Object.values(ledger.automaticAttempts).some((attempt) => attempt.status === 'claimed' || attempt.status === 'unknown')) {
    throw new AppError('Automatic replenishment is unavailable or awaiting reconciliation.', 409);
  }
  if ((ledger.allowance?.remainingMicros ?? 0) + ledger.purchasedMicros > settings.thresholdMicros) throw new AppError('Credit is above the automatic replenishment threshold.', 409);
  if (automaticCommittedCents(ledger, now) + settings.amountCents > settings.monthlyCeilingCents) throw new AppError('The monthly automatic replenishment ceiling has been reached.', 402);
  capacity(ledger.automaticAttempts);
  ledger.automaticAttempts[input.id] = { id: input.id, amountCents: settings.amountCents, createdAt: now, month: calendarMonth(now), status: 'claimed' };
  return finish(value, ledger, now);
}
export function failAutoReplenishment(value: BillingLedger, input: { id: string; outcome: 'failed' | 'unknown' }, now: number): BillingLedger {
  const ledger = prepare(value, now);
  if (input.outcome !== 'failed' && input.outcome !== 'unknown') throw new AppError('Invalid payment outcome.');
  const attempt = ledger.automaticAttempts[input.id];
  if (!attempt) throw new AppError('Automatic replenishment attempt was not found.', 404);
  if (attempt.status === 'paid' || attempt.status === 'failed') {
    if (attempt.status !== input.outcome) throw new AppError('Payment outcome conflicts with an existing result.', 409);
    return finish(value, ledger, now);
  }
  attempt.status = input.outcome;
  ledger.automaticPause = input.outcome;
  return finish(value, ledger, now);
}

export function billingSummary(value: BillingLedger, now: number) {
  const ledger = prepare(value, now);
  const term = activeTerm(ledger, now);
  let paidThrough = term?.endsAt ?? null;
  if (paidThrough !== null) {
    for (const next of [...ledger.paidTerms].sort((a, b) => a.startsAt - b.startsAt)) if (next.startsAt === paidThrough) paidThrough = next.endsAt;
  }
  return {
    siteId: ledger.siteId, revision: ledger.revision, active: Boolean(term), term: term?.term ?? null,
    paidThrough, cancelAtPeriodEnd: ledger.cancelAtPeriodEnd,
    includedAvailableMicros: ledger.allowance?.remainingMicros ?? 0,
    purchasedAvailableMicros: ledger.purchasedMicros,
    totalAvailableMicros: add(ledger.allowance?.remainingMicros ?? 0, ledger.purchasedMicros),
    heldMicros: Object.values(ledger.reservations).filter((entry) => entry.status === 'held' || entry.status === 'unknown')
      .reduce((total, entry) => add(total, entry.maxMicros), 0),
    reconciliationRequired: Object.values(ledger.reservations).some((entry) => entry.reportedMicros !== null),
    nextAllowanceAt: ledger.allowance && paidThrough !== null && ledger.allowance.endsAt < paidThrough ? ledger.allowance.endsAt : null,
    autoReplenishment: ledger.autoReplenishment, automaticPause: ledger.automaticPause,
    automaticCommittedCents: automaticCommittedCents(ledger, now),
    automaticMonth: calendarMonth(now),
  };
}
