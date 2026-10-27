import { configuredFirebaseProjectId } from './firebase-accounts';
import { configuredPublicOrigin } from './request-origin';
import { hostedCreationReviewConfigured } from './creation-review-config';

/** Separate opt-in: an old live flag cannot reactivate hosted calls. */
export function hostedTesterRuntime(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV === 'production' && env.FLOWPATH_HOSTED_TESTER_DEMO === '1'
    && env.FLOWPATH_PAID_TEST_ENABLED !== '1'
    && env.FLOWPATH_ACCOUNT_MODE === 'firebase' && env.FLOWPATH_FIRESTORE_EDITION === 'standard'
    && configuredFirebaseProjectId(env) === 'flowpath-studio'
    && configuredPublicOrigin(env.FLOWPATH_PUBLIC_ORIGIN) === 'https://flowpath.studio';
}

export function hostedTesterDemo(env: Record<string, string | undefined> = process.env) {
  return hostedTesterRuntime(env) && env.FLOWPATH_LIVE_ENABLED === '1'
    && env.FLOWPATH_TESTER_ALLOWANCE_PERIOD === 'daily' && hostedCreationReviewConfigured(env);
}
