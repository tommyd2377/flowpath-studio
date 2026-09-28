'use client';
import type { GreetingRecordTopic } from '@/lib/greeting-records';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MediaImage, MediaVideo, InformationRegion, InformationFrame, InformationGrid, InformationGridItem, PublishedChart, type PlaybackState, type ExternalSearchResult, ExternalSearchResults, PresentationView } from '@thevoice/platform-ui';
import { initialInteraction } from '@thevoice/platform-ui/interaction';
import { projectKnowledgeCatalog, retrieveKnowledge } from '@thevoice/platform-ui/knowledge';
import { formatAttribute } from '@thevoice/platform-ui/catalog';
import { websiteValueRole } from '@thevoice/platform-ui/site-design';
import { applyWorkspaceBatch, validateWorkspace, emptyWorkspace, referenceKey, workspaceRecord, type WorkspaceBatch, type WorkspaceObject, type WorkspaceRecord, type WorkspaceScene, type WorkspaceState } from '@thevoice/platform-ui/workspace';
import { carouselCommand, type CarouselCard, type CarouselContext } from '@thevoice/platform-ui/carousel';
import { informationLayout, type InformationSurfaceContext, type SurfaceRegion } from '@thevoice/platform-ui/surface';
import { SurfaceHistory, surfaceSnapshotSchema, surfaceFingerprint, type SurfaceSnapshot } from '@/lib/visitor-surface-history';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import type { KnowledgeCatalog, PresentationPlan } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { objectInput, openingWorkspace, planWorkspaceIntent, publishedWorkspace, workspaceBatch, workspaceFact, workspaceFromPlan, workspaceFromSources, workspaceLocation } from '@/lib/visitor-workspace';
import { annotationTargetForObject, exploreContextForResult, exploreResultSchema, type AnnotationTarget, type ExploreCommand, type ExploreContext } from '@/lib/explore-model';
import { visitorRecordSummary } from '@/lib/visitor-record-summary';
import { knowledgeValueText } from '@/lib/knowledge-display';
import { greetingVisuals, type GreetingVisual } from '@/lib/greeting-presentation';
import { workspaceElementVisible } from '@/lib/workspace-screen';
import type { SiteContent } from '@/lib/site-model';
import type { SitePresentation } from '@/lib/site-presentation';
import { useVisitorTasks, useWebsiteTasks } from './VisitorTasks';
import AssistantAnswer from './AssistantAnswer';
import styles from './VisitorCarousel.module.css';

type Status = 'applied' | 'failed' | 'cancelled';
export type VisitorWorkspaceHandle = {
  context: () => { workspace: WorkspaceState; scene?: WorkspaceScene; carousel: CarouselContext; surface: InformationSurfaceContext; externalResults?: ExploreContext[]; explore?: ExploreContext };
  prepare: (signal?: AbortSignal) => Promise<Status>;
  begin: (requestId: string, prepareTask?: boolean, refreshTask?: boolean) => Promise<Status>;
  finish: (requestId: string) => void;
  cancel: () => Promise<Status>;
  answer: (text: string, signal?: AbortSignal, relationship?: 'related' | 'new-subject', placement?: 'supporting') => Promise<Status>;
  apply: (batch: WorkspaceBatch, signal?: AbortSignal) => Promise<Status>;
  intent: (text: string, signal?: AbortSignal) => Promise<boolean>;
  command: (text: string, signal?: AbortSignal) => Promise<boolean>;
  plan: (plan: PresentationPlan | SitePresentation, signal?: AbortSignal) => Promise<Status>;
  navigate: (kind: string, id?: string, ids?: string[], signal?: AbortSignal) => Promise<Status>;
  greeting: (index: number | null, signal: AbortSignal) => Promise<Status>;
  showExternal: (result: unknown, signal?: AbortSignal) => Promise<Status>;
  confirm: (signal?: AbortSignal) => Promise<Status>;
  externalCommand: (command: ExploreCommand) => boolean;
  annotationTarget: (text: string) => AnnotationTarget | undefined;
  browse: (signal?: AbortSignal) => Promise<Status>;
  home: (signal?: AbortSignal) => Promise<Status>;
  clear: (signal?: AbortSignal) => Promise<Status>;
  restoreWebsite: (signal?: AbortSignal) => Promise<Status>;
  releaseFocus: (signal?: AbortSignal) => Promise<Status>;
  beforeSearch: (target?: AnnotationTarget) => void;
  reset: () => void;
  narrate: () => void;
};
type Card = Omit<CarouselCard, 'kind'> & { kind: SurfaceRegion['kind']; object?: WorkspaceObject; objectIds?: string[]; itemCount?: number; record?: WorkspaceRecord; content?: ReactNode; recordId?: string; videoId?: string; selectionKey?: string; placeholderOnly?: boolean };
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function snapshotTitle(value: SurfaceSnapshot, authority: ReturnType<typeof publishedWorkspace>) { return (value.task?.detail?.record.name ?? value.task?.research?.query ?? value.workspace.objects.flatMap(object => object.references.map(ref => workspaceRecord(authority, ref)?.name)).filter(Boolean).join(' · ').slice(0, 120)) || value.answer.split(/\n/)[0].replace(/^#+\s*/, '').slice(0, 90) || 'Earlier information'; }

/** One persistent composition; only validated data/references enter per-visit history. */
export default function VisitorWorkspace({ content, catalog, media, greetingRecords, handleRef, onInteraction, onContext, onInvoke, onPhotoView, active = true, pending = false, notice = '', onDismiss, onMediaAudible, tenantId = 'preview', onRestore, hideEmpty = false, onContentChange }: {
  content: SiteContent; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null; greetingRecords?: GreetingRecordTopic[]; handleRef?: Ref<VisitorWorkspaceHandle>;
  onInteraction: () => void; onContext?: () => void; onInvoke?: () => void; onPhotoView?: (id: string) => void;
  onMediaAudible?: () => void; onRestore?: () => void; tenantId?: string;
  hideEmpty?: boolean; onContentChange?: (hasInformation: boolean) => void;
  active?: boolean; notice?: string; pending?: boolean; onDismiss?: (preserveConversation?: boolean) => void;
}) {
  const tasks = useVisitorTasks(), taskSurface = useWebsiteTasks();
  const initialId = useId();
  const baseAuthority = useMemo(() => publishedWorkspace(content, catalog, media), [content, catalog, media]);
  const greetingTopics = useMemo(() => greetingVisuals(content, baseAuthority, catalog, greetingRecords), [content, baseAuthority, catalog, greetingRecords]);
  const [surface, setSurface] = useState<SurfaceSnapshot>(() => ({ id: `surface:${initialId}`, requestId: null, tenantId, publicationId: baseAuthority.publicationId,
    workspace: openingWorkspace(baseAuthority, content), task: null, taskBookmark: null, external: [], selections: {}, answer: '', primaryId: null, expanded: false, scrollTop: 0 }));
  const current = useRef(surface);
  useLayoutEffect(() => { current.current = surface; }, [surface]);
  const history = useRef(new SurfaceHistory());
  const [historyView, setHistoryView] = useState<{ depth: number; destination?: SurfaceSnapshot; forward?: SurfaceSnapshot; pendingId: string | null }>({ depth: 0, pendingId: null });
  function publishHistory() { setHistoryView({ depth: history.current.past.length, destination: history.current.destination(), forward: history.current.forwardDestination(), pendingId: history.current.pending?.id ?? null }); }
  const [error, setError] = useState('');
  const state = surface.workspace, view = surface.task, external = surface.external, externalSelection = surface.selections, answer = surface.answer;
  const authority = useMemo(() => publishedWorkspace(content, catalog, media, external.map(result => exploreContextForResult(result, result.kind, null))), [content, catalog, media, external]);
  const authorityRef = useRef(authority);
  useLayoutEffect(() => { authorityRef.current = authority; }, [authority]);
  const displayCatalog = useMemo(() => catalog ? projectKnowledgeCatalog(catalog) : null, [catalog]);
  const root = useRef<HTMLElement>(null), reading = useRef<HTMLDivElement>(null), cardRoot = useRef<HTMLElement>(null);
  const activeRef = useRef(active);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  const version = useRef(0), revision = useRef(0), lastNarrated = useRef<string | null>(null);
  const playback = useRef<Record<string, PlaybackState>>({});
  const galleryGesture = useRef<{ id: string; x: number; y: number } | null>(null);
  const [initialPlayback, setInitialPlayback] = useState<Record<string, PlaybackState>>({});
  const sceneClock = useRef({ key: '', revision: 0 });
  const callback = useRef(onContext);
  useLayoutEffect(() => { callback.current = onContext; }, [onContext]);
  const restoring = useRef(false);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const cardsRef = useRef<Card[]>([]), regionsRef = useRef<(Card & { role: SurfaceRegion['role'] })[]>([]);
  const restoreWork = useRef<Promise<Status> | null>(null);
  const [restorationPending, setRestorationPending] = useState(false);
  function capture() { callback.current?.(); recordBrowserTestEvent('surface.observed', { stateId: current.current.id, requestId: current.current.requestId, revision: revision.current, pending: history.current.pending?.id, regions: regionsRef.current.map(region => ({ id: region.id, role: region.role })) }); }
  function snapshot(): SurfaceSnapshot { return { ...current.current, scrollTop: Math.round(reading.current?.scrollTop ?? 0), taskBookmark: current.current.taskBookmark ?? tasks?.snapshot()?.operationId ?? (tasks?.current() ? 'initial' : null) }; }
  async function begin(requestId: string, prepareTask = true, refreshTask = true): Promise<Status> {
    if (restoreWork.current) await restoreWork.current;
    if (history.current.pending?.id === requestId) return 'applied';
    if (history.current.pending) { const status = await restore(history.current.pending.before); if (status !== 'applied') return status; }
    if (prepareTask) { const status = await prepare(undefined, refreshTask); if (status !== 'applied') return status; }
    history.current.begin(requestId, snapshot()); publishHistory();
    recordBrowserTestEvent('surface.request.started', { stateId: current.current.id, requestId });
    return 'applied';
  }
  // Home resets the live query but retains this composition. Rebind it before
  // a new request or a manual action, never while applying a backend response.
  async function prepare(signal?: AbortSignal, refresh = true): Promise<Status> {
    if (restoreWork.current) { const status = await restoreWork.current; if (status !== 'applied') return status; }
    if (signal?.aborted) return 'cancelled';
    if (!tasks?.current()) return 'applied';
    let synchronized = true;
    try { await tasks.settle(refresh); } catch { synchronized = false; }
    const saved = snapshot(), actual = tasks.snapshot();
    if (synchronized && (!saved.task || actual?.active && surfaceFingerprint({ ...saved, task: actual }) === surfaceFingerprint(saved))) return 'applied';
    setRestorationPending(true); restoring.current = true;
    const expected = ++version.current;
    const operation = (async (): Promise<Status> => {
      try {
        // A gallery can hide the task view after the backend advances its
        // generation. Rebind the retained query without reopening that view.
        const status = await tasks.restore(saved.taskBookmark ?? saved.task?.operationId ?? 'initial', !!saved.task, signal);
        if (status !== 'applied') { setError('That saved result has expired or changed. Your current information remains available.'); return status; }
        if (signal?.aborted || version.current !== expected) return 'cancelled';
        const next = { ...saved, task: saved.task ? tasks.snapshot() ?? saved.task : null };
        current.current = next; setSurface(next); revision.current++; setError('');
        await frame(); capture(); return 'applied';
      } finally { restoring.current = false; }
    })();
    restoreWork.current = operation;
    try { return await operation; } finally { restoreWork.current = null; setRestorationPending(false); }
  }
  function finish(requestId: string) {
    // Back can abort an operation while its finally block is still unwinding.
    // The restoration owns this transaction; never commit its cancelled view.
    if (restoring.current) return;
    const changed = history.current.commit(requestId, snapshot());
    if (changed) recordBrowserTestEvent('surface.request.committed', { stateId: current.current.id, requestId, depth: history.current.past.length });
    publishHistory(); capture();
  }
  function change(patch: Partial<SurfaceSnapshot>, meaningful = true) {
    const before = snapshot(), transaction = history.current.pending;
    if (patch.selections) patch = { ...patch, selections: Object.fromEntries(Object.entries(patch.selections).slice(-64)) };
    const next = { ...before, ...patch, id: transaction ? current.current.requestId === transaction.id ? current.current.id : crypto.randomUUID() : meaningful ? crypto.randomUUID() : current.current.id, requestId: transaction?.id ?? null };
    if (surfaceFingerprint(before) === surfaceFingerprint(next)) return;
    if (!transaction && meaningful) { const id = crypto.randomUUID(); history.current.begin(id, before); history.current.commit(id, next); }
    setDirection('forward'); version.current++; revision.current++;
    current.current = next; setSurface(next); setInitialPlayback({ ...playback.current }); setError(''); publishHistory();
  }
  async function restore(destination: SurfaceSnapshot, signal?: AbortSignal, travel: 'back' | 'forward' = 'back'): Promise<Status> {
    if (restoreWork.current) return restoreWork.current;
    setRestorationPending(true);
    const operation = performRestore(destination, signal, travel); restoreWork.current = operation;
    try { return await operation; } finally {
      restoreWork.current = null; setRestorationPending(false); await frame();
      if (document.activeElement === document.body || root.current?.contains(document.activeElement)) (root.current?.querySelector<HTMLElement>('[data-surface-back]') ?? cardRoot.current)?.focus({ preventScroll: true });
    }
  }
  async function performRestore(destination: SurfaceSnapshot, signal: AbortSignal | undefined, travel: 'back' | 'forward'): Promise<Status> {
    if (signal?.aborted) return 'cancelled';
    try {
      surfaceSnapshotSchema.parse(destination);
      if (destination.tenantId !== tenantId || destination.publicationId !== baseAuthority.publicationId) throw new Error('This saved information belongs to an older publication. Reload to continue.');
      const restoredAuthority = publishedWorkspace(content, catalog, media, destination.external.map(result => exploreContextForResult(result, result.kind, null)));
      validateWorkspace(destination.workspace, restoredAuthority);
      const departing = snapshot();
      restoring.current = true; version.current++;
      if (tasks?.current()) {
        const status = await tasks.restore(destination.taskBookmark ?? 'initial', !!destination.task, signal);
        if (status !== 'applied') { setError('That saved result has expired or changed. Your current information remains available.'); return status; }
      }
      if (signal?.aborted) return 'cancelled';
      if (travel === 'back') history.current.acceptBack(departing); else history.current.acceptForward(departing);
      setDirection(travel);
      const next = { ...destination, task: destination.task ? tasks?.snapshot() ?? destination.task : null,
        workspace: { ...destination.workspace, revision: current.current.workspace.revision + 1, receipts: [] } };
      current.current = next; authorityRef.current = restoredAuthority; setSurface(next); setInitialPlayback({ ...playback.current }); setError(''); revision.current++; publishHistory(); onRestore?.();
      await frame(); if (reading.current) reading.current.scrollTop = destination.scrollTop;
      const status = await confirm(signal);
      recordBrowserTestEvent('surface.restored', { stateId: next.id, requestId: next.requestId, status, direction: travel, depth: history.current.past.length, forwardDepth: history.current.future.length }); return status;
    } catch (error) { setError(error instanceof Error ? error.message : 'This saved information is no longer available.'); return 'failed'; }
    finally { restoring.current = false; }
  }
  async function back(signal?: AbortSignal): Promise<Status> {
    if (restoreWork.current) await restoreWork.current;
    if (signal?.aborted) return 'cancelled';
    const destination = history.current.destination(); return destination ? restore(destination, signal) : 'failed';
  }
  const execute = async (id: string, input: unknown, manual = true, signal?: AbortSignal) => {
    if (manual) onInteraction();
    const own = !history.current.pending, requestId = crypto.randomUUID();
    if (own ? await begin(requestId, manual) !== 'applied' : manual && await prepare(signal) !== 'applied') return;
    try { return await taskSurface?.execute(id, input, false, signal); } finally { if (own) { await frame(); finish(requestId); } }
  };
  async function confirm(signal?: AbortSignal, requiredIds: string[] = []): Promise<Status> {
    const expected = version.current, start = performance.now(); let stable = 0, previous = '';
    while (performance.now() - start < 1800) {
      await frame(); if (signal?.aborted || expected !== version.current || !activeRef.current) return 'cancelled';
      const rect = cardRoot.current?.getBoundingClientRect();
      const measured = rect ? [rect.x, rect.y, rect.width, rect.height].map(value => Math.round(value * 2)).join(':') : '';
      stable = measured && measured === previous ? stable + 1 : 0; previous = measured;
      if (stable >= 3 && root.current?.dataset.workspaceTransition === 'settled') {
        const regions = regionsRef.current;
        const targets = requiredIds.length ? requiredIds.map(id => regions.find(region => region.object?.instanceId === id || region.objectIds?.includes(id))) : [regions.find(region => region.role === 'primary')];
        const visible = targets.every(region => {
          if (!region) return false;
          const node = [...root.current!.querySelectorAll<HTMLElement>('[data-surface-region]')].find(node => node.dataset.surfaceRegion === region.id);
          if (!node || !workspaceElementVisible(node)) return false;
          const items = [...node.querySelectorAll<HTMLElement>('[data-grid-presence="present"]')];
          if (items.length && !items.some(workspaceElementVisible)) return false;
          const allImages = [...node.querySelectorAll<HTMLImageElement>('img')];
          const images = allImages.filter(workspaceElementVisible);
          const expectsPhoto = region.kind === 'photo' || region.object?.component === 'gallery';
          return (!expectsPhoto || images.length > 0) && (!['photo', 'collection'].includes(region.kind) || images.every(image => image.complete && image.naturalWidth > 0));
        });
        if (visible) { capture(); recordBrowserTestEvent('surface.confirmed', { stateId: current.current.id, requestId: current.current.requestId, revision: revision.current, requiredIds }); return 'applied'; }
      }
    }
    return 'failed';
  }
  async function apply(batch: WorkspaceBatch, signal?: AbortSignal): Promise<Status> {
    if (signal?.aborted) return 'cancelled';
    try {
      const accepted = applyWorkspaceBatch(current.current.workspace, batch, authorityRef.current, context().scene!.revision).state;
      const replaces = batch.operations.some(operation => operation.kind === 'replace' || operation.kind === 'reset');
      const requestedIds = batch.operations.flatMap(operation => operation.kind === 'add' ? [operation.object.instanceId] : operation.kind === 'replace' || operation.kind === 'reset' ? operation.objects.map(object => object.instanceId) : []);
      const explicitFocus = batch.operations.findLast(operation => operation.kind === 'focus');
      const last = accepted.objects.find(object => object.instanceId === (explicitFocus?.kind === 'focus' ? explicitFocus.instanceId : requestedIds.at(-1))) ?? accepted.objects.find(object => object.instanceId === accepted.focusedId) ?? accepted.objects.at(-1);
      const newGallery = last?.component === 'gallery' && requestedIds.includes(last.instanceId);
      const primaryId = last?.component === 'comparison' || last?.component === 'chart' || last?.component === 'map' || last?.component === 'gallery' || last?.component === 'collection' ? last.instanceId : last?.references[0]?.id.startsWith('video:') ? last.references[0].id : last?.references[0] ? referenceKey(last.references[0]) : null;
      // Retain no more than three semantic regions; removed support remains in history.
      const keep = [...accepted.objects.filter(object => object !== last && (!newGallery || object.component !== 'gallery' || requestedIds.includes(object.instanceId))).slice(-2), ...(last ? [last] : [])];
      accepted.objects = keep; accepted.focusHistory = accepted.focusHistory.filter(id => keep.some(object => object.instanceId === id));
      accepted.focusedId = last?.instanceId ?? null;
      if (replaces) tasks?.hide();
      change({ workspace: accepted, primaryId, answer: '', ...(replaces ? { task: null, selections: {} } : {}), scrollTop: 0 }); onInvoke?.();
      return await confirm(signal, requestedIds.length ? requestedIds : explicitFocus?.kind === 'focus' ? [explicitFocus.instanceId] : []);
    } catch (error) { setError(error instanceof Error ? error.message : 'This information could not be prepared.'); return 'failed'; }
  }
  function moveLocal(delta: number, instanceId?: string) {
    const object = current.current.workspace.objects.find(object => object.instanceId === instanceId) ?? current.current.workspace.objects.find(object => ['gallery', 'collection'].includes(object.component));
    if (!object) return false;
    const refs = object.references.flatMap(ref => workspaceRecord(authorityRef.current, ref)?.members ?? [ref]);
    const index = Math.max(0, refs.findIndex(ref => referenceKey(ref) === current.current.selections[object.instanceId])), target = refs[index + delta];
    if (!target) return false;
    change({ selections: { ...current.current.selections, [object.instanceId]: referenceKey(target) }, primaryId: object.instanceId });
    if (target.kind === 'photo') onPhotoView?.(target.id); return true;
  }
  async function navigate(kind: string, id?: string, itemIds?: string[], signal?: AbortSignal): Promise<Status> {
    if (signal?.aborted) return 'cancelled';
    if (kind === 'back') return back(signal);
    if (kind === 'forward') {
      if (restoreWork.current) await restoreWork.current;
      if (signal?.aborted) return 'cancelled';
      const next = history.current.forwardDestination(); return next ? restore(next, signal, 'forward') : 'failed';
    }
    if (kind === 'next' || kind === 'previous') return moveLocal(kind === 'next' ? 1 : -1) ? confirm(signal) : 'failed';
    if (kind === 'expand' || kind === 'collapse') { change({ expanded: kind === 'expand' }); return confirm(signal); }
    if (kind === 'home' || kind === 'unfocus' || kind === 'dismiss') { onDismiss?.(!!signal); return 'applied'; }
    if (kind === 'start_over' || kind === 'clear') {
      tasks?.hide(); change({ workspace: emptyWorkspace(authorityRef.current.publicationId), task: null, external: [], selections: {}, answer: '', primaryId: null, scrollTop: 0 });
      if (kind === 'start_over') { onDismiss?.(!!signal); return 'applied'; }
      return confirm(signal);
    }
    if (kind === 'browse') return taskSurface?.available ? await execute('view.reset', {}, false, signal) ? 'applied' : 'failed' : navigate('home', undefined, undefined, signal);
    if (['top', 'bottom', 'up', 'down', 'next_section', 'previous_section'].includes(kind)) { const element = reading.current; element?.scrollTo({ top: kind === 'top' ? 0 : kind === 'bottom' ? element.scrollHeight : element.scrollTop + (['up', 'previous_section'].includes(kind) ? -1 : 1) * element.clientHeight * .8, behavior: 'instant' }); return confirm(signal); }
    const target = cardsRef.current.find(card => card.id === id || card.referenceIds.includes(id ?? '') || card.object?.instanceId === id || card.record?.reference.id === id);
    if (kind === 'close') {
      if (target?.object) return apply(workspaceBatch(current.current.workspace, [{ kind: 'close', instanceId: target.object.instanceId }]), signal);
      if (id === 'answer' || !id && current.current.primaryId === 'answer') { change({ answer: '', primaryId: null }); return confirm(signal); }
      if (!id) { onDismiss?.(!!signal); return 'applied'; } return 'failed';
    }
    if (target) { change({ primaryId: target.id }); onInvoke?.(); return confirm(signal); }
    const record = authorityRef.current.records.find(record => referenceKey(record.reference) === id || record.reference.id === id || `${record.reference.kind}:${record.reference.id}` === id);
    if (record) return apply(workspaceBatch(current.current.workspace, [{ kind: 'replace', objects: [objectInput(record)] }]), signal);
    if (kind === 'compare' && itemIds && catalog) return apply(workspaceBatch(current.current.workspace, [{ kind: 'replace', objects: [{ instanceId: 'comparison', component: 'comparison', references: itemIds.map(id => ({ kind: 'entity', id, revisionId: catalog.id })) }] }]), signal);
    return 'failed';
  }
  async function command(text: string, signal?: AbortSignal) {
    const command = carouselCommand(text); if (!command) return false;
    if (command.action === 'open') { if (view) { await tasks?.openOrdinal(command.ordinal ?? 1); return true; } return false; }
    const status = await navigate(command.action, undefined, undefined, signal);
    if (status === 'failed') setError(command.action === 'back' ? 'There is no earlier information to return to.' : command.action === 'forward' ? 'There is no later information to return to.' : 'That local navigation is not available here.'); return true;
  }
  function externalCommand(command: ExploreCommand, resultId?: string) {
    const taskResearch = current.current.task?.research;
    const result = (taskResearch && (!resultId || resultId === taskResearch.id) && regionsRef.current.some(region => region.selectionKey === taskResearch.id) ? taskResearch : undefined) ?? current.current.external.find(result => result.id === resultId) ?? current.current.external.find(result => cardsRef.current.find(card => card.id === current.current.primaryId)?.record?.reference.id === result.id) ?? current.current.external.find(result => regionsRef.current.some(region => region.record?.reference.kind === 'external' && region.record.reference.id === result.id)); if (!result) return false;
    if (command.kind === 'back') { void back(); return true; }
    if (command.kind === 'open_source' || command.kind === 'open_image') {
      const valid = command.kind === 'open_image' ? result.images.some(image => image.id === command.id) : result.sources.some((_, index) => command.id === `source-${index + 1}`);
      if (!valid) return false; change({ selections: { ...current.current.selections, [result.id]: command.id } });
    } else if (command.kind === 'images' || command.kind === 'web') change({ selections: { ...current.current.selections, [result.id]: null, [`kind:${result.id}`]: command.kind } });
    else if ((command.kind === 'zoom_in' || command.kind === 'zoom_out') && result.map) change({ selections: { ...current.current.selections, [`zoom:${result.id}`]: String(Math.max(2, Math.min(12, Number(current.current.selections[`zoom:${result.id}`] ?? result.map.zoom) + (command.kind === 'zoom_in' ? 1 : -1)))) } });
    else return false;
    void frame().then(capture); return true;
  }
  function context() {
    const value = current.current, element = reading.current;
    const block = element && [...element.querySelectorAll<HTMLElement>('[data-reading-block]')].find(block => block.getBoundingClientRect().bottom >= element.getBoundingClientRect().top + 10)?.dataset.readingBlock;
    const readingState = { scrollTop: Math.round(element?.scrollTop ?? 0), blockId: block ?? null };
    const viewport = element?.getBoundingClientRect();
    const regionNode = (id: string) => [...root.current?.querySelectorAll<HTMLElement>('[data-surface-region]') ?? []].find(node => node.dataset.surfaceRegion === id);
    const regionVisible = (id: string) => { const node = regionNode(id); return !!(activeRef.current && node && workspaceElementVisible(node)); };
    const presented = regionsRef.current.map(({ id, kind, title, referenceIds, role, object, selectionKey, itemCount }) => {
      const result = selectionKey && (value.external.find(result => result.id === selectionKey) ?? (value.task?.research?.id === selectionKey ? value.task.research : null));
      const map = result && result.map || (kind === 'map' ? value.task?.map : null);
      const node = regionNode(id), items = [...node?.querySelectorAll<HTMLElement>('[data-task-record]') ?? []];
      const visibleReferenceIds = !regionVisible(id) ? [] : items.length ? [...new Set(items.filter(workspaceElementVisible).map(item => item.dataset.taskRecord!))].slice(0, 48) : referenceIds.slice(0, 1);
      return { id, kind, title: title.slice(0, 200), referenceIds, role, visible: regionVisible(id), selectedId: value.selections[selectionKey ?? object?.instanceId ?? id] ?? null,
        visibleReferenceIds, itemCount: itemCount ?? (items.length || referenceIds.length),
        ...(map ? { mapView: { latitude: map.latitude, longitude: map.longitude, zoom: Number(value.selections[`zoom:${selectionKey}`] ?? map.zoom) } } : {}) };
    });
    const primary = presented.find(region => region.role === 'primary');
    const subject = primary?.referenceIds.length ? primary.referenceIds : presented.flatMap(region => region.referenceIds).slice(0, 48);
    const sceneKey = JSON.stringify({ objects: value.workspace.objects, primary: primary?.id, task: value.task?.operationId, selections: value.selections });
    if (sceneClock.current.key !== sceneKey) sceneClock.current = { key: sceneKey, revision: sceneClock.current.revision + 1 };
    const scene: WorkspaceScene = { revision: sceneClock.current.revision, workspaceRevision: value.workspace.revision, visibility: activeRef.current && document.visibilityState === 'visible' ? 'visible' : 'hidden', page: 'workspace', focusedId: value.workspace.focusedId, objects: value.workspace.objects.map((object, index) => {
      const region = regionsRef.current.find(region => region.object?.instanceId === object.instanceId || region.objectIds?.includes(object.instanceId));
      const box = region && regionNode(region.id)?.getBoundingClientRect();
      const full = box && viewport && box.top >= Math.max(0, viewport.top) && box.bottom <= Math.min(innerHeight, viewport.bottom) && box.left >= Math.max(0, viewport.left) && box.right <= Math.min(innerWidth, viewport.right);
      return { instanceId: object.instanceId, order: index + 1, name: object.references.map(ref => workspaceRecord(authorityRef.current, ref)?.name).join(' / ').slice(0, 160), references: object.references, open: true, mounted: !!region && activeRef.current, visibility: !activeRef.current ? 'hidden' : region && regionVisible(region.id) ? full ? 'full' : 'partial' : region ? 'offscreen' : 'unmounted', position: window.matchMedia('(max-width: 800px)').matches || informationLayout(presented) !== 'split' ? 'center' : region?.role === 'supporting' ? 'left' : 'right', rect: box ? { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.min(100000, Math.round(box.height)) } : null, selected: object.selected, expanded: object.expanded, controls: ['expand', 'collapse', 'return', 'scroll'], scroll: null };
    }) };
    const previous = [...history.current.past, ...(history.current.pending ? [history.current.pending.before] : [])].slice(-8).reverse().map(item => ({ stateId: item.id, title: snapshotTitle(item, authorityRef.current), subject: item.workspace.objects.flatMap(object => object.references.map(referenceKey)).slice(0, 12) }));
    const surface: InformationSurfaceContext = { version: 1, stateId: value.id, requestId: value.requestId, tenantId, publicationId: value.publicationId, revision: revision.current, status: history.current.pending ? 'pending' : 'committed', pendingRequestId: history.current.pending?.id ?? null, layout: informationLayout(presented), subject, regions: presented, answer: value.answer, previous, next: history.current.future.slice(-8).reverse().map(item => ({ stateId: item.id, title: snapshotTitle(item, authorityRef.current), subject: item.workspace.objects.flatMap(object => object.references.map(referenceKey)).slice(0, 12) })), reading: readingState };
    // Compatibility receipt for existing tools. There is no global rail navigation.
    const compatibilityCards: CarouselCard[] = cardsRef.current.map(({ id, title, kind, referenceIds }) => ({ id, title, kind: ['collection', 'map', 'chart'].includes(kind) ? 'information' : kind as CarouselCard['kind'], referenceIds }));
    const carousel: CarouselContext = { version: 1, open: activeRef.current, revision: revision.current, cards: compatibilityCards, activeId: primary?.id ?? null, previousId: null, lastNarratedId: lastNarrated.current, expanded: value.expanded, recentCards: [], reading: readingState, media: (() => { const item = Object.values(playback.current).find(item => presented.some(region => region.id === `video:${item.id}`)); return item ? { id: item.id, status: item.status, seconds: item.seconds } : null; })(), ...(value.answer ? { answer: value.answer } : {}) };
    const externalResults = value.external.filter(result => value.workspace.objects.some(object => object.references.some(ref => ref.kind === 'external' && ref.id === result.id))).map(result => exploreContextForResult({ ...result, map: result.map ? { ...result.map, zoom: Number(value.selections[`zoom:${result.id}`] ?? result.map.zoom) } : null }, (value.selections[`kind:${result.id}`] ?? result.kind) as 'web' | 'images' | 'map', value.selections[result.id] ?? null));
    const activeExternal = regionsRef.current.find(region => region.role === 'primary' && region.record?.reference.kind === 'external') ?? regionsRef.current.find(region => region.record?.reference.kind === 'external');
    const taskResearch = value.task?.research;
    const researchContext = taskResearch && regionsRef.current.some(region => region.selectionKey === taskResearch.id) ? exploreContextForResult({ ...taskResearch, map: taskResearch.map ? { ...taskResearch.map, zoom: Number(value.selections[`zoom:${taskResearch.id}`] ?? taskResearch.map.zoom) } : null }, (value.selections[`kind:${taskResearch.id}`] ?? taskResearch.kind) as 'web' | 'images' | 'map', value.selections[taskResearch.id] ?? null) : undefined;
    const explore = externalResults.find(result => result.resultId === activeExternal?.record?.reference.id) ?? researchContext;
    return { workspace: { ...value.workspace, receipts: [] }, scene, surface, carousel, ...(externalResults.length ? { externalResults } : {}), ...(explore ? { explore } : {}) };
  }

  function playbackChanged(value: PlaybackState) { const previous = playback.current[value.id]; playback.current[value.id] = value; if (previous?.status !== value.status) capture(); }
  function selectResearch(id: string, selection: string | null) { onInteraction(); change({ selections: { ...current.current.selections, [id]: selection } }); }
  function videoCard(id: string) { return <MediaVideo videoId={id} active={active} initialSeconds={initialPlayback[id]?.seconds ?? 0} initialState={initialPlayback[id]} resumePaused={!!initialPlayback[id]} onAudible={onMediaAudible} onChange={playbackChanged}/>; }

  function researchContent(result: ExternalSearchResult): ReactNode {
    const kind = (surface.selections[`kind:${result.id}`] ?? result.kind) as ExternalSearchResult['kind'];
      const selection = externalSelection[result.id], image = result.images.find(image => image.id === selection), source = result.sources.find((_, index) => selection === `source-${index + 1}`);
      if (image || source) return <><button className={styles.textButton} onClick={() => selectResearch(result.id, null)}>Back to search</button>{image ? <figure className={styles.photo}>
        {/* External images are already validated references; no server proxy. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.url} alt={image.caption} style={{ maxHeight: '55dvh', objectFit: 'contain' }}/><figcaption>{image.caption}</figcaption><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Visit image source ↗</a></figure> : source && <><h3>{source.title}</h3><AssistantAnswer text={result.answer}/><a href={source.url} target="_blank" rel="noopener noreferrer">Read this source ↗</a></>}<small>External information · separate from the publisher’s information</small></>;
      return <ExternalSearchResults surface showViewer={false} result={{ ...result, map: result.map ? { ...result.map, zoom: Number(surface.selections[`zoom:${result.id}`] ?? result.map.zoom) } : null }} kind={kind} selected={null} onInteraction={onInteraction} onCommand={command => externalCommand(command, result.id)}/>;
  }
  function recordContent(record: WorkspaceRecord, expanded: boolean): ReactNode {
    if (record.reference.kind === 'source' && record.reference.id.startsWith('video:')) return videoCard(record.reference.id.slice(6));
    if (record.reference.kind === 'photo') {
      const asset = media?.assets.find(item => item.id === record.reference.id);
      return <figure className={styles.photo}><MediaImage assetId={record.reference.id} size="display" fit="contain" interactive={false}/><figcaption>{asset?.caption || asset?.alt}{asset?.credit && <small>{asset.credit}</small>}{record.example && <small>Illustrative example</small>}</figcaption></figure>;
    }
    if (record.reference.kind === 'fact' && catalog) return <p>{workspaceFact(catalog, record.reference.id)?.value.display ?? 'Not provided'}</p>;
    if (record.reference.kind === 'capability') { const link = catalog?.capabilities?.find(item => item.id === record.reference.id); return link ? <a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a> : null; }
    if (record.reference.kind === 'external') {
      const result = external.find(item => item.id === record.reference.id); if (!result) return null;
      return researchContent(result);
    }
    const entity = displayCatalog?.entities.find(item => item.id === record.reference.id && record.reference.kind === 'entity');
    const photos = media?.associations.filter(link => (record.reference.kind === 'entity' && link.targetType === 'entity' && link.targetId === record.reference.id) || (record.reference.kind === 'source' && link.targetType === 'section' && `section:${link.targetId}` === record.reference.id)) ?? [];
    const knowledge = catalog && entity ? retrieveKnowledge(catalog, { revisionId: catalog.id, entityIds: [entity.id], expansion: 0, includeBlocks: false }, media) : null;
    return <>{photos[0] && <figure className={styles.photo}><MediaImage assetId={photos[0].assetId} size="display" fit="contain" interactive={false}/>{photos[0].role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
      {entity?.blocks?.length ? entity.blocks.map(block => block.kind === 'heading' ? <h3 key={block.id} data-reading-block={block.id}>{block.text}</h3> : <p key={block.id} data-reading-block={block.id}>{block.text}</p>) : <p>{record.body || 'No further description has been published.'}</p>}
      {entity && <dl className={styles.facts}>{displayCatalog!.attributes.filter(attribute => entity.attributes[attribute.id] != null && !knowledge?.values.some(value => value.field === `attributes.${attribute.id}`)).map(attribute => <div key={attribute.id}><dt>{attribute.label}</dt><dd>{formatAttribute(entity.attributes[attribute.id], attribute)}</dd></div>)}{knowledge?.values.filter(value => !['name', 'summary'].includes(value.field)).map(value => <div key={value.field}><dt>{catalog!.facts?.find(fact => value.factIds.includes(fact.id))?.definition?.label ?? catalog!.attributes.find(attribute => `attributes.${attribute.id}` === value.field)?.label ?? value.field}</dt><dd>{knowledgeValueText(value, knowledge.facts)}</dd></div>)}</dl>}
      {expanded && entity && catalog?.capabilities?.filter(link => !link.entityIds.length || link.entityIds.includes(entity.id)).map(link => <p key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer">{link.label} ↗</a></p>)}
    </>;
  }
  function greetingContent(point: GreetingVisual): ReactNode {
    const reference = point.record.parent ?? point.record.reference;
    const photo = media?.associations.filter(link => media.assets.some(asset => asset.id === link.assetId) &&
      (reference.kind === 'entity' && link.targetType === 'entity' && link.targetId === reference.id || reference.kind === 'source' && link.targetType === 'section' && `section:${link.targetId}` === reference.id))
      .sort((a, b) => Number(b.primary) - Number(a.primary))[0];
    return <div className={styles.greetingTopic} data-greeting-topic={point.slot + 1} data-has-photo={!!photo}>
      <div>{point.topic.body.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}{point.record.reference.kind === 'entity' && <button type="button" className={styles.textButton} onClick={() => {
        onInteraction(); void apply(workspaceBatch(current.current.workspace, [{ kind: 'replace', objects: [objectInput(point.record)] }]));
      }}>Read more<span className={styles.srOnly}> about {point.topic.title}</span> ↗</button>}</div>
      {photo && <figure className={styles.photo}><MediaImage assetId={photo.assetId} size="display" fit="contain" interactive={false}/>{photo.role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
    </div>;
  }
  const taskContent = taskSurface?.render(view, execute);
  let cards: Card[] = [];
  if (view) {
    // An empty query is useful as the primary result or a history destination,
    // but it supplies no support for a later standalone answer. Rich task
    // content and actionable context must never be classified as placeholders.
    const placeholderOnly = !view.records.length && view.result.count.kind === 'exact' && view.result.count.value === 0 && !view.result.nextCursor
      && !view.clarification && !view.links?.length && !view.selectedRecords.length && !view.lookupRecords?.length
      && !view.detail && !view.comparison && !view.estimate && !view.research && !view.map
      && !view.artifacts.length && !view.artifactSummaries?.length && !Object.keys(view.business).length && !view.demoActions
      && !Object.values(view.result.exclusions).some(count => count > 0) && !taskSurface?.error;
    const taskVideo = view.focus === 'detail' && view.detail?.record.type === 'published-video' ? view.detail.record.media?.assetId : view.focus === 'query' && view.records.length === 1 && view.records[0].type === 'published-video' ? view.records[0].media?.assetId : undefined;
    if (view.focus === 'clarification') cards.push({ id: 'clarification', title: view.clarification?.question.slice(0, 200) || 'A little more detail', kind: 'information', referenceIds: [], content: taskContent?.header });
    else if (view.focus === 'estimate' && view.estimate) cards.push({ id: `estimate:${view.operationId}`, title: '', kind: 'artifact', referenceIds: [...new Set(view.estimate.lines.map(line => line.recordId))], content: taskContent?.foreground });
    else if (taskVideo) cards.push({ id: `video:${taskVideo}`, title: view.detail?.record.name ?? view.records[0].name, kind: 'video', videoId: taskVideo, referenceIds: [view.detail?.record.id ?? view.records[0].id], recordId: view.detail?.record.id ?? view.records[0].id, content: videoCard(taskVideo) });
    else if (view.focus === 'detail' && view.detail || view.focus === 'comparison' && view.comparison) cards.push({ id: view.focus === 'detail' ? `detail:${view.detail!.record.id}` : `comparison:${view.result.resultSetId}`, title: view.focus === 'detail' ? view.detail!.record.name : 'Comparison', kind: view.focus === 'detail' ? view.detail!.record.type === 'published-photo' ? 'photo' : 'record' : 'comparison', referenceIds: view.focus === 'detail' ? [view.detail!.record.id] : view.comparison!.rows.map(row => row.id), content: taskContent?.foreground });
    else if (view.research && view.focus === 'research') cards.push({ id: `research:${view.research.id}`, title: view.research.query, kind: view.research.kind === 'map' ? 'map' : 'research', selectionKey: view.research.id, referenceIds: [`research:${view.research.id}`], content: researchContent(view.research) });
    else if (view.focus && ['research', 'map', 'artifact', 'business', 'quote', 'booking', 'receipt', 'cart', 'slots'].includes(view.focus)) cards.push({ id: view.research ? `research:${view.research.id}` : `${view.focus}:${view.operationId}`, title: view.research?.query ?? view.map?.label ?? '', kind: view.map ? 'map' : view.research ? 'research' : 'artifact', referenceIds: [], content: taskContent?.after });
    else cards.push({ id: 'collection:results', kind: 'collection', placeholderOnly, title: view.clarification ? 'A little more detail' : view.records.length ? `${view.result.count.value} ${view.result.count.value === 1 ? 'item' : 'items'}` : 'No matches yet', referenceIds: view.records.map(record => record.id), content: <>
      <div className={styles.criteria}>{taskContent?.header}</div>
      <InformationGrid className={styles.collection} direction={direction} photos={view.records.every(record => record.type === 'published-photo')}>{view.records.map(record => { const concise = visitorRecordSummary(record); return <InformationGridItem key={record.id} id={record.id} className={styles.result}>
        {record.media && record.type !== 'published-video' && <figure className={styles.resultPhoto}><MediaImage assetId={record.media.assetId} size="display" fit="contain" aspectRatio="4 / 3" interactive={false}/>{record.media.role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
        <div>{concise.category && <small className={styles.resultCategory}>{concise.category}</small>}<h3>{record.name}</h3>{concise.summary && <p>{concise.summary}</p>}<dl className={styles.facts}>{concise.values.map(value => <div key={value.fieldId} data-value-role={websiteValueRole(value)}><dt>{value.label}</dt><dd>{value.text}</dd></div>)}</dl>
        <button type="button" className={styles.textButton} onClick={() => void execute('record.detail', { recordId: record.id })}>{record.type === 'published-video' ? 'Watch video' : 'Read details'}<span className={styles.srOnly}>: {record.name}</span> ↗</button></div>
      </InformationGridItem>; })}</InformationGrid>{taskContent?.after}
    </> });
  }
  const primaryGallery = state.objects.find(object => object.instanceId === surface.primaryId && object.component === 'gallery' && !surface.selections[object.instanceId]);
  const groupedGalleries = primaryGallery ? state.objects.filter(object => object.component === 'gallery' && !surface.selections[object.instanceId]) : [];
  for (const object of state.objects) {
    if (groupedGalleries.includes(object) && object !== primaryGallery) continue;
    const records = object.references.flatMap(ref => { const item = workspaceRecord(authority, ref); return item?.members && ['collection', 'gallery'].includes(object.component) ? item.members.flatMap(member => workspaceRecord(authority, member) ?? []) : item ? [item] : []; });
    if (object.component === 'chart' && displayCatalog) cards.push({ id: object.instanceId, title: '', kind: 'chart', referenceIds: records.map(record => referenceKey(record.reference)), object, content: <PublishedChart metric={object.metric} catalog={displayCatalog} entityIds={records.map(record => record.reference.id)} selectedId={surface.selections[object.instanceId] ?? null} onSelect={id => { onInteraction(); change({ selections: { ...current.current.selections, [object.instanceId]: id } }); }}/> });
    else if (object.component === 'comparison' && displayCatalog) cards.push({ id: object.instanceId, title: '', kind: 'comparison', referenceIds: records.map(record => referenceKey(record.reference)), object, content: <PresentationView catalog={displayCatalog} state={initialInteraction(displayCatalog)} onAction={event => {
      const record = event.type === 'focus' && records.find(record => record.reference.id === event.params.id); if (!record) return;
      onInteraction(); const detail = objectInput(record); void apply(workspaceBatch(current.current.workspace, [{ kind: 'replace', objects: [detail] }]));
    }} plan={{ schemaVersion: 1, snapshotId: displayCatalog.id, operation: 'compare', components: [{ id: 'comparison', type: 'comparison', variant: 'expanded', entityIds: records.map(record => record.reference.id), attributeIds: displayCatalog.attributes.map(attribute => attribute.id).slice(0, 12) }], transition: { type: 'none' } }}/> });
    else if (object.component === 'map') { const record = records[0]; const location = catalog && record ? workspaceLocation(catalog, record.reference.id) : null; cards.push({ id: object.instanceId, title: record?.name ?? 'Location', kind: 'map', referenceIds: records.map(record => referenceKey(record.reference)), object, content: <><p>{location?.address ?? 'No address is published.'}</p><p>{location?.latitude != null ? `Published coordinates: ${location.latitude}, ${location.longitude}` : 'No unambiguous coordinates are published.'}</p></> }); }
    else if (['collection', 'gallery'].includes(object.component)) {
      const selected = records.find(record => referenceKey(record.reference) === surface.selections[object.instanceId]);
      if (selected) cards.push({ id: object.instanceId, title: object.component === 'gallery' ? '' : selected.name, kind: object.component === 'gallery' ? 'photo' : 'record', object, referenceIds: [referenceKey(selected.reference)], content: <div className={styles.localGallery} role="group" aria-label={object.component === 'gallery' ? 'Photo gallery' : 'Collection navigation'} tabIndex={0}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); onInteraction(); moveLocal(event.key === 'ArrowLeft' ? -1 : 1, object.instanceId); } }}
        onPointerDown={event => { if (event.pointerType === 'touch') galleryGesture.current = { id: object.instanceId, x: event.clientX, y: event.clientY }; }}
        onPointerCancel={() => { galleryGesture.current = null; }}
        onPointerUp={event => { const start = galleryGesture.current; galleryGesture.current = null; if (!start || start.id !== object.instanceId) return; const dx = event.clientX - start.x, dy = event.clientY - start.y; if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { onInteraction(); moveLocal(dx < 0 ? 1 : -1, object.instanceId); } }}>
        {recordContent(selected, surface.expanded)}
        <nav className={styles.localControls} aria-label={object.component === 'gallery' ? 'Photo gallery' : 'Collection navigation'}>
          <button type="button" aria-label="Previous photo" disabled={records.indexOf(selected) === 0} onClick={() => { onInteraction(); moveLocal(-1, object.instanceId); }}><ChevronLeft size={18}/></button>
          <span>{records.indexOf(selected) + 1} of {records.length}</span>
          <button type="button" aria-label="Next photo" disabled={records.indexOf(selected) === records.length - 1} onClick={() => { onInteraction(); moveLocal(1, object.instanceId); }}><ChevronRight size={18}/></button>
        </nav>
      </div> });
      else if (records.length) {
        // Albums requested together share one broad grid, preserving each
        // original object ID for selection, navigation and display receipts.
        const members = object === primaryGallery ? groupedGalleries : [object];
        const entries = [...new Map(members.flatMap(owner => owner.references.flatMap(ref => {
          const record = workspaceRecord(authority, ref);
          return (record?.members ?? [ref]).flatMap(member => { const record = workspaceRecord(authority, member); return record ? [[referenceKey(member), { record, owner }] as const] : []; });
        }))).values()];
        cards.push({ id: object.instanceId, title: `${entries.length} ${object.component === 'gallery' ? 'photos' : 'items'}`, kind: 'collection', object, objectIds: members.map(item => item.instanceId), itemCount: entries.length, referenceIds: entries.map(({ record }) => referenceKey(record.reference)).slice(0, 48), content:
        <InformationGrid className={styles.collection} direction={direction} photos={object.component === 'gallery'}>{entries.map(({ record, owner }) => <InformationGridItem key={referenceKey(record.reference)} id={referenceKey(record.reference)} className={styles.result}>
          <button type="button" className={styles.gridOpen} aria-label={`Open ${record.name}`} onClick={() => { onInteraction(); change({ selections: { ...current.current.selections, [owner.instanceId]: referenceKey(record.reference) }, primaryId: owner.instanceId, scrollTop: 0 }); if (record.reference.kind === 'photo') onPhotoView?.(record.reference.id); }}>
            {record.reference.kind === 'photo' && <MediaImage assetId={record.reference.id} size="thumb" fit="cover" interactive={false}/>}
            <h3>{record.name}</h3>{record.example && <small>Illustrative example</small>}
          </button>
          {record.reference.kind !== 'photo' && <p>{record.body}</p>}
        </InformationGridItem>)}</InformationGrid>
      }); }
    } else records.forEach(record => {
      const greeting = greetingTopics.find(point => object.instanceId === `greeting-topic-${point.slot + 1}` && referenceKey(point.record.reference) === referenceKey(record.reference));
      const videoId = record.reference.id.startsWith('video:') ? record.reference.id.slice(6) : undefined;
      cards.push({ id: videoId ? `video:${videoId}` : referenceKey(record.reference), title: greeting ? greeting.topic.title : record.name, kind: videoId ? 'video' : record.reference.kind === 'photo' ? 'photo' : record.reference.kind === 'external' ? external.find(result => result.id === record.reference.id)?.kind === 'map' ? 'map' : 'research' : 'information', referenceIds: [referenceKey(record.reference)], ...(record.reference.kind === 'external' ? { selectionKey: record.reference.id } : {}), ...(greeting ? { content: greetingContent(greeting) } : {}), record, object, videoId });
    });
  }
  cards = [...new Map(cards.map(card => [card.id, card])).values()];
  const supportingAnswer = !!answer && surface.answerPlacement === 'supporting' && cards.length > 0;
  if (answer && !supportingAnswer) cards.push({ id: 'answer', title: '', kind: 'answer', referenceIds: [], content: <AssistantAnswer text={answer}/> });
  const hasInformation = cards.length > 0;
  useEffect(() => { onContentChange?.(hasInformation); }, [hasInformation, onContentChange]);
  if (!cards.length) cards.push({ id: 'welcome', title: 'What would you like to explore?', kind: 'information', referenceIds: [], content: <p>Ask a question or take a closer look.</p> });
  const selected = cards.find(card => card.id === surface.primaryId) ?? cards.at(-1)!;
  // Keep current-screen receipts consistent with the visible composition. The
  // task and its history bookmark remain intact for refinement and Back.
  if (selected.kind === 'answer') cards = cards.filter(card => !card.placeholderOnly);
  const supporting = cards.filter(card => card.id !== selected.id && (selected.kind !== 'collection' || card.kind === 'collection' || card.kind === 'video')).reverse().sort((a, b) => Number(b.kind === 'video') - Number(a.kind === 'video')).slice(0, 2);
  // Primary first in the DOM for reading order. CSS moves support left on desktop;
  // videos keep the same parent/key even when their role changes.
  const visible = [selected, ...supporting];
  const regions = visible.map(card => ({ ...card, role: card.id === selected.id ? 'primary' as const : 'supporting' as const }));
  useLayoutEffect(() => { cardsRef.current = cards; regionsRef.current = regions; });
  const layout = informationLayout(regions);
  const compositionKey = surface.id + ':' + regions.map(card => `${card.id}:${card.role}`).join('|');
  const observedTask = useRef<VisitorTaskView | null>(null);
  useLayoutEffect(() => {
    taskSurface?.attachRoot(root.current);
    const next = taskSurface?.view ?? null;
    if (observedTask.current === next) return;
    observedTask.current = next;
    if (restoring.current || !next || current.current.task === next) return;
    const video = next.focus === 'detail' && next.detail?.record.type === 'published-video' ? next.detail.record.media?.assetId : (!next.focus || next.focus === 'query') && next.records.length === 1 && next.records[0].type === 'published-video' ? next.records[0].media?.assetId : undefined;
    const primaryId = next.focus === 'clarification' ? 'clarification' : video ? `video:${video}` : next.focus === 'detail' && next.detail ? `detail:${next.detail.record.id}` : next.focus === 'comparison' && next.comparison ? `comparison:${next.result.resultSetId}` : next.research && next.focus === 'research' ? `research:${next.research.id}` : next.focus && next.focus !== 'query' ? `${next.focus}:${next.operationId}` : 'collection:results';
    // Refresh/interrupt can omit the operation ID after restoring a receipt.
    // They observe the same view, not a new answer or an "initial" bookmark.
    const same = !next.operationId || current.current.task?.operationId === next.operationId;
    change({ task: next, taskBookmark: next.operationId ?? current.current.taskBookmark ?? 'initial', ...(same ? {} : { workspace: emptyWorkspace(authorityRef.current.publicationId), answer: '', primaryId, scrollTop: 0 }) }, !same);
  // Task receipts contain new revisions of the same committed result, not new history steps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSurface?.view]);
  useLayoutEffect(() => {
    if (reading.current && !restoring.current) reading.current.scrollTop = current.current.scrollTop;
    capture();
  }, [compositionKey, active, surface.id, historyView]);
  useEffect(() => { if (!active) version.current++; }, [active]);
  useImperativeHandle(handleRef, () => ({ context, apply, confirm, command, navigate, prepare, begin, finish,
    cancel: async () => history.current.pending ? restore(history.current.pending.before) : 'applied',
    answer: async (text, signal, relationship = 'related', placement) => {
      if (signal?.aborted) return 'cancelled';
      if (relationship === 'new-subject') tasks?.hide();
      const supporting = placement === 'supporting' && relationship !== 'new-subject';
      if (text.trim()) change({ answer: text.slice(0, 8000), answerPlacement: supporting ? 'supporting' : undefined,
        primaryId: supporting ? current.current.primaryId === 'answer' ? null : current.current.primaryId : 'answer', scrollTop: 0,
        ...(relationship === 'new-subject' ? { workspace: emptyWorkspace(authorityRef.current.publicationId), task: null, selections: {} } : {}) });
      return confirm(signal);
    },
    intent: async (text, signal) => { if (await command(text, signal)) return true; const result = planWorkspaceIntent(text, current.current.workspace, authorityRef.current, context().scene, catalog, media); if (!result.batch) { setError(result.message); return false; } return await apply(result.batch, signal) === 'applied'; },
    plan: (plan, signal) => apply('schemaVersion' in plan && catalog ? workspaceFromPlan(plan, current.current.workspace, authorityRef.current, catalog, media) : workspaceFromSources(plan as SitePresentation, current.current.workspace, authorityRef.current, content, media), signal),
    greeting: async (index, signal) => {
      if (signal.aborted) return 'cancelled';
      // Finishing leaves the last introduced subject available for questions.
      // Each topic is a real, validated history state, not an index into unrelated cards.
      if (index === null) return 'applied';
      const point = greetingTopics[index];
      if (!point) return 'failed';
      if (point.recordId) {
        const requestId = crypto.randomUUID();
        if (await begin(requestId, true) !== 'applied' || signal.aborted) return 'cancelled';
        try {
          if (taskSurface?.available) {
            const result = await taskSurface.execute('record.detail', { recordId: point.recordId }, false, signal);
            if (signal.aborted) return 'cancelled';
            if (!result) return 'failed';
          } else {
            // Draft previews use the same approved topic text without starting
            // a public task session or inventing a workspace reference.
            change({ workspace: emptyWorkspace(authorityRef.current.publicationId), task: null, answer: `## ${point.topic.title}\n\n${point.topic.body}`, primaryId: 'answer', scrollTop: 0 });
          }
          await frame();
          return confirm(signal);
        } finally { await frame(); finish(requestId); }
      }
      lastNarrated.current = referenceKey(point.record.reference);
      return apply(workspaceBatch(current.current.workspace, [{ kind: 'replace', objects: [objectInput(point.record, point.record.component, `greeting-topic-${point.slot + 1}`)] }]), signal);
    },
    showExternal: async (input, signal) => {
      if (signal?.aborted) return 'cancelled'; const result = exploreResultSchema.parse(input), next = [...current.current.external.filter(item => item.id !== result.id), result].slice(-6);
      const nextAuthority = publishedWorkspace(content, catalog, media, next.map(result => exploreContextForResult(result, result.kind, null)));
      const own = !history.current.pending, requestId = crypto.randomUUID(); if (own && await begin(requestId, false) !== 'applied') return 'failed';
      authorityRef.current = nextAuthority; current.current = { ...current.current, external: next };
      const record = nextAuthority.records.find(record => record.reference.kind === 'external' && record.reference.id === result.id)!;
      const status = await apply(workspaceBatch(current.current.workspace, [result.annotationTarget ? { kind: 'add', object: objectInput(record) } : { kind: 'replace', objects: [objectInput(record)] }]), signal);
      if (own) finish(requestId); return status;
    },
    externalCommand, annotationTarget: () => selected?.object ? annotationTargetForObject(current.current.workspace, selected.object.instanceId) : undefined,
    browse: signal => navigate('browse', undefined, undefined, signal), home: signal => navigate('home', undefined, undefined, signal), clear: signal => navigate('clear', undefined, undefined, signal), restoreWebsite: async () => { onDismiss?.(); return 'applied'; }, releaseFocus: async () => 'applied', beforeSearch: () => {}, reset: () => { void navigate('clear'); }, narrate: () => { lastNarrated.current = current.current.primaryId; capture(); },
  }));
  const destination = historyView.destination;
  return <section ref={root} className={styles.rail} hidden={hideEmpty && !hasInformation && !error && !notice} data-has-information={hasInformation} data-information-surface data-ai-carousel data-active-card={selected.id} data-result-set={view?.result.resultSetId} data-workspace-transition="settled" data-carousel-active={active} data-surface-state={surface.id} data-history-depth={historyView.depth} data-forward-depth={history.current.future.length} data-history-direction={direction} aria-label="Assistant information" data-pending-request={historyView.pendingId ?? ''} aria-busy={!!(pending || taskSurface?.busy || historyView.pendingId || restorationPending)}>
    <div className={styles.shell} data-layout={layout} data-expanded={surface.expanded}>
      {destination && <button type="button" className={styles.back} data-surface-back disabled={restorationPending} aria-label="Back to previous information" title={`Back to ${snapshotTitle(destination, authority)}`} onClick={() => { onInteraction(); void back(); }}><ArrowLeft size={18}/><span className={styles.srOnly}>Back</span></button>}
      {historyView.forward && <button type="button" className={styles.forward} data-surface-forward disabled={restorationPending} aria-label="Forward to next information" title={`Forward to ${snapshotTitle(historyView.forward, authority)}`} onClick={() => { onInteraction(); void navigate('forward'); }}><ArrowRight size={18}/><span className={styles.srOnly}>Forward</span></button>}
      <InformationFrame className={styles.card} ref={cardRoot} transitionKey={compositionKey} onSettled={settled => { if (root.current) root.current.dataset.workspaceTransition = settled ? 'settled' : 'moving'; }}>
        <button type="button" className={styles.dismiss} aria-label="Close assistant" title="Return to website" onClick={() => onDismiss?.()}><X size={16}/></button>
        <motion.div layoutScroll className={styles.reading} ref={reading} data-workspace-scroll onScroll={() => { current.current = { ...current.current, scrollTop: Math.round(reading.current?.scrollTop ?? 0) }; capture(); }}>
          {(error || notice || (selected.kind !== 'collection' && taskSurface?.error)) && <p className={styles.notice} role="status">{error || notice || taskSurface?.error}</p>}
          <div className={styles.composition} data-layout={layout}>
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>{[...regions].sort((a, b) => Number(b.kind === 'video') - Number(a.kind === 'video') || (a.kind === 'video' && b.kind === 'video' ? a.id.localeCompare(b.id) : 0)).map(region => <InformationRegion key={region.id} id={region.id} role={region.role} kind={region.kind} reverse={direction === 'back'} className={styles.region}>
              <div data-task-record={region.recordId}>
                {region.title && region.id !== 'clarification' && !['video', 'photo', 'comparison', 'research', 'map'].includes(region.kind) && !(view?.detail && region.id.startsWith('detail:')) && <h2 className={region.kind === 'collection' ? styles.resultCount : undefined} data-website-result-heading={region.kind === 'collection' ? true : undefined}>{region.title}</h2>}
                {region.content ?? (region.record ? recordContent(region.record, surface.expanded) : null)}
                {supportingAnswer && region.role === 'primary' && <div className={styles.supportingAnswer} data-surface-supplement><AssistantAnswer text={answer}/></div>}
              </div>
            </InformationRegion>)}</AnimatePresence>
          </div>
        </motion.div>
      </InformationFrame>
    </div>
  </section>;
}
