/** Passive observations only. Never feed recordings back into model or UI state. */
export type TestObservation = { type: string; data: unknown; traceId?: string; turn?: number; truncated?: boolean; redacted?: boolean };
export type TestRecorder = ((event: TestObservation) => void) & { readonly recordingId?: string };
export type TestEvent = TestObservation & {
  at: number; monotonicMs: number; source: 'browser' | 'server'; sequence: number;
  truncated?: boolean; redacted?: boolean;
};
export const RECORDING_HEADER = 'x-flowpath-test-recording';
export const LOCAL_TEST_HEADER = 'x-flowpath-local-test';
export const PHONE_RECORDING_HEADER = 'x-flowpath-phone-recording';
export const RECORDING_EVENT_BYTES = 240_000;
const noop: TestRecorder = () => {};

/** An observer can never throw into the application it observes. */
export function safeTestRecorder(observer?: TestRecorder, recordingId?: () => string | undefined): TestRecorder {
  if (!observer || observer === noop || process.env.NODE_ENV === 'production') return noop;
  const wrapped: TestRecorder = event => { try { observer(sanitizeTestObservation(event)); } catch {} };
  return Object.defineProperty(wrapped, 'recordingId', { get: recordingId ?? (() => observer.recordingId) });
}

// Installed only by the local recorder controls. Server paths use explicit,
// request-scoped observers instead of a process-wide content subscription.
let browserObserver: TestRecorder | undefined;
export function setBrowserTestRecorder(observer?: TestRecorder) { browserObserver = observer; }
export function recordBrowserTestEvent(type: string, data: unknown, traceId?: string) {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined' || !browserObserver) return;
  try { browserObserver({ type, data, traceId }); } catch {}
}

/** Bounded structural copying; never serialize the original object wholesale.
 * Binary media, connection descriptions and credential-bearing fields are omitted.
 * JSON embedded in tool arguments/model input is sanitized recursively too.
 */
export function sanitizeTestObservation(event: TestObservation) {
  let budget = 100_000, nodes = 0, truncated = !!event.truncated, redacted = !!event.redacted;
  const seen = new WeakSet<object>();
  const secret = /^(?:api[_-]?key|authorization|cookie|set-cookie|token|access[_-]?token|refresh[_-]?token|id[_-]?token|pairing[_-]?token|recording[_-]?grant|x-flowpath-phone-recording|secret|password|credential|credentials|sdp|encrypted_content|client_secret|control)$/i;
  function text(value: string) {
    let result = value.replace(/\bBearer\s+[^\s"<>]+/gi, '[redacted bearer]')
      .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[redacted key]')
      .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, '[redacted token]')
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
      .replace(/https?:\/\/[^\s"<>]+/g, url => {
        try { const parsed = new URL(url); if (parsed.username || parsed.password || parsed.search || parsed.hash) { parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = ''; return `${parsed.href}[URL parameters omitted]`; } } catch {}
        return url;
      });
    if (result !== value) redacted = true;
    if (result.startsWith('data:')) { redacted = true; return `[binary omitted: ${result.length} characters]`; }
    const allowed = Math.max(0, Math.min(64_000, budget));
    budget -= Math.min(result.length, allowed);
    if (result.length > allowed) { truncated = true; result = `${result.slice(0, allowed)}[truncated]`; }
    return result;
  }
  function copy(value: unknown, depth = 0): unknown {
    if (++nodes > 12_000 || depth > 20 || budget <= 0) { truncated = true; return '[truncated]'; }
    if (value == null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'string') {
      if (/^[\s]*[\[{]/.test(value)) {
        if (value.length > 240_000) { truncated = true; return '[oversized JSON omitted]'; }
        try { return JSON.stringify(copy(JSON.parse(value), depth + 1)); } catch {}
      }
      return text(value);
    }
    if (typeof value !== 'object') return '[omitted]';
    if (seen.has(value)) return '[circular]';
    seen.add(value);
    if (value instanceof Error) return copy({ name: value.name, message: value.message, stack: value.stack,
      ...(typeof (value as Error & { code?: unknown }).code === 'string' ? { code: (value as Error & { code?: string }).code } : {}),
      ...(value.cause !== undefined ? { cause: value.cause } : {}) }, depth + 1);
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) { redacted = true; return '[binary omitted]'; }
    if (Array.isArray(value)) {
      if (value.length > 1024) truncated = true;
      const result = value.slice(0, 1024).map(item => copy(item, depth + 1));
      if (value.length > 1024) result.push(`[${value.length - 1024} entries omitted]`);
      return result;
    }
    const entries = Object.entries(value);
    const audioEvent = 'type' in value && typeof value.type === 'string' && /(?:^|\.)(?:input_|output_)?audio\.(?:append|delta|done)$/.test(value.type);
    if (entries.length > 512) truncated = true;
    return Object.fromEntries(entries.slice(0, 512).map(([key, item]) => {
      if (secret.test(key) || (key === 'audio' || audioEvent && key === 'delta') && typeof item === 'string') { redacted = true; return [key, '[redacted]']; }
      return [text(key), copy(item, depth + 1)];
    }));
  }
  let data = copy(event.data);
  // Escaping and multi-byte text can exceed the character budget.
  if (new TextEncoder().encode(JSON.stringify(data)).length > RECORDING_EVENT_BYTES) {
    truncated = true; data = { omitted: 'Event exceeded byte limit', preview: text(JSON.stringify(data).slice(0, 12_000)) };
  }
  return { type: /^[a-z][a-z0-9_.-]{0,79}$/.test(event.type) ? event.type : 'unknown', data,
    ...(event.traceId && /^[\w-]{1,100}$/.test(event.traceId) ? { traceId: event.traceId } : {}),
    ...(Number.isSafeInteger(event.turn) && event.turn! >= 0 ? { turn: event.turn } : {}),
    ...(truncated ? { truncated: true } : {}), ...(redacted ? { redacted: true } : {}) };
}
