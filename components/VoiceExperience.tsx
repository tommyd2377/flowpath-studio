'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useVoiceSession } from '@/lib/use-voice-session';
import Waveform from './Waveform';
import PersonalFooter from './PersonalFooter';
import { appearanceTheme } from '@/lib/appearance-theme';
import { WAVEFORM_DEFAULT_COLOR } from '@/lib/account-model';
import VoiceDiagnostics, { useDiagnosticsMode, useStartupTimingMode } from './VoiceDiagnostics';
import VoiceStartupTiming from './VoiceStartupTiming';
import TextPanel from './TextPanel';
import LiveTextPanel from './LiveTextPanel';
import type { VisualDisplayConfiguration } from '@/lib/visual-display';
import VisualDisplay from './VisualDisplay';
import PluginCarousel from './PluginCarousel';
import PracticeDisplay from './PracticeDisplay';
import { practiceDefinition } from '@/lib/practice-catalog';
import type { PracticeId } from '@/lib/practice-contract';
import { liveTextPanelEnabled, type TextPanelConfiguration } from '@/lib/text-panel';
import { clientAnalytics, observeVisit } from '@/lib/analytics-runtime';
import { BookOpen, Images, Eye, EyeOff, Square, TextCursorInput } from 'lucide-react';
import BrandLoader from './BrandLoader';
import DemoCodeGate from './DemoCodeGate';
import PluginUnlock, { type PluginPlayback } from './PluginUnlock';

export default function VoiceExperience({ waveformId, name, accentColor = WAVEFORM_DEFAULT_COLOR, profilePhoto = null, paidPayer, onSettled, textPanel: initialText = null, visualDisplay: initialVisual = null, pluginAccess, analyticsSurface, nextConversation, draftPreview = false, publishedPreview = false, publicDemo = false, practicePlugins }: {
  waveformId?: string; name?: string; accentColor?: string; profilePhoto?: string | null; paidPayer?: 'creator' | 'self'; onSettled?: () => void; textPanel?: TextPanelConfiguration | null; visualDisplay?: VisualDisplayConfiguration | null; analyticsSurface?: 'private' | 'public'; nextConversation?: () => void; draftPreview?: boolean; publishedPreview?: boolean; publicDemo?: boolean; pluginAccess?: Pick<PluginPlayback, 'locked' | 'expiresAt'>; practicePlugins?: PracticeId[];
}) {
  const [pluginView, setPluginView] = useState<PluginPlayback | undefined>(() => pluginAccess && {
    ...pluginAccess, textPanel: initialText, visualDisplay: initialVisual,
  });
  const textPanel = pluginView ? pluginView.textPanel : initialText;
  const visualDisplay = pluginView ? pluginView.visualDisplay : initialVisual;
  const textBoxEnabled = liveTextPanelEnabled(textPanel);
  const voice = useVoiceSession(waveformId, paidPayer, textBoxEnabled, draftPreview, publishedPreview, visualDisplay, Boolean(pluginAccess), practicePlugins);
  const handledSettlement = useRef(0);
  useEffect(() => { if (voice.settledVersion > handledSettlement.current) { handledSettlement.current = voice.settledVersion; onSettled?.(); } }, [voice.settledVersion, onSettled]);
  const diagnosticsMode = useDiagnosticsMode();
  const startupTimingMode = useStartupTimingMode();
  const [recordNext, setRecordNext] = useState(false);
  const [demoCodeAccepted, setDemoCodeAccepted] = useState(false);
  const [demoCodeRequired, setDemoCodeRequired] = useState(false);
  const { active, stop, clearPluginContent } = voice;
  useEffect(() => {
    if (!pluginView?.expiresAt || !waveformId) return;
    const timer = setTimeout(() => {
      stop('Plugin access expired.');
      clearPluginContent();
      setPluginView(current => current && { ...current, textPanel: null, visualDisplay: null, expiresAt: undefined });
      void fetch(`/api/plugin-access?waveformId=${encodeURIComponent(waveformId)}&playback=1${publicDemo ? '&audience=curated' : ''}`, { cache: 'no-store' })
        .then(async response => { if (response.ok) setPluginView(await response.json()); }).catch(() => {});
    }, Math.max(0, pluginView.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pluginView?.expiresAt, waveformId, stop, clearPluginContent, publicDemo]);
  const connected = voice.phase === 'listening' || voice.phase === 'speaking';
  const textVisible = textBoxEnabled && voice.textState.visible;
  const visualVisible = !!visualDisplay && voice.textState.visual?.visible === true;
  const practice = voice.textState.practice;
  const displayVisible = textVisible || visualVisible || !!practice;
  const display = practice?.id ?? (visualVisible ? 'visual' : voice.textState.display ?? 'text');
  const [requestedDisplay, setRequestedDisplay] = useState<typeof display | null>(null);
  if (displayVisible && requestedDisplay !== display) setRequestedDisplay(display);
  const showVisual = () => voice.visualAction({ action: 'show', imageId: '', text: '' });
  const showDisplay = () => {
    if (requestedDisplay === 'visual') showVisual();
    else if (requestedDisplay === 'knowledge') voice.showKnowledge();
    else if (requestedDisplay === 'text') voice.showNotes();
    else if (requestedDisplay) voice.showPractice(requestedDisplay);
  };
  const docked = Boolean(waveformId && (voice.hasConnected || displayVisible));
  const waveControl = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const codeLocked = demoCodeRequired && !demoCodeAccepted;
  const pluginRequest = useRef(false);
  const [checkingPlugins, setCheckingPlugins] = useState(false);
  const [pluginStartError, setPluginStartError] = useState('');
  const beginConversation = async () => {
    if (!waveControl.current || pluginRequest.current) return;
    // This callback runs only after a waveform click or successful code submission.
    // eslint-disable-next-line react-hooks/purity
    const clickedAt = performance.now();
    let fresh: PluginPlayback | undefined;
    if (pluginAccess && waveformId) {
      pluginRequest.current = true;
      setCheckingPlugins(true);
      setPluginStartError('');
      try {
        const response = await fetch(`/api/plugin-access?waveformId=${encodeURIComponent(waveformId)}&playback=1${publicDemo ? '&audience=curated' : ''}`, { cache: 'no-store' });
        if (!response.ok) throw new Error();
        fresh = await response.json();
        if (!fresh || !waveControl.current) return;
        setPluginView(fresh);
      } catch {
        setPluginStartError('Plugin access could not be checked. Try again.');
        return;
      } finally { pluginRequest.current = false; setCheckingPlugins(false); }
    }
    clientAnalytics.record({ eventName: 'voice_start_requested', properties: { surface } });
    void voice.start(diagnosticsMode && recordNext, startupTimingMode, fresh && { text: liveTextPanelEnabled(fresh.textPanel), visual: fresh.visualDisplay }, clickedAt); setRecordNext(false);
  };
  const hideText = () => {
    const restoreFocus = panel.current?.contains(document.activeElement) || document.activeElement?.classList.contains('display-toggle');
    voice.hideText();
    if (restoreFocus) waveControl.current?.focus({ preventScroll: true });
  };
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
    data-demo-code={codeLocked} data-personal={Boolean(waveformId)} data-profile-photo={hasPortrait} data-docked={docked} data-text-visible={displayVisible}
    style={waveformId ? appearanceTheme(accentColor) : undefined}>
    <nav className="voice-navigation" aria-label="FlowPath navigation" hidden={Boolean(waveformId) && voice.active}>
      {!waveformId && <div className="home-news-links"><Link href="/w/c538ac44-883b-4d96-8785-4ddf8a151efb">Benjamin Franklin</Link><a className="news-example-link" href="https://flowpathapp.com" onClick={() => clientAnalytics.record({ eventName: 'navigation_selected', properties: { destination: 'news' } })}>News</a></div>}
      <div className="voice-account-links">
        {name && !docked && <span>{name}</span>}
        <Link href={waveformId && !publicDemo ? `/account?id=${waveformId}` : "/account"} onClick={() => clientAnalytics.record({ eventName: 'navigation_selected', properties: { destination: 'account' } })}>{waveformId && !publicDemo ? 'My waveform' : 'Create your waveform'}</Link>
      </div>
    </nav>
    <main className="voice-page" data-voice-phase={voice.phase}>
    {waveformId && requestedDisplay && <button type="button" className="secondary-button display-toggle" aria-expanded={displayVisible} onClick={displayVisible ? hideText : showDisplay}>
      {displayVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}{displayVisible ? 'Hide display' : 'Show display'}
    </button>}
      <header className="wordmark" aria-hidden={(connected || docked) && !hasPortrait}>
        {waveformId && profilePhoto
          // Raster-only, bounded owner photo; bypass the remote image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          ? <img className="profile-photo" src={profilePhoto} alt={`${name ?? 'Waveform'} profile photo`} width={96} height={96} />
          : <Image src="/brand/flowpath-logo-full.png" alt="FlowPath" width={1536} height={1024} priority />}
        {!waveformId && <span className="wordmark-studio">Studio</span>}
      </header>
      {waveformId && docked && <div className="conversation-identity">
        <span className="conversation-name">{name ?? 'Your waveform'}</span>
        <span className="conversation-state">{voice.active ? connected ? voice.phase === 'speaking' ? 'Speaking' : 'Listening' : 'Connecting' : 'Conversation ended'}</span>
      </div>}
      {waveformId && docked && voice.active && <button type="button" className="secondary-button conversation-end" onClick={() => void voice.stop()}><Square aria-hidden="true" />End conversation</button>}
      <button ref={waveControl} className="wave-control" type={!voice.active && codeLocked ? 'submit' : 'button'} form={!voice.active && codeLocked ? 'voice-demo-code-form' : undefined} aria-label={waveformId && docked && voice.active && !voice.needsAudioResume ? 'Voice waveform' : label} aria-pressed={voice.active}
        aria-describedby={showStatus && status ? 'voice-status' : !connected && !docked ? 'voice-hint' : undefined}
        onClick={() => {
          if (nextConversation) nextConversation();
          else if (voice.needsAudioResume) void voice.start();
          else if (!voice.active && !codeLocked) beginConversation();
          else if (voice.active) void voice.stop();
        }}>
        <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser} accentColor={waveformId ? accentColor : undefined} />
      </button>
      {!voice.active && !docked && <DemoCodeGate formId="voice-demo-code-form" waveformTrigger onState={setDemoCodeRequired} onAccess={setDemoCodeAccepted} onUnlocked={beginConversation} />}
      <p className="voice-hint" id="voice-hint" aria-hidden={voice.active || docked}>{nextConversation ? 'Copy your text, then tap the wave to choose your next conversation' : codeLocked ? 'Enter the code and tap the waveform to begin.' : 'Tap the waveform to begin.'}</p>
      <p className="voice-status" id="voice-status" tabIndex={docked && showStatus && status ? 0 : undefined} role="status" aria-live="polite" aria-atomic="true">{voice.phase === 'connecting' && <BrandLoader variant="connection" />}{showStatus ? status : ''}{voice.reviewRequired && waveformId && <><br /><Link href={waveformId && !publicDemo ? `/account?id=${waveformId}` : "/account"} className="voice-review-link">Open waveform settings</Link></>}
      </p>
      {paidPayer && <p className="paid-session-meter" aria-live="polite">{paidPayer === 'creator' ? 'Creator pays' : 'You pay from your prepaid balance'}{voice.remainingSeconds !== null ? ` · ${voice.remainingSeconds} seconds remaining${voice.remainingSeconds <= 30 ? ' — ending soon' : ''}` : ''}</p>}
      <span className="sr-only">{connected ? 'Conversation connected. Tap the waveform or press Escape to end.' : ''}</span>
      {displayVisible ? <div ref={panel} className="voice-text-panel voice-text-panel--live">
        <nav className="plugin-display-controls" aria-label="Plugin displays">
          {textBoxEnabled && <button type="button" className="secondary-button" aria-pressed={display === 'text'} onClick={voice.showNotes}><TextCursorInput aria-hidden="true" />Text Box</button>}
          {voice.textState.hasKnowledge && <button type="button" className="secondary-button" aria-pressed={display === 'knowledge'} onClick={voice.showKnowledge}><BookOpen aria-hidden="true" />Knowledge</button>}
          {!!visualDisplay?.images.length && <button type="button" className="secondary-button" aria-pressed={display === 'visual'} onClick={showVisual}><Images aria-hidden="true" />Visual Display</button>}
          {voice.textState.openedPractice?.map(id => <button key={id} type="button" className="secondary-button"
            aria-pressed={display === id} onClick={() => voice.showPractice(id)}>{practiceDefinition(id)?.name}</button>)}
        </nav>
        <PluginCarousel display={display}>{practice ? <PracticeDisplay view={practice} /> : visualVisible && visualDisplay && voice.textState.visual ? <VisualDisplay configuration={visualDisplay} state={voice.textState.visual} onAction={voice.visualAction} /> : <LiveTextPanel key={voice.textState.display ?? 'text'} {...voice.textState} externalHide
          onStop={voice.stopWriting} onClear={voice.clearText} onUndo={voice.undoText} onHide={hideText} />}</PluginCarousel>
        {displayVisible && voice.textState.message && <p role="status">{voice.textState.message}</p>}
      </div> : !textBoxEnabled && textPanel && <div className="voice-text-panel"><TextPanel configuration={textPanel} scopeKey={waveformId ?? 'home'} /></div>}
    {waveformId && pluginView && <PluginUnlock id={waveformId} locked={pluginView.locked} session={voice.pluginSessionId}
      publicDemo={publicDemo} disabled={checkingPlugins || voice.phase === 'connecting' || publicDemo && !connected} onBusy={busy => { pluginRequest.current = busy; }}
      onUnlock={view => { voice.updatePluginContent(liveTextPanelEnabled(view.textPanel), view.visualDisplay); setPluginView(view); }} />}
    {pluginStartError && <p role="status">{pluginStartError}</p>}
    </main>
    {startupTimingMode && <VoiceStartupTiming key={voice.diagnosticVersion} getReport={voice.getStartupTiming} />}
    {diagnosticsMode && <VoiceDiagnostics key={voice.diagnosticVersion} active={voice.active} recordNext={recordNext} onRecordNext={setRecordNext}
      recording={voice.diagnosticRecording} hasReport={voice.hasDiagnostic} version={voice.diagnosticVersion}
      getReport={voice.getDiagnostic} mark={voice.markDiagnostic} stopRecording={voice.stopDiagnostic} clear={voice.clearDiagnostic} />}
    <div className="footer-position" hidden={voice.active || displayVisible}><PersonalFooter /></div>
  </div>;
}
