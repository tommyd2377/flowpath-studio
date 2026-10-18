'use client';

import type { AccountMode, FirebasePublicConfig } from './account-model';

async function accountRequest(method: 'POST' | 'DELETE', body?: object) {
  const response = await fetch('/api/account', {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error('Sign-in could not be completed. Please try again.');
}

function notifyAccountChanged() {
  window.dispatchEvent(new Event('flowpath-account-change'));
  if ('BroadcastChannel' in window) {
    const channel = new BroadcastChannel('flowpath-account');
    channel.postMessage('changed');
    channel.close();
  }
}

export async function signInAccount(mode: AccountMode, localAccount?: string) {
  if (mode === 'local') await accountRequest('POST', { localAccount });
  else if (mode === 'firebase') {
    const response = await fetch('/api/account', { cache: 'no-store' });
    if (!response.ok) throw new Error('Sign-in is unavailable.');
    const account: { mode?: AccountMode; firebaseConfig?: FirebasePublicConfig } = await response.json();
    if (account.mode !== 'firebase' || !account.firebaseConfig) throw new Error('Google sign-in has not been configured.');
    // Nothing initializes or contacts Firebase until the owner explicitly signs in.
    const [{ initializeApp, getApps }, { getAuth, setPersistence, inMemoryPersistence, GoogleAuthProvider, signInWithPopup, signOut }] = await Promise.all([
      import('firebase/app'), import('firebase/auth'),
    ]);
    const app = getApps().find(candidate => candidate.name === 'flowpath-owner')
      ?? initializeApp(account.firebaseConfig, 'flowpath-owner');
    const auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      await accountRequest('POST', { idToken: await result.user.getIdToken() });
    } finally {
      // The application uses an HttpOnly server session, not browser token storage.
      await signOut(auth);
    }
  } else throw new Error('Accounts are not enabled for this preview.');
  notifyAccountChanged();
}

export async function signOutAccount() {
  await accountRequest('DELETE');
  notifyAccountChanged();
}
