import { expect, test, type Page } from '@playwright/test';

const email = 'student@example.test';
const password = 'Synthetic-password-123';

async function mockEmailAuthentication(page: Page, verified = false, rejectedPassword = false, autoFirebaseConfig = false, expectedInviteCode?: string) {
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
        expect(request.postDataJSON()).toEqual({ idToken, ...(expectedInviteCode ? { inviteCode: expectedInviteCode } : {}) });
        signedIn = true;
        return route.fulfill({ json: { ok: true } });
      }
      if (request.method() === 'DELETE') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
      return route.fulfill({ json: { mode: 'firebase', user: signedIn ? { uid: 'synthetic-email-owner', displayName: 'Synthetic owner' } : null, ...(autoFirebaseConfig ? { autoFirebaseConfig: true } : { firebaseConfig: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' } }) } });
    }
    if (url.pathname === '/api/waveform') return route.fulfill({ json: { waveform: null } });
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
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  await expect(page.getByLabel('Invitation code', { exact: true })).not.toHaveAttribute('required');
  await page.getByLabel('Invitation code', { exact: true }).fill('SYNTHETIC-INVITE');
  expect(activity.passwordRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Check your inbox for a verification link');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveValue('SYNTHETIC-INVITE');
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

test('verified email sign-in exchanges only the token and invitation and opens private settings', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, true, false, false, 'SYNTHETIC-INVITE');
  await page.goto('/account');
  await page.getByLabel('Invitation code', { exact: true }).fill('  SYNTHETIC-INVITE  ');
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

test('invitation-only account rejection gives clear guidance and keeps the code for retry', async ({ page }) => {
  const activity = await mockEmailAuthentication(page, true);
  await page.route('**/api/account', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 403, json: { code: 'invitation-required' } }) : route.fallback());
  await page.goto('/account');
  await page.getByLabel('Invitation code', { exact: true }).fill('SYNTHETIC-REJECTED');
  await fillEmail(page);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText('An active invitation is required to join FlowPath Studio.');
  await expect(page.getByLabel('Invitation code', { exact: true })).toHaveValue('SYNTHETIC-REJECTED');
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
