import 'server-only';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { AppError } from '@/lib/errors';
import { getFirebaseAdminApp } from './admin';
import { getAppOrigin, getBackendMode, getFirebaseSetupStatus } from './config';
import type { WorkspaceUser } from './types';

const demoUser: WorkspaceUser = { uid: 'local-demo', email: null, displayName: 'Demo workspace', mode: 'demo' };
const sessionSeconds = 60 * 60 * 24 * 5;
const invalidSessionCodes = new Set(['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked',
  'auth/invalid-session-cookie', 'auth/session-cookie-expired', 'auth/session-cookie-revoked', 'auth/user-disabled', 'auth/user-not-found']);

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
}

export function assertSameOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  let expected: string;
  if (getBackendMode() === 'demo') {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new AppError('The demo workspace is available on localhost only.', 403);
    }
    expected = `${url.protocol}//${host}`;
  } else {
    expected = getAppOrigin();
    if (host !== new URL(expected).host) throw new AppError('This request is not for the workspace application.', 403);
  }
  const origin = request.headers.get('origin');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
  if ((unsafe && !origin) || (origin !== null && origin !== expected) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new AppError('Cross-origin requests are not allowed.', 403);
  }
}

export function requireFirebaseSetup() {
  if (!getFirebaseSetupStatus().enabled) throw new AppError('Firebase sign-in is not configured for this workspace.', 503);
}

function cookieSettings() {
  const secure = new URL(getAppOrigin()).protocol === 'https:';
  return {
    sessionName: secure ? '__Host-voice-session' : 'voice-session',
    csrfName: secure ? '__Host-voice-csrf' : 'voice-csrf',
    options: { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' },
  };
}

function workspaceUser(claims: DecodedIdToken): WorkspaceUser {
  return { uid: claims.uid, email: typeof claims.email === 'string' ? claims.email : null,
    displayName: typeof claims.name === 'string' ? claims.name : null, mode: 'firebase' };
}

export async function getWorkspaceUser(): Promise<WorkspaceUser | null> {
  if (getBackendMode() === 'demo') return { ...demoUser };
  requireFirebaseSetup();
  const session = (await cookies()).get(cookieSettings().sessionName)?.value;
  if (!session) return null;
  try {
    return workspaceUser(await getAuth(getFirebaseAdminApp()).verifySessionCookie(session, true));
  } catch (error) {
    if (invalidSessionCodes.has(errorCode(error))) return null;
    throw new AppError('Sign-in is temporarily unavailable. Please try again.', 503);
  }
}

export async function requireWorkspaceUser(request: Request): Promise<WorkspaceUser> {
  assertSameOrigin(request);
  const user = await getWorkspaceUser();
  if (!user) throw new AppError('Sign in to access your workspace.', 401);
  return user;
}

export async function createCsrfToken(): Promise<string> {
  requireFirebaseSetup();
  const token = randomBytes(32).toString('hex');
  const settings = cookieSettings();
  (await cookies()).set(settings.csrfName, token, { ...settings.options, maxAge: 60 * 60 });
  return token;
}

export async function assertCsrfToken(request: Request) {
  requireFirebaseSetup();
  const supplied = request.headers.get('x-csrf-token') || '';
  const stored = (await cookies()).get(cookieSettings().csrfName)?.value || '';
  if (!/^[a-f0-9]{64}$/.test(supplied) || !/^[a-f0-9]{64}$/.test(stored)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(stored))) throw new AppError('Refresh the page and try signing in again.', 403);
}

export async function createWorkspaceSession(idToken: string): Promise<WorkspaceUser> {
  requireFirebaseSetup();
  const auth = getAuth(getFirebaseAdminApp());
  let claims: DecodedIdToken;
  try {
    claims = await auth.verifyIdToken(idToken, true);
  } catch (error) {
    if (invalidSessionCodes.has(errorCode(error))) throw new AppError('Sign in again to continue.', 401);
    throw new AppError('Sign-in is temporarily unavailable. Please try again.', 503);
  }
  const age = Date.now() / 1000 - claims.auth_time;
  if (!Number.isFinite(age) || age < 0 || age >= 5 * 60) throw new AppError('Please sign in again before starting a new session.', 401);
  let session: string;
  try { session = await auth.createSessionCookie(idToken, { expiresIn: sessionSeconds * 1000 }); }
  catch (error) {
    if (invalidSessionCodes.has(errorCode(error))) throw new AppError('Sign in again to continue.', 401);
    throw new AppError('Sign-in is temporarily unavailable. Please try again.', 503);
  }
  const settings = cookieSettings();
  (await cookies()).set(settings.sessionName, session, { ...settings.options, maxAge: sessionSeconds });
  return workspaceUser(claims);
}

export async function clearWorkspaceSession() {
  requireFirebaseSetup();
  const settings = cookieSettings();
  const cookieStore = await cookies();
  cookieStore.set(settings.sessionName, '', { ...settings.options, maxAge: 0 });
  cookieStore.set(settings.csrfName, '', { ...settings.options, maxAge: 0 });
}
