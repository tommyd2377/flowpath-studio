'use client';
import { recordedVisitorFetch } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode, type RefObject } from 'react';
import { type QueryPatch } from '@thevoice/platform-ui/query';
import { VisitorArtifacts, ActionReview, TaskResearch, TaskComparison, PublishedEstimateView } from '@thevoice/platform-ui/task-components';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MediaImage } from '@thevoice/platform-ui';
import { mapEmbedUrl } from '@/lib/explore-model';
import { visitorTaskViewSchema, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { taskSurfaceRevisionMatches, workspaceElementVisible } from '@/lib/workspace-screen';
import { useTaskViewport } from '@/lib/use-task-viewport';
import { diagnosticError, visitorDiagnostic, visitorDiagnosticTimer } from '@/lib/visitor-diagnostics';
import { captureVisitorTaskCompletion, reconcileVisitorTaskCheckpoint, visitorTaskCheckpoint } from '@/lib/visitor-task-checkpoint';

type DisplayStatus = 'applied' | 'cancelled' | 'failed';
type TaskExecute = (capabilityId: string, input: unknown, manual?: boolean, signal?: AbortSignal) => Promise<unknown>;
type TaskControls = { snapshot: () => VisitorTaskView | null; restore: (bookmark: string, visible: boolean, signal?: AbortSignal) => Promise<DisplayStatus>; command: (text: string, signal: AbortSignal) => Promise<{ handled: boolean; message?: string } | undefined>; openOrdinal: (ordinal: number) => Promise<void>; setPending: (value: boolean) => void; reset: (signal?: AbortSignal) => Promise<DisplayStatus>; settle: (refresh?: boolean) => Promise<void>; current: () => { sessionId: string; revision: number; generation: number } | undefined; completion: (signal: AbortSignal) => ReturnType<typeof captureVisitorTaskCompletion>; show: (view: VisitorTaskView, signal?: AbortSignal, onVisible?: () => void) => Promise<'applied' | 'cancelled' | 'failed'>; interrupt: () => void; hide: () => void; home: (signal?: AbortSignal) => Promise<DisplayStatus>; back: (signal?: AbortSignal) => Promise<DisplayStatus> | undefined };
type WebsiteTaskState = { attachRoot: (node: HTMLElement | null) => void; error: string; available: boolean; view: VisitorTaskView | null; busy: boolean; root: RefObject<HTMLElement | null>; render: (view: VisitorTaskView | null, execute: TaskExecute) => { header: ReactNode; foreground: ReactNode; after: ReactNode }; execute: TaskExecute; patch: (operations: QueryPatch['operations']) => void };
const WebsiteTaskContext = createContext<WebsiteTaskState | null>(null);
export const useWebsiteTasks = () => useContext(WebsiteTaskContext);
const TaskContext = createContext<TaskControls | null>(null);
export const useVisitorTasks = () => useContext(TaskContext);
export function VisitorTasksProvider({ slug, children, onInteraction, homeRef, beforeShow, active = true }: { active?: boolean; beforeShow?: (view: VisitorTaskView, signal?: AbortSignal) => Promise<DisplayStatus>; slug?: string; children: ReactNode; onInteraction: () => void; homeRef?: { current: (() => void) | null } }) {
  const [view, setView] = useState<VisitorTaskView | null>(null), viewRef = useRef(view), root = useRef<HTMLElement>(null);
  const [conversationPending, setConversationPending] = useState(false);
  const returnRecord = useRef<string | null>(null);
  const confirmed = useRef<VisitorTaskView | null>(null);
  const historical = useRef<VisitorTaskView | null>(null);
  const initialization = useRef<Promise<VisitorTaskView> | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const beforeShowRef = useRef(beforeShow), openRef = useRef(false);
  const activeRef = useRef(active);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  useLayoutEffect(() => { beforeShowRef.current = beforeShow; }, [beforeShow]);
  const ownInteraction = useRef(false), interruptWork = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<AbortController | null>(null), generation = useRef(0), scene = useRef(0);
  const settlement = useRef<{ refresh: boolean; generation: number; view: VisitorTaskView | null; work: Promise<void> } | null>(null);
  const reduced = useReducedMotion();
  const request = useCallback(async (input: unknown, signal?: AbortSignal) => {
    if (!slug) throw new Error('Publish to use shared visitor tasks.');
    const diagnostic = input && typeof input === 'object' && 'action' in input && input.action === 'init'
      ? { traceId: crypto.randomUUID(), channel: 'browser' as const, stage: 'context' as const, operation: 'workspace' as const } : null;
    const elapsed = visitorDiagnosticTimer();
    if (diagnostic) visitorDiagnostic({ ...diagnostic, status: 'started' });
    try {
      const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
      const result = await response.json();
      recordBrowserTestEvent('task.result', result, diagnostic?.traceId);
      if (!response.ok) throw Object.assign(new Error(result.error ?? 'The task could not finish.'), { status: response.status });
      if (diagnostic) visitorDiagnostic({ ...diagnostic, status: 'succeeded', durationMs: elapsed() });
      return result;
    } catch (error) {
      if (diagnostic) { const details = diagnosticError(error); visitorDiagnostic({ ...diagnostic, ...details, ...(details.httpStatus === 400 ? { reason: 'schema' as const } : {}), status: signal?.aborted ? 'cancelled' : 'failed', durationMs: elapsed() }); }
      throw error;
    }
  }, [slug]);
  const initialize = useCallback(async () => {
    initialization.current ??= request({ action: 'init' }).then(result => visitorTaskViewSchema.parse(result.view)).catch(error => { initialization.current = null; throw error; });
    return initialization.current;
  }, [request]);
  const attachRoot = useCallback((node: HTMLElement | null) => { root.current = node; }, []);
  const nextSceneRevision = useCallback(() => ++scene.current, []);
  const { pause: pauseViewport, accept: acceptViewport, settle: settleViewport, recordIds: viewportRecordIds } = useTaskViewport(root, open && active, nextSceneRevision, request);
  useEffect(() => { if (!active) pauseViewport(); else if (openRef.current && confirmed.current && confirmed.current !== historical.current) void acceptViewport(confirmed.current).catch(() => undefined); }, [active, pauseViewport, acceptViewport]);
  const show = useCallback(async (next: VisitorTaskView, signal?: AbortSignal, onVisible?: () => void): Promise<'applied' | 'cancelled' | 'failed'> => {
    const parsed = visitorTaskViewSchema.safeParse(next); if (!parsed.success) return 'failed'; next = parsed.data;
    const version = generation.current;
    if (signal?.aborted || viewRef.current && (viewRef.current.sessionId !== next.sessionId || viewRef.current.revision > next.revision || viewRef.current.generation > next.generation)) return 'cancelled';
    const previous = confirmed.current;
    const restore = (status: DisplayStatus) => {
      if (version === generation.current) {
        viewRef.current = previous; setView(previous); openRef.current = previous?.active ?? false; setOpen(previous?.active ?? false);
        root.current?.setAttribute('data-website-transition', 'settled');
      }
      return status;
    };
    pauseViewport();
    if (next.navigation === 'home') { openRef.current = false; setOpen(false); }
    const prepared = await beforeShowRef.current?.(next, signal) ?? 'applied';
    if (signal?.aborted || generation.current !== version || viewRef.current && (viewRef.current.revision > next.revision || viewRef.current.generation > next.generation)) return 'cancelled';
    if (prepared !== 'applied') return restore(prepared);
    viewRef.current = next; setView(next); openRef.current = next.active; setOpen(next.active);
    if (!next.operationId) return 'applied';
    const surface = () => {
      if (next.navigation === 'reset' && !next.active) return root.current?.closest<HTMLElement>('[data-published-website]');
      const selectors: Record<NonNullable<VisitorTaskView['focus']>, string> = { query: '[data-website-result-heading]', estimate: '[aria-label="Published price estimate"]', quote: '[aria-label="Synthetic quote review"]', booking: '[aria-label="Synthetic booking review"]', receipt: '.platform-action-review [role="status"]', cart: '[aria-label="Synthetic cart"]', slots: '[aria-label="Synthetic appointments"]', records: '[aria-label="Retrieved records"]', links: '[aria-label="Reviewed publisher links"]', comparison: '[aria-label="Selection comparison"]', detail: '[aria-label="Record detail"]', research: '[aria-label="Search results"]', map: '[aria-label="Evidence map"]', artifact: '.platform-task-artifact', business: '.platform-action-review', clarification: '[aria-label="Task clarification"]' };
      const target = next.focus ? root.current?.querySelector<HTMLElement>(selectors[next.focus]) : root.current;
      return taskSurfaceRevisionMatches(next, target) ? target : null;
    };
    // Observe committed result identity after React renders; the server verifies exact bindings.
    let settled = false;
    let observation: Record<string, unknown> = {};
    await new Promise<void>(resolve => {
      let stable = 0, position = '';
      let frame = 0; const finish = () => { clearTimeout(timeout); cancelAnimationFrame(frame); signal?.removeEventListener('abort', finish); resolve(); };
      // Exit and width/height reflow can be sequential; the frame tracks Motion completion.
      // This is a ceiling, not a delay: exact visible results settle immediately.
      const timeout = setTimeout(finish, 2500); signal?.addEventListener('abort', finish, { once: true });
      const tick = () => {
        if (signal?.aborted || version !== generation.current) return finish();
        root.current?.setAttribute('data-website-transition', 'pending');
        const target = surface(), details = target?.closest('details'); if (details) details.open = true;
        const card = root.current?.matches('[data-ai-carousel]') ? root.current.querySelector<HTMLElement>('[aria-label="Current information"]') : target;
        const rect = card?.getBoundingClientRect();
        const nextPosition = rect ? `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}` : ''; stable = nextPosition === position ? stable + 1 : 0; position = nextPosition;
        if (!root.current?.matches('[data-ai-carousel]') && (next.active || next.navigation === 'reset') && rect && (rect.top >= innerHeight || rect.bottom <= 0 || next.focus && rect.top < 0)) target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        const visible = !!target && workspaceElementVisible(target);
        const opacity = card ? Number(getComputedStyle(card).opacity) : 1;
        observation = { focus: next.focus, stableFrames: stable, position, transition: root.current?.dataset.workspaceTransition, targetFound: !!target, visible, opacity, resultMatches: root.current?.dataset.resultSet === next.result.resultSetId };
        if (stable > 2 && (!root.current?.matches('[data-ai-carousel]') || root.current.dataset.workspaceTransition === 'settled') && opacity >= .99 && (next.active ? visible && root.current?.dataset.resultSet === next.result.resultSetId : root.current?.dataset.resultSet !== next.result.resultSetId)) { settled = true; root.current?.setAttribute('data-website-transition', 'settled'); return finish(); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(tick); });
    });
    if (signal?.aborted || document.visibilityState !== 'visible' || generation.current !== version || next.active && root.current?.dataset.resultSet !== next.result.resultSetId) return restore('cancelled');
    if (!settled) { recordBrowserTestEvent('task.display.unsettled', observation, next.operationId); return restore('failed'); }
    const target = surface();
    if (next.active && next.focus && (!target || !workspaceElementVisible(target))) return restore('failed');
    if (!next.active && root.current?.dataset.resultSet === next.result.resultSetId) return restore('failed');
    const recordIds = next.active ? viewportRecordIds(next) : [];
    onVisible?.();
    const receiptElapsed = visitorDiagnosticTimer();
    visitorDiagnostic({ traceId: next.operationId, channel: 'browser', stage: 'visual_result', status: 'observed' });
    try {
      const ack = await request({ action: 'ack', sessionId: next.sessionId, operationId: next.operationId, generation: next.generation, queryId: next.query.queryId, queryRevision: next.query.revision, resultSetId: next.result.resultSetId, sceneRevision: ++scene.current, recordIds }, signal);
      if (signal?.aborted || version !== generation.current) return 'cancelled';
      viewRef.current = { ...next, revision: ack.revision }; confirmed.current = viewRef.current; setView(viewRef.current);
      await acceptViewport(viewRef.current, recordIds);
      visitorDiagnostic({ traceId: next.operationId, channel: 'browser', stage: 'display_receipt', status: 'succeeded', durationMs: receiptElapsed() });
      return signal?.aborted || version !== generation.current ? 'cancelled' : 'applied';
    } catch { return restore(signal?.aborted ? 'cancelled' : 'failed'); }
  }, [request, pauseViewport, acceptViewport, viewportRecordIds]);
  const execute = useCallback(async (capabilityId: string, input: unknown, manual = true, signal?: AbortSignal, display = true) => {
    if (signal?.aborted) return;
    pauseViewport();
    if (capabilityId === 'query.command') { generation.current++; pending.current?.abort(); }
    if (manual) { generation.current++; pending.current?.abort(); ownInteraction.current = true; onInteraction(); ownInteraction.current = false; }
    if (capabilityId === 'record.detail') returnRecord.current = (input as { recordId: string }).recordId;
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    pending.current = controller; const version = generation.current; setBusy(true); setError('');
    try {
      await interruptWork.current;
      // Completing an interrupt can accept the previous view again. Keep its
      // viewport observations paused while this operation changes the session.
      pauseViewport();
      let current = viewRef.current;
      if (!current) { current = await initialize(); if (version !== generation.current || controller.signal.aborted) return; viewRef.current = current; confirmed.current ??= current; setView(current); }
      if (capabilityId === 'query.command') {
        // The command endpoint owns cancellation and the authoritative revision.
        // It rejects a changed generation instead of targeting a newer view.
      } else if (manual) {
        const interrupted = await request({ action: 'interrupt', sessionId: current.sessionId }, controller.signal);
        if (version !== generation.current || controller.signal.aborted) return;
        current = { ...current, revision: interrupted.revision, generation: interrupted.generation }; viewRef.current = current;
      } else {
        // Backend reads/model accounting can advance the session after its last
        // display. Refresh the revision before executing a voice Back or Home.
        const refreshed = await request({ action: 'refresh', sessionId: current.sessionId }, controller.signal);
        if (version !== generation.current || controller.signal.aborted || refreshed.view.generation < current.generation) return;
        current = { ...current, revision: refreshed.view.revision, generation: refreshed.view.generation }; viewRef.current = current;
      }
      if (version !== generation.current || controller.signal.aborted) return;
      if (capabilityId === 'query.create' && current.queries.length === 1 && !current.active) { capabilityId = 'query.activate'; input = { queryId: current.query.queryId }; }
      const result = await request(capabilityId === 'query.command'
        ? { action: 'command', sessionId: current.sessionId, generation: current.generation, operationId: crypto.randomUUID(), text: (input as { text: string }).text }
        : { action: 'execute', sessionId: current.sessionId, call: { operationId: crypto.randomUUID(), capabilityId, expectedRevision: current.revision, input } }, controller.signal);
      if (version !== generation.current || controller.signal.aborted) return;
      if (result.handled === false) {
        const fresh = visitorTaskViewSchema.parse(result.view);
        viewRef.current = fresh; confirmed.current = fresh; setView(fresh);
        if (activeRef.current && openRef.current) await acceptViewport(fresh);
        return { handled: false };
      }
      if (!display) { viewRef.current = { ...current, revision: result.view.revision, generation: result.view.generation }; return result.data as unknown; }
      const status = await show(result.view, controller.signal);
      if (status === 'cancelled') return;
      if (status === 'failed') throw new Error('The requested view could not be confirmed.');
      if (capabilityId === 'view.back' && returnRecord.current) { const target = [...root.current?.querySelectorAll<HTMLElement>('[data-task-record]') ?? []].find(element => element.dataset.taskRecord === returnRecord.current); target?.focus({ preventScroll: true }); }
      if (version === generation.current && document.activeElement === document.body && priorFocus?.isConnected && !priorFocus.matches(':disabled')) priorFocus.focus({ preventScroll: true });
      else if (version === generation.current && (document.activeElement === document.body || document.activeElement?.closest('[hidden]'))) root.current?.querySelector<HTMLElement>('[data-website-result-heading]')?.focus({ preventScroll: true });
      return capabilityId === 'query.command' ? { handled: true, message: result.view.clarification?.question } : result.data as unknown;
    } catch (error) { if (!controller.signal.aborted && version === generation.current) setError(error instanceof Error ? error.message : 'Task unavailable.'); }
    finally { signal?.removeEventListener('abort', abort); if (pending.current === controller) pending.current = null; if (version === generation.current) setBusy(false); }
  }, [onInteraction, request, show, pauseViewport, initialize, acceptViewport]);
  const interrupt = useCallback((preserveConfirmed = false) => {
    if (ownInteraction.current) return;
    pauseViewport(); generation.current++; pending.current?.abort(); setBusy(false);
    const current = confirmed.current ?? viewRef.current;
    if (current) { viewRef.current = current; setView(current); }
    if (current) interruptWork.current = interruptWork.current.catch(() => undefined).then(() => request({ action: 'interrupt', sessionId: current.sessionId })).then(async result => {
      if (viewRef.current?.sessionId !== current.sessionId || viewRef.current.revision > result.revision) return;
      // An ACK can finish on the server just as its client request is cancelled.
      // Resume that confirmed composition, not an older local receipt projection.
      const authoritative = visitorTaskViewSchema.parse(result.view);
      // Completion cleanup can rebuild the same receipt without its transient
      // clarification/focus. Preserve that displayed content only on an exact
      // identity match; a late ACK for a different view still uses server state.
      const preserved = preserveConfirmed ? reconcileVisitorTaskCheckpoint(current, visitorTaskCheckpoint(authoritative)) : null;
      const restored = preserved ?? authoritative;
      if (preserved && historical.current === current) historical.current = restored;
      viewRef.current = restored; confirmed.current = restored; setView(restored);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (activeRef.current && openRef.current && viewRef.current === restored && restored !== historical.current) await acceptViewport(restored);
    }).catch(() => undefined);
  }, [request, pauseViewport, acceptViewport]);
  const settle = useCallback((refresh = true) => {
    // Hover, keyboard focus and activation may arrive together. Share only
    // in-flight synchronization of the same view/generation, never a cached result.
    const existing = settlement.current;
    if (existing?.refresh === refresh && existing.generation === generation.current && existing.view === viewRef.current) return existing.work;
    const version = generation.current;
    const work = (async () => {
      await interruptWork.current;
      if (version !== generation.current) throw new Error('The view changed while preparing the request.');
      if (slug && !viewRef.current) {
        const initial = await initialize();
        if (version !== generation.current) throw new Error('The view changed while preparing the request.');
        viewRef.current = initial; confirmed.current ??= initial; setView(initial);
      }
      await settleViewport();
      if (version !== generation.current) throw new Error('The view changed while preparing the request.');
      const current = viewRef.current;
      if (refresh && slug && current?.active) {
        const refreshed = await request({ action: 'refresh', sessionId: current.sessionId });
        // A stale warm-up must not pause observations of a newer manual view.
        if (version !== generation.current || current !== viewRef.current) throw new Error('The view changed while preparing the request.');
        const fresh = visitorTaskViewSchema.parse(refreshed.view);
        if (fresh.generation !== current.generation) { pauseViewport(); throw new Error('The task generation changed; restore the visible result before continuing.'); }
      }
    })();
    const entry = { refresh, generation: version, view: viewRef.current, work };
    settlement.current = entry;
    const release = () => { if (settlement.current === entry) settlement.current = null; };
    void work.then(release, release);
    return work;
  }, [initialize, slug, settleViewport, request, pauseViewport]);
  const controls: TaskControls = useMemo(() => ({ snapshot: () => confirmed.current, restore: async (bookmark, visible, signal) => {
    pauseViewport(); generation.current++; pending.current?.abort();
    const version = generation.current;
    await interruptWork.current;
    // Interrupt may have resumed observations of the departing view.
    pauseViewport();
    if (signal?.aborted || generation.current !== version) return 'cancelled';
    const current = viewRef.current; if (!current) return 'applied';
    try {
      let result;
      try {
        result = await request({ action: 'restore', sessionId: current.sessionId, bookmark, generation: current.generation }, signal);
      } catch (error) {
        // Usually the acknowledged generation is already current. Only this
        // pre-write rejection needs a fresh read: an undisplayed voice turn can
        // advance it. One bounded restoration retry; never repeat a paid task.
        if (!(error instanceof Error) || !('status' in error) || error.status !== 409 || error.message !== 'A newer request replaced this restoration.') throw error;
        if (signal?.aborted || generation.current !== version) return 'cancelled';
        const fresh = await request({ action: 'refresh', sessionId: current.sessionId }, signal);
        if (signal?.aborted || generation.current !== version) return 'cancelled';
        const authoritative = visitorTaskViewSchema.parse(fresh.view);
        if (authoritative.sessionId !== current.sessionId || authoritative.generation < current.generation) return 'failed';
        result = await request({ action: 'restore', sessionId: current.sessionId, bookmark, generation: authoritative.generation }, signal);
      }
      if (signal?.aborted || generation.current !== version) return 'cancelled';
      const restored = visitorTaskViewSchema.parse(result.view);
      historical.current = restored;
      viewRef.current = restored; confirmed.current = restored; setView(restored);
      // The restored receipt is historical. A new query operation establishes a new scene.
      openRef.current = visible; setOpen(visible); setError(''); setBusy(false); return 'applied';
    } catch (error) { setError(error instanceof Error ? error.message : 'This saved result is no longer available.'); return 'failed'; }
  }, command: async (text, signal) => await execute('query.command', { text }, false, signal) as { handled: boolean; message?: string } | undefined, openOrdinal: async ordinal => {
    try {
      await settle(); const version = generation.current, current = viewRef.current;
      if (!current?.active) return;
      const visible = false;
      const position = ordinal;
      if (!position) { setError('Which item? Use a result number on this page or its name.'); return; }
      const records = await execute('reference.resolve', { ordinal: position, visible, resultSetId: current.result.resultSetId, ...(visible ? { sceneRevision: scene.current } : {}) }, false, undefined, false) as { id: string }[] | undefined;
      if (records?.length === 1 && version === generation.current) await execute('record.detail', { recordId: records[0].id }, false);
    } catch { setError('Which item? Bring the results into view or use its name.'); }
  }, setPending: setConversationPending, reset: async signal => await execute('view.reset', {}, !signal, signal) ? 'applied' : signal?.aborted ? 'cancelled' : 'failed', settle, current: () => viewRef.current ? { sessionId: viewRef.current.sessionId, revision: viewRef.current.revision, generation: viewRef.current.generation } : undefined,
    completion: signal => captureVisitorTaskCompletion({ signal, pause: pauseViewport,
      current: () => ({ interaction: generation.current, view: viewRef.current, confirmed: confirmed.current }),
      accept: async (next, nextConfirmed) => {
        if (historical.current === confirmed.current) historical.current = nextConfirmed;
        viewRef.current = next; confirmed.current = nextConfirmed; setView(next);
        if (activeRef.current && openRef.current && nextConfirmed !== historical.current) await acceptViewport(nextConfirmed);
      }, interrupt: async () => { interrupt(true); await interruptWork.current; },
    }), show, interrupt, hide: () => {
      generation.current++; pending.current?.abort(); openRef.current = false; setOpen(false); setBusy(false); setError(''); pauseViewport();
    }, home: async signal => {
      if (signal?.aborted) return 'cancelled';
      generation.current++; pending.current?.abort(); openRef.current = false; setOpen(false); pauseViewport();
      if (!viewRef.current) return 'applied';
      return await execute('home', {}, false, signal) ? 'applied' : signal?.aborted ? 'cancelled' : 'failed';
    }, back: signal => {
      const current = viewRef.current;
      if (!openRef.current || !current) return;
      return execute('view.back', { target: 'results' }, false, signal).then(data => data ? 'applied' : signal?.aborted ? 'cancelled' : 'failed');
    } }), [execute, interrupt, show, settle, pauseViewport, request, acceptViewport]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (!homeRef) return; homeRef.current = controls.home; return () => { homeRef.current = null; }; }, [homeRef, controls]);
  function patch(operations: QueryPatch['operations']) { if (view) void execute('query.patch', { queryId: view.query.queryId, baseRevision: view.query.revision, operations }); }
  // A retained composition renders controls and content from its own confirmed
  // snapshot. Its caller binds actions to that same snapshot before execution.
  function render(view: VisitorTaskView | null, execute: TaskExecute) {
    const header = <>
      {busy && !conversationPending && <p aria-live="polite">Updating results…</p>}
      {error && <p role="alert">{error} <button type="button" onClick={() => { if (view) void execute('query.activate', { queryId: view.query.queryId }); }}>Try again</button></p>}
      {!view && <button type="button" className="platform-website-text-link" onClick={() => void execute('query.create', {})}>Explore published items</button>}
      {view && <>
          {view.clarification && <aside aria-label="Task clarification"><p>{view.clarification.question}</p>{view.clarification.options.length > 0 && <ul>{view.clarification.options.map(option => <li key={option}>{option}</li>)}</ul>}<p>Tell me what you would like to change in chat or voice.</p></aside>}
          {view.focus !== 'estimate' && (view.business.estimate as { lines?: unknown[] } | undefined)?.lines?.length ? <button type="button" className="platform-website-text-link" disabled={busy} onClick={() => void execute('estimate.show', {})}>View estimate</button> : null}
          {!view.records.length && <p>No published items match yet. Ask me to remove a constraint, try a broader search, or show everything again.</p>}
          {!!view.links?.length && <nav aria-label="Reviewed publisher links">{view.links.map(link => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => { interrupt(); onInteraction(); }}>{link.label}</a>)}</nav>}
      </>}
    </>;
    const foreground = view && <>
          {view.estimate && <PublishedEstimateView estimate={view.estimate} busy={busy} historical={view.estimate.revision !== (viewRef.current?.business.estimate as { revision?: number } | undefined)?.revision}/>}
          {view.comparison && <TaskComparison comparison={view.comparison}/>}
          <AnimatePresence initial={false} mode="wait">{view.detail && <motion.section key={view.detail.record.id} aria-label="Record detail" data-task-record={view.detail.record.id} initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0, overflow: 'hidden' }} transition={{ duration: reduced ? 0 : .22, ease: [.22, 1, .36, 1] }}>
            <h3>{view.detail.record.name}</h3>
            {view.detail.record.media && <figure><MediaImage assetId={view.detail.record.media.assetId} size="display" fit="contain" interactive={false}/>{view.detail.record.media.role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}
            {!view.detail.record.blocks.length && view.detail.record.summary && <p className="platform-website-detail-intro">{view.detail.record.summary}</p>}
            {view.detail.record.blocks.map(block => block.kind === 'heading' ? <h4 key={block.id}>{block.text}</h4> : <p key={block.id}>{block.text}</p>)}
            {!!view.detail.values.length && <dl>{view.detail.values.map(field => <div key={field.fieldId}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}</dl>}
            {view.detail.nextBlockOffset != null && <button className="button secondary" onClick={() => void execute('record.detail', { recordId: view.detail!.record.id, blockOffset: view.detail!.nextBlockOffset, fieldOffset: view.detail!.fieldOffset ?? 0 })}>Continue reading</button>}
            {view.detail.nextFieldOffset != null && <button className="button secondary" onClick={() => void execute('record.detail', { recordId: view.detail!.record.id, blockOffset: view.detail!.blockOffset ?? 0, fieldOffset: view.detail!.nextFieldOffset })}>More published details</button>}
          </motion.section>}</AnimatePresence>
    </>;
    const after = view && <>
          {!view.detail && !view.comparison && (!view.focus || ['query', 'records', 'clarification', 'links'].includes(view.focus)) && Object.values(view.result.exclusions).some(count => count > 0) && <p className="platform-website-query-note" aria-label="Records needing information">{Object.values(view.result.exclusions).reduce((sum, count) => sum + count, 0)} {Object.values(view.result.exclusions).reduce((sum, count) => sum + count, 0) === 1 ? 'item lacks' : 'items lack'} confirmed information for these filters.</p>}
          {!view.detail && !view.comparison && (view.result.items[0]?.ordinal ?? 1) > 1 && <button type="button" className="button secondary" disabled={busy} onClick={() => void execute('view.back', {})}>Previous page</button>}
          {!view.detail && !view.comparison && view.result.nextCursor && <button type="button" className="button secondary" disabled={busy} onClick={() => void execute('query.page', { cursor: view.result.nextCursor })}>Next page</button>}
          {!!view.selectedRecords.length && <aside aria-label="Selection tray"><h3>{view.selectedRecords.length} selected</h3>{view.selectedRecords.map(record => <span key={record.id}>{record.name} </span>)}<button type="button" className="button secondary" disabled={view.selectedRecords.length < 2 || view.selectedRecords.length > 6} onClick={() => void execute('selection.compare', {})}>Compare selection</button></aside>}
          {!!view.selectedRecords.length && <div aria-label="Compose an artifact">{(['brief', 'reading-list', 'itinerary'] as const).map(kind => <button className="button secondary" key={kind} disabled={busy || view.selectedRecords.length > 24} onClick={() => void execute('artifact.compose', { kind, title: kind === 'brief' ? 'Project brief' : kind === 'reading-list' ? 'Reading list' : 'Itinerary' })}>Create {kind}</button>)}</div>}
          {(view.artifactSummaries?.length ?? 0) > 1 && <label>Open artifact<select value={(view.artifacts[0] as { id: string } | undefined)?.id ?? ''} onChange={event => void execute('artifact.open', { id: event.target.value })}>{view.artifactSummaries?.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title}{artifact.saved ? ' · saved' : ''}</option>)}</select></label>}
          <VisitorArtifacts artifacts={view.artifacts} busy={busy} run={(capability, input) => void execute(capability, input)} exportArtifact={id => { void execute('artifact.export', { id }).then(result => { if (!result) return; const exported = result as { filename: string; markdown: string }, url = URL.createObjectURL(new Blob([exported.markdown], { type: 'text/markdown' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = exported.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }}/>
          {view.demoActions && <ActionReview business={view.business} selected={view.selectedRecords} busy={busy} run={(capability, input) => void execute(capability, input)}/>}

          {view.research && <TaskResearch key={view.research.id} result={view.research} onInteraction={() => { interrupt(); onInteraction(); }}/> }
          {view.map && <section aria-label="Evidence map"><h3>{view.map.label}</h3><p>Approximate map area; this is not a precise property boundary or navigation instruction.</p>{view.map.demo ? <p>Synthetic map preview · {view.map.latitude}, {view.map.longitude}</p> : <iframe title={`Approximate map of ${view.map.label}`} src={mapEmbedUrl({ label: view.map.label, latitude: view.map.latitude, longitude: view.map.longitude, zoom: view.map.zoom })} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts"/>}{view.map.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>)}</section>}
    </>;
    return { header, foreground, after };
  }
  return <TaskContext.Provider value={controls}><WebsiteTaskContext.Provider value={{ attachRoot, error, available: !!slug, view: open ? view : null, busy: busy || conversationPending, root, render, execute, patch }}>{children}</WebsiteTaskContext.Provider></TaskContext.Provider>;
}
