import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors';
import type { TestRecorder } from './visitor-test-events';
import { AI_OUTPUT_LIMITS } from './ai-model';

type Scope = { slug?: string; record?: TestRecorder };
type Config = { recordingId: string; slugs: string[]; limitMicros: number; voiceReserveMicros: number };
type ReasoningBound = { digest: string; tokenBound: number };
type Entry = { id: string; reservedMicros: number; chargedMicros: number; inputBound: number; outputBound: number; feeMicros: number; status: 'reserved' | 'measured'; serviceTier?: string; model?: string; reasoningItems?: ReasoningBound[]; accountingIssue?: true };
type Ledger = { version: 1; config: Config; entries: Entry[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const missing = (error: unknown) => object(error).code === 'ENOENT';
const blocked = (reason: string) => new AppError(`Local QA budget: ${reason}. No paid request was sent.`, 429);

// Verified 2026-09-27 for BOTH gpt-5.6-luna and gpt-6-astra (separate table
// rows, not an inferred shared-family rule): low detail fits 512x512, uses 32px
// patches and a 1.2 multiplier. Reserve ceil(256 * 1.2) plus the documented
// possible one-token rounding difference, independent of source dimensions.
// https://developers.openai.com/api/docs/guides/images-vision#model-sizing-behavior
// https://developers.openai.com/api/docs/guides/images-vision#patch-based-image-tokenization
const LOW_DETAIL_IMAGE_TOKENS = Math.ceil(256 * 1.2) + 1;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_QA_JPEG_BYTES = 200_000;
function mediaInputBound(body: Record<string, unknown>) {
  const supportedImages = new Set<unknown>();
  for (const entry of Array.isArray(body.input) ? body.input : []) {
    const message = object(entry);
    for (const part of Array.isArray(message.content) ? message.content : []) {
      const image = object(part);
      if (image.type !== 'input_image') continue;
      if (message.role !== 'user' || message.type !== undefined && message.type !== 'message'
        || image.detail !== 'low' || Object.keys(image).some(key => !['type', 'image_url', 'detail'].includes(key))
        || typeof image.image_url !== 'string' || image.image_url.length > JPEG_PREFIX.length + Math.ceil(MAX_QA_JPEG_BYTES / 3) * 4
        || !/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.image_url)) throw blocked('media inputs need a supported explicit low-detail JPEG bound');
      // The active-photo adapter emits static JPEGs no larger than 200KB.
      // Reject ambiguous file IDs/URLs and non-JPEG signatures; do not fetch or parse pixels.
      const bytes = Buffer.from(image.image_url.slice(JPEG_PREFIX.length), 'base64');
      if (bytes.length < 5 || bytes.length > MAX_QA_JPEG_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff
        || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw blocked('media inputs need a supported explicit low-detail JPEG bound');
      supportedImages.add(part);
    }
  }
  function count(value: unknown): number {
    if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + count(item), 0);
    const item = object(value);
    if (item.type === 'input_image') {
      if (!supportedImages.has(value)) throw blocked('media inputs need a supported explicit low-detail JPEG bound');
      return LOW_DETAIL_IMAGE_TOKENS;
    }
    if (typeof item.type === 'string' && /^input_(?!text$)/.test(item.type)) throw blocked('media inputs need a separate cost bound');
    return Object.values(item).reduce<number>((sum, child) => sum + count(child), 0);
  }
  return { tokens: count(body), supportedImages };
}

type QaModel = 'gpt-5.6-luna' | 'gpt-6-astra';
type Rates = { input: number; cached: number; write: number; output: number };
const supportedModel = (model: unknown): model is QaModel => model === 'gpt-5.6-luna' || model === 'gpt-6-astra';
const digest = (item: unknown) => createHash('sha256').update(JSON.stringify(item)).digest('hex');
const supportedTiers = ['default', 'fast', 'priority', 'flex'];
// USD/M tokens equals micros/token. Verified 2026-09-27:
// https://developers.openai.com/api/docs/pricing
// https://developers.openai.com/api/docs/models/gpt-6-astra
// Cache-write pricing replaces ordinary input pricing, rather than adding to it.
function rates(model: QaModel, inputTokens: number, tier: unknown): Rates {
  // Preserve the previous Luna maximum, including historical late settlements.
  if (model === 'gpt-5.6-luna') return { input: 1, cached: 1, write: 1, output: 3.6 };
  const long = inputTokens > 272_000;
  const multiplier = tier === 'default' ? 1 : tier === 'flex' ? .5 : 2;
  return { input: (long ? 20 : 10) * multiplier, cached: (long ? 2 : 1) * multiplier,
    write: (long ? 25 : 12.5) * multiplier, output: (long ? 75 : 50) * multiplier };
}

/** Opaque reasoning is never bounded from ciphertext length. Only exact items
 * returned by an earlier guarded request can reuse that request's output bound.
 * https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses
 */
function reasoningInputBound(body: Record<string, unknown>, known: ReasoningBound[]) {
  let tokens = 0;
  for (const item of Array.isArray(body.input) ? body.input : []) {
    const value = object(item);
    if (value.type === 'reasoning') {
      if (typeof value.encrypted_content !== 'string' || !value.encrypted_content) throw blocked('opaque reasoning has no recorded token bound');
      const itemDigest = digest(item), matches = known.filter(entry => entry.digest === itemDigest);
      if (!matches.length) throw blocked('opaque reasoning has no recorded token bound');
      tokens += Math.max(...matches.map(entry => entry.tokenBound));
    } else if (value.type !== undefined && !['message', 'function_call', 'function_call_output'].includes(String(value.type))) {
      // Includes item_reference and compaction: their hidden state cannot be
      // estimated from the visible ID/summary. Ordinary quoted text is untouched.
      throw blocked('input item has no supported context bound');
    }
  }
  return tokens;
}

/** Upper bounds in millionths of a dollar, not an invoice. Serialized UTF-8 bytes
 * bound visible text, with fixed framing headroom. Astra image data-URL bytes
 * are excluded ONLY after exact supported-part validation; 309 image tokens are
 * added per occurrence. Luna retains its old byte over-reservation as well.
 * Web/image search reserves one $0.01 call plus 128K hosted context tokens.
 * https://developers.openai.com/api/docs/guides/tools-web-search#responses-api
 */
function requestBound(body: Record<string, unknown>, knownReasoning: ReasoningBound[]) {
  // Dictation is a separate, fixed file-transcription operation. Only verified
  // 24kHz mono PCM byte counts are accepted; never estimate duration from a
  // compressed file or a client-supplied duration. Hold a whole minute ($0.0045)
  // for at most 20 seconds, including on cancellation or unknown provider usage.
  // Verified 2026-09-28: https://developers.openai.com/api/docs/pricing
  if (body.model === 'gpt-transcribe') {
    const bytes = body.input_audio_pcm_bytes;
    if (!integer(bytes) || bytes < 9600 || bytes > 960_000 || bytes % 2
      || Object.keys(body).some(key => !['model', 'input_audio_pcm_bytes'].includes(key))) throw blocked('dictation has no supported PCM duration bound');
    return { inputBound: bytes, outputBound: 0, feeMicros: 4500, reservedMicros: 4500 };
  }
  if (!supportedModel(body.model) || !integer(body.max_output_tokens) || body.max_output_tokens < 1 || body.max_output_tokens > 128_000) throw blocked('request has no supported price/output bound');
  const model = body.model, reasoning = object(body.reasoning);
  if (reasoning.mode !== undefined && reasoning.mode !== 'standard' || model === 'gpt-6-astra' && reasoning.effort !== 'high') throw blocked('request has no supported standard reasoning bound');
  if (body.service_tier !== undefined && !['auto', ...supportedTiers, ...(model === 'gpt-5.6-luna' ? ['scale'] : [])].includes(String(body.service_tier))) throw blocked('service tier has no supported price bound');
  if (body.previous_response_id != null || body.conversation != null || body.prompt != null || body.context_management != null || body.background === true) throw blocked('server-managed context or work has no supported bound');
  const serialized = JSON.stringify(body);
  const copied = JSON.parse(serialized), media = mediaInputBound(copied);
  const reasoningTokens = reasoningInputBound(copied, knownReasoning);
  // An image URL is a transport encoding, not text given to the model. Keep all
  // other fields/text, including a literal copy of that URL in a text message.
  const text = model === 'gpt-6-astra' ? JSON.stringify(copied, function(key, value) { return key === 'image_url' && media.supportedImages.has(this) ? '' : value; }) : serialized;
  if (body.tools !== undefined && !Array.isArray(body.tools)) throw blocked('hosted tool has no supported price bound');
  const tools = Array.isArray(body.tools) ? body.tools.map(object) : [];
  if (tools.some(tool => !['function', 'web_search'].includes(String(tool.type)))) throw blocked('hosted tool has no supported price bound');
  const searches = tools.filter(tool => tool.type === 'web_search').length;
  if (searches > 1 || searches && body.max_tool_calls !== 1) throw blocked('search requires the existing one-call bound');
  const inputBound = Buffer.byteLength(text, 'utf8') + 20_000 + media.tokens + reasoningTokens + (searches ? 128_000 : 0);
  const outputBound = body.max_output_tokens, feeMicros = searches ? 10_000 : 0;
  const rate = rates(model, inputBound, body.service_tier);
  return { inputBound, outputBound, feeMicros, reservedMicros: Math.ceil(inputBound * Math.max(rate.input, rate.cached, rate.write)) + Math.ceil(outputBound * rate.output) + feeMicros };
}

export function visitorQaRequestBound(body: Record<string, unknown>) {
  return requestBound(body, []);
}

/** Pure continuation preflight with bounds recorded from prior provider output.
 * Callers must obtain these hashes from their verified response ledger. */
export function visitorQaContinuationRequestBound(body: Record<string, unknown>, knownReasoning: ReasoningBound[]) {
  if (!Array.isArray(knownReasoning) || knownReasoning.some(item => !/^[a-f0-9]{64}$/.test(item.digest)
    || !integer(item.tokenBound) || item.tokenBound < 1 || item.tokenBound > AI_OUTPUT_LIMITS.visitor)) throw blocked('reasoning history has no supported output bound');
  return requestBound(body, knownReasoning);
}

/** Hash-only output evidence; the originating request ceiling bounds each item.
 * Accounting verification and durable storage remain the caller's responsibility. */
export function visitorQaReasoningOutputBounds(response: Record<string, unknown>, model: string, outputBound: number) {
  if (!supportedModel(model) || !integer(outputBound) || outputBound < 1 || outputBound > AI_OUTPUT_LIMITS.visitor) throw blocked('reasoning output has no supported original bound');
  return reasoningOutputBounds(response, model, outputBound);
}

function reasoningOutputBounds(response: Record<string, unknown>, model: QaModel, outputBound: number): ReasoningBound[] {
  // A returned opaque item is bounded by the ORIGINAL max_output_tokens,
  // including reasoning. Missing usage holds the whole dollar reservation but
  // must not prevent the next normal tool round from safely replaying the item.
  if (response.model !== model || !['completed', 'incomplete', 'failed'].includes(String(response.status))
    || integer(object(response.usage).output_tokens) && Number(object(response.usage).output_tokens) > outputBound) return [];
  return (Array.isArray(response.output) ? response.output : []).flatMap(item => {
    const value = object(item);
    return value.type === 'reasoning' && typeof value.encrypted_content === 'string' && value.encrypted_content
      ? [{ digest: digest(item), tokenBound: outputBound }] : [];
  });
}

function measuredCost(response: Record<string, unknown>, model: QaModel, bound: Pick<Entry, 'inputBound' | 'outputBound' | 'reservedMicros' | 'feeMicros'>) {
  const usage = object(response.usage), tier = response.service_tier;
  const overrun = integer(usage.input_tokens) && usage.input_tokens > bound.inputBound
    || integer(usage.output_tokens) && usage.output_tokens > bound.outputBound
    || response.model !== undefined && response.model !== model;
  if (overrun) return { accountingIssue: true };
  // Legacy Luna responses did not require model/status/total fields. Keep their
  // existing maximum rates and late-settlement behavior. Astra must prove the
  // model and terminal usage before a reservation can be released.
  if (![...supportedTiers, ...(model === 'gpt-5.6-luna' ? ['scale'] : [])].includes(String(tier))
    || !integer(usage.input_tokens) || !integer(usage.output_tokens)
    || model === 'gpt-6-astra' && (response.model !== model || !['completed', 'incomplete', 'failed'].includes(String(response.status)) || usage.total_tokens === undefined)
    || usage.total_tokens !== undefined && (!integer(usage.total_tokens) || usage.total_tokens !== usage.input_tokens + usage.output_tokens)) return {};
  const details = object(usage.input_tokens_details), outputDetails = object(usage.output_tokens_details);
  const cached = details.cached_tokens, written = details.cache_write_tokens;
  if (cached !== undefined && !integer(cached) || written !== undefined && !integer(written)
    || Number(cached ?? 0) + Number(written ?? 0) > usage.input_tokens
    || outputDetails.reasoning_tokens !== undefined && (!integer(outputDetails.reasoning_tokens) || outputDetails.reasoning_tokens > usage.output_tokens)) return {};
  const rate = rates(model, usage.input_tokens, tier);
  // Cache-write tokens replace regular input tokens. If either detail is absent,
  // charge all input at the highest applicable rate instead of assuming zero.
  // Reasoning is already included in output_tokens; do not charge it twice.
  const inputCost = integer(cached) && integer(written)
    ? (usage.input_tokens - cached - written) * rate.input + cached * rate.cached + written * rate.write
    : usage.input_tokens * Math.max(rate.input, rate.cached, rate.write);
  const chargedMicros = Math.ceil(inputCost) + Math.ceil(usage.output_tokens * rate.output) + bound.feeMicros;
  return chargedMicros <= bound.reservedMicros ? { chargedMicros } : { accountingIssue: true };
}

/** File locking and write-before-send make the ceiling survive HMR/restarts and concurrent calls.
 * An abandoned reservation remains charged. A corrupt ledger/held lock is never reset automatically.
 */
export function createVisitorQaBudget(directory: string) {
  async function transaction<T>(config: Config, update: (ledger: Ledger) => T): Promise<T> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, `qa-budget-${config.recordingId}.json`), lock = `${path}.lock`;
    let handle;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { handle = await open(lock, 'wx', 0o600); break; }
      catch (error) { if (object(error).code !== 'EEXIST') throw error; await new Promise(resolve => setTimeout(resolve, 10)); }
    }
    if (!handle) throw blocked('ledger is locked; check the previous process before continuing');
    try {
      let ledger: Ledger;
      try { ledger = JSON.parse(await readFile(path, 'utf8')) as Ledger; }
      catch (error) { if (!missing(error)) throw blocked('ledger could not be read'); ledger = { version: 1, config, entries: [] }; }
      if (ledger.version !== 1 || JSON.stringify(ledger.config) !== JSON.stringify(config) || !Array.isArray(ledger.entries)
        || ledger.entries.some(entry => !integer(entry.chargedMicros) || !integer(entry.reservedMicros) || entry.chargedMicros > entry.reservedMicros
          || entry.reasoningItems !== undefined && (!Array.isArray(entry.reasoningItems) || !integer(entry.outputBound) || entry.outputBound < 1 || entry.outputBound > 128_000
            || entry.reasoningItems.some(item => !/^[a-f0-9]{64}$/.test(item.digest) || !integer(item.tokenBound) || item.tokenBound > entry.outputBound)))) throw blocked('ledger or configuration changed; inspect it before continuing');
      const result = update(ledger);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try { await writeFile(temporary, JSON.stringify(ledger, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
      finally { await unlink(temporary).catch(() => undefined); }
      return result;
    } finally { await handle.close(); await unlink(lock); }
  }
  return async function reserve(body: Record<string, unknown>, scope?: Scope) {
    if (!scope?.slug) return undefined;
    let config: Config;
    try { config = JSON.parse(await readFile(join(directory, 'qa-budget.json'), 'utf8')) as Config; }
    catch (error) { if (missing(error)) return undefined; throw blocked('configuration could not be read'); }
    if (!Array.isArray(config.slugs) || !config.slugs.includes(scope.slug)) return undefined;
    // Configured local test sites fail closed if recording expires or a cached
    // observer loses scope. Other publishers and production remain unaffected.
    if (!scope.record?.recordingId || config.recordingId !== scope.record.recordingId) throw blocked('the configured active local recorder is required');
    if (!/^[a-f0-9-]{36}$/.test(config.recordingId) || !integer(config.limitMicros) || config.limitMicros < 1 || config.limitMicros > 5_000_000
      || !integer(config.voiceReserveMicros) || config.voiceReserveMicros < 150_000 || config.voiceReserveMicros > config.limitMicros) throw blocked('configuration is invalid');
    const id = randomUUID();
    const { entry, remainingMicros } = await transaction(config, ledger => {
      if (ledger.entries.some(item => item.accountingIssue)) throw blocked('a previous response exceeded its supported accounting bound; reconcile it before continuing');
      const knownReasoning = ledger.entries.filter(item => supportedModel(item.model) && item.model === body.model).flatMap(item => item.reasoningItems ?? []);
      const bound = requestBound(body, knownReasoning);
      const entry: Entry = { id, model: String(body.model), ...bound, chargedMicros: bound.reservedMicros, status: 'reserved' };
      const remaining = config.limitMicros - config.voiceReserveMicros - ledger.entries.reduce((sum, item) => sum + item.chargedMicros, 0);
      if (bound.reservedMicros > remaining) throw blocked(`request needs an upper-bound reservation of $${(bound.reservedMicros / 1e6).toFixed(4)}, only $${(remaining / 1e6).toFixed(4)} remains`);
      ledger.entries.push(entry); return { entry, remainingMicros: remaining - bound.reservedMicros };
    });
    scope.record({ type: 'qa_budget.reserved', data: { ...entry, remainingMicros } });
    return { async settle(response: Record<string, unknown>) {
      if (entry.model === 'gpt-transcribe') {
        // The full conservative reservation stays in the ledger. A transcript
        // is not proof of billed duration, and token usage cannot price this model.
        scope.record?.({ type: 'qa_budget.usage_unknown', data: { reservationId: id, reservedMicros: entry.reservedMicros, accounting: 'one-minute dictation upper bound retained' } });
        return;
      }
      const usage = object(response.usage), tier = response.service_tier;
      const model = entry.model as QaModel, cost = measuredCost(response, model, entry);
      const reasoningItems = reasoningOutputBounds(response, model, entry.outputBound);
      await transaction(config, ledger => {
        const current = ledger.entries.find(item => item.id === id);
        if (!current || current.status !== 'reserved') throw blocked('reservation could not be reconciled');
        if (cost.accountingIssue) current.accountingIssue = true;
        if (reasoningItems.length && !cost.accountingIssue) current.reasoningItems = reasoningItems;
        if (cost.chargedMicros !== undefined) {
          current.chargedMicros = cost.chargedMicros; current.status = 'measured'; current.serviceTier = String(tier);
          delete current.accountingIssue;
        }
      });
      if (cost.chargedMicros === undefined) {
        scope.record?.({ type: 'qa_budget.usage_unknown', data: { reservationId: id, reservedMicros: entry.reservedMicros, accountingIssue: Boolean(cost.accountingIssue) } }); return;
      }
      scope.record?.({ type: 'qa_budget.measured', data: { reservationId: id, chargedMicros: cost.chargedMicros, usage, serviceTier: tier, accounting: 'conservative upper bound, not billed cost' } });
    } };
  };
}

const localBudget = createVisitorQaBudget(join(process.cwd(), '.visitor-recordings'));
export async function reserveVisitorQaRequest(body: Record<string, unknown>, scope?: Scope) {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return localBudget(body, scope);
}

export function reserveVisitorQaDictation(pcmBytes: number, scope?: Scope) {
  return reserveVisitorQaRequest({ model: 'gpt-transcribe', input_audio_pcm_bytes: pcmBytes }, scope);
}
