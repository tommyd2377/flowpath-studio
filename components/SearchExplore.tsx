'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ExternalSearchResults } from '@thevoice/platform-ui';
import { demoExploreResult, exploreResultSchema, exploreSettings, localExploreCommand, type ExploreCommand, type ExploreContext, type ExploreKind, type ExploreResult } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';

export type SearchExploreHandle = {
  search: (query: string, kind: ExploreKind, signal?: AbortSignal) => Promise<void>;
  command: (command: ExploreCommand) => boolean;
  show: (result: unknown) => void;
  context: () => ExploreContext | undefined;
  cancel: () => void;
};

export default function SearchExplore({ content, slug, handleRef, onInteraction, onContext, onActivity }: {
  content: SiteContent; slug?: string; handleRef: Ref<SearchExploreHandle>;
  onInteraction: () => void; onContext: () => void; onActivity?: (activity: string) => void;
}) {
  const settings = exploreSettings(content);
  const [kind, setKind] = useState<ExploreKind>('web');
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  useEffect(() => { onActivity?.(busy ? activity : ''); }, [busy, activity, onActivity]);
  const [error, setError] = useState('');
  const history = useRef<ExploreResult[]>([]);
  const pending = useRef<AbortController | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const context = (): ExploreContext | undefined => result ? { resultId: result.id, kind, selectedImageId: selected,
    images: result.images.map(({ id, caption }) => ({ id, caption })), map: result.map } : undefined;
  useEffect(() => { onContext(); }, [result, selected, kind, onContext]);
  useEffect(() => () => pending.current?.abort(), []);
  function cancel() { pending.current?.abort(); pending.current = null; setBusy(false); }
  function manual() { cancel(); onInteraction(); }
  function show(raw: unknown) {
    const next = exploreResultSchema.parse(raw);
    if (!settings.enabled || next.kind === 'images' && !settings.images || next.kind === 'map' && !settings.maps) throw new Error('This view is not enabled.');
    if (result) history.current = [...history.current, result].slice(-6);
    setResult(next); setKind(next.kind); setSelected(null); setError('');
    requestAnimationFrame(() => root.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }));
  }
  function command(action: ExploreCommand) {
    if (!result) return false;
    if (action.kind === 'open_image') {
      if (!settings.images || !result.images.some(image => image.id === action.id)) return false;
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
  async function search(value: string, requestedKind: ExploreKind, signal?: AbortSignal) {
    const local = localExploreCommand(value.trim(), context());
    if (local && command(local)) return;
    cancel();
    if (!settings.enabled || requestedKind === 'images' && !settings.images || requestedKind === 'map' && !settings.maps) throw new Error('This search capability is not enabled.');
    const controller = new AbortController(); pending.current = controller;
    const abortSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    setBusy(true); setError(''); setActivity(requestedKind === 'images' ? 'Finding images…' : requestedKind === 'map' ? 'Preparing the map…' : 'Searching the web…');
    try {
      if (!slug) { show(demoExploreResult(value, requestedKind)); return; }
      const response = await fetch(`/api/visitor/${encodeURIComponent(slug)}/explore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abortSignal,
        body: JSON.stringify({ requestId: crypto.randomUUID(), query: value, kind: requestedKind }) });
      const body = await response.json();
      if (abortSignal.aborted || pending.current !== controller) return;
      if (!response.ok) throw new Error(body.error || 'Search could not finish.');
      show(body.result);
    } catch (error) {
      if (!abortSignal.aborted && pending.current === controller) setError(error instanceof Error ? error.message : 'Search could not finish. Your current view is unchanged.');
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  useImperativeHandle(handleRef, () => ({ search, command, show, context, cancel }));
  return <div ref={root}>
    {error && <p role="alert">{error}</p>}
    {result && <ExternalSearchResults result={result} kind={kind} selected={selected} onCommand={command} onInteraction={manual}/>}
  </div>;
}
