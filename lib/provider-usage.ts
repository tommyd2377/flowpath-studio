export type ProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };

/** Provider-reported counts only. Missing usage is unknown, never zero or a price. */
export function measuredUsage(input: unknown): ProviderUsage | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const result: ProviderUsage = {};
  const source = input as Record<string, unknown>;
  for (const [from, to] of [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['total_tokens', 'totalTokens']] as const) {
    const value = source[from];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000) result[to] = value;
  }
  return Object.keys(result).length ? result : undefined;
}
