'use client';
import { visitorWorkLabel } from './visitor-progress';
import { recordedVisitorFetch, registerRecordingVoice } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';

import { createStartupAudioGuard, monitorLiveAudio, waitForIce } from './gpt-live/browser';
import { createLiveIdleTimer, DEFAULT_LIVE_IDLE_TIMEOUT_MS, liveIdleMessage } from './gpt-live/idle';
import type { LiveAudioState } from './gpt-live/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '@/components/Waveform';
import type { VisitorAvailability } from './visitor-model';
import type { VisitorContext, VisitorHistory, VisitorControlCapability, VisitorControlUpdate } from './visitor-realtime-context';
import { readVisitorRealtimeEvents, visitorAvailabilitySchema, VISITOR_SESSION_MS, type VisitorRealtimeEvent } from './visitor-realtime';
import { visitorDiagnostic, diagnosticError, type VisitorDiagnostic } from './visitor-diagnostics';
import { prepareVisitorVoiceRequest } from './visitor-request-preparation';

type Options = {
  prepare?: (signal: AbortSignal) => Promise<void>;
  slug: string; context: VisitorContext; history: VisitorHistory; getContext: () => VisitorContext;
  onAvailability: (value: VisitorAvailability) => void;
  onPlan: (event: Extract<VisitorRealtimeEvent, { type: 'plan' }>, signal: AbortSignal) => void | Promise<void>;
  onTranscript: (event: Extract<VisitorRealtimeEvent, { type: 'transcript' }>) => void;
  onAnswer?: (event: Extract<VisitorRealtimeEvent, { type: 'answer_completed' }>) => void;
  onRequest?: (phase: 'prepare' | 'start' | 'finish' | 'cancel', revision: number, signal?: AbortSignal) => void | Promise<void>;
  onGreetingProgress?: (text: string) => void;
  onGreetingInterrupted?: () => void;
  onAudioActivity?: (state: LiveAudioState) => void;
  onNavigate: (event: Extract<VisitorRealtimeEvent, { type: 'navigation' }>, signal: AbortSignal, onVisible: () => void) => Promise<'applied' | 'unavailable' | 'failed' | 'cancelled'>;
};

type Session = {
  traceId: string; startedAt: number; diagnosticStage: VisitorDiagnostic['stage'];
  controller: AbortController; peer?: RTCPeerConnection; stream?: MediaStream; context?: AudioContext; audio?: HTMLAudioElement;
  inputReadyTimer?: ReturnType<typeof setInterval>;
  setupTimer?: ReturnType<typeof setTimeout>; sessionTimer?: ReturnType<typeof setTimeout>; disconnectTimer?: ReturnType<typeof setTimeout>;
  updateTimer?: ReturnType<typeof setTimeout>; updateAt?: number; ackTimer?: ReturnType<typeof setTimeout>; frames: Set<number>;
  sdpReady: boolean; serverReady: boolean; connected: boolean; remoteAttached: boolean; audioPrepared: boolean; readyAcknowledged: boolean; readySent: boolean; lastPostedAt: number; end: () => void;
  speaking: boolean; thinking: boolean; userSpeaking: boolean; revision: number; planRevision: number; playingId?: string;
  taskStartedAt?: number; taskAudioReported?: boolean; resultReady?: boolean; resultAudioReported?: boolean;
  interactionRevision: number; appliedInteractionRevision: number; appliedRevision: number; viewRevision: number; seq: number; ackSeq: number; control?: VisitorControlCapability;
  snapshot: VisitorContext; lastSent: string; sending: boolean; dirty: boolean;
  sent: Map<number, { interactionRevision: number; ready: boolean; time: number }>; transcripts: Map<string, string>;
  navigation?: AbortController; navigationAck?: VisitorControlUpdate['navigationAck']; planAck?: VisitorControlUpdate['planAck'];
  preparation?: AbortController; preparationRevision?: number; preparationAck?: VisitorControlUpdate['preparationAck'];
  startup?: ReturnType<typeof createStartupAudioGuard>; stopMonitor?: () => void; audioState?: LiveAudioState; resumeAfterQuiet?: boolean; resumeAfterRevision?: number;
  idle?: ReturnType<typeof createLiveIdleTimer>;
  finish?: () => void; unregisterRecording?: () => void;
  queue: (immediate?: boolean) => void;
};

/** Audio-only WebRTC; commands and accepted view updates go through the owner. */
export function useVisitorSession() {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [message, setMessage] = useState('');
  const [activity, setActivity] = useState('');
  const [startupStage, setStartupStage] = useState('');
  const [inputReady, setInputReady] = useState(false);
  const [active, setActive] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [working, setWorking] = useState(false);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const current = useRef<Session | null>(null);

  const stop = useCallback((notice = '') => {
    const session = current.current; current.current = null;
    if (session) {
      visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'stop', status: 'cancelled', durationMs: performance.now() - session.startedAt });
      // Ask the server to finalize while media stays negotiated. Mute immediately.
      session.startup?.setInputEnabled(false);
      if (session.audio) session.audio.muted = true;
      session.end(); session.navigation?.abort(); session.preparation?.abort(); session.unregisterRecording?.();
      const timeout = setTimeout(() => session.finish?.(), 6500);
      let released = false;
      session.finish = () => {
      if (released) return;
      released = true;
      clearTimeout(timeout); session.controller.abort(); session.stopMonitor?.(); session.startup?.dispose();
      clearInterval(session.inputReadyTimer); clearTimeout(session.setupTimer); clearTimeout(session.sessionTimer); clearTimeout(session.disconnectTimer);
      clearTimeout(session.updateTimer); session.updateTimer = undefined; session.updateAt = undefined;
      clearTimeout(session.ackTimer); session.frames.forEach(cancelAnimationFrame);
      session.idle?.close();
      if (session.peer) { session.peer.ontrack = null; session.peer.onconnectionstatechange = null; session.peer.close(); }
      session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      if (session.audio) { session.audio.pause(); session.audio.srcObject = null; }
      if (session.context?.state !== 'closed') void session.context?.close().catch(() => undefined);
      };
      if (!session.sdpReady) session.finish();
    }
    setStartupStage(''); setInputReady(false); setActivity(''); setWorking(false); setActive(false); setUpdating(false); setPhase('idle'); setMessage(notice); setInputAnalyser(null); setOutputAnalyser(null);
  }, []);
  const fail = useCallback((session: Session, notice: string) => {
    if (current.current !== session) return;
    visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: session.diagnosticStage, status: 'failed', durationMs: performance.now() - session.startedAt, revision: session.revision, interactionRevision: session.interactionRevision });
    stop(notice); setPhase('error');
  }, [stop]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && current.current) { event.preventDefault(); stop(); } };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); window.removeEventListener('keydown', key); stop(); };
  }, [stop]);

  useEffect(() => { if (!working) return; const timer = setTimeout(() => setActivity('Still working — you can keep talking'), 8000); return () => clearTimeout(timer); }, [working]);

  const updateContext = useCallback((context: VisitorContext, immediate = false) => {
    const session = current.current; if (!session) return;
    session.snapshot = context; session.queue(immediate);
  }, []);
  const manualInterrupt = useCallback(() => {
    const session = current.current; if (!session) return;
    setInputReady(false); setActivity(''); setWorking(false); session.interactionRevision++; session.navigation?.abort(); session.preparation?.abort(); session.preparationAck = undefined;
    // Keep the peer open; pause input until the owner accepts the manual context.
    session.startup?.setInputEnabled(false); session.resumeAfterQuiet = true;
    setUpdating(true); setPhase('connecting');
    if (session.audio) session.audio.muted = true;
    session.playingId = undefined; session.speaking = false; session.thinking = false; session.taskStartedAt = undefined;
    session.queue(true);
  }, []);

  const start = useCallback(async (options: Options) => {
    if (current.current) return;
    setMessage(''); setActivity(''); setWorking(false);
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) {
      setPhase('error'); setMessage('This browser cannot start a voice conversation. You can still browse this site.'); return;
    }
    const session: Session = {
      traceId: crypto.randomUUID(), startedAt: performance.now(), diagnosticStage: 'start',
      controller: new AbortController(), frames: new Set(), sdpReady: false, serverReady: false, connected: false, remoteAttached: false, audioPrepared: false, readyAcknowledged: false, readySent: false, lastPostedAt: 0, end() {},
      speaking: false, thinking: false, userSpeaking: false, revision: 0, planRevision: -1, interactionRevision: 0, appliedInteractionRevision: -1, appliedRevision: -1, viewRevision: 0,
      seq: 0, ackSeq: 0, snapshot: options.context, lastSent: '', sending: false, dirty: false, sent: new Map(), transcripts: new Map(), queue() {},
    };
    current.current = session; setActive(true); setPhase('connecting'); setInputReady(false); setStartupStage('Preparing voice…');
    const diagnostic = (stage: VisitorDiagnostic['stage'], status: VisitorDiagnostic['status'] = 'succeeded') => {
      session.diagnosticStage = stage;
      visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage, status, durationMs: performance.now() - session.startedAt, revision: session.revision, interactionRevision: session.interactionRevision });
    };
    diagnostic('start', 'started');
    let reportedReady = false, reportedInput = false, reportedAudio = false, idleStarted = false, idleBusy = false;
    const alive = () => current.current === session;
    const resumePlayback = () => {
      if (!session.audioState?.outputActive && session.resumeAfterQuiet && session.appliedInteractionRevision === session.interactionRevision
        && session.appliedRevision >= (session.resumeAfterRevision ?? 0)) {
        session.resumeAfterQuiet = false; session.resumeAfterRevision = undefined;
        if (session.audio) session.audio.muted = false;
      }
    };
    session.idle = createLiveIdleTimer({
      timeoutMs: 0,
      onIdle: () => { if (alive()) stop(liveIdleMessage(session.idle?.timeoutMs ?? DEFAULT_LIVE_IDLE_TIMEOUT_MS)); },
    });
    const ready = () => session.sdpReady && session.serverReady && session.connected && session.remoteAttached && session.audioPrepared;
    const observeInput = () => {
      if (!alive()) return;
      const enabled = session.readyAcknowledged && Boolean(session.startup?.tracks.some(track => track.enabled));
      setInputReady(enabled);
      if (enabled) { clearInterval(session.inputReadyTimer); setStartupStage(''); if (!reportedInput) { reportedInput = true; diagnostic('input_ready'); } }
    };
    const restingPhase = () => {
      observeInput();
      if (!alive()) return;
      if (!ready() || !session.readyAcknowledged || session.appliedInteractionRevision !== session.interactionRevision) { setPhase('connecting'); return; }
      clearTimeout(session.setupTimer);
      if (!reportedReady) { reportedReady = true; diagnostic('ready'); if (!session.startup?.tracks.some(track => track.enabled)) setStartupStage('Finishing the greeting · microphone preparing…'); }
      setPhase(session.userSpeaking ? 'listening' : session.speaking ? 'speaking' : session.thinking ? 'thinking' : 'listening');
      // Rendering, owner ACKs and repeated idle events are not fresh activity.
      if (idleBusy !== session.thinking) { idleBusy = session.thinking; session.idle?.observeBusy(idleBusy); }
      if (!idleStarted) { idleStarted = true; session.idle?.start(); }
    };
    const afterLayout = (callback: () => void) => {
      const frame = requestAnimationFrame(() => { session.frames.delete(frame); if (!alive()) return;
        const next = requestAnimationFrame(() => { session.frames.delete(next); if (alive()) callback(); }); session.frames.add(next);
      }); session.frames.add(frame);
    };
    const armAckDeadline = () => {
      clearTimeout(session.ackTimer);
      const first = session.sent.values().next().value;
      if (first) session.ackTimer = setTimeout(() => fail(session, 'The voice connection could not confirm your current view. You can continue by typing.'), Math.max(1, first.time + 10_000 - Date.now()));
    };
    session.end = () => {
      if (!session.control || session.seq >= 300) return;
      // The mailbox capability only ends this call; pagehide cannot await the owner.
      void recordedVisitorFetch(`/api/visitor/${encodeURIComponent(options.slug)}/session/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
        body: JSON.stringify({ control: session.control, update: { seq: ++session.seq, interactionRevision: session.interactionRevision, viewRevision: session.viewRevision, ready: session.readySent, end: true, context: session.snapshot } }),
      }).catch(() => undefined);
    };
    const schedule = (delay: number) => {
      if (!alive()) return;
      const deadline = Date.now() + delay;
      // Continuous motion may change the snapshot, but cannot postpone its deadline.
      if (session.updateTimer !== undefined && session.updateAt !== undefined && session.updateAt <= deadline) return;
      clearTimeout(session.updateTimer);
      session.updateAt = deadline;
      session.updateTimer = setTimeout(() => {
        session.updateTimer = undefined; session.updateAt = undefined; void flush();
      }, delay);
    };
    const flush = async () => {
      if (!alive() || !session.control || !session.sdpReady) return;
      if (session.sending) { session.dirty = true; return; }
      const wait = session.lastPostedAt + 150 - Date.now();
      if (wait > 0) { schedule(wait); return; }
      session.dirty = false;
      try {
        session.snapshot = options.getContext();
        const payload = { audio: session.audioState, interactionRevision: session.interactionRevision, viewRevision: session.viewRevision, ready: session.readySent || ready(), context: session.snapshot, ...(session.navigationAck ? { navigationAck: session.navigationAck } : {}), ...(session.planAck ? { planAck: session.planAck } : {}), ...(session.preparationAck ? { preparationAck: session.preparationAck } : {}) };
        const serialized = JSON.stringify(payload);
        if (serialized === session.lastSent) return;
        if (session.seq >= 299) throw new Error('This conversation has reached its view-update limit. You can continue by typing.');
        const seq = ++session.seq; session.lastSent = serialized; session.sending = true; session.lastPostedAt = Date.now(); session.readySent = payload.ready;
        session.sent.set(seq, { interactionRevision: payload.interactionRevision, ready: payload.ready, time: Date.now() }); armAckDeadline();
        const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(options.slug)}/session/control`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: session.controller.signal,
          body: JSON.stringify({ control: session.control, update: { seq, ...payload } }),
        });
        if (alive() && !response.ok) throw new Error('The voice connection could not update your view. You can continue by typing.');
      } catch (error) { if (alive()) fail(session, error instanceof Error ? error.message : 'The voice connection could not update your view.'); }
      finally { session.sending = false; if (alive() && session.dirty) schedule(0); }
    };
    session.queue = (immediate = false) => {
      if (immediate) afterLayout(() => schedule(0));
      else schedule(500);
    };
    const readinessChanged = () => { restingPhase(); if (ready()) session.queue(true); };
    try {
      // Prepare output from the gesture; readiness never waits for audio samples.
      const context = new AudioContext(); session.context = context;
      session.setupTimer = setTimeout(() => fail(session, 'The voice connection took too long. Tap the wave to try again.'), 30_000);
      const audioReady = context.resume().then(() => {
        if (!alive()) return;
        session.audioPrepared = context.state === 'running'; diagnostic('audio');
        if (!session.audioPrepared) throw new Error('Audio could not start. You can continue by typing.');
      });
      diagnostic('preflight', 'started');
      const preflight = Promise.resolve(options.prepare?.(session.controller.signal)).then(() => { if (alive()) diagnostic('preflight'); });
      let permissionPending = true;
      if (navigator.permissions?.query) void navigator.permissions.query({ name: 'microphone' as PermissionName }).then(permission => {
        if (alive() && permissionPending && permission.state === 'prompt') setStartupStage('Allow microphone access to continue');
      }).catch(() => undefined);
      diagnostic('microphone', 'started');
      const microphoneStarted = performance.now();
      const microphone = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(stream => {
        permissionPending = false;
        if (!alive()) { stream.getTracks().forEach(track => track.stop()); return stream; }
        session.stream = stream; setStartupStage('Preparing voice…');
        visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'microphone', status: 'succeeded', durationMs: performance.now() - microphoneStarted });
        return stream;
      });
      const [stream] = await Promise.all([microphone, audioReady, preflight]);
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.controller.signal.throwIfAborted(); setStartupStage('Connecting voice…');
      session.stream = stream;
      // Keep capture/AEC and owner-ACK gating, but never mute input for the
      // greeting: visitors must be able to interrupt on mobile as on desktop.
      session.startup = createStartupAudioGuard({ stream, enabled: false });
      session.inputReadyTimer = setInterval(observeInput, 50);
      session.startup.setInputEnabled(false);
      for (const track of stream.getAudioTracks()) track.onended = () => fail(session, 'Microphone access ended. Tap the wave to start again.');
      const input = context.createAnalyser(); input.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(input); setInputAnalyser(input);
      const peer = new RTCPeerConnection(); session.peer = peer;
      const audio = new Audio(); session.audio = audio;
      audio.autoplay = true; audio.setAttribute('playsinline', '');
      peer.ontrack = event => {
        if (!alive()) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]); audio.srcObject = remote;
        const output = context.createAnalyser(); output.fftSize = 2048;
        const silent = context.createGain(); silent.gain.value = 0;
        context.createMediaStreamSource(remote).connect(output); output.connect(silent).connect(context.destination); setOutputAnalyser(output);
        session.stopMonitor = monitorLiveAudio(input, output, state => {
          if (!alive()) return;
          const firstPlayback = state.outputActive && !session.audioState?.outputActive;
          state = { ...state, inputActive: state.inputActive && Boolean(session.startup?.tracks.some(track => track.enabled)) };
          session.audioState = state;
          session.idle?.observeAudio(state);
          if (firstPlayback) { session.startup?.playbackStarted(); if (!reportedAudio) { reportedAudio = true; diagnostic('first_audio'); } }
          resumePlayback();
          session.speaking = state.outputActive && !audio.muted;
          if (firstPlayback && session.speaking && !session.taskAudioReported && session.taskStartedAt !== undefined) {
            session.taskAudioReported = true;
            visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'turn_audio', status: 'observed', durationMs: performance.now() - session.taskStartedAt, revision: session.revision, interactionRevision: session.interactionRevision });
          }
          if (firstPlayback && session.speaking && session.resultReady && !session.resultAudioReported && session.taskStartedAt !== undefined) {
            session.resultAudioReported = true;
            visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'result_audio_candidate', status: 'observed', durationMs: performance.now() - session.taskStartedAt, revision: session.revision, interactionRevision: session.interactionRevision });
          }
          session.userSpeaking = state.inputActive;
          options.onAudioActivity?.({ inputActive: state.inputActive, outputActive: session.speaking });
          restingPhase(); session.queue();
        });
        session.remoteAttached = true; readinessChanged();
        void audio.play().catch(() => fail(session, 'Audio playback was blocked. You can continue by typing.'));
      };
      peer.onconnectionstatechange = () => {
        if (!alive()) return;
        session.connected = peer.connectionState === 'connected';
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') fail(session, 'The voice connection ended. Tap the wave to start again.');
        else if (peer.connectionState === 'disconnected') {
          clearTimeout(session.disconnectTimer); session.disconnectTimer = setTimeout(() => fail(session, 'The voice connection was lost. Tap the wave to start again.'), 5000);
        } else if (session.connected) { clearTimeout(session.disconnectTimer); readinessChanged(); }
      };
      // No provider data channel: visitors cannot send session/tool commands.
      session.startup.tracks.forEach(track => peer.addTrack(track, stream));
      const offer = await peer.createOffer(); if (!alive()) return;
      await peer.setLocalDescription(offer); if (!alive()) return;
      await waitForIce(peer, session.controller.signal); if (!alive()) return;
      diagnostic('offer'); diagnostic('session_request', 'started');
      const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(options.slug)}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, signal: session.controller.signal,
        body: JSON.stringify({ requestId: session.traceId, sdp: peer.localDescription?.sdp ?? offer.sdp, context: options.getContext(), history: options.history }),
      });
      if (!alive()) { await response.body?.cancel().catch(() => undefined); return; }
      if (!response.ok) {
        const error = await response.json().catch(() => null); const availability = visitorAvailabilitySchema.safeParse(error?.availability);
        if (availability.success) options.onAvailability(availability.data);
        throw new Error(typeof error?.error === 'string' ? error.error : 'The voice connection is unavailable.');
      }
      if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('The voice connection returned an invalid response.');
      await readVisitorRealtimeEvents(response.body, session.controller.signal, async event => {
        if (event.type !== 'ping') recordBrowserTestEvent(`voice.${event.type}`, event, session.traceId);
        if (!alive()) { if (event.type === 'ended' || event.type === 'error') session.finish?.(); return; }
          if (event.type === 'session') {
          if (session.sdpReady) throw new Error('The voice connection returned a duplicate session.');
          options.onAvailability(event.availability); session.control = event.control;
          session.unregisterRecording = registerRecordingVoice(options.slug, event.control);
          session.idle?.setTimeoutMs(event.idleTimeoutMs ?? DEFAULT_LIVE_IDLE_TIMEOUT_MS);
          const remaining = Math.min(VISITOR_SESSION_MS, event.expiresAt - Date.now());
          if (remaining <= 0) throw new Error('This voice session expired. Tap the wave to start again.');
          session.sessionTimer = setTimeout(() => { if (alive()) stop('Conversation paused. Tap the wave to start again.'); }, remaining);
          await peer.setRemoteDescription({ type: 'answer', sdp: event.sdp }); if (!alive()) return;
          session.sdpReady = true; diagnostic('session_answer'); readinessChanged(); return;
        }
        if (event.type === 'error') { if (event.availability) options.onAvailability(event.availability); fail(session, event.message); session.finish?.(); return; }
        if (event.type === 'ended') { stop(event.message); session.finish?.(); return; }
        if (event.type === 'ping') return;
        if (!session.sdpReady) throw new Error('The voice connection was not ready.');
        if (event.type === 'ready') { diagnostic('control_ready'); session.serverReady = true; readinessChanged(); }
        else if (event.type === 'control_applied') {
          if (event.seq <= session.ackSeq) return;
          const sent = session.sent.get(event.seq);
          if (!sent || sent.interactionRevision !== event.interactionRevision || sent.ready !== event.ready) throw new Error('The voice connection returned an invalid view acknowledgment.');
          session.ackSeq = event.seq; session.revision = Math.max(session.revision, event.revision);
          for (const seq of session.sent.keys()) if (seq <= event.seq) session.sent.delete(seq);
          armAckDeadline();
          session.appliedInteractionRevision = event.interactionRevision;
          session.appliedRevision = Math.max(session.appliedRevision, event.revision);
          if (event.ready) session.readyAcknowledged = true;
          if (event.ready && event.interactionRevision === session.interactionRevision) {
            session.startup?.setInputEnabled(true); setUpdating(false);
            resumePlayback();
          }
          restingPhase();
        } else if (event.type === 'availability') options.onAvailability(event.availability);
        else if (event.type === 'transcript') {
          // An accepted user utterance remains history even if they then browse.
          if (session.transcripts.get(event.id) === event.text || event.role === 'assistant' && event.interactionRevision !== session.interactionRevision) return;
          if (event.role === 'user') options.onGreetingInterrupted?.();
          session.transcripts.set(event.id, event.text); options.onTranscript(event);
        } else if (event.type === 'greeting_progress') {
          if (event.revision === 0 && session.revision === 0 && event.interactionRevision === session.interactionRevision) options.onGreetingProgress?.(event.text);
        } else if (event.type === 'progress') {
          if (event.revision === session.revision && event.interactionRevision === session.interactionRevision && session.thinking) setActivity(visitorWorkLabel[event.stage]);
        } else if (event.type === 'result_ready') {
          if (event.revision === session.revision && event.interactionRevision === session.interactionRevision) session.resultReady = true;
        } else if (event.type === 'answer_completed') {
          // Accepted backend text is dialogue context, not an acoustic transcript.
          if (event.revision === session.revision && event.interactionRevision === session.interactionRevision) options.onAnswer?.(event);
        } else if (event.type === 'activity') {
          if (event.revision === session.revision && event.interactionRevision === session.interactionRevision) setActivity(event.activity === 'images' ? 'Finding images…' : event.activity === 'map' ? 'Preparing the map…' : 'Searching the web…');
        } else if (event.type === 'speech_started') {
          if (session.appliedInteractionRevision !== session.interactionRevision) return;
          options.onGreetingInterrupted?.();
          session.revision = Math.max(session.revision, event.revision); session.navigation?.abort(); setMessage('');
          session.userSpeaking = true; session.speaking = false; session.playingId = undefined; restingPhase();
        } else if (event.type === 'speech_stopped') { if (session.appliedInteractionRevision !== session.interactionRevision) return; session.userSpeaking = false; restingPhase(); }
        else if (event.type === 'backend_idle') { if (event.interactionRevision === session.interactionRevision && event.revision === session.revision) { await options.onRequest?.('finish', event.revision); session.thinking = false; setWorking(false); setActivity(''); restingPhase(); } }
        else if (event.type === 'task_error') {
          if (event.interactionRevision !== session.interactionRevision || event.revision !== session.revision) return;
          session.preparation?.abort(); session.preparationAck = undefined;
          await options.onRequest?.('finish', event.revision);
          setActivity(''); setWorking(false); setMessage(event.message); session.thinking = false; restingPhase();
          visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'backend', status: 'failed', sessionElapsedMs: performance.now() - session.startedAt, revision: session.revision, interactionRevision: session.interactionRevision, ...diagnosticError(new Error(event.message)) });
        }
        else if (event.type === 'response_cancelled') {
          if (event.interactionRevision !== session.interactionRevision || event.revision <= session.revision) return;
          session.preparation?.abort(); session.preparationAck = undefined;
          await options.onRequest?.('cancel', event.revision);
          session.revision = event.revision; session.navigation?.abort();
          session.navigationAck = undefined; session.planAck = undefined;
          setActivity(''); setWorking(false); setMessage(''); session.thinking = false; session.speaking = false; session.playingId = undefined; session.taskStartedAt = undefined;
          // Spoken changes invalidate browser work too. Mute old output until
          // it is quiet AND the owner confirms this revision; keep listening.
          audio.muted = true; session.resumeAfterQuiet = true; session.resumeAfterRevision = event.revision;
          session.lastSent = ''; session.queue(true); options.onGreetingInterrupted?.(); restingPhase();
          visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'backend', status: 'cancelled', reason: 'stale', revision: session.revision, interactionRevision: session.interactionRevision });
        } else if (event.type === 'response_started') {
          if (event.interactionRevision !== session.interactionRevision || event.revision < session.revision) return;
          if (session.preparationRevision === event.revision) return;
          if (event.revision > session.revision) session.navigation?.abort();
          if (event.revision > session.revision) { session.taskStartedAt = performance.now(); session.taskAudioReported = false; session.resultReady = false; session.resultAudioReported = false; }
          setActivity(''); setWorking(true); setMessage(''); session.revision = event.revision; session.thinking = true; restingPhase();
          session.preparation?.abort(); const preparation = new AbortController(); session.preparation = preparation;
          session.preparationRevision = event.revision; session.preparationAck = undefined;
          // Keep the event reader and microphone responsive while task restoration finishes.
          prepareVisitorVoiceRequest({ signal: preparation.signal,
            current: () => alive() && session.revision === event.revision && session.interactionRevision === event.interactionRevision,
            prepare: () => options.onRequest?.('prepare', event.revision, preparation.signal),
            begin: () => options.onRequest?.('start', event.revision, preparation.signal),
            acknowledge: status => { session.snapshot = options.getContext(); session.preparationAck = { revision: event.revision, status }; schedule(0); },
          });
        } else if (event.type === 'playback_started') {
          if (event.interactionRevision !== session.interactionRevision || session.resumeAfterQuiet) return;
          audio.muted = false; session.playingId = event.responseId; session.speaking = true; restingPhase();
        } else if (event.type === 'playback_stopped' || event.type === 'playback_cleared') {
          if (!session.playingId || event.responseId && event.responseId !== session.playingId) return;
          session.playingId = undefined; session.speaking = false; restingPhase();
        } else if (event.type === 'plan') {
          if (event.interactionRevision !== session.interactionRevision || event.revision !== session.revision || event.revision <= session.planRevision) return;
          // Do not block the event reader during motion: speech, quotas and End
          // must still be processed while the browser is acknowledging a view.
          session.planRevision = event.revision;
          session.navigation?.abort(); const navigation = new AbortController(); session.navigation = navigation;
          void Promise.resolve().then(() => options.onPlan(event, navigation.signal)).then(() => {
            if (!alive()) return;
            const cancelled = navigation.signal.aborted || event.interactionRevision !== session.interactionRevision || event.revision !== session.revision;
            if (!cancelled) session.viewRevision = event.revision;
            session.planAck = { revision: event.revision, status: cancelled ? 'cancelled' : 'applied' }; session.queue(true);
          }).catch(() => { if (alive()) {
            session.planAck = { revision: event.revision, status: navigation.signal.aborted ? 'cancelled' : 'failed' }; session.queue(true);
            if (!navigation.signal.aborted) setMessage('The browser could not apply that view. Your current workspace is still available.');
          } });
        } else if (event.type === 'navigation') {
          if (event.interactionRevision !== session.interactionRevision || event.revision !== session.revision) return;
          setActivity('Displaying results…'); session.navigation?.abort(); const navigation = new AbortController(); session.navigation = navigation;
          diagnostic('navigation', 'started');
          const navigationStarted = performance.now(); let visible = false;
          const onVisible = () => {
            if (visible || !alive() || navigation.signal.aborted || event.revision !== session.revision || event.interactionRevision !== session.interactionRevision) return;
            visible = true; visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'visual_result', status: 'observed', durationMs: performance.now() - (session.taskStartedAt ?? navigationStarted), revision: session.revision, interactionRevision: session.interactionRevision });
          };
          void options.onNavigate(event, navigation.signal, onVisible).then(status => {
            if (!alive() || navigation.signal.aborted || event.interactionRevision !== session.interactionRevision || event.revision !== session.revision) return;
            if (status === 'applied') onVisible();
            visitorDiagnostic({ traceId: session.traceId, channel: 'browser', stage: 'display_receipt', status: status === 'applied' ? 'succeeded' : 'failed', durationMs: performance.now() - navigationStarted, revision: session.revision, interactionRevision: session.interactionRevision });
            // Layout is already confirmed. Send its receipt before routine context traffic.
            session.navigationAck = { id: event.id, status }; schedule(0);
            if (!session.thinking) setActivity('');
            diagnostic('navigation', status === 'applied' ? 'succeeded' : status === 'cancelled' ? 'cancelled' : 'failed');
          }).catch(() => { if (alive() && !navigation.signal.aborted) { session.navigationAck = { id: event.id, status: 'unavailable' }; schedule(0); } });
        }
      });
    } catch (error) {
      if (!alive()) return;
      const notice = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access is off. You can still browse this site.'
        : error instanceof DOMException && error.name === 'NotFoundError' ? 'No microphone was found. You can still browse this site.'
          : error instanceof Error ? error.message : 'The voice connection is unavailable. Tap the wave to try again.';
      fail(session, notice);
    }
  }, [fail, stop]);
  return { phase, message, activity, startupStage, inputReady, active, updating, working, inputAnalyser, outputAnalyser, start, stop, manualInterrupt, updateContext };
}
