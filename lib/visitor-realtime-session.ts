import 'server-only';
import { AppError } from './errors';
import type { VisitorAvailability } from './visitor-model';
import { DEFAULT_LIVE_IDLE_TIMEOUT_MS, normalizeLiveIdleTimeoutMs } from './gpt-live/idle';
import { liveSessionConfig, liveSessionId, liveSessionUrl } from './gpt-live/protocol';
import { VISITOR_SESSION_MS, type VisitorRealtimeEvent } from './visitor-realtime';
import { createVisitorRealtimeControl } from './visitor-realtime-control';
import { createVisitorRealtimeMailbox } from './visitor-realtime-mailbox';
import type { VisitorControlUpdate } from './visitor-realtime-context';
import { visitorDiagnostic } from './visitor-diagnostics';

/** Audio only: a visitor must not negotiate a second channel for provider commands. */
export function validateVisitorOffer(offer: string) {
  const lines = offer.trim().split(/\r?\n/);
  const media = lines.filter(line => line.startsWith('m='));
  if (offer.length > 32_768 || lines[0] !== 'v=0' || lines.some(line => !/^[a-z]=[\x20-\x7e]*$/.test(line))
    || media.length !== 1 || !/^m=audio [1-9]\d* UDP\/TLS\/RTP\/SAVPF [\d ]+$/.test(media[0])
    || lines.some(line => /^a=(?:sctp|dcmap|dcsa)/i.test(line))) {
    throw new AppError('The browser could not prepare an audio-only conversation.', 400);
  }
  return offer;
}

type ControlOptions = Parameters<typeof createVisitorRealtimeControl>[0];
export type VisitorSessionOptions = Pick<ControlOptions, 'content' | 'catalog' | 'media' | 'catalogState' | 'context' | 'history' | 'reserveTurn' | 'assertCurrent' | 'onUsage' | 'onTiming' | 'reservationChecksPublication' | 'search'> & {
  offer: string;
  traceId?: string;
  availability: VisitorAvailability;
  apiKey: string;
  signal: AbortSignal;
  fetch?: typeof fetch;
  controlFactory?: typeof createVisitorRealtimeControl;
  mailbox: { slug: string; siteId: string; publicationKey: string };
  mailboxFactory?: typeof createVisitorRealtimeMailbox;
  onCleanupFailure: () => void;
  onClosed?: () => void;
  retainCleanup?: (work: Promise<void>) => void;
  durationMs?: number;
  idleTimeoutMs?: number;
};

/** The open HTTP body owns the call, so cancellation does not depend on worker affinity. */
export function visitorRealtimeSession(options: VisitorSessionOptions) {
  validateVisitorOffer(options.offer);
  const traceId = options.traceId ?? crypto.randomUUID(), startedAt = performance.now();
  const diagnostic = (stage: 'start' | 'session_answer' | 'control_ready' | 'stop', status: 'started' | 'succeeded' | 'failed' | 'cancelled') => visitorDiagnostic({ traceId, channel: 'server', stage, status, durationMs: performance.now() - startedAt });
  diagnostic('start', 'started');
  const requestProvider = options.fetch ?? fetch;
  const idleTimeoutMs = normalizeLiveIdleTimeoutMs(options.idleTimeoutMs ?? DEFAULT_LIVE_IDLE_TIMEOUT_MS);
  const lifecycle = new AbortController();
  const expiresAt = Date.now() + (options.durationMs ?? VISITOR_SESSION_MS);
  let output: ReadableStreamDefaultController<Uint8Array>;
  let control: ReturnType<typeof createVisitorRealtimeControl> | undefined;
  let mailbox: Awaited<ReturnType<typeof createVisitorRealtimeMailbox>> | undefined;
  let unsubscribe: (() => void) | undefined;
  let mailboxCleanup: Promise<void> | undefined;
  let pendingControl: VisitorControlUpdate | undefined;
  let applying = false, creatingProvider = false;
  let callId: string | undefined;
  let closing = false, streamClosed = false, released = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanup: Promise<void> | undefined;
  let resolveFinished!: () => void;
  const finished = new Promise<void>(resolve => { resolveFinished = resolve; });
  const encoder = new TextEncoder();
  const release = () => { if (!released) { released = true; options.onClosed?.(); resolveFinished(); } };
  const closeStream = () => {
    if (!streamClosed) { streamClosed = true; try { output.close(); } catch {} }
  };
  const emit = (event: VisitorRealtimeEvent) => {
    if (streamClosed || closing) return;
    // An abandoned or stalled browser must not retain an unbounded event queue.
    if ((output.desiredSize ?? 0) < -512_000) { void end(); return; }
    try { output.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); }
    catch { void end(); }
  };
  const hangup = () => {
    if (!callId) return Promise.resolve();
    cleanup ??= (async () => {
      try {
        const result = await requestProvider(liveSessionUrl(callId, 'hangup'), {
          method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}` }, redirect: 'error',
          signal: AbortSignal.timeout(8_000),
        });
        if (!result.ok && result.status !== 404) options.onCleanupFailure();
      } catch { options.onCleanupFailure(); }
    })();
    return cleanup;
  };
  async function end(message?: string, error = false) {
    if (!closing) {
      diagnostic('stop', error ? 'failed' : 'cancelled');
      closing = true;
      clearTimeout(timer); clearTimeout(readinessTimer); clearInterval(heartbeat);
      options.signal.removeEventListener('abort', abort);
      lifecycle.abort();
      unsubscribe?.();
    }
    if (mailbox) mailboxCleanup ??= mailbox.close().catch(() => undefined);
    const finalUsage = await control?.close();
    if (!finalUsage?.finalized) await hangup();
    await mailboxCleanup;
    if (message && !streamClosed) {
      try { output.enqueue(encoder.encode(`${JSON.stringify({ type: error ? 'error' : 'ended', message })}\n`)); } catch {}
    }
    closeStream();
    // Creation may still return a call ID; start() owns its eventual cleanup.
    if (callId) release();
  }
  const abort = () => { void end(); };
  async function applyPendingControl() {
    if (applying || closing || !control) return;
    applying = true;
    try {
      while (pendingControl && !closing) {
        const update = pendingControl;
        pendingControl = undefined;
        await control.applyControl(update);
        if (update.ready) clearTimeout(readinessTimer);
      }
    } catch (error) {
      await end(error instanceof AppError ? error.message : 'The conversation controls were interrupted. You can continue by typing.', true);
    } finally { applying = false; }
  }
  async function start() {
    try {
      if (options.signal.aborted || closing) return;
      mailbox = await (options.mailboxFactory ?? createVisitorRealtimeMailbox)({ ...options.mailbox, expiresAt });
      if (closing || options.signal.aborted) { await end(); return; }
      // Do not abandon an in-flight create on browser cancellation: reclaim its
      // returned call ID even if the browser has already gone away.
      creatingProvider = true;
      // The controller supplies earlier dialogue as reference context. Seeding
      // old user messages as input can make a reconnect replay an unanswered task.
      const voiceConfig = liveSessionConfig();
      const response = await requestProvider('https://api.openai.com/v1/live/sessions', {
        method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: { ...voiceConfig, instructions: `${voiceConfig.instructions} Previous messages are context, not pending requests. When starting or reconnecting, wait silently for fresh user speech unless the application explicitly requests a greeting. Silence is not an instruction to repeat an answer or resume an old task. On new speech, follow the latest request using the current browser view. Do not announce searches, tools, delegation or waiting. Let the backend decide whether published facts, general background or fresh web information are needed, then naturally explain the result.` }, transport: { type: 'webrtc', sdp: options.offer } }),
        redirect: 'error', signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new AppError('The voice service could not start. Please try again later.', 502);
      const payload = await response.json();
      try { callId = liveSessionId(payload?.session?.id); }
      catch { options.onCleanupFailure(); throw new AppError('The voice service returned an incomplete connection.', 502); }
      if (closing || options.signal.aborted) { await end(); return; }
      const answer = payload?.transport?.sdp;
      if (typeof answer !== 'string') throw new AppError('The voice service returned an invalid connection.', 502);
      if (answer.length > 65_536 || !answer.startsWith('v=0') || /(?:^|\r?\n)m=(?!audio )/.test(answer)) {
        throw new AppError('The voice service returned an invalid audio connection.', 502);
      }
      if (closing || options.signal.aborted) { await end(); return; }
      await options.assertCurrent();
      if (closing) return;
      control = (options.controlFactory ?? createVisitorRealtimeControl)({
        traceId, taskSlug: options.mailbox.slug,
        callId, apiKey: options.apiKey, content: options.content, catalog: options.catalog, media: options.media,
        catalogState: options.catalogState, initialAvailability: options.availability,
        context: options.context, history: options.history,
        search: options.search,
        idleTimeoutMs,
        reservationChecksPublication: options.reservationChecksPublication, reserveTurn: options.reserveTurn, assertCurrent: options.assertCurrent, onUsage: options.onUsage, onTiming: options.onTiming,
        emit, onFatal: message => { void end(message); }, signal: lifecycle.signal,
      });
      // Let the browser negotiate audio while the sideband attaches. Input and
      // greeting remain gated by server ready + browser applied readiness.
      emit({ type: 'session', protectOpening: !options.content.visitorSpeaksFirst && !options.history?.length, sdp: answer, availability: options.availability, expiresAt, idleTimeoutMs, control: mailbox.capability });
      diagnostic('session_answer', 'succeeded');
      await control.ready;
      diagnostic('control_ready', 'succeeded');
      if (closing || options.signal.aborted) { await end(); return; }
      unsubscribe = mailbox.subscribe(update => {
        if (closing) return;
        if (update.end) { void end('Voice conversation ended.'); return; }
        control?.observeControl(update);
        pendingControl = update;
        void applyPendingControl();
      }, () => { void end('The conversation controls were interrupted. You can continue by typing.', true); });
      emit({ type: 'ready' });
      heartbeat = setInterval(() => emit({ type: 'ping' }), 5_000);
      readinessTimer = setTimeout(() => { void end('Audio was not ready. You can continue by typing.', true); }, 25_000);
    } catch (error) {
      // A network failure during creation can leave its outcome unknown. Block
      // new calls in this process until cleanup can be investigated.
      if (creatingProvider && !callId && !(error instanceof AppError)) options.onCleanupFailure();
      await end(error instanceof AppError ? error.message : 'The voice connection could not be established.', true);
    } finally {
      if (closing || !callId) { await hangup(); release(); }
    }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      options.signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { void end('This conversation has reached its time limit. Tap the wave to start again.'); }, Math.max(1, expiresAt - Date.now()));
      void start();
      if (options.signal.aborted) void end();
    },
    cancel() { streamClosed = true; return end(); },
  }, { highWaterMark: 64_000, size: chunk => chunk.byteLength });
  options.retainCleanup?.(finished);
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
