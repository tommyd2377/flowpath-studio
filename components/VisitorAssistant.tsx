'use client';
import type { GreetingRecordTopic } from '@/lib/greeting-records';
import { visitorWorkLabel } from '@/lib/visitor-progress';
import VisitorActivity from './VisitorActivity';
import { recordedVisitorFetch } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';
import { carouselCommand } from '@thevoice/platform-ui/carousel';
import { readVisitorChatEvents, type VisitorChatEvent } from '@/lib/visitor-chat-protocol';
import { visitorDiagnostic, visitorDiagnosticTimer } from '../lib/visitor-diagnostics';

import { useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState, type ReactNode, type FormEvent, type MutableRefObject } from 'react';

import { AnimatePresence, LayoutGroup, MotionConfig, motion, useAnimationControls } from 'motion/react';
import { ArrowUp, AudioLines, MessageCircle, Mic, Square } from 'lucide-react';
import Waveform from './Waveform';
import VisitorVoiceStage from './VisitorVoiceStage';
import SearchExplore, { type SearchExploreHandle } from './SearchExplore';
import VisitorWorkspace, { type VisitorWorkspaceHandle } from './VisitorWorkspace';
import { visitorPageIntent } from '@/lib/visitor-navigation';
import { websiteCommandCanMatch } from '@/lib/visitor-command-intent';
import { contextualSearchQuery } from '@/lib/explore-workspace';
import { explicitWorkspaceOpen, planWorkspaceIntent, publishedWorkspace } from '@/lib/visitor-workspace';
import { workspaceControlIntent } from '@/lib/visitor-workspace-command';
import { exploreSettings, exploreKindForText, exploreReference, localExploreCommand, type AnnotationTarget, type ExploreKind } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';
import { siteStyle } from '@/lib/site-style';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { followGreeting, greetingVisuals } from '@/lib/greeting-presentation';
import { demoVisitorReply, visitorSettings, type VisitorAvailability, type VisitorMessage, type VisitorReply } from '@/lib/visitor-model';
import { VisitorConversationHistory } from '@/lib/visitor-conversation-history';
import { demoPresentation, presentationSources, presentationSummary, validatePresentation, type SitePresentation as Presentation } from '@/lib/site-presentation';
import { useChatDictation } from '@/lib/use-chat-dictation';
import { useVisitorVoice } from '@/lib/use-visitor-voice';
import { useVisitorSession } from '@/lib/use-visitor-session';
import { useVisitorTasks, useWebsiteTasks } from './VisitorTasks';
import { navigateVisitorView } from '@/lib/visitor-view-context';
import type { VisitorContext } from '@/lib/visitor-request';
import styles from './VisitorAssistant.module.css';
import { ConversationDock, revealTransition, surfaceTransition, usePlatformReducedMotion } from '@thevoice/platform-ui';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import { initialInteraction, planForIntent, type CatalogInteractionState } from '@thevoice/platform-ui/interaction';
import { openingPresentation, openingVisibility } from '@/lib/site-opening';
import type { MediaLibrary, AssetUrlResolver } from '@thevoice/platform-ui/media';
import type { PlatformEventInput } from '@/lib/platform-events';

const ease = [0.22, 1, 0.36, 1] as const;
const modeSpring = { type: 'spring', stiffness: 420, damping: 36, mass: 0.7 } as const;

export default function VisitorAssistant({ layerOpen, onLayerClose, website, content, slug, entered, invitation = false, initialCatalogPlan, initialSourceIds = [], onControlActivate, onContentInvoke, onContentReset, homeRef, workspaceRef, onViewChange, catalog, media, greetingRecords, interactionRef, onPhotoView, onCatalogEvent, identity }: {
  layerOpen: boolean; onLayerClose: () => void; website: ReactNode;
  onDismissMedia?: () => void;
  workspaceRef?: MutableRefObject<VisitorWorkspaceHandle | null>;
  homeRef?: MutableRefObject<(() => void) | null>;
  identity?: ReactNode; opening?: ReactNode; invitation?: boolean;
  content: SiteContent; slug?: string; entered: boolean; contentInvoked: boolean; initialCatalogPlan?: PresentationPlan | null; initialSourceIds?: string[]; onControlActivate: () => void; onContentInvoke: () => void; onContentReset?: () => void; onViewChange: (active: boolean) => void; catalog?: KnowledgeCatalog | null;
  interactionRef?: MutableRefObject<(() => void) | null>; onPhotoView?: (assetId: string) => void;
  media?: MediaLibrary | null; greetingRecords?: GreetingRecordTopic[]; resolveAssetUrl?: AssetUrlResolver;
  onCatalogEvent?: (event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) => void;
}) {
  const settings = visitorSettings(content);
  const searchSettings = exploreSettings(content);
  const searchView = useRef<SearchExploreHandle>(null);
  const workspaceView = useRef<VisitorWorkspaceHandle>(null);
  const setWorkspaceHandle = useCallback((handle: VisitorWorkspaceHandle | null) => { workspaceView.current = handle; if (workspaceRef) workspaceRef.current = handle; }, [workspaceRef]);
  const greeting = useRef<ReturnType<typeof followGreeting> | null>(null);
  const cancelGreeting = useCallback(() => { greeting.current?.cancel(); greeting.current = null; }, []);
  const greetingPoints = useMemo(() => greetingVisuals(content, publishedWorkspace(content, catalog, media), catalog, greetingRecords), [content, catalog, media, greetingRecords]);
  const [state, setState] = useState<VisitorAvailability | null>(slug ? null : {
    enabled: true, mode: settings.mode, live: false, chatRemaining: settings.chatDailyLimit,
    voiceRemaining: settings.voiceDailyLimit, resetsAt: '',
  });
  const [availabilityLoading, setAvailabilityLoading] = useState(!!slug);
  const tasks = useVisitorTasks(), websiteTasks = useWebsiteTasks();
  const [mode, setMode] = useState<'chat' | 'voice'>(settings.mode === 'chat' ? 'chat' : 'voice');
  const historyRef = useRef(new VisitorConversationHistory());
  function appendMessages(additions: VisitorMessage[], revision?: number, signal?: AbortSignal) { historyRef.current.append(additions, revision, signal); }
  const initialTextSourceIds = useMemo(() => initialSourceIds.filter(id => !/^(?:album|photo):/.test(id)), [initialSourceIds]);
  const initialPresentation = useMemo(() => {
    const photoIds = initialSourceIds.filter(id => /^(?:album|photo):/.test(id));
    const textIds = initialTextSourceIds;
    if (!initialSourceIds.length || catalog && !textIds.length) return null;
    const selected = textIds.length ? textIds : photoIds;
    if (!selected.length) return null;
    try { return validatePresentation({ layout: photoIds.length && !textIds.length ? 'gallery' : selected.length === 1 ? 'detail' : 'cards', sources: selected, status: 'ready' }, content, media); }
    catch { return null; }
  }, [catalog, content, initialSourceIds, initialTextSourceIds, media]);
  const [presentation, setPresentation] = useState<Presentation | null>(initialPresentation);
  const [catalogPlan, setCatalogPlan] = useState<PresentationPlan | undefined>(() => initialCatalogPlan ?? (catalog && openingVisibility(content) === 'legacy' ? openingPresentation(content, catalog) : undefined));
  const acceptedCatalogPlan = useRef(catalogPlan);
  const catalogCommand = useRef<((command: { kind: string; id?: string; ids?: string[] }) => boolean) | null>(null);
  const acceptedPresentation = useRef<Presentation | null>(null);
  const siteRoot = useRef<HTMLElement | null>(null);
  const assistantRoot = useRef<HTMLElement>(null);
  const catalogState = useRef<CatalogInteractionState | undefined>(catalog ? initialInteraction(catalog) : undefined);
  const [text, setText] = useState('');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [hasInformation, setHasInformation] = useState(false);
  const composerSubmitted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [preparingChat, setPreparingChat] = useState(false);
  const [, setPendingAnnotationId] = useState<string | undefined>();
  const [searchActivity, setSearchActivity] = useState('');
  const [, setPreparingView] = useState(false);
  const [error, setError] = useState('');
  const setAnswer = (text: string) => { if (text.trim()) void workspaceView.current?.answer(text); };
  const [chatProgress, setChatProgress] = useState('');
  const [provisionalAnswer, setProvisionalAnswer] = useState('');
  const [greeted, setGreeted] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const submittingChat = useRef<{ text: string } | null>(null);
  const inputCancelledRequest = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const waveControl = useRef<HTMLButtonElement>(null);
  const focusReturn = useRef<{ mode: 'chat' | 'voice'; preventScroll: boolean; origin: Element | null } | null>(null);
  const focusReturnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const focusReturnFrame = useRef(0);
  const layoutId = useId();
  const reduce = usePlatformReducedMotion();
  const modeSelectionAnimation = useAnimationControls();
  const demoVoice = useVisitorVoice();
  const liveVoice = useVisitorSession();
  const cancelDemo = demoVoice.cancel;
  const stopLive = liveVoice.stop;
  const cancelVoice = useCallback(() => { historyRef.current.endVoice(); cancelDemo(); stopLive(); }, [cancelDemo, stopLive]);
  function endVoice() { cancelGreeting(); cancelVoice(); }
  const useLiveState = liveVoice.active || liveVoice.phase === 'error';
  const voice = { ...demoVoice,
    phase: useLiveState ? liveVoice.phase : demoVoice.phase,
    error: liveVoice.phase === 'error' ? liveVoice.message : demoVoice.error,
    inputAnalyser: useLiveState ? liveVoice.inputAnalyser : demoVoice.inputAnalyser,
    outputAnalyser: useLiveState ? liveVoice.outputAnalyser : demoVoice.outputAnalyser };
  const voiceExhausted = state !== null && state.voiceRemaining === 0;
  const voiceBusy = liveVoice.active || voice.phase !== 'idle' && voice.phase !== 'error';
  const activeMode = voiceExhausted && !voiceBusy ? 'chat' : mode;
  const disabled = !state?.enabled;
  const chatDisabled = disabled && !websiteTasks?.available;
  const demo = !slug || !!state?.enabled && !state.live;
  const composing = activeMode === 'chat' && layerOpen && chatExpanded;
  const transcribeChat = useCallback(async (audio: string, signal: AbortSignal) => {
    if (!slug) throw new Error('Dictation is unavailable in this preview.');
    const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}/dictation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ requestId: crypto.randomUUID(), audio }),
    });
    const result: unknown = await response.json();
    const value = result && typeof result === 'object' ? result as Record<string, unknown> : {};
    if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Dictation could not finish. You can still type your message.');
    if (typeof value.text !== 'string' || value.text.length > 2000) throw new Error('Dictation returned an unreadable message. You can still type.');
    return value.text;
  }, [slug]);
  const dictation = useChatDictation({ text, onText: setText,
    enabled: activeMode === 'chat' && !availabilityLoading && !chatDisabled && state?.chatRemaining !== 0,
    transcribe: state?.live && slug ? transcribeChat : undefined });
  const dictationHelpId = useId();
  const stopDictation = dictation.stop;
  useEffect(() => { if (!layerOpen || !chatExpanded) stopDictation(); }, [layerOpen, chatExpanded, stopDictation]);
  useEffect(() => { tasks?.setPending(busy || liveVoice.updating || liveVoice.working); }, [busy, liveVoice.updating, liveVoice.working, tasks]);
  useEffect(() => { if (!busy) return; const timer = setTimeout(() => setChatProgress(current => current || 'Still working…'), 8000); return () => clearTimeout(timer); }, [busy]);
  const manualInterrupt = liveVoice.manualInterrupt;
  const updateContext = liveVoice.updateContext;
  const getContext = useCallback((): VisitorContext => ({
    ...workspaceView.current?.context(),
    ...(tasks?.current() ? { taskSession: tasks.current() } : {}),
  }), [tasks]);
  const cancelInteraction = useCallback((interruptTask = true) => { historyRef.current.invalidatePending(); inputCancelledRequest.current = false; cancelGreeting(); setError(''); setProvisionalAnswer(''); setChatProgress(''); pending.current?.abort(); searchView.current?.cancel(); cancelDemo(); manualInterrupt(); if (interruptTask) tasks?.interrupt(); }, [cancelGreeting, cancelDemo, manualInterrupt, tasks]);
  const manualInteraction = useCallback(() => cancelInteraction(), [cancelInteraction]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancelGreeting(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { cancelGreeting(); document.removeEventListener('visibilitychange', hidden); };
  }, [cancelGreeting]);
  useEffect(() => { if (voice.phase === 'idle' || voice.phase === 'error') cancelGreeting(); }, [voice.phase, cancelGreeting]);
  const searchContextChanged = useCallback(() => { updateContext(getContext(), true); }, [updateContext, getContext]);
  useEffect(() => {
    siteRoot.current = assistantRoot.current?.closest<HTMLElement>('[data-visitor-site]') ?? assistantRoot.current;
    if (!interactionRef) return;
    interactionRef.current = manualInteraction;
    return () => { interactionRef.current = null; };
  }, [interactionRef, manualInteraction]);
  function restoredSurface() { historyRef.current.invalidatePending(); setError(''); setProvisionalAnswer(''); setChatProgress(''); updateContext(getContext(), true); }
  function closeLayer() {
    manualInteraction(); void workspaceView.current?.cancel(); endVoice(); pending.current?.abort(); inFlight.current = false;
    dictation.stop(); onControlActivate(); setBusy(false); setChatExpanded(false); onLayerClose();
  }
  function dismissFocusLayer() {
    dictation.stop();
    if (chatExpanded && hasInformation) {
      composerSubmitted.current = true; setChatExpanded(false); input.current?.blur();
      requestAnimationFrame(() => assistantRoot.current?.querySelector<HTMLButtonElement>('[data-information-surface] button:not(:disabled)')?.focus({ preventScroll: true }));
    } else closeLayer();
  }
  const closeLayerRef = useRef(dismissFocusLayer);
  useEffect(() => { closeLayerRef.current = dismissFocusLayer; });
  const backdropPress = useRef<{ x: number; y: number } | null>(null);
  const restoringFocus = useRef(false);
  useEffect(() => {
    if (!layerOpen) return;
    window.dispatchEvent(new Event('flowpath:pause-media'));
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = input.current ?? waveControl.current;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    let parent = assistantRoot.current?.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    const parentOverflow = parent?.style.overflowY;
    if (parent) parent.style.overflowY = 'hidden';
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeLayerRef.current(); return; }
      if (event.key !== 'Tab') return;
      composerSubmitted.current = false;
      const candidates = [...assistantRoot.current?.querySelectorAll<HTMLElement>('[data-ai-controls] button, [data-ai-controls] textarea, [data-ai-carousel] button, [data-ai-carousel] a, [data-ai-carousel] video, [data-ai-carousel] summary, [data-ai-carousel] [tabindex="0"]') ?? []].filter(element => !element.matches(':disabled') && !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length);
      const index = candidates.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && (index < 0 || index === candidates.length - 1)) { event.preventDefault(); candidates[event.shiftKey ? candidates.length - 1 : 0]?.focus({ preventScroll: true }); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.body.style.overflow = bodyOverflow; if (parent) parent.style.overflowY = parentOverflow ?? ''; document.removeEventListener('keydown', keyboard, true); restoringFocus.current = true; if (origin?.isConnected && !origin.closest('[inert], [hidden]')) origin.focus({ preventScroll: true }); else fallback?.focus({ preventScroll: true }); restoringFocus.current = false; };
  }, [layerOpen]);
  useLayoutEffect(() => {
    const element = assistantRoot.current, controls = element?.querySelector<HTMLElement>('[data-ai-controls]');
    if (!element || !controls) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      const deadline = performance.now() + 1000;
      let previous = '', stable = 0;
      const sample = () => {
        const viewport = window.visualViewport, top = viewport?.offsetTop ?? 0;
        const bottom = Math.max(controls.getBoundingClientRect().bottom, ...[...controls.querySelectorAll<HTMLElement>('[data-visitor-conversation-controls]')].map(control => control.getBoundingClientRect().bottom));
        element.style.setProperty('--assistant-controls-bottom', `${Math.max(76, bottom - top)}px`);
        element.style.setProperty('--assistant-viewport-height', `${viewport?.height ?? innerHeight}px`);
        element.style.setProperty('--assistant-viewport-top', `${top}px`);
        // ResizeObserver cannot observe Motion's transform-only settling. Follow
        // it briefly so the card never keeps a measurement from mid-transition.
        const geometry = [bottom, top, viewport?.height ?? innerHeight].map(value => Math.round(value * 2)).join(':');
        stable = geometry === previous ? stable + 1 : 0; previous = geometry;
        if (stable < 6 && performance.now() < deadline) frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(controls);
    window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [layerOpen, mode]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      // One mounted highlight can reverse in place; labels never participate in
      // layout scaling. Also settle immediately if the OS preference changes.
      const target = { x: activeMode === 'chat' ? '100%' : '0%' };
      modeSelectionAnimation.stop();
      if (preference.matches) modeSelectionAnimation.set(target);
      else void modeSelectionAnimation.start(target, modeSpring);
    };
    update(); preference.addEventListener('change', update);
    return () => { preference.removeEventListener('change', update); modeSelectionAnimation.stop(); };
  }, [activeMode, modeSelectionAnimation]);
  function beginComposition() {
    composerSubmitted.current = false; onControlActivate(); onContentInvoke(); setChatExpanded(true);
  }
  function editComposition() {
    beginComposition();
    if (busy || preparingChat || inFlight.current) {
      manualInteraction(); inputCancelledRequest.current = true; void workspaceView.current?.cancel();
      submittingChat.current = null; inFlight.current = false; setBusy(false); setPreparingChat(false);
    }
  }
  const reveal = { initial: false as const, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: reduce ? 0 : -6 }, transition: { duration: reduce ? 0 : 0.28, ease } };

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
    if (slug) void recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.availability) throw new Error(body.error || 'The assistant is unavailable.');
        if (!controller.signal.aborted) setState(body.availability);
      }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setAvailabilityLoading(false); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, [slug]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const resize = () => { element.style.height = 'auto'; element.style.height = `${Math.min(element.scrollHeight, 128)}px`; };
    resize();
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (Math.abs(width - next) > .5) { width = next; resize(); }
    });
    observer.observe(element); return () => observer.disconnect();
  }, [text, activeMode, availabilityLoading, presentation]);

  async function requestTurn(kind: 'chat' | 'voice' | 'greeting', value: string, signal: AbortSignal, requestId?: string, taskPrepared = false) {
    setAnswer('');
    const traceId = requestId ?? crypto.randomUUID(), elapsed = visitorDiagnosticTimer();
    visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: 'started', operation: kind === 'chat' ? 'chat' : 'voice' });
    const history = historyRef.current.snapshot(), historyRevision = historyRef.current.checkpoint();
    let failure: Extract<VisitorChatEvent, { type: 'error' }>['diagnostic'];
    let completeTask: ReturnType<NonNullable<typeof tasks>['completion']> | undefined;
    if (kind !== 'greeting') setPreparingView(true);
    try {
      let result: VisitorReply;
      if (!slug) {
        const next = { ...state!, chatRemaining: state!.chatRemaining - (kind === 'chat' ? 1 : 0), voiceRemaining: state!.voiceRemaining - (kind !== 'chat' ? 1 : 0) };
        const plan = kind === 'greeting' || workspaceView.current ? undefined : demoPresentation(content, value, history, media);
        result = { text: kind === 'greeting' ? getWelcomeMessage(content, catalog, greetingRecords) : workspaceView.current ? '' : catalog ? 'Explore the published items below.' : kind === 'chat' ? presentationSummary(plan!, content, media) : demoVisitorReply(content, value), presentation: plan,
          ...(catalog && kind !== 'greeting' && !workspaceView.current ? { catalogPlan: planForIntent(catalog, value, catalogState.current, media ?? undefined) } : {}), demo: true, availability: next };
        if (kind !== 'greeting' && workspaceView.current) {
          const context = workspaceView.current.context();
          const selected = planWorkspaceIntent(value, context.workspace, publishedWorkspace(content, catalog, media, context.externalResults), context.scene, catalog, media);
          result = { text: selected.message, workspaceBatch: selected.batch, demo: true, availability: next };
        }
      } else {
        const preparationStarted = performance.now();
        await tasks?.settle(!taskPrepared); signal.throwIfAborted();
        if (kind === 'chat') completeTask = tasks?.completion(signal);
        recordBrowserTestEvent('chat.preparation', { stage: 'settle', durationMs: performance.now() - preparationStarted }, traceId);
        const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ kind, requestId: traceId, history, context: getContext(),
            ...(kind === 'chat' ? { text: value } : kind === 'voice' ? { audio: value } : {}) }),
        });
        if (response.ok && response.body && response.headers.get('content-type')?.includes('application/x-ndjson')) {
          let control: Extract<VisitorChatEvent, { type: 'control' }>['control'] | undefined;
          let completed: VisitorReply | undefined, seq = 0;
          await readVisitorChatEvents(response.body, signal, async event => {
            recordBrowserTestEvent(`chat.${event.type}`, event, traceId);
            if (event.type === 'control') { control = event.control; return; }
            if (event.type === 'progress') { if (event.requestId === traceId) setChatProgress(visitorWorkLabel[event.stage]); return; }
            if (event.type === 'answer') { if (event.requestId === traceId) setProvisionalAnswer(event.text); return; }
            if (event.type === 'error') { failure = event.diagnostic; throw new Error(event.message); }
            if (event.type === 'done') { if (event.taskCheckpoint) await completeTask?.accept(event.taskCheckpoint); completed = { text: event.text, displaySatisfied: event.displaySatisfied, availability: event.availability }; return; }
            if (!control || !workspaceView.current) throw new Error('The task controls are unavailable.');
            let visible = false;
            const onVisible = () => { if (!visible && !signal.aborted) { visible = true; visitorDiagnostic({ traceId, channel: 'browser', stage: 'visual_result', status: 'observed', durationMs: elapsed() }); } };
            let status: 'applied' | 'failed' | 'cancelled' = 'failed';
            if (event.target.kind === 'answer') { status = await workspaceView.current.answer(event.target.text, signal, event.target.relationship, event.target.placement); }
            else if (event.target.kind === 'carousel') {
              // A model-requested Back is the result of this transaction, not a
              // cancellation of the empty transaction created to interpret it.
              if (['back', 'forward'].includes(event.target.action)) workspaceView.current.finish(traceId);
              status = await workspaceView.current.navigate(event.target.action, event.target.id, undefined, signal);
            }
            else if (event.target.kind === 'task') status = await tasks?.show(event.target.view, signal, onVisible) ?? 'failed';
            else if (event.target.kind === 'workspace') status = await workspaceView.current.apply(event.target.batch, signal);
            else if (event.target.kind === 'explore') {
              if (event.target.result) {
                if (!searchView.current) throw new Error('The search view is unavailable.');
                await searchView.current.show(event.target.result, signal); status = 'applied';
              }
              else if (event.target.command) status = searchView.current?.command(event.target.command) ? await workspaceView.current.confirm(signal) : 'failed';
            }
            signal.throwIfAborted();
            if (status === 'applied') onVisible();
            const acknowledged = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}/session/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
              body: JSON.stringify({ control, update: { seq: ++seq, interactionRevision: 0, viewRevision: 0, ready: true, context: getContext(), navigationAck: { id: event.id, status } } }) });
            if (!acknowledged.ok) throw new Error('The task could not confirm the displayed view.');
          });
          setProvisionalAnswer('');
          if (!completed) throw new Error('The task ended before completion.');
          result = completed;
        } else {
          const body = await response.json();
          if (signal.aborted) throw new Error('Request cancelled.');
          if (body.availability) setState(body.availability);
          if (!response.ok) throw new Error(body.error || 'The assistant is unavailable.');
          result = body;
        }
      }
      if (signal.aborted) throw new Error('Request cancelled.');
      recordBrowserTestEvent('chat.reply', result, traceId);
      setState(result.availability);
      if (kind !== 'greeting') {
        if (workspaceView.current) {
          if (result.workspaceBatch) {
            const status = await workspaceView.current.apply(result.workspaceBatch, signal);
            if (status !== 'applied') throw new Error(status === 'cancelled' ? 'Request cancelled by a newer interaction.' : 'The browser could not confirm the view. Your workspace remains available.');
          } else if (result.catalogPlan || result.presentation) {
            const status = await workspaceView.current.plan(result.catalogPlan ?? result.presentation!, signal);
            if (status !== 'applied') throw new Error('The view was not applied. Your workspace remains available.');
          }
          if (!result.workspaceBatch && !result.catalogPlan && !result.presentation && !result.displaySatisfied) await workspaceView.current.answer(result.text, signal);
          else { onContentInvoke(); updateContext(getContext(), true); }
          appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant', text: result.text || 'Workspace updated.' }], historyRevision, signal);
          visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: 'succeeded', durationMs: elapsed() });
          return result;
        }
        if (catalog) {
          try {
            const next = validatePlan(result.catalogPlan, catalog, catalog.id, media ?? undefined);
            acceptedCatalogPlan.current = next; setCatalogPlan(next); acceptedPresentation.current = null; setPresentation(null); updateContext(getContext(), true);
          }
          catch { onCatalogEvent?.({ type: 'presentation_rejected', kind: 'display' }); throw new Error('The site could not prepare that view. Your current view is still available.'); }
          onContentInvoke();
          appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant', text: result.text }], historyRevision, signal);
          visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: 'succeeded', durationMs: elapsed() });
          return result;
        }
        let plan: Presentation;
        try { plan = validatePresentation(result.presentation, content, media); }
        catch { throw new Error('The site could not prepare that view. Please try again.'); }
        acceptedPresentation.current = plan; setPresentation(plan); updateContext(getContext(), true); onViewChange(true); onContentInvoke();
        // Follow-up context stays internal; visitors see the actual site components.
        appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' },
          { role: 'assistant', text: presentationSummary(plan, content, media) }], historyRevision, signal);
      }
      return result;
    } catch (error) {
      recordBrowserTestEvent('chat.failed', { error, aborted: signal.aborted }, traceId);
      visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: signal.aborted ? 'cancelled' : 'failed', durationMs: elapsed(), ...failure });
      throw error;
    } finally {
      try { await completeTask?.finish(); }
      finally { if (kind !== 'greeting') setPreparingView(false); }
    }
  }
  async function runSearch(query: string, kind: ExploreKind, target?: AnnotationTarget) {
    manualInteraction(); setText(''); setError(''); setChatExpanded(false); onControlActivate();
    const controller = new AbortController(); pending.current = controller;
    inFlight.current = true; setBusy(true);
    try {
      const context = workspaceView.current?.context();
      const grounded = contextualSearchQuery(query, context?.workspace, publishedWorkspace(content, catalog, media), context?.explore);
      await searchView.current?.search(grounded, kind, controller.signal, target);
    }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Search could not start.'); }
    finally { if (pending.current === controller) { pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); } }
  }
  async function home(signal?: AbortSignal, clear = false) {
    dictation.stop();
    if (signal?.aborted) return 'cancelled' as const;
    // A spoken Home must not interrupt its own navigation acknowledgement.
    if (!signal) manualInteraction();
    pending.current?.abort(); pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); searchView.current?.reset();
    historyRef.current.invalidatePending(); setAnswer(''); setText(''); setError(''); setSearchActivity(''); setChatExpanded(false);
    setPresentation(initialPresentation); acceptedPresentation.current = initialPresentation;
    setCatalogPlan(initialCatalogPlan ?? undefined); acceptedCatalogPlan.current = initialCatalogPlan ?? undefined;
    catalogState.current = catalog ? initialInteraction(catalog) : undefined;
    // Clearing visible surfaces must work even while task storage is unavailable.
    // Existing manual interruption owns cancellation; hiding never creates a task.
    if (clear) tasks?.hide();
    const taskStatus = clear || !websiteTasks?.available || !tasks?.current() ? undefined : await tasks.home(signal);
    onContentReset?.();
    const status = taskStatus === 'applied' ? taskStatus : await (clear ? workspaceView.current?.clear(signal) : workspaceView.current?.home(signal)) ?? 'failed';
    // A successful task reset can invoke its view during the receipt. Home must
    // also leave the assistant layer after that view has finished applying.
    if (!clear && !signal?.aborted) onLayerClose();
    updateContext(getContext(), true); return taskStatus && taskStatus !== 'applied' ? taskStatus : status;
  }
  useEffect(() => { if (homeRef) homeRef.current = () => { void home(); }; return () => { if (homeRef) homeRef.current = null; }; });
  async function sendChat(event?: FormEvent, question = text) {
    event?.preventDefault(); const outgoing = question.trim(); if (!outgoing) return;
    // Claim submission before the first async surface transition. Repeated
    // Enter/click events must not start competing copies of the same request.
    if (submittingChat.current?.text === outgoing) return;
    const submission = { text: outgoing };
    submittingChat.current = submission;
    dictation.stop(); composerSubmitted.current = true; input.current?.blur();
    onContentInvoke(); setPreparingChat(true); setChatExpanded(false);
    try {
      const requestId = crypto.randomUUID();
      recordBrowserTestEvent('chat.requested', { text: outgoing }, requestId);
      const historyAction = carouselCommand(outgoing)?.action;
      const isBack = historyAction === 'back', isHistory = isBack || historyAction === 'forward';
      const cancelledByInput = inputCancelledRequest.current; inputCancelledRequest.current = false;
      if (isBack && cancelledByInput) { await workspaceView.current?.cancel(); setText(''); updateContext(getContext(), true); return; }
      if (inFlight.current || liveVoice.working || workspaceView.current?.context().surface.pendingRequestId) {
        manualInteraction(); await workspaceView.current?.cancel();
        if (isBack) { setText(''); setBusy(false); inFlight.current = false; updateContext(getContext(), true); return; }
      }
      if (!isHistory && workspaceView.current && await workspaceView.current.begin(requestId, true, false) !== 'applied') return;
      if (submittingChat.current !== submission) return;
      try { await performChat(undefined, question, requestId); }
      finally { if (!isHistory) workspaceView.current?.finish(requestId); }
    } finally { if (submittingChat.current === submission) { submittingChat.current = null; setPreparingChat(false); } }
  }
  async function performChat(event?: FormEvent, question = text, requestId?: string) {
    event?.preventDefault();
    const outgoing = question.trim();
    if (!outgoing) return;
    recordBrowserTestEvent('chat.submitted', { text: outgoing }, requestId);
    composerSubmitted.current = true; onContentInvoke(); setChatExpanded(false);
    // Clear before awaiting the card receipt: a visitor can already be typing
    // the next command while the previous card transition is being confirmed.
    if (carouselCommand(outgoing)) { manualInteraction(); endVoice(); setText(''); }
    if (await workspaceView.current?.command(outgoing)) { updateContext(getContext(), true); return; }
    if (visitorPageIntent(outgoing) === 'home') { await home(); return; }
    if (/^(?:show(?: me)? everything(?: again)?|clear (?:all )?filters|remove (?:all )?filters)$/i.test(outgoing.replace(/[.!?]+$/, '')) && websiteTasks?.available) { manualInteraction(); setAnswer(''); setError(''); setText(''); setChatExpanded(false); await tasks?.reset(); return; }
    if (/^(?:go )?back(?: to (?:those |the )?results)?[.!?]?$/i.test(outgoing) && websiteTasks?.view) { manualInteraction(); setAnswer(''); setError(''); setText(''); setChatExpanded(false); await tasks?.back(); return; }
    const ordinal = outgoing.match(/^open (?:the )?(first|second|third|fourth|fifth|\d+)(?: one| result)?[.!?]?$/i);
    if (ordinal && websiteTasks?.view) { manualInteraction(); setAnswer(''); setError(''); setText(''); setChatExpanded(false); const position = ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal[1].toLowerCase()); await tasks?.openOrdinal(position < 0 ? Number(ordinal[1]) : position + 1); return; }
    if (visitorPageIntent(outgoing) === 'clear') { await home(undefined, true); return; }
    if (visitorPageIntent(outgoing) === 'unfocus' && workspaceView.current) { manualInteraction(); setText(''); setChatExpanded(false); await workspaceView.current.navigate('unfocus'); updateContext(getContext(), true); return; }
    if (visitorPageIntent(outgoing) === 'browse') { manualInteraction(); setText(''); setChatExpanded(false); await workspaceView.current?.browse(); return; }
    let interruptedForCommand = false;
    if (outgoing && websiteTasks?.available && tasks && (!state?.live || websiteCommandCanMatch(outgoing))) {
      cancelInteraction(false); endVoice(); setChatExpanded(false); setBusy(true); setError(''); setAnswer(''); setText(''); onControlActivate();
      interruptedForCommand = true;
      const controller = new AbortController(); pending.current = controller; inFlight.current = true;
      const historyRevision = historyRef.current.checkpoint();
      try {
        const commandStarted = performance.now();
        const command = await tasks.command(outgoing, controller.signal);
        recordBrowserTestEvent('chat.preparation', { stage: 'local_command', durationMs: performance.now() - commandStarted, handled: command?.handled }, requestId);
        if (controller.signal.aborted) return;
        if (!command) { setText(outgoing); return; }
        if (command.handled) {
          if (command.message && !websiteTasks.view) setAnswer(command.message);
          appendMessages([{ role: 'user', text: outgoing }, { role: 'assistant', text: command.message ?? 'The carousel is confirmed.' }], historyRevision, controller.signal);
          updateContext(getContext(), true); return;
        }
      } catch (error) {
        if (!controller.signal.aborted) { setText(outgoing); setError(error instanceof Error ? error.message : 'The website could not be updated.'); }
        return;
      } finally {
        if (pending.current === controller) { pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); }
      }
    }
    if (!state?.live) {
    const searchKind = exploreKindForText(outgoing);
    const workspace = workspaceView.current?.context().workspace;
    const focused = workspace?.objects.find(object => object.instanceId === workspace.focusedId);
    const externalContext = searchView.current?.context();
    const localSearch = searchSettings.enabled && (!focused || focused.component === 'external' || externalContext?.annotationTarget?.instanceId === focused.instanceId) ? localExploreCommand(outgoing, externalContext) : null;
    const wantsAnnotation = searchKind !== 'images' && searchKind !== 'map' && /\b(web|online|internet)\b/i.test(outgoing) && /\b(annotate|enrich)\b|\b(?:add|expand|update)\b.*\b(?:card|context|information|info|details)\b/i.test(outgoing);
    if (wantsAnnotation) {
      const target = workspaceView.current?.annotationTarget(outgoing);
      if (!searchSettings.enabled || !searchSettings.annotations) { setError('This publisher has not enabled web additions to cards.'); return; }
      if (!target) { setError('Open or name one published card to add web context.'); return; }
      await runSearch(outgoing, 'web', target); return;
    }
    if (searchKind && (searchKind !== 'map' || /\b(world|united states|u\.?s\.?|web|online|internet|search)\b/i.test(outgoing))) {
      if (!searchSettings.enabled) { setError('This publisher has not enabled web search.'); return; }
      await runSearch(outgoing, searchKind);
      return;
    }
    if (localSearch && searchView.current?.command(localSearch)) { manualInteraction(); setChatExpanded(false); setText(''); onControlActivate(); onContentInvoke(); return; }
    const referenceError = externalContext && searchSettings.enabled && (!focused || focused.component === 'external' || externalContext.annotationTarget?.instanceId === focused.instanceId) ? exploreReference(outgoing, externalContext)?.error : undefined;
    if (referenceError) { setError(referenceError); return; }
    const direct = workspace && explicitWorkspaceOpen(outgoing, workspace, publishedWorkspace(content, catalog, media), catalog);
    if (direct && workspaceView.current) {
      manualInteraction(); setChatExpanded(false); setText(''); onControlActivate();
      const entity = direct.batch?.operations.flatMap(operation => operation.kind === 'add' ? operation.object.references : []).find(reference => reference.kind === 'entity');
      if (entity && websiteTasks?.available) await websiteTasks.execute('record.detail', { recordId: entity.id });
      else if (direct.batch) await workspaceView.current.apply(direct.batch); else setError(direct.message);
      return;
    }
    if (!websiteTasks?.view && workspaceControlIntent(question) && workspaceView.current) {
      manualInteraction(); setChatExpanded(false); setText(''); onControlActivate();
      await workspaceView.current.intent(question); return;
    }
    }
    if (!question.trim()) return;
    if (disabled) { setText(outgoing); setError('General answers are unavailable. You can still name a collection or published attribute to browse in chat.'); return; }
    if (!state?.chatRemaining) { setText(outgoing); setError('The assistant has reached its daily limit. You can still name a collection, search for items, change filters, sort, or go back in chat.'); return; }
    // A live model task owns cancellation/generation on the server. Cancel the
    // local request immediately, without a redundant interrupt/refresh round trip.
    const taskPrepared = interruptedForCommand || !!(state?.live && websiteTasks?.available && tasks);
    if (!interruptedForCommand) cancelInteraction(!taskPrepared);
    setChatExpanded(false);
    searchView.current?.cancel();
    inFlight.current = true; endVoice(); setBusy(true); setError(''); setText(''); onControlActivate();
    const controller = new AbortController(); pending.current = controller;
    try {
      await requestTurn('chat', outgoing, controller.signal, requestId, taskPrepared);
    }
    catch (error) {
      if (!controller.signal.aborted) { setText(outgoing); setError(error instanceof Error ? error.message : 'The view could not be prepared.'); }
    } finally {
      if (pending.current === controller) { pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); }
      const element = input.current;
      if (element?.form?.contains(document.activeElement)) element.focus({ preventScroll: true });
    }
  }
  async function prepareVoiceContext(signal?: AbortSignal) {
    const workspace = workspaceView.current, existingTask = tasks?.current();
    if (workspace && await workspace.prepare(signal) !== 'applied') throw new Error('The saved information could not be prepared. Please try again.');
    // Workspace preparation already synchronizes/restores an existing task.
    // Fresh visits still initialize it; do not refresh an existing one twice.
    if (!workspace || !existingTask) await tasks?.settle();
    signal?.throwIfAborted();
  }
  async function startVoice() {
    window.dispatchEvent(new Event('flowpath:pause-media'));
    if (voiceBusy) { endVoice(); return; }
    if (disabled || !state?.voiceRemaining) return;
    searchView.current?.cancel(); pending.current?.abort();
    setError(''); onControlActivate(); onContentInvoke();
    // The first invitation may reposition; reconnecting while browsing must
    // preserve the visible subject and spatial references supplied to voice.
    if (state.live && slug) {
      demoVoice.cancel();
      const connection = historyRef.current.beginVoice();
      beginGreeting(!historyRef.current.snapshot().length);
      let latestVoiceRequest = '';
      let surfaceRequest: string | undefined;
      let restoredInterruptedRequest = false;
      void liveVoice.start({ slug, prepare: async signal => { try { await prepareVoiceContext(signal); } catch (error) { throw new Error(error instanceof Error ? `Could not prepare the website: ${error.message}` : 'The visitor task session could not start. Try again.'); } }, context: getContext(), history: historyRef.current.snapshot(), getContext, onAvailability: setState,
        onRequest: async (phase, revision, signal) => {
          if (phase === 'prepare') {
            if (['back', 'forward'].includes(carouselCommand(latestVoiceRequest)?.action ?? '')) return;
            await prepareVoiceContext(signal);
          }
          // Preparation is acknowledged before the server creates this task.
          else if (phase === 'start') {
            if (['back', 'forward'].includes(carouselCommand(latestVoiceRequest)?.action ?? '')) return;
            signal?.throwIfAborted(); const requestId = `voice:${revision}`, workspace = workspaceView.current; surfaceRequest = requestId;
            const status = await workspace?.begin(requestId, false);
            if (signal?.aborted) {
              if (workspace?.context().surface.pendingRequestId === requestId) await workspace.cancel();
              if (surfaceRequest === requestId) surfaceRequest = undefined;
              signal.throwIfAborted();
            }
            if (workspace && status !== 'applied') throw new Error('The information surface could not start this request.');
          }
          else if (phase === 'cancel') {
            if (!['back', 'forward'].includes(carouselCommand(latestVoiceRequest)?.action ?? '')) { restoredInterruptedRequest = !!workspaceView.current?.context().surface.pendingRequestId; await workspaceView.current?.cancel(); }
            surfaceRequest = undefined;
          }
          else { if (surfaceRequest) workspaceView.current?.finish(surfaceRequest); surfaceRequest = undefined; restoredInterruptedRequest = false; }
        },
        onTranscript: event => {
          if (!historyRef.current.transcript(connection, event)) return;
          cancelGreeting(); latestVoiceRequest = event.text;
        },
        onAnswer: event => { historyRef.current.answer(connection, event); },
        onGreetingProgress: text => greeting.current?.caption(text),
        onGreetingInterrupted: cancelGreeting,
        onAudioActivity: state => { greeting.current?.audio(state); if (state.outputActive) workspaceView.current?.narrate(); },
        onNavigate: async (event, signal, onVisible) => {
          cancelGreeting();
          const target = event.target;
          const goesBack = target.kind === 'back' || target.kind === 'carousel' && ['back', 'forward'].includes(target.action);
          if (goesBack) {
            if (surfaceRequest) workspaceView.current?.finish(surfaceRequest); surfaceRequest = undefined;
            if (restoredInterruptedRequest && !(target.kind === 'carousel' && target.action === 'forward')) { restoredInterruptedRequest = false; return await workspaceView.current?.confirm(signal) ?? 'unavailable'; }
          } else restoredInterruptedRequest = false;
          if (target.kind === 'answer') {
            const status = await workspaceView.current?.answer(target.text, signal, target.relationship, target.placement) ?? 'unavailable';
            updateContext(getContext(), true); return status;
          }
          if (target.kind === 'carousel') { const status = await workspaceView.current?.navigate(target.action, target.id, undefined, signal) ?? 'unavailable'; updateContext(getContext(), true); return status; }
          if (target.kind === 'task') { const status = await tasks?.show(target.view, signal, onVisible) ?? 'unavailable'; updateContext(getContext(), true); return status; }
          if (target.kind === 'home') return home(signal);
          if (target.kind === 'clear') return home(signal, true);
          if (target.kind === 'browse') return workspaceView.current?.browse(signal) ?? 'unavailable';
          if (target.kind === 'workspace') {
            if (!workspaceView.current) return 'unavailable';
            const status = await workspaceView.current.apply(target.batch, signal);
            updateContext(getContext(), true);
            return status;
          }
          if (target.kind === 'explore') {
            if (signal.aborted || !searchView.current || !searchSettings.enabled) return 'unavailable';
            if (target.result) await searchView.current.show(target.result, signal);
            else if (!target.command || !searchView.current.command(target.command)) return 'unavailable';
            onControlActivate(); onContentInvoke();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return signal.aborted ? 'cancelled' : workspaceView.current ? workspaceView.current.confirm(signal) : 'applied';
          }
          if (['open', 'focus', 'expand', 'close', 'unfocus', 'spotlight', 'compare', 'back', 'collapse'].includes(target.kind)) {
            if (workspaceView.current) {
              const status = await workspaceView.current.navigate(target.kind, 'id' in target ? target.id : undefined, 'ids' in target ? target.ids : undefined, signal);
              updateContext(getContext(), true); return status;
            }
            if (!catalog) {
              if (target.kind === 'back' || target.kind === 'collapse') { acceptedPresentation.current = null; setPresentation(null); updateContext(getContext(), true); return 'applied'; }
              if (!('id' in target) || !presentationSources(content, media).some(source => source.id === target.id)) return 'unavailable';
              const next = validatePresentation({ layout: 'detail', sources: [target.id], status: 'ready' }, content, media);
              acceptedPresentation.current = next; setPresentation(next); updateContext(getContext(), true);
            } else if (!catalogCommand.current?.(target)) return 'unavailable';
            onControlActivate(); onContentInvoke();
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            if (signal.aborted) return 'unavailable';
            if ('id' in target) return navigateVisitorView(siteRoot.current, { kind: catalog ? 'entity' : 'source', id: target.id }, signal, manualInteraction);
            if (target.kind === 'compare') return navigateVisitorView(siteRoot.current, { kind: 'entity', id: target.ids[0] }, signal, manualInteraction);
            return navigateVisitorView(siteRoot.current, { kind: 'current' }, signal, manualInteraction);
          }
          if (workspaceView.current) return workspaceView.current.navigate(target.kind, 'id' in target ? target.id : undefined, undefined, signal);
          return navigateVisitorView(siteRoot.current, target as Parameters<typeof navigateVisitorView>[1], signal, manualInteraction);
        }, onPlan: async (event, signal) => {
        if (signal.aborted) return;
        cancelGreeting();
        if (workspaceView.current && (event.catalogPlan || event.presentation)) {
          const status = await workspaceView.current.plan((event.catalogPlan ?? event.presentation) as PresentationPlan | Presentation, signal);
          if (status !== 'applied') throw new Error('The browser did not apply the view.');
          updateContext(getContext(), true); onContentInvoke(); return;
        }
        if (catalog) {
          try {
            const next = validatePlan(event.catalogPlan, catalog, catalog.id, media ?? undefined);
            acceptedCatalogPlan.current = next; setCatalogPlan(next); acceptedPresentation.current = null; setPresentation(null); updateContext(getContext(), true); onContentInvoke();
          }
          catch { onCatalogEvent?.({ type: 'presentation_rejected', kind: 'display' }); throw new Error('The site could not prepare that view. Your current view is still available.'); }
        } else {
          try { const plan = validatePresentation(event.presentation, content, media); acceptedPresentation.current = plan; setPresentation(plan); updateContext(getContext(), true); onViewChange(true); onContentInvoke(); }
          catch { throw new Error('The site could not prepare that view. Your current view is still available.'); }
        }
      } });
    } else if (!greeted && !content.visitorSpeaksFirst) {
      setGreeted(true);
      beginGreeting(true);
      void voice.respond(signal => requestTurn('greeting', '', signal), !state.live, {
        caption: text => greeting.current?.caption(text), audio: state => greeting.current?.audio(state), finish: () => greeting.current?.finish(),
      });
    } else {
      void voice.respond(signal => requestTurn('voice', '', signal), true);
    }
  }
  function beginGreeting(eligible: boolean) {
    cancelGreeting();
    if (eligible && !content.visitorSpeaksFirst && greetingPoints.length) greeting.current = followGreeting(greetingPoints, (index, signal) => {
      void workspaceView.current?.greeting(index, signal);
    });
  }
  function switchMode(next: 'chat' | 'voice') {
    dictation.stop(); manualInteraction(); void workspaceView.current?.cancel(); endVoice();
    inFlight.current = false; setBusy(false); setMode(next); setError(''); onControlActivate();
    if (next === 'chat') { beginComposition(); requestControlFocus(true, 'chat'); }
    else { setChatExpanded(false); if (!hasInformation) onLayerClose(); }
  }
  const voiceLabel = voice.phase === 'connecting' && !liveVoice.updating ? 'Cancel connection' : voiceBusy ? 'End conversation' : demo ? 'Preview voice' : 'Start conversation';
  const status = error || voice.error || liveVoice.message || (!state ? 'Loading assistant…' : !state.enabled ? 'This site’s assistant is currently unavailable.'
    : activeMode === 'chat' && state.chatRemaining === 0 ? 'You can still browse and filter in chat. General answers resume after the daily reset.' : '');

  const modeControls = settings.mode !== 'chat' && <motion.div className={styles.modes} data-visitor-conversation-controls="true" role="group" aria-label="Conversation mode" {...reveal}>
        {/* The preference listener above owns this single transform so live
            preference changes can stop it as well as re-enable it. */}
        <MotionConfig reducedMotion="never"><motion.span aria-hidden="true" data-mode-selection className={styles.modeSelection} initial={{ x: activeMode === 'chat' ? '100%' : '0%' }} animate={modeSelectionAnimation}/></MotionConfig>
        {(['voice', 'chat'] as const).map(option => <button type="button" key={option} tabIndex={0} aria-pressed={activeMode === option} disabled={option === 'voice' && voiceExhausted}
          title={option === 'voice' && voiceExhausted ? 'Daily voice limit reached' : undefined} aria-description={option === 'voice' && voiceExhausted ? 'Daily voice limit reached. Chat is available.' : undefined} onClick={() => switchMode(option)}>
          <span className={styles.modeLabel}>{option === 'voice' ? <AudioLines size={14}/> : <MessageCircle size={14}/>} {option === 'voice' ? 'Voice' : 'Chat'}</span>
        </button>)}
      </motion.div>;

  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: 0.36, layout: surfaceTransition }}><LayoutGroup id={layoutId}>
    <motion.section ref={assistantRoot} className={styles.assistant} role={layerOpen ? 'dialog' : undefined} aria-modal={layerOpen || undefined} aria-label={layerOpen ? 'Assistant exploration' : 'Site assistant'} data-ai-layer-open={layerOpen} data-chat-composing={composing}>
      <div className={styles.interaction} data-ai-controls data-voice-invitation={invitation && !entered && activeMode === 'voice'} data-voice-color={content.visitor?.conversation?.color}>
      <AnimatePresence initial={false}>
        {activeMode === 'voice' ? <VisitorVoiceStage key="voice" invitation={invitation} onBrowseWebsite={closeLayer} working={liveVoice.working || voice.phase === 'connecting' || liveVoice.active && !liveVoice.inputReady || !!searchActivity} error={Boolean(error || voice.error)} entered={entered} identity={identity} status={status || searchActivity || liveVoice.activity || liveVoice.startupStage || (voice.phase === 'connecting' ? 'Connecting…' : liveVoice.working ? 'Working on your request…' : voice.phase === 'thinking' ? 'Thinking…' : liveVoice.inputReady && voice.phase === 'listening' ? 'Listening' : '')} hint={demo ? 'Preview voice · no microphone or AI calls' : 'Tap the wave whenever you’re ready'}>
          <motion.button ref={waveControl} type="button" className="site-wave" aria-label={voiceLabel} aria-pressed={voiceBusy} disabled={disabled && !voiceBusy}
            onFocus={() => { if (state?.live && !voiceBusy) void tasks?.settle().catch(() => undefined); }}
            onPointerEnter={() => { if (state?.live && !voiceBusy) void tasks?.settle().catch(() => undefined); }}
            onClick={event => { if (voiceBusy && event.currentTarget.matches(':focus-visible')) requestControlFocus(); startVoice(); }}
            onKeyDown={event => { if (event.key === 'Escape' && voiceBusy) { event.preventDefault(); event.stopPropagation(); requestControlFocus(); endVoice(); } }}
            >
            <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser} color={siteStyle(content)['--voice-accent']}/>
          </motion.button>
          <span className={styles.srOnly}>{liveVoice.active && !liveVoice.inputReady ? 'Microphone preparing' : voice.phase === 'listening' ? 'Listening · speak naturally · tap to end' : voice.phase === 'speaking' ? 'Speaking · you can interrupt · tap to end' : ''}</span>
        </VisitorVoiceStage> : <ConversationDock key="chat" expanded={composing} onDismiss={dismissFocusLayer}>
          {availabilityLoading && <p role="status" className={styles.voiceNote}>Getting the assistant ready…</p>}
          {(busy || preparingChat) && <div className={styles.chatActivity} data-chat-progress><VisitorActivity label={chatProgress || 'Working…'}/></div>}
          {busy && provisionalAnswer && <p className={styles.srOnly} data-provisional-answer aria-busy="true">{provisionalAnswer}<small>Answer in progress</small></p>}
          <form className={styles.composer} aria-busy={availabilityLoading || busy || preparingChat || dictation.isTranscribing} onSubmit={event => void sendChat(event)}>
            <textarea ref={input} aria-label="What would you like to see?" placeholder={availabilityLoading ? 'Getting the assistant ready…' : presentation ? 'Go deeper, compare, or explore something else…' : 'Show me what you have in mind…'} rows={1} maxLength={2000} value={text} readOnly={availabilityLoading}
              onFocus={() => {
                if (restoringFocus.current || composerSubmitted.current) return;
                beginComposition();
                // Prepare the unpaid task session while the visitor types.
                // Submission still synchronizes and checks current authority.
                if (state?.live && !busy && !tasks?.current()) void tasks?.settle(false).catch(() => undefined);
              }} onPointerDown={beginComposition}
              onChange={event => { dictation.stop(); editComposition(); setText(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <button className={styles.dictate} type="button" aria-label={dictation.isTranscribing ? 'Cancel dictation' : dictation.isListening ? 'Stop dictation' : 'Dictate message'} aria-pressed={dictation.isListening || dictation.isTranscribing} aria-describedby={dictationHelpId}
              disabled={availabilityLoading || chatDisabled || state?.chatRemaining === 0}
              title={!dictation.supported ? 'Dictation is unavailable in this browser. Type or use your keyboard microphone.' : dictation.isTranscribing ? 'Cancel dictation' : dictation.isListening ? 'Stop dictation' : 'Dictate a message, then review and send'}
              onClick={() => { if (dictation.isTranscribing) dictation.stop(); else if (dictation.isListening) dictation.finish(); else { editComposition(); dictation.start(); } }}>
              {dictation.isListening || dictation.isTranscribing ? <Square size={15} fill="currentColor"/> : <Mic size={18}/>}
            </button>
            <motion.button className={styles.send} type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop request' : 'Show me'} title={busy ? 'Stop request' : 'Show me'} disabled={!busy && (!text.trim() || availabilityLoading || chatDisabled)}
              onClick={event => { if (busy) { event.preventDefault(); pending.current?.abort(); void workspaceView.current?.cancel(); } }} whileHover={reduce || !text.trim() && !busy ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.93 }}>
              <AnimatePresence initial={false}><motion.span key={busy ? 'stop' : 'send'} aria-hidden="true" data-send-glyph={busy ? 'stop' : 'send'} initial={{ opacity: 0, y: reduce ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -4 }} transition={{ duration: reduce ? 0 : .16 }}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={18}/>}</motion.span></AnimatePresence>
            </motion.button>
          </form>
          <span id={dictationHelpId} className={styles.srOnly}>Speak to fill your message, then review and send. Audio is processed online for transcription.</span>
          {dictation.message && <p className={styles.dictationStatus} role="status">{dictation.message}</p>}
        </ConversationDock>}
      </AnimatePresence>
      {modeControls}
      {liveVoice.working && <button type="button" className={styles.cancelWork} onClick={() => { manualInteraction(); void workspaceView.current?.cancel(); }}>Cancel request</button>}
      {layerOpen && <button type="button" className={styles.srOnly} onClick={closeLayer}>Return to website</button>}
      </div>
      <div className={styles.website} data-website-background inert={layerOpen}>{website}</div>
      <AnimatePresence initial={false}>{layerOpen && <motion.div className={styles.backdrop} data-ai-backdrop data-assistant-backdrop aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : .3 }}
        onPointerDown={event => { backdropPress.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => { const origin = backdropPress.current; backdropPress.current = null; if (origin && Math.hypot(origin.x - event.clientX, origin.y - event.clientY) < 8) { event.preventDefault(); dismissFocusLayer(); } }}/>}</AnimatePresence>
      <motion.div className={styles.results} data-assistant-results data-defocused={composing} inert={!layerOpen || composing} aria-hidden={!layerOpen || composing} style={{ position: 'relative', zIndex: 42 }} initial={false} animate={layerOpen ? { opacity: 1, visibility: 'visible' } : { opacity: 0, visibility: 'hidden' }} transition={{ duration: reduce ? 0 : .3 }}>
      <VisitorWorkspace greetingRecords={greetingRecords} onMediaAudible={endVoice} active={layerOpen && !composing} hideEmpty={activeMode === 'chat'} onContentChange={setHasInformation} onDismiss={preserveConversation => preserveConversation ? onLayerClose() : closeLayer()} tenantId={slug ?? 'preview'} onRestore={restoredSurface} notice={error || voice.error || (!websiteTasks?.view ? status : '')} pending={busy || liveVoice.working || !!searchActivity} handleRef={setWorkspaceHandle} content={content} catalog={catalog} media={media} onInteraction={manualInteraction} onContext={searchContextChanged} onInvoke={onContentInvoke} onPhotoView={onPhotoView}/>
      {searchSettings.enabled && <SearchExplore handleRef={searchView} content={content} slug={slug} beforeSearch={target => workspaceView.current?.beforeSearch(target)} onResult={async (result, signal) => workspaceView.current?.showExternal(result, signal)} getExternalContext={() => workspaceView.current?.context().explore} onExternalCommand={command => workspaceView.current?.externalCommand(command) ?? false} onInteraction={() => { manualInteraction(); onContentInvoke(); }} onContext={searchContextChanged} onActivity={setSearchActivity} onPendingAnnotationChange={setPendingAnnotationId}/>}
      </motion.div>
    </motion.section>
  </LayoutGroup></MotionConfig>;
}
