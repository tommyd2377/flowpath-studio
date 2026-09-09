import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError } from './errors';
import { getBackendMode } from './firebase/config';
import type { WorkspaceUser } from './firebase/types';
import { getSite } from './site-store';
import { LAUNCH_OFFER, billingLedgerSchema, topupAmountSchema, type BillingLedger } from './billing-model';
import { addBillingMonths, applyPaidSubscription, applyPaidTopup, billingSummary, claimAutoReplenishment,
  currentBillingLedger, reserveUsage, setAutoReplenishment, setCancelAtPeriodEnd, settleUsage } from './billing-ledger';
import { createTestPaymentAdapter, type TestPaymentProduct, type TestPaymentState } from './billing-payments';
import { BILLING_DEMO_USAGE, LAUNCH_RATE_VERSION, RETAIL_MULTIPLIER, retailCharge } from './billing-rates';
import type { BillingView } from './billing-view';

const revision = z.number().int().nonnegative();
const id = z.string().uuid();
export const billingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('activate'), cycle: z.enum(['monthly', 'annual']), idempotencyKey: id }).strict(),
  z.object({ action: z.literal('topup'), amountCents: topupAmountSchema, idempotencyKey: id }).strict(),
  z.object({ action: z.literal('replenishment'), enabled: z.boolean(), amountCents: topupAmountSchema,
    thresholdCents: z.number().int().min(0).max(5000), monthlyCeilingCents: z.number().int().min(0).max(1_000_000), revision }).strict(),
  z.object({ action: z.literal('cancel'), revision }).strict(),
  z.object({ action: z.literal('resume'), revision }).strict(),
  z.object({ action: z.literal('simulate-usage'), kind: z.enum(['chat', 'voice']), idempotencyKey: id }).strict(),
]);
export type BillingCommand = z.infer<typeof billingActionSchema>;
type Account = { version: 1; mode: 'test'; ownerId: string; siteId: string; ledger: BillingLedger; payments: TestPaymentState };
const globals = globalThis as typeof globalThis & { launchBillingQueue?: Promise<unknown> };
const directory = () => join(process.env.VOICE_DATA_DIR || join(process.cwd(), 'data'), 'billing-test');
const pathFor = (siteId: string) => join(directory(), `${id.parse(siteId)}.json`);

async function readAccount(siteId: string, now: number): Promise<Account | null> {
  try {
    const raw = JSON.parse(await readFile(pathFor(siteId), 'utf8'));
    if (raw?.version !== 1 || raw.mode !== 'test' || raw.ownerId !== 'local-demo' || raw.siteId !== siteId
      || raw.ledger === undefined || raw.payments === undefined) throw new AppError('Billing records are temporarily unavailable.', 503);
    return { version: 1, mode: 'test', ownerId: raw.ownerId, siteId,
      ledger: currentBillingLedger(raw.ledger, siteId, now),
      payments: createTestPaymentAdapter({ mode: 'test', state: raw.payments, now: () => now }).snapshot() };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof AppError) throw error;
    throw new AppError('Billing records are temporarily unavailable.', 503);
  }
}

/** This local serialized store never creates real payment or Firebase entitlements. */
async function transact<T>(siteId: string, operation: (account: Account, now: number) => T, now: number): Promise<T> {
  if (getBackendMode() !== 'demo') throw new AppError('Payment processing is not connected. No charge was made.', 503);
  const queued = (globals.launchBillingQueue ?? Promise.resolve()).then(async () => {
    const account = await readAccount(siteId, now) ?? { version: 1 as const, mode: 'test' as const, ownerId: 'local-demo', siteId,
      ledger: currentBillingLedger(undefined, siteId, now), payments: createTestPaymentAdapter({ mode: 'test' }).snapshot() };
    const result = operation(account, now);
    billingLedgerSchema.parse(account.ledger);
    const serialized = JSON.stringify(account);
    if (Buffer.byteLength(serialized) > 2_000_000) throw new AppError('Local billing records need archival before continuing.', 503);
    await mkdir(directory(), { recursive: true });
    const temporary = `${pathFor(siteId)}.${randomUUID()}.tmp`;
    await writeFile(temporary, serialized, { mode: 0o600 });
    await rename(temporary, pathFor(siteId));
    return result;
  });
  globals.launchBillingQueue = queued.catch(() => undefined);
  return queued;
}

export function billingView(ledger: BillingLedger, mode: BillingView['mode'], now: number): BillingView {
  const summary = billingSummary(ledger, now);
  const last = ledger.paidTerms.at(-1);
  return {
    siteId: ledger.siteId, revision: ledger.revision, mode,
    subscription: { status: summary.active ? 'active' : last ? 'canceled' : 'inactive', cycle: summary.term ?? last?.term ?? null,
      currentPeriodEnd: summary.paidThrough ?? last?.endsAt ?? null, cancelAtPeriodEnd: summary.cancelAtPeriodEnd },
    balances: { includedCents: summary.includedAvailableMicros / 10_000, purchasedCents: summary.purchasedAvailableMicros / 10_000, reservedCents: summary.heldMicros / 10_000 },
    allowance: { monthlyCents: LAUNCH_OFFER.includedMonthlyMicros / 10_000, resetsAt: ledger.allowance?.endsAt ?? null },
    offer: { monthlyCents: LAUNCH_OFFER.monthlyPriceCents, annualCents: LAUNCH_OFFER.annualPriceCents,
      retailMultiplier: RETAIL_MULTIPLIER, topUpAmountsCents: [...LAUNCH_OFFER.topUpAmountsCents] },
    replenishment: { enabled: summary.autoReplenishment.enabled, amountCents: summary.autoReplenishment.amountCents,
      thresholdCents: summary.autoReplenishment.thresholdMicros / 10_000, monthlyCeilingCents: summary.autoReplenishment.monthlyCeilingCents,
      spentThisMonthCents: summary.automaticCommittedCents, pause: summary.automaticPause },
  };
}

export async function readBilling(user: WorkspaceUser, siteId: string, now = Date.now()): Promise<BillingView> {
  await getSite(user, siteId); // owner authorization precedes even an empty account
  if (getBackendMode() !== 'demo') return billingView(currentBillingLedger(undefined, siteId, now), 'unavailable', now);
  await globals.launchBillingQueue;
  const account = await readAccount(siteId, now);
  return billingView(account?.ledger ?? currentBillingLedger(undefined, siteId, now), 'preview', now);
}

function payment(account: Account, product: TestPaymentProduct, key: string, now: number) {
  const provider = createTestPaymentAdapter({ mode: 'test', state: account.payments, now: () => now });
  const checkout = provider.createCheckout({ ownerId: account.ownerId, product, idempotencyKey: key });
  const confirmed = provider.confirmCheckout({ checkoutId: checkout.id, ownerId: account.ownerId, outcome: 'succeeded' });
  if (!confirmed.receipt) throw new AppError('The test payment was not confirmed.', 409);
  account.payments = provider.snapshot();
  return confirmed.receipt;
}
const topupProduct = (cents: number) => `topup-${cents / 100}` as TestPaymentProduct;

function replenish(account: Account, now: number) {
  const summary = billingSummary(account.ledger, now);
  const settings = summary.autoReplenishment;
  if (!summary.active || !settings.enabled || summary.automaticPause || summary.reconciliationRequired || summary.cancelAtPeriodEnd || summary.totalAvailableMicros > settings.thresholdMicros
    || summary.automaticCommittedCents + settings.amountCents > settings.monthlyCeilingCents) return false;
  const attemptId = randomUUID();
  // Claim the ceiling before confirming a synthetic payment. Both persist in
  // one local transaction; this callback must never contain real network I/O.
  account.ledger = claimAutoReplenishment(account.ledger, { id: attemptId }, now);
  const receipt = payment(account, topupProduct(settings.amountCents), attemptId, now);
  account.ledger = applyPaidTopup(account.ledger, { eventId: receipt.id, paymentId: receipt.id,
    amountCents: receipt.amountCents as 1000 | 2500 | 5000, currency: 'USD', automaticAttemptId: attemptId }, now);
  return true;
}

/** Server-owned synthetic meter exercises the same reserve/settle/threshold logic. */
function simulateUsage(account: Account, kind: 'chat' | 'voice', requestId: string, now: number) {
  const sample = BILLING_DEMO_USAGE[kind];
  const { retailMicros } = retailCharge(sample.model, sample.tokens);
  const existing = account.ledger.reservations[requestId];
  if (existing && (existing.operation !== `demo-${kind}` || existing.rateCardVersion !== LAUNCH_RATE_VERSION || existing.maxMicros !== retailMicros)) throw new AppError('This usage request was already used.', 409);
  if (existing?.status === 'settled') return;
  const replenished = replenish(account, now);
  account.ledger = reserveUsage(account.ledger, { id: requestId, operation: `demo-${kind}`, maxMicros: retailMicros, rateCardVersion: LAUNCH_RATE_VERSION }, now);
  account.ledger = settleUsage(account.ledger, { id: requestId, actualMicros: retailMicros }, now);
  if (!replenished) replenish(account, now);
}

export async function changeBilling(user: WorkspaceUser, siteId: string, raw: unknown, now = Date.now()): Promise<BillingView> {
  await getSite(user, siteId);
  const command = billingActionSchema.parse(raw);
  return transact(siteId, account => {
    if ('revision' in command && command.revision !== account.ledger.revision) throw new AppError('Billing changed in another tab. Reload before saving.', 409);
    const summary = billingSummary(account.ledger, now);
    if (command.action === 'activate') {
      const product = `subscription-${command.cycle}` as TestPaymentProduct;
      const previous = account.payments.checkouts.find(item => item.idempotencyKey === command.idempotencyKey);
      if (summary.active && !previous) throw new AppError('This site already has an active subscription.', 409);
      const receipt = payment(account, product, command.idempotencyKey, now);
      const start = Date.parse(receipt.paidAt);
      account.ledger = applyPaidSubscription(account.ledger, { eventId: receipt.id, paymentId: receipt.id,
        currency: 'USD', amountCents: receipt.amountCents, term: command.cycle, startsAt: start,
        endsAt: addBillingMonths(start, command.cycle === 'annual' ? 12 : 1) }, now);
    } else if (command.action === 'topup') {
      const previous = account.payments.checkouts.find(item => item.idempotencyKey === command.idempotencyKey);
      if (!summary.active && !previous) throw new AppError('Activate this site’s subscription before adding usage credit.', 402);
      const receipt = payment(account, topupProduct(command.amountCents), command.idempotencyKey, now);
      account.ledger = applyPaidTopup(account.ledger, { eventId: receipt.id, paymentId: receipt.id, currency: 'USD', amountCents: command.amountCents }, now);
    } else if (command.action === 'replenishment') {
      if (!summary.active) throw new AppError('Activate a subscription before configuring automatic replenishment.', 402);
      if (summary.cancelAtPeriodEnd && command.enabled) throw new AppError('Resume the subscription before enabling automatic replenishment.', 409);
      account.ledger = setAutoReplenishment(account.ledger, { enabled: command.enabled, amountCents: command.amountCents,
        thresholdMicros: command.thresholdCents * 10_000, monthlyCeilingCents: command.monthlyCeilingCents }, now);
    } else if (command.action === 'simulate-usage') simulateUsage(account, command.kind, command.idempotencyKey, now);
    else {
      if (!summary.active) throw new AppError('There is no active subscription to change.', 409);
      account.ledger = setCancelAtPeriodEnd(account.ledger, command.action === 'cancel', now);
      if (command.action === 'cancel') account.ledger = setAutoReplenishment(account.ledger, { ...account.ledger.autoReplenishment, enabled: false }, now);
    }
    return billingView(account.ledger, 'preview', now);
  }, now);
}

/** Billing previews must never authorize paid provider traffic. Existing un-enrolled pilots retain their attempt caps. */
export async function assertTestBillingAccess(siteId: string, purpose: 'publish' | 'ai', now = Date.now()) {
  if (getBackendMode() !== 'demo') return;
  await globals.launchBillingQueue;
  const account = await readAccount(siteId, now);
  if (account?.ledger.paidTerms.length && !billingSummary(account.ledger, now).active) {
    throw new AppError(purpose === 'publish' ? 'This site’s test subscription has ended. Activate it in Usage & billing before publishing.'
      : 'This site’s AI allowance is unavailable. You can still browse the published information.', 402);
  }
}

/** Only enrolled local sites get synthetic metering; all existing un-enrolled demos stay free. */
export async function meterDemoUsage(siteId: string, kind: 'chat' | 'voice', requestId: string, now = Date.now()) {
  if (getBackendMode() !== 'demo') return;
  await globals.launchBillingQueue;
  const account = await readAccount(siteId, now);
  if (!account?.ledger.paidTerms.length) return;
  return transact(siteId, current => { simulateUsage(current, kind, requestId, now); }, now);
}
