'use client';

import { getApps, initializeApp } from 'firebase/app';
import { browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, initializeAuth, inMemoryPersistence, signInWithEmailAndPassword, signInWithPopup, signOut, type Auth } from 'firebase/auth';
import type { FirebaseClientConfig, WorkspaceUser } from './types';

export type AuthConfiguration = { enabled: boolean; mode: WorkspaceUser['mode']; config?: FirebaseClientConfig };
type SignInMethod = { method: 'google' } | { method: 'password'; email: string; password: string; createAccount: boolean };
let browserAuth: Auth | null = null;

class SignInError extends Error {
  constructor(public code: string) { super('Authentication could not be completed.'); }
}

export async function loadAuthConfiguration(signal?: AbortSignal): Promise<AuthConfiguration> {
  const response = await fetch('/api/auth/config', { cache: 'no-store', credentials: 'same-origin', signal });
  if (!response.ok) throw new SignInError(response.status === 503 ? 'configuration-needed' : 'configuration-unavailable');
  return response.json();
}

function getBrowserAuth(config: FirebaseClientConfig) {
  if (!browserAuth) {
    const app = getApps().find(item => item.name === 'voice-studio-browser') || initializeApp(config, 'voice-studio-browser');
    browserAuth = initializeAuth(app, { persistence: inMemoryPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  }
  return browserAuth;
}

async function csrfToken() {
  const response = await fetch('/api/auth/csrf', { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) throw new SignInError('session-unavailable');
  const body = await response.json();
  if (typeof body.csrfToken !== 'string' || !body.csrfToken) throw new SignInError('session-unavailable');
  return body.csrfToken as string;
}

export async function signInToWorkspace(config: FirebaseClientConfig, method: SignInMethod) {
  const auth = getBrowserAuth(config);
  try {
    const credential = method.method === 'google'
      ? await signInWithPopup(auth, new GoogleAuthProvider())
      : method.createAccount
        ? await createUserWithEmailAndPassword(auth, method.email, method.password)
        : await signInWithEmailAndPassword(auth, method.email, method.password);
    const idToken = await credential.user.getIdToken();
    const token = await csrfToken();
    const response = await fetch('/api/auth/session', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
      body: JSON.stringify({ idToken }),
    });
    if (!response.ok) throw new SignInError('session-unavailable');
  } finally {
    // The server cookie owns the workspace session; never retain browser tokens.
    await signOut(auth).catch(() => {});
  }
}

export async function signOutOfWorkspace() {
  const token = await csrfToken();
  const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': token } });
  if (!response.ok) throw new SignInError('logout-unavailable');
  if (browserAuth) await signOut(browserAuth).catch(() => {});
}

export function authErrorMessage(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'configuration-needed': return 'Firebase sign-in needs to be configured on this server before you can continue.';
    case 'configuration-unavailable': return 'We couldn’t check sign-in availability. Please try again.';
    case 'session-unavailable': return 'We couldn’t start your workspace session. Please try signing in again.';
    case 'logout-unavailable': return 'We couldn’t sign you out. Please try again.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request': return 'Google sign-in was cancelled. You can try again or use email.';
    case 'auth/popup-blocked': return 'Your browser blocked the Google sign-in window. Try email sign-in or allow this popup.';
    case 'auth/invalid-email': return 'Enter a valid email address.';
    case 'auth/weak-password': return 'Choose a stronger password with at least six characters.';
    case 'auth/email-already-in-use': return 'An account may already use this email. Try signing in instead.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/user-disabled': return 'We couldn’t sign you in with those details. Check your email and password.';
    case 'auth/account-exists-with-different-credential': return 'Use the sign-in method you originally used for this account.';
    case 'auth/too-many-requests': return 'There have been too many attempts. Wait a little before trying again.';
    case 'auth/network-request-failed': return 'We couldn’t reach the sign-in service. Check your connection and try again.';
    case 'auth/unauthorized-domain': return 'This website address is not authorized for sign-in. Add it under Firebase Authentication → Settings → Authorized domains. (auth/unauthorized-domain)';
    case 'auth/operation-not-allowed': return 'This sign-in provider is disabled. Enable it under Firebase Authentication → Sign-in method. (auth/operation-not-allowed)';
    case 'auth/invalid-api-key': return 'Firebase rejected the app’s web API key. Check the app’s Firebase configuration. (auth/invalid-api-key)';
    case 'auth/configuration-not-found': return 'Firebase Authentication is not configured for this project. Check the app’s Firebase project and Authentication setup. (auth/configuration-not-found)';
    default: return 'Sign-in couldn’t be completed. Please try again.';
  }
}
