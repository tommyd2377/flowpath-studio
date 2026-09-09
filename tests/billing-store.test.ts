import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkspaceUser } from '../lib/firebase/types';

test('billing routes isolate owners/sites, reject forged prices and replay payments without duplicate credit', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'launch-offer-store-'));
  const environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests allowed.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { GET, POST } = await import('../app/api/sites/[siteId]/billing/route');
    const { changeBilling, readBilling, assertTestBillingAccess, meterDemoUsage } = await import('../lib/billing-store');
    const user: WorkspaceUser = { uid: 'local-demo', mode: 'demo', email: null, displayName: null };
    const site = initialSite('general', 'Billing only', 'billing-only');
    const other = initialSite('general', 'Other billing', 'other-billing');
    await withDatabase(db => { db.sites = [site, other]; });
    const origin = 'http://127.0.0.1:3220';
    const routeContext = { params: Promise.resolve({ siteId: site.id }) };
    const send = (body: unknown, from = origin) => POST(new Request(`${origin}/api/sites/${site.id}/billing`, {
      method: 'POST', headers: { origin: from, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), routeContext);
    const start = { action: 'activate', cycle: 'monthly', idempotencyKey: randomUUID() };
    assert.equal((await send(start, 'https://foreign.example')).status, 403);
    assert.equal((await send({ ...start, amountCents: 1 })).status, 400);
    const now = Date.now();
    let view = await changeBilling(user, site.id, start, now);
    assert.equal(view.balances.includedCents, 1000);
    await changeBilling(user, site.id, start, now + 1);
    assert.equal((await readBilling(user, site.id, now + 2)).balances.includedCents, 1000);
    const topup = { action: 'topup', amountCents: 1000, idempotencyKey: randomUUID() };
    await Promise.all(Array.from({ length: 5 }, () => changeBilling(user, site.id, topup, now + 3)));
    assert.equal((await readBilling(user, site.id, now + 4)).balances.purchasedCents, 1000);
    await assert.rejects(changeBilling(user, site.id, { ...topup, amountCents: 2500 }, now + 5), /already used/);
    assert.equal((await readBilling(user, other.id, now + 6)).balances.purchasedCents, 0);
    await assert.rejects(readBilling({ ...user, uid: 'other-owner' }, site.id, now + 7), /Sign in/);
    assert.equal((await GET(new Request(`${origin}/api/sites/${randomUUID()}/billing`), { params: Promise.resolve({ siteId: randomUUID() }) })).status, 404);
    view = await readBilling(user, site.id, now + 8);
    await assert.rejects(changeBilling(user, site.id, { action: 'cancel', revision: view.revision - 1 }, now + 9), /another tab/);
    await changeBilling(user, site.id, { action: 'cancel', revision: view.revision }, now + 10);
    const expiry = view.subscription.currentPeriodEnd!;
    await assert.rejects(assertTestBillingAccess(site.id, 'publish', expiry), /has ended/);
    await assert.rejects(meterDemoUsage(site.id, 'chat', randomUUID(), expiry), /subscription/);
    assert.equal((await readBilling(user, site.id, expiry)).balances.purchasedCents, 1000);
    const saved = JSON.parse(await readFile(join(directory, 'billing-test', `${site.id}.json`), 'utf8'));
    saved.ledger.purchasedMicros = -1;
    await writeFile(join(directory, 'billing-test', `${site.id}.json`), JSON.stringify(saved));
    await assert.rejects(readBilling(user, site.id, expiry), /temporarily unavailable/);
    assert.equal(network.mock.callCount(), 0);
  } finally { process.env = environment; await rm(directory, { recursive: true, force: true }); }
});

test('automatic replenishment stays inside its ceiling during concurrent synthetic usage and cancellation disables it', async context => {
  const directory = await mkdtemp(join(tmpdir(), 'launch-offer-auto-'));
  const environment = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const network = context.mock.method(globalThis, 'fetch', async () => { throw new Error('No external requests allowed.'); });
  try {
    const { withDatabase, initialSite } = await import('../lib/local-store');
    const { changeBilling, readBilling } = await import('../lib/billing-store');
    const user: WorkspaceUser = { uid: 'local-demo', mode: 'demo', email: null, displayName: null };
    const site = initialSite('general', 'Auto credit', 'auto-credit');
    await withDatabase(db => { db.sites = [site]; });
    const now = Date.now();
    let view = await changeBilling(user, site.id, { action: 'activate', cycle: 'annual', idempotencyKey: randomUUID() }, now);
    view = await changeBilling(user, site.id, { action: 'replenishment', enabled: true, amountCents: 1000, thresholdCents: 5000, monthlyCeilingCents: 1000, revision: view.revision }, now + 1);
    await Promise.all(Array.from({ length: 6 }, () => changeBilling(user, site.id, { action: 'simulate-usage', kind: 'voice', idempotencyKey: randomUUID() }, now + 2)));
    view = await readBilling(user, site.id, now + 3);
    assert.equal(view.replenishment.spentThisMonthCents, 1000);
    assert.equal(view.balances.purchasedCents, 1000);
    assert.ok(view.balances.includedCents < 1000);
    view = await changeBilling(user, site.id, { action: 'cancel', revision: view.revision }, now + 4);
    assert.equal(view.replenishment.enabled, false);
    await assert.rejects(changeBilling(user, site.id, { action: 'replenishment', enabled: true, amountCents: 1000, thresholdCents: 100, monthlyCeilingCents: 1000, revision: view.revision }, now + 5), /Resume/);
    assert.equal(network.mock.callCount(), 0);
  } finally { process.env = environment; await rm(directory, { recursive: true, force: true }); }
});
