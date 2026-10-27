import { expect, test, type Page } from '@playwright/test';

const email = 'student@example.test';
const password = 'Synthetic-password-123';

async function mockEmailAuthentication(page: Page, verified = false, rejectedPassword = false, autoFirebaseConfig = false) {
  const activity = { accountPosts: 0, verificationEmails: 0, resetEmails: 0, passwordRequests: [] as Record<string, unknown>[], unexpected: [] as string[] };
  let signedIn = false;
  const now = Math.floor(Date.now() / 1000);
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const idToken = `${encoded({ alg: 'none' })}.${encoded({ sub: 'synthetic-email-owner', user_id: 'synthetic-email-owner', email, email_verified: verified, auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password' } })}.synthetic`;
  const tokenResponse = { localId: 'synthetic-email-owner', email, idToken, refreshToken: 'synthetic-refresh', expiresIn: '3600' };

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'identitytoolkit.googleapis.com') {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const body = request.postDataJSON() as Record<string, unknown> | null;
      if (url.pathname.endsWith('/accounts:signUp') || url.pathname.endsWith('/accounts:signInWithPassword')) {
        activity.passwordRequests.push(body ?? {});
        return rejectedPassword ? route.fulfill({ status: 400, headers, json: { error: { message: 'INVALID_LOGIN_CREDENTIALS' } } })
          : route.fulfill({ headers, json: tokenResponse });
      }
      if (url.pathname.endsWith('/accounts:lookup')) return route.fulfill({ headers, json: { users: [{ localId: 'synthetic-email-owner', email, emailVerified: verified, providerUserInfo: [{ providerId: 'password', email, rawId: email }] }] } });
      if (url.pathname.endsWith('/accounts:sendOobCode')) {
        if (body?.requestType === 'VERIFY_EMAIL') activity.verificationEmails++;
        else if (body?.requestType === 'PASSWORD_RESET') activity.resetEmails++;
        else activity.unexpected.push(`Unexpected email operation: ${String(body?.requestType)}`);
        return route.fulfill({ headers, json: { email } });
      }
      activity.unexpected.push(url.pathname);
      return route.abort();
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      activity.unexpected.push(url.hostname);
      return route.abort();
    }
    if (url.pathname === '/api/account') {
      if (request.method() === 'POST') {
        activity.accountPosts++;
        expect(request.postDataJSON()).toEqual({ idToken });
        signedIn = true;
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === 'DELETE') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { mode: 'firebase', user: signedIn ? { uid: 'synthetic-email-owner', displayName: 'Synthetic owner' } : null, ...(autoFirebaseConfig ? { autoFirebaseConfig: true } : { firebaseConfig: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' } }) } });
    }
    if (url.pathname === '/api/waveform') return route.fulfill({ json: { waveform: null } });
    if (url.pathname === '/api/demo-access') return route.fulfill({ json: { enabled: false } });
    return route.continue();
  });
  return activity;
}

async function fillEmail(page: Page) {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

test('email sign-up requires verification and sends no application cookie token', async ({ page }) => {
  const activity = await mockEmailAuthentication(page);
  const accessReady = page.waitForResponse(response => new URL(response.url()).pathname === '/api/demo-access');
  await page.goto('/account');
  await accessReady;
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveCount(0);
  expect(activity.passwordRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Check your inbox for a verification link');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  expect(activity.accountPosts).toBe(0);
  expect(activity.verificationEmails).toBe(1);
  expect(activity.passwordRequests).toHaveLength(1);
  expect(activity.unexpected).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: 'test-results/email-account-mobile.png', fullPage: true });
});

test('unverified email sign-in only resends after an explicit request', async ({ page }) => {
  const activity = await mockEmailAuthentication(page);
  await page.goto('/account');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verify your email before signing in');
  expect(activity.accountPosts).toBe(0);
  expect(activity.verificationEmails).toBe(0);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Resend verification email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Check your inbox for a verification link');
  expect(activity.verificationEmails).toBe(1);
  expect(activity.accountPosts).toBe(0);
  expect(activity.unexpected).toEqual([]);
});

test('verified email sign-in exchanges only the token and existing grant cookie and opens private settings', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, true, false, false);
  await page.goto('/account');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in as Synthetic owner', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Waveform name', { exact: true })).toBeVisible();
  expect(activity.accountPosts).toBe(1);
  expect(activity.verificationEmails).toBe(0);
  expect(activity.unexpected).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('firebase:')))).toEqual([]);
});

test('password reset uses an explicit action and sign-in errors stay readable', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, false, true);
  await page.goto('/account');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('The email and password could not be verified');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
  expect(activity.resetEmails).toBe(0);
  await page.getByRole('button', { name: 'Send reset link', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('If an account uses that email');
  expect(activity.resetEmails).toBe(1);
  expect(activity.accountPosts).toBe(0);
  expect(activity.unexpected).toEqual([]);
});

test('missing beta access gives clear guidance without an invitation field or application session', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, true);
  await page.route('**/api/account', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { code: 'beta-access-required' } }) : route.fallback());
  await page.goto('/account');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Unlock beta access with the demo code before joining. Existing members can sign in normally.');
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Waveform name', { exact: true })).toHaveCount(0);
  expect(activity.verificationEmails).toBe(0);
  expect(activity.unexpected).toEqual([]);
});

test('missing managed SDK defaults fail before any authentication request', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, false, false, true);
  await page.goto('/account');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Account sign-in has not been configured.');
  expect(activity.passwordRequests).toHaveLength(0);
  expect(activity.accountPosts).toBe(0);
  expect(activity.verificationEmails).toBe(0);
  expect(activity.unexpected).toEqual([]);
});

test('signup uses one exact beta-code gate and no separate invitation before creating a Firebase identity', async ({ page }) => {
  const activity = await mockEmailAuthentication(page); let allowed = false;
  await page.route('**/api/demo-access', route => {
    if (route.request().method() === 'POST') {
      allowed = route.request().postDataJSON().code === 'nyc-1776';
      return route.fulfill({ status: allowed ? 200 : 403, json: allowed ? { enabled: true, allowed } : { error: 'That demo code is incorrect.' } });
    }
    return route.fulfill({ json: { enabled: true, allowed } });
  });
  await page.goto('/account');
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await fillEmail(page);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.account-error')).toContainText('Unlock beta access above');
  expect(activity.passwordRequests).toHaveLength(0);
  await page.getByLabel('Beta access code', { exact: true }).fill('NYC-1776');
  await page.getByRole('button', { name: 'Unlock access', exact: true }).click();
  await expect(page.locator('#demo-code-error')).toContainText('incorrect');
  expect(activity.passwordRequests).toHaveLength(0);
  await page.getByLabel('Beta access code', { exact: true }).fill('nyc-1776');
  await page.getByRole('button', { name: 'Unlock access', exact: true }).click();
  await expect(page.getByText('Beta access unlocked', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.locator('.account-status')).toContainText('Check your inbox');
  expect(activity.verificationEmails).toBe(1);
  expect(activity.accountPosts, 'unverified identity still has no application account session').toBe(0);
  expect(activity.unexpected).toEqual([]);
});


for (const width of [320, 390, 1280]) {
  test(`account entry uses real logos, clear Home navigation and both layouts at ${width}px`, async ({ page }) => {
    const activity = await mockEmailAuthentication(page);
    await page.route('**/api/demo-access', route => route.fulfill({ json: { enabled: true, allowed: false } }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('href', '/');
    const brand = page.getByRole('link', { name: 'FlowPath Studio home', exact: true }).locator('img');
    await expect.poll(() => brand.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const google = page.getByRole('button', { name: 'Continue with Google', exact: true }).locator('img');
    await expect(google).toHaveAttribute('src', '/brand/google-g.png');
    await expect.poll(() => google.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByLabel('Beta access code', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/auth-sign-in-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Create an account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Create your waveform.', exact: true })).toBeVisible();
    await expect(page.getByLabel('Beta access code', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `test-results/auth-create-account-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back.', exact: true })).toBeVisible();
    expect(activity.accountPosts).toBe(0); expect(activity.passwordRequests).toHaveLength(0);
    expect(activity.unexpected).toEqual([]);
  });
}
