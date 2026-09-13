'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { expressionNodes, type Expression, type QueryPatch } from '@thevoice/platform-ui/query';
import { QueryCollection, TaskProgress, VisitorArtifacts, ActionReview, TaskResearch } from '@thevoice/platform-ui/task-components';
import { MediaImage } from '@thevoice/platform-ui';
import { mapEmbedUrl } from '@/lib/explore-model';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { workspaceElementVisible } from '@/lib/workspace-screen';
import { useTaskViewport } from '@/lib/use-task-viewport';
import { diagnosticError, visitorDiagnostic, visitorDiagnosticTimer } from '@/lib/visitor-diagnostics';

type DisplayStatus = 'applied' | 'cancelled' | 'failed';
type TaskControls = { settle: () => Promise<void>; current: () => { sessionId: string; revision: number; generation: number } | undefined; show: (view: VisitorTaskView, signal?: AbortSignal) => Promise<'applied' | 'cancelled' | 'failed'>; interrupt: () => void; hide: () => void; home: (signal?: AbortSignal) => Promise<DisplayStatus>; back: (signal?: AbortSignal) => Promise<DisplayStatus> | undefined };
const conditionLabels: Record<string, string> = { eq: 'is', contains: 'includes', lt: 'is below', lte: 'is at most', gt: 'is above', gte: 'is at least', any: 'includes any of', all: 'includes all of' };
const TaskContext = createContext<TaskControls | null>(null);
export const useVisitorTasks = () => useContext(TaskContext);
export function VisitorTasksProvider({ slug, children, onInteraction, homeRef, beforeShow }: { beforeShow?: (view: VisitorTaskView, signal?: AbortSignal) => Promise<DisplayStatus>; slug?: string; children: ReactNode; onInteraction: () => void; homeRef?: { current: (() => void) | null } }) {
  const [view, setView] = useState<VisitorTaskView | null>(null), viewRef = useRef(view), root = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const beforeShowRef = useRef(beforeShow), openRef = useRef(false);
  useLayoutEffect(() => { beforeShowRef.current = beforeShow; }, [beforeShow]);
  const ownInteraction = useRef(false), interruptWork = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef<AbortController | null>(null), generation = useRef(0), scene = useRef(0), reduced = useReducedMotion();
  const [editingNode, setEditingNode] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState(''), [operator, setOperator] = useState('eq'), [value, setValue] = useState('');
  const request = useCallback(async (input: unknown, signal?: AbortSignal) => {
    if (!slug) throw new Error('Publish to use shared visitor tasks.');
    const diagnostic = input && typeof input === 'object' && 'action' in input && input.action === 'init'
      ? { traceId: crypto.randomUUID(), channel: 'browser' as const, stage: 'context' as const, operation: 'workspace' as const } : null;
    const elapsed = visitorDiagnosticTimer();
    if (diagnostic) visitorDiagnostic({ ...diagnostic, status: 'started' });
    try {
      const response = await fetch(`/api/visitor/${encodeURIComponent(slug)}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal });
      const result = await response.json();
      if (!response.ok) throw Object.assign(new Error(result.error ?? 'The task could not finish.'), { status: response.status });
      if (diagnostic) visitorDiagnostic({ ...diagnostic, status: 'succeeded', durationMs: elapsed() });
      return result;
    } catch (error) {
      if (diagnostic) { const details = diagnosticError(error); visitorDiagnostic({ ...diagnostic, ...details, ...(details.httpStatus === 400 ? { reason: 'schema' as const } : {}), status: signal?.aborted ? 'cancelled' : 'failed', durationMs: elapsed() }); }
      throw error;
    }
  }, [slug]);
  const nextSceneRevision = useCallback(() => ++scene.current, []);
  const { pause: pauseViewport, accept: acceptViewport, settle: settleViewport } = useTaskViewport(root, open, nextSceneRevision, request);
  const show = useCallback(async (next: VisitorTaskView, signal?: AbortSignal): Promise<'applied' | 'cancelled' | 'failed'> => {
    const version = generation.current;
    if (signal?.aborted || viewRef.current && (viewRef.current.sessionId !== next.sessionId || viewRef.current.revision > next.revision || viewRef.current.generation > next.generation)) return 'cancelled';
    pauseViewport();
    const prepared = await beforeShowRef.current?.(next, signal) ?? 'applied';
    if (signal?.aborted || generation.current !== version || viewRef.current && (viewRef.current.revision > next.revision || viewRef.current.generation > next.generation)) return 'cancelled';
    if (prepared !== 'applied') return prepared;
    viewRef.current = next; setView(next); openRef.current = next.active; setOpen(next.active); setBusy(false);
    if (!next.operationId) return 'applied';
    const surface = () => {
      const selectors: Record<NonNullable<VisitorTaskView['focus']>, string> = { query: '[role="status"]', quote: '[aria-label="Synthetic quote review"]', booking: '[aria-label="Synthetic booking review"]', receipt: '.platform-action-review [role="status"]', cart: '[aria-label="Synthetic cart"]', slots: '[aria-label="Synthetic appointments"]', records: '[aria-label="Retrieved records"]', links: '[aria-label="Reviewed publisher links"]', comparison: '[aria-label="Selection comparison"]', detail: '[aria-label="Record detail"]', research: '[aria-label="Search results"]', map: '[aria-label="Evidence map"]', artifact: '.platform-task-artifact', business: '.platform-action-review', clarification: '[aria-label="Task clarification"]' };
      return next.focus ? root.current?.querySelector<HTMLElement>(selectors[next.focus]) : root.current;
    };
    // Observe committed result identity after React renders; the server verifies exact bindings.
    await new Promise<void>(resolve => {
      let frame = 0; const finish = () => { clearTimeout(timeout); cancelAnimationFrame(frame); signal?.removeEventListener('abort', finish); resolve(); };
      const timeout = setTimeout(finish, 1500); signal?.addEventListener('abort', finish, { once: true });
      const tick = () => {
        if (signal?.aborted || version !== generation.current) return finish();
        const target = surface(), details = target?.closest('details'); if (details) details.open = true;
        const rect = target?.getBoundingClientRect();
        if (next.active && rect && (rect.top >= innerHeight || rect.bottom <= 0 || next.focus && rect.top < 0)) target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        if (next.active ? target && root.current?.dataset.resultSet === next.result.resultSetId && workspaceElementVisible(target) : !root.current) return finish();
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(tick); });
    });
    if (signal?.aborted || document.visibilityState !== 'visible' || generation.current !== version || next.active && root.current?.dataset.resultSet !== next.result.resultSetId) return 'cancelled';
    const target = surface();
    if (next.active && next.focus && (!target || !workspaceElementVisible(target))) return 'failed';
    if (!next.active && root.current) return 'failed';
    const recordSurface = !next.active ? null : next.focus && ['comparison', 'detail', 'records'].includes(next.focus) ? target : root.current;
    const recordIds = [...new Set([...(recordSurface ? [recordSurface] : []), ...recordSurface?.querySelectorAll<HTMLElement>('[data-task-record]') ?? []].filter(element => !!element.dataset.taskRecord && workspaceElementVisible(element)).map(element => element.dataset.taskRecord!))];
    try {
      const ack = await request({ action: 'ack', sessionId: next.sessionId, operationId: next.operationId, queryId: next.query.queryId, queryRevision: next.query.revision, resultSetId: next.result.resultSetId, sceneRevision: ++scene.current, recordIds }, signal);
      if (signal?.aborted || version !== generation.current) return 'cancelled';
      viewRef.current = { ...next, revision: ack.revision }; setView(viewRef.current);
      await acceptViewport(viewRef.current);
      return signal?.aborted || version !== generation.current ? 'cancelled' : 'applied';
    } catch { return signal?.aborted ? 'cancelled' : 'failed'; }
  }, [request, pauseViewport, acceptViewport]);
  const execute = useCallback(async (capabilityId: string, input: unknown, manual = true, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    pauseViewport();
    if (manual) { generation.current++; pending.current?.abort(); ownInteraction.current = true; onInteraction(); ownInteraction.current = false; }
    const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controller = new AbortController();
    const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
    pending.current = controller; const version = generation.current; setBusy(true); setError('');
    try {
      await interruptWork.current;
      let current = viewRef.current;
      if (!current) { const result = await request({ action: 'init' }, controller.signal); current = result.view as VisitorTaskView; viewRef.current = current; setView(current); }
      if (manual) {
        const interrupted = await request({ action: 'interrupt', sessionId: current.sessionId }, controller.signal);
        current = { ...current, revision: interrupted.revision, generation: interrupted.generation }; viewRef.current = current;
      } else {
        // Backend reads/model accounting can advance the session after its last
        // display. Refresh the revision before executing a voice Back or Home.
        const refreshed = await request({ action: 'refresh', sessionId: current.sessionId }, controller.signal);
        if (version !== generation.current || controller.signal.aborted || refreshed.view.generation !== current.generation) return;
        current = { ...current, revision: refreshed.view.revision }; viewRef.current = current;
      }
      if (capabilityId === 'query.create' && current.queries.length === 1 && !current.active) { capabilityId = 'query.activate'; input = { queryId: current.query.queryId }; }
      const result = await request({ action: 'execute', sessionId: current.sessionId, call: { operationId: crypto.randomUUID(), capabilityId, expectedRevision: current.revision, input } }, controller.signal);
      if (version !== generation.current || controller.signal.aborted) return;
      const status = await show(result.view, controller.signal);
      if (status === 'cancelled') return;
      if (status === 'failed') throw new Error('The requested view could not be confirmed.');
      if (version === generation.current && document.activeElement === document.body && priorFocus?.isConnected && !priorFocus.matches(':disabled')) priorFocus.focus({ preventScroll: true });
      return result.data as unknown;
    } catch (error) { if (!controller.signal.aborted && version === generation.current) setError(error instanceof Error ? error.message : 'Task unavailable.'); }
    finally { signal?.removeEventListener('abort', abort); if (pending.current === controller) pending.current = null; if (version === generation.current) setBusy(false); }
  }, [onInteraction, request, show, pauseViewport]);
  const interrupt = useCallback(() => {
    if (ownInteraction.current) return;
    pauseViewport(); generation.current++; pending.current?.abort(); setBusy(false);
    const current = viewRef.current;
    if (current) interruptWork.current = request({ action: 'interrupt', sessionId: current.sessionId }).then(result => { if (viewRef.current?.sessionId === current.sessionId) { viewRef.current = { ...viewRef.current, revision: result.revision, generation: result.generation }; setView(viewRef.current); } }).catch(() => undefined);
  }, [request, pauseViewport]);
  const settle = useCallback(async () => {
    await interruptWork.current;
    if (slug && !viewRef.current) { const result = await request({ action: 'init' }); viewRef.current = result.view; setView(result.view); }
    await settleViewport();
  }, [request, slug, settleViewport]);
  const controls: TaskControls = useMemo(() => ({ settle, current: () => viewRef.current ? { sessionId: viewRef.current.sessionId, revision: viewRef.current.revision, generation: viewRef.current.generation } : undefined,
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
      const capability = current.focus && current.focus !== 'query' ? 'query.activate' : 'home';
      return execute(capability, capability === 'home' ? {} : { queryId: current.query.queryId }, false, signal).then(data => data ? 'applied' : signal?.aborted ? 'cancelled' : 'failed');
    } }), [execute, interrupt, show, settle, pauseViewport]);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => { if (!homeRef) return; homeRef.current = controls.home; return () => { homeRef.current = null; }; }, [homeRef, controls]);
  function patch(operations: QueryPatch['operations']) { if (view) void execute('query.patch', { queryId: view.query.queryId, baseRevision: view.query.revision, operations }); }
  function criterion() {
    const node = view && expressionNodes(view.query.where).find(node => node.id === editingNode);
    const field = view?.fields.find(field => field.id === (fieldId || view.fields[0]?.id)); if (!field) return;
    if (operator === 'unknown') { const expression: Expression = { kind: 'state', id: node?.id ?? crypto.randomUUID(), fieldId: field.id, state: 'unknown' };
      patch([node ? { op: 'replaceConstraint', nodeId: node.id, expression } : view!.query.where.kind === 'all' ? { op: 'addConstraint', parentId: view!.query.where.id, expression } : { op: 'replaceConstraint', nodeId: view!.query.where.id, expression: { kind: 'all', id: crypto.randomUUID(), children: [view!.query.where, expression] } }]); setEditingNode(null); return; }
    const raw = field.type === 'number' || field.type === 'money' ? Number(value) : field.type === 'boolean' ? value === 'true' : value;
    const expression: Expression = { kind: 'field', id: node?.id ?? crypto.randomUUID(), fieldId: field.id, op: operator as 'eq', value: { type: field.type, value: ['any', 'all'].includes(operator) ? value.split(',').map(value => value.trim()).filter(Boolean).map(value => field.type === 'number' || field.type === 'money' ? Number(value) : field.type === 'boolean' ? value === 'true' : value) : raw,
      ...(field.unit ? { unit: field.unit } : {}), ...(field.currency ? { currency: field.currency } : {}), ...(field.basis ? { basis: field.basis } : {}) } };
    patch([node ? { op: 'replaceConstraint', nodeId: node.id, expression } : view!.query.where.kind === 'all' ? { op: 'addConstraint', parentId: view!.query.where.id, expression } : { op: 'replaceConstraint', nodeId: view!.query.where.id, expression: { kind: 'all', id: crypto.randomUUID(), children: [view!.query.where, expression] } }]); setEditingNode(null);
  }
  const selectedField = view?.fields.find(field => field.id === fieldId) ?? view?.fields[0];
  return <TaskContext.Provider value={controls}>{children}{slug && <section className="platform-task-browser" aria-label="Visitor collections and tasks">
    <button className="button secondary" type="button" onClick={() => { setOpen(true); if (!viewRef.current) void execute('query.create', {}); else void execute('query.activate', { queryId: viewRef.current.query.queryId }); }}>Browse and filter collections</button>
    <AnimatePresence initial={false}>{open && <motion.section ref={root} className="platform-query-surface" aria-label="Collection results" aria-busy={busy} data-result-set={view?.result.resultSetId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18 }}>
      <TaskProgress busy={busy} label={view ? `${view.result.count.value} matching records` : 'Loading collection…'}/>
      {view && <>
        {view.clarification && <aside aria-label="Task clarification"><p>{view.clarification.question}</p>{view.clarification.options.length > 0 && <ul>{view.clarification.options.map(option => <li key={option}>{option}</li>)}</ul>}<p>Reply in chat or voice, or adjust the filters directly.</p></aside>}
        <nav aria-label="Collection breadcrumbs">{view.breadcrumbs.map((crumb, i) => <button type="button" className="text-button" key={crumb.id} onClick={() => patch([{ op: 'setScope', scope: { collectionId: crumb.id, traversal: view.query.scope.traversal === 'direct' ? 'direct' : 'descendants', path: view.query.scope.path.slice(0, i + 1) } }])}>{crumb.name}{i < view.breadcrumbs.length - 1 ? ' / ' : ''}</button>)}</nav>
        <h2>{view.collection.name}</h2><p>{view.collection.introduction}</p>
        <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); patch([{ op: 'setSearch', text: String(data.get('search') ?? '') }]); }}><label>Search published records<input name="search" key={`${view.query.queryId}:${view.query.searchText}`} defaultValue={view.query.searchText} maxLength={500}/></label><button className="button secondary" disabled={busy}>Search this collection</button></form>
        <div className="platform-query-children">{view.children.map(child => <button className="button secondary" key={child.id} onClick={() => patch([{ op: 'setScope', scope: { collectionId: child.id, traversal: 'descendants', path: [...view.query.scope.path, child.id] } }])}>{child.name}</button>)}</div>
        {(!!view.omittedChildren || (view.browse?.children ?? 0) > 0) && <div><button disabled={!view.browse?.children || busy} onClick={() => void execute('collection.page', { ...view.browse, children: Math.max(0, (view.browse?.children ?? 0) - 24), fields: view.browse?.fields ?? 0 })}>Previous collections</button><button disabled={!view.omittedChildren || busy} onClick={() => void execute('collection.page', { children: (view.browse?.children ?? 0) + 24, fields: view.browse?.fields ?? 0 })}>More collections</button></div>}
        <label><input type="checkbox" checked={view.query.scope.traversal !== 'direct'} onChange={event => patch([{ op: 'setScope', scope: { ...view.query.scope, traversal: event.target.checked ? 'descendants' : 'direct', include: undefined } }])}/>Including subcollections</label>
        {view.queries.length > 1 && <label>Open query<select value={view.query.queryId} onChange={event => void execute('query.activate', { queryId: event.target.value })}>{view.queries.map((query, i) => <option key={query.id} value={query.id}>{query.label} · {i + 1}</option>)}</select></label>}
        <div className="platform-criteria-chips" aria-label="Active criteria">{expressionNodes(view.query.where).filter(node => node.kind === 'field' || node.kind === 'state').map(node => <span className="platform-criteria-chip" key={node.id}>
          {'fieldId' in node && (view.fields.find(field => field.id === node.fieldId)?.label ?? node.fieldId)} {'value' in node ? `${conditionLabels[node.op] ?? node.op} ${Array.isArray(node.value.value) ? node.value.value.join(', ') : typeof node.value.value === 'object' ? JSON.stringify(node.value.value) : String(node.value.value)}` : 'state' in node ? node.state : ''}
          <button type="button" aria-label={`Edit criterion ${node.fieldId}`} onClick={() => { setEditingNode(node.id); setFieldId(node.fieldId); setOperator(node.kind === 'state' ? 'unknown' : node.op); setValue(node.kind === 'field' ? Array.isArray(node.value.value) ? node.value.value.join(', ') : String(node.value.value) : ''); const filters = root.current?.querySelector<HTMLDetailsElement>('.platform-query-filters'); if (filters) { filters.open = true; filters.querySelector<HTMLElement>('select')?.focus(); } }}>Edit</button>
          <button type="button" aria-label={`Remove criterion ${node.fieldId}`} onClick={() => patch([{ op: 'removeConstraint', nodeId: node.id }])}>×</button>
        </span>)}</div>
        <details className="platform-query-filters"><summary>Edit filters and sorting</summary>
          <form onSubmit={event => { event.preventDefault(); criterion(); }}><label>Field<select aria-label="Field" value={selectedField?.id ?? ''} onChange={event => { setFieldId(event.target.value); setOperator('eq'); }}>{view.fields.filter(field => field.filter).map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
            <label>Condition<select aria-label="Condition" value={operator} onChange={event => setOperator(event.target.value)}>{selectedField?.operations.map(op => <option key={op} value={op}>{conditionLabels[op] ?? op}</option>)}<option value="unknown">Unknown / not published</option></select></label>
            <label>Value{selectedField?.type === 'boolean' ? <select value={value} onChange={event => setValue(event.target.value)}><option value="">Choose</option><option value="true">Yes</option><option value="false">No</option></select> : <input value={value} onChange={event => setValue(event.target.value)} placeholder={selectedField?.currency ?? selectedField?.unit ?? 'Published value'} />}</label>
            <button type="submit" className="button secondary" disabled={busy || !selectedField || !value && operator !== 'unknown'}>{editingNode ? 'Update criterion' : 'Add criterion'}</button>{editingNode && <button type="button" onClick={() => setEditingNode(null)}>Cancel criterion edit</button>}</form>
          <label>Sort<select aria-label="Sort" value={view.query.order[0] ? `${view.query.order[0].fieldId}:${view.query.order[0].direction}` : ''} onChange={event => { const index = event.target.value.lastIndexOf(':'); patch([{ op: 'setSort', order: event.target.value ? [{ fieldId: event.target.value.slice(0, index), direction: event.target.value.slice(index + 1) as 'asc' | 'desc' }] : [] }]); }}><option value="">Stable relevance order</option>{view.fields.filter(field => field.sort).flatMap(field => ['asc', 'desc'].map(direction => <option key={`${field.id}:${direction}`} value={`${field.id}:${direction}`}>{field.label} · {direction === 'asc' ? 'ascending' : 'descending'}</option>))}</select></label>
          {(!!view.omittedFields || (view.browse?.fields ?? 0) > 0) && <button className="text-button" disabled={busy} onClick={() => void execute('collection.page', { children: view.browse?.children ?? 0, fields: view.omittedFields ? (view.browse?.fields ?? 0) + 32 : 0 })}>{view.omittedFields ? 'More fields' : 'First fields'}</button>}
          <button type="button" className="text-button" onClick={() => void execute('query.close', { queryId: view.query.queryId })}>Close query</button>
          <button type="button" className="text-button" disabled={!view.canUndo} onClick={() => patch([{ op: 'undo' }])}>Undo criteria</button><button type="button" className="text-button" onClick={() => patch([{ op: 'fork' }])}>Fork query</button>
        </details>
        {!!view.omittedChildren && <p>{view.omittedChildren} additional collections. Use More collections to keep browsing.</p>}
        <details><summary>Field coverage and facets</summary>{view.facets?.map(facet => <p key={facet.fieldId}>{view.fields.find(field => field.id === facet.fieldId)?.label}: {facet.values.map(value => `${value.value} (${value.count})`).join(', ')} · {facet.unknown} without a confirmed value{facet.coverage === 'partial' ? ' · additional values omitted' : ''}</p>)}</details>
        {Object.entries(view.result.exclusions).some(([, count]) => count > 0) && <p aria-label="Records needing information">Excluded from matches: {Object.entries(view.result.exclusions).map(([state, count]) => `${count} ${state}`).join(' · ')}. Choose Unknown to inspect incomplete records.</p>}
        {!!view.alternatives?.length && <div aria-label="Suggested refinements">{view.alternatives.map(alternative => <button className="text-button" key={alternative.removeNodeId} onClick={() => patch([{ op: 'removeConstraint', nodeId: alternative.removeNodeId }])}>Remove {(() => { const node = expressionNodes(view.query.where).find(node => node.id === alternative.removeNodeId); return node && 'fieldId' in node ? view.fields.find(field => field.id === node.fieldId)?.label ?? 'this criterion' : 'this criterion'; })()} to see {alternative.count}</button>)}</div>}
        {!view.records.length && <p>No records match all criteria. Edit a criterion to broaden the results; your filters remain in place.</p>}
        {!!view.links?.length && <nav aria-label="Reviewed publisher links">{view.links.map(link => <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => { interrupt(); onInteraction(); }}>{link.label}</a>)}</nav>}
        <QueryCollection records={view.records} selected={view.selection.members.map(member => member.recordId)} view={view.collection.view} busy={busy} onDetail={recordId => void execute('record.detail', { recordId })} onSelect={(recordId, selected) => void execute('selection.modify', { recordId, selected })}/>
        {view.result.nextCursor && <button type="button" className="button secondary" disabled={busy} onClick={() => void execute('query.page', { cursor: view.result.nextCursor })}>Next page</button>}
        {!!view.selectedRecords.length && <aside aria-label="Selection tray"><h3>{view.selectedRecords.length} selected</h3>{view.selectedRecords.map(record => <span key={record.id}>{record.name} </span>)}<button type="button" className="button secondary" disabled={view.selectedRecords.length < 2 || view.selectedRecords.length > 6} onClick={() => void execute('selection.compare', {})}>Compare selection</button></aside>}
        {!!view.selectedRecords.length && <div aria-label="Compose an artifact">{(['brief', 'reading-list', 'itinerary'] as const).map(kind => <button className="button secondary" key={kind} disabled={busy || view.selectedRecords.length > 24} onClick={() => void execute('artifact.compose', { kind, title: kind === 'brief' ? 'Project brief' : kind === 'reading-list' ? 'Reading list' : 'Itinerary' })}>Create {kind}</button>)}</div>}
        {(view.artifactSummaries?.length ?? 0) > 1 && <label>Open artifact<select value={(view.artifacts[0] as { id: string } | undefined)?.id ?? ''} onChange={event => void execute('artifact.open', { id: event.target.value })}>{view.artifactSummaries?.map(artifact => <option key={artifact.id} value={artifact.id}>{artifact.title}{artifact.saved ? ' · saved' : ''}</option>)}</select></label>}
        <VisitorArtifacts artifacts={view.artifacts} busy={busy} run={(capability, input) => void execute(capability, input)} exportArtifact={id => { void execute('artifact.export', { id }).then(result => { if (!result) return; const exported = result as { filename: string; markdown: string }, url = URL.createObjectURL(new Blob([exported.markdown], { type: 'text/markdown' })), anchor = document.createElement('a'); anchor.href = url; anchor.download = exported.filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }}/>
        {view.demoActions && <ActionReview business={view.business} selected={view.selectedRecords} busy={busy} run={(capability, input) => void execute(capability, input)}/>}
        {view.lookupRecords && <section aria-label="Retrieved records"><h3>Retrieved records</h3>{view.lookupRecords.map(record => <p key={record.id} data-task-record={record.id}><button className="text-button" onClick={() => void execute('record.detail', { recordId: record.id })}>{record.name}</button> {record.summary}</p>)}</section>}
        {view.research && <TaskResearch key={view.research.id} result={view.research} onInteraction={() => { interrupt(); onInteraction(); }}/> }
        {view.map && <section aria-label="Evidence map"><h3>{view.map.label}</h3><p>Approximate map area; this is not a precise property boundary or navigation instruction.</p>{view.map.demo ? <p>Synthetic map preview · {view.map.latitude}, {view.map.longitude}</p> : <iframe title={`Approximate map of ${view.map.label}`} src={mapEmbedUrl({ label: view.map.label, latitude: view.map.latitude, longitude: view.map.longitude, zoom: view.map.zoom })} loading="lazy" referrerPolicy="no-referrer" sandbox="allow-scripts"/>}{view.map.sources.map(source => <p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></p>)}</section>}
        {view.comparison && <section aria-label="Selection comparison"><h3>Comparison</h3><div className="platform-query-table"><table><thead><tr><th>Record</th>{view.comparison.fields.map(field => <th key={field.id}>{field.label}</th>)}</tr></thead><tbody>{view.comparison.rows.map(row => <tr key={row.id} data-task-record={row.id}><th>{row.name}</th>{row.values.map(field => <td key={field.fieldId}>{field.text}</td>)}</tr>)}</tbody></table></div></section>}
        {view.detail && <section aria-label="Record detail" data-task-record={view.detail.record.id}><h3>{view.detail.record.name}</h3>{view.detail.record.media && <figure><MediaImage assetId={view.detail.record.media.assetId}/>{view.detail.record.media.role === 'example' && <figcaption>Illustrative example</figcaption>}</figure>}{view.detail.record.blocks.map(block => <p key={block.id}>{block.text}</p>)}<dl>{view.detail.values.map(field => <div key={field.fieldId}><dt>{field.label}</dt><dd>{field.text}</dd></div>)}</dl>{view.detail.nextBlockOffset != null && <button className="button secondary" onClick={() => void execute('record.detail', { recordId: view.detail!.record.id, blockOffset: view.detail!.nextBlockOffset, fieldOffset: view.detail!.fieldOffset ?? 0 })}>More detail blocks</button>}{view.detail.nextFieldOffset != null && <button className="button secondary" onClick={() => void execute('record.detail', { recordId: view.detail!.record.id, blockOffset: view.detail!.blockOffset ?? 0, fieldOffset: view.detail!.nextFieldOffset })}>More record fields</button>}</section>}
      </>}
    </motion.section>}</AnimatePresence>{error && <p role="alert">{error} <button type="button" onClick={() => { const current = viewRef.current; if (current) void request({ action: 'refresh', sessionId: current.sessionId }).then(result => show(result.view)).catch(() => setError('Reload the page to start a fresh session.')); }}>Reload results</button></p>}
  </section>}</TaskContext.Provider>;
}
