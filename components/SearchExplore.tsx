'use client';
import { recordedVisitorFetch } from '@/lib/visitor-test-recording-client';
import { recordBrowserTestEvent } from '@/lib/visitor-test-events';
import { visitorDiagnostic } from '../lib/visitor-diagnostics';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ExternalSearchResults } from '@thevoice/platform-ui';
import { demoExploreResult, exploreContextForResult, exploreResultSchema, exploreSettings, localExploreCommand, type AnnotationTarget, type ExploreCommand, type ExploreContext, type ExploreKind, type ExploreResult } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';

export type SearchExploreHandle = {
  search: (query: string, kind: ExploreKind, signal?: AbortSignal, annotationTarget?: AnnotationTarget) => Promise<void>;
  command: (command: ExploreCommand) => boolean;
  show: (result: unknown, signal?: AbortSignal) => Promise<void>;
  context: () => ExploreContext | undefined;
  cancel: () => void;
  reset: () => void;
};

export default function SearchExplore({ content, slug, handleRef, onInteraction, onContext, onActivity, onResult, onExternalCommand, getExternalContext, beforeSearch, onPendingAnnotationChange }: {
  content: SiteContent; slug?: string; handleRef: Ref<SearchExploreHandle>;
  onInteraction: () => void; onContext: () => void; onActivity?: (activity: string) => void;
  onResult?: (result: ExploreResult, signal?: AbortSignal) => Promise<'applied' | 'failed' | 'cancelled' | undefined>; onExternalCommand?: (command: ExploreCommand) => boolean;
  getExternalContext?: () => ExploreContext | undefined;
  onPendingAnnotationChange?: (id: string | undefined) => void;
  beforeSearch?: (target?: AnnotationTarget) => void;
}) {
  const settings = exploreSettings(content);
  const [kind, setKind] = useState<ExploreKind>('web');
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  const [annotationId, setAnnotationId] = useState<string | undefined>();
  useEffect(() => { onPendingAnnotationChange?.(busy ? annotationId : undefined); }, [busy, annotationId, onPendingAnnotationChange]);
  useEffect(() => { onActivity?.(busy ? activity : ''); }, [busy, activity, onActivity]);
  const [error, setError] = useState('');
  const history = useRef<ExploreResult[]>([]);
  const pending = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const context = (): ExploreContext | undefined => getExternalContext ? getExternalContext() : result ? exploreContextForResult(result, kind, selected) : undefined;
  useEffect(() => { onContext(); }, [result, selected, kind, onContext]);
  useEffect(() => () => pending.current?.abort(), []);
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); }
  function manual() { cancel(); onInteraction(); }
  async function show(raw: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const next = exploreResultSchema.parse(raw);
    if (!settings.enabled || next.kind === 'images' && !settings.images || next.kind === 'map' && !settings.maps || next.annotationTarget && !settings.annotations) throw new Error('This view is not enabled.');
    const status = await onResult?.(next, signal);
    if (status && status !== 'applied') throw new Error('The browser did not confirm the external view. Existing objects remain available.');
    if (result) history.current = [...history.current, result].slice(-6);
    setResult(next); setKind(next.kind); setSelected(null); setError('');
    if (!onResult) requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  }
  function command(action: ExploreCommand) {
    if (onExternalCommand) return onExternalCommand(action);
    if (!result) return false;
    if (action.kind === 'open_image' || action.kind === 'open_source') {
      if (action.kind === 'open_image' ? !settings.images || !result.images.some(image => image.id === action.id) : !result.sources.some((_, index) => action.id === `source-${index + 1}`)) return false;
      setSelected(action.id); return true;
    }
    if (action.kind === 'back') {
      if (selected) setSelected(null);
      else { const previous = history.current.pop(); setResult(previous ?? null); if (previous) { setKind(previous.kind); } }
      return true;
    }
    if (action.kind === 'images' || action.kind === 'web') {
      if (action.kind === 'images' && (!settings.images || !result.images.length)) return false;
      setSelected(null); setKind(action.kind); return true;
    }
    if (!result.map || !settings.maps) return false;
    setResult({ ...result, map: { ...result.map, zoom: Math.max(2, Math.min(12, result.map.zoom + (action.kind === 'zoom_in' ? 1 : -1))) } }); return true;
  }
  async function search(value: string, requestedKind: ExploreKind, signal?: AbortSignal, annotationTarget?: AnnotationTarget) {
    const traceId = crypto.randomUUID(), startedAt = performance.now();
    const local = !annotationTarget && localExploreCommand(value.trim(), context());
    if (local && command(local)) return;
    cancel();
    if (!settings.enabled || requestedKind === 'images' && !settings.images || requestedKind === 'map' && !settings.maps || annotationTarget && (!settings.annotations || requestedKind !== 'web')) throw new Error('This search capability is not enabled.');
    // Check display capacity before making a chargeable request, not after it returns.
    beforeSearch?.(annotationTarget);
    const controller = new AbortController(); pending.current = controller;
    const abortSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    visitorDiagnostic({ traceId, channel: 'browser', stage: 'search', status: 'started', operation: requestedKind });
    setAnnotationId(annotationTarget?.instanceId); setBusy(true); setError(''); setActivity(requestedKind === 'images' ? 'Finding images…' : requestedKind === 'map' ? 'Preparing the map…' : 'Searching the web…');
    try {
      if (!slug) { await show({ ...demoExploreResult(value, requestedKind), ...(annotationTarget ? { annotationTarget } : {}) }, abortSignal); return; }
      const response = await recordedVisitorFetch(`/api/visitor/${encodeURIComponent(slug)}/explore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortSignal,
        body: JSON.stringify({ requestId: traceId, query: value, kind: requestedKind, ...(annotationTarget ? { annotationTarget } : {}) }) });
      const body = await response.json();
      recordBrowserTestEvent('search.result', body, traceId);
      if (abortSignal.aborted || pending.current !== controller) return;
      if (!response.ok) throw new Error(body.error || 'Search could not finish.');
      await show(body.result, abortSignal);
      visitorDiagnostic({ traceId, channel: 'browser', stage: 'search', status: abortSignal.aborted ? 'cancelled' : 'succeeded', operation: requestedKind, durationMs: performance.now() - startedAt, images: body.result.images.length, sources: body.result.sources.length });
    } catch (error) {
      visitorDiagnostic({ traceId, channel: 'browser', stage: 'search', status: abortSignal.aborted ? 'cancelled' : 'failed', operation: requestedKind, durationMs: performance.now() - startedAt });
      if (!abortSignal.aborted && pending.current === controller) setError(error instanceof Error ? error.message : 'Search could not finish. Your current view is unchanged.');
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  useImperativeHandle(handleRef, () => ({ search, command, show, context, cancel,
    reset: () => { cancel(); history.current = []; setResult(null); setSelected(null); setError(''); setActivity(''); },
  }));
  return <div ref={root}>
    {error && <p role="alert">{error}</p>}
    {result && !onResult && <ExternalSearchResults result={result} kind={kind} selected={selected} onCommand={command} onInteraction={manual}/>}
  </div>;
}
