import { encodeRecording } from './visitor-audio';
import { MAX_RECORDING_SECONDS } from './visitor-model';
import type { ChatDictationState } from './chat-dictation';

export type ChatTranscribe = (audioPcmBase64: string, signal: AbortSignal) => Promise<string>;
export type ChatAudioEnvironment = {
  getUserMedia: () => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => MediaRecorder;
  createContext: () => AudioContext;
};

const MAX_ENCODED_BYTES = 2_000_000;
const STAGE_TIMEOUT_MS = 30_000;

/** Feature detection only; nothing asks for permission or opens audio until start(). */
export function browserChatAudioEnvironment(): ChatAudioEnvironment | undefined {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder || !window.AudioContext) return;
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }),
    createRecorder: stream => {
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
      return new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
    },
    createContext: () => new AudioContext(),
  };
}

function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow access for this site, or type your message.';
  if (name === 'NotFoundError' || name === 'NotReadableError') return 'Your microphone is unavailable. Check it, or type your message.';
  return 'The microphone could not start. Try again, or type your message.';
}

/** One bounded recording and one transcription; no provider fallback or retries. */
export function createChatAudioDictation(options: {
  getEnvironment: () => ChatAudioEnvironment | undefined;
  getText: () => string;
  onText: (text: string) => void;
  onState: (state: ChatDictationState) => void;
}) {
  type Session = {
    baseText: string; writtenText: string; maxLength: number;
    transcribe: ChatTranscribe; environment: ChatAudioEnvironment;
    controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder; context?: AudioContext;
    chunks: Blob[]; bytes: number; finishing: boolean; processing: boolean;
    timer?: ReturnType<typeof setTimeout>;
  };
  let current: Session | undefined;
  let disposed = false;
  let state: ChatDictationState = { status: 'idle', message: '' };

  function updateState(status: ChatDictationState['status'], message = '') {
    if (disposed || state.status === status && state.message === message) return;
    state = { status, message }; options.onState(state);
  }

  function stopTracks(stream?: MediaStream) {
    stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  }

  async function closeContext(session: Session) {
    const context = session.context; session.context = undefined;
    if (context && context.state !== 'closed') { try { await context.close(); } catch { /* The browser may already have released it. */ } }
  }

  function release() {
    const session = current; current = undefined;
    if (!session) return;
    session.controller.abort(); clearTimeout(session.timer);
    if (session.recorder) {
      session.recorder.ondataavailable = session.recorder.onstop = session.recorder.onerror = null;
      if (session.recorder.state !== 'inactive') { try { session.recorder.stop(); } catch { /* Already stopped by the browser. */ } }
    }
    stopTracks(session.stream); session.stream = undefined; session.chunks = [];
    void closeContext(session);
  }

  function stop() { release(); updateState('idle'); }
  function fail(session: Session, message: string) {
    if (current !== session) return;
    release(); updateState('error', message);
  }

  function alive(session: Session) {
    if (current !== session || disposed) return false;
    if (options.getText() !== session.writtenText) { stop(); return false; }
    return true;
  }

  async function transcribe(session: Session) {
    if (!alive(session) || session.processing) return;
    session.processing = true;
    const recorder = session.recorder!;
    recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
    stopTracks(session.stream); session.stream = undefined;
    try {
      if (!session.bytes) { fail(session, 'No audio was recorded. Try again, or type your message.'); return; }
      const blob = new Blob(session.chunks, { type: recorder.mimeType }); session.chunks = [];
      const encoded = await blob.arrayBuffer();
      if (!alive(session)) return;
      const context = session.environment.createContext(); session.context = context;
      const decoded = await context.decodeAudioData(encoded);
      if (!alive(session)) return;
      if (!Number.isFinite(decoded.sampleRate) || decoded.sampleRate < 8000 || decoded.sampleRate > 192_000
        || decoded.numberOfChannels < 1 || decoded.numberOfChannels > 8) throw new Error('Unsupported recording.');
      // Downmix and truncate before encoding; the server can verify duration from PCM bytes.
      const length = Math.min(decoded.length, Math.floor(decoded.sampleRate * MAX_RECORDING_SECONDS));
      const mono = new Float32Array(length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const samples = decoded.getChannelData(channel);
        for (let frame = 0; frame < length; frame++) mono[frame] += samples[frame] / decoded.numberOfChannels;
      }
      const audio = encodeRecording([mono], decoded.sampleRate);
      await closeContext(session);
      if (!alive(session)) return;
      let transcript: string;
      try { transcript = await session.transcribe(audio, session.controller.signal); }
      catch (error) {
        if (alive(session)) fail(session, error instanceof Error && error.message ? error.message.slice(0, 300) : 'Could not transcribe your message. Try again, or type it.');
        return;
      }
      if (!alive(session)) return;
      if (typeof transcript !== 'string' || !transcript.trim()) { fail(session, 'No speech was heard. Try again, or type your message.'); return; }
      const separator = session.baseText && !/\s$/.test(session.baseText) ? ' ' : '';
      const combined = `${session.baseText}${separator}${transcript.trim()}`;
      const next = combined.slice(0, session.maxLength);
      if (next !== session.writtenText) { session.writtenText = next; options.onText(next); }
      release(); updateState('idle', combined.length > session.maxLength ? 'Your message is full. Review it before sending.' : 'Review your message, then send.');
    } catch {
      if (alive(session)) fail(session, 'The recording could not be read. Speak for at least a moment, then try again.');
    }
  }

  function finishSession(session: Session) {
    if (!alive(session) || session.finishing) return;
    if (!session.recorder) { stop(); return; }
    session.finishing = true; clearTimeout(session.timer);
    updateState('transcribing', 'Transcribing your message…');
    session.timer = setTimeout(() => fail(session, 'Transcription timed out. Try again, or type your message.'), STAGE_TIMEOUT_MS);
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      // The final dataavailable and stop events are queued by stop(). Release the mic now.
      stopTracks(session.stream); session.stream = undefined;
    } catch { fail(session, 'The recording could not finish. Try again, or type your message.'); }
  }

  async function startRecording(session: Session) {
    try {
      const stream = await session.environment.getUserMedia();
      if (!alive(session)) { stopTracks(stream); return; }
      session.stream = stream;
      stream.getTracks().forEach(track => { track.onended = () => fail(session, 'The microphone disconnected. Try again, or type your message.'); });
      const recorder = session.environment.createRecorder(stream); session.recorder = recorder;
      recorder.ondataavailable = event => {
        if (!alive(session) || session.processing || !event.data.size) return;
        session.bytes += event.data.size;
        if (session.bytes > MAX_ENCODED_BYTES) { fail(session, 'The recording was too large. Try a shorter message.'); return; }
        session.chunks.push(event.data);
      };
      recorder.onerror = () => fail(session, 'Recording was interrupted. Try again, or type your message.');
      recorder.onstop = () => {
        if (!alive(session)) return;
        if (session.finishing) void transcribe(session);
        else fail(session, 'Recording ended unexpectedly. Try again, or type your message.');
      };
      recorder.start(250);
      if (!alive(session)) return;
      clearTimeout(session.timer);
      updateState('listening', 'Listening… Stop when you finish. Up to 20 seconds.');
      session.timer = setTimeout(() => finishSession(session), MAX_RECORDING_SECONDS * 1000);
    } catch (error) { if (alive(session)) fail(session, microphoneError(error)); }
  }

  return {
    start({ transcribe, maxLength = 2000 }: { transcribe: ChatTranscribe; maxLength?: number }) {
      if (current || disposed) return;
      const environment = options.getEnvironment();
      if (!environment) { updateState('unsupported', 'Recording is unavailable in this browser. Use a secure connection, or type your message.'); return; }
      const baseText = options.getText();
      if (baseText.length >= maxLength) { updateState('idle', 'Your message is full. Review it before sending.'); return; }
      const session: Session = { baseText, writtenText: baseText, maxLength, transcribe, environment, controller: new AbortController(), chunks: [], bytes: 0, finishing: false, processing: false };
      current = session;
      updateState('starting', 'Allow microphone access to dictate.');
      session.timer = setTimeout(() => fail(session, 'Microphone access timed out. Try again, or type your message.'), STAGE_TIMEOUT_MS);
      void startRecording(session);
    },
    syncText(text: string) { if (current && text !== current.writtenText) stop(); },
    finish() { if (current) finishSession(current); },
    stop,
    dispose() { disposed = true; release(); },
  };
}
