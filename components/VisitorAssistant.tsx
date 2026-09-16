'use client';
import { visitorWorkLabel } from '@/lib/visitor-progress';
import LoadingIndicator from './LoadingIndicator';
import { recordedVisitorFetch } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';
import { carouselCommand } from '@thevoice/platform-ui/carousel';
import { readVisitorChatEvents, type VisitorChatEvent } from '@/lib/visitor-chat-protocol';
import { visitorDiagnostic, visitorDiagnosticTimer } from '../lib/visitor-diagnostics';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type FormEvent, type MutableRefObject } from 'react';

import { AnimatePresence, LayoutGroup, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { ArrowUp, ArrowUpRight, AudioLines, Clock3, MessageCircle, Square } from 'lucide-react';
import Waveform from './Waveform';
import VisitorVoiceStage from './VisitorVoiceStage';
import SearchExplore, { type SearchExploreHandle } from './SearchExplore';
import VisitorWorkspace, { type VisitorWorkspaceHandle } from './VisitorWorkspace';
import { visitorPageIntent } from '@/lib/visitor-navigation';
import { contextualSearchQuery } from '@/lib/explore-workspace';
import { explicitWorkspaceOpen, planWorkspaceIntent, publishedWorkspace } from '@/lib/visitor-workspace';
import { exploreSettings, exploreKindForText, exploreReference, localExploreCommand, type AnnotationTarget, type ExploreKind } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { followGreeting, greetingVisuals } from '@/lib/greeting-presentation';
import { demoVisitorReply, visitorSettings, type VisitorAvailability, type VisitorMessage, type VisitorReply } from '@/lib/visitor-model';
import { demoPresentation, presentationSources, presentationSummary, validatePresentation, type SitePresentation as Presentation } from '@/lib/site-presentation';
import { useVisitorVoice } from '@/lib/use-visitor-voice';
import { useVisitorSession } from '@/lib/use-visitor-session';
import { useVisitorTasks, useWebsiteTasks } from './VisitorTasks';
import { navigateVisitorView } from '@/lib/visitor-view-context';
import type { VisitorContext } from '@/lib/visitor-request';
import styles from './VisitorAssistant.module.css';
import { ConversationDock, revealTransition, surfaceTransition } from '@thevoice/platform-ui';
import { validatePlan, type KnowledgeCatalog, type PresentationPlan } from '@thevoice/platform-ui/contracts';
import { initialInteraction, planForIntent, type CatalogInteractionState } from '@thevoice/platform-ui/interaction';
import { openingPresentation, openingVisibility } from '@/lib/site-opening';
import type { MediaLibrary, AssetUrlResolver } from '@thevoice/platform-ui/media';
import type { PlatformEventInput } from '@/lib/platform-events';

const ease = [0.22, 1, 0.36, 1] as const;
const spring = { type: 'spring', stiffness: 330, damping: 34, mass: 0.8 } as const;

export default function VisitorAssistant({ layerOpen, onLayerClose, website, content, slug, entered, initialCatalogPlan, initialSourceIds = [], onControlActivate, onContentInvoke, onContentReset, homeRef, workspaceRef, onViewChange, catalog, media, interactionRef, onPhotoView, onCatalogEvent, identity }: {
  layerOpen: boolean; onLayerClose: () => void; website: ReactNode;
  onDismissMedia?: () => void;
  workspaceRef?: MutableRefObject<VisitorWorkspaceHandle | null>;
  homeRef?: MutableRefObject<(() => void) | null>;
  identity?: ReactNode; opening?: ReactNode;
  content: SiteContent; slug?: string; entered: boolean; contentInvoked: boolean; initialCatalogPlan?: PresentationPlan | null; initialSourceIds?: string[]; onControlActivate: () => void; onContentInvoke: () => void; onContentReset?: () => void; onViewChange: (active: boolean) => void; catalog?: KnowledgeCatalog | null;
  interactionRef?: MutableRefObject<(() => void) | null>; onPhotoView?: (assetId: string) => void;
  media?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver;
  onCatalogEvent?: (event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) => void;
}) {
  const settings = visitorSettings(content);
  const searchSettings = exploreSettings(content);
  const searchView = useRef<SearchExploreHandle>(null);
  const workspaceView = useRef<VisitorWorkspaceHandle>(null);
  const setWorkspaceHandle = useCallback((handle: VisitorWorkspaceHandle | null) => { workspaceView.current = handle; if (workspaceRef) workspaceRef.current = handle; }, [workspaceRef]);
  const greeting = useRef<ReturnType<typeof followGreeting> | null>(null);
  const cancelGreeting = useCallback(() => { greeting.current?.cancel(); greeting.current = null; }, []);
  const greetingPoints = useMemo(() => greetingVisuals(content, publishedWorkspace(content, catalog, media), catalog), [content, catalog, media]);
  const [state, setState] = useState<VisitorAvailability | null>(slug ? null : {
    enabled: true, mode: settings.mode, live: false, chatRemaining: settings.chatDailyLimit,
    voiceRemaining: settings.voiceDailyLimit, resetsAt: '',
  });
  const [availabilityLoading, setAvailabilityLoading] = useState(!!slug);
  const tasks = useVisitorTasks(), websiteTasks = useWebsiteTasks();
  const [mode, setMode] = useState<'chat' | 'voice'>(settings.mode === 'chat' ? 'chat' : 'voice');
  const historyRef = useRef<VisitorMessage[]>([]);
  function appendMessages(additions: VisitorMessage[]) { historyRef.current = [...historyRef.current, ...additions].slice(-8).map(item => ({ ...item, text: item.text.slice(0, 2000) })); }
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
  const composerSubmitted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [, setPendingAnnotationId] = useState<string | undefined>();
  const [searchActivity, setSearchActivity] = useState('');
  const [, setPreparingView] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [chatProgress, setChatProgress] = useState('');
  const [provisionalAnswer, setProvisionalAnswer] = useState('');
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
  function endVoice() { cancelGreeting(); cancelVoice(); }
  const useLiveState = liveVoice.active || liveVoice.phase === 'error';
  const voice = { ...demoVoice, cancel: cancelVoice,
    phase: useLiveState ? liveVoice.phase : demoVoice.phase,
    error: liveVoice.phase === 'error' ? liveVoice.message : demoVoice.error,
    inputAnalyser: useLiveState ? liveVoice.inputAnalyser : demoVoice.inputAnalyser,
    outputAnalyser: useLiveState ? liveVoice.outputAnalyser : demoVoice.outputAnalyser };
  useEffect(() => { tasks?.setPending(busy || liveVoice.updating || liveVoice.working); }, [busy, liveVoice.updating, liveVoice.working, tasks]);
  useEffect(() => { if (!busy) return; const timer = setTimeout(() => setChatProgress('Still working…'), 8000); return () => clearTimeout(timer); }, [busy]);
  const manualInterrupt = liveVoice.manualInterrupt;
  const updateContext = liveVoice.updateContext;
  const getContext = useCallback((): VisitorContext => ({
    ...workspaceView.current?.context(),
    ...(tasks?.current() ? { taskSession: tasks.current() } : {}),
  }), [tasks]);
  const manualInteraction = useCallback(() => { cancelGreeting(); setProvisionalAnswer(''); setChatProgress(''); pending.current?.abort(); searchView.current?.cancel(); cancelDemo(); setAnswer(''); manualInterrupt(); tasks?.interrupt(); }, [cancelGreeting, cancelDemo, manualInterrupt, tasks]);
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
  function closeLayer() {
    manualInteraction(); endVoice(); pending.current?.abort(); inFlight.current = false;
    setBusy(false); setChatExpanded(false); onLayerClose();
  }
  const closeLayerRef = useRef(closeLayer);
  useEffect(() => { closeLayerRef.current = closeLayer; });
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
      const candidates = [...assistantRoot.current?.querySelectorAll<HTMLElement>('[data-ai-controls] button, [data-ai-controls] textarea, [data-ai-carousel] button, [data-ai-carousel] a, [data-ai-carousel] video, [data-ai-carousel] [tabindex="0"]') ?? []].filter(element => !element.matches(':disabled') && !element.closest('[hidden], [inert]') && element.getClientRects().length);
      const index = candidates.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && (index < 0 || index === candidates.length - 1)) { event.preventDefault(); candidates[event.shiftKey ? candidates.length - 1 : 0]?.focus({ preventScroll: true }); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.body.style.overflow = bodyOverflow; if (parent) parent.style.overflowY = parentOverflow ?? ''; document.removeEventListener('keydown', keyboard, true); restoringFocus.current = true; if (origin?.isConnected && !origin.closest('[inert], [hidden]')) origin.focus({ preventScroll: true }); else fallback?.focus({ preventScroll: true }); restoringFocus.current = false; };
  }, [layerOpen]);
  const voiceExhausted = state !== null && state.voiceRemaining === 0;
  const voiceBusy = liveVoice.active || voice.phase !== 'idle' && voice.phase !== 'error';
  const activeMode = voiceExhausted && !voiceBusy ? 'chat' : mode;
  const disabled = !state?.enabled;
  const chatDisabled = disabled && !websiteTasks?.available;
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
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
  }, [text, activeMode]);

  async function requestTurn(kind: 'chat' | 'voice' | 'greeting', value: string, signal: AbortSignal) {
    setAnswer('');
    const traceId = crypto.randomUUID(), elapsed = visitorDiagnosticTimer();
    visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: 'started', operation: kind === 'chat' ? 'chat' : 'voice' });
    const history = historyRef.current.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) }));
    let failure: Extract<VisitorChatEvent, { type: 'error' }>['diagnostic'];
    if (kind !== 'greeting') setPreparingView(true);
    try {
      let result: VisitorReply;
      if (!slug) {
        const next = { ...state!, chatRemaining: state!.chatRemaining - (kind === 'chat' ? 1 : 0), voiceRemaining: state!.voiceRemaining - (kind !== 'chat' ? 1 : 0) };
        const plan = kind === 'greeting' || workspaceView.current ? undefined : demoPresentation(content, value, history, media);
        result = { text: kind === 'greeting' ? getWelcomeMessage(content, catalog) : workspaceView.current ? '' : catalog ? 'Explore the published items below.' : kind === 'chat' ? presentationSummary(plan!, content, media) : demoVisitorReply(content, value), presentation: plan,
          ...(catalog && kind !== 'greeting' && !workspaceView.current ? { catalogPlan: planForIntent(catalog, value, catalogState.current, media ?? undefined) } : {}), demo: true, availability: next };
        if (kind !== 'greeting' && workspaceView.current) {
          const context = workspaceView.current.context();
          const selected = planWorkspaceIntent(value, context.workspace, publishedWorkspace(content, catalog, media, context.externalResults), context.scene, catalog, media);
          result = { text: selected.message, workspaceBatch: selected.batch, demo: true, availability: next };
        }
      } else {
        await tasks?.settle(); signal.throwIfAborted();
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
            if (event.type === 'done') { completed = { text: event.text, displaySatisfied: event.displaySatisfied, availability: event.availability }; return; }
            if (!control || !workspaceView.current) throw new Error('The task controls are unavailable.');
            let visible = false;
            const onVisible = () => { if (!visible && !signal.aborted) { visible = true; visitorDiagnostic({ traceId, channel: 'browser', stage: 'visual_result', status: 'observed', durationMs: elapsed() }); } };
            let status: 'applied' | 'failed' | 'cancelled' = 'failed';
            if (event.target.kind === 'answer') { setAnswer(event.target.text); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); status = await workspaceView.current.confirm(signal); }
            else if (event.target.kind === 'carousel') status = await workspaceView.current.navigate(event.target.action, event.target.id, undefined, signal);
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
          if (!result.workspaceBatch && !result.catalogPlan && !result.presentation && !result.displaySatisfied) setAnswer(result.text);
          else { onContentInvoke(); updateContext(getContext(), true); }
          appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant', text: result.text || 'Workspace updated.' }]);
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
          appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' }, { role: 'assistant', text: result.text }]);
          visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: 'succeeded', durationMs: elapsed() });
          return result;
        }
        let plan: Presentation;
        try { plan = validatePresentation(result.presentation, content, media); }
        catch { throw new Error('The site could not prepare that view. Please try again.'); }
        acceptedPresentation.current = plan; setPresentation(plan); updateContext(getContext(), true); onViewChange(true); onContentInvoke();
        // Follow-up context stays internal; visitors see the actual site components.
        appendMessages([{ role: 'user', text: kind === 'chat' ? value : result.userText || 'Voice request' },
          { role: 'assistant', text: presentationSummary(plan, content, media) }]);
      }
      return result;
    } catch (error) {
      recordBrowserTestEvent('chat.failed', { error, aborted: signal.aborted }, traceId);
      visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: signal.aborted ? 'cancelled' : 'failed', durationMs: elapsed(), ...failure });
      throw error;
    } finally { if (kind !== 'greeting') setPreparingView(false); }
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
    if (signal?.aborted) return 'cancelled' as const;
    // A spoken Home must not interrupt its own navigation acknowledgement.
    if (!signal) manualInteraction();
    pending.current?.abort(); pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); searchView.current?.reset();
    historyRef.current = []; setAnswer(''); setText(''); setError(''); setSearchActivity(''); setChatExpanded(false);
    setPresentation(initialPresentation); acceptedPresentation.current = initialPresentation;
    setCatalogPlan(initialCatalogPlan ?? undefined); acceptedCatalogPlan.current = initialCatalogPlan ?? undefined;
    catalogState.current = catalog ? initialInteraction(catalog) : undefined;
    // Clearing visible surfaces must work even while task storage is unavailable.
    // Existing manual interruption owns cancellation; hiding never creates a task.
    if (clear) tasks?.hide();
    const taskStatus = clear || !websiteTasks?.available || !tasks?.current() ? undefined : await tasks.home(signal);
    onContentReset?.();
    const status = taskStatus === 'applied' ? taskStatus : await (clear ? workspaceView.current?.clear(signal) : workspaceView.current?.home(signal)) ?? 'failed';
    updateContext(getContext(), true); return taskStatus && taskStatus !== 'applied' ? taskStatus : status;
  }
  useEffect(() => { if (homeRef) homeRef.current = () => { void home(); }; return () => { if (homeRef) homeRef.current = null; }; });
  async function sendChat(event?: FormEvent, question = text) {
    event?.preventDefault();
    const outgoing = question.trim();
    if (!outgoing) return;
    recordBrowserTestEvent('chat.submitted', { text: outgoing });
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
    if (outgoing && websiteTasks?.available && tasks) {
      manualInteraction(); endVoice(); setChatExpanded(false); setBusy(true); setError(''); setAnswer(''); setText(''); onControlActivate();
      const controller = new AbortController(); pending.current = controller; inFlight.current = true;
      try {
        const command = await tasks.command(outgoing, controller.signal);
        if (controller.signal.aborted) return;
        if (!command) { setText(outgoing); return; }
        if (command.handled) {
          if (command.message && !websiteTasks.view) setAnswer(command.message);
          historyRef.current = [...historyRef.current, { role: 'user' as const, text: outgoing }, { role: 'assistant' as const, text: command.message ?? 'The carousel is confirmed.' }].slice(-8);
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
    if (!websiteTasks?.view && question.trim() && /\b(highlight|spotlight|close|dismiss|done with|bigger|smaller|collapse|expand|left|right|second|third)\b|\b(?:open|show|pull up)\b.*\b(?:first|fourth|fifth|sixth)\b|^(?:go )?back\b|^reset\b/i.test(question) && workspaceView.current) {
      manualInteraction(); setChatExpanded(false); setText(''); onControlActivate();
      await workspaceView.current.intent(question); return;
    }
    }
    if (!question.trim()) return;
    if (disabled) { setText(outgoing); setError('General answers are unavailable. You can still name a collection or published attribute to browse in chat.'); return; }
    if (!state?.chatRemaining) { setText(outgoing); setError('The assistant has reached its daily limit. You can still name a collection, search for items, change filters, sort, or go back in chat.'); return; }
    manualInteraction();
    setChatExpanded(false);
    searchView.current?.cancel();
    inFlight.current = true; endVoice(); setBusy(true); setError(''); setText(''); onControlActivate();
    const controller = new AbortController(); pending.current = controller;
    try {
      await requestTurn('chat', outgoing, controller.signal);
    }
    catch (error) {
      if (!controller.signal.aborted) { setText(outgoing); setError(error instanceof Error ? error.message : 'The view could not be prepared.'); }
    } finally {
      if (pending.current === controller) { pending.current = null; inFlight.current = false; setBusy(false); setChatProgress(''); setProvisionalAnswer(''); }
      const element = input.current;
      if (element?.form?.contains(document.activeElement)) element.focus({ preventScroll: true });
    }
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
      const earlierHistory = historyRef.current.slice(-8);
      beginGreeting(!earlierHistory.length);
      const transcripts = new Map<string, { role: 'user' | 'assistant'; text: string; revision: number }>();
      void liveVoice.start({ slug, prepare: async signal => { try { await tasks?.settle(); signal.throwIfAborted(); } catch (error) { throw new Error(error instanceof Error ? `Could not prepare the website: ${error.message}` : 'The visitor task session could not start. Try again.'); } }, context: getContext(), history: historyRef.current.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })), getContext, onAvailability: setState,
        onTranscript: event => {
          if (event.role === 'user') cancelGreeting();
          transcripts.set(event.id, event);
          historyRef.current = [...earlierHistory, ...[...transcripts.values()].sort((a, b) => a.revision - b.revision || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)).map(({ role, text }) => ({ role, text }))].slice(-8);
        },
        onGreetingProgress: text => greeting.current?.caption(text),
        onGreetingInterrupted: cancelGreeting,
        onAudioActivity: state => { greeting.current?.audio(state); if (state.outputActive) workspaceView.current?.narrate(); },
        onNavigate: async (event, signal, onVisible) => {
          cancelGreeting();
          const target = event.target;
          if (target.kind === 'answer') { setAnswer(target.text); appendMessages([{ role: 'assistant', text: target.text }]); await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); const status = await workspaceView.current?.confirm(signal) ?? 'unavailable'; updateContext(getContext(), true); return status; }
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
              const context = workspaceView.current.context();
              const back = (target.kind === 'back' || target.kind === 'collapse' && !target.id) && !context.workspace.focusedId && !context.scene?.modal ? tasks?.back(signal) : undefined;
              const status = await (back ?? workspaceView.current.navigate(target.kind, 'id' in target ? target.id : undefined, 'ids' in target ? target.ids : undefined, signal));
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
    manualInteraction(); endVoice(); inFlight.current = false; setBusy(false); setChatExpanded(false); setMode(next); setError(''); onControlActivate();
  }
  const suggestions = catalog ? [
    ...(media?.assets.length ? [{ label: 'Photos & albums', question: 'Show me your photos.', icon: ArrowUpRight }] : []),
    ...catalog.jobs.slice(0, media?.assets.length ? 2 : 3).map(job => ({ label: job.label, question: job.label, icon: ArrowUpRight })),
  ] : [
    ...(media?.assets.length ? [{ label: 'Photos & albums', question: 'Show me your photos.', icon: ArrowUpRight }] : []),
    ...(content.sections[0] ? [{ label: content.sections[0].title, question: `Show me ${content.sections[0].title}.`, icon: ArrowUpRight }] : []),
    ...(content.sections.length > 1 ? [{ label: 'Compare options', question: `Compare ${content.sections.slice(0, 2).map(section => section.title).join(' and ')}.`, icon: ArrowUpRight }] : []),
    ...(content.hours ? [{ label: 'Hours & contact', question: 'Show me your hours and contact information.', icon: Clock3 }] : [{ label: 'Get in touch', question: 'How can I get in touch?', icon: MessageCircle }]),
  ];
  const voiceLabel = voice.phase === 'connecting' && !liveVoice.updating ? 'Cancel connection' : voiceBusy ? 'End conversation' : demo ? 'Preview voice' : 'Start conversation';
  const status = error || voice.error || liveVoice.message || (!state ? 'Loading assistant…' : !state.enabled ? 'This site’s assistant is currently unavailable.'
    : activeMode === 'chat' && state.chatRemaining === 0 ? 'You can still browse and filter in chat. General answers resume after the daily reset.'
    : voiceExhausted && !voiceBusy && settings.mode !== 'chat' ? 'Voice has reached its daily limit. Continue by typing below.' : '');

  const modeControls = settings.mode !== 'chat' && <motion.div layout="position" className={styles.modes} data-visitor-conversation-controls="true" role="group" aria-label="Conversation mode" {...reveal}>
        {(['voice', 'chat'] as const).map(option => <motion.button type="button" key={option} aria-pressed={activeMode === option} disabled={option === 'voice' && voiceExhausted}
          title={option === 'voice' && voiceExhausted ? 'Daily voice limit reached' : undefined} onClick={() => switchMode(option)} whileTap={reduce ? undefined : { scale: 0.96 }}>
          {activeMode === option && <motion.span layoutId="selected-mode" className={styles.modeSelection} style={{ borderRadius: 30 }} transition={spring}/>}
          <span className={styles.modeLabel}>{option === 'voice' ? <AudioLines size={14}/> : <MessageCircle size={14}/>} {option === 'voice' ? 'Voice' : 'Chat'}</span>
        </motion.button>)}
      </motion.div>;

  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: 0.36, layout: surfaceTransition }}><LayoutGroup id={layoutId}>
    <motion.section ref={assistantRoot} className={styles.assistant} role={layerOpen ? 'dialog' : undefined} aria-modal={layerOpen || undefined} aria-label={layerOpen ? 'Assistant exploration' : 'Site assistant'} data-ai-layer-open={layerOpen}>
      <div className={styles.interaction} data-ai-controls>
      <AnimatePresence initial={false}>
        {activeMode === 'voice' ? <VisitorVoiceStage key="voice" working={liveVoice.working || voice.phase === 'connecting' || liveVoice.active && !liveVoice.inputReady || !!searchActivity} error={Boolean(error || voice.error)} entered={entered} identity={identity} status={status || searchActivity || liveVoice.activity || liveVoice.startupStage || (voice.phase === 'connecting' ? 'Connecting…' : liveVoice.working ? 'Working on your request…' : voice.phase === 'thinking' ? 'Thinking…' : liveVoice.inputReady && voice.phase === 'listening' ? 'Listening' : '')} hint={demo ? 'Preview voice · no microphone or AI calls' : 'Tap the wave whenever you’re ready'}>
          <motion.button ref={waveControl} type="button" className="site-wave" aria-label={voiceLabel} aria-pressed={voiceBusy} disabled={disabled && !voiceBusy}
            onFocus={() => { if (state?.live && !voiceBusy) void tasks?.settle().catch(() => undefined); }}
            onPointerEnter={() => { if (state?.live && !voiceBusy) void tasks?.settle().catch(() => undefined); }}
            onClick={event => { if (voiceBusy && event.currentTarget.matches(':focus-visible')) requestControlFocus(); startVoice(); }}
            onKeyDown={event => { if (event.key === 'Escape' && voiceBusy) { event.preventDefault(); event.stopPropagation(); requestControlFocus(); endVoice(); } }}
            >
            <Waveform phase={voice.phase} inputAnalyser={voice.inputAnalyser} outputAnalyser={voice.outputAnalyser}/>
          </motion.button>
          <span className={styles.srOnly}>{liveVoice.active && !liveVoice.inputReady ? 'Microphone preparing' : voice.phase === 'listening' ? 'Listening · speak naturally · tap to end' : voice.phase === 'speaking' ? 'Speaking · you can interrupt · tap to end' : ''}</span>
        </VisitorVoiceStage> : <ConversationDock key="chat" expanded={chatExpanded} onDismiss={closeLayer} suggestions={
          <div className={styles.suggestions} aria-label="Ideas to explore">
            {suggestions.map(suggestion => <motion.button key={suggestion.label} type="button" disabled={busy || chatDisabled}
              onClick={() => { input.current?.focus({ preventScroll: true }); void sendChat(undefined, suggestion.question.slice(0, 2000)); }}
              whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: .97 }}><suggestion.icon size={13}/><span>{suggestion.label}</span></motion.button>)}
          </div>}>
          {availabilityLoading && <p role="status" className={styles.voiceNote}>Getting the assistant ready…</p>}
          {busy && <div className={styles.voiceNote} data-chat-progress><LoadingIndicator label={chatProgress || 'Working on your request…'}/></div>}
          {busy && provisionalAnswer && <p className={styles.provisional} data-provisional-answer aria-busy="true">{provisionalAnswer}<small>Answer in progress</small></p>}
          <form className={styles.composer} aria-busy={availabilityLoading || busy} onSubmit={event => void sendChat(event)}>
            <textarea ref={input} aria-label="What would you like to see?" placeholder={availabilityLoading ? 'Getting the assistant ready…' : presentation ? 'Go deeper, compare, or explore something else…' : 'Show me what you have in mind…'} rows={1} maxLength={2000} value={text} readOnly={availabilityLoading}
              onFocus={() => { if (restoringFocus.current || composerSubmitted.current) return; onControlActivate(); onContentInvoke(); if (!busy) setChatExpanded(true); }} onPointerDown={() => { composerSubmitted.current = false; onControlActivate(); onContentInvoke(); if (!busy) setChatExpanded(true); }}
              onChange={event => { composerSubmitted.current = false; if (busy) { manualInteraction(); inFlight.current = false; setBusy(false); } setText(event.target.value); if (!busy) setChatExpanded(true); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <motion.button className={styles.send} type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop request' : 'Show me'} title={busy ? 'Stop request' : 'Show me'} disabled={!busy && (!text.trim() || availabilityLoading || chatDisabled)}
              onClick={event => { if (busy) { event.preventDefault(); pending.current?.abort(); } }} whileHover={reduce || !text.trim() && !busy ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.93 }}>
              <AnimatePresence mode="wait" initial={false}><motion.span key={busy ? 'stop' : 'send'} initial={{ opacity: 0, y: reduce ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -5 }} transition={{ duration: reduce ? 0 : 0.24 }}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={18}/>}</motion.span></AnimatePresence>
            </motion.button>
          </form>
        </ConversationDock>}
      </AnimatePresence>
      {modeControls}
      {liveVoice.working && <button type="button" className={styles.cancelWork} onClick={manualInteraction}>Cancel request</button>}
      {layerOpen && <button type="button" className={styles.srOnly} onClick={closeLayer}>Return to website</button>}
      </div>
      <div className={styles.website} data-website-background inert={layerOpen}>{website}</div>
      <AnimatePresence initial={false}>{layerOpen && <motion.div className={styles.backdrop} data-ai-backdrop aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : .3 }}
        onPointerDown={event => { backdropPress.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => { const origin = backdropPress.current; backdropPress.current = null; if (origin && Math.hypot(origin.x - event.clientX, origin.y - event.clientY) < 8) { event.preventDefault(); closeLayer(); } }}/>}</AnimatePresence>
      <motion.div inert={!layerOpen} aria-hidden={!layerOpen} style={{ position: 'relative', zIndex: 42 }} initial={false} animate={layerOpen ? { opacity: 1, visibility: 'visible' } : { opacity: 0, visibility: 'hidden' }} transition={{ duration: reduce ? 0 : .3 }}>
      <VisitorWorkspace onMediaAudible={endVoice} active={layerOpen} onDismiss={closeLayer} answer={answer || error || voice.error || (!websiteTasks?.view ? status : '')} pending={busy || liveVoice.working || !!searchActivity} handleRef={setWorkspaceHandle} content={content} catalog={catalog} media={media} onInteraction={manualInteraction} onContext={searchContextChanged} onInvoke={onContentInvoke} onPhotoView={onPhotoView}/>
      {searchSettings.enabled && <SearchExplore handleRef={searchView} content={content} slug={slug} beforeSearch={target => workspaceView.current?.beforeSearch(target)} onResult={async (result, signal) => workspaceView.current?.showExternal(result, signal)} getExternalContext={() => workspaceView.current?.context().explore} onExternalCommand={command => workspaceView.current?.externalCommand(command) ?? false} onInteraction={() => { manualInteraction(); onContentInvoke(); }} onContext={searchContextChanged} onActivity={setSearchActivity} onPendingAnnotationChange={setPendingAnnotationId}/>}
      </motion.div>
    </motion.section>
  </LayoutGroup></MotionConfig>;
}
