import { LIVE_BACKEND_MODEL, LIVE_BACKEND_REASONING_EFFORT } from './gpt-live/protocol';

/** Shared quality-first defaults for all connected Studio and visitor Responses calls. */
export const DEFAULT_AI_MODEL = LIVE_BACKEND_MODEL;
export const DEFAULT_AI_REASONING_EFFORT = LIVE_BACKEND_REASONING_EFFORT;
export const DEFAULT_AI_SERVICE_TIER = 'default' as const;

// These ceilings include reasoning tokens. Final text/schema limits still apply;
// more reasoning allowance must not create longer visitor answers or extra calls.
export const AI_OUTPUT_LIMITS = { visitor: 8192, research: 8192, editor: 16384, media: 16384, ingestion: 32768 } as const;
export const AI_REQUEST_TIMEOUT_MS = 90_000;
