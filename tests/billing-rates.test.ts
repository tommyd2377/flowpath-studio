import assert from 'node:assert/strict';
import test from 'node:test';
import { billableProviderTokens, retailCharge, type BillableTokens } from '../lib/billing-rates';

const empty: BillableTokens = { inputText: 0, cachedText: 0, cacheWriteText: 0, inputAudio: 0, cachedAudio: 0, outputText: 0, outputAudio: 0 };
test('retail rates use integer precision, cached discounts and versioned three-times markup', () => {
  assert.deepEqual(retailCharge('gpt-5.6-luna', { ...empty, inputText: 1000, cachedText: 200, outputText: 100 }),
    { providerMicros: 284, retailMicros: 852, rateCardVersion: 'launch-2026-09-09-v1' });
  assert.equal(retailCharge('gpt-5.6-luna', { ...empty, inputText: 1 }).retailMicros, 1);
  assert.throws(() => retailCharge('unpriced', empty), /not configured/);
  assert.throws(() => retailCharge('gpt-5.6-luna', empty, 'future-rate'), /not configured/);
});
test('long context and cache writes are priced explicitly, with unsupported modalities rejected', () => {
  const result = retailCharge('gpt-5.6-luna', { ...empty, inputText: 300_000, cachedText: 100_000, cacheWriteText: 100_000, outputText: 1000 });
  assert.equal(result.providerMicros, 95_800);
  assert.equal(result.retailMicros, 287_400);
  assert.throws(() => retailCharge('gpt-5.6-luna', { ...empty, inputAudio: 1 }), /no verified rate/);
});
test('realtime billing distinguishes audio, text and cached input instead of guessing from total tokens', () => {
  const raw = { input_tokens: 1000, output_tokens: 500,
    input_token_details: { text_tokens: 400, audio_tokens: 600, cached_tokens: 200, cached_tokens_details: { text_tokens: 100, audio_tokens: 100 } },
    output_token_details: { text_tokens: 100, audio_tokens: 400 } };
  const value = billableProviderTokens('gpt-realtime-2.1', raw)!;
  assert.equal(retailCharge('gpt-realtime-2.1', value).retailMicros, 135_840);
  assert.equal(billableProviderTokens('gpt-realtime-2.1', { input_tokens: 1000, output_tokens: 500 }), null);
  assert.equal(billableProviderTokens('gpt-realtime-2.1', { ...raw, input_tokens: 999 }), null);
  assert.equal(billableProviderTokens('gpt-5.6-luna', { input_tokens: 10 }), null);
  assert.equal(billableProviderTokens('gpt-5.6-luna', { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 11 } }), null);
});
