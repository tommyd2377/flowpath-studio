import WebSocket from 'ws';
import { PUBLIC_GREETING_INSTRUCTIONS, VOICE_SESSION_SECONDS, voiceSessionConfig, type WaveformPrompt } from './voice-config';
import { isAllowedRequest } from './request-origin';
import { VoiceAdmissionError, type ProductionVoiceStore, type StoredVoice, type VoiceOwner, type VoicePolicy } from './production-voice-store';

type Socket = Pick<WebSocket, 'readyState' | 'send' | 'terminate'> & {
  on(event: 'open' | 'close' | 'error', listener: () => void): unknown;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): unknown;
};
type Finalization = { finalized: boolean; seconds?: number };
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
  publicOrigin?: string;
  trustedProxyHost?: string;
  production?: {
    store: ProductionVoiceStore;
    policy: () => VoicePolicy | null;
    scheduleDeadline: (id: string, expiresAt: number) => Promise<void>;
  };
  resolveWaveform?: (request: Request, id: string) => Promise<{
    ownerUid: string; waveform: WaveformPrompt; accountSessionId?: string; isCurrent: () => boolean | Promise<boolean>;
  } | null>;
  resolvePublicVisitor?: (request: Request) => VoiceOwner | null;
};
type Conversation = {
  id: string;
  apiKey: string;
  canceled: boolean;
  providerId?: string;
  control?: ReturnType<typeof attachControl>;
  timer?: ReturnType<typeof setTimeout>;
  startTimer?: ReturnType<typeof setTimeout>;
  ending?: Promise<boolean>;
  ownerUid?: string;
  waveformId?: string;
  durable?: StoredVoice;
};
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
  socket.on('error', fatal);
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
      if (closing) return;
      if (event.type === 'error') { fatal(); return; }
      if ((event.type === 'session.started' || event.type === 'session.input_audio.append') && !greeted && !session.canceled) {
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
        if (delegation.target !== 'client' || typeof delegation.id !== 'string'
          || !/^[A-Za-z0-9_-]{1,200}$/.test(delegation.id)) throw new Error('Invalid delegation');
        if (handledDelegations.has(delegation.id)) return;
        if (handledDelegations.size >= 64) throw new Error('Too many delegations');
        handledDelegations.add(delegation.id);
        socket.send(JSON.stringify({
          type: 'session.commentary.append', event_id: `flowpath_unavailable_${handledDelegations.size}`,
          delegation_id: delegation.id,
          content: 'That capability is unavailable in this version. No lookup or action was performed. You can continue a conversation using my general knowledge.',
        }));
      }
      // Transcripts and reflected audio are deliberately neither retained nor logged.
    } catch { fatal(); }
  });
  return { ready, closed, close };
}

/** Local fixtures retain their process budget; public sessions require durable admission. */
export function createVoiceServer(options: Options = {}) {
  const enabled = options.enabled ?? (() => process.env.NODE_ENV === 'development' && process.env.FLOWPATH_LIVE_ENABLED === '1');
  const key = options.apiKey ?? (() => process.env.OPENAI_API_KEY);
  const requestProvider = options.requestProvider ?? fetch;
  const now = options.now ?? Date.now;
  const active = new Map<string, Conversation>();
  let blocked = false;
  let starts: number[] = [];
  const maxStarts = options.maxStarts ?? 3;
  let attemptedStarts = 0;
  const recent = new Map<string, number>();
  const cleanupMessage = 'The previous connection could not be confirmed closed. Check the local server before trying again.';
  const budgetMessage = 'This local test has reached its three-conversation limit.';
  const pausedMessage = options.production ? 'Live voice is paused while launch is configured.' : 'Live voice is paused for this local preview.';

  async function scope(request: Request) {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(name => name !== 'waveformId') || params.getAll('waveformId').length > 1) {
      return { error: json({ error: 'Invalid waveform identifier.' }, 400) };
    }
    if (!params.has('waveformId')) {
      // A known visitor can still close an existing conversation after new starts are paused.
      const visitor = options.production ? options.resolvePublicVisitor?.(request) : null;
      return { waveformId: undefined, personal: undefined, visitor: visitor?.kind === 'visitor' ? visitor : undefined };
    }
    const id = params.get('waveformId');
    if (!validId(id)) return { error: json({ error: 'Invalid waveform identifier.' }, 400) };
    try {
      const personal = await options.resolveWaveform?.(request, id);
      if (!personal || !await personal.isCurrent()) return { error: json({ error: 'Sign in as this waveform’s owner to continue.' }, 403) };
      return { waveformId: id, personal, visitor: undefined };
    } catch { return { error: json({ error: 'Your waveform could not be loaded. Try again later.' }, 503) }; }
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
    if (!result?.finalized && session.providerId) {
      // One best-effort fallback. A REST acknowledgment cannot confirm final usage.
      try {
        await requestProvider(providerUrl(session.providerId, 'hangup'), {
          method: 'POST', headers: { Authorization: `Bearer ${session.apiKey}` },
          redirect: 'error', signal: AbortSignal.timeout(5_000),
        });
      } catch { /* Do not retry an uncertain remote teardown. */ }
    }
    if (session.durable) {
      try { await options.production!.store.finish(session.id, { ...(result ?? { finalized: false }), providerId: session.providerId }); }
      catch { /* Its durable reservation remains occupied until confirmed cleanup. */ }
    } else if (!result?.finalized) blocked = true;
    release(session);
    return result?.finalized ?? false;
  }
  function close(session: Conversation) {
    session.canceled = true;
    session.ending ??= performClose(session);
    return session.ending;
  }

  async function closeStored(call: StoredVoice) {
    if (call.state === 'closed' || call.state === 'rejected') return true;
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

  function productionOwner(access: Awaited<ReturnType<typeof scope>>): VoiceOwner | null {
    if (access.visitor) return access.visitor;
    return access.personal?.accountSessionId && access.waveformId ? {
      ownerUid: access.personal.ownerUid, waveformId: access.waveformId, accountSessionId: access.personal.accountSessionId,
    } : null;
  }
  const accessMessage = (access: Awaited<ReturnType<typeof scope>>) => !access.waveformId && options.production?.policy()?.publicDemoSeconds
    ? 'Allow cookies to try the public voice, then tap the waveform again.' : 'Sign in and open your waveform to talk.';
  const failure = (error: unknown) => error instanceof VoiceAdmissionError
    ? json({ error: error.message }, error.status) : json({ error: 'Voice admission is temporarily unavailable.' }, 503);

  return {
    async cancelOwner(ownerUid: string) {
      if (options.production) {
        try { const call = await options.production.store.cancel(ownerUid, undefined); return call ? closeStored(call) : true; }
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
      try { const call = await options.production.store.expire(id); return call ? closeStored(call) : true; }
      catch { return false; }
    },
    async GET(request: Request) {
      if (!isAllowedRequest(request, false, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'This host is not enabled for voice.' }, 403);
      const access = await scope(request);
      if (access.error) return access.error;
      if (options.production && !productionOwner(access)) return json({ enabled: false, message: accessMessage(access) });
      if (!enabled()) return json({ enabled: false, message: pausedMessage });
      if (options.production) {
        const policy = options.production.policy();
        if (!policy) return json({ enabled: false, message: 'Live voice is paused while launch allowances are configured.' });
        if (access.visitor && !policy.publicDemoSeconds) return json({ enabled: false, message: 'Public voice is paused.' });
        try { await options.production.store.available(productionOwner(access)!, policy); }
        catch (error) { return json({ enabled: false, message: error instanceof VoiceAdmissionError ? error.message : 'Voice admission is temporarily unavailable.' }); }
        const configured = Boolean(key());
        return json({ enabled: configured, ...(!configured ? { message: 'The voice connection is not configured.' } : {}) });
      }
      if (blocked) return json({ enabled: false, message: cleanupMessage });
      if (active.size) return json({ enabled: false, message: 'A conversation is already open.' });
      if (attemptedStarts >= maxStarts) return json({ enabled: false, message: budgetMessage });
      return key() ? json({ enabled: true, remainingStarts: maxStarts - attemptedStarts }) : json({ enabled: false, message: 'The voice connection is not configured.' });
    },
    async POST(request: Request) {
      if (!isAllowedRequest(request, true, options.publicOrigin, options.trustedProxyHost)) return json({ error: 'Only same-origin requests are allowed.' }, 403);
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
      const config = voiceSessionConfig(access.personal?.waveform, body.diagnostics === true);
      if (request.signal.aborted || recent.has(reservationKey(body.sessionId, owner?.ownerUid ?? access.personal?.ownerUid, access.waveformId))) return json({ error: 'The conversation was canceled or already used.' }, 409);
      // Auth/store reads and the streamed body can outlive sign-out in another tab.
      // Public admission also rechecks the durable lease inside its reservation transaction.
      if (access.personal && !await access.personal.isCurrent()) return json({ error: 'Sign in as this waveform’s owner to continue.' }, 403);
      // Recheck after reading the body so concurrent tabs cannot reserve two calls.
      if (blocked) return json({ error: cleanupMessage }, 503);
      if (!options.production && active.size) return json({ error: 'A conversation is already open.' }, 409);
      if (!options.production && attemptedStarts >= maxStarts) return json({ error: budgetMessage }, 429);
      starts = starts.filter(time => now() - time < 60_000);
      if (starts.length >= 3) return json({ error: 'Please wait a minute before starting another conversation.' }, 429);
      starts.push(now());
      const session: Conversation = {
        id: body.sessionId, apiKey, canceled: false,
        ownerUid: owner?.ownerUid ?? access.personal?.ownerUid, waveformId: access.waveformId,
      };
      if (options.production) {
        try {
          session.durable = await options.production.store.reserve(owner!, session.id, policy!);
          try { await options.production.scheduleDeadline(session.id, session.durable.expiresAt); }
          catch {
            await options.production.store.finish(session.id, { finalized: true, rejected: true });
            return json({ error: 'The voice deadline could not be scheduled. No conversation was started.' }, 503);
          }
        } catch (error) { return failure(error); }
      }
      active.set(session.id, session);
      const abort = () => { session.canceled = true; if (session.control) void close(session); };
      request.signal.addEventListener('abort', abort, { once: true });
      try {
        if (session.durable && (request.signal.aborted || !await options.production!.store.mayStart(session.id))) {
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
        const expiresAt = session.durable?.expiresAt ?? now() + (options.sessionMs ?? VOICE_SESSION_SECONDS * 1000);
        if (session.durable) {
          const canceled = await options.production!.store.created(session.id, providerId, expiresAt);
          session.canceled ||= canceled;
        }
        session.timer = setTimeout(() => { void close(session); }, Math.max(0, expiresAt - now()));
        session.timer.unref?.();
        session.startTimer = setTimeout(() => { void close(session); }, 30_000);
        session.startTimer.unref?.();
        session.control = attachControl(session, options, () => { void close(session); });
        await session.control.ready;
        void session.control.closed.then(result => {
          if (result.finalized && session.durable) void options.production!.store.finish(session.id, { ...result, providerId: session.providerId }).then(() => release(session)).catch(() => { release(session); });
          else if (result.finalized) release(session);
          else void close(session);
        });
        const canceled = session.canceled || request.signal.aborted || access.personal && !await access.personal.isCurrent();
        if (canceled || !audioSdp(record(payload.transport).sdp)) {
          await close(session);
          return json({ error: canceled ? 'The conversation was canceled.' : 'The voice service returned an invalid connection.' }, canceled ? 409 : 502);
        }
        return json({ sdp: record(payload.transport).sdp, sessionId: session.id, expiresAt }, 201);
      } catch {
        if (session.providerId) await close(session);
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
          const call = await options.production.store.cancel(owner.ownerUid, owner.waveformId, body.sessionId,
            owner.accountSessionId, owner.kind, options.production.policy() ?? undefined);
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
