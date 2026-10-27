'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '@/components/Waveform';
import { voiceConnectionReader } from './voice-connection';
import { PUBLIC_GREETING_INSTRUCTIONS } from './voice-config';
import { monitorAudio, waitForIce } from './voice-session';
import { createVoiceDiagnostics, type VoiceDiagnosticFinishReason } from './voice-diagnostics';
import { createLiveTextSession, type LiveTextState } from './live-text-session';

type VoiceSession = {
  id: string;
  endpoint: string;
  headers: Record<string, string>;
  controller: AbortController;
  requested: boolean;
  ready: boolean;
  answerApplied: boolean;
  started: boolean;
  finalized: boolean;
  needsAudioResume: boolean;
  heardOutput?: boolean;
  lastActivity: number;
  expiresAt?: number;
  adminEligible?: boolean;
  adminOverride?: boolean;
  adminDeadline?: number;
  browserControl?: boolean;
  controlConfirmed?: boolean;
  handledDelegations?: Set<string>;
  heartbeat?: ReturnType<typeof setTimeout>;
  admissionLimit?: boolean;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  microphone?: MediaStream;
  audio?: HTMLAudioElement;
  context?: AudioContext;
  output?: AnalyserNode;
  stopMonitor?: () => void;
  setupTimer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  tick?: ReturnType<typeof setInterval>;
  closePromise?: Promise<boolean>;
  acknowledgeClose?: () => void;
  released?: boolean;
  diagnostic?: ReturnType<typeof createVoiceDiagnostics>;
  text?: ReturnType<typeof createLiveTextSession>;
};

async function deleteSession(id: string, endpoint: string, requestHeaders: Record<string, string>) {
  try {
    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: { ...requestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
      keepalive: true,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 204) return !endpoint.includes('/paid-session');
    return response.ok && (await response.json()).closed === true;
  } catch { return false; }
}

async function errorMessage(response: Response, session?: VoiceSession) {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && session && 'adminLimit' in body && body.adminLimit === true) session.admissionLimit = true;
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  } catch { /* A gateway can return a non-JSON failure. */ }
  return 'The voice connection is unavailable. Tap the wave to try again.';
}

function releaseMedia(session: VoiceSession) {
  if (session.released) return;
  session.released = true;
  if (session.audio) session.audio.srcObject = null;
  session.channel?.close();
  session.peer?.close();
  if (session.context?.state !== 'closed') void session.context?.close().catch(() => {});
}

function dispose(session: VoiceSession, leaving = false): Promise<boolean> {
  session.text?.finish();
  if (session.closePromise) {
    if (leaving) {
      if (session.requested) void deleteSession(session.id, session.endpoint, session.headers);
      releaseMedia(session);
    }
    return session.closePromise;
  }
  session.controller.abort();
  clearTimeout(session.setupTimer);
  clearTimeout(session.disconnectTimer);
  clearInterval(session.tick);
  clearTimeout(session.heartbeat);
  session.stopMonitor?.();
  // End capture immediately, while the event connection can finish its close.
  session.microphone?.getTracks().forEach(track => { track.onended = null; track.enabled = false; track.stop(); });
  if (session.audio) { session.audio.muted = true; session.audio.pause(); }

  if (leaving) {
    if (!session.browserControl && session.ready && session.channel?.readyState === 'open') {
      try { session.channel.send(JSON.stringify({ type: 'session.close' })); } catch { /* Server closes below. */ }
    }
    session.closePromise = session.requested ? deleteSession(session.id, session.endpoint, session.headers) : Promise.resolve(true);
    releaseMedia(session);
    return session.closePromise;
  }

  session.closePromise = (async () => {
    let finalized = session.finalized;
    if (!session.browserControl && !finalized && session.ready && session.channel?.readyState === 'open' && !leaving) {
      finalized = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 15_000);
        session.acknowledgeClose = () => { clearTimeout(timer); resolve(true); };
        try { session.channel!.send(JSON.stringify({ type: 'session.close' })); }
        catch { clearTimeout(timer); resolve(false); }
      });
    }
    const serverClosed = session.requested ? await deleteSession(session.id, session.endpoint, session.headers) : true;
    return session.endpoint.includes('/paid-session') || session.browserControl ? serverClosed : finalized || serverClosed;
  })().finally(() => releaseMedia(session));
  return session.closePromise;
}

const emptyTextState = (): LiveTextState => ({ text: '', writing: false, visible: false, canUndo: false, message: '' });

export function useVoiceSession(waveformId?: string, paidPayer?: 'creator' | 'self', textBoxEnabled = false, draftPreview = false, publishedPreview = false) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const [needsAudioResume, setNeedsAudioResume] = useState(false);
  const [hasDiagnostic, setHasDiagnostic] = useState(false);
  const [diagnosticRecording, setDiagnosticRecording] = useState(false);
  const [diagnosticVersion, setDiagnosticVersion] = useState(0);
  const [settledVersion, setSettledVersion] = useState(0);
  const [textState, setTextState] = useState<LiveTextState>(emptyTextState);
  const textController = useRef<ReturnType<typeof createLiveTextSession> | null>(null);
  const diagnostic = useRef<ReturnType<typeof createVoiceDiagnostics> | null>(null);
  const current = useRef<VoiceSession | null>(null);
  const closing = useRef<Promise<boolean> | null>(null);
  const closingSession = useRef<VoiceSession | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);
  const publicDemoId = useRef<string | null>(null);

  const stop = useCallback((notice = '', reason: VoiceDiagnosticFinishReason = 'user_stop') => {
    const session = current.current;
    if (!session) return;
    current.current = null;
    const stoppedRevision = ++revision.current;
    session.diagnostic?.lifecycle('stopping');
    const promise = dispose(session);
    closing.current = promise;
    closingSession.current = session;
    if (mounted.current) {
      setActive(false);
      setNeedsAudioResume(false);
      setPhase('idle');
      setStatus(session.requested ? 'Finishing the conversation…' : notice);
      setRemainingSeconds(null);
      setInputAnalyser(null);
      setOutputAnalyser(null);
    }
    void promise.then(closed => {
      session.diagnostic?.lifecycle('ended');
      session.diagnostic?.finish(reason);
      if (closing.current === promise) { closing.current = null; closingSession.current = null; }
      if (!mounted.current || revision.current !== stoppedRevision) return;
      setDiagnosticRecording(false);
      if (closed) {
        setStatus(notice);
        // Keep startup errors visible instead of remounting the prepaid gate in a loop.
        if (reason !== 'connection_error') setSettledVersion(value => value + 1);
      }
      else {
        setPhase('error');
        setStatus('Your microphone is off, but disconnection could not be confirmed. Wait for the session limit before reconnecting.');
      }
    });
  }, []);

  const fail = useCallback((session: VoiceSession, notice: string) => {
    if (current.current !== session) return;
    session.diagnostic?.lifecycle('error');
    stop(notice, 'connection_error');
    if (mounted.current) { setPhase('error'); setStatus(notice); }
  }, [stop]);

  const start = useCallback(async (recordDiagnostics = false) => {
    if (closing.current) return;
    const existing = current.current;
    if (existing) {
      if (!existing.needsAudioResume || !existing.audio || !existing.context) return;
      try {
        // Called directly from the waveform click to recover a browser gesture.
        await Promise.all([existing.context.resume(), existing.audio.play()]);
        if (current.current !== existing) return;
        existing.needsAudioResume = false;
        setNeedsAudioResume(false);
        setStatus(existing.heardOutput ? '' : existing.ready ? 'Getting ready…' : 'Connecting…');
      } catch { setStatus('Playback is still blocked. Tap the wave to resume audio.'); }
      return;
    }

    // Consent is for this conversation only; a new attempt replaces any previous local report.
    diagnostic.current?.clear();
    diagnostic.current = recordDiagnostics ? createVoiceDiagnostics({ surface: waveformId ? 'personal' : 'public' }) : null;
    setHasDiagnostic(Boolean(diagnostic.current));
    setDiagnosticRecording(Boolean(diagnostic.current));
    setDiagnosticVersion(value => value + 1);
    if (!waveformId) publicDemoId.current ??= crypto.randomUUID();
    const session: VoiceSession = {
      id: crypto.randomUUID(), endpoint: waveformId ? `/api/${paidPayer ? 'paid-session' : 'session'}?waveformId=${encodeURIComponent(waveformId)}${paidPayer && draftPreview ? '&preview=draft' : publishedPreview && !paidPayer ? '&preview=published' : ''}` : '/api/session',
      headers: waveformId ? paidPayer ? { 'X-FlowPath-Payer': paidPayer } : {} : { 'X-FlowPath-Demo': publicDemoId.current! },
      controller: new AbortController(), requested: false,
      ready: false, started: false, answerApplied: false, finalized: false,
      needsAudioResume: false, lastActivity: Date.now(),
      diagnostic: diagnostic.current ?? undefined,
    };
    textController.current?.finish();
    textController.current = null;
    setTextState(emptyTextState());
    if (textBoxEnabled || waveformId && !paidPayer && !publishedPreview) {
      const controller = createLiveTextSession({
        textEnabled: textBoxEnabled,
        ...(!paidPayer && waveformId && !publishedPreview ? { searchKnowledge: async (query: string, signal: AbortSignal) => {
          const response = await fetch('/api/knowledge/search', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ waveformId, query }),
            signal: AbortSignal.any([signal, session.controller.signal, AbortSignal.timeout(30_000)]) });
          if (!response.ok) throw new Error('Knowledge search was unavailable.');
          return response.json();
        } } : {}),
        onChange: state => { if (mounted.current && session.text && textController.current === session.text) setTextState(state); },
        send: event => {
          if (current.current === session && !session.controller.signal.aborted && session.channel?.readyState === 'open') {
            session.channel.send(JSON.stringify(event));
          }
        },
      });
      session.text = controller;
      textController.current = controller;
    }
    session.diagnostic?.lifecycle('connecting');
    current.current = session;
    revision.current++;
    setActive(true);
    setPhase('connecting');
    setStatus('Connecting…');
    const alive = () => mounted.current && current.current === session;
    const becomeReady = () => {
      if (!alive() || session.ready || !session.started || !session.answerApplied || session.browserControl && !session.controlConfirmed) return;
      session.ready = true;
      session.diagnostic?.lifecycle('connected');
      session.lastActivity = Date.now();
      clearTimeout(session.setupTimer);
      setPhase('listening');
      if (!session.needsAudioResume) setStatus('Getting ready…');
    };

    try {
      const readReadiness = () => fetch(session.endpoint, { headers: session.headers, cache: 'no-store', signal: session.controller.signal });
      // Let the first public Set-Cookie settle before another tab checks readiness.
      const readiness = !waveformId && navigator.locks?.request
        ? await navigator.locks.request('flowpath-public-voice-identity', { signal: session.controller.signal }, readReadiness)
        : await readReadiness();
      if (!readiness.ok) throw new Error(await errorMessage(readiness, session));
      const config: unknown = await readiness.json();
      if (!alive()) return;
      if (config && typeof config === 'object') {
        session.adminEligible = 'adminEligible' in config && config.adminEligible === true;
        session.admissionLimit = 'adminLimit' in config && config.adminLimit === true;
      }
      if (!config || typeof config !== 'object' || !('enabled' in config) || config.enabled !== true) {
        const message = config && typeof config === 'object' && 'message' in config && typeof config.message === 'string'
          ? config.message : 'Voice is disabled for this local preview.';
        stop(message, 'connection_error');
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) {
        throw new Error('This browser cannot start voice. Try a current browser on localhost or HTTPS.');
      }
      session.setupTimer = setTimeout(() => fail(session, 'The connection took too long. Tap the wave to try again.'), 30_000);
      session.context = new AudioContext();
      await session.context.resume();
      if (!alive()) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.microphone = stream;
      for (const track of stream.getAudioTracks()) track.onended = () => fail(session, 'Microphone access ended. Tap the wave to reconnect.');
      const input = session.context.createAnalyser();
      input.fftSize = 2048;
      session.context.createMediaStreamSource(stream).connect(input);
      setInputAnalyser(input);
      const peer = new RTCPeerConnection();
      session.peer = peer;
      session.audio = new Audio();
      session.audio.autoplay = true;
      session.audio.setAttribute('playsinline', '');
      peer.ontrack = event => {
        if (!alive() || !session.context || !session.audio) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        session.audio.srcObject = remote;
        const output = session.context.createAnalyser();
        output.fftSize = 2048;
        const silent = session.context.createGain();
        silent.gain.value = 0;
        session.context.createMediaStreamSource(remote).connect(output);
        output.connect(silent).connect(session.context.destination);
        session.output = output;
        setOutputAnalyser(output);
        void session.audio.play().catch(() => {
          if (!alive()) return;
          session.needsAudioResume = true;
          setNeedsAudioResume(true);
          setStatus('Tap the wave to resume audio playback.');
        });
      };
      peer.onconnectionstatechange = () => {
        if (!alive()) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          fail(session, 'The conversation disconnected. Tap the wave to reconnect.');
        } else if (peer.connectionState === 'disconnected') {
          clearTimeout(session.disconnectTimer);
          session.disconnectTimer = setTimeout(() => fail(session, 'The connection was lost. Tap the wave to reconnect.'), 5_000);
        } else if (peer.connectionState === 'connected') clearTimeout(session.disconnectTimer);
      };
      const channel = peer.createDataChannel('oai-events');
      session.channel = channel;
      channel.onmessage = ({ data }) => {
        if (typeof data !== 'string' || data.length > 65_536) return;
        let event: unknown;
        try { event = JSON.parse(data); } catch { return; }
        session.diagnostic?.providerEvent(event);
        if (alive()) {
          try { session.text?.event(event); }
          catch { fail(session, 'The text connection encountered an error. Tap the wave to reconnect.'); return; }
        }
        if (!event || typeof event !== 'object' || !('type' in event)) return;
        if (event.type === 'session.closed') {
          session.finalized = true;
          session.acknowledgeClose?.();
          if (alive()) stop('Conversation ended.', 'session_closed');
        } else if (alive() && event.type === 'session.started') {
          const firstStart = !session.started;
          session.started = true;
          if (firstStart && session.browserControl && session.controlConfirmed) channel.send(JSON.stringify({ type: 'session.instructions.append', event_id: 'flowpath_greeting', delegation_id: null,
            content: waveformId ? 'Greet the visitor now in English using the saved waveform identity and conversational style. Keep it brief, invite them to talk, then pause and listen. Do not claim unavailable capabilities.' : PUBLIC_GREETING_INSTRUCTIONS }));
          becomeReady();
        } else if (alive() && session.browserControl && event.type === 'session.delegation.created' && 'delegation' in event) {
          const delegation = event.delegation as { target?: unknown; id?: unknown };
          if (delegation?.target === 'client' && typeof delegation.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(delegation.id)) {
            session.handledDelegations ??= new Set();
            if (!session.handledDelegations.has(delegation.id)) {
              if (session.handledDelegations.size >= 64) { fail(session, 'The conversation reached its action limit.'); return; }
              session.handledDelegations.add(delegation.id);
              channel.send(JSON.stringify({ type: 'session.commentary.append', delegation_id: delegation.id,
                content: 'That capability is unavailable in this version. No lookup or action was performed. You can continue a conversation using my general knowledge.' }));
            }
          }
        } else if (alive() && session.browserControl && event.type === 'response.event' && 'event' in event) {
          const backend = event.event as { type?: string; response?: { status?: string } } | null;
          if (backend && (['error', 'response.failed', 'response.incomplete'].includes(backend.type ?? '')
            || backend.type === 'response.completed' && ['failed', 'incomplete'].includes(backend.response?.status ?? ''))) {
            fail(session, 'The voice connection encountered an error. Tap the wave to reconnect.');
          }
        } else if (alive() && event.type === 'error') {
          fail(session, 'The voice connection encountered an error. Tap the wave to reconnect.');
        }
      };
      channel.onclose = () => {
        if (alive() && !session.finalized) fail(session, 'The conversation disconnected. Tap the wave to reconnect.');
      };
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
      let observedInput = false, observedOutput = false;
      session.stopMonitor = monitorAudio(input, () => session.output, (inputActive, outputActive) => {
        if (!alive() || !session.ready) return;
        const audibleOutput = outputActive && !session.needsAudioResume;
        if (inputActive !== observedInput) session.diagnostic?.lifecycle(inputActive ? 'input_started' : 'input_quiet');
        if (audibleOutput !== observedOutput) session.diagnostic?.lifecycle(audibleOutput ? 'playback_started' : 'playback_quiet');
        observedInput = inputActive;
        observedOutput = audibleOutput;
        if (inputActive || outputActive) session.lastActivity = Date.now();
        if (outputActive && !session.needsAudioResume && !session.heardOutput) {
          session.heardOutput = true;
          setStatus('');
        }
        setPhase(outputActive && !session.needsAudioResume ? 'speaking' : 'listening');
      });
      const offer = await peer.createOffer();
      if (!alive()) return;
      await peer.setLocalDescription(offer);
      await waitForIce(peer, session.controller.signal);
      if (!alive()) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('The browser could not prepare an audio connection.');
      session.requested = true;
      // A stop cancels the server reservation by ID. Let the POST complete so
      // even a late provider creation can be closed, without losing its answer.
      const response = await fetch(session.endpoint, {
        method: 'POST', headers: { ...session.headers, 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json' },
        body: JSON.stringify({ sdp, sessionId: session.id, ...(recordDiagnostics ? { diagnostics: true } : {}) }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(await errorMessage(response, session));
      let confirmation = response.headers.get('content-type')?.startsWith('application/x-ndjson') ? voiceConnectionReader(response) : undefined;
      const result: unknown = confirmation ? await confirmation.next() : await response.json();
      if (!alive()) { void confirmation?.cancel(); void deleteSession(session.id, session.endpoint, session.headers); return; }
      if (!result || typeof result !== 'object' || !('sdp' in result) || typeof result.sdp !== 'string'
        || !('sessionId' in result) || result.sessionId !== session.id || !('expiresAt' in result)
        || typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt)) {
        throw new Error('The server returned an invalid voice connection.');
      }
      session.expiresAt = result.expiresAt;
      session.browserControl = 'browserControl' in result && result.browserControl === true;
      session.adminEligible = 'adminEligible' in result && result.adminEligible === true;
      session.adminOverride = 'adminOverride' in result && result.adminOverride === true;
      session.adminDeadline = 'adminDeadline' in result && typeof result.adminDeadline === 'number' ? result.adminDeadline : undefined;
      if (!confirmation && session.browserControl && 'connectionConfirmation' in result && result.connectionConfirmation === true) {
        const reply = await fetch(session.endpoint, { method: 'PATCH', headers: { ...session.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, connect: true }), signal: session.controller.signal });
        if (!reply.ok) throw new Error(await errorMessage(reply, session));
        confirmation = voiceConnectionReader(reply);
        if ((await confirmation.next()).ready !== true) throw new Error('Voice supervision is unavailable.');
      }
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      if (confirmation) {
        try {
          const meter = await confirmation.next();
          if (typeof meter.expiresAt !== 'number' || !Number.isFinite(meter.expiresAt)) throw new Error('Invalid voice confirmation.');
          session.expiresAt = meter.expiresAt;
        } finally { void confirmation.cancel(); }
      }
      session.controlConfirmed = true;
      if (session.browserControl && session.started) channel.send(JSON.stringify({ type: 'session.instructions.append', event_id: 'flowpath_greeting', delegation_id: null,
        content: waveformId ? 'Greet the visitor now in English using the saved waveform identity and conversational style. Keep it brief, invite them to talk, then pause and listen. Do not claim unavailable capabilities.' : PUBLIC_GREETING_INSTRUCTIONS }));
      if (!alive()) return;
      session.answerApplied = true;
      becomeReady();
      const tick = () => {
        if (!alive()) return;
        const remaining = Math.max(0, Math.ceil((session.expiresAt! - Date.now()) / 1000));
        setRemainingSeconds(remaining);
        if (!remaining) stop('The conversation limit has been reached.', 'limit');
        else if (!session.adminOverride && session.ready && Date.now() - session.lastActivity >= 45_000) stop('Conversation ended after 45 seconds of silence.', 'idle');
      };
      if (session.browserControl) {
        const heartbeat = async () => {
          if (!alive()) return;
          try {
            const reply = await fetch(session.endpoint, { method: 'PATCH', headers: { ...session.headers, 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId: session.id }), signal: AbortSignal.timeout(10_000) });
            if (!reply.ok) throw new Error('The voice connection needs to close. Tap the wave to try again after cleanup.');
            if (alive()) session.heartbeat = setTimeout(() => { void heartbeat(); }, 10_000);
          } catch { if (alive()) fail(session, 'The voice connection was lost. Tap the wave to try again after cleanup.'); }
        };
        session.heartbeat = setTimeout(() => { void heartbeat(); }, 10_000);
      }
      session.tick = setInterval(tick, 1_000);
      tick();
    } catch (error) {
      if (!alive()) return;
      const notice = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access to start a conversation.'
        : error instanceof Error ? error.message : 'The voice connection is unavailable. Tap the wave to try again.';
      fail(session, notice);
    }
  }, [fail, stop, waveformId, paidPayer, textBoxEnabled, draftPreview, publishedPreview]);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      const session = current.current ?? closingSession.current;
      current.current = null;
      revision.current++;
      if (session) {
        session.diagnostic?.finish('page_left');
        void dispose(session, true);
      }
      diagnostic.current?.clear();
      diagnostic.current = null;
      textController.current?.finish();
      textController.current = null;
      if (mounted.current) {
        setActive(false);
        setNeedsAudioResume(false);
        setPhase('idle');
        setStatus('');
        setRemainingSeconds(null);
        setInputAnalyser(null);
        setOutputAnalyser(null);
        setHasDiagnostic(false);
        setDiagnosticRecording(false);
        setTextState(emptyTextState());
      }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  const getDiagnostic = useCallback(() => diagnostic.current?.snapshot() ?? null, []);
  const stopWriting = useCallback(() => textController.current?.action('stop'), []);
  const clearText = useCallback(() => textController.current?.action('clear'), []);
  const undoText = useCallback(() => textController.current?.action('undo'), []);
  const hideText = useCallback(() => textController.current?.action('hide'), []);
  const showText = useCallback(() => textController.current?.action('show'), []);
  const markDiagnostic = useCallback(() => diagnostic.current?.mark() ?? false, []);
  const stopDiagnostic = useCallback(() => {
    diagnostic.current?.finish('capture_stopped');
    setDiagnosticRecording(false);
  }, []);
  const clearDiagnostic = useCallback(() => {
    diagnostic.current?.clear();
    diagnostic.current = null;
    setHasDiagnostic(false);
    setDiagnosticRecording(false);
    setDiagnosticVersion(value => value + 1);
  }, []);

  return { phase, active, status, remainingSeconds, inputAnalyser, outputAnalyser, needsAudioResume, start, stop, settledVersion,
    textState, stopWriting, clearText, undoText, hideText, showText,
    hasDiagnostic, diagnosticRecording, diagnosticVersion, getDiagnostic, markDiagnostic, stopDiagnostic, clearDiagnostic };
}
