import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { BillingView } from '../../lib/billing-view';

const origin = 'http://127.0.0.1:3225';
let monthlySite = '';
let annualSite = '';

async function create(request: APIRequestContext, name: string) {
  const response = await request.post('/api/sites', { headers: { Origin: origin }, data: { name, slug: `billing-${name.toLowerCase().replaceAll(' ', '-')}-${Date.now()}`, kind: 'general' } });
  expect(response.ok(), await response.text()).toBeTruthy(); return (await response.json()).site.id as string;
}

async function read(page: Page, siteId = monthlySite): Promise<BillingView> {
  const response = await page.request.get(`/api/sites/${siteId}/billing`);
  expect(response.ok()).toBeTruthy(); return (await response.json()).billing;
}

async function workspace(page: Page, siteId = monthlySite) {
  await page.goto('/');
  const picker = page.getByRole('combobox', { name: 'Current site', exact: true });
  await expect(picker).toBeEnabled();
  if (await picker.inputValue() !== siteId) await picker.selectOption(siteId);
  await expect(picker).toBeEnabled(); await expect(picker).toHaveValue(siteId);
  await page.getByRole('navigation', { name: 'Workspace' }).getByRole('button', { name: 'Usage & billing', exact: true }).click();
}

async function save(page: Page, name: string) {
  const response = page.waitForResponse(response => /\/billing$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await page.getByRole('button', { name, exact: true }).click();
  const result = await response; const body = await result.json();
  expect(result.ok(), JSON.stringify(body)).toBeTruthy();
  await expect(page.getByRole('region', { name: 'Site subscription and AI credits' })).toHaveAttribute('aria-busy', 'false');
  return body.billing as BillingView;
}

test.describe.serial('launch offer billing preview', () => {
  test.beforeAll(async ({ request }) => {
    monthlySite = await create(request, 'Monthly Preview');
    annualSite = await create(request, 'Annual Preview');
  });
  test.beforeEach(async ({ context, page }) => {
    await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'));
    await context.addInitScript(() => {
      if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { throw new Error('Billing tests never use the microphone.'); };
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('monthly launch plan starts once and grants the included monthly retail allowance', async ({ page }, info) => {
    await workspace(page);
    const plan = page.getByRole('region', { name: 'Launch plan', exact: true });
    await expect(page.getByText('Billing preview — no real charges', { exact: true })).toBeVisible();
    await expect(plan).toContainText('$29');
    await expect(plan).toContainText('registration is separate');
    await expect(page.getByRole('checkbox', { name: 'Enable automatic replenishment' })).not.toBeChecked();
    const started = await save(page, 'Simulate monthly subscription');
    expect(started.subscription.cycle).toBe('monthly'); expect(started.subscription.status).toBe('active');
    expect(started.balances.includedCents).toBe(1000); expect(started.balances.purchasedCents).toBe(0);
    await expect(page.getByRole('status').filter({ hasText: 'Preview plan started' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Simulate monthly subscription', exact: true })).toHaveCount(0);
    await page.getByRole('region', { name: 'Site subscription and AI credits' }).evaluate(element => { element.closest('.settings-panel')?.scrollTo({ top: 0 }); });
    await page.screenshot({ path: info.outputPath('launch-plan.png'), fullPage: true });
  });

  test('prepaid credits persist and synthetic usage consumes the included allowance first', async ({ page }) => {
    await workspace(page);
    await page.getByRole('radio', { name: '$25', exact: true }).check();
    const topped = await save(page, 'Simulate adding $25.00 credit');
    expect(topped.balances.purchasedCents).toBe(2500);
    await expect(page.getByRole('button', { name: 'Simulate adding $25.00 credit', exact: true })).toBeFocused();
    await page.getByText('Try usage accounting', { exact: true }).click();
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let observed: (() => void) | undefined;
    const requested = new Promise<void>(resolve => { observed = resolve; });
    await page.route(`**/api/sites/${monthlySite}/billing`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); observed?.(); await gate; await route.fulfill({ response });
    });
    const saving = save(page, 'Simulate chat usage');
    await requested;
    await page.getByRole('combobox', { name: 'Current site', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create a site', exact: true })).toBeFocused();
    release?.();
    const used = await saving;
    await expect(page.getByRole('button', { name: 'Create a site', exact: true })).toBeFocused();
    expect(used.balances.includedCents).toBeLessThan(topped.balances.includedCents);
    expect(used.balances.purchasedCents).toBe(2500); expect(used.balances.reservedCents).toBe(0);
    await workspace(page);
    const balance = page.getByRole('region', { name: 'AI credit balance', exact: true });
    await expect(balance.locator('div').filter({ has: page.locator('dt', { hasText: 'Purchased credit' }) }).locator('dd')).toHaveText('$25.00');
    expect((await read(page)).balances).toEqual(used.balances);
  });

  test('automatic replenishment is opt-in and stops at the selected calendar-month ceiling', async ({ page }) => {
    await workspace(page);
    await page.getByRole('checkbox', { name: 'Enable automatic replenishment' }).check();
    await page.getByLabel('Add each time', { exact: true }).selectOption('1000');
    await page.getByLabel('When credit falls below ($)', { exact: true }).fill('50');
    await page.getByLabel('Monthly automatic top-up ceiling ($)', { exact: true }).fill('10');
    const configured = await save(page, 'Save replenishment settings');
    expect(configured.replenishment.enabled).toBe(true); expect(configured.replenishment.monthlyCeilingCents).toBe(1000);
    await page.getByText('Try usage accounting', { exact: true }).click();
    const first = await save(page, 'Simulate voice usage');
    expect(first.replenishment.spentThisMonthCents).toBe(1000);
    const second = await save(page, 'Simulate voice usage');
    expect(second.replenishment.spentThisMonthCents).toBe(1000);
    expect(second.balances.purchasedCents).toBe(first.balances.purchasedCents);
  });

  test('cancellation retains the paid term and purchased credits; resuming leaves auto top-ups off', async ({ page }) => {
    await workspace(page);
    const before = await read(page);
    const canceled = await save(page, 'Cancel preview renewal');
    expect(canceled.subscription.status).toBe('active'); expect(canceled.subscription.cancelAtPeriodEnd).toBe(true);
    expect(canceled.subscription.currentPeriodEnd).toBe(before.subscription.currentPeriodEnd);
    expect(canceled.balances.purchasedCents).toBe(before.balances.purchasedCents); expect(canceled.replenishment.enabled).toBe(false);
    await expect(page.getByRole('checkbox', { name: 'Enable automatic replenishment' })).toBeDisabled();
    const resumed = await save(page, 'Keep preview subscription');
    expect(resumed.subscription.cancelAtPeriodEnd).toBe(false); expect(resumed.replenishment.enabled).toBe(false);
    expect(resumed.subscription.currentPeriodEnd).toBe(before.subscription.currentPeriodEnd);
  });

  test('annual offer charges a single test term while refreshing included credit monthly', async ({ page }) => {
    await page.goto(`/?billing=success&siteId=${annualSite}&session_id=cs_test_forged`);
    await expect(page.getByRole('combobox', { name: 'Current site', exact: true })).toHaveValue(annualSite);
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' })).toBeVisible();
    const beforePayment = await read(page, annualSite);
    expect(beforePayment.subscription.status).toBe('inactive'); expect(beforePayment.balances.includedCents).toBe(0);
    await page.getByRole('radio', { name: /Annually/ }).check();
    const plan = page.getByRole('region', { name: 'Launch plan', exact: true });
    await expect(plan).toContainText('$300.00 billed annually'); await expect(plan).toContainText('$25');
    const started = await save(page, 'Simulate annual subscription');
    expect(started.subscription.cycle).toBe('annual'); expect(started.balances.includedCents).toBe(1000);
    expect(started.allowance.resetsAt).toBeGreaterThan(Date.now());
    expect(started.allowance.resetsAt!).toBeLessThan(Date.now() + 32 * 86400_000);
    expect(started.subscription.currentPeriodEnd!).toBeGreaterThan(Date.now() + 360 * 86400_000);
  });

  test('an old site billing response cannot replace the newly selected site', async ({ page }) => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let observed: (() => void) | undefined;
    const requested = new Promise<void>(resolve => { observed = resolve; });
    let delivered: (() => void) | undefined;
    const finished = new Promise<void>(resolve => { delivered = resolve; });
    await page.route(`**/api/sites/${monthlySite}/billing`, async route => {
      const response = await route.fetch(); observed?.(); await gate;
      await route.fulfill({ response }).catch(() => {}); delivered?.();
    });
    await workspace(page);
    await requested;
    await page.getByRole('combobox', { name: 'Current site', exact: true }).selectOption(annualSite);
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' })).toContainText('One simple plan for Annual Preview.');
    await expect(page.getByRole('region', { name: 'Launch plan', exact: true })).toContainText('$300.00 billed annually');
    release?.();
    await finished;
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' })).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Launch plan', exact: true })).toContainText('$300.00 billed annually');
  });

  test('an uncertain top-up refreshes safely and retries with the same payment identity', async ({ page }) => {
    await workspace(page);
    const before = await read(page);
    const paymentIds: string[] = [];
    let loseResponse = true;
    await page.route(`**/api/sites/${monthlySite}/billing`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON(); paymentIds.push(body.idempotencyKey);
      if (!loseResponse) return route.continue();
      loseResponse = false; const response = await route.fetch(); expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    });
    await page.getByRole('button', { name: 'Simulate adding $10.00 credit', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' }).getByRole('alert')).toContainText('Refresh balances before trying again');
    await expect(page.getByRole('button', { name: 'Simulate adding $10.00 credit', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Refresh billing', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Balances refreshed.' })).toBeVisible();
    const retried = await save(page, 'Simulate adding $10.00 credit');
    expect(paymentIds).toHaveLength(2); expect(paymentIds[0]).toBe(paymentIds[1]);
    expect(retried.balances.purchasedCents).toBe(before.balances.purchasedCents + 1000);
  });

  test('unconfigured real billing stays disabled and shows the offer without fictitious balances', async ({ page }, info) => {
    await page.route(`**/api/sites/${annualSite}/billing`, async route => {
      const response = await route.fetch(); const body = await response.json();
      const billing: BillingView = { ...body.billing, mode: 'unavailable', subscription: { status: 'inactive', cycle: null, currentPeriodEnd: null, cancelAtPeriodEnd: false } };
      await route.fulfill({ response, json: { billing } });
    });
    await workspace(page, annualSite);
    await expect(page.getByText('Checkout is not available yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Checkout coming soon', exact: true })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Monthly', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Simulate adding $10.00 credit', exact: true })).toBeDisabled();
    await expect(page.getByText('Try usage accounting', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('billing-unavailable.png'), fullPage: true });
  });

  test('Stripe test checkout rejects an unexpected redirect without granting credit', async ({ page }) => {
    await page.route(`**/api/sites/${annualSite}/billing`, async route => {
      if (route.request().method() === 'POST') return route.fulfill({ json: { checkoutUrl: 'https://example.invalid/c/pay/cs_test_untrusted' } });
      const response = await route.fetch(); const body = await response.json();
      const billing: BillingView = { ...body.billing, checkoutProvider: 'stripe', subscription: { status: 'inactive', cycle: null, currentPeriodEnd: null, cancelAtPeriodEnd: false } };
      await route.fulfill({ response, json: { billing } });
    });
    await workspace(page, annualSite);
    await expect(page.getByText('Stripe test billing — no real charges', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Stripe test checkout', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Site subscription and AI credits' }).getByRole('alert')).toHaveText('The test checkout address could not be verified.');
    await expect(page.getByRole('button', { name: 'Continue to Stripe test checkout', exact: true })).toBeEnabled();
    expect(new URL(page.url()).origin).toBe(origin);
    await expect(page.getByRole('button', { name: 'Cancel preview renewal', exact: true })).toHaveCount(0);
  });

  test('a saved Stripe checkout survives refresh and reload and resumes without creating another payment', async ({ page }) => {
    const checkoutUrl = 'https://checkout.stripe.com/c/pay/cs_test_SavedCheckout';
    let pendingStatus: 'open' | 'unknown' | 'awaiting-confirmation' = 'unknown';
    let paymentPosts = 0;
    await page.route(`**/api/sites/${annualSite}/billing`, async route => {
      if (route.request().method() === 'POST') { paymentPosts++; return route.fulfill({ status: 409, json: { error: 'No new checkout is allowed in this fixture.' } }); }
      const response = await route.fetch(); const body = await response.json();
      const billing: BillingView = { ...body.billing, checkoutProvider: 'stripe',
        subscription: { status: 'inactive', cycle: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
        balances: { includedCents: 0, purchasedCents: 0, reservedCents: 0 },
        pendingCheckout: { status: pendingStatus, ...(pendingStatus === 'open' ? { checkoutUrl } : {}), kind: 'subscription', amountCents: 30000, cycle: 'annual' },
      };
      await route.fulfill({ response, json: { billing } });
    });
    // Fulfill the exact destination locally; this test never contacts Stripe.
    await page.route(checkoutUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>Mock Stripe checkout resumed</h1>' }));
    await workspace(page, annualSite);
    const card = page.getByRole('region', { name: 'Pending Stripe checkout', exact: true });
    await expect(card).toContainText('The checkout request could not be confirmed.');
    await expect(page.getByRole('button', { name: 'Continue to Stripe test checkout', exact: true })).toBeDisabled();
    await expect(page.getByRole('link', { name: 'Resume Stripe test checkout', exact: true })).toHaveCount(0);
    pendingStatus = 'awaiting-confirmation';
    await card.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
    await expect(card).toContainText('Waiting for verified payment before updating your plan or credit.');
    await expect(page.getByRole('button', { name: 'Cancel preview renewal', exact: true })).toHaveCount(0);
    pendingStatus = 'open';
    await card.getByRole('button', { name: 'Refresh payment status', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Resume Stripe test checkout', exact: true })).toHaveAttribute('href', checkoutUrl);
    await workspace(page, annualSite);
    await expect(page.getByRole('region', { name: 'Launch plan', exact: true })).toContainText('$300.00 billed annually');
    await expect(page.getByRole('button', { name: 'Continue to Stripe test checkout', exact: true })).toBeDisabled();
    await page.getByRole('link', { name: 'Resume Stripe test checkout', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mock Stripe checkout resumed', exact: true })).toBeVisible();
    expect(page.url()).toBe(checkoutUrl); expect(paymentPosts).toBe(0);
  });

  test('mobile publishers can review balances and reach billing controls without horizontal overflow', async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?billing=success&siteId=${monthlySite}`);
    const billing = page.getByRole('region', { name: 'Site subscription and AI credits' });
    await expect(billing).toBeVisible();
    await expect(page.getByRole('region', { name: 'AI credit balance', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Simulate adding $10.00 credit', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Simulate adding $10.00 credit', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('billing-mobile.png'), fullPage: true });
  });
});
