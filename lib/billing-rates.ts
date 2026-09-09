import { z } from 'zod';
import { AppError } from './errors';

// Versioned retail policy. Change this version when changing prices; existing
// reservations settle against their saved version, never today's replacement.
// Source checked 2026-09-09: https://developers.openai.com/api/docs/pricing
export const LAUNCH_RATE_VERSION = 'launch-2026-09-09-v1';
const tokens = z.number().int().min(0).max(10_000_000);
export const billableTokensSchema = z.object({
  inputText: tokens, cachedText: tokens, inputAudio: tokens, cachedAudio: tokens,
  outputText: tokens, outputAudio: tokens, cacheWriteText: tokens.default(0),
}).strict().refine(v => v.cachedText + v.cacheWriteText <= v.inputText && v.cachedAudio <= v.inputAudio, 'Invalid cached token counts.');
export type BillableTokens = z.infer<typeof billableTokensSchema>;
export type BillingModel = 'gpt-5.6-luna' | 'gpt-realtime-2.1' | 'gpt-realtime-2.1-mini' | 'gpt-4o-mini-transcribe';
// Integer nanodollars/token, equivalent to dollars/million multiplied by1000.
const prices = {
  'gpt-5.6-luna': { inputText: 200, cachedText: 20, cacheWriteText: 250, outputText: 1200, inputAudio: 0, cachedAudio: 0, outputAudio: 0 },
  'gpt-realtime-2.1': { inputText: 4000, cachedText: 400, cacheWriteText: 0, outputText: 24000, inputAudio: 32000, cachedAudio: 400, outputAudio: 64000 },
  'gpt-realtime-2.1-mini': { inputText: 600, cachedText: 60, cacheWriteText: 0, outputText: 2400, inputAudio: 10000, cachedAudio: 300, outputAudio: 20000 },
  'gpt-4o-mini-transcribe': { inputText: 1250, cachedText: 0, cacheWriteText: 0, outputText: 5000, inputAudio: 1250, cachedAudio: 0, outputAudio: 0 },
} satisfies Record<BillingModel, Record<keyof BillableTokens, number>>;

// Add a new entry and select its version above for a later price change. Keep
// old entries for reconciliation; do not edit a card already used by a hold.
const rateCards: Record<string, { multiplier: number; prices: typeof prices }> = {
  'launch-2026-09-09-v1': { multiplier: 3, prices },
};
export const RETAIL_MULTIPLIER = rateCards[LAUNCH_RATE_VERSION].multiplier;

export function retailCharge(model: string, input: BillableTokens, version = LAUNCH_RATE_VERSION) {
  const card = Object.hasOwn(rateCards, version) ? rateCards[version] : undefined;
  if (!card || !Object.hasOwn(card.prices, model)) throw new AppError('This AI rate is not configured. Usage remains reserved for review.', 503);
  const usage = billableTokensSchema.parse(input);
  const rate = card.prices[model as BillingModel];
  const long = model === 'gpt-5.6-luna' && usage.inputText > 272_000;
  const categories = {
    inputText: usage.inputText - usage.cachedText - usage.cacheWriteText,
    cachedText: usage.cachedText, cacheWriteText: usage.cacheWriteText,
    inputAudio: usage.inputAudio - usage.cachedAudio, cachedAudio: usage.cachedAudio,
    outputText: usage.outputText, outputAudio: usage.outputAudio,
  };
  let nanos = 0n;
  for (const key of Object.keys(categories) as (keyof BillableTokens)[]) {
    if (categories[key] && !rate[key]) throw new AppError('This usage category has no verified rate.', 503);
    const adjustedRate = rate[key] * (long ? key.startsWith('output') ? 1.5 : 2 : 1);
    nanos += BigInt(categories[key]) * BigInt(adjustedRate);
  }
  const providerMicros = Number((nanos + 999n) / 1000n);
  const retailMicros = Number((nanos * BigInt(card.multiplier) + 999n) / 1000n);
  if (!Number.isSafeInteger(retailMicros)) throw new AppError('Usage exceeds the accounting bound.', 503);
  return { providerMicros, retailMicros, rateCardVersion: version };
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 10_000_000;
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Missing or ambiguous measurements stay unknown, never a zero-dollar charge. */
export function billableProviderTokens(model: string, raw: unknown): BillableTokens | null {
  const usage = object(raw);
  if (!count(usage.input_tokens) || !count(usage.output_tokens)) return null;
  const details = object(usage.input_token_details ?? usage.input_tokens_details);
  const output = object(usage.output_token_details ?? usage.output_tokens_details);
  const cached = details.cached_tokens ?? 0;
  if (!count(cached)) return null;
  const value: BillableTokens = { inputText: usage.input_tokens, cachedText: cached, cacheWriteText: 0, inputAudio: 0, cachedAudio: 0, outputText: usage.output_tokens, outputAudio: 0 };
  if (model.startsWith('gpt-realtime-') || model === 'gpt-4o-mini-transcribe') {
    if (!count(details.text_tokens) || !count(details.audio_tokens) || details.text_tokens + details.audio_tokens !== usage.input_tokens) return null;
    value.inputText = details.text_tokens; value.inputAudio = details.audio_tokens;
    if (cached) {
      const breakdown = object(details.cached_tokens_details);
      if (!count(breakdown.text_tokens) || !count(breakdown.audio_tokens) || breakdown.text_tokens + breakdown.audio_tokens !== cached) return null;
      value.cachedText = breakdown.text_tokens; value.cachedAudio = breakdown.audio_tokens;
    } else value.cachedText = 0;
    if (model.startsWith('gpt-realtime-')) {
      if (!count(output.text_tokens) || !count(output.audio_tokens) || output.text_tokens + output.audio_tokens !== usage.output_tokens) return null;
      value.outputText = output.text_tokens; value.outputAudio = output.audio_tokens;
    }
  }
  const written = details.cache_write_tokens ?? 0;
  if (!count(written)) return null;
  value.cacheWriteText = written;
  const parsed = billableTokensSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Synthetic usage, never inferred from a real visitor message or a recording. */
export const BILLING_DEMO_USAGE = {
  chat: { model: 'gpt-5.6-luna', tokens: { inputText: 2000, cachedText: 0, inputAudio: 0, cachedAudio: 0, outputText: 500, outputAudio: 0, cacheWriteText: 0 } },
  voice: { model: 'gpt-realtime-2.1', tokens: { inputText: 2000, cachedText: 0, inputAudio: 3000, cachedAudio: 0, outputText: 100, outputAudio: 3000, cacheWriteText: 0 } },
} satisfies Record<string, { model: BillingModel; tokens: BillableTokens }>;
