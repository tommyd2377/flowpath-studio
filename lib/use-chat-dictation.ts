'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { chatSpeechRecognition, createChatDictation, type ChatDictationState, type ChatSpeechRecognitionWindow } from './chat-dictation';
import { browserChatAudioEnvironment, createChatAudioDictation, type ChatTranscribe } from './chat-audio-dictation';

function browserRecognition() {
  return typeof window === 'undefined' ? undefined : chatSpeechRecognition(window as ChatSpeechRecognitionWindow);
}

const subscribeSupport = () => () => {};
const browserSupported = () => Boolean(browserRecognition());
const recordingSupported = () => Boolean(browserChatAudioEnvironment());
const serverSupported = () => false;

export function useChatDictation({ text, onText, enabled, language, maxLength = 2000, transcribe }: {
  text: string;
  onText: (text: string) => void;
  enabled: boolean;
  language?: string;
  maxLength?: number;
  transcribe?: ChatTranscribe;
}) {
  const [state, setState] = useState<ChatDictationState>({ status: 'idle', message: '' });
  const supported = useSyncExternalStore(subscribeSupport, transcribe ? recordingSupported : browserSupported, serverSupported);
  const latest = useRef({ text, onText });
  type Native = ReturnType<typeof createChatDictation>;
  type Recorded = ReturnType<typeof createChatAudioDictation>;
  const current = useRef<{ native: Native; recorded: Recorded; active?: { kind: 'native' | 'recorded'; controller: Native | Recorded } } | null>(null);

  useLayoutEffect(() => {
    latest.current = { text, onText };
    const active = current.current?.active;
    active?.controller.syncText(text);
    if (!enabled || active && (active.kind === 'recorded') !== Boolean(transcribe)) active?.controller.stop();
  }, [text, onText, enabled, transcribe]);

  useEffect(() => {
    const options = {
      getText: () => latest.current.text,
      onText: (value: string) => {
        // Acknowledge our own update before React renders or another result arrives.
        latest.current.text = value;
        latest.current.onText(value);
      },
      onState: setState,
    };
    const native = createChatDictation({ ...options, getRecognition: browserRecognition });
    const recorded = createChatAudioDictation({ ...options, getEnvironment: browserChatAudioEnvironment });
    current.current = { native, recorded };
    const hide = () => { if (document.hidden) current.current?.active?.controller.stop(); };
    const leave = () => current.current?.active?.controller.stop();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => {
      current.current = null;
      native.dispose(); recorded.dispose();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', leave);
    };
  }, []);

  const start = useCallback(() => {
    const controllers = current.current;
    if (!enabled || document.hidden || !controllers) return;
    const kind = transcribe ? 'recorded' : 'native';
    if (controllers.active && controllers.active.kind !== kind) controllers.active.controller.stop();
    controllers.active = { kind, controller: transcribe ? controllers.recorded : controllers.native };
    if (transcribe) controllers.recorded.start({ transcribe, maxLength });
    else controllers.native.start({ language, maxLength });
  }, [enabled, language, maxLength, transcribe]);
  const stop = useCallback(() => current.current?.active?.controller.stop(), []);
  const finish = useCallback(() => current.current?.active?.controller.finish(), []);

  return { ...state, supported, isListening: state.status === 'starting' || state.status === 'listening', isTranscribing: state.status === 'transcribing', start, finish, stop };
}
