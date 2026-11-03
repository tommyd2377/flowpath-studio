const marks = [
  'click', 'previous_cleanup_ready', 'readiness_requested', 'readiness_complete',
  'audio_resume_requested', 'audio_context_running', 'microphone_requested', 'microphone_acquired',
  'offer_requested', 'local_description_set', 'ice_complete', 'session_requested', 'session_headers',
  'session_answer_received', 'remote_description_applied', 'transport_connected', 'provider_session_started',
  'supervision_confirmed', 'greeting_requested', 'conversation_ready', 'remote_track_received',
  'playback_allowed', 'playback_blocked', 'first_output_signal', 'first_audible_output', 'stopped',
] as const;
type Mark = typeof marks[number];
const serverPhases = new Set(['fp_scope', 'fp_admission', 'fp_deadline', 'fp_provider', 'fp_persist', 'fp_supervision']);
type RequestPhase = 'readiness' | 'session';
export type StartupTimingReport = {
  format: 'flowpath-startup-timing'; version: 1;
  permissionBeforeCapture: PermissionState | 'unknown';
  events: { name: Mark; atMs: number }[];
  server: { request: RequestPhase; name: string; durationMs: number }[];
};

/** Fixed labels and monotonic durations only. Never receives provider events, text, SDP or IDs. */
export function createStartupTiming(startedAt = performance.now(), now = () => performance.now()) {
  let recording = true, lastAt = 0;
  let permission: StartupTimingReport['permissionBeforeCapture'] = 'unknown';
  const events: StartupTimingReport['events'] = [{ name: 'click', atMs: 0 }];
  const server: StartupTimingReport['server'] = [];
  const seen = new Set<Mark>(['click']);
  function mark(name: Mark) {
    if (!recording || !marks.includes(name) || seen.has(name)) return;
    const elapsed = now() - startedAt;
    if (!Number.isFinite(elapsed)) return;
    lastAt = Math.max(lastAt, 0, elapsed);
    seen.add(name);
    events.push({ name, atMs: Math.round(lastAt * 10) / 10 });
  }
  return {
    mark,
    permission(state: PermissionState) {
      if (recording && !seen.has('microphone_requested') && ['granted', 'prompt', 'denied'].includes(state)) permission = state;
    },
    serverTiming(request: RequestPhase, value: string | null) {
      if (!recording || !['readiness', 'session'].includes(request) || !value || value.length > 2048) return;
      for (const metric of value.split(',')) {
        const match = /^\s*(fp_[a-z]+);dur=(\d+(?:\.\d+)?)\s*$/.exec(metric);
        if (!match || !serverPhases.has(match[1]) || server.some(item => item.request === request && item.name === match[1])) continue;
        const durationMs = Number(match[2]);
        if (Number.isFinite(durationMs) && durationMs <= 120_000) server.push({ request, name: match[1], durationMs });
      }
    },
    finish() { mark('stopped'); recording = false; },
    snapshot(): StartupTimingReport {
      return { format: 'flowpath-startup-timing', version: 1, permissionBeforeCapture: permission,
        events: events.map(event => ({ ...event })), server: server.map(event => ({ ...event })) };
    },
  };
}
