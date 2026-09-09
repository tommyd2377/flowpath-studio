'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The editor and site preview share the browser's speech queue.
let stopActiveGreeting: (() => void) | null = null;

export function useGreetingPlayback(text: string) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(function stopPlayback() {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    if (utterance.current) {
      utterance.current.onend = null;
      utterance.current.onerror = null;
      utterance.current = null;
      window.speechSynthesis.cancel();
    }
    if (stopActiveGreeting === stopPlayback) stopActiveGreeting = null;
    setPlaying(false);
  }, []);

  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', stop);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', stop);
    };
  }, [text, stop]);

  function play() {
    stopActiveGreeting?.();
    setError('');
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setError('Audio playback is unavailable in this browser. You can still read and save your welcome message.');
      return;
    }
    try {
      // Never fall back to a remote voice or an AI request for a preview.
      const voices = window.speechSynthesis.getVoices().filter(voice => voice.localService);
      const voice = voices.find(voice => voice.lang.toLowerCase().startsWith('en') && voice.default)
        || voices.find(voice => voice.lang.toLowerCase().startsWith('en')) || voices[0];
      if (!voice) {
        setError('No installed device voice is available yet. Try Listen again once your browser has loaded its voices.');
        return;
      }
      const next = new SpeechSynthesisUtterance(text);
      next.voice = voice;
      next.lang = voice.lang;
      next.onend = () => {
        if (utterance.current !== next) return;
        utterance.current = null;
        stop();
      };
      next.onerror = () => {
        if (utterance.current !== next) return;
        stop();
        setError('The welcome message could not be played. You can try listening again.');
      };
      utterance.current = next;
      stopActiveGreeting = stop;
      setPlaying(true);
      timeout.current = setTimeout(() => {
        stop();
        setError('Playback stopped after one minute. Try a shorter welcome message.');
      }, 60_000);
      window.speechSynthesis.speak(next);
    } catch {
      stop();
      setError('The welcome message could not be played. You can try listening again.');
    }
  }

  return { playing, error, play, stop };
}
