import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './errors';
import type { TestRecorder } from './visitor-test-events';

type Scope = { slug?: string; record?: TestRecorder };
type Config = { recordingId: string; slugs: string[]; limitMicros: number; voiceReserveMicros: number };
type Entry = { id: string; reservedMicros: number; chargedMicros: number; inputBound: number; outputBound: number; feeMicros: number; status: 'reserved' | 'measured'; serviceTier?: string };
type Ledger = { version: 1; config: Config; entries: Entry[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const missing = (error: unknown) => object(error).code === 'ENOENT';
const blocked = (reason: string) => new AppError(`Local QA budget: ${reason}. No paid request was sent.`, 429);

/** Upper bounds in millionths of a dollar, not an invoice. Rates verified 2026-09-18:
 * Luna Fast/long input including cache writes <= $1/M, output <= $3.60/M.
 * Count serialized UTF-8 bytes as text tokens, plus fixed provider framing headroom.
 * Web/image search has one $0.01 call and at most 128K hosted search context tokens.
 * Unsupported models, media inputs and hosted tools fail closed while enabled.
 */
export function visitorQaRequestBound(body: Record<string, unknown>) {
  if (body.model !== 'gpt-5.6-luna' || !integer(body.max_output_tokens) || body.max_output_tokens < 1 || body.max_output_tokens > 128_000) throw blocked('request has no supported price/output bound');
  const serialized = JSON.stringify(body);
  if (/"type"\s*:\s*"(?:input_image|input_audio|input_file)"/.test(serialized)) throw blocked('media inputs need a separate cost bound');
  const tools = Array.isArray(body.tools) ? body.tools.map(object) : [];
  if (tools.some(tool => !['function', 'web_search'].includes(String(tool.type)))) throw blocked('hosted tool has no supported price bound');
  const searches = tools.filter(tool => tool.type === 'web_search').length;
  if (searches > 1 || searches && body.max_tool_calls !== 1) throw blocked('search requires the existing one-call bound');
  const inputBound = Buffer.byteLength(serialized, 'utf8') + 20_000 + (searches ? 128_000 : 0);
  const outputBound = body.max_output_tokens, feeMicros = searches ? 10_000 : 0;
  return { inputBound, outputBound, feeMicros, reservedMicros: inputBound + Math.ceil(outputBound * 3.6) + feeMicros };
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
        || ledger.entries.some(entry => !integer(entry.chargedMicros) || !integer(entry.reservedMicros) || entry.chargedMicros > entry.reservedMicros)) throw blocked('ledger or configuration changed; inspect it before continuing');
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
    if (!/^[a-f0-9-]{36}$/.test(config.recordingId) || !integer(config.limitMicros) || config.limitMicros < 1 || config.limitMicros > 3_000_000
      || !integer(config.voiceReserveMicros) || config.voiceReserveMicros < 150_000 || config.voiceReserveMicros > config.limitMicros) throw blocked('configuration is invalid');
    const bound = visitorQaRequestBound(body), id = randomUUID();
    const entry: Entry = { id, ...bound, chargedMicros: bound.reservedMicros, status: 'reserved' };
    const remainingMicros = await transaction(config, ledger => {
      const remaining = config.limitMicros - config.voiceReserveMicros - ledger.entries.reduce((sum, item) => sum + item.chargedMicros, 0);
      if (bound.reservedMicros > remaining) throw blocked(`request needs an upper-bound reservation of $${(bound.reservedMicros / 1e6).toFixed(4)}, only $${(remaining / 1e6).toFixed(4)} remains`);
      ledger.entries.push(entry); return remaining - bound.reservedMicros;
    });
    scope.record({ type: 'qa_budget.reserved', data: { ...entry, remainingMicros } });
    return { async settle(response: Record<string, unknown>) {
      const usage = object(response.usage), tier = response.service_tier;
      // Missing/unknown tier or incomplete usage cannot free a reservation. Cached
      // tokens are deliberately charged at the highest cache-write rate as well.
      if (!['default', 'fast', 'priority', 'flex', 'scale'].includes(String(tier))
        || !integer(usage.input_tokens) || !integer(usage.output_tokens)
        || usage.input_tokens > bound.inputBound || usage.output_tokens > bound.outputBound) {
        scope.record?.({ type: 'qa_budget.usage_unknown', data: { reservationId: id, reservedMicros: bound.reservedMicros } }); return;
      }
      const chargedMicros = usage.input_tokens + Math.ceil(usage.output_tokens * 3.6) + bound.feeMicros;
      await transaction(config, ledger => {
        const current = ledger.entries.find(item => item.id === id);
        if (!current || current.status !== 'reserved') throw blocked('reservation could not be reconciled');
        current.chargedMicros = chargedMicros; current.status = 'measured'; current.serviceTier = String(tier);
      });
      scope.record?.({ type: 'qa_budget.measured', data: { reservationId: id, chargedMicros, usage, serviceTier: tier, accounting: 'conservative upper bound, not billed cost' } });
    } };
  };
}

const localBudget = createVisitorQaBudget(join(process.cwd(), '.visitor-recordings'));
export async function reserveVisitorQaRequest(body: Record<string, unknown>, scope?: Scope) {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return localBudget(body, scope);
}
