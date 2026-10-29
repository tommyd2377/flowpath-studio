import { expect, test } from '@playwright/test';

// Delayed synthetic responses recreate account → waveform navigation without media/provider calls.
for (const mode of ['admin', 'regular', 'disabled', 'unavailable'] as const) {
  test(`owner startup waits for access checks without a provisional waveform: ${mode}`, async ({ page, context }) => {
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort('blockedbyclient'));
    const waveform = { id: '00000000-0000-4000-8000-000000000077', name: 'Startup fixture', initialPrompt: 'Synthetic instructions.',
      voice: 'marin', accentColor: '#3a66ff', profilePhoto: null, adminTesting: mode === 'admin' };
    let opening = false; let bills = 0; let ownerReads = 0; let views = 0; let starts = 0;
    let releaseBilling!: () => void; const billingWait = new Promise<void>(resolve => { releaseBilling = resolve; });
    let releaseView!: () => void; const viewWait = new Promise<void>(resolve => { releaseView = resolve; });
    await page.addInitScript(() => {
      const state = { mayShowVoice: false, prematureMounts: 0 };
      Object.assign(window, { startupFixture: state });
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (!state.mayShowVoice && node instanceof Element && (node.matches('.voice-experience') || node.querySelector('.voice-experience'))) state.prematureMounts++;
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', user: { uid: 'startup-fixture', displayName: 'Creator', role: 'admin' } } }));
    await page.route('**/api/waveform*', route => {
      if (new URL(route.request().url()).searchParams.has('id')) ownerReads++;
      return route.fulfill({ json: { waveform } });
    });
    await page.route('**/api/billing', async route => {
      if (!opening) return route.fulfill({ json: { enabled: false } });
      bills++; await billingWait;
      await route.fulfill(mode === 'unavailable' ? { status: 503, json: { error: 'Synthetic unavailable response.' } }
        : { json: { enabled: mode !== 'disabled', signedIn: true, voiceReady: true, wallet: { balance: 600, available: 600, held: 0, allocated: 0 } } });
    });
    await page.route('**/api/published?*', async route => {
      views++; await viewWait;
      await route.fulfill({ json: { waveform, mode: 'visitor', sponsoredSeconds: 0, own: true, reason: '', adminTesting: mode === 'admin', adminVoiceReady: true } });
    });
    await page.route('**/api/session*', route => {
      if (route.request().method() === 'POST') starts++;
      return route.fulfill({ json: { enabled: false } });
    });
    const allowVoice = () => page.evaluate(() => {
      (window as unknown as { startupFixture: { mayShowVoice: boolean } }).startupFixture.mayShowVoice = true;
    });
    try {
      await page.goto('/account');
      await expect(page.getByRole('link', { name: 'Preview draft', exact: true })).toBeVisible();
      // Finish the account page's own metadata request before counting requests
      // belonging to the waveform navigation. A late request is not a new mount.
      await page.waitForLoadState('networkidle');
      opening = true;
      await page.getByRole('link', { name: 'Preview draft', exact: true }).click();
      await expect(page.getByText('Loading your waveform…', { exact: true })).toBeVisible();
      await expect.poll(() => bills).toBeGreaterThan(0);
      await expect(page.locator('.voice-experience')).toHaveCount(0);
      if (mode === 'disabled') await allowVoice();
      releaseBilling();
      if (mode === 'unavailable') {
        await expect(page.getByRole('status')).toContainText('Your waveform could not be loaded.');
        await expect(page.locator('.brand-loader')).toHaveCount(0);
        await expect(page.locator('.voice-experience')).toHaveCount(0);
        expect(views).toBe(0);
      } else if (mode === 'disabled') {
        await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
        expect(views).toBe(0);
      } else {
        await expect(page.getByText('Loading experience…', { exact: true })).toBeVisible();
        await expect.poll(() => views).toBeGreaterThan(0);
        const billingReadsBeforeView = bills;
        await expect(page.locator('.voice-experience')).toHaveCount(0);
        if (mode === 'admin') await allowVoice();
        releaseView();
        if (mode === 'admin') await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
        else {
          await expect(page.getByRole('button', { name: 'Continue using my own balance', exact: true })).toBeVisible();
          await expect(page.locator('.voice-experience')).toHaveCount(0);
        }
        // React dev effects can repeat owner reads, but PaidExperience must not start another billing read.
        expect(bills).toBe(billingReadsBeforeView);
      }
      expect(await page.evaluate(() => (window as unknown as { startupFixture: { prematureMounts: number } }).startupFixture.prematureMounts)).toBe(0);
      expect(bills).toBeLessThanOrEqual(ownerReads);
      expect(starts).toBe(0);
    } finally { releaseBilling(); releaseView(); }
  });
}

test('leaving settings cancels its queued billing lookup before the waveform begins loading', async ({ page, context }) => {
  await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  const waveform = { id: '00000000-0000-4000-8000-000000000077', name: 'Queue fixture', voice: 'marin',
    initialPrompt: 'Synthetic instructions', accentColor: '#3a66ff', profilePhoto: null };
  await page.addInitScript(() => {
    void navigator.locks.request('flowpath-paid-identity', () => new Promise<void>(resolve => {
      Object.assign(window, { releaseBillingFixture: resolve });
    }));
  });
  await page.route('**/api/account', route => route.fulfill({ json: { mode: 'firebase', user: { uid: 'queue-fixture', displayName: 'Creator' } } }));
  await page.route('**/api/waveform*', route => route.fulfill({ json: { waveform } }));
  let bills = 0;
  await page.route('**/api/billing', route => { bills++; return route.fulfill({ json: { enabled: false } }); });
  await page.route('**/api/session*', route => route.fulfill({ json: { enabled: false } }));
  const release = () => page.evaluate(() => (window as unknown as { releaseBillingFixture?: () => void }).releaseBillingFixture?.());
  try {
    await page.goto('/account');
    await page.getByRole('link', { name: 'Preview draft', exact: true }).click();
    await expect(page.getByText('Loading your waveform…', { exact: true })).toBeVisible();
    expect(bills).toBe(0);
    await release();
    await expect(page.getByRole('button', { name: 'Start conversation', exact: true })).toBeVisible();
    expect(bills).toBe(1);
  } finally { await release(); }
});
