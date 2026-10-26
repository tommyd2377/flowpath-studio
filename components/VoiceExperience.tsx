'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useVoiceSession } from '@/lib/use-voice-session';
import Waveform from './Waveform';
import PersonalFooter from './PersonalFooter';
import { appearanceTheme } from '@/lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '@/lib/account-model';
import VoiceDiagnostics, { useDiagnosticsMode } from './VoiceDiagnostics';
import TextPanel from './TextPanel';
import LiveTextPanel from './LiveTextPanel';
import { liveTextPanelEnabled, type TextPanelConfiguration } from '@/lib/text-panel';
import { clientAnalytics, observeVisit } from '@/lib/analytics-runtime';

export default function VoiceExperience({ waveformId, name, accentColor = WAVEFORM_DEFAULT_COLOR, profilePhoto = null, paidPayer, onSettled, textPanel = null, analyticsSurface, nextConversation }: {
  waveformId?: string; name?: string; accentColor?: string; profilePhoto?: string | null; paidPayer?: 'creator' | 'self'; onSettled?: () => void; textPanel?: TextPanelConfiguration | null; analyticsSurface?: 'private' | 'public'; nextConversation?: () => void;
}) {
  const textBoxEnabled = liveTextPanelEnabled(textPanel);
  const voice = useVoiceSession(waveformId, paidPayer, textBoxEnabled);
  const handledSettlement = useRef(0);
  useEffect(() => { if (voice.settledVersion > handledSettlement.current) { handledSettlement.current = voice.settledVersion; onSettled?.(); } }, [voice.settledVersion, onSettled]);
  const diagnosticsMode = useDiagnosticsMode();
  const [recordNext, setRecordNext] = useState(false);
  const { active, stop } = voice;
  const connected = voice.phase === 'listening' || voice.phase === 'speaking';
  const surface = analyticsSurface ?? (waveformId ? 'private' : 'home');
  const wasConnected = useRef(false);
  useEffect(() => { observeVisit(surface); }, [surface]);
  useEffect(() => {
    if (connected && !wasConnected.current) {
      clientAnalytics.record({ eventName: 'voice_connected', properties: { surface } });
      if (surface === 'home') clientAnalytics.record({ eventName: 'demo_started', properties: {} });
    } else if (!voice.active && wasConnected.current) {
      clientAnalytics.record({ eventName: 'voice_ended', properties: { surface, reason: 'unknown' } });
      if (surface === 'home') clientAnalytics.record({ eventName: 'demo_ended', properties: { reason: 'unknown' } });
    }
    if (connected || !voice.active) wasConnected.current = connected;
  }, [connected, voice.active, surface]);
  const hasPortrait = Boolean(waveformId && profilePhoto);
  const label = nextConversation ? 'Choose next conversation' : voice.needsAudioResume ? 'Resume voice playback' : voice.active
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
    data-personal={Boolean(waveformId)} data-profile-photo={hasPortrait}
    style={waveformId ? appearanceTheme(accentColor) : undefined}>
    <nav className="voice-navigation" aria-label="FlowPath navigation" hidden={Boolean(waveformId) && voice.active}>
      <a className="news-example-link" href="https://flowpathapp.com" onClick={() => clientAnalytics.record({ eventName: 'navigation_selected', properties: { destination: 'news' } })}>FlowPath News example</a>
      <div className="voice-account-links">
        {name && <span>{name}</span>}
        <Link href="/account" onClick={() => clientAnalytics.record({ eventName: 'navigation_selected', properties: { destination: 'account' } })}>{waveformId ? 'My waveform' : 'Create your waveform'}</Link>
      </div>
    </nav>
    <main className="voice-page" data-voice-phase={voice.phase}>
      <header className="wordmark" aria-hidden={connected && !hasPortrait}>
        {waveformId && profilePhoto
          // Raster-only, bounded owner photo; bypass the remote image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="profile-photo" src={profilePhoto} alt={`${name ?? 'Waveform'} profile photo`} width={96} height={96} />
          : <Image src="/brand/flowpath-logo-full.png" alt="FlowPath" width={1536} height={1024} priority />}
        {!waveformId && <span className="wordmark-studio">Studio</span>}
      </header>
      <button className="wave-control" type="button" aria-label={label} aria-pressed={voice.active}
        aria-describedby={showStatus && status ? 'voice-status' : !connected ? 'voice-hint' : undefined}
        onClick={() => {
          if (nextConversation) nextConversation();
          else if (voice.needsAudioResume) void voice.start();
          else if (!voice.active) { clientAnalytics.record({ eventName: 'voice_start_requested', properties: { surface } }); void voice.start(diagnosticsMode && recordNext); setRecordNext(false); }
          else void voice.stop();
        }}>
        <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser} accentColor={waveformId ? accentColor : undefined} />
      </button>
      <p className="voice-hint" id="voice-hint" aria-hidden={connected}>{nextConversation ? 'Copy your text, then tap the wave to choose your next conversation' : 'Tap the wave whenever you’re ready'}</p>
      <p className="voice-status" id="voice-status" role="status" aria-live="polite" aria-atomic="true">{showStatus ? status : ''}</p>
      {paidPayer && <p className="paid-session-meter" aria-live="polite">{paidPayer === 'creator' ? 'Creator pays' : 'You pay from your prepaid balance'}{voice.remainingSeconds !== null ? ` · ${voice.remainingSeconds} seconds remaining${voice.remainingSeconds <= 30 ? ' — ending soon' : ''}` : ''}</p>}
      <span className="sr-only">{connected ? 'Conversation connected. Tap the waveform or press Escape to end.' : ''}</span>
      {textBoxEnabled ? <div className="voice-text-panel"><LiveTextPanel {...voice.textState}
        onStop={voice.stopWriting} onClear={voice.clearText} onUndo={voice.undoText} />
        {voice.textState.message && <p role="status">{voice.textState.message}</p>}
      </div> : textPanel && <div className="voice-text-panel"><TextPanel configuration={textPanel} scopeKey={waveformId ?? 'home'} /></div>}
    </main>
    {diagnosticsMode && <VoiceDiagnostics key={voice.diagnosticVersion} active={voice.active} recordNext={recordNext} onRecordNext={setRecordNext}
      recording={voice.diagnosticRecording} hasReport={voice.hasDiagnostic} version={voice.diagnosticVersion}
      getReport={voice.getDiagnostic} mark={voice.markDiagnostic} stopRecording={voice.stopDiagnostic} clear={voice.clearDiagnostic} />}
    <div className="footer-position" hidden={voice.active}><PersonalFooter /></div>
  </div>;
}
