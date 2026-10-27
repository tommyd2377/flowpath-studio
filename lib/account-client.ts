'use client';

import type { AccountMode, FirebasePublicConfig } from './account-model';

class BetaAccessRequiredError extends Error {
  constructor() { super('Unlock beta access with the demo code before joining. Existing members can sign in normally.'); }
}

async function accountRequest(method: 'POST' | 'DELETE', body?: object) {
  const response = await fetch('/api/account', {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { code?: string } | null;
    if (result?.code === 'beta-access-required') throw new BetaAccessRequiredError();
    throw new Error('Sign-in could not be completed. Please try again.');
  }
}

function notifyAccountChanged() {
  window.dispatchEvent(new Event('flowpath-account-change'));
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel('flowpath-account');
    channel.postMessage('changed');
    channel.close();
  }
}

async function firebaseClient() {
  const response = await fetch('/api/account', { cache: 'no-store' });
  if (!response.ok) throw new Error('Account sign-in is unavailable.');
  const account: { mode?: AccountMode; firebaseConfig?: FirebasePublicConfig; autoFirebaseConfig?: boolean } = await response.json();
  if (account.mode !== 'firebase' || (!account.firebaseConfig && account.autoFirebaseConfig !== true)) throw new Error('Account sign-in has not been configured.');
  // Firebase starts only after the owner chooses an authentication action.
  const [{ initializeApp, getApps }, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const appName = account.firebaseConfig ? 'flowpath-owner' : '[DEFAULT]';
  let app = getApps().find(candidate => candidate.name === appName);
  if (!app) {
    try {
      // App Hosting supplies SDK defaults; no public configuration is copied.
      app = account.firebaseConfig ? initializeApp(account.firebaseConfig, appName) : initializeApp();
    } catch { throw new Error('Account sign-in has not been configured.'); }
  }
  const auth = sdk.getAuth(app);
  await sdk.setPersistence(auth, sdk.inMemoryPersistence);
  return { auth, sdk };
}

function authenticationError(error: unknown) {
  if (error instanceof BetaAccessRequiredError) return error;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
  switch (code) {
    case 'auth/invalid-email': return new Error('Enter a valid email address.');
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements': return new Error('Choose a stronger password, with at least six characters.');
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return new Error('The email and password could not be verified. Try again or reset your password.');
    case 'auth/email-already-in-use': return new Error('This account could not be created. Try signing in, resetting your password or continuing with Google.');
    case 'auth/too-many-requests': return new Error('Too many attempts. Please wait a little before trying again.');
    case 'auth/network-request-failed': return new Error('Unable to connect. Check your connection and try again.');
    default: return new Error('Your account request could not be completed. Please try again.');
  }
}

export async function signInAccount(mode: AccountMode, localAccount?: string) {
  if (mode === 'local') await accountRequest('POST', { localAccount });
  else if (mode === 'firebase') {
    const { auth, sdk } = await firebaseClient();
    try {
      const result = await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
      await accountRequest('POST', { idToken: await result.user.getIdToken() });
    } finally {
      // The application uses an HttpOnly server session, not browser token storage.
      await sdk.signOut(auth);
    }
  } else throw new Error('Accounts are not enabled for this preview.');
  notifyAccountChanged();
}

export type EmailAccountAction = 'sign-in' | 'create-account' | 'reset-password' | 'resend-verification';
export type EmailAccountResult = 'signed-in' | 'verification-sent' | 'verification-required' | 'password-reset-sent';

export async function authenticateWithEmail(action: EmailAccountAction, email: string, password = ''): Promise<EmailAccountResult> {
  const { auth, sdk } = await firebaseClient();
  const address = email.trim();
  try {
    if (action === 'reset-password') {
      try { await sdk.sendPasswordResetEmail(auth, address); }
      catch (error) {
        // Do not reveal whether an address has an account, even on older projects.
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found')) throw error;
      }
      return 'password-reset-sent';
    }
    const result = action === 'create-account'
      ? await sdk.createUserWithEmailAndPassword(auth, address, password)
      : await sdk.signInWithEmailAndPassword(auth, address, password);
    if (!result.user.emailVerified) {
      if (action === 'create-account' || action === 'resend-verification') {
        await sdk.sendEmailVerification(result.user);
        return 'verification-sent';
      }
      return 'verification-required';
    }
    await accountRequest('POST', { idToken: await result.user.getIdToken() });
    notifyAccountChanged();
    return 'signed-in';
  } catch (error) {
    throw authenticationError(error);
  } finally {
    await sdk.signOut(auth);
  }
}

export async function signOutAccount() {
  await accountRequest('DELETE');
  notifyAccountChanged();
}
