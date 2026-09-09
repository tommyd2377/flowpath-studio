import 'server-only';
import { AppError } from '@/lib/errors';
import type { FirebaseClientConfig } from './types';

const fields = {
  apiKey: 'FIREBASE_WEB_API_KEY',
  authDomain: 'FIREBASE_AUTH_DOMAIN',
  projectId: 'FIREBASE_PROJECT_ID',
  storageBucket: 'FIREBASE_STORAGE_BUCKET',
  appId: 'FIREBASE_APP_ID',
} as const;
const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

export function getBackendMode(): 'demo' | 'firebase' {
  const mode = process.env.VOICE_BACKEND;
  if (mode === undefined || mode === 'demo') return 'demo';
  if (mode === 'firebase') return 'firebase';
  throw new AppError('The workspace backend is not configured correctly.', 503);
}

function readClientConfig() {
  const config = Object.fromEntries(Object.entries(fields).map(([key, name]) => [key, process.env[name]?.trim() || ''])) as FirebaseClientConfig;
  const missing = Object.entries(fields).filter(([key]) => {
    const value = config[key as keyof FirebaseClientConfig];
    if (!value || value.length > 512 || /\s/.test(value)) return true;
    if (key === 'projectId') return !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value);
    if (key === 'authDomain') return !/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(value);
    if (key === 'storageBucket') return !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(value);
    return false;
  }).map(([, name]) => name as string);
  return { config, missing };
}

export function getFirebaseClientConfig(): FirebaseClientConfig | null {
  if (getBackendMode() !== 'firebase') return null;
  const { config, missing } = readClientConfig();
  return missing.length ? null : config;
}

export function getAppOrigin(): string {
  const value = process.env.VOICE_APP_ORIGIN?.trim();
  try {
    if (!value) throw new Error();
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopbackHosts.includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch {
    throw new AppError('The workspace application origin is not configured correctly.', 503);
  }
}

export function getFirebaseSetupStatus(): { mode: 'demo' | 'firebase'; enabled: boolean; missing: string[] } {
  const mode = getBackendMode();
  if (mode === 'demo') return { mode, enabled: false, missing: [] };
  const { missing } = readClientConfig();
  try { getAppOrigin(); } catch { missing.push('VOICE_APP_ORIGIN'); }
  return { mode, enabled: missing.length === 0, missing };
}
