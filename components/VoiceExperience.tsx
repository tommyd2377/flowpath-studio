'use client';

import Image from 'next/image';
import { useEffect } from 'react';
import { useVoiceSession } from '@/lib/use-voice-session';
import Waveform from './Waveform';
import PersonalFooter from './PersonalFooter';

export default function VoiceExperience() {
  const voice = useVoiceSession();
  const { active, stop } = voice;
  const connected = voice.phase === 'listening' || voice.phase === 'speaking';
  const label = voice.needsAudioResume ? 'Resume voice playback' : voice.active
    ? voice.phase === 'connecting' ? 'Cancel connection' : 'End conversation'
    : 'Start conversation';
  const showStatus = !connected || voice.needsAudioResume || (voice.remainingSeconds !== null && voice.remainingSeconds <= 15);
  const status = connected && !voice.needsAudioResume && voice.remainingSeconds !== null && voice.remainingSeconds <= 15
    ? `${voice.remainingSeconds} seconds remaining in this local session.` : voice.status;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active) void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);

  return <div className="voice-experience" data-active={voice.active} data-connected={connected}>
    <main className="voice-page" data-voice-phase={voice.phase}>
      <header className="wordmark" aria-hidden={connected}>
        <Image src="/brand/flowpath-logo-full.png" alt="FlowPath" width={1536} height={1024} priority />
      </header>
      <button className="wave-control" type="button" aria-label={label} aria-pressed={voice.active}
        aria-describedby={showStatus && status ? 'voice-status' : !connected ? 'voice-hint' : undefined}
        onClick={() => { if (voice.needsAudioResume || !voice.active) void voice.start(); else void voice.stop(); }}>
        <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser} />
      </button>
      <p className="voice-hint" id="voice-hint" aria-hidden={connected}>Tap the wave whenever you’re ready</p>
      <p className="voice-status" id="voice-status" role="status" aria-live="polite" aria-atomic="true">{showStatus ? status : ''}</p>
      <span className="sr-only">{connected ? 'Conversation connected. Tap the waveform or press Escape to end.' : ''}</span>
    </main>
    <div className="footer-position" hidden={voice.active}><PersonalFooter /></div>
  </div>;
}
