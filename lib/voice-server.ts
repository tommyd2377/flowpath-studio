import WebSocket from 'ws';
import { PUBLIC_GREETING_INSTRUCTIONS, VOICE_SESSION_SECONDS, voiceSessionConfig, type WaveformPrompt } from './voice-config';
import { isAllowedRequest } from './request-origin';
import { isUnmeteredLocalTest, VoiceAdmissionError, type ProductionVoiceStore, type StoredVoice, type VoiceOwner, type VoicePolicy } from './production-voice-store';
import { CreationSafetyError, creationContentDigest } from './creation-safety';
import { serverAnalytics } from './analytics-runtime';

type Socket = Pick<WebSocket, 'readyState' | 'send' | 'terminate'> & {
  on(event: 'open' | 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): unknown;
};
export type Finalization = { finalized: boolean; seconds?: number };
export type VoiceControl = { ready: Promise<void>; closed: Promise<Finalization>; close(): Promise<Finalization>; dispose(): void };
type Options = {
  enabled?: () => boolean;
  apiKey?: () => string | undefined;
  requestProvider?: typeof fetch;
  socketFactory?: (url: string, options: WebSocket.ClientOptions) => Socket;
  now?: () => number;
  sessionMs?: number;
  closeMs?: number;
  connectMs?: number;
  maxStarts?: number;
  connected?: (id: string) => Promise<void>;
  requireSettlement?: boolean;
  publicOrigin?: string;
  trustedProxyHost?: string;
  /** Hosted recovery only: never rely on a controller continuing after its HTTP response. */
  requestOwnedCleanup?: boolean;
  /** Browser primary controls + short authenticated requests; no orphan server sideband. */
  requestScopedDemo?: boolean;
  authorizeStart?: (request: Request) => Promise<boolean>;
  demoGrant?: (request: Request) => string | undefined;
  greeting?: boolean;
  /** Local lifecycle diagnosis only. Emits fixed fields, never provider messages or identifiers. */
  localRecoveryDiagnostics?: boolean;
  production?: {
    store: ProductionVoiceStore;
    policy: () => VoicePolicy | null;
    scheduleDeadline: (id: string, expiresAt: number) => Promise<void>;
    /** Local unlimited calls keep an independent observer alive across web-server shutdown. */
    supervise?: (id: string, onStarted: () => void) => VoiceControl;
    preCancel?: (owner: VoiceOwner, id: string) => Promise<void>;
    beginConnection?: (owner: VoiceOwner, id: string) => Promise<StoredVoice>;
    confirmConnection?: (id: string) => Promise<{ expiresAt: number }>;
    heartbeat?: (owner: VoiceOwner, id: string, scheduledUntil?: number) => Promise<{ expiresAt: number; controlExpiresAt: number; schedule: boolean }>;
  };
  resolveWaveform?: (request: Request, id: string) => Promise<{
    ownerUid: string; waveform: WaveformPrompt; accountSessionId?: string; isCurrent: () => boolean | Promise<boolean>;
    paid?: VoiceOwner['paid']; publishedRevision?: number; publicVisitor?: VoiceOwner;
  } | null>;
  resolvePublicVisitor?: (request: Request) => VoiceOwner | null | Promise<VoiceOwner | null>;
  resolveAdmin?: (request: Request) => Promise<{ uid: string; accountSessionId?: string; testing?: boolean; isCurrent: () => boolean | Promise<boolean> } | null>;
};
type Conversation = {
  id: string;
  apiKey: string;
  canceled: boolean;
  providerId?: string;
  control?: VoiceControl;
  timer?: ReturnType<typeof setTimeout>;
  startTimer?: ReturnType<typeof setTimeout>;
  ending?: Promise<boolean>;
  ownerUid?: string;
  waveformId?: string;
  durable?: StoredVoice;
  connected?: Promise<void>;
};
export type VoiceControllers = Map<string, Conversation>;
const MAX_BODY_BYTES = 65_536;
const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  && !Array.isArray(value) ? value as Record<string, unknown> : {};
const json = (body: object, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

async function readBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json' || !request.body) throw new Error('Invalid body');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new Error('Invalid body');
  return readJsonStream(request.body, request.signal);
}

async function readJsonStream(body: ReadableStream<Uint8Array> | null, signal?: AbortSignal) {
  if (!body) throw new Error('Invalid body');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 5_000);
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new Error('Invalid body');
      chunks.push(value);
    }
    if (timedOut) throw new Error('Invalid body');
    signal?.throwIfAborted();
    return record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    void reader.cancel().catch(() => undefined);
  }
}

function audioSdp(value: unknown): value is string {
  // The data channel is application media; camera/screen/video tracks are rejected.
  return typeof value === 'string' && value.length <= MAX_BODY_BYTES && value.startsWith('v=0')
    && /(?:^|\r?\n)m=audio /.test(value)
    && !/(?:^|\r?\n)m=(?!audio |application )/.test(value);
}

function providerUrl(id: string, action: 'attach' | 'hangup') {
  return `${action === 'attach' ? 'wss' : 'https'}://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/${action}`;
}

function attachControl(session: Conversation, options: Options, onFatal: () => void) {
  const socket = (options.socketFactory ?? ((url, config) => new WebSocket(url, config)))(
    providerUrl(session.providerId!, 'attach'), {
      headers: { Authorization: `Bearer ${session.apiKey}` },
      handshakeTimeout: options.connectMs ?? 10_000, maxPayload: 262_144,
    },
  );
  let closing = false, finished = false, greeted = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  let resolveClosed!: (result: Finalization) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => undefined);
  const closed = new Promise<Finalization>(resolve => { resolveClosed = resolve; });
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const readyTimer = setTimeout(fatal, options.connectMs ?? 10_000);
  const handledDelegations = new Set<string>();

  function finish(result: Finalization) {
    if (finished) return;
    finished = true;
    clearTimeout(readyTimer); clearTimeout(closeTimer);
    rejectReady(new Error('The voice controller closed.'));
    resolveClosed(result);
    socket.terminate();
  }
  function close() {
    if (!closing && !finished) {
      closing = true;
      if (socket.readyState === WebSocket.OPEN) {
        closeTimer = setTimeout(() => finish({ finalized: false }), options.closeMs ?? 5_000);
        try { socket.send(JSON.stringify({ type: 'session.close' })); }
        catch { finish({ finalized: false }); }
      } else finish({ finalized: false });
    }
    return closed;
  }
  function fatal() {
    if (closing || finished) return;
    rejectReady(new Error('The voice controller failed.'));
    // Defer the owner callback until attachControl has returned its handle.
    queueMicrotask(onFatal);
    void close();
  }
  socket.on('open', () => { clearTimeout(readyTimer); resolveReady(); });
  socket.on('error', error => {
    if (options.localRecoveryDiagnostics) {
      const match = /^Unexpected server response: (\d{3})$/.exec(error.message);
      console.warn('Local voice controller transport failed', { status: match ? Number(match[1]) : null });
    }
    fatal();
  });
  socket.on('close', () => {
    if (finished) return;
    finish({ finalized: false });
    queueMicrotask(onFatal);
  });
  socket.on('message', raw => {
    if (finished) return;
    try {
      const event = record(JSON.parse(raw.toString()));
      if (event.type === 'session.closed') {
        const seconds = record(event.usage).seconds;
        if (record(event.session).id !== session.providerId || typeof seconds !== 'number'
          || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid finalization');
        finish({ finalized: true, seconds });
        return;
      }
      if (closing || session.canceled) return;
      if (event.type === 'error') { fatal(); return; }
      if (event.type === 'session.started' && options.connected && !session.connected) {
        session.connected = options.connected(session.id);
        void session.connected.catch(fatal);
      }
      if ((event.type === 'session.started' || event.type === 'session.input_audio.append') && !greeted && !session.canceled && options.greeting !== false) {
        greeted = true;
        clearTimeout(session.startTimer);
        socket.send(JSON.stringify({
          type: 'session.instructions.append', event_id: 'flowpath_greeting', delegation_id: null,
          content: session.waveformId
            ? 'Greet the visitor now in English using the saved waveform identity and conversational style. Keep it brief, invite them to talk, then pause and listen. Do not claim unavailable capabilities.'
            : PUBLIC_GREETING_INSTRUCTIONS,
        }));
      } else if (event.type === 'session.delegation.created') {
        const delegation = record(event.delegation);
        if (!['client', 'responses'].includes(String(delegation.target)) || typeof delegation.id !== 'string'
          || !/^[A-Za-z0-9_-]{1,200}$/.test(delegation.id)) throw new Error('Invalid delegation');
        if (handledDelegations.has(delegation.id)) return;
        if (handledDelegations.size >= 64) throw new Error('Too many delegations');
        handledDelegations.add(delegation.id);
        // Managed Responses runs and returns its own result; do not replace it with the unavailable-tools reply.
        if (delegation.target === 'responses') return;
        socket.send(JSON.stringify({
          type: 'session.commentary.append', event_id: `flowpath_unavailable_${handledDelegations.size}`,
          delegation_id: delegation.id,
          content: 'That capability is unavailable in this version. No lookup or action was performed. You can continue a conversation using my general knowledge.',
        }));
      }
      if (event.type === 'response.event') {
        const backend = record(event.event);
        const response = record(backend.response);
        if (backend.type === 'error' || backend.type === 'response.failed' || backend.type === 'response.incomplete'
          || backend.type === 'response.completed' && ['failed', 'incomplete'].includes(String(response.status))) fatal();
      }
      // Transcripts and reflected audio are deliberately neither retained nor logged.
    } catch { fatal(); }
  });
  return { ready, closed, close, dispose: () => finish({ finalized: false }) };
}

/** Local fixtures retain their process budget; public sessions require durable admission. */
export function createVoiceServer(options: Options = {}, active: VoiceControllers = new Map()) {
  const enabled = options.enabled ?? (() => process.env.NODE_ENV === 'development' && process.env.FLOWPATH_LIVE_ENABLED === '1');
  const key = options.apiKey ?? (() => process.env.OPENAI_API_KEY);
  const requestProvider = options.requestProvider ?? fetch;
  const now = options.now ?? Date.now;
  let blocked = false;
  let starts: number[] = [];
  const maxStarts = options.maxStarts ?? 3;
  let attemptedStarts = 0;
  const recent = new Map<string, number>();
  const adminWindows = new Map<string, { uid: string; waveformId?: string; deadline: number; closed: boolean }>();
  const cleanupMessage = 'The previous connection could not be confirmed closed. Check the local server before trying again.';
  const budgetMessage = 'This local test has reached its three-conversation limit.';
  const pausedMessage = options.production ? 'Live voice is paused while launch is configured.' : 'Live voice is paused for this local preview.';

  const waveformFailure = (error: unknown) => error instanceof CreationSafetyError
    ? json({ error: error.status === 409 ? 'This saved version needs an approved safety review. Open waveform settings to review this version.' : error.message, reviewRequired: true }, error.status)
    : json({ error: 'Your waveform could not be loaded. Try again later.' }, 503);

  async function scope(request: Request) {
    const params = new URL(request.url).searchParams;
    const demoGrant = options.demoGrant?.(request);
    const override = request.headers.get('X-FlowPath-Admin');
    const previousSessionId = request.headers.get('X-FlowPath-Continue');
    if (override !== null && override !== 'continue' || previousSessionId !== null && (!validId(previousSessionId) || !override)) {
      return { error: json({ error: 'Invalid admin continuation.' }, 400) };
    }
    const identity = await options.resolveAdmin?.(request);
    if (override && (!identity?.testing || !await identity.isCurrent())) return { error: json({ error: 'Enable admin testing in your waveform settings first.' }, 403) };
    if (!options.production && previousSessionId) {
      const previous = adminWindows.get(previousSessionId);
      if (!previous || previous.uid !== identity?.uid || previous.waveformId !== (params.get('waveformId') ?? undefined) || !previous.closed) {
        return { error: json({ error: 'The previous conversation must close before continuing as admin.' }, 409) };
      }
      if (previous.deadline <= now()) return { error: json({ error: 'The overall 15-minute conversation limit has been reached.' }, 429) };
    }
    const admin = identity && await identity.isCurrent() ? { uid: identity.uid, accountSessionId: identity.accountSessionId ?? '',
      override: identity.testing === true, ...(previousSessionId ? { previousSessionId } : {}) } : undefined;
    const preview = params.get('preview');
    if ([...params.keys()].some(name => name !== 'waveformId' && name !== 'preview') || params.getAll('waveformId').length > 1
      || params.getAll('preview').length > 1 || preview !== null && (!params.has('waveformId') || !['draft', 'published'].includes(preview))) {
      return { error: json({ error: 'Invalid waveform identifier.' }, 400) };
    }
    if (!params.has('waveformId')) {
      // A known visitor can still close an existing conversation after new starts are paused.
      const visitor = options.production ? await options.resolvePublicVisitor?.(request) : null;
      return { demoGrant, waveformId: undefined, personal: undefined, visitor: visitor?.kind === 'visitor' ? visitor : undefined, admin, isAdminCurrent: identity?.isCurrent };
    }
    const browserVisitorId = (await options.resolvePublicVisitor?.(request))?.demoVisitorId;
    const id = params.get('waveformId');
    if (!validId(id)) return { error: json({ error: 'Invalid waveform identifier.' }, 400) };
    try {
      const personal = await options.resolveWaveform?.(request, id);
      if (preview === 'draft' && personal?.paid?.preview !== true || preview === 'published' && personal?.publishedRevision === undefined) {
        return { error: json({ error: 'This preview is unavailable.' }, 403) };
      }
      if (!personal || !await personal.isCurrent()) return { error: json({ error: 'Sign in as this waveform’s owner to continue.' }, 403) };
      return { demoGrant, browserVisitorId, waveformId: id, personal, visitor: personal.publicVisitor, admin, isAdminCurrent: identity?.isCurrent };
    } catch (error) { return { error: waveformFailure(error) }; }
  }

  const reservationKey = (id: string, ownerUid?: string, waveformId?: string) => JSON.stringify([ownerUid, waveformId, id]);
  function remember(id: string, ownerUid?: string, waveformId?: string) {
    for (const [known, time] of recent) if (now() - time > 60_000) recent.delete(known);
    recent.set(reservationKey(id, ownerUid, waveformId), now());
    if (recent.size > 128) recent.delete(recent.keys().next().value!);
  }
  function release(session: Conversation) {
    clearTimeout(session.timer);
    clearTimeout(session.startTimer);
    remember(session.id, session.ownerUid, session.waveformId);
    if (active.get(session.id) === session) active.delete(session.id);
  }
  async function performClose(session: Conversation) {
    clearTimeout(session.timer);
    clearTimeout(session.startTimer);
    if (session.durable && session.providerId && !session.control) {
      try {
        session.control = attachControl(session, options, () => { void close(session); });
        await session.control.ready;
      } catch { /* The fallback hangup still runs when sideband attachment fails. */ }
    }
    const result = await session.control?.close();
    const window = adminWindows.get(session.id);
    if (result?.finalized && window) window.closed = true;
    if (!result?.finalized && session.providerId) {
      // One best-effort fallback. A REST acknowledgment cannot confirm final usage.
      try {
        await requestProvider(providerUrl(session.providerId, 'hangup'), {
          method: 'POST', headers: { Authorization: `Bearer ${session.apiKey}` },
          redirect: 'error', signal: AbortSignal.timeout(5_000),
        });
      } catch { /* Do not retry an uncertain remote teardown. */ }
    }
    let settled = true;
    if (session.durable) {
      await session.connected?.catch(() => undefined);
      try { await options.production!.store.finish(session.id, { ...(result ?? { finalized: false }), providerId: session.providerId }); }
      catch { settled = false; /* Its durable reservation remains occupied until confirmed cleanup. */ }
    } else if (!result?.finalized) blocked = true;
    if (result?.finalized && typeof result.seconds === 'number' && Number.isFinite(result.seconds) && result.seconds >= 0) {
      serverAnalytics.record({ eventName: 'usage_observed', properties: { seconds: Math.ceil(result.seconds), evidence: 'provider_confirmed' } });
    }
    release(session);
    return Boolean(result?.finalized && (!options.requireSettlement || settled));
  }
  function close(session: Conversation) {
    session.canceled = true;
    session.ending ??= performClose(session);
    return session.ending;
  }

  async function closeStored(call: StoredVoice, recover = false) {
    if (call.state === 'closed' || call.state === 'rejected') return true;
    if (options.requestOwnedCleanup || recover) {
      // No active-map shortcut: old processes and duplicate tasks are fenced by the database.
      const apiKey = key();
      if (!apiKey || !options.production?.store.claimCleanup) return false;
      const claimed = await options.production.store.claimCleanup(call.id);
      if (!claimed) return false;
      const session: Conversation = { id: claimed.id, apiKey, canceled: true, providerId: claimed.providerId };
      const bounded = (value: number | undefined) => Number.isFinite(value) ? Math.max(1, Math.min(value!, 4_000)) : 4_000;
      const control = attachControl(session, { ...options, connected: undefined,
        connectMs: bounded(options.connectMs), closeMs: bounded(options.closeMs) }, () => {});
      let result: Finalization = { finalized: false };
      try { await control.ready; result = await control.close(); }
      catch { /* Missing transport/finalization leaves durable admission occupied. */ }
      finally { control.dispose(); }
      // There is no documented WebRTC REST hangup guarantee. Never infer final usage from it.
      await options.production.store.finish(claimed.id, { ...result, providerId: claimed.providerId, cleanupEpoch: claimed.cleanup.epoch });
      return result.finalized;
    }
    const existing = active.get(call.id);
    if (existing) { existing.canceled = true; return existing.control ? close(existing) : false; }
    if (!call.providerId) return false;
    const apiKey = key();
    if (!apiKey) return false;
    const session: Conversation = {
      id: call.id, ownerUid: call.ownerUid, waveformId: call.kind === 'visitor' ? undefined : call.waveformId, providerId: call.providerId,
      apiKey, canceled: true, durable: call,
    };
    active.set(session.id, session);
    try {
      session.control = attachControl(session, options, () => { void close(session); });
      await session.control.ready;
      return await close(session);
    } catch { return close(session); }
  }

  async function closeCreatedDemo(session: Conversation) {
    // A provider ID can be known even if its first database write failed. Close
    // that exact ID within this request; never release a hold on an unknown result.
    const canceled = await options.production!.store.cancel(session.ownerUid!, session.waveformId, session.id).catch(() => null);
    if (canceled?.providerId) return closeStored(canceled);
    const control = attachControl(session, { ...options, connected: undefined, connectMs: 4_000, closeMs: 4_000 }, () => {});
    let result: Finalization = { finalized: false };
    try { await control.ready; result = await control.close(); } catch { /* Retain uncertainty. */ }
    finally { control.dispose(); }
    await options.production!.store.finish(session.id, { ...result, providerId: session.providerId }).catch(() => undefined);
    return result.finalized;
  }

  function connectionResponse(session: Conversation, request: Request, firstFrame: object, status = 200) {
          const encoder = new TextEncoder(); let cancel!: () => void;
          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              let resolveStarted!: (value: { expiresAt: number }) => void, rejectStarted!: (error: Error) => void;
              const started = new Promise<{ expiresAt: number }>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
              void started.catch(() => undefined);
              const timeout = setTimeout(() => rejectStarted(new Error('Connection timed out')), 30_000);
              cancel = () => rejectStarted(new Error('Connection canceled'));
              request.signal.addEventListener('abort', cancel, { once: true });
              const control = attachControl(session, { ...options, greeting: false, connected: async id => {
                const meter = await options.production!.confirmConnection!(id); resolveStarted(meter);
              } }, () => rejectStarted(new Error('Connection failed')));
              void control.closed.then(() => rejectStarted(new Error('Connection ended')));
              let complete = false;
              try {
                await control.ready;
                controller.enqueue(encoder.encode(JSON.stringify(firstFrame) + '\n'));
                const meter = await started;
                controller.enqueue(encoder.encode(JSON.stringify(meter) + '\n'));
                complete = true;
              } catch { try { controller.enqueue(encoder.encode(JSON.stringify({ error: 'The voice connection could not be confirmed.' }) + '\n')); } catch { /* Client departed. */ } }
              finally {
                clearTimeout(timeout); request.signal.removeEventListener('abort', cancel); control.dispose();
                if (!complete) await closeCreatedDemo(session).catch(() => undefined);
                try { controller.close(); } catch { /* Client already closed. */ }
              }
            },
            cancel() { cancel?.(); },
          });
          return new Response(stream, { status, headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
  }

  function productionOwner(access: Awaited<ReturnType<typeof scope>>): VoiceOwner | null {
    if (access.visitor) return { ...access.visitor, ...(access.demoGrant ? { demoGrant: access.demoGrant } : {}), ...(!options.requestScopedDemo && access.admin ? { admin: access.admin } : {}) };
    return access.personal?.accountSessionId && access.waveformId ? {
      ownerUid: access.personal.ownerUid, waveformId: access.waveformId, accountSessionId: access.personal.accountSessionId,
      contentDigest: creationContentDigest(access.personal.waveform),
      ...(access.browserVisitorId ? { demoVisitorId: access.browserVisitorId } : {}),
      ...(access.demoGrant ? { demoGrant: access.demoGrant } : {}),
      ...(options.requestScopedDemo ? { tester: { uid: access.personal.ownerUid, accountSessionId: access.personal.accountSessionId, founder: access.admin?.uid === access.personal.ownerUid } } : {}),
      ...(access.personal.publishedRevision !== undefined ? { publishedRevision: access.personal.publishedRevision } : {}),
      ...(access.personal.paid ? { paid: access.personal.paid } : {}),
      ...(!options.requestScopedDemo && access.admin ? { admin: access.admin } : {}),
    } : null;
  }
  const accessMessage = (access: Awaited<ReturnType<typeof scope>>) => !access.waveformId && options.production?.policy()?.publicDemoSeconds
    ? options.requestScopedDemo ? 'Sign in with an invited account to try the introduction.' : 'Allow cookies to try the public voice, then tap the waveform again.' : 'Sign in and open your waveform to talk.';
  const failure = (error: unknown, admin = false) => error instanceof CreationSafetyError ? waveformFailure(error) : error instanceof VoiceAdmissionError
    ? json({ error: error.message, ...(admin && error.normalLimit ? { adminLimit: true } : {}) }, error.status) : json({ error: 'Voice admission is temporarily unavailable.' }, 503);

  const canRecover = (error: unknown, owner: VoiceOwner | null, policy: VoicePolicy | null | undefined) =>
    !options.requestScopedDemo && !options.requestOwnedCleanup && policy?.unmeteredAdminTesting && owner && !owner.kind && !owner.paid
    && error instanceof VoiceAdmissionError && error.recoverable;

  async function recoverBeforeStart(owner: VoiceOwner, signal: AbortSignal) {
    const store = options.production!.store;
    if (!store.previous || !store.reservation) return false;
    let call = await store.previous(owner.ownerUid, owner.waveformId);
    if (!call) return true;
    // A healthy call in another tab is not an orphan. Never end it just for a readiness check/start race.
    const existing = active.get(call.id);
    if (existing && !existing.canceled) throw new VoiceAdmissionError('A conversation is already open in another tab. End that conversation before starting another.');
    call = await store.cancel(owner.ownerUid, owner.waveformId, call.id);
    if (!call) return false;
    // Give the independent observer ownership of finalization. A restart must not
    // race its close with a new attachment that cannot replay the final event.
    for (let attempts = 0; call.cleanup && call.cleanup.until > now() && attempts < 40; attempts++) {
      if (signal.aborted) return false;
      await new Promise(resolve => setTimeout(resolve, 200));
      call = await store.reservation(call.id);
      if (!call) return false;
      if (call.state === 'closed' || call.state === 'rejected') return true;
    }
    if (signal.aborted) return false;
    if (call.state === 'closed' || call.state === 'rejected') return true;
    return existing ? closeStored(call) : closeStored(call, true);
  }

  return {
    async superviseReservation(id: string, onStarted: () => void): Promise<VoiceControl> {
      const store = options.production?.store;
      if (!options.production?.policy()?.unmeteredAdminTesting || !store?.claimSupervision || !store.renewSupervision) throw new Error('Local supervision is unavailable');
      const call = await store.claimSupervision(id);
      const apiKey = key();
      if (!call || !apiKey) throw new Error('Local supervision could not be claimed');
      const session: Conversation = { id, apiKey, canceled: false, providerId: call.providerId, waveformId: call.waveformId };
      const control = attachControl(session, { ...options, connected: async () => onStarted() }, () => {});
      let renewing = false;
      const timer = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void store.renewSupervision!(id, call.cleanup.epoch).then(keep => { if (!keep) void control.close(); }, () => { void control.close(); }).finally(() => { renewing = false; });
      }, 5_000);
      const closed = control.closed.then(async result => {
        clearInterval(timer);
        try { await store.finish(id, { ...result, providerId: call.providerId, cleanupEpoch: call.cleanup.epoch }); return result; }
        catch { return { finalized: false }; }
      });
      return { ready: control.ready, closed, close: () => { void control.close(); return closed; }, dispose: control.dispose };
    },
    async cancelReservation(id: string, ownerUid: string, waveformId: string) {
      if (!options.production || !validId(id)) return false;
      try { const call = await options.production.store.cancel(ownerUid, waveformId, id); return call ? await closeStored(call) : true; }
      catch { return false; }
    },
    async cancelOwner(ownerUid: string) {
      if (options.production) {
        try { const call = await options.production.store.cancel(ownerUid, undefined); return call ? await closeStored(call) : true; }
        catch { return false; }
      }
      const session = [...active.values()].find(call => call.ownerUid === ownerUid);
      if (!session) return !blocked;
      if (session.ownerUid !== ownerUid) return true;
      session.canceled = true;
      // Keep the old account cookie while a late provider creation still needs teardown.
      if (!session.control) return false;
      return close(session);
    },
    async expireReservation(id: string) {
      if (!options.production || !validId(id)) return false;
      try { const call = await options.production.store.expire(id); return call ? await closeStored(call) : true; }
      catch { return false; }
    },
    async GET(request: Request) {
      if (!isAllowedRequest(request, false, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'This host is not enabled for voice.' }, 403);
      if (options.authorizeStart && !await options.authorizeStart(request)) return json({ enabled: false, message: 'Enter the demo code to talk.' });
      const access = await scope(request);
      if (access.error) return access.error;
      if (options.production && !productionOwner(access)) return json({ enabled: false, message: accessMessage(access) });
      if (!enabled()) return json({ enabled: false, message: pausedMessage });
      if (options.production) {
        const policy = options.production.policy();
        if (!policy) return json({ enabled: false, message: 'Live voice is paused while launch allowances are configured.' });
        if (access.visitor && !policy.publicDemoSeconds) return json({ enabled: false, message: 'Public voice is paused.' });
        try { await options.production.store.available(productionOwner(access)!, policy); }
        catch (error) { if (error instanceof CreationSafetyError) return waveformFailure(error);
          // GET stays read-only. The deliberate, authenticated POST closes an orphan before reserving once.
          if (canRecover(error, productionOwner(access), policy)) {
            try {
              const previous = await options.production.store.previous?.(productionOwner(access)!.ownerUid, access.waveformId!);
              if (options.localRecoveryDiagnostics) console.info('Local voice recovery readiness', {
                state: previous?.state ?? 'missing', providerKnown: !!previous?.providerId,
                cleanupBusy: !!previous?.cleanup && previous.cleanup.until > now(),
                olderThan15Minutes: !!previous && previous.createdAt < now() - 900_000,
              });
              const controller = previous && active.get(previous.id);
              if (controller && !controller.canceled) return json({ enabled: false, message: 'A conversation is already open in another tab. End that conversation before starting another.' });
              return json({ enabled: Boolean(key()), ...(access.admin ? { adminEligible: true } : {}) });
            } catch { return json({ enabled: false, message: 'The previous conversation record could not be verified.' }); }
          }
          return json({ enabled: false, message: error instanceof VoiceAdmissionError ? error.message : 'Voice admission is temporarily unavailable.',
          ...(error instanceof VoiceAdmissionError && error.normalLimit && access.admin && !access.admin.override ? { adminLimit: true } : {}) }); }
        const configured = Boolean(key());
        return json({ enabled: configured, ...((options.requestScopedDemo ? productionOwner(access)?.tester?.founder : access.admin) ? { adminEligible: true } : {}), ...(!configured ? { message: 'The voice connection is not configured.' } : {}) });
      }
      if (blocked) return json({ enabled: false, message: cleanupMessage });
      if (active.size) return json({ enabled: false, message: 'A conversation is already open.' });
      if (attemptedStarts >= maxStarts) return json({ enabled: false, message: budgetMessage });
      return key() ? json({ enabled: true, ...(access.admin ? { adminEligible: true } : {}), remainingStarts: maxStarts - attemptedStarts }) : json({ enabled: false, message: 'The voice connection is not configured.' });
    },
    async POST(request: Request) {
      if (!isAllowedRequest(request, true, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
      if (options.authorizeStart && !await options.authorizeStart(request)) return json({ error: 'Enter the demo code first.' }, 403);
      if (options.requestScopedDemo && !request.headers.get('accept')?.includes('application/x-ndjson')) return json({ error: 'Refresh this page before starting the updated voice demo.' }, 409);
      const access = await scope(request);
      if (access.error) return access.error;
      const owner = productionOwner(access);
      if (options.production && !owner) return json({ error: accessMessage(access) }, 403);
      if (!enabled()) return json({ error: pausedMessage }, 503);
      if (blocked) return json({ error: cleanupMessage }, 503);
      const policy = options.production?.policy();
      if (options.production && !policy) return json({ error: 'Live voice is paused while launch allowances are configured.' }, 503);
      if (access.visitor && !policy?.publicDemoSeconds) return json({ error: 'Public voice is paused.' }, 503);
      if (!options.production && attemptedStarts >= maxStarts) return json({ error: budgetMessage }, 429);
      const apiKey = key();
      if (!apiKey) return json({ error: 'The voice connection is not configured.' }, 503);
      let body: Record<string, unknown>;
      try { body = await readBody(request); }
      catch { return json({ error: 'Invalid audio connection request.' }, 400); }
      if (Object.keys(body).some(name => name !== 'sdp' && name !== 'sessionId' && name !== 'diagnostics')
        || (body.diagnostics !== undefined && typeof body.diagnostics !== 'boolean')
        || !validId(body.sessionId) || !audioSdp(body.sdp)) return json({ error: 'Invalid audio connection request.' }, 400);
      // The explicit browser opt-in only widens its event subscription. Nothing is retained here.
      // Snapshot saved instructions once. Edits only affect subsequent conversations.
      const config = voiceSessionConfig(access.personal?.waveform, body.diagnostics === true, options.requestScopedDemo);
      if (request.signal.aborted || recent.has(reservationKey(body.sessionId, owner?.ownerUid ?? access.personal?.ownerUid, access.waveformId))) return json({ error: 'The conversation was canceled or already used.' }, 409);
      // Auth/store reads and the streamed body can outlive sign-out in another tab.
      // Public admission also rechecks the durable lease inside its reservation transaction.
      try {
        if (access.admin && !await access.isAdminCurrent?.()) return json({ error: 'Sign in again to continue as admin.' }, 403);
        if (access.personal && !await access.personal.isCurrent()) return json({ error: 'Sign in as this waveform’s owner to continue.' }, 403);
      } catch (error) { return waveformFailure(error); }
      // Recheck after reading the body so concurrent tabs cannot reserve two calls.
      if (blocked) return json({ error: cleanupMessage }, 503);
      if (!options.production && active.size) return json({ error: 'A conversation is already open.' }, 409);
      if (!options.production && attemptedStarts >= maxStarts) return json({ error: budgetMessage }, 429);
      starts = starts.filter(time => now() - time < 60_000);
      if (starts.length >= 3 && !(owner && policy && isUnmeteredLocalTest(owner, policy))) return json({ error: 'Please wait a minute before starting another conversation.' }, 429);
      starts.push(now());
      const session: Conversation = {
        id: body.sessionId, apiKey, canceled: false,
        ownerUid: owner?.ownerUid ?? access.personal?.ownerUid, waveformId: access.waveformId,
      };
      if (options.production) {
        try {
          try { session.durable = await options.production.store.reserve(owner!, session.id, policy!); }
          catch (error) {
            if (!canRecover(error, owner, policy)) throw error;
            if (!await recoverBeforeStart(owner!, request.signal)) throw new VoiceAdmissionError('The previous voice connection could not be confirmed closed. No new conversation was started.', 503);
            if (request.signal.aborted) return json({ error: 'The conversation was canceled.' }, 409);
            session.durable = await options.production.store.reserve(owner!, session.id, policy!);
          }
          try { if (!session.durable.admin?.unmeteredLocal) await options.production.scheduleDeadline(session.id, session.durable.controlExpiresAt ?? session.durable.expiresAt); }
          catch {
            await options.production.store.finish(session.id, { finalized: true, rejected: true });
            return json({ error: 'The voice deadline could not be scheduled. No conversation was started.' }, 503);
          }
        } catch (error) { return failure(error, access.admin?.override === false); }
      }
      active.set(session.id, session);
      const abort = () => { session.canceled = true; if (session.control) void close(session); };
      request.signal.addEventListener('abort', abort, { once: true });
      try {
        let mayStart = !request.signal.aborted;
        if (session.durable && mayStart) {
          try { mayStart = await options.production!.store.mayStart(session.id); }
          catch { mayStart = false; /* No provider request has been attempted, so this is not remote uncertainty. */ }
        }
        if (session.durable && !mayStart) {
          await options.production!.store.finish(session.id, { finalized: true, rejected: true });
          release(session);
          return json({ error: 'The conversation was canceled.' }, 409);
        }
        attemptedStarts++;
        // Do not cancel this fetch when the browser cancels: its late ID is needed for teardown.
        const response = await requestProvider('https://api.openai.com/v1/live/sessions', {
          method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: config, transport: { type: 'webrtc', sdp: body.sdp } }),
          redirect: 'error', signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const failure = record(record(await readJsonStream(response.body).catch(() => ({}))).error);
          const fields = Object.fromEntries(['code', 'type', 'param'].flatMap(name => {
            const value = failure[name];
            return typeof value === 'string' && /^[a-z][a-z0-9_.\[\]]{0,79}$/i.test(value) ? [[name, value]] : [];
          }));
          // Never log free-form provider messages, keys, prompts or audio.
          console.warn('Voice session creation rejected', { status: response.status, ...fields });
          if (session.durable) await options.production!.store.finish(session.id, { finalized: response.status >= 400 && response.status < 500, rejected: true });
          else if (response.status >= 500) blocked = true;
          release(session);
          return json({ error: 'The voice service could not start. No automatic retry was attempted.' }, response.status === 429 ? 429 : 502);
        }
        const payload = await readJsonStream(response.body);
        const providerId = record(payload.session).id;
        if (typeof providerId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(providerId)) throw new Error('Missing provider ID');
        session.providerId = providerId;
        const previousWindow = access.admin?.previousSessionId ? adminWindows.get(access.admin.previousSessionId) : undefined;
        const expiresAt = session.durable?.expiresAt ?? previousWindow?.deadline ?? now() + (options.sessionMs ?? VOICE_SESSION_SECONDS * 1000);
        if (access.admin && !options.production) {
          for (const [id, window] of adminWindows) if (window.deadline <= now()) adminWindows.delete(id);
          adminWindows.set(session.id, { uid: access.admin.uid, waveformId: access.waveformId, deadline: expiresAt, closed: false });
        }
        if (session.durable) {
          const canceled = await options.production!.store.created(session.id, providerId, expiresAt);
          session.canceled ||= canceled;
        }
        if (options.requestScopedDemo) {
          if (!options.production?.beginConnection) throw new Error('Voice supervision is unavailable');
          // The provider primary/data channel owns greeting and local tools. No
          // socket or timer is left running after this request returns.
          if (session.canceled || request.signal.aborted || access.personal && !await access.personal.isCurrent()
            || !audioSdp(record(payload.transport).sdp)) {
            await closeCreatedDemo(session);
            release(session);
            return json({ error: 'The conversation was canceled.' }, 409);
          }
          await options.production.beginConnection(owner!, session.id);
          release(session);
          // SDP is not released until the request-owned observer is attached.
          return connectionResponse(session, request, { sdp: record(payload.transport).sdp, sessionId: session.id, expiresAt,
            browserControl: true, heartbeatMs: 10_000,
            adminOverride: owner?.tester?.founder === true, adminEligible: owner?.tester?.founder === true }, 201);
        }
        if (!session.durable?.admin?.unmeteredLocal) {
          session.timer = setTimeout(() => { void close(session); }, Math.max(0, expiresAt - now()));
          session.timer.unref?.();
        }
        session.startTimer = setTimeout(() => { void close(session); }, 30_000);
        session.startTimer.unref?.();
        session.control = session.durable?.admin?.unmeteredLocal && options.production?.supervise
          ? options.production.supervise(session.id, () => { clearTimeout(session.startTimer); })
          : attachControl(session, options, () => { void close(session); });
        await session.control.ready;
        void session.control.closed.then(async result => {
          await session.connected?.catch(() => undefined);
          const window = adminWindows.get(session.id);
          if (result.finalized && window) window.closed = true;
          if (result.finalized && session.durable) void options.production!.store.finish(session.id, { ...result, providerId: session.providerId }).then(() => release(session)).catch(() => { release(session); });
          else if (result.finalized) release(session);
          else void close(session);
        });
        const canceled = session.canceled || request.signal.aborted || access.admin && !await access.isAdminCurrent?.() || access.personal && !await access.personal.isCurrent();
        if (canceled || !audioSdp(record(payload.transport).sdp)) {
          await close(session);
          return json({ error: canceled ? 'The conversation was canceled.' : 'The voice service returned an invalid connection.' }, canceled ? 409 : 502);
        }
        return json({ sdp: record(payload.transport).sdp, sessionId: session.id, expiresAt,
          ...(access.admin ? { adminEligible: true, adminOverride: access.admin.override, adminDeadline: session.durable?.admin?.deadline ?? expiresAt } : {}) }, 201);
      } catch {
        if (session.providerId && options.requestScopedDemo && session.durable) {
          await closeCreatedDemo(session).catch(() => undefined);
          release(session);
        } else if (session.providerId) await close(session);
        else {
          if (session.durable) await options.production!.store.finish(session.id, { finalized: false }).catch(() => undefined);
          else blocked = true;
          release(session);
        }
        return json({ error: options.production ? 'The voice connection could not be confirmed. No automatic retry was attempted.'
          : 'The voice connection could not be confirmed. Check the local server before trying again.' }, 502);
      } finally {
        request.signal.removeEventListener('abort', abort);
      }
    },
    async PATCH(request: Request) {
      if (!isAllowedRequest(request, true, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
      if (!options.requestScopedDemo || !options.production?.heartbeat) return json({ error: 'Voice supervision is unavailable.' }, 503);
      const access = await scope(request);
      if (access.error) return access.error;
      const owner = productionOwner(access);
      if (!owner) return json({ error: 'Sign in with an invited account.' }, 403);
      try {
        const body = await readBody(request);
        if (!validId(body.sessionId) || Object.keys(body).some(key => !['sessionId', 'connect'].includes(key)) || body.connect !== undefined && body.connect !== true) return json({ error: 'Invalid conversation identifier.' }, 400);
        if (options.authorizeStart && !await options.authorizeStart(request)) return json({ error: 'Enter the demo code first.' }, 403);
        if (body.connect === true) {
          if (!options.production.beginConnection || !options.production.confirmConnection || !key()) return json({ error: 'Connection confirmation is unavailable.' }, 503);
          const call = await options.production.beginConnection(owner, body.sessionId);
          const session: Conversation = { id: call.id, apiKey: key()!, providerId: call.providerId, ownerUid: call.ownerUid, waveformId: call.waveformId, durable: call, canceled: false };
          return connectionResponse(session, request, { ready: true });
        }
        const lease = await options.production.heartbeat(owner, body.sessionId);
        if (lease.schedule) {
          await options.production.scheduleDeadline(body.sessionId, lease.controlExpiresAt);
          await options.production.heartbeat(owner, body.sessionId, lease.controlExpiresAt);
        }
        return json({ expiresAt: lease.expiresAt });
      } catch (error) { return failure(error); }
    },
    async DELETE(request: Request) {
      if (!isAllowedRequest(request, true, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
      const access = await scope(request);
      if (access.error) return access.error;
      let body: Record<string, unknown>;
      try { body = await readBody(request); }
      catch { return json({ error: 'Invalid conversation identifier.' }, 400); }
      if (!validId(body.sessionId) || Object.keys(body).some(name => name !== 'sessionId')) return json({ error: 'Invalid conversation identifier.' }, 400);
      if (options.production) {
        const owner = productionOwner(access);
        if (!owner) return json({ error: accessMessage(access) }, 403);
        try {
          if (options.production.preCancel && (!options.authorizeStart || await options.authorizeStart(request))) await options.production.preCancel(owner, body.sessionId);
          const call = await options.production.store.cancel(owner.ownerUid, owner.waveformId, body.sessionId,
            owner.accountSessionId, owner.kind, options.production.policy() ?? undefined, owner.demoVisitorId);
          const finalized = call ? await closeStored(call) : true;
          return finalized ? json({ closed: true }) : json({ closed: false, pending: true }, 202);
        } catch (error) { return failure(error); }
      }
      const session = active.get(body.sessionId);
      if (session && (session.ownerUid !== access.personal?.ownerUid || session.waveformId !== access.waveformId)) {
        return json({ error: 'This conversation belongs to another waveform.' }, 403);
      }
      remember(body.sessionId, access.personal?.ownerUid, access.waveformId);
      if (!session) return json({ closed: true });
      session.canceled = true;
      // Creation is still running: POST receives its ID and closes it before returning.
      if (!session.control) return json({ closed: false, pending: true }, 202);
      const finalized = await close(session);
      return finalized ? json({ closed: true }) : json({ closed: false, error: cleanupMessage }, 503);
    },
  };
}
