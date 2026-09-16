'use client';
import { recordedVisitorFetch } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode, type RefObject } from 'react';
import { type Expression, type QueryPatch } from '@thevoice/platform-ui/query';
import { TaskProgress, VisitorArtifacts, ActionReview, TaskResearch } from '@thevoice/platform-ui/task-components';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MediaImage } from '@thevoice/platform-ui';
import { mapEmbedUrl } from '@/lib/explore-model';
import { visitorTaskViewSchema, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { workspaceElementVisible } from '@/lib/workspace-screen';
import { useTaskViewport } from '@/lib/use-task-viewport';
import { diagnosticError, visitorDiagnostic, visitorDiagnosticTimer } from '@/lib/visitor-diagnostics';

type DisplayStatus = 'applied' | 'cancelled' | 'failed';
type TaskControls = { command: (text: string, signal: AbortSignal) => Promise<{ handled: boolean; message?: string } | undefined>; openOrdinal: (ordinal: number) => Promise<void>; setPending: (value: boolean) => void; reset: (signal?: AbortSignal) => Promise<DisplayStatus>; settle: () => Promise<void>; current: () => { sessionId: string; revision: number; generation: number } | undefined; show: (view: VisitorTaskView, signal?: AbortSignal, onVisible?: () => void) => Promise<'applied' | 'cancelled' | 'failed'>; interrupt: () => void; hide: () => void; home: (signal?: AbortSignal) => Promise<DisplayStatus>; back: (signal?: AbortSignal) => Promise<DisplayStatus> | undefined };
const conditionLabels: Record<string, string> = { eq: 'is', contains: 'includes', lt: 'is below', lte: 'is at most', gt: 'is above', gte: 'is at least', any: 'includes any of', all: 'includes all of' };
type WebsiteTaskState = { error: string; available: boolean; view: VisitorTaskView | null; busy: boolean; root: RefObject<HTMLElement | null>; header: ReactNode; foreground: ReactNode; after: ReactNode; execute: (capabilityId: string, input: unknown, manual?: boolean, signal?: AbortSignal) => Promise<unknown>; patch: (operations: QueryPatch['operations']) => void };
const WebsiteTaskContext = createContext<WebsiteTaskState | null>(null);
export const useWebsiteTasks = () => useContext(WebsiteTaskContext);
const TaskContext = createContext<TaskControls | null>(null);
export const useVisitorTasks = () => useContext(TaskContext);
export function VisitorTasksProvider({ slug, children, onInteraction, homeRef, beforeShow, active = true }: { active?: boolean; beforeShow?: (view: VisitorTaskView, signal?: AbortSignal) => Promise<DisplayStatus>; slug?: string; children: ReactNode; onInteraction: () => void; homeRef?: { current: (() => void) | null } }) {
  const [view, setView] = useState<VisitorTaskView | null>(null), viewRef = useRef(view), root = useRef<HTMLElement>(null);
  const [conversationPending, setConversationPending] = useState(false);
  const returnRecord = useRef<string | null>(null);
  const confirmed = useRef<VisitorTaskView | null>(null);
  const initialization = useRef<Promise<VisitorTaskView> | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const beforeShowRef = useRef(beforeShow), openRef = useRef(false);
  const activeRef = useRef(active);
  useLayoutEffect(() => { activeRef.current = active; }, [active]);
  useLayoutEffect(() => { beforeShowRef.current = beforeShow; }, [beforeShow]);
  const ownInteraction = useRef(false), interruptWork = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<AbortController | null>(null), generation = useRef(0), scene = useRef(0);
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
  const nextSceneRevision = useCallback(() => ++scene.current, []);
  const { pause: pauseViewport, accept: acceptViewport, settle: settleViewport, recordIds: viewportRecordIds } = useTaskViewport(root, open && active, nextSceneRevision, request);
  useEffect(() => { if (!active) pauseViewport(); else if (openRef.current && confirmed.current) void acceptViewport(confirmed.current).catch(() => undefined); }, [active, pauseViewport, acceptViewport]);
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
      const selectors: Record<NonNullable<VisitorTaskView['focus']>, string> = { query: '[data-website-result-heading]', quote: '[aria-label="Synthetic quote review"]', booking: '[aria-label="Synthetic booking review"]', receipt: '.platform-action-review [role="status"]', cart: '[aria-label="Synthetic cart"]', slots: '[aria-label="Synthetic appointments"]', records: '[aria-label="Retrieved records"]', links: '[aria-label="Reviewed publisher links"]', comparison: '[aria-label="Selection comparison"]', detail: '[aria-label="Record detail"]', research: '[aria-label="Search results"]', map: '[aria-label="Evidence map"]', artifact: '.platform-task-artifact', business: '.platform-action-review', clarification: '[aria-label="Task clarification"]' };
      return next.focus ? root.current?.querySelector<HTMLElement>(selectors[next.focus]) : root.current;
    };
    // Observe committed result identity after React renders; the server verifies exact bindings.
    let settled = false;
    await new Promise<void>(resolve => {
      let stable = 0, position = '';
      let frame = 0; const finish = () => { clearTimeout(timeout); cancelAnimationFrame(frame); signal?.removeEventListener('abort', finish); resolve(); };
      const timeout = setTimeout(finish, 1500); signal?.addEventListener('abort', finish, { once: true });
      const tick = () => {
        if (signal?.aborted || version !== generation.current) return finish();
        root.current?.setAttribute('data-website-transition', 'pending');
        const target = root.current?.matches('[data-ai-carousel]') ? root.current : surface(), details = target?.closest('details'); if (details) details.open = true;
        const card = root.current?.matches('[data-ai-carousel]') ? root.current.querySelector<HTMLElement>('[data-carousel-card]') : target;
        const rect = card?.getBoundingClientRect();
        const nextPosition = rect ? `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.width)}:${Math.round(rect.height)}` : ''; stable = nextPosition === position ? stable + 1 : 0; position = nextPosition;
        if (!root.current?.matches('[data-ai-carousel]') && (next.active || next.navigation === 'reset') && rect && (rect.top >= innerHeight || rect.bottom <= 0 || next.focus && rect.top < 0)) target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (stable > 2 && (!card || Number(getComputedStyle(card).opacity) >= .99) && (next.active ? target && root.current?.dataset.resultSet === next.result.resultSetId && (!root.current?.matches('[data-ai-carousel]') || root.current.querySelector<HTMLElement>('[data-carousel-card]')?.dataset.carouselCard === root.current.dataset.activeCard) && workspaceElementVisible(target) : root.current?.dataset.resultSet !== next.result.resultSetId)) { settled = true; root.current?.setAttribute('data-website-transition', 'settled'); return finish(); }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(tick); });
    });
    if (signal?.aborted || document.visibilityState !== 'visible' || generation.current !== version || next.active && root.current?.dataset.resultSet !== next.result.resultSetId) return restore('cancelled');
    if (!settled) return restore('failed');
    const target = root.current?.matches('[data-ai-carousel]') ? root.current : surface();
    if (next.active && next.focus && (!target || !workspaceElementVisible(target))) return restore('failed');
    if (!next.active && root.current?.dataset.resultSet === next.result.resultSetId) return restore('failed');
    const recordIds = next.active ? viewportRecordIds() : [];
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
      if (manual) {
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
      const result = await request({ action: 'execute', sessionId: current.sessionId, call: { operationId: crypto.randomUUID(), capabilityId, expectedRevision: current.revision, input } }, controller.signal);
      if (version !== generation.current || controller.signal.aborted) return;
      if (result.handled === false) return { handled: false };
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
  }, [onInteraction, request, show, pauseViewport, initialize]);
  const interrupt = useCallback(() => {
    if (ownInteraction.current) return;
    pauseViewport(); generation.current++; pending.current?.abort(); setBusy(false);
    const current = confirmed.current ?? viewRef.current;
    if (current) { viewRef.current = current; setView(current); }
    if (current) interruptWork.current = interruptWork.current.catch(() => undefined).then(() => request({ action: 'interrupt', sessionId: current.sessionId })).then(async result => {
      if (viewRef.current?.sessionId !== current.sessionId || viewRef.current.revision > result.revision) return;
      // An ACK can finish on the server just as its client request is cancelled.
      // Resume that confirmed composition, not an older local receipt projection.
      const restored = visitorTaskViewSchema.parse(result.view);
      viewRef.current = restored; confirmed.current = restored; setView(restored);
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (activeRef.current && openRef.current && viewRef.current === restored) await acceptViewport(restored);
    }).catch(() => undefined);
  }, [request, pauseViewport, acceptViewport]);
  const settle = useCallback(async () => {
    await interruptWork.current;
    if (slug && !viewRef.current) { const initial = await initialize(); viewRef.current = initial; confirmed.current ??= initial; setView(initial); }
    await settleViewport();
  }, [initialize, slug, settleViewport]);
  const controls: TaskControls = useMemo(() => ({ command: async (text, signal) => await execute('query.command', { text }, false, signal) as { handled: boolean; message?: string } | undefined, openOrdinal: async ordinal => {
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
    show, interrupt, hide: () => {
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
    } }), [execute, interrupt, show, settle, pauseViewport]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (!homeRef) return; homeRef.current = controls.home; return () => { homeRef.current = null; }; }, [homeRef, controls]);
  function patch(operations: QueryPatch['operations']) { if (view) void execute('query.patch', { queryId: view.query.queryId, baseRevision: view.query.revision, operations }); }
  function criterionChips(node: Expression): ReactNode {
    if ('children' in node) return node.children.length ? <span className="platform-criteria-group" key={node.id}>{node.children.length > 1 && <span>{node.kind === 'any' ? 'Any of:' : 'All of:'}</span>}{node.children.map(criterionChips)}</span> : null;
    if (node.kind === 'not') return <span className="platform-criteria-group" key={node.id}>Except: {criterionChips(node.child)}</span>;
    if (node.kind === 'relation') return <span className="platform-criteria-group" key={node.id}>Related items: {criterionChips(node.target)}</span>;
    if (node.kind === 'search') return <span className="platform-criteria-chip" key={node.id}>Matching “{node.text}”</span>;
    if (!view || node.kind !== 'field' && node.kind !== 'state') return null;
    return <span className="platform-criteria-chip" key={node.id}>
          {'fieldId' in node && (view.fields.find(field => field.id === node.fieldId)?.label ?? node.fieldId)} {'value' in node ? `${conditionLabels[node.op] ?? node.op} ${Array.isArray(node.value.value) ? node.value.value.join(', ') : typeof node.value.value === 'object' ? JSON.stringify(node.value.value) : String(node.value.value)}` : 'state' in node ? node.state : ''}
        </span>;
  }
  const header = <>
    {(busy || conversationPending) && <p aria-live="polite">Updating your cards…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => { const current = viewRef.current; if (current) void execute('query.activate', { queryId: current.query.queryId }); }}>Try again</button></p>}
    {!view && <button type="button" className="platform-website-text-link" onClick={() => void execute('query.create', {})}>Explore published items</button>}
    {view && <>
      <div className="platform-website-filter-heading" data-website-result-heading tabIndex={-1}>
        <TaskProgress busy={false} label={`${view.result.count.value} matching ${view.result.count.value === 1 ? 'item' : 'items'}`}/>
        <button type="button" className="platform-website-text-link" onClick={() => void execute('view.reset', {})}>Show everything again</button>
      </div>

        {view.clarification && <aside aria-label="Task clarification"><p>{view.clarification.question}</p>{view.clarification.options.length > 0 && <ul>{view.clarification.options.map(option => <li key={option}>{option}</li>)}</ul>}<p>Tell me what you would like to change in chat or voice.</p></aside>}

        <div className="platform-criteria-chips" aria-label="Active criteria">
          {view.breadcrumbs.length > 1 && <span className="platform-criteria-chip">{view.breadcrumbs.slice(1).map(crumb => crumb.name).join(' / ')}</span>}
          {view.query.searchText && <span className="platform-criteria-chip">Matching “{view.query.searchText}”</span>}
          {criterionChips(view.query.where)}
          {view.query.order.map(term => <span className="platform-criteria-chip" key={term.fieldId}>{view.fields.find(field => field.id === term.fieldId)?.label ?? term.fieldId} · {term.direction === 'asc' ? 'Low to high' : 'High to low'}</span>)}
        </div>
        {Object.values(view.result.exclusions).some(count => count > 0) && <p className="platform-website-query-note" aria-label="Records needing information">{Object.values(view.result.exclusions).reduce((sum, count) => sum + count, 0)} {Object.values(view.result.exclusions).reduce((sum, count) => sum + count, 0) === 1 ? 'item lacks' : 'items lack'} confirmed information for these filters.</p>}
        {!view.records.length && <p>No published items match yet. Ask me to remove a constraint, try a broader search, or show everything again.</p>}
        {!!view.links?.length && <nav aria-label="Reviewed publisher links">{view.links.map(link => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => { interrupt(); onInteraction(); }}>{link.label}</a>)}</nav>}
    </>}
  </>;
  const foreground = view && <>
    {(view.detail || view.comparison) && <button type="button" className="platform-website-text-link" onClick={() => void execute('view.back', { target: 'results' })}>Back to results</button>}
        {view.comparison && <section aria-label="Selection comparison"><h3>Comparison</h3><div className="platform-query-table"><table><thead><tr><th>Record</th>{view.comparison.fields.map(field => <th key={field.id}>{field.label}</th>)}</tr></thead><tbody>{view.comparison.rows.map(row => <tr key={row.id} data-task-record={row.id}><th>{row.name}</th>{row.values.map(field => <td key={field.fieldId}>{field.text}</td>)}</tr>)}</tbody></table></div></section>}
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
  return <TaskContext.Provider value={controls}><WebsiteTaskContext.Provider value={{ error, available: !!slug, view: open ? view : null, busy: busy || conversationPending, root, header, foreground, after, execute, patch }}>{children}</WebsiteTaskContext.Provider></TaskContext.Provider>;
}
