'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect } from 'react';
import { useVoiceSession } from '@/lib/use-voice-session';
import Waveform from './Waveform';
import PersonalFooter from './PersonalFooter';
import { appearanceTheme } from '@/lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '@/lib/account-model';

export default function VoiceExperience({ waveformId, name, accentColor = WAVEFORM_DEFAULT_COLOR, profilePhoto = null }: {
  waveformId?: string; name?: string; accentColor?: string; profilePhoto?: string | null;
}) {
  const voice = useVoiceSession(waveformId);
  const { active, stop } = voice;
  const connected = voice.phase === 'listening' || voice.phase === 'speaking';
  const label = voice.needsAudioResume ? 'Resume voice playback' : voice.active
    ? voice.phase === 'connecting' ? 'Cancel connection' : 'End conversation'
    : 'Start conversation';
  const showStatus = Boolean(voice.status) || !connected || voice.needsAudioResume || (voice.remainingSeconds !== null && voice.remainingSeconds <= 15);
  const status = connected && !voice.needsAudioResume && voice.remainingSeconds !== null && voice.remainingSeconds <= 15
    ? `${voice.remainingSeconds} seconds remaining in this conversation.` : voice.status;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && active) void stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, stop]);

  return <div className="voice-experience" data-active={voice.active} data-connected={connected}
    data-personal={Boolean(waveformId)} data-profile-photo={Boolean(waveformId && profilePhoto)}
    style={waveformId ? appearanceTheme(accentColor) : undefined}>
    <nav className="voice-navigation" aria-label="FlowPath navigation" hidden={Boolean(waveformId) && voice.active}>
      <a className="news-example-link" href="https://flowpathapp.com">FlowPath News example</a>
      <div className="voice-account-links">
        {name && <span>{name}</span>}
        <Link href="/account">{waveformId ? 'My waveform' : 'Create your waveform'}</Link>
      </div>
    </nav>
    <main className="voice-page" data-voice-phase={voice.phase}>
      <header className="wordmark" aria-hidden={connected}>
        {waveformId && profilePhoto
          // Raster-only, bounded owner photo; bypass the remote image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="profile-photo" src={profilePhoto} alt={`${name ?? 'Waveform'} profile photo`} width={96} height={96} />
          : <Image src="/brand/flowpath-logo-full.png" alt="FlowPath" width={1536} height={1024} priority />}
        {!waveformId && <span className="wordmark-studio">Studio</span>}
      </header>
      <button className="wave-control" type="button" aria-label={label} aria-pressed={voice.active}
        aria-describedby={showStatus && status ? 'voice-status' : !connected ? 'voice-hint' : undefined}
        onClick={() => { if (voice.needsAudioResume || !voice.active) void voice.start(); else void voice.stop(); }}>
        <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser} accentColor={waveformId ? accentColor : undefined} />
      </button>
      <p className="voice-hint" id="voice-hint" aria-hidden={connected}>Tap the wave whenever you’re ready</p>
      <p className="voice-status" id="voice-status" role="status" aria-live="polite" aria-atomic="true">{showStatus ? status : ''}</p>
      <span className="sr-only">{connected ? 'Conversation connected. Tap the waveform or press Escape to end.' : ''}</span>
    </main>
    <div className="footer-position" hidden={voice.active}><PersonalFooter /></div>
  </div>;
}
