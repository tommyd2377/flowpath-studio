'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type FormEvent, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, AudioLines, Clock3, MessageCircle, Square } from 'lucide-react';
import Waveform from './Waveform';
import VisitorVoiceStage from './VisitorVoiceStage';
import SitePresentation from './SitePresentation';
import SearchExplore, { type SearchExploreHandle } from './SearchExplore';
import { exploreSettings, exploreKindForText, localExploreCommand } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { demoVisitorReply, visitorSettings, type VisitorAvailability, type VisitorMessage, type VisitorReply } from '@/lib/visitor-model';
import { demoPresentation, presentationSources, presentationSummary, validatePresentation, type SitePresentation as Presentation } from '@/lib/site-presentation';
import { useVisitorVoice } from '@/lib/use-visitor-voice';
import { useVisitorSession } from '@/lib/use-visitor-session';
import { captureVisitorContext, navigateVisitorView } from '@/lib/visitor-view-context';
import type { VisitorContext } from '@/lib/visitor-request';
import styles from './VisitorAssistant.module.css';
import { CatalogExplorer, ConversationDock, EntityMedia, revealTransition, surfaceTransition } from '@thevoice/platform-ui';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import { initialInteraction, planForIntent, type CatalogInteractionState } from '@thevoice/platform-ui/interaction';
import { openingPresentation } from '@/lib/site-opening';
import type { MediaLibrary, AssetUrlResolver } from '@thevoice/platform-ui/media';
import type { PlatformEventInput } from '@/lib/platform-events';

const ease = [0.22, 1, 0.36, 1] as const;
const spring = { type: 'spring', stiffness: 330, damping: 34, mass: 0.8 } as const;

export default function VisitorAssistant({ content, slug, entered, onExplore, onViewChange, catalog, media, resolveAssetUrl, interactionRef, onPhotoView, onCatalogEvent, identity, opening }: {
  identity?: ReactNode; opening?: ReactNode;
  content: SiteContent; slug?: string; entered: boolean; onExplore: () => void; onViewChange: (active: boolean) => void; catalog?: KnowledgeCatalog | null;
  interactionRef?: MutableRefObject<(() => void) | null>; onPhotoView?: (assetId: string) => void;
  media?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver;
  onCatalogEvent?: (event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) => void;
}) {
  const settings = visitorSettings(content);
  const searchSettings = exploreSettings(content);
  const searchView = useRef<SearchExploreHandle>(null);
  const [state, setState] = useState<VisitorAvailability | null>(slug ? null : {
    enabled: true, mode: settings.mode, live: false, chatRemaining: settings.chatDailyLimit,
    voiceRemaining: settings.voiceDailyLimit, resetsAt: '',
  });
  const [mode, setMode] = useState<'chat' | 'voice'>(settings.mode === 'chat' ? 'chat' : 'voice');
  const historyRef = useRef<VisitorMessage[]>([]);
  function appendMessages(additions: VisitorMessage[]) { historyRef.current = [...historyRef.current, ...additions].slice(-8).map(item => ({ ...item, text: item.text.slice(0, 2000) })); }
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [catalogPlan, setCatalogPlan] = useState<PresentationPlan | undefined>(() => catalog ? openingPresentation(content, catalog) : undefined);
  const acceptedCatalogPlan = useRef(catalogPlan);
  const catalogCommand = useRef<((command: { kind: string; id?: string; ids?: string[] }) => boolean) | null>(null);
  const acceptedPresentation = useRef<Presentation | null>(null);
  const siteRoot = useRef<HTMLElement | null>(null);
  const assistantRoot = useRef<HTMLElement>(null);
  const entityIds = useMemo(() => new Set(catalog?.entities.map(entity => entity.id) ?? []), [catalog]);
  const sourceIds = useMemo(() => new Set(presentationSources(content, media).map(source => source.id)), [content, media]);
  const catalogState = useRef<CatalogInteractionState | undefined>(catalog ? initialInteraction(catalog) : undefined);
  const [text, setText] = useState('');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchActivity, setSearchActivity] = useState('');
  const [preparingView, setPreparingView] = useState(false);
  const [error, setError] = useState('');
  const [greeted, setGreeted] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const waveControl = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<{ mode: 'chat' | 'voice'; preventScroll: boolean; origin: Element | null } | null>(null);
  const focusReturnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusReturnFrame = useRef(0);
  const layoutId = useId();
  const reduce = useReducedMotion();
  const demoVoice = useVisitorVoice();
  const liveVoice = useVisitorSession();
  const cancelDemo = demoVoice.cancel;
  const stopLive = liveVoice.stop;
  const cancelVoice = useCallback(() => { cancelDemo(); stopLive(); }, [cancelDemo, stopLive]);
  const useLiveState = liveVoice.active || liveVoice.phase === 'error';
  const voice = { ...demoVoice, cancel: cancelVoice,
    phase: useLiveState ? liveVoice.phase : demoVoice.phase,
    error: liveVoice.phase === 'error' ? liveVoice.message : demoVoice.error,
    inputAnalyser: useLiveState ? liveVoice.inputAnalyser : demoVoice.inputAnalyser,
    outputAnalyser: useLiveState ? liveVoice.outputAnalyser : demoVoice.outputAnalyser };
  const manualInterrupt = liveVoice.manualInterrupt;
  const updateContext = liveVoice.updateContext;
  const getContext = useCallback((): VisitorContext => captureVisitorContext(siteRoot.current, {
    ...(searchView.current?.context() ? { explore: searchView.current.context() } : {}),
    ...(catalogState.current ? { catalogState: catalogState.current } : {}),
    ...(acceptedCatalogPlan.current ? { catalogPlan: acceptedCatalogPlan.current } : {}),
    ...(acceptedPresentation.current ? { presentation: acceptedPresentation.current } : {}),
  }, entityIds, sourceIds), [entityIds, sourceIds]);
  const manualInteraction = useCallback(() => { pending.current?.abort(); searchView.current?.cancel(); cancelDemo(); manualInterrupt(); }, [cancelDemo, manualInterrupt]);
  const searchContextChanged = useCallback(() => { updateContext(getContext()); }, [updateContext, getContext]);
  useEffect(() => {
    siteRoot.current = assistantRoot.current?.closest<HTMLElement>('[data-visitor-site]') ?? assistantRoot.current;
    if (!interactionRef) return;
    interactionRef.current = manualInteraction;
    return () => { interactionRef.current = null; };
  }, [interactionRef, manualInteraction]);
  useEffect(() => {
    if (!liveVoice.active || !siteRoot.current) return;
    const root = siteRoot.current;
    const capture = () => updateContext(getContext());
    // Layout, local disclosures, scroll and focus all change what is really visible.
    const mutations = new MutationObserver(capture);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-expanded', 'aria-hidden', 'inert', 'data-source-expanded'] });
    const resize = new ResizeObserver(capture); resize.observe(root);
    window.addEventListener('scroll', capture, true); window.addEventListener('resize', capture); document.addEventListener('focusin', capture);
    window.visualViewport?.addEventListener('resize', capture); window.visualViewport?.addEventListener('scroll', capture);
    capture();
    return () => { mutations.disconnect(); resize.disconnect(); window.removeEventListener('scroll', capture, true); window.removeEventListener('resize', capture); document.removeEventListener('focusin', capture); window.visualViewport?.removeEventListener('resize', capture); window.visualViewport?.removeEventListener('scroll', capture); };
  }, [getContext, liveVoice.active, updateContext]);
  const voiceExhausted = state !== null && state.voiceRemaining === 0;
  const voiceBusy = liveVoice.active || voice.phase !== 'idle' && voice.phase !== 'error';
  const activeMode = voiceExhausted && !voiceBusy ? 'chat' : mode;
  const disabled = !state?.enabled;
  const demo = !slug || !!state?.enabled && !state.live;
  const reveal = { initial: { opacity: 0, y: reduce ? 0 : 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduce ? 0 : -6 }, transition: { duration: reduce ? 0 : 0.28, ease } };

  useEffect(() => () => { clearTimeout(focusReturnTimer.current); cancelAnimationFrame(focusReturnFrame.current); }, []);
  function restoreControlFocus() {
    const request = focusReturn.current;
    if (!request) return;
    if (document.activeElement !== request.origin && document.activeElement !== document.body && !document.activeElement?.closest('[inert], [aria-hidden="true"]')) { focusReturn.current = null; return; }
    const control = request.mode === 'chat' ? input.current : waveControl.current;
    if (!control || control.disabled || control.closest('[inert], [aria-hidden="true"]')) { focusReturnFrame.current = requestAnimationFrame(restoreControlFocus); return; }
    focusReturn.current = null; clearTimeout(focusReturnTimer.current);
    control.focus({ preventScroll: request.preventScroll });
  }
  function requestControlFocus(preventScroll = false, target?: 'chat' | 'voice') {
    // Ending the last reserved reply switches to chat after the voice surface exits.
    focusReturn.current = { mode: target ?? (voiceExhausted ? 'chat' : activeMode), preventScroll, origin: document.activeElement };
    clearTimeout(focusReturnTimer.current); cancelAnimationFrame(focusReturnFrame.current);
    focusReturnTimer.current = setTimeout(() => { focusReturn.current = null; }, 2000);
    focusReturnFrame.current = requestAnimationFrame(restoreControlFocus);
  }

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
    const history = historyRef.current.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
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
          body: JSON.stringify({ kind, requestId: crypto.randomUUID(), history, context: getContext(),
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
          appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant', text: result.text }]);
          return result;
        }
        let plan: Presentation;
        try { plan = validatePresentation(result.presentation, content, media); }
        catch { throw new Error('The site could not prepare that view. Please try again.'); }
        acceptedPresentation.current = plan; setPresentation(plan); onViewChange(true);
        // Follow-up context stays internal; visitors see the actual site components.
        appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' },
          { role: 'assistant', text: presentationSummary(plan, content, media) }]);
      }
      return result;
    } finally { if (kind !== 'greeting') setPreparingView(false); }
  }
  async function sendChat(event?: FormEvent, question = text) {
    event?.preventDefault();
    if (!question.trim() || inFlight.current || disabled || !state?.chatRemaining) return;
    const outgoing = question.trim();
    setChatExpanded(false);
    const localSearch = searchSettings.enabled ? localExploreCommand(outgoing, searchView.current?.context()) : null;
    if (localSearch && searchView.current?.command(localSearch)) { manualInteraction(); setText(''); onExplore(); return; }
    const searchKind = searchSettings.enabled ? exploreKindForText(outgoing) : null;
    searchView.current?.cancel();
    inFlight.current = true; voice.cancel(); setBusy(true); setError(''); setText(''); onExplore();
    const controller = new AbortController(); pending.current = controller;
    try {
      if (searchKind && searchView.current) await searchView.current.search(outgoing, searchKind, controller.signal);
      else await requestTurn('chat', outgoing, controller.signal);
    }
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
    if (voiceBusy) { voice.cancel(); return; }
    if (disabled || !state?.voiceRemaining) return;
    searchView.current?.cancel(); pending.current?.abort();
    setError(''); onExplore();
    let surface = assistantRoot.current?.parentElement;
    while (surface && !/(auto|scroll)/.test(getComputedStyle(surface).overflowY)) surface = surface.parentElement;
    if (surface) surface.scrollTo({ top: 0, behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
    if (state.live && slug) {
      demoVoice.cancel();
      const earlierHistory = historyRef.current.slice(-8);
      const transcripts = new Map<string, { role: 'user' | 'assistant'; text: string; revision: number }>();
      void liveVoice.start({ slug, context: getContext(), history: historyRef.current.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })), getContext, onAvailability: setState,
        onTranscript: event => {
          transcripts.set(event.id, event);
          historyRef.current = [...earlierHistory, ...[...transcripts.values()].sort((a, b) => a.revision - b.revision || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)).map(({ role, text }) => ({ role, text }))].slice(-8);
        },
        onNavigate: async (event, signal) => {
          const target = event.target;
          if (target.kind === 'explore') {
            if (signal.aborted || !searchView.current || !searchSettings.enabled) return 'unavailable';
            if (target.result) searchView.current.show(target.result);
            else if (!target.command || !searchView.current.command(target.command)) return 'unavailable';
            onExplore();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return signal.aborted ? 'unavailable' : 'applied';
          }
          if (['open', 'expand', 'spotlight', 'compare', 'back', 'collapse'].includes(target.kind)) {
            if (!catalog) {
              if (target.kind === 'back' || target.kind === 'collapse') { acceptedPresentation.current = null; setPresentation(null); return 'applied'; }
              if (!('id' in target) || !presentationSources(content, media).some(source => source.id === target.id)) return 'unavailable';
              const next = validatePresentation({ layout: 'detail', sources: [target.id], status: 'ready' }, content, media);
              acceptedPresentation.current = next; setPresentation(next);
            } else if (!catalogCommand.current?.(target)) return 'unavailable';
            onExplore();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (signal.aborted) return 'unavailable';
            if ('id' in target) return navigateVisitorView(siteRoot.current, { kind: catalog ? 'entity' : 'source', id: target.id }, signal, manualInteraction);
            if (target.kind === 'compare') return navigateVisitorView(siteRoot.current, { kind: 'entity', id: target.ids[0] }, signal, manualInteraction);
            return navigateVisitorView(siteRoot.current, { kind: 'current' }, signal, manualInteraction);
          }
          return navigateVisitorView(siteRoot.current, target as Parameters<typeof navigateVisitorView>[1], signal, manualInteraction);
        }, onPlan: event => {
        if (catalog) {
          try { setCatalogPlan(validatePlan(event.catalogPlan, catalog, catalog.id, media ?? undefined)); }
          catch { onCatalogEvent?.({ type: 'presentation_rejected', kind: 'display' }); throw new Error('The site could not prepare that view. Your current view is still available.'); }
        } else {
          try { const plan = validatePresentation(event.presentation, content, media); acceptedPresentation.current = plan; setPresentation(plan); onViewChange(true); }
          catch { throw new Error('The site could not prepare that view. Your current view is still available.'); }
        }
      } });
    } else if (!greeted && !content.visitorSpeaksFirst) {
      setGreeted(true);
      void voice.respond(signal => requestTurn('greeting', '', signal), !state.live);
    } else {
      void voice.respond(signal => requestTurn('voice', '', signal), true);
    }
  }
  function switchMode(next: 'chat' | 'voice') {
    voice.cancel(); pending.current?.abort(); searchView.current?.cancel(); setChatExpanded(false); setMode(next); setError(''); onExplore();
  }
  function resetView() {
    requestControlFocus(activeMode === 'chat', activeMode);
    manualInteraction(); setError(''); acceptedPresentation.current = null; setPresentation(null); setText(''); onViewChange(false);
  }
  const suggestions = catalog ? catalog.jobs.slice(0, 3).map(job => ({ label: job.label, question: job.label, icon: ArrowUpRight })) : [
    ...(media?.assets.length ? [{ label: 'Photos & albums', question: 'Show me your photos.', icon: ArrowUpRight }] : []),
    ...(content.sections[0] ? [{ label: content.sections[0].title, question: `Show me ${content.sections[0].title}.`, icon: ArrowUpRight }] : []),
    ...(content.sections.length > 1 ? [{ label: 'Compare options', question: `Compare ${content.sections.slice(0, 2).map(section => section.title).join(' and ')}.`, icon: ArrowUpRight }] : []),
    ...(content.hours ? [{ label: 'Hours & contact', question: 'Show me your hours and contact information.', icon: Clock3 }] : [{ label: 'Get in touch', question: 'How can I get in touch?', icon: MessageCircle }]),
  ];
  const voiceLabel = voice.phase === 'connecting' && !liveVoice.updating ? 'Cancel connection' : voiceBusy ? 'End conversation' : demo ? 'Preview voice' : 'Start conversation';
  const status = error || voice.error || liveVoice.message || (!state ? 'Loading assistant…' : !state.enabled ? 'This site’s assistant is currently unavailable.'
    : activeMode === 'chat' && state.chatRemaining === 0 ? 'Chat has reached its daily limit. Please return after the daily reset.'
    : voiceExhausted && !voiceBusy && settings.mode !== 'chat' ? 'Voice has reached its daily limit. Continue by typing below.' : '');

  const modeControls = (settings.mode === 'both' || settings.mode === 'voice' && (activeMode === 'chat' || voiceExhausted && !voiceBusy)) && <motion.div layout="position" className={styles.modes} role="group" aria-label="Conversation mode" {...reveal}>
        {(['voice', 'chat'] as const).map(option => <motion.button type="button" key={option} aria-pressed={activeMode === option} disabled={option === 'voice' && voiceExhausted}
          title={option === 'voice' && voiceExhausted ? 'Daily voice limit reached' : undefined} onClick={() => switchMode(option)} whileTap={reduce ? undefined : { scale: 0.96 }}>
          {activeMode === option && <motion.span layoutId="selected-mode" className={styles.modeSelection} style={{ borderRadius: 30 }} transition={spring}/>}
          <span className={styles.modeLabel}>{option === 'voice' ? <AudioLines size={14}/> : <MessageCircle size={14}/>} {option === 'voice' ? 'Voice' : 'Chat'}</span>
        </motion.button>)}
      </motion.div>;

  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: 0.36, layout: surfaceTransition }}><LayoutGroup id={layoutId}>
    <motion.section ref={assistantRoot} className={styles.assistant} aria-label="Site assistant">
      <AnimatePresence initial={false}>
        {activeMode === 'voice' ? <VisitorVoiceStage key="voice" error={Boolean(error || voice.error)} entered={entered} identity={identity} status={status || searchActivity || liveVoice.activity || (liveVoice.updating ? 'Updating view · microphone paused…' : voice.phase === 'connecting' ? 'Connecting…' : voice.phase === 'thinking' ? 'Thinking…' : '')} hint={demo ? 'Preview voice · no microphone or AI calls' : 'Tap the wave whenever you’re ready'}>
          <motion.button ref={waveControl} type="button" className="site-wave" aria-label={voiceLabel} aria-pressed={voiceBusy} disabled={disabled && !voiceBusy}
            onClick={event => { if (voiceBusy && event.currentTarget.matches(':focus-visible')) requestControlFocus(); startVoice(); }}
            onKeyDown={event => { if (event.key === 'Escape' && voiceBusy) { event.preventDefault(); event.stopPropagation(); requestControlFocus(); voice.cancel(); } }}
            >
            <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser}/>
          </motion.button>
          <span className={styles.srOnly}>{voice.phase === 'listening' ? 'Listening · speak naturally · tap to end' : voice.phase === 'speaking' ? 'Speaking · you can interrupt · tap to end' : ''}</span>
        </VisitorVoiceStage> : <ConversationDock key="chat" expanded={chatExpanded} onDismiss={() => setChatExpanded(false)} suggestions={
          <div className={styles.suggestions} aria-label="Ideas to explore">
            {suggestions.map(suggestion => <motion.button key={suggestion.label} type="button" disabled={busy || disabled || !state?.chatRemaining}
              onClick={() => { input.current?.focus({ preventScroll: true }); void sendChat(undefined, suggestion.question.slice(0, 2000)); }}
              whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: .97 }}><suggestion.icon size={13}/><span>{suggestion.label}</span></motion.button>)}
          </div>}>
          <form className={styles.composer} onSubmit={event => void sendChat(event)}>
            <textarea ref={input} aria-label="What would you like to see?" placeholder={presentation ? 'Go deeper, compare, or explore something else…' : 'Show me what you have in mind…'} rows={1} maxLength={2000} value={text} readOnly={busy} disabled={disabled || !state?.chatRemaining && !busy}
              onFocus={() => { if (!busy) setChatExpanded(true); }} onPointerDown={() => { if (!busy) setChatExpanded(true); }}
              onChange={event => { setText(event.target.value); if (!busy) setChatExpanded(true); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <motion.button className={styles.send} type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop request' : 'Show me'} title={busy ? 'Stop request' : 'Show me'} disabled={!busy && (disabled || !state?.chatRemaining || !text.trim())}
              onClick={event => { if (busy) { event.preventDefault(); pending.current?.abort(); } }} whileHover={reduce || !text.trim() && !busy ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.93 }}>
              <AnimatePresence mode="wait" initial={false}><motion.span key={busy ? 'stop' : 'send'} initial={{ opacity: 0, y: reduce ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -5 }} transition={{ duration: reduce ? 0 : 0.24 }}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={18}/>}</motion.span></AnimatePresence>
            </motion.button>
          </form>
        </ConversationDock>}
      </AnimatePresence>
      {modeControls}
      <AnimatePresence initial={false}>{status && activeMode !== 'voice' && <motion.p key={status} className={styles.status} role={error || voice.error ? 'alert' : 'status'} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduce ? 0 : 0.4 }}>{status}</motion.p>}</AnimatePresence>
      {activeMode === 'voice' && !voiceBusy && !!(voice.error || liveVoice.message || error) && !!state?.chatRemaining && state.enabled && <button type="button" className={styles.fallback} onClick={() => { requestControlFocus(false, 'chat'); switchMode('chat'); }}>Continue by typing</button>}
      <motion.div className={styles.results} initial={false} animate={{ opacity: entered || activeMode === 'chat' ? 1 : .55 }} transition={{ duration: reduce ? 0 : .8 }}>
      {opening}
      {searchSettings.enabled && <SearchExplore handleRef={searchView} content={content} slug={slug} onInteraction={manualInteraction} onContext={searchContextChanged} onActivity={setSearchActivity}/>}
      {catalog ? <CatalogExplorer commandRef={catalogCommand} key={catalog.id} catalog={catalog} media={media} resolveAssetUrl={resolveAssetUrl} onPhotoView={onPhotoView} accent={content.accent} plan={catalogPlan} pending={preparingView || liveVoice.active && liveVoice.phase === 'thinking'} showComposer={false} onStateChange={next => { catalogState.current = next; updateContext(getContext()); }} onInteraction={() => { manualInteraction(); onExplore(); }} onOutcome={event => onCatalogEvent?.({ ...event, type: 'outcome' })} onPresentation={plan => { acceptedCatalogPlan.current = plan; onCatalogEvent?.({ type: 'presentation_accepted', kind: 'display', operation: plan.operation }); updateContext(getContext()); }}/>
        : <SitePresentation content={content} media={media} presentation={presentation} busy={preparingView || liveVoice.active && liveVoice.phase === 'thinking'} onReset={resetView} onInteraction={manualInteraction}/>}
      {!catalog && !presentation && <div className="site-cards" data-visitor-component="collection">
        {presentationSources(content, media).filter(source => ['section', 'hours', 'contact'].includes(source.kind)).map(source => <motion.button key={source.id} type="button" className="site-card" data-source-id={source.id} aria-label={`Explore ${source.title}`}
          onClick={() => { manualInteraction(); onExplore(); const next: Presentation = { layout: 'detail', sources: [source.id], status: 'ready' }; acceptedPresentation.current = next; setPresentation(next); }}
          layout={reduce ? false : 'position'} initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={revealTransition}>
          <h2>{source.title}</h2>{source.kind === 'section' && <EntityMedia targetType="section" targetId={source.id.slice(8)} interactive={false}/>}
          <p className="clamp-copy">{source.body}</p><span className="site-card-action">Take a closer look</span>
        </motion.button>)}
      </div>}
      </motion.div>
    </motion.section>
    {liveVoice.active && typeof document !== 'undefined' && createPortal(<button type="button" className={styles.endVoice} aria-label="End voice conversation" style={{ borderColor: content.accent }}
      onClick={event => {
        if (event.currentTarget.matches(':focus-visible')) requestControlFocus();
        voice.cancel();
      }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestControlFocus(); voice.cancel(); }
      }}><Square size={13} fill="currentColor" aria-hidden="true"/><span>End voice</span></button>, document.body)}
  </LayoutGroup></MotionConfig>;
}
