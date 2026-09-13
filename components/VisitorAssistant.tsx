'use client';
import { readVisitorChatEvents, type VisitorChatEvent } from '@/lib/visitor-chat-protocol';
import LoadingIndicator from './LoadingIndicator';
import { visitorDiagnostic, visitorDiagnosticTimer } from '../lib/visitor-diagnostics';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type FormEvent, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
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
import { useVisitorTasks } from './VisitorTasks';
import { captureVisitorContext, navigateVisitorView } from '@/lib/visitor-view-context';
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

export default function VisitorAssistant({ content, slug, entered, initialCatalogPlan, initialSourceIds = [], onControlActivate, onContentInvoke, onContentReset, homeRef, workspaceRef, onDismissMedia, onViewChange, catalog, media, interactionRef, onPhotoView, onCatalogEvent, identity, opening }: {
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
  const tasks = useVisitorTasks();
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
  const entityIds = useMemo(() => new Set(catalog?.entities.map(entity => entity.id) ?? []), [catalog]);
  const sourceIds = useMemo(() => new Set(presentationSources(content, media).map(source => source.id)), [content, media]);
  const catalogState = useRef<CatalogInteractionState | undefined>(catalog ? initialInteraction(catalog) : undefined);
  const [text, setText] = useState('');
  const [chatExpanded, setChatExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingAnnotationId, setPendingAnnotationId] = useState<string | undefined>();
  const [searchActivity, setSearchActivity] = useState('');
  const [, setPreparingView] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
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
  const manualInterrupt = liveVoice.manualInterrupt;
  const updateContext = liveVoice.updateContext;
  const getContext = useCallback((): VisitorContext => captureVisitorContext(siteRoot.current, {
    ...workspaceView.current?.context(),
    ...(tasks?.current() ? { taskSession: tasks.current() } : {}),
    ...(!workspaceView.current && searchView.current?.context() ? { explore: searchView.current.context() } : {}),
    ...(!workspaceView.current && catalogState.current ? { catalogState: catalogState.current } : {}),
    ...(!workspaceView.current && acceptedCatalogPlan.current ? { catalogPlan: acceptedCatalogPlan.current } : {}),
    ...(!workspaceView.current && acceptedPresentation.current ? { presentation: acceptedPresentation.current } : {}),
  }, entityIds, sourceIds), [entityIds, sourceIds, tasks]);
  const manualInteraction = useCallback(() => { cancelGreeting(); pending.current?.abort(); searchView.current?.cancel(); cancelDemo(); manualInterrupt(); tasks?.interrupt(); }, [cancelGreeting, cancelDemo, manualInterrupt, tasks]);
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
  useEffect(() => {
    if (!liveVoice.active || !siteRoot.current) return;
    const root = siteRoot.current;
    const capture = () => updateContext(getContext());
    // Layout, local disclosures, scroll and focus all change what is really visible.
    const mutations = new MutationObserver(capture);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-expanded', 'aria-hidden', 'inert', 'data-source-expanded', 'data-focus-active', 'data-focus-reference-kind', 'data-focus-reference-id', 'data-voice-focus-open', 'data-voice-focus-kind', 'data-voice-focus-id'] });
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
        const response = await fetch(`/api/visitor/${encodeURIComponent(slug)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ kind, requestId: traceId, history, context: getContext(),
            ...(kind === 'chat' ? { text: value } : kind === 'voice' ? { audio: value } : {}) }),
        });
        if (response.ok && response.body && response.headers.get('content-type')?.includes('application/x-ndjson')) {
          let control: Extract<VisitorChatEvent, { type: 'control' }>['control'] | undefined;
          let completed: VisitorReply | undefined, seq = 0;
          await readVisitorChatEvents(response.body, signal, async event => {
            if (event.type === 'control') { control = event.control; return; }
            if (event.type === 'error') throw new Error(event.message);
            if (event.type === 'done') { completed = { text: event.text, availability: event.availability }; return; }
            if (!control || !workspaceView.current) throw new Error('The task controls are unavailable.');
            let status: 'applied' | 'failed' | 'cancelled' = 'failed';
            if (event.target.kind === 'task') status = await tasks?.show(event.target.view, signal) ?? 'failed';
            else if (event.target.kind === 'workspace') status = await workspaceView.current.apply(event.target.batch, signal);
            else if (event.target.kind === 'explore') {
              if (event.target.result) {
                if (!searchView.current) throw new Error('The search view is unavailable.');
                await searchView.current.show(event.target.result, signal); status = 'applied';
              }
              else if (event.target.command) status = searchView.current?.command(event.target.command) ? await workspaceView.current.confirm(signal) : 'failed';
            }
            signal.throwIfAborted();
            const acknowledged = await fetch(`/api/visitor/${encodeURIComponent(slug)}/session/control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
              body: JSON.stringify({ control, update: { seq: ++seq, interactionRevision: 0, viewRevision: 0, ready: true, context: getContext(), navigationAck: { id: event.id, status } } }) });
            if (!acknowledged.ok) throw new Error('The task could not confirm the displayed view.');
          });
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
          if (!result.workspaceBatch && !result.catalogPlan && !result.presentation) setAnswer(result.text);
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
      visitorDiagnostic({ traceId, channel: 'browser', stage: 'backend', status: signal.aborted ? 'cancelled' : 'failed', durationMs: elapsed() });
      throw error;
    } finally { if (kind !== 'greeting') setPreparingView(false); }
  }
  async function annotate(target: AnnotationTarget, name: string) {
    await runSearch(`Additional context about ${name}`, 'web', target);
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
    finally { if (pending.current === controller) { pending.current = null; inFlight.current = false; setBusy(false); } }
  }
  async function home(signal?: AbortSignal, clear = false) {
    if (signal?.aborted) return 'cancelled' as const;
    // A spoken Home must not interrupt its own navigation acknowledgement.
    if (!signal) manualInteraction();
    pending.current?.abort(); pending.current = null; inFlight.current = false; setBusy(false); searchView.current?.reset();
    historyRef.current = []; setAnswer(''); setText(''); setError(''); setSearchActivity(''); setChatExpanded(false);
    setPresentation(initialPresentation); acceptedPresentation.current = initialPresentation;
    setCatalogPlan(initialCatalogPlan ?? undefined); acceptedCatalogPlan.current = initialCatalogPlan ?? undefined;
    catalogState.current = catalog ? initialInteraction(catalog) : undefined;
    // Clearing visible surfaces must work even while task storage is unavailable.
    // Existing manual interruption owns cancellation; hiding never creates a task.
    if (clear) tasks?.hide();
    const taskStatus = clear ? undefined : await tasks?.home(signal);
    onContentReset?.();
    const status = await (clear ? workspaceView.current?.clear(signal) : workspaceView.current?.home(signal)) ?? 'failed';
    updateContext(getContext(), true); return taskStatus && taskStatus !== 'applied' ? taskStatus : status;
  }
  useEffect(() => { if (homeRef) homeRef.current = () => { void home(); }; return () => { if (homeRef) homeRef.current = null; }; });
  async function sendChat(event?: FormEvent, question = text) {
    event?.preventDefault();
    const outgoing = question.trim();
    if (visitorPageIntent(outgoing) === 'home') { await home(); return; }
    if (visitorPageIntent(outgoing) === 'clear') { await home(undefined, true); return; }
    if (visitorPageIntent(outgoing) === 'browse') { manualInteraction(); setText(''); setChatExpanded(false); await workspaceView.current?.browse(); return; }
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
      if (direct.batch) await workspaceView.current.apply(direct.batch); else setError(direct.message);
      return;
    }
    if (question.trim() && /\b(highlight|spotlight|close|dismiss|done with|bigger|smaller|collapse|expand|left|right|second|third)\b|\b(?:open|show|pull up)\b.*\b(?:first|fourth|fifth|sixth)\b|^(?:go )?back\b|^reset\b/i.test(question) && workspaceView.current) {
      manualInteraction(); setChatExpanded(false); setText(''); onControlActivate();
      await workspaceView.current.intent(question); return;
    }
    }
    if (!question.trim() || inFlight.current || disabled || !state?.chatRemaining) return;
    setChatExpanded(false);
    searchView.current?.cancel();
    inFlight.current = true; endVoice(); setBusy(true); setError(''); setText(''); onControlActivate();
    const controller = new AbortController(); pending.current = controller;
    try {
      await requestTurn('chat', outgoing, controller.signal);
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
  async function startVoice() {
    if (voiceBusy) { endVoice(); return; }
    if (disabled || !state?.voiceRemaining) return;
    searchView.current?.cancel(); pending.current?.abort();
    setError(''); onControlActivate();
    // The first invitation may reposition; reconnecting while browsing must
    // preserve the visible subject and spatial references supplied to voice.
    if (!entered) {
      let surface = assistantRoot.current?.parentElement;
      while (surface && !/(auto|scroll)/.test(getComputedStyle(surface).overflowY)) surface = surface.parentElement;
      if (surface) surface.scrollTo({ top: 0, behavior: 'instant' }); else window.scrollTo({ top: 0, behavior: 'instant' });
    }
    if (state.live && slug) {
      try { await tasks?.settle(); } catch (error) { setError(error instanceof Error ? `Could not prepare the website: ${error.message}` : 'The visitor task session could not start. Try again.'); return; }
      demoVoice.cancel();
      const earlierHistory = historyRef.current.slice(-8);
      beginGreeting(!earlierHistory.length);
      const transcripts = new Map<string, { role: 'user' | 'assistant'; text: string; revision: number }>();
      void liveVoice.start({ slug, context: getContext(), history: historyRef.current.slice(-8).map(({ role, text }) => ({ role, text: text.slice(0, 2000) })), getContext, onAvailability: setState,
        onTranscript: event => {
          if (event.role === 'user') cancelGreeting();
          transcripts.set(event.id, event);
          historyRef.current = [...earlierHistory, ...[...transcripts.values()].sort((a, b) => a.revision - b.revision || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)).map(({ role, text }) => ({ role, text }))].slice(-8);
        },
        onGreetingProgress: text => greeting.current?.caption(text),
        onGreetingInterrupted: cancelGreeting,
        onAudioActivity: state => greeting.current?.audio(state),
        onNavigate: async (event, signal) => {
          cancelGreeting();
          const target = event.target;
          if (target.kind === 'task') { const status = await tasks?.show(target.view, signal) ?? 'unavailable'; updateContext(getContext(), true); return status; }
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
          if (['open', 'expand', 'spotlight', 'compare', 'back', 'collapse'].includes(target.kind)) {
            if (workspaceView.current) {
              const context = workspaceView.current.context();
              const back = (target.kind === 'back' || target.kind === 'collapse') && !context.workspace.focusedId && !context.scene?.modal ? tasks?.back(signal) : undefined;
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
    endVoice(); pending.current?.abort(); searchView.current?.cancel(); setChatExpanded(false); setMode(next); setError(''); onControlActivate();
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
    : activeMode === 'chat' && state.chatRemaining === 0 ? 'Chat has reached its daily limit. Please return after the daily reset.'
    : voiceExhausted && !voiceBusy && settings.mode !== 'chat' ? 'Voice has reached its daily limit. Continue by typing below.' : '');

  const modeControls = settings.mode !== 'chat' && <motion.div layout="position" className={styles.modes} data-visitor-conversation-controls="true" role="group" aria-label="Conversation mode" {...reveal}>
        {(['voice', 'chat'] as const).map(option => <motion.button type="button" key={option} aria-pressed={activeMode === option} disabled={option === 'voice' && voiceExhausted}
          title={option === 'voice' && voiceExhausted ? 'Daily voice limit reached' : undefined} onClick={() => switchMode(option)} whileTap={reduce ? undefined : { scale: 0.96 }}>
          {activeMode === option && <motion.span layoutId="selected-mode" className={styles.modeSelection} style={{ borderRadius: 30 }} transition={spring}/>}
          <span className={styles.modeLabel}>{option === 'voice' ? <AudioLines size={14}/> : <MessageCircle size={14}/>} {option === 'voice' ? 'Voice' : 'Chat'}</span>
        </motion.button>)}
      </motion.div>;

  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, duration: 0.36, layout: surfaceTransition }}><LayoutGroup id={layoutId}>
    <motion.section ref={assistantRoot} className={styles.assistant} aria-label="Site assistant">
      <AnimatePresence initial={false}>
        {activeMode === 'voice' ? <VisitorVoiceStage key="voice" error={Boolean(error || voice.error)} entered={entered} identity={identity} status={status || searchActivity || liveVoice.activity || (voice.phase === 'connecting' ? 'Connecting…' : voice.phase === 'thinking' ? 'Thinking…' : '')} hint={demo ? 'Preview voice · no microphone or AI calls' : 'Tap the wave whenever you’re ready'}>
          <motion.button ref={waveControl} type="button" className="site-wave" aria-label={voiceLabel} aria-pressed={voiceBusy} disabled={disabled && !voiceBusy}
            onClick={event => { if (voiceBusy && event.currentTarget.matches(':focus-visible')) requestControlFocus(); startVoice(); }}
            onKeyDown={event => { if (event.key === 'Escape' && voiceBusy) { event.preventDefault(); event.stopPropagation(); requestControlFocus(); endVoice(); } }}
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
          {availabilityLoading && <p role="status" className={styles.voiceNote}>Getting the assistant ready…</p>}
          <form className={styles.composer} aria-busy={availabilityLoading || busy} onSubmit={event => void sendChat(event)}>
            <textarea ref={input} aria-label="What would you like to see?" placeholder={availabilityLoading ? 'Getting the assistant ready…' : presentation ? 'Go deeper, compare, or explore something else…' : 'Show me what you have in mind…'} rows={1} maxLength={2000} value={text} readOnly={busy || availabilityLoading}
              onFocus={() => { onControlActivate(); if (!busy) setChatExpanded(!workspaceView.current?.context().workspace.focusedId); }} onPointerDown={() => { onControlActivate(); if (!busy) setChatExpanded(!workspaceView.current?.context().workspace.focusedId); }}
              onChange={event => { setText(event.target.value); if (!busy) setChatExpanded(!workspaceView.current?.context().workspace.focusedId); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}/>
            <motion.button className={styles.send} type={busy ? 'button' : 'submit'} aria-label={busy ? 'Stop request' : 'Show me'} title={busy ? 'Stop request' : 'Show me'} disabled={!busy && (!text.trim() || availabilityLoading || disabled || !state?.chatRemaining)}
              onClick={event => { if (busy) { event.preventDefault(); pending.current?.abort(); } }} whileHover={reduce || !text.trim() && !busy ? undefined : { scale: 1.04 }} whileTap={reduce ? undefined : { scale: 0.93 }}>
              <AnimatePresence mode="wait" initial={false}><motion.span key={busy ? 'stop' : 'send'} initial={{ opacity: 0, y: reduce ? 0 : 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -5 }} transition={{ duration: reduce ? 0 : 0.24 }}>{busy ? <Square size={14} fill="currentColor"/> : <ArrowUp size={18}/>}</motion.span></AnimatePresence>
            </motion.button>
          </form>
        </ConversationDock>}
      </AnimatePresence>
      {modeControls}
      {(busy || searchActivity || liveVoice.activity || voice.phase === 'connecting' || voice.phase === 'thinking') && <LoadingIndicator floating label={searchActivity || liveVoice.activity || (voice.phase === 'connecting' ? 'Connecting voice…' : 'Preparing your response…')}/>}
      <AnimatePresence initial={false}>{answer && activeMode === 'chat' && <motion.aside className={styles.answer} aria-label="Assistant answer" key={answer} initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : .25 }}><p role="status">{answer}</p><button type="button" onClick={() => { setAnswer(''); input.current?.focus({ preventScroll: true }); }}>Dismiss answer</button></motion.aside>}</AnimatePresence>
      <AnimatePresence initial={false}>{status && activeMode !== 'voice' && <motion.p key={status} className={styles.status} role={error || voice.error ? 'alert' : 'status'} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduce ? 0 : 0.4 }}>{status}</motion.p>}</AnimatePresence>
      {activeMode === 'voice' && !voiceBusy && !!(voice.error || liveVoice.message || error) && !!state?.chatRemaining && state.enabled && <button type="button" className={styles.fallback} onClick={() => { requestControlFocus(false, 'chat'); switchMode('chat'); }}>Continue by typing</button>}
      <motion.div className={styles.results} initial={false} animate={{ opacity: entered || activeMode === 'chat' ? 1 : .55 }} transition={{ duration: reduce ? 0 : .8 }}>
      {opening}
      <VisitorWorkspace onDismissMedia={onDismissMedia} handleRef={setWorkspaceHandle} content={content} catalog={catalog} media={media} onInteraction={manualInteraction} onContext={searchContextChanged} onInvoke={onContentInvoke} onPhotoView={onPhotoView} onAnnotate={annotate} pendingAnnotationId={pendingAnnotationId} onHome={() => { void home(); }} onReset={() => searchView.current?.reset()}/>
      {searchSettings.enabled && <SearchExplore handleRef={searchView} content={content} slug={slug} beforeSearch={target => workspaceView.current?.beforeSearch(target)} onResult={async (result, signal) => workspaceView.current?.showExternal(result, signal)} getExternalContext={() => workspaceView.current?.context().explore} onExternalCommand={command => workspaceView.current?.externalCommand(command) ?? false} onInteraction={() => { manualInteraction(); onContentInvoke(); }} onContext={searchContextChanged} onActivity={setSearchActivity} onPendingAnnotationChange={setPendingAnnotationId}/>}
      </motion.div>
    </motion.section>
    {liveVoice.active && typeof document !== 'undefined' && createPortal(<button type="button" className={styles.endVoice} aria-label="End voice conversation" style={{ borderColor: content.accent }}
      onClick={event => {
        if (event.currentTarget.matches(':focus-visible')) requestControlFocus();
        endVoice();
      }} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestControlFocus(); endVoice(); }
      }}><Square size={13} fill="currentColor" aria-hidden="true"/><span>End voice</span></button>, document.body)}
  </LayoutGroup></MotionConfig>;
}
