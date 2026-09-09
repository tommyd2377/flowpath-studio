'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { decodeReply, encodeRecording } from './visitor-audio';
import { MAX_RECORDING_SECONDS, type VisitorReply } from './visitor-model';
import type { VoicePhase } from '@/components/Waveform';

type Reply = Pick<VisitorReply, 'text' | 'audio'>;
type Resources = {
  context?: AudioContext; stream?: MediaStream; worklet?: AudioWorkletNode; source?: AudioBufferSourceNode;
  utterance?: SpeechSynthesisUtterance; timer?: ReturnType<typeof setTimeout>; controller?: AbortController;
  chunks: Float32Array[]; length: number; send?: (audio: string, signal: AbortSignal) => Promise<Reply>;
};
export function useVisitorVoice() {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [error, setError] = useState('');
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const current = useRef<Resources>({ chunks: [], length: 0 });
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current++;
    const resources = current.current;
    current.current = { chunks: [], length: 0 };
    clearTimeout(resources.timer);
    resources.controller?.abort();
    resources.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (resources.worklet) { resources.worklet.port.onmessage = null; resources.worklet.disconnect(); }
    if (resources.source) { resources.source.onended = null; try { resources.source.stop(); } catch {} }
    if (resources.utterance) {
      resources.utterance.onend = null; resources.utterance.onerror = null;
      window.speechSynthesis.cancel();
    }
    if (resources.context?.state !== 'closed') void resources.context?.close().catch(() => undefined);
    setPhase('idle'); setError(''); setInputAnalyser(null); setOutputAnalyser(null);
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel(); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', cancel);
    };
  }, [cancel]);
  function fail(reason: unknown, id: number) {
    if (generation.current !== id) return;
    cancel();
    setError(reason instanceof Error ? reason.message : 'Voice is unavailable. Please try again.');
  }
  function play(reply: Reply, id: number) {
    if (generation.current !== id) return;
    const resources = current.current;
    setPhase('speaking');
    if (!reply.audio) {
      if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) throw new Error('This browser cannot play the demo voice. You can still preview chat.');
      const voices = window.speechSynthesis.getVoices().filter(voice => voice.localService);
      const voice = voices.find(voice => voice.lang.startsWith('en')) || voices[0];
      if (!voice) throw new Error('No installed device voice is available for this demo. Published voice uses the selected AI voice.');
      const utterance = new SpeechSynthesisUtterance(reply.text);
      utterance.voice = voice; utterance.lang = voice.lang;
      utterance.onend = () => { if (generation.current === id) cancel(); };
      utterance.onerror = () => fail(new Error('The demo voice could not be played.'), id);
      resources.utterance = utterance;
      window.speechSynthesis.speak(utterance);
      resources.timer = setTimeout(() => { if (generation.current === id) cancel(); }, 60_000);
      return;
    }
    const context = resources.context!;
    const source = context.createBufferSource();
    source.buffer = decodeReply(context, reply.audio);
    const analyser = context.createAnalyser();
    source.connect(analyser); analyser.connect(context.destination);
    setOutputAnalyser(analyser);
    resources.source = source;
    source.onended = () => { if (generation.current === id) cancel(); };
    resources.timer = setTimeout(() => { if (generation.current === id) cancel(); }, (source.buffer.duration + 1) * 1000);
    source.start();
  }
  async function respond(send: (signal: AbortSignal) => Promise<Reply>, demo = false) {
    cancel(); setError(''); setPhase('thinking');
    const id = generation.current;
    const controller = new AbortController(); current.current.controller = controller;
    try {
      if (!demo) {
        const context = new AudioContext(); current.current.context = context;
        await context.resume();
        if (generation.current !== id) return;
      }
      const reply = await send(controller.signal);
      if (generation.current === id) play(reply, id);
    } catch (error) { fail(error, id); }
  }
  async function finishRecording() {
    const resources = current.current;
    if (!resources.stream || !resources.context || !resources.send) return;
    const id = generation.current;
    clearTimeout(resources.timer);
    resources.stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    resources.stream = undefined;
    if (resources.worklet) { resources.worklet.port.onmessage = null; resources.worklet.disconnect(); resources.worklet = undefined; }
    setInputAnalyser(null); setPhase('thinking');
    try {
      const audio = encodeRecording(resources.chunks, resources.context.sampleRate);
      resources.chunks = [];
      const reply = await resources.send(audio, resources.controller!.signal);
      if (generation.current === id) play(reply, id);
    } catch (error) { fail(error, id); }
  }
  async function record(send: (audio: string, signal: AbortSignal) => Promise<Reply>) {
    cancel(); setError(''); setPhase('connecting');
    const id = generation.current;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') throw new Error('Voice recording is unavailable in this browser.');
      const resources = current.current;
      resources.controller = new AbortController(); resources.send = send;
      const context = new AudioContext(); resources.context = context;
      await context.resume();
      if (generation.current !== id) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (generation.current !== id) { stream.getTracks().forEach(track => track.stop()); return; }
      resources.stream = stream;
      stream.getTracks().forEach(track => { track.onended = () => fail(new Error('The microphone disconnected.'), id); });
      await context.audioWorklet.addModule('/visitor-recorder.js');
      if (generation.current !== id) return;
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      const worklet = new AudioWorkletNode(context, 'visitor-recorder');
      const mute = context.createGain(); mute.gain.value = 0;
      source.connect(analyser); analyser.connect(worklet); worklet.connect(mute); mute.connect(context.destination);
      resources.worklet = worklet;
      worklet.port.onmessage = event => {
        if (generation.current !== id || !resources.stream) return;
        const samples = new Float32Array(event.data);
        resources.chunks.push(samples); resources.length += samples.length;
        if (resources.length >= context.sampleRate * MAX_RECORDING_SECONDS) void finishRecording();
      };
      resources.timer = setTimeout(() => void finishRecording(), MAX_RECORDING_SECONDS * 1000);
      setInputAnalyser(analyser); setPhase('listening');
    } catch (error) { fail(error, id); }
  }
  return { phase, error, inputAnalyser, outputAnalyser, cancel, respond, record, finishRecording };
}
