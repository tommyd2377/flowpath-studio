export type ChatDictationState = {
  status: 'idle' | 'starting' | 'listening' | 'transcribing' | 'unsupported' | 'error';
  message: string;
};

export type ChatSpeechResultEvent = {
  results: ArrayLike<{ readonly [index: number]: { transcript: string }; isFinal: boolean }>;
};

// Speech recognition is still prefixed in some browsers and absent from lib.dom.
export type ChatSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: ChatSpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onnomatch: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};

export type ChatSpeechRecognitionConstructor = new () => ChatSpeechRecognition;
export type ChatSpeechRecognitionWindow = {
  SpeechRecognition?: ChatSpeechRecognitionConstructor;
  webkitSpeechRecognition?: ChatSpeechRecognitionConstructor;
};

export function chatSpeechRecognition(scope: ChatSpeechRecognitionWindow) {
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

const unsupportedMessage = 'Dictation is unavailable in this browser. You can still type your message.';
const noSpeechMessage = 'No speech was heard. Try the microphone again, or type your message.';

function errorMessage(code: string) {
  switch (code) {
    case 'not-allowed': case 'NotAllowedError': case 'SecurityError':
      return 'Microphone access was blocked. Allow microphone access for this site in your browser settings, or type your message.';
    case 'service-not-allowed':
      return 'Your browser blocked its dictation service. You can still type your message.';
    case 'audio-capture': case 'NotFoundError': case 'NotReadableError':
      return 'Your microphone is unavailable. Check that it is connected and available, or type your message.';
    case 'network':
      return 'Your browser could not reach its dictation service. Check your connection and try again, or type your message.';
    case 'no-speech':
      return noSpeechMessage;
    case 'language-not-supported':
      return 'Your browser does not support dictation in this language. You can still type your message.';
    default:
      return 'Dictation could not start or was interrupted. Try the microphone again, or type your message.';
  }
}

/** One deliberate recognition attempt. This never sends chat or starts Live voice. */
export function createChatDictation(options: {
  getRecognition: () => ChatSpeechRecognitionConstructor | undefined;
  getText: () => string;
  onText: (text: string) => void;
  onState: (state: ChatDictationState) => void;
}) {
  type Session = {
    recognition: ChatSpeechRecognition;
    baseText: string;
    writtenText: string;
    limit: number;
    timer?: ReturnType<typeof setTimeout>;
  };
  let current: Session | undefined;
  let disposed = false;
  let state: ChatDictationState = { status: 'idle', message: '' };

  function updateState(status: ChatDictationState['status'], message = '') {
    if (disposed || state.status === status && state.message === message) return;
    state = { status, message }; options.onState(state);
  }

  function release(abort: boolean) {
    const session = current; current = undefined;
    if (!session) return;
    clearTimeout(session.timer);
    const recognition = session.recognition;
    recognition.onstart = recognition.onresult = recognition.onerror = recognition.onnomatch = recognition.onend = null;
    if (abort) { try { recognition.abort(); } catch { /* Already stopped by the browser. */ } }
  }

  function finish(status: ChatDictationState['status'], message = '', abort = true) {
    release(abort); updateState(status, message);
  }

  function alive(session: Session) {
    if (current !== session || disposed) return false;
    if (options.getText() !== session.writtenText) { finish('idle'); return false; }
    return true;
  }

  return {
    start({ language, maxLength = 2000 }: { language?: string; maxLength?: number } = {}) {
      if (current || disposed) return;
      const Recognition = options.getRecognition();
      if (!Recognition) { updateState('unsupported', unsupportedMessage); return; }
      try {
        const recognition = new Recognition();
        const baseText = options.getText();
        const session: Session = { recognition, baseText, writtenText: baseText, limit: Math.max(baseText.length, maxLength) };
        current = session;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        if (language) recognition.lang = language;
        recognition.onstart = () => { if (alive(session)) updateState('listening', 'Listening… Speak your message, then stop to review.'); };
        recognition.onresult = event => {
          if (!alive(session)) return;
          // Each event contains the whole session, including replaced/removed interim results.
          const transcript = Array.from(event.results, result => result[0]?.transcript.trim() ?? '').filter(Boolean).join(' ');
          const separator = baseText && !/\s$/.test(baseText) ? ' ' : '';
          const combined = transcript ? `${baseText}${separator}${transcript}` : baseText;
          const next = combined.slice(0, session.limit);
          if (next !== session.writtenText) { session.writtenText = next; options.onText(next); }
          if (combined.length >= session.limit) finish('idle', 'Your message is full. Review it before sending.');
        };
        recognition.onerror = event => {
          if (current !== session) return;
          if (event.error === 'aborted') finish('idle');
          else finish('error', errorMessage(event.error));
        };
        recognition.onnomatch = () => { if (current === session) finish('error', noSpeechMessage); };
        recognition.onend = () => {
          if (!alive(session)) return;
          const hasText = session.writtenText !== baseText;
          finish(hasText ? 'idle' : 'error', hasText ? 'Dictation ready. Review your message, then send.' : noSpeechMessage, false);
        };
        updateState('starting', 'Starting dictation… Allow microphone access if your browser asks.');
        session.timer = setTimeout(() => {
          if (current === session) finish('idle', 'Dictation stopped after one minute. Review your message, or use the microphone again.');
        }, 60_000);
        recognition.start();
      } catch (error) {
        finish('error', errorMessage(error instanceof Error ? error.name : 'unknown'));
      }
    },
    syncText(text: string) {
      if (current && text !== current.writtenText) finish('idle');
    },
    // Keep the visible draft, including interim words; discard all later callbacks.
    stop() { finish('idle'); },
    finish() { finish('idle'); },
    dispose() { disposed = true; release(true); },
  };
}
