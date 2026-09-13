/** Bounded operational metadata only. Never pass prompts, SDP, URLs, tokens or raw errors. */
export type VisitorDiagnostic = {
  at: number; traceId: string; channel: 'browser' | 'server';
  stage: 'start' | 'audio' | 'microphone' | 'offer' | 'session_request' | 'session_answer' | 'control_ready' | 'ready' | 'first_audio' | 'context' | 'navigation' | 'backend' | 'search' | 'stop';
  status: 'started' | 'succeeded' | 'failed' | 'cancelled' | 'observed';
  httpStatus?: number; durationMs?: number; sessionElapsedMs?: number; revision?: number; interactionRevision?: number; objects?: number; visible?: number; images?: number; sources?: number;
  reason?: 'schema' | 'auth' | 'quota' | 'model' | 'provider' | 'reference' | 'stale' | 'capacity' | 'timeout';
  operation?: 'chat' | 'voice' | 'web' | 'images' | 'map' | 'open' | 'expand' | 'close' | 'home' | 'browse' | 'workspace' | 'explore' | 'other';
};
type Input = Omit<VisitorDiagnostic, 'at'>;
const stages = ['start','audio','microphone','offer','session_request','session_answer','control_ready','ready','first_audio','context','navigation','backend','search','stop'];
const statuses = ['started','succeeded','failed','cancelled','observed'];
const operations = ['chat','voice','web','images','map','open','expand','close','home','browse','workspace','explore','other'];
const state = { events: [] as readonly VisitorDiagnostic[], listeners: new Set<() => void>() };
const empty: readonly VisitorDiagnostic[] = [];
export function sanitizeVisitorDiagnostic(value: Input, now = Date.now()): VisitorDiagnostic | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.traceId) || !stages.includes(value.stage) || !statuses.includes(value.status) || !['browser','server'].includes(value.channel)) return null;
  const result: VisitorDiagnostic = { at: now, traceId: value.traceId, channel: value.channel, stage: value.stage, status: value.status };
  for (const key of ['httpStatus','durationMs','sessionElapsedMs','revision','interactionRevision','objects','visible','images','sources'] as const) {
    const number = value[key]; if (typeof number === 'number' && Number.isFinite(number)) result[key] = Math.max(0, Math.min(3_600_000, Math.round(number)));
  }
  if (value.reason && ['schema','auth','quota','model','provider','reference','stale','capacity','timeout'].includes(value.reason)) result.reason = value.reason;
  if (value.operation && operations.includes(value.operation)) result.operation = value.operation;
  return result;
}
export function visitorDiagnostic(value: Input) {
  const event = sanitizeVisitorDiagnostic(value); if (!event) return;
  state.events = [...state.events, event].slice(-400);
  state.listeners.forEach(listener => listener());
  if (process.env.NODE_ENV !== 'test') (event.status === 'failed' ? console.warn : console.info)('[flowpath:visitor]', JSON.stringify(event));
}
export const visitorDiagnostics = () => state.events;
export const emptyVisitorDiagnostics = () => empty;
export function subscribeVisitorDiagnostics(listener: () => void) { state.listeners.add(listener); return () => { state.listeners.delete(listener); }; }
export function clearVisitorDiagnostics() { state.events = []; state.listeners.forEach(listener => listener()); }

/** Classify failures without ever retaining the error message or provider body. */
export function diagnosticError(error: unknown): Pick<VisitorDiagnostic, 'httpStatus' | 'reason'> {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  const result: Pick<VisitorDiagnostic, 'httpStatus' | 'reason'> = typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599 ? { httpStatus: status } : {};
  if (error instanceof Error) {
    if (error.name === 'ZodError' || error instanceof SyntaxError) result.reason = 'schema';
    else if (/capacity|too many|workspace.*full/i.test(error.message)) result.reason = 'capacity';
    else if (/publication.*changed|stale|out of order/i.test(error.message)) result.reason = 'stale';
    else if (/reference|not.*published|unknown.*(id|item)/i.test(error.message)) result.reason = 'reference';
    else if (/timeout|timed out/i.test(error.message)) result.reason = 'timeout';
  }
  return result;
}

/** Start in an event handler; the returned function measures that operation only. */
export function visitorDiagnosticTimer() { const start = performance.now(); return () => performance.now() - start; }
