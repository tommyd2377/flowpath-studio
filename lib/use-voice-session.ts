'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '@/components/Waveform';
import { monitorAudio, waitForIce } from './voice-session';

type VoiceSession = {
  id: string;
  controller: AbortController;
  requested: boolean;
  ready: boolean;
  answerApplied: boolean;
  started: boolean;
  finalized: boolean;
  needsAudioResume: boolean;
  lastActivity: number;
  expiresAt?: number;
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
};

async function deleteSession(id: string) {
  try {
    const response = await fetch('/api/session', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
      keepalive: true,
      signal: AbortSignal.timeout(20_000),
    });
    return response.ok;
  } catch { return false; }
}

async function errorMessage(response: Response) {
  try {
    const body: unknown = await response.json();
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
  if (session.closePromise) {
    if (leaving) {
      if (session.requested) void deleteSession(session.id);
      releaseMedia(session);
    }
    return session.closePromise;
  }
  session.controller.abort();
  clearTimeout(session.setupTimer);
  clearTimeout(session.disconnectTimer);
  clearInterval(session.tick);
  session.stopMonitor?.();
  // End capture immediately, while the event connection can finish its close.
  session.microphone?.getTracks().forEach(track => { track.onended = null; track.enabled = false; track.stop(); });
  if (session.audio) { session.audio.muted = true; session.audio.pause(); }

  if (leaving) {
    if (session.ready && session.channel?.readyState === 'open') {
      try { session.channel.send(JSON.stringify({ type: 'session.close' })); } catch { /* Server closes below. */ }
    }
    session.closePromise = session.requested ? deleteSession(session.id) : Promise.resolve(true);
    releaseMedia(session);
    return session.closePromise;
  }

  session.closePromise = (async () => {
    let finalized = session.finalized;
    if (!finalized && session.ready && session.channel?.readyState === 'open' && !leaving) {
      finalized = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 15_000);
        session.acknowledgeClose = () => { clearTimeout(timer); resolve(true); };
        try { session.channel!.send(JSON.stringify({ type: 'session.close' })); }
        catch { clearTimeout(timer); resolve(false); }
      });
    }
    const serverClosed = session.requested ? await deleteSession(session.id) : true;
    return finalized || serverClosed;
  })().finally(() => releaseMedia(session));
  return session.closePromise;
}

export function useVoiceSession() {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('');
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const [needsAudioResume, setNeedsAudioResume] = useState(false);
  const current = useRef<VoiceSession | null>(null);
  const closing = useRef<Promise<boolean> | null>(null);
  const closingSession = useRef<VoiceSession | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);

  const stop = useCallback((notice = '') => {
    const session = current.current;
    if (!session) return;
    current.current = null;
    const stoppedRevision = ++revision.current;
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
      if (closing.current === promise) { closing.current = null; closingSession.current = null; }
      if (!mounted.current || revision.current !== stoppedRevision) return;
      if (closed) setStatus(notice);
      else {
        setPhase('error');
        setStatus('Your microphone is off, but disconnection could not be confirmed. Wait for the session limit before reconnecting.');
      }
    });
  }, []);

  const fail = useCallback((session: VoiceSession, notice: string) => {
    if (current.current !== session) return;
    stop(notice);
    if (mounted.current) { setPhase('error'); setStatus(notice); }
  }, [stop]);

  const start = useCallback(async () => {
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
        setStatus('');
      } catch { setStatus('Playback is still blocked. Tap the wave to resume audio.'); }
      return;
    }

    const session: VoiceSession = {
      id: crypto.randomUUID(), controller: new AbortController(), requested: false,
      ready: false, started: false, answerApplied: false, finalized: false,
      needsAudioResume: false, lastActivity: Date.now(),
    };
    current.current = session;
    revision.current++;
    setActive(true);
    setPhase('connecting');
    setStatus('');
    const alive = () => mounted.current && current.current === session;
    const becomeReady = () => {
      if (!alive() || session.ready || !session.started || !session.answerApplied) return;
      session.ready = true;
      session.lastActivity = Date.now();
      clearTimeout(session.setupTimer);
      setPhase('listening');
    };

    try {
      const readiness = await fetch('/api/session', { cache: 'no-store', signal: session.controller.signal });
      if (!readiness.ok) throw new Error(await errorMessage(readiness));
      const config: unknown = await readiness.json();
      if (!alive()) return;
      if (!config || typeof config !== 'object' || !('enabled' in config) || config.enabled !== true) {
        const message = config && typeof config === 'object' && 'message' in config && typeof config.message === 'string'
          ? config.message : 'Voice is disabled for this local preview.';
        stop(message);
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
        if (!event || typeof event !== 'object' || !('type' in event)) return;
        if (event.type === 'session.closed') {
          session.finalized = true;
          session.acknowledgeClose?.();
          if (alive()) stop('Conversation ended.');
        } else if (alive() && event.type === 'session.started') {
          session.started = true;
          becomeReady();
        } else if (alive() && event.type === 'error') {
          fail(session, 'The voice connection encountered an error. Tap the wave to reconnect.');
        }
      };
      channel.onclose = () => {
        if (alive() && !session.finalized) fail(session, 'The conversation disconnected. Tap the wave to reconnect.');
      };
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
      session.stopMonitor = monitorAudio(input, () => session.output, (inputActive, outputActive) => {
        if (!alive() || !session.ready) return;
        if (inputActive || outputActive) session.lastActivity = Date.now();
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
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, sessionId: session.id }), signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      const result: unknown = await response.json();
      if (!alive()) { void deleteSession(session.id); return; }
      if (!result || typeof result !== 'object' || !('sdp' in result) || typeof result.sdp !== 'string'
        || !('sessionId' in result) || result.sessionId !== session.id || !('expiresAt' in result)
        || typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt)) {
        throw new Error('The server returned an invalid voice connection.');
      }
      session.expiresAt = result.expiresAt;
      await peer.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      if (!alive()) return;
      session.answerApplied = true;
      becomeReady();
      const tick = () => {
        if (!alive()) return;
        const remaining = Math.max(0, Math.ceil((session.expiresAt! - Date.now()) / 1000));
        setRemainingSeconds(remaining);
        if (!remaining) stop('The three-minute conversation has ended.');
        else if (session.ready && Date.now() - session.lastActivity >= 45_000) stop('Conversation ended after 45 seconds of silence.');
      };
      session.tick = setInterval(tick, 1_000);
      tick();
    } catch (error) {
      if (!alive()) return;
      const notice = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Microphone access was denied. Allow microphone access to start a conversation.'
        : error instanceof Error ? error.message : 'The voice connection is unavailable. Tap the wave to try again.';
      fail(session, notice);
    }
  }, [fail, stop]);

  useEffect(() => {
    mounted.current = true;
    const leave = () => {
      const session = current.current ?? closingSession.current;
      current.current = null;
      revision.current++;
      if (session) void dispose(session, true);
      if (mounted.current) {
        setActive(false);
        setNeedsAudioResume(false);
        setPhase('idle');
        setStatus('');
        setRemainingSeconds(null);
        setInputAnalyser(null);
        setOutputAnalyser(null);
      }
    };
    window.addEventListener('pagehide', leave);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, []);

  return { phase, active, status, remainingSeconds, inputAnalyser, outputAnalyser, needsAudioResume, start, stop };
}
