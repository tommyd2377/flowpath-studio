'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type PropsWithChildren, type MutableRefObject } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { ArrowUp, ArrowUpRight, AudioLines, Clock3, CornerDownLeft, MessageCircle, Square } from 'lucide-react';
import Waveform from './Waveform';
import SitePresentation from './SitePresentation';
import type { SiteContent } from '@/lib/site-model';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { demoVisitorReply, visitorSettings, type VisitorAvailability, type VisitorMessage, type VisitorReply } from '@/lib/visitor-model';
import { demoPresentation, presentationSummary, validatePresentation, type SitePresentation as Presentation } from '@/lib/site-presentation';
import { useVisitorVoice } from '@/lib/use-visitor-voice';
import styles from './VisitorAssistant.module.css';
import { CatalogExplorer, motionTiming, revealTransition, surfaceTransition } from '@thevoice/platform-ui';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import { initialInteraction, planForIntent, type CatalogInteractionState } from '@thevoice/platform-ui/interaction';
import { openingPresentation } from '@/lib/site-opening';
import type { MediaLibrary, AssetUrlResolver } from '@thevoice/platform-ui/media';
import type { PlatformEventInput } from '@/lib/platform-events';

const ease = [0.22, 1, 0.36, 1] as const;
const spring = { type: 'spring', stiffness: 330, damping: 34, mass: 0.8 } as const;

function ModeSurface(props: PropsWithChildren<HTMLMotionProps<'div'>>) {
  const present = useIsPresent();
  return <motion.div {...props} inert={!present} aria-hidden={!present}/>;
}

export default function VisitorAssistant({ content, slug, entered, onExplore, onViewChange, catalog, media, resolveAssetUrl, interactionRef, onPhotoView, onCatalogEvent }: {
  content: SiteContent; slug?: string; entered: boolean; onExplore: () => void; onViewChange: (active: boolean) => void; catalog?: KnowledgeCatalog | null;
  interactionRef?: MutableRefObject<(() => void) | null>; onPhotoView?: (assetId: string) => void;
  media?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver;
  onCatalogEvent?: (event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) => void;
}) {
  const settings = visitorSettings(content);
  const [state, setState] = useState<VisitorAvailability | null>(slug ? null : {
    enabled: true, mode: settings.mode, live: false, chatRemaining: settings.chatDailyLimit,
    voiceRemaining: settings.voiceDailyLimit, resetsAt: '',
  });
  const [mode, setMode] = useState<'chat' | 'voice'>(settings.mode === 'chat' ? 'chat' : 'voice');
  const [messages, setMessages] = useState<VisitorMessage[]>([]);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [catalogPlan, setCatalogPlan] = useState<PresentationPlan | undefined>(() => catalog ? openingPresentation(content, catalog) : undefined);
  const catalogState = useRef<CatalogInteractionState | undefined>(catalog ? initialInteraction(catalog) : undefined);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparingView, setPreparingView] = useState(false);
  const [error, setError] = useState('');
  const [greeted, setGreeted] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const layoutId = useId();
  const reduce = useReducedMotion();
  const voice = useVisitorVoice();
  const cancelVoice = voice.cancel;
  useEffect(() => {
    if (!interactionRef) return;
    interactionRef.current = () => { pending.current?.abort(); cancelVoice(); };
    return () => { interactionRef.current = null; };
  }, [interactionRef, cancelVoice]);
  const voiceExhausted = state !== null && state.voiceRemaining === 0;
  const voiceBusy = voice.phase !== 'idle' && voice.phase !== 'error';
  const activeMode = voiceExhausted && !voiceBusy ? 'chat' : mode;
  const disabled = !state?.enabled;
  const demo = !slug || !!state?.enabled && !state.live;
  const reveal = { initial: { opacity: 0, y: reduce ? 0 : 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduce ? 0 : -6 }, transition: { duration: reduce ? 0 : 0.28, ease } };

  useEffect(() => {
    const controller = new AbortController();
    if (slug) void fetch(`/api/visitor/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.availability) throw new Error(body.error || 'The assistant is unavailable.');
        if (!controller.signal.aborted) setState(body.availability);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [slug]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [text, activeMode]);

  async function requestTurn(kind: 'chat' | 'voice' | 'greeting', value: string, signal: AbortSignal) {
    const history = messages.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
    if (kind !== 'greeting') setPreparingView(true);
    try {
      let result: VisitorReply;
      if (!slug) {
        const next = { ...state!, chatRemaining: state!.chatRemaining - (kind === 'chat' ? 1 : 0), voiceRemaining: state!.voiceRemaining - (kind !== 'chat' ? 1 : 0) };
        const plan = kind === 'greeting' ? undefined : demoPresentation(content, value, history, media);
        result = { text: kind === 'greeting' ? getWelcomeMessage(content) : catalog ? 'Explore the published items below.' : kind === 'chat' ? presentationSummary(plan!, content, media) : demoVisitorReply(content, value), presentation: plan,
          ...(catalog && kind !== 'greeting' ? { catalogPlan: planForIntent(catalog, value, catalogState.current, media ?? undefined) } : {}), demo: true, availability: next };
      } else {
        const response = await fetch(`/api/visitor/${encodeURIComponent(slug)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ kind, requestId: crypto.randomUUID(), history, ...(catalog ? { catalogState: catalogState.current } : {}),
            ...(kind === 'chat' ? { text: value } : kind === 'voice' ? { audio: value } : {}) }),
        });
        const body = await response.json();
        if (signal.aborted) throw new Error('Request cancelled.');
        if (body.availability) setState(body.availability);
        if (!response.ok) throw new Error(body.error || 'The assistant is unavailable.');
        result = body;
      }
      if (signal.aborted) throw new Error('Request cancelled.');
      setState(result.availability);
      if (kind !== 'greeting') {
        if (catalog) {
          try { setCatalogPlan(validatePlan(result.catalogPlan, catalog, catalog.id, media ?? undefined)); }
          catch { onCatalogEvent?.({ type: 'presentation_rejected', kind: 'display' }); throw new Error('The site could not prepare that view. Your current view is still available.'); }
          setMessages(previous => [...previous, { role: 'user' as const, text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant' as const, text: result.text }].slice(-8));
          return result;
        }
        let plan: Presentation;
        try { plan = validatePresentation(result.presentation, content, media); }
        catch { throw new Error('The site could not prepare that view. Please try again.'); }
        setPresentation(plan); onViewChange(true);
        // Follow-up context stays internal; visitors see the actual site components.
        setMessages(previous => [...previous,
          { role: 'user' as const, text: kind === 'chat' ? value : result.userText || 'Voice request' },
          { role: 'assistant' as const, text: presentationSummary(plan, content, media) }].slice(-8));
      }
      return result;
    } finally { if (kind !== 'greeting') setPreparingView(false); }
  }
  async function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || inFlight.current || disabled || !state?.chatRemaining) return;
    const outgoing = text.trim();
    inFlight.current = true; voice.cancel(); setBusy(true); setError(''); setText(''); onExplore();
    const controller = new AbortController(); pending.current = controller;
    try { await requestTurn('chat', outgoing, controller.signal); }
    catch (error) {
      setText(outgoing);
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The view could not be prepared.');
    } finally {
      inFlight.current = false; setBusy(false);
      const element = input.current;
      if (element?.form?.contains(document.activeElement)) element.focus({ preventScroll: true });
    }
  }
  function startVoice() {
    if (voice.phase === 'listening') { void voice.finishRecording(); return; }
    if (voiceBusy) { voice.cancel(); return; }
    if (disabled || !state?.voiceRemaining) return;
    setError(''); onExplore();
    if (!greeted && !content.visitorSpeaksFirst) {
      setGreeted(true);
      void voice.respond(signal => requestTurn('greeting', '', signal), !state.live);
    } else if (!state.live) {
      void voice.respond(signal => requestTurn('voice', '', signal), true);
    } else {
      void voice.record((audio, signal) => requestTurn('voice', audio, signal));
    }
  }
  function switchMode(next: 'chat' | 'voice') {
    voice.cancel(); pending.current?.abort(); setMode(next); setError(''); onExplore();
  }
  function resetView() {
    voice.cancel(); pending.current?.abort(); setError(''); setMessages([]); setPresentation(null); setText(''); onViewChange(false);
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  }
  const suggestions = catalog ? catalog.jobs.slice(0, 3).map(job => ({ label: job.label, question: job.label, icon: ArrowUpRight })) : [
    ...(media?.assets.length ? [{ label: 'Photos & albums', question: 'Show me your photos.', icon: ArrowUpRight }] : []),
    ...(content.sections[0] ? [{ label: content.sections[0].title, question: `Show me ${content.sections[0].title}.`, icon: ArrowUpRight }] : []),
    ...(content.sections.length > 1 ? [{ label: 'Compare options', question: `Compare ${content.sections.slice(0, 2).map(section => section.title).join(' and ')}.`, icon: ArrowUpRight }] : []),
    ...(content.hours ? [{ label: 'Hours & contact', question: 'Show me your hours and contact information.', icon: Clock3 }] : [{ label: 'Get in touch', question: 'How can I get in touch?', icon: MessageCircle }]),
  ];
  const voiceLabel = voice.phase === 'listening' ? 'Send voice message' : voiceBusy ? 'Stop voice' : !greeted && !content.visitorSpeaksFirst ? 'Start voice conversation' : 'Record voice message';
  const status = error || voice.error || (!state ? 'Loading assistant…' : !state.enabled ? 'This site’s assistant is currently unavailable.'
    : activeMode === 'chat' && state.chatRemaining === 0 ? 'Chat has reached its daily limit. Please return after the daily reset.'
    : voiceExhausted && !voiceBusy && settings.mode !== 'chat' ? 'Voice has reached its daily limit. Continue by typing below.' : '');

  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: 0.18, layout: surfaceTransition }}><LayoutGroup id={layoutId}>
    <motion.section layout={!reduce} className={styles.assistant} aria-label="Site assistant">
      {(settings.mode === 'both' || voiceExhausted && !voiceBusy && settings.mode === 'voice') && <motion.div layout="position" className={styles.modes} role="group" aria-label="Conversation mode" {...reveal}>
        {(['voice', 'chat'] as const).map(option => <motion.button type="button" key={option} aria-pressed={activeMode === option} disabled={option === 'voice' && voiceExhausted}
          title={option === 'voice' && voiceExhausted ? 'Daily voice limit reached' : undefined} onClick={() => switchMode(option)} whileTap={reduce ? undefined : { scale: 0.96 }}>
          {activeMode === option && <motion.span layoutId="selected-mode" className={styles.modeSelection} style={{ borderRadius: 30 }} transition={spring}/>}
          <span className={styles.modeLabel}>{option === 'voice' ? <AudioLines size={14}/> : <MessageCircle size={14}/>} {option === 'voice' ? 'Voice' : 'Chat'}</span>
        </motion.button>)}
      </motion.div>}
      <AnimatePresence mode="wait" initial={false}>
        {activeMode === 'voice' ? <ModeSurface key="voice" {...reveal}>
          <motion.button type="button" className="site-wave" aria-label={voiceLabel} disabled={disabled} onClick={startVoice} animate={{ height: entered ? 80 : 140 }} transition={{ ...surfaceTransition, duration: reduce ? 0 : motionTiming.reflow }}>
            <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser}/>
          </motion.button>
          <p className={styles.voiceNote} role="status">{voice.phase === 'listening' ? 'Listening · tap to send · up to 20 seconds' : voice.phase === 'thinking' ? 'Preparing your view…' : voice.phase === 'speaking' ? 'Speaking · tap to stop' : voice.phase === 'connecting' ? 'Connecting microphone…' : 'Tap the waveform to talk'}</p>
        </ModeSurface> : <ModeSurface key="chat" className={styles.card} {...reveal}>
          <motion.div layout="position" className={styles.intro}>
            <span className={styles.eyebrow}>{presentation ? 'KEEP EXPLORING' : 'THE SITE, AT YOUR DIRECTION'}</span>
            {!presentation && <h2>What would you like to see?</h2>}
          </motion.div>
          <form className={styles.composer} onSubmit={event => void sendChat(event)}>
            <textarea ref={input} aria-label="What would you like to see?" placeholder={presentation ? 'Go deeper, compare, or explore something else…' : 'Show me what you have in mind…'} rows={1} maxLength={2000} value={text} readOnly={busy} disabled={disabled || !state?.chatRemaining && !busy}
              onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <motion.button className={styles.send} type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop request' : 'Show me'} title={busy ? 'Stop request' : 'Show me'} disabled={!busy && (disabled || !state?.chatRemaining || !text.trim())}
              onClick={event => { if (busy) { event.preventDefault(); pending.current?.abort(); } }} whileHover={reduce || !text.trim() && !busy ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.93 }}>
              <AnimatePresence mode="wait" initial={false}><motion.span key={busy ? 'stop' : 'send'} initial={{ opacity: 0, y: reduce ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -5 }} transition={{ duration: reduce ? 0 : 0.12 }}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={18}/>}</motion.span></AnimatePresence>
            </motion.button>
          </form>
          <AnimatePresence initial={false}>{!presentation && <motion.div className={styles.suggestions} aria-label="Ideas to explore" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
            {suggestions.map((suggestion, index) => <motion.button key={suggestion.label} type="button" disabled={busy || disabled || !state?.chatRemaining} onClick={() => { setText(suggestion.question.slice(0, 2000)); input.current?.focus({ preventScroll: true }); }}
              initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.35, delay: reduce ? 0 : 0.05 * index, ease }} whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.97 }}><suggestion.icon size={13}/><span>{suggestion.label}</span></motion.button>)}
          </motion.div>}</AnimatePresence>
          <div className={styles.composerMeta}><span><span className={styles.statusDot}/>{demo ? 'Preview · no AI calls' : 'AI guide · information from this site'}</span><span className={styles.keyboardHint}>Enter to explore <CornerDownLeft size={10}/></span>{text.length > 1600 && <span>{text.length}/2000</span>}</div>
        </ModeSurface>}
      </AnimatePresence>
      <AnimatePresence initial={false}>{status && <motion.p key={status} className={styles.status} role={error || voice.error ? 'alert' : 'status'} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduce ? 0 : 0.2 }}>{status}</motion.p>}</AnimatePresence>
      {activeMode === 'voice' && <p className={styles.voiceMeta}>{demo ? 'Preview · no AI calls' : 'AI voice · information from this site'}</p>}
      {catalog ? <CatalogExplorer key={catalog.id} catalog={catalog} media={media} resolveAssetUrl={resolveAssetUrl} onPhotoView={onPhotoView} accent={content.accent} plan={catalogPlan} showComposer={false} onStateChange={next => { catalogState.current = next; }} onInteraction={() => { pending.current?.abort(); voice.cancel(); onExplore(); }} onOutcome={event => onCatalogEvent?.({ ...event, type: 'outcome' })} onPresentation={plan => onCatalogEvent?.({ type: 'presentation_accepted', kind: 'display', operation: plan.operation })}/>
        : <SitePresentation content={content} media={media} presentation={presentation} busy={preparingView} onReset={resetView}/>}
    </motion.section>
  </LayoutGroup></MotionConfig>;
}
