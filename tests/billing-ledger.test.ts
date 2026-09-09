import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBillingMonths, applyPaidSubscription, applyPaidTopup, billingSummary, cancelUsage,
  claimAutoReplenishment, createBillingLedger, currentBillingLedger, failAutoReplenishment,
  reserveUsage, setAutoReplenishment, setCancelAtPeriodEnd, settleUsage,
} from '../lib/billing-ledger';
import { billingLedgerSchema, formatUsdMicros, LAUNCH_OFFER, type BillingLedger, type BillingTerm } from '../lib/billing-model';

const now = Date.parse('2026-01-31T15:45:30.123Z');
const usd = (dollars: number) => dollars * 1_000_000;
function paid(term: BillingTerm = 'monthly', startsAt = now): BillingLedger {
  return applyPaidSubscription(createBillingLedger('site-one', startsAt), {
    eventId: 'event-subscription', paymentId: 'payment-subscription', currency: 'USD',
    amountCents: term === 'monthly' ? 2_900 : 30_000, term, startsAt,
    endsAt: addBillingMonths(startsAt, term === 'monthly' ? 1 : 12),
  }, startsAt);
}
function reserve(ledger: BillingLedger, id: string, maxMicros: number, at = now) {
  return reserveUsage(ledger, { id, maxMicros, operation: 'visitor-chat', rateCardVersion: 'retail-v1' }, at);
}
function topup(ledger: BillingLedger, id = 'one', at = now, automaticAttemptId?: string) {
  return applyPaidTopup(ledger, {
    eventId: `event-topup-${id}`, paymentId: `payment-topup-${id}`, currency: 'USD', amountCents: 1_000,
    ...(automaticAttemptId ? { automaticAttemptId } : {}),
  }, at);
}
const settings = { enabled: true, amountCents: 1_000 as const, thresholdMicros: usd(2), monthlyCeilingCents: 2_000 };
function emptyAuto() {
  return setAutoReplenishment(settleUsage(reserve(paid('annual'), 'use-included', usd(10)), { id: 'use-included', actualMicros: usd(10) }, now), settings, now);
}

test('launch offer grants no subscription or credit before successful trusted payment', () => {
  const ledger = createBillingLedger('site-one', now);
  assert.deepEqual(LAUNCH_OFFER.topUpAmountsCents, [1_000, 2_500, 5_000]);
  assert.equal(LAUNCH_OFFER.monthlyPriceCents, 2_900);
  assert.equal(LAUNCH_OFFER.annualPriceCents, 30_000);
  assert.equal(billingSummary(ledger, now).totalAvailableMicros, 0);
  assert.equal(billingSummary(ledger, now).active, false);
  assert.throws(() => reserve(ledger, 'unpaid', 1), /active paid subscription/);
  assert.equal(formatUsdMicros(usd(29)), '$29.00');
  assert.throws(() => formatUsdMicros(0.5));
});

test('annual grants one monthly allowance and clamps anniversaries from the original UTC date', () => {
  let ledger = paid('annual');
  assert.equal(billingSummary(ledger, now).includedAvailableMicros, usd(10));
  assert.equal(billingSummary(ledger, now).nextAllowanceAt, Date.parse('2026-02-28T15:45:30.123Z'));
  ledger = settleUsage(reserve(ledger, 'spent', usd(9)), { id: 'spent', actualMicros: usd(9) }, now);
  const feb = Date.parse('2026-02-28T15:45:30.123Z');
  ledger = currentBillingLedger(ledger, 'site-one', feb);
  assert.equal(ledger.allowance?.remainingMicros, usd(10));
  assert.equal(ledger.allowance?.endsAt, Date.parse('2026-03-31T15:45:30.123Z'));
  assert.equal(billingSummary(ledger, Date.parse('2026-12-31T15:45:30.123Z')).nextAllowanceAt, null);
  assert.equal(billingSummary(ledger, Date.parse('2027-01-31T15:45:30.123Z')).active, false);
});

test('UTC anniversary handling preserves leap day, time and end-of-month behavior', () => {
  const leap = Date.parse('2024-01-31T23:59:59.999Z');
  assert.equal(addBillingMonths(leap, 1), Date.parse('2024-02-29T23:59:59.999Z'));
  assert.equal(addBillingMonths(leap, 2), Date.parse('2024-03-31T23:59:59.999Z'));
  assert.equal(addBillingMonths(Date.parse('2024-02-29T00:00:00Z'), 12), Date.parse('2025-02-28T00:00:00Z'));
});

test('payment receipts reject changed amount, currency, terms, overlap and reused IDs', () => {
  const ledger = paid();
  const receipt = ledger.receipts['event-subscription'];
  assert.equal(receipt.kind, 'subscription');
  if (receipt.kind !== 'subscription') return;
  const { kind, ...event } = receipt;
  assert.equal(kind, 'subscription');
  assert.deepEqual(applyPaidSubscription(ledger, event, now), ledger);
  assert.throws(() => applyPaidSubscription(ledger, { ...event, amountCents: 2_899 }, now), /launch offer/);
  assert.throws(() => applyPaidSubscription(ledger, { ...event, currency: 'EUR' as 'USD' }, now));
  assert.throws(() => applyPaidSubscription(ledger, { ...event, term: 'annual', amountCents: 30_000, endsAt: addBillingMonths(now, 12) }, now), /conflicts/);
  assert.throws(() => applyPaidSubscription(ledger, { ...event, eventId: 'event-other', paymentId: 'payment-other' }, now), /overlaps/);
  assert.throws(() => applyPaidTopup(ledger, { eventId: event.eventId, paymentId: 'new-payment', amountCents: 1_000, currency: 'USD' }, now), /event conflicts/);
  assert.throws(() => applyPaidTopup(ledger, { eventId: 'new-event', paymentId: event.paymentId, amountCents: 1_000, currency: 'USD' }, now), /Payment conflicts/);
  const extraEvent = applyPaidSubscription(ledger, { ...event, eventId: 'event-alias' }, now);
  assert.equal(extraEvent.paidTerms.length, 1);
  assert.equal(extraEvent.allowance?.remainingMicros, usd(10));
  assert.equal(Object.keys(extraEvent.receipts).length, 2);
});

test('confirmed future renewal is saved without advancing the current allowance', () => {
  let ledger = paid();
  ledger = settleUsage(reserve(ledger, 'first-month', usd(6)), { id: 'first-month', actualMicros: usd(6) }, now);
  const startsAt = addBillingMonths(now, 1);
  ledger = applyPaidSubscription(ledger, {
    eventId: 'renewal-event', paymentId: 'renewal-payment', term: 'monthly', currency: 'USD', amountCents: 2_900,
    startsAt, endsAt: addBillingMonths(now, 2),
  }, now);
  assert.equal(ledger.allowance?.remainingMicros, usd(4));
  assert.equal(billingSummary(ledger, now).paidThrough, addBillingMonths(now, 2));
  assert.equal(billingSummary(ledger, startsAt).includedAvailableMicros, usd(10));
  ledger = currentBillingLedger(ledger, 'site-one', startsAt);
  ledger = settleUsage(reserve(ledger, 'renewal-month-usage', usd(5), startsAt), { id: 'renewal-month-usage', actualMicros: usd(5) }, startsAt);
  assert.equal(billingSummary(ledger, Date.parse('2026-03-30T15:45:30.123Z')).includedAvailableMicros, usd(5), 'February clamping must not introduce a second March allowance');
});

test('top-ups roll over while included credit resets, and subscription expiry keeps purchased money', () => {
  let ledger = topup(paid('annual'));
  ledger = settleUsage(reserve(ledger, 'usage', usd(12)), { id: 'usage', actualMicros: usd(12) }, now);
  ledger = currentBillingLedger(ledger, 'site-one', addBillingMonths(now, 1));
  assert.equal(ledger.allowance?.remainingMicros, usd(10));
  assert.equal(ledger.purchasedMicros, usd(8));
  const expiry = addBillingMonths(now, 12);
  ledger = currentBillingLedger(ledger, 'site-one', expiry);
  assert.equal(ledger.allowance, null);
  assert.equal(ledger.purchasedMicros, usd(8));
  assert.throws(() => reserve(ledger, 'after-expiry', 1, expiry), /active paid subscription/);
});

test('cancellation preference preserves paid access through the exclusive paid end', () => {
  const ledger = setCancelAtPeriodEnd(paid(), true, now);
  assert.equal(ledger.cancelAtPeriodEnd, true);
  const end = addBillingMonths(now, 1);
  assert.equal(billingSummary(ledger, end - 1).active, true);
  assert.equal(billingSummary(ledger, end).active, false);
  assert.equal(setCancelAtPeriodEnd(ledger, false, now).cancelAtPeriodEnd, false);
});

test('usage reserves included credit first and settlement refunds unused purchased funding first', () => {
  const original = topup(paid());
  const held = reserve(original, 'request', usd(14));
  assert.equal(held.allowance?.remainingMicros, 0);
  assert.equal(held.purchasedMicros, usd(6));
  assert.equal(billingSummary(held, now).heldMicros, usd(14));
  assert.equal(original.allowance?.remainingMicros, usd(10), 'pure operation must not modify caller state');
  const settled = settleUsage(held, { id: 'request', actualMicros: usd(8) + 1 }, now);
  assert.equal(settled.allowance?.remainingMicros, usd(2) - 1);
  assert.equal(settled.purchasedMicros, usd(10));
  assert.equal(billingSummary(settled, now).heldMicros, 0);
  assert.deepEqual(settleUsage(settled, { id: 'request', actualMicros: usd(8) + 1 }, now), settled);
  assert.throws(() => settleUsage(settled, { id: 'request', actualMicros: usd(7) }, now), /conflicts/);
});

test('reservation retries are idempotent and retain immutable rate-card versions', () => {
  const held = reserve(paid(), 'same', usd(2));
  assert.deepEqual(reserve(held, 'same', usd(2)), held);
  assert.throws(() => reserve(held, 'same', usd(3)), /conflicts/);
  assert.throws(() => reserveUsage(held, { id: 'same', maxMicros: usd(2), operation: 'visitor-chat', rateCardVersion: 'retail-v2' }, now), /conflicts/);
  assert.equal(held.reservations.same.rateCardVersion, 'retail-v1');
  assert.throws(() => reserve(held, 'fractional', 0.1), /integer/);
  assert.throws(() => reserve(held, 'overspend', usd(9)), /insufficient/);
});

test('serialized competing reservations cannot spend the same available balance', () => {
  const original = paid();
  const first = reserve(original, 'first', usd(6));
  assert.equal(first.revision, original.revision + 1);
  assert.throws(() => reserve(first, 'second', usd(6)), /insufficient/);
  assert.equal(first.allowance?.remainingMicros, usd(4));
});

test('unknown usage retains its full reservation and cannot be cancelled or silently zeroed', () => {
  const held = reserve(paid(), 'unknown', usd(7));
  const unknown = settleUsage(held, { id: 'unknown', actualMicros: null }, now);
  assert.equal(unknown.reservations.unknown.status, 'unknown');
  assert.equal(billingSummary(unknown, now).heldMicros, usd(7));
  assert.equal(unknown.allowance?.remainingMicros, usd(3));
  assert.deepEqual(settleUsage(unknown, { id: 'unknown', actualMicros: null }, now), unknown);
  assert.throws(() => cancelUsage(unknown, 'unknown', now), /reconciled/);
  const reconciled = settleUsage(unknown, { id: 'unknown', actualMicros: usd(4) }, now);
  assert.equal(reconciled.allowance?.remainingMicros, usd(6));
});

test('usage over the reserved bound retains its hold, records the overrun and blocks additional AI', () => {
  const held = reserve(paid(), 'overrun', usd(2));
  const overrun = settleUsage(held, { id: 'overrun', actualMicros: usd(3) }, now);
  assert.equal(overrun.reservations.overrun.status, 'unknown');
  assert.equal(overrun.reservations.overrun.reportedMicros, usd(3));
  assert.equal(overrun.allowance?.remainingMicros, usd(8));
  assert.equal(billingSummary(overrun, now).reconciliationRequired, true);
  assert.equal(billingSummary(overrun, now).heldMicros, usd(2));
  assert.throws(() => reserve(overrun, 'another', 1), /overrun needs reconciliation/);
  assert.deepEqual(settleUsage(overrun, { id: 'overrun', actualMicros: usd(3) }, now), overrun);
  assert.throws(() => settleUsage(overrun, { id: 'overrun', actualMicros: usd(4) }, now), /conflicts/);
});

test('old-month cancellation cannot refund included allowance into a new month', () => {
  const held = reserve(topup(paid('annual')), 'across-reset', usd(13));
  const nextMonth = addBillingMonths(now, 1);
  const cancelled = cancelUsage(held, 'across-reset', nextMonth);
  assert.equal(cancelled.allowance?.remainingMicros, usd(10));
  assert.equal(cancelled.purchasedMicros, usd(10));
  assert.equal(cancelled.reservations['across-reset'].status, 'cancelled');
  assert.deepEqual(cancelUsage(cancelled, 'across-reset', nextMonth), cancelled);
});

test('late old-month settlement consumes original held credit and refunds only eligible funds', () => {
  const held = reserve(topup(paid('annual')), 'late', usd(15));
  const nextMonth = addBillingMonths(now, 1);
  const settled = settleUsage(held, { id: 'late', actualMicros: usd(12) }, nextMonth);
  assert.equal(settled.allowance?.remainingMicros, usd(10));
  assert.equal(settled.purchasedMicros, usd(8));
  assert.equal(settled.reservations.late.actualMicros, usd(12));
});

test('top-up replay never duplicates credit and conflicting payment aliases fail closed', () => {
  const ledger = topup(paid());
  const receipt = ledger.receipts['event-topup-one'];
  if (receipt.kind !== 'topup') throw new Error('Missing top-up receipt.');
  const { kind, ...event } = receipt;
  assert.equal(kind, 'topup');
  assert.deepEqual(applyPaidTopup(ledger, event, now), ledger);
  assert.equal(applyPaidTopup(ledger, { ...event, eventId: 'alias' }, now).purchasedMicros, usd(10));
  assert.throws(() => applyPaidTopup(ledger, { ...event, eventId: 'alias-changed', amountCents: 2_500 }, now), /conflicts/);
  assert.throws(() => applyPaidTopup(ledger, { ...event, amountCents: 999 as 1_000 }, now));
});

test('automatic top-ups are disabled by default and require active subscription, low balance and a valid ceiling', () => {
  const ledger = paid();
  assert.throws(() => claimAutoReplenishment(ledger, { id: 'no-opt-in' }, now), /unavailable/);
  assert.throws(() => setAutoReplenishment(ledger, { ...settings, monthlyCeilingCents: 999 }, now));
  const enabled = setAutoReplenishment(ledger, settings, now);
  assert.throws(() => claimAutoReplenishment(enabled, { id: 'still-funded' }, now), /above/);
  const expired = currentBillingLedger(emptyAuto(), 'site-one', addBillingMonths(now, 12));
  assert.throws(() => claimAutoReplenishment(expired, { id: 'expired' }, addBillingMonths(now, 12)), /unavailable/);
});

test('automatic claims reserve their ceiling without granting credit and block overlapping attempts', () => {
  const initial = emptyAuto();
  const claimed = claimAutoReplenishment(initial, { id: 'auto-one' }, now);
  assert.equal(claimed.purchasedMicros, 0);
  assert.equal(billingSummary(claimed, now).automaticCommittedCents, 1_000);
  assert.deepEqual(claimAutoReplenishment(claimed, { id: 'auto-one' }, now), claimed);
  assert.throws(() => claimAutoReplenishment(claimed, { id: 'auto-two' }, now), /awaiting reconciliation/);
  const confirmed = topup(claimed, 'auto-one', now, 'auto-one');
  assert.equal(confirmed.purchasedMicros, usd(10));
  assert.equal(confirmed.automaticAttempts['auto-one'].status, 'paid');
  assert.throws(() => topup(claimed, 'bad', now, 'missing'), /does not match/);
});

test('automatic monthly spend ceiling counts paid and pending attempts, excludes manual purchases', () => {
  let ledger = emptyAuto();
  ledger = topup(claimAutoReplenishment(ledger, { id: 'auto-one' }, now), 'auto-one', now, 'auto-one');
  ledger = settleUsage(reserve(ledger, 'spend-one', usd(10)), { id: 'spend-one', actualMicros: usd(10) }, now);
  ledger = topup(claimAutoReplenishment(ledger, { id: 'auto-two' }, now), 'auto-two', now, 'auto-two');
  ledger = settleUsage(reserve(ledger, 'spend-two', usd(10)), { id: 'spend-two', actualMicros: usd(10) }, now);
  assert.throws(() => claimAutoReplenishment(ledger, { id: 'auto-three' }, now), /ceiling/);
  const manual = topup(ledger, 'manual');
  assert.equal(billingSummary(manual, now).automaticCommittedCents, 2_000);
  assert.equal(billingSummary(manual, Date.parse('2026-02-01T00:00:00Z')).automaticCommittedCents, 0);
});

test('failed automatic payment releases its ceiling but requires explicit rearming and never grants credit', () => {
  const claimed = claimAutoReplenishment(emptyAuto(), { id: 'auto-fail' }, now);
  const failed = failAutoReplenishment(claimed, { id: 'auto-fail', outcome: 'failed' }, now);
  assert.equal(failed.purchasedMicros, 0);
  assert.equal(billingSummary(failed, now).automaticCommittedCents, 0);
  assert.throws(() => claimAutoReplenishment(failed, { id: 'retry' }, now), /unavailable/);
  assert.deepEqual(claimAutoReplenishment(failed, { id: 'auto-fail' }, now), failed);
  assert.throws(() => topup(failed, 'unexpected', now, 'auto-fail'), /does not match/);
  const rearmed = setAutoReplenishment(failed, settings, now);
  assert.equal(claimAutoReplenishment(rearmed, { id: 'explicit-retry' }, now).automaticAttempts['explicit-retry'].status, 'claimed');
});

test('unknown automatic outcome keeps the ceiling and blocks new attempts across months until reconciliation', () => {
  const claimed = claimAutoReplenishment(emptyAuto(), { id: 'uncertain-charge' }, now);
  const unknown = failAutoReplenishment(claimed, { id: 'uncertain-charge', outcome: 'unknown' }, now);
  assert.equal(unknown.purchasedMicros, 0);
  assert.equal(billingSummary(unknown, now).automaticCommittedCents, 1_000);
  const reenabled = setAutoReplenishment(unknown, settings, now);
  assert.throws(() => claimAutoReplenishment(reenabled, { id: 'repeat' }, Date.parse('2026-02-01T00:00:00Z')), /unavailable/);
  const confirmed = topup(unknown, 'reconciled', now, 'uncertain-charge');
  assert.equal(confirmed.purchasedMicros, usd(10));
  assert.equal(confirmed.automaticPause, null);
});

test('malformed, cross-site and future stored state fail closed instead of resetting balances', () => {
  const ledger = paid();
  assert.throws(() => currentBillingLedger({ ...ledger, purchasedMicros: -1 }, 'site-one', now), /unavailable/);
  assert.throws(() => currentBillingLedger(ledger, 'site-two', now), /unavailable/);
  assert.throws(() => currentBillingLedger(ledger, 'site-one', now - 1), /unavailable/);
  assert.throws(() => currentBillingLedger({ ...ledger, allowance: { ...ledger.allowance, key: 'corrupted-key' } }, 'site-one', now), /unavailable/);
  assert.throws(() => currentBillingLedger({ ...ledger, purchasedMicros: 1 }, 'site-one', now), /unavailable/);
  const held = reserve(ledger, 'reservation', 5);
  held.reservations.reservation.includedMicros = 10;
  assert.equal(billingLedgerSchema.safeParse(held).success, false);
  assert.throws(() => reserve(ledger, 'constructor', 1));
});

test('replay record capacity fails closed and never forgets old receipts', () => {
  const ledger = paid();
  const original = ledger.receipts['event-subscription'];
  for (let index = 1; index < 1_000; index++) ledger.receipts[`event-${index}`] = { ...original, eventId: `event-${index}` };
  assert.equal(billingLedgerSchema.safeParse(ledger).success, true);
  assert.throws(() => topup(ledger), /archival/);
  assert.equal(Object.keys(ledger.receipts).length, 1_000);
  if (original.kind !== 'subscription') throw new Error('Expected subscription.');
  const { kind, ...event } = original;
  assert.equal(kind, 'subscription');
  assert.deepEqual(applyPaidSubscription(ledger, event, now), ledger);
});
