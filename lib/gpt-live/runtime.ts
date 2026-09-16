import WebSocket from 'ws';
import { liveSessionUrl, liveText, type LiveAudioState, type LiveHistory, type LiveTranscript, type LiveUsage } from './protocol';

export type LiveSocket = Pick<WebSocket, 'readyState' | 'send' | 'close' | 'terminate' | 'on'>;
export type LiveRuntimeOptions = {
  sessionId: string; apiKey: string; history?: LiveHistory; signal?: AbortSignal;
  acceptDelegation?: () => boolean;
  delegate: (context: { transcripts: LiveTranscript[]; history: LiveHistory; report: (kind: 'thinking' | 'commentary', text: string) => void }, signal: AbortSignal) => Promise<{ text: string; silent?: boolean }>;
  onTranscript?: (fragment: LiveTranscript) => void;
  onUsage?: (usage: LiveUsage) => void; onBusy?: (busy: boolean) => void;
  onTaskError?: (message: string) => void;
  onFatal: (message: string) => void;
  socketFactory?: (url: string, options: WebSocket.ClientOptions) => LiveSocket;
  closeTimeoutMs?: number; taskTimeoutMs?: number;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Convert bounded server failures into useful visitor-facing language without exposing provider details. */
export function liveTaskFailureMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'That request took too long to complete.';
  const message = error instanceof Error ? error.message : '';
  if (message === 'The conversation backend is unavailable.' || message === 'The conversation backend is temporarily unavailable.') return 'The conversation backend is unavailable right now.';
  if (message === 'The conversation backend is busy. Try again shortly.') return message;
  if (message === 'The conversation backend rejected the request.') return 'The conversation backend rejected that request.';
  if (message === 'The conversation backend returned too much data.') return 'The conversation backend returned too much data.';
  if (message === 'The conversation backend did not finish.') return 'The conversation backend did not return a complete answer.';
  if (message === 'The conversation backend returned no answer.') return 'The conversation backend returned no answer.';
  if (message === 'The conversation backend exceeded its tool limit.' || message === 'The conversation backend exceeded its limit.') return 'That request needed more steps than voice allows.';
  if (message === 'Invalid backend tool.') return 'The voice request contained an invalid action.';
  if (message === 'The current view is no longer valid. Reload to continue.') return message;
  return 'The conversation backend could not complete that request.';
}

/** Identical server owner in both apps. Audio and backend work have independent lifetimes. */
export function createLiveRuntime(options: LiveRuntimeOptions) {
  const socket = (options.socketFactory ?? ((url, config) => new WebSocket(url, config)))(liveSessionUrl(options.sessionId, 'attach'), {
    headers: { Authorization: `Bearer ${options.apiKey}` }, handshakeTimeout: 10_000, maxPayload: 256_000,
  });
  let open = false, enabled = false, closing = false, finished = false;
  let task: AbortController | undefined, epoch = 0, sequence = 0;
  const usage: LiveUsage = { finalized: false };
  let pending: string | undefined;
  let audio: LiveAudioState = { inputActive: false, outputActive: false };
  const transcripts: LiveTranscript[] = [];
  const seen = new Set<string>(), delegations = new Set<string>();
  let resolveReady!: () => void, rejectReady!: (error: Error) => void, resolveClosed!: (usage: LiveUsage) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => undefined);
  const closed = new Promise<LiveUsage>(resolve => { resolveClosed = resolve; });
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const readyTimer = setTimeout(() => fatal('The voice connection took too long to start.'), 10_000);
  function send(value: object) {
    if (closing || !open || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(value));
  }
  function append(kind: 'instructions' | 'thinking' | 'commentary', text: string, delegationId: string | null = null) {
    if (!text.trim()) return;
    // Every append fits the API's 500-token bound, even for non-Latin text.
    let remaining = text.slice(0, 2000);
    for (let count = 0; remaining && count < 16; count++) {
      const content = liveText(remaining);
      send({ type: `session.${kind}.append`, event_id: `live_append_${++sequence}`, delegation_id: delegationId, content });
      remaining = remaining.slice(content.length);
    }
  }
  function finish() {
    if (finished) return;
    finished = true; closing = true; task?.abort();
    clearTimeout(readyTimer); clearTimeout(closeTimer);
    options.signal?.removeEventListener('abort', abort);
    if (!open) rejectReady(new Error('The voice connection closed before it was ready.'));
    options.onUsage?.(usage);
    resolveClosed(usage);
    if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
  }
  function fatal(message: string) {
    if (closing || finished) return;
    options.onFatal(message);
    void close();
  }
  function close() {
    if (!closing) {
      task?.abort(); pending = undefined; epoch++;
      if (open && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'session.close' }));
      closing = true;
      closeTimer = setTimeout(finish, options.closeTimeoutMs ?? 5000);
      if (!open) finish();
    }
    return closed;
  }
  function abort() { void close(); }
  async function run(id: string) {
    if (!enabled || closing) { pending = id; return; }
    // Reject status/backchannel or stale delegations before touching active work.
    if (options.acceptDelegation?.() === false) return;
    task?.abort();
    const controller = new AbortController(); task = controller;
    const version = ++epoch;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(options.taskTimeoutMs ?? 35_000)]);
    let rejectAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = () => reject(signal.reason); });
    signal.addEventListener('abort', rejectAbort, { once: true });
    options.onBusy?.(true);
    try {
      // A delegation is a task signal, not text. Preserve exact transcript fragments.
      const context = { history: options.history ?? [], transcripts: transcripts.map(item => ({ ...item })),
        report: (kind: 'thinking' | 'commentary', text: string) => { if (!closing && version === epoch && !signal.aborted) append(kind, text, id); } };
      if (!context.transcripts.some(item => item.role === 'user')) {
        append('commentary', 'Please repeat what you would like help with.', id); return;
      }
      const result = await Promise.race([options.delegate(context, signal), aborted]);
      signal.throwIfAborted();
      if (closing || version !== epoch) return;
      if (!result.silent) append('commentary', result.text, id);
    } catch (error) {
      if (!closing && version === epoch && !controller.signal.aborted) {
        const message = liveTaskFailureMessage(error);
        options.onTaskError?.(message);
        append('commentary', `${message} You can try another question or use the page controls.`, id);
      }
    } finally {
      signal.removeEventListener('abort', rejectAbort);
      if (version === epoch) { task = undefined; options.onBusy?.(false); }
    }
  }
  socket.on('open', () => { open = true; clearTimeout(readyTimer); resolveReady(); });
  socket.on('message', raw => {
    if (finished) return;
    try {
      if (raw.toString().length > 256_000) throw new Error();
      const event = record(JSON.parse(raw.toString()));
      if (event.type === 'session.usage.updated' || event.type === 'session.closed') {
        const seconds = record(event.usage).seconds;
        if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) usage.seconds = Math.max(usage.seconds ?? 0, seconds);
        if (event.type === 'session.closed') { usage.finalized = true; usage.reason = typeof event.reason === 'string' ? event.reason : undefined; finish(); }
        else options.onUsage?.({ ...usage });
        return;
      }
      if (closing) return;
      if (typeof event.event_id === 'string') {
        if (seen.has(event.event_id)) return;
        if (seen.size >= 8192) throw new Error();
        seen.add(event.event_id);
      }
      if (event.type === 'error') { fatal('The voice service rejected a command.'); return; }
      if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
        if (typeof event.delta !== 'string' || event.delta.length > 4000 || typeof event.start_ms !== 'number' || typeof event.end_ms !== 'number'
          || !Number.isFinite(event.start_ms) || !Number.isFinite(event.end_ms) || event.start_ms < 0 || event.end_ms < event.start_ms) throw new Error();
        const fragment: LiveTranscript = { role: event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', delta: event.delta, start_ms: event.start_ms, end_ms: event.end_ms };
        transcripts.push(fragment);
        while (transcripts.length > 512 || transcripts.reduce((n, item) => n + item.delta.length, 0) > 32_000) transcripts.shift();
        options.onTranscript?.(fragment);
      } else if (event.type === 'session.delegation.created') {
        const delegation = record(event.delegation);
        if (delegation.target !== 'client' || typeof delegation.id !== 'string' || delegation.id.length > 200 || !delegation.id) throw new Error();
        if (delegations.has(delegation.id)) return;
        if (delegations.size >= 64) { fatal('This conversation has reached its task limit.'); return; }
        delegations.add(delegation.id);
        void run(delegation.id);
      }
      // Reflected audio and acknowledgments are not playback-completion events.
    } catch { fatal('The voice service returned an invalid event.'); }
  });
  socket.on('error', () => { if (!closing) fatal('The voice connection was interrupted.'); else finish(); });
  socket.on('close', () => { if (!closing) options.onFatal('The voice connection ended unexpectedly.'); finish(); });
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  return {
    ready, closed, close, append,
    start() { if (closing || enabled) return; enabled = true; append('instructions', 'The application is ready. Listen and respond to the caller now.'); if (pending) { const id = pending; pending = undefined; void run(id); } },
    interrupt() { task?.abort(); task = undefined; epoch++; pending = undefined; options.onBusy?.(false); append('instructions', 'Stop speaking now. The user changed the page or task. Discard the previous pending answer and use the new application context.'); },
    observeAudio(next: LiveAudioState) { audio = next; },
    get audio() { return audio; },
    get busy() { return Boolean(task); },
    get usage() { return { ...usage }; },
  };
}
