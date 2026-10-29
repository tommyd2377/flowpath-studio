import { configuredPublicOrigin } from './request-origin';
import { hostedCreationReviewConfigured } from './creation-review-config';

// Owner-approved October 29 beta storage guard. Not customer pricing or an OpenAI billing limit.
export const KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD = 5_000_000;
export const KNOWLEDGE_GIB = 1024 ** 3;
export const KNOWLEDGE_STORAGE_MICRO_USD_PER_GIB_DAY = 100_000;
export const KNOWLEDGE_STORAGE_DAYS = 31;
// Index size differs from upload size. Hold a conservative GiB until reported usage arrives.
export const KNOWLEDGE_PENDING_STORAGE_BYTES = KNOWLEDGE_GIB;
export const KNOWLEDGE_STORAGE_CAPACITY_BYTES = Math.floor(KNOWLEDGE_MONTHLY_STORAGE_MICRO_USD * KNOWLEDGE_GIB
  / (KNOWLEDGE_STORAGE_MICRO_USD_PER_GIB_DAY * KNOWLEDGE_STORAGE_DAYS));
export const estimatedKnowledgeMonthlyCost = (bytes: number) => Math.ceil(bytes / KNOWLEDGE_GIB
  * KNOWLEDGE_STORAGE_MICRO_USD_PER_GIB_DAY * KNOWLEDGE_STORAGE_DAYS);

export function hostedKnowledgeConfigured(env: Record<string, string | undefined>) {
  return env.FLOWPATH_KNOWLEDGE_ENABLED === '1' && env.FLOWPATH_LIVE_ENABLED === '1'
    && hostedCreationReviewConfigured(env)
    && configuredPublicOrigin(env.FLOWPATH_PUBLIC_ORIGIN) === 'https://flowpath.studio';
}
