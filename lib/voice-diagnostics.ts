export type VoiceDiagnosticLifecycle = 'connecting' | 'connected' | 'playback_started' | 'playback_quiet'
  | 'input_started' | 'input_quiet' | 'stopping' | 'ended' | 'error';
export type VoiceDiagnosticFinishReason = 'user_stop' | 'page_left' | 'connection_error' | 'session_closed'
  | 'capture_stopped' | 'limit' | 'idle';
type CloseReason = 'close_requested' | 'expired' | 'content' | 'remote_hangup' | 'connection_lost';
type Timed = { atMs: number };
export type VoiceDiagnosticEvent = Timed & (
  | { type: 'input_transcript' | 'output_transcript'; delta: string; startMs: number; endMs: number }
  | { type: 'delegation_created'; target: 'client' | 'responses' | 'decisions'; offsetMs: number }
  | { type: 'usage'; seconds: number; contextUsageRatio?: number }
  | { type: 'session_started' | 'provider_error' | 'marker' }
  | { type: 'session_closed'; reason: CloseReason; seconds: number; finalizationConfirmed: true }
  | { type: 'unavailable_context_accepted'; startMs: number; endMs: number }
  | { type: 'lifecycle'; name: VoiceDiagnosticLifecycle }
  | { type: 'recording_finished'; reason: VoiceDiagnosticFinishReason }
  | { type: 'capture_truncated'; reason: 'event_limit' | 'transcript_limit' | 'oversized_delta' }
);
export type VoiceDiagnosticReport = {
  format: 'flowpath-voice-diagnostics'; version: 1; app: 'FlowPath Studio'; model: 'gpt-live-1';
  surface: 'public' | 'personal'; recording: boolean; truncated: boolean; events: VoiceDiagnosticEvent[];
};

const lifecycles = new Set<VoiceDiagnosticLifecycle>([
  'connecting', 'connected', 'playback_started', 'playback_quiet', 'input_started', 'input_quiet', 'stopping', 'ended', 'error',
]);
const finishReasons = new Set<VoiceDiagnosticFinishReason>([
  'user_stop', 'page_left', 'connection_error', 'session_closed', 'capture_stopped', 'limit', 'idle',
]);
const closeReasons = new Set<CloseReason>(['close_requested', 'expired', 'content', 'remote_hangup', 'connection_lost']);
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : null;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const timing = (event: Record<string, unknown>) => nonnegative(event.start_ms) && nonnegative(event.end_ms)
  && event.end_ms >= event.start_ms;
const clock = () => typeof performance === 'undefined' ? Date.now() : performance.now();

/** Opt-in, in-memory diagnostics. Copy only explicitly allowed fields; never keep provider payloads. */
export function createVoiceDiagnostics(options: { surface: 'public' | 'personal'; now?: () => number }) {
  const surface = options.surface === 'personal' ? 'personal' : 'public';
  const now = options.now ?? clock;
  const startedAt = now();
  let lastAt = 0;
  let recording = true;
  let truncated = false;
  let transcriptCharacters = 0;
  let events: VoiceDiagnosticEvent[] = [];

  function atMs() {
    const elapsed = now() - startedAt;
    if (Number.isFinite(elapsed)) lastAt = Math.max(lastAt, 0, elapsed);
    return lastAt;
  }
  function truncate(reason: 'event_limit' | 'transcript_limit' | 'oversized_delta') {
    if (truncated) return;
    truncated = true;
    const marker: VoiceDiagnosticEvent = { type: 'capture_truncated', reason, atMs: atMs() };
    if (events.length < 2_000) events.push(marker);
  }
  function append(event: VoiceDiagnosticEvent): boolean {
    if (!recording) return false;
    if (events.length >= 2_000) { truncate('event_limit'); return false; }
    events.push(event);
    return true;
  }
  function providerEvent(value: unknown) {
    if (!recording) return;
    try {
      const event = record(value);
      if (!event) return;
      if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
        if (typeof event.delta !== 'string' || !event.delta || !timing(event)) return;
        if (event.delta.length > 8_000) { truncate('oversized_delta'); return; }
        if (transcriptCharacters + event.delta.length > 120_000) { truncate('transcript_limit'); return; }
        if (events.length >= 2_000) { truncate('event_limit'); return; }
        transcriptCharacters += event.delta.length;
        append({ type: event.type === 'session.input_transcript.delta' ? 'input_transcript' : 'output_transcript',
          delta: event.delta, startMs: event.start_ms as number, endMs: event.end_ms as number, atMs: atMs() });
      } else if (event.type === 'session.delegation.created') {
        const delegation = record(event.delegation);
        if (!nonnegative(event.offset_ms) || !delegation || delegation.type !== 'delegation'
          || typeof delegation.target !== 'string' || !['client', 'responses', 'decisions'].includes(delegation.target)) return;
        append({ type: 'delegation_created', target: delegation.target as 'client' | 'responses' | 'decisions',
          offsetMs: event.offset_ms, atMs: atMs() });
      } else if (event.type === 'session.usage.updated') {
        const usage = record(event.usage), context = record(event.context_window);
        if (!usage || !nonnegative(usage.seconds)) return;
        append({ type: 'usage', seconds: usage.seconds, atMs: atMs(),
          ...(context && nonnegative(context.usage_ratio) && context.usage_ratio <= 1 ? { contextUsageRatio: context.usage_ratio } : {}) });
      } else if (event.type === 'session.started') {
        append({ type: 'session_started', atMs: atMs() });
      } else if (event.type === 'session.closed') {
        const usage = record(event.usage);
        if (!closeReasons.has(event.reason as CloseReason) || !usage || !nonnegative(usage.seconds)) return;
        append({ type: 'session_closed', reason: event.reason as CloseReason, seconds: usage.seconds,
          finalizationConfirmed: true, atMs: atMs() });
      } else if (event.type === 'error') {
        if (record(event.error)) append({ type: 'provider_error', atMs: atMs() });
      } else if (event.type === 'session.commentary.appended' && typeof event.client_event_id === 'string'
        && /^flowpath_unavailable_[1-9]\d{0,2}$/.test(event.client_event_id) && timing(event)) {
        append({ type: 'unavailable_context_accepted', startMs: event.start_ms as number, endMs: event.end_ms as number, atMs: atMs() });
      }
    } catch { /* Malformed external objects must not interrupt the voice experience. */ }
  }
  return {
    providerEvent,
    lifecycle(name: VoiceDiagnosticLifecycle) {
      if (recording && lifecycles.has(name)) append({ type: 'lifecycle', name, atMs: atMs() });
    },
    mark(): boolean { return recording ? append({ type: 'marker', atMs: atMs() }) : false; },
    finish(reason: VoiceDiagnosticFinishReason) {
      if (!recording) return;
      append({ type: 'recording_finished', reason: finishReasons.has(reason) ? reason : 'capture_stopped', atMs: atMs() });
      recording = false;
    },
    clear() { events = []; transcriptCharacters = 0; truncated = false; recording = false; },
    snapshot(): VoiceDiagnosticReport {
      return { format: 'flowpath-voice-diagnostics', version: 1, app: 'FlowPath Studio', model: 'gpt-live-1',
        surface, recording, truncated, events: events.map(event => ({ ...event })) };
    },
  };
}
