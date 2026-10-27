import { CONSERVATIVE_CREATION_POLICY } from './creation-policy';
import { creationPolicyDigest, type CreationSafetyPolicy } from './creation-safety';
import { configuredPublicOrigin } from './request-origin';

/** Approved review settings; unrelated to voice allowances or customer prices. */
export const CREATION_REVIEW_BUDGET_MICRO_USD = 500_000; // 50 cents per owner/waveform
export const CREATION_REVIEW_RESERVATION_MICRO_USD = 50_000; // at most 5 cents per attempt
export const CREATION_REVIEW_MODEL = 'gpt-6-luna';
export const CREATION_REVIEW_MAX_OUTPUT = 2048;

// Source-only opt-in for the approved policy; no deployment or provider call is implied.
export const CREATION_POLICY_PRESET = 'conservative-v3';
export function configuredCreationPolicy(env: Record<string, string | undefined>): CreationSafetyPolicy | null {
  if (env.FLOWPATH_CREATION_POLICY_PRESET === CREATION_POLICY_PRESET) return structuredClone(CONSERVATIVE_CREATION_POLICY);
  if (env.FLOWPATH_CREATION_POLICY_PRESET !== undefined) return null;
  try {
    if (!env.FLOWPATH_CREATION_POLICY_JSON) return null;
    const selected = JSON.parse(env.FLOWPATH_CREATION_POLICY_JSON) as CreationSafetyPolicy;
    creationPolicyDigest(selected);
    return selected;
  } catch { return null; }
}
export function hostedCreationReviewConfigured(env: Record<string, string | undefined>) {
  return env.NODE_ENV === 'production' && env.FLOWPATH_CREATION_SAFETY_ENABLED === '1'
    && env.FLOWPATH_ACCOUNT_MODE === 'firebase' && env.FLOWPATH_FIRESTORE_EDITION === 'standard'
    && env.FLOWPATH_FIREBASE_PROJECT_ID === 'flowpath-studio'
    && configuredPublicOrigin(env.FLOWPATH_PUBLIC_ORIGIN) === 'https://flowpath.studio'
    && configuredCreationPolicy(env) !== null;
}
