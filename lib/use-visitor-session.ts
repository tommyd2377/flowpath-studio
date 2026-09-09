'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '@/components/Waveform';
import type { VisitorAvailability } from './visitor-model';
import type { VisitorContext, VisitorHistory, VisitorControlCapability, VisitorControlUpdate } from './visitor-realtime-context';
import { readVisitorRealtimeEvents, visitorAvailabilitySchema, VISITOR_SESSION_MS, type VisitorRealtimeEvent } from './visitor-realtime';

type Options = {
  slug: string; context: VisitorContext; history: VisitorHistory; getContext: () => VisitorContext;
  onAvailability: (value: VisitorAvailability) => void;
  onPlan: (event: Extract<VisitorRealtimeEvent, { type: 'plan' }>) => void;
  onTranscript: (event: Extract<VisitorRealtimeEvent, { type: 'transcript' }>) => void;
  onNavigate: (event: Extract<VisitorRealtimeEvent, { type: 'navigation' }>, signal: AbortSignal) => Promise<'applied' | 'unavailable'>;
};
type Session = {
  controller: AbortController; peer?: RTCPeerConnection; stream?: MediaStream; context?: AudioContext; audio?: HTMLAudioElement;
  setupTimer?: ReturnType<typeof setTimeout>; sessionTimer?: ReturnType<typeof setTimeout>; disconnectTimer?: ReturnType<typeof setTimeout>;
  updateTimer?: ReturnType<typeof setTimeout>; updateAt?: number; ackTimer?: ReturnType<typeof setTimeout>; frames: Set<number>;
  sdpReady: boolean; serverReady: boolean; connected: boolean; remoteAttached: boolean; audioPrepared: boolean; readyAcknowledged: boolean; readySent: boolean; lastPostedAt: number; end: () => void;
  speaking: boolean; thinking: boolean; userSpeaking: boolean; revision: number; planRevision: number; playingId?: string;
  interactionRevision: number; appliedInteractionRevision: number; viewRevision: number; seq: number; ackSeq: number; control?: VisitorControlCapability;
  snapshot: VisitorContext; lastSent: string; sending: boolean; dirty: boolean;
  sent: Map<number, { interactionRevision: number; ready: boolean; time: number }>; transcripts: Set<string>;
  navigation?: AbortController; navigationAck?: VisitorControlUpdate['navigationAck'];
  queue: (immediate?: boolean) => void;
};

/** Audio-only WebRTC; commands and accepted view updates go through the owner. */
export function useVisitorSession() {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [message, setMessage] = useState('');
  const [active, setActive] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const current = useRef<Session | null>(null);

  const stop = useCallback((notice = '') => {
    const session = current.current; current.current = null;
    if (session) {
      // Cancelling this body terminates the server/provider session as well.
      session.end(); session.controller.abort(); session.navigation?.abort();
      clearTimeout(session.setupTimer); clearTimeout(session.sessionTimer); clearTimeout(session.disconnectTimer);
      clearTimeout(session.updateTimer); session.updateTimer = undefined; session.updateAt = undefined;
      clearTimeout(session.ackTimer); session.frames.forEach(cancelAnimationFrame);
      if (session.peer) { session.peer.ontrack = null; session.peer.onconnectionstatechange = null; session.peer.close(); }
      session.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      if (session.audio) { session.audio.pause(); session.audio.srcObject = null; }
      if (session.context?.state !== 'closed') void session.context?.close().catch(() => undefined);
    }
    setActive(false); setUpdating(false); setPhase('idle'); setMessage(notice); setInputAnalyser(null); setOutputAnalyser(null);
  }, []);
  const fail = useCallback((session: Session, notice: string) => {
    if (current.current !== session) return;
    stop(notice); setPhase('error');
  }, [stop]);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    const leave = () => stop();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && current.current) { event.preventDefault(); stop(); } };
    document.addEventListener('visibilitychange', hide); window.addEventListener('pagehide', leave); window.addEventListener('keydown', key);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); window.removeEventListener('keydown', key); stop(); };
  }, [stop]);

  const updateContext = useCallback((context: VisitorContext) => {
    const session = current.current; if (!session) return;
    session.snapshot = context; session.queue();
  }, []);
  const manualInterrupt = useCallback(() => {
    const session = current.current; if (!session) return;
    session.interactionRevision++; session.navigation?.abort();
    // Keep the peer open; pause input until the owner accepts the manual context.
    session.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
    setUpdating(true); setPhase('connecting');
    if (session.audio) session.audio.muted = true;
    session.playingId = undefined; session.speaking = false; session.thinking = false;
    session.queue(true);
  }, []);

  const start = useCallback(async (options: Options) => {
    if (current.current) return;
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) {
      setPhase('error'); setMessage('This browser cannot start a voice conversation. You can still browse this site.'); return;
    }
    const session: Session = {
      controller: new AbortController(), frames: new Set(), sdpReady: false, serverReady: false, connected: false, remoteAttached: false, audioPrepared: false, readyAcknowledged: false, readySent: false, lastPostedAt: 0, end() {},
      speaking: false, thinking: false, userSpeaking: false, revision: 0, planRevision: -1, interactionRevision: 0, appliedInteractionRevision: -1, viewRevision: 0,
      seq: 0, ackSeq: 0, snapshot: options.context, lastSent: '', sending: false, dirty: false, sent: new Map(), transcripts: new Set(), queue() {},
    };
    current.current = session; setActive(true); setPhase('connecting');
    const alive = () => current.current === session;
    const ready = () => session.sdpReady && session.serverReady && session.connected && session.remoteAttached && session.audioPrepared;
    const restingPhase = () => {
      if (!alive()) return;
      if (!ready() || !session.readyAcknowledged || session.appliedInteractionRevision !== session.interactionRevision) { setPhase('connecting'); return; }
      clearTimeout(session.setupTimer);
      setPhase(session.userSpeaking ? 'listening' : session.speaking ? 'speaking' : session.thinking ? 'thinking' : 'listening');
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
      void fetch(`/api/visitor/${encodeURIComponent(options.slug)}/session/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
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
        const payload = { interactionRevision: session.interactionRevision, viewRevision: session.viewRevision, ready: session.readySent || ready(), context: session.snapshot, ...(session.navigationAck ? { navigationAck: session.navigationAck } : {}) };
        const serialized = JSON.stringify(payload);
        if (serialized === session.lastSent) return;
        if (session.seq >= 299) throw new Error('This conversation has reached its view-update limit. You can continue by typing.');
        const seq = ++session.seq; session.lastSent = serialized; session.sending = true; session.lastPostedAt = Date.now(); session.readySent = payload.ready;
        session.sent.set(seq, { interactionRevision: payload.interactionRevision, ready: payload.ready, time: Date.now() }); armAckDeadline();
        const response = await fetch(`/api/visitor/${encodeURIComponent(options.slug)}/session/control`, {
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
      await context.resume(); session.audioPrepared = context.state === 'running';
      if (!session.audioPrepared) throw new Error('Audio could not start. You can continue by typing.');
      if (!alive()) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!alive()) { stream.getTracks().forEach(track => track.stop()); return; }
      session.stream = stream;
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
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
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
      const offer = await peer.createOffer(); if (!alive()) return;
      await peer.setLocalDescription(offer); if (!alive()) return;
      const response = await fetch(`/api/visitor/${encodeURIComponent(options.slug)}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, signal: session.controller.signal,
        body: JSON.stringify({ requestId: crypto.randomUUID(), sdp: offer.sdp, context: options.getContext(), history: options.history }),
      });
      if (!alive()) { await response.body?.cancel().catch(() => undefined); return; }
      if (!response.ok) {
        const error = await response.json().catch(() => null); const availability = visitorAvailabilitySchema.safeParse(error?.availability);
        if (availability.success) options.onAvailability(availability.data);
        throw new Error(typeof error?.error === 'string' ? error.error : 'The voice connection is unavailable.');
      }
      if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('The voice connection returned an invalid response.');
      await readVisitorRealtimeEvents(response.body, session.controller.signal, async event => {
        if (!alive()) return;
        if (event.type === 'session') {
          if (session.sdpReady) throw new Error('The voice connection returned a duplicate session.');
          options.onAvailability(event.availability); session.control = event.control;
          const remaining = Math.min(VISITOR_SESSION_MS, event.expiresAt - Date.now());
          if (remaining <= 0) throw new Error('This voice session expired. Tap the wave to start again.');
          session.sessionTimer = setTimeout(() => { if (alive()) stop('Conversation paused. Tap the wave to start again.'); }, remaining);
          await peer.setRemoteDescription({ type: 'answer', sdp: event.sdp }); if (!alive()) return;
          session.sdpReady = true; readinessChanged(); return;
        }
        if (event.type === 'error') { if (event.availability) options.onAvailability(event.availability); fail(session, event.message); return; }
        if (event.type === 'ended') { stop(event.message); return; }
        if (event.type === 'ping') return;
        if (!session.sdpReady) throw new Error('The voice connection was not ready.');
        if (event.type === 'ready') { session.serverReady = true; readinessChanged(); }
        else if (event.type === 'control_applied') {
          if (event.seq <= session.ackSeq) return;
          const sent = session.sent.get(event.seq);
          if (!sent || sent.interactionRevision !== event.interactionRevision || sent.ready !== event.ready) throw new Error('The voice connection returned an invalid view acknowledgment.');
          session.ackSeq = event.seq; session.revision = Math.max(session.revision, event.revision);
          for (const seq of session.sent.keys()) if (seq <= event.seq) session.sent.delete(seq);
          armAckDeadline();
          session.appliedInteractionRevision = event.interactionRevision;
          if (event.ready) session.readyAcknowledged = true;
          if (event.ready && event.interactionRevision === session.interactionRevision) {
            stream.getAudioTracks().forEach(track => { track.enabled = true; }); setUpdating(false);
          }
          restingPhase();
        } else if (event.type === 'availability') options.onAvailability(event.availability);
        else if (event.type === 'transcript') {
          // An accepted user utterance remains history even if they then browse.
          if (session.transcripts.has(event.id) || event.role === 'assistant' && event.interactionRevision !== session.interactionRevision) return;
          session.transcripts.add(event.id); options.onTranscript(event);
        } else if (event.type === 'speech_started') {
          if (session.appliedInteractionRevision !== session.interactionRevision) return;
          session.revision = Math.max(session.revision, event.revision); session.navigation?.abort();
          session.userSpeaking = true; session.speaking = false; session.thinking = false; session.playingId = undefined; restingPhase();
        } else if (event.type === 'speech_stopped') { if (session.appliedInteractionRevision !== session.interactionRevision) return; session.userSpeaking = false; session.thinking = true; restingPhase(); }
        else if (event.type === 'response_started') {
          if (event.interactionRevision !== session.interactionRevision || event.revision < session.revision) return;
          session.revision = event.revision; session.thinking = true; restingPhase();
        } else if (event.type === 'playback_started') {
          if (event.interactionRevision !== session.interactionRevision) return;
          audio.muted = false; session.playingId = event.responseId; session.speaking = true; session.thinking = false; restingPhase();
        } else if (event.type === 'playback_stopped' || event.type === 'playback_cleared') {
          if (!session.playingId || event.responseId && event.responseId !== session.playingId) return;
          session.playingId = undefined; session.speaking = false; session.thinking = false; restingPhase();
        } else if (event.type === 'plan') {
          if (event.interactionRevision !== session.interactionRevision || event.revision !== session.revision || event.revision <= session.planRevision) return;
          options.onPlan(event); session.planRevision = event.revision; session.viewRevision = event.revision; session.queue(true);
        } else if (event.type === 'navigation') {
          if (event.interactionRevision !== session.interactionRevision || event.revision !== session.revision) return;
          session.navigation?.abort(); const navigation = new AbortController(); session.navigation = navigation;
          void options.onNavigate(event, navigation.signal).then(status => {
            if (!alive() || navigation.signal.aborted || event.interactionRevision !== session.interactionRevision) return;
            session.navigationAck = { id: event.id, status }; session.queue(true);
          }).catch(() => { if (alive() && !navigation.signal.aborted) { session.navigationAck = { id: event.id, status: 'unavailable' }; session.queue(true); } });
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
  return { phase, message, active, updating, inputAnalyser, outputAnalyser, start, stop, manualInterrupt, updateContext };
}
