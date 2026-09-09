import 'server-only';
import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { AppError } from '@/lib/errors';
import { getFirebaseClientConfig, getFirebaseSetupStatus } from './config';

// Firebase credentials are resolved by the deployment runtime only when an operation needs Admin.
export function getFirebaseAdminApp(): App {
  if (!getFirebaseSetupStatus().enabled) throw new AppError('Firebase is not configured for this workspace.', 503);
  const config = getFirebaseClientConfig()!;
  try {
    const existing = getApps().find(app => app.name === 'voice-workspace');
    if (existing) {
      if (existing.options.projectId !== config.projectId || existing.options.storageBucket !== config.storageBucket) throw new Error();
      return existing;
    }
    return initializeApp({ credential: applicationDefault(), projectId: config.projectId, storageBucket: config.storageBucket }, 'voice-workspace');
  } catch {
    throw new AppError('Firebase is unavailable. Check the server configuration.', 503);
  }
}
