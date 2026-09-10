'use client';

/* Search images are unoptimized external resources, never proxied through the application server. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useImperativeHandle, useRef, useState, type Ref, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Globe2, ImageIcon, Map, Minus, Plus, Search, X } from 'lucide-react';
import { demoExploreResult, exploreResultSchema, exploreSettings, localExploreCommand, mapEmbedUrl, type ExploreCommand, type ExploreContext, type ExploreKind, type ExploreResult } from '@/lib/explore-model';
import type { SiteContent } from '@/lib/site-model';
import styles from './SearchExplore.module.css';

export type SearchExploreHandle = {
  search: (query: string, kind: ExploreKind, signal?: AbortSignal) => Promise<void>;
  command: (command: ExploreCommand) => boolean;
  show: (result: unknown) => void;
  context: () => ExploreContext | undefined;
  cancel: () => void;
};

function CitedAnswer({ result }: { result: ExploreResult }) {
  const parts: ReactNode[] = []; let cursor = 0;
  for (const [index, citation] of result.citations.entries()) {
    if (citation.start < cursor) continue;
    parts.push(result.answer.slice(cursor, citation.start));
    parts.push(<a key={index} href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.title}>[{index + 1}]</a>);
    cursor = citation.end;
  }
  parts.push(result.answer.slice(cursor));
  return <p className={styles.answer}>{parts}</p>;
}
function WebImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className={styles.imageFallback}>Image unavailable. You can still visit its source.</span>
    : <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}
function ImageViewer({ image, close }: { image: ExploreResult['images'][number]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className={styles.viewer} aria-label="Web image viewer" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button type="button" className={styles.close} onClick={close} aria-label="Close image"><X size={20}/></button>
    <WebImage key={image.url} src={image.url} alt={image.caption}/>
    <p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Visit image source <ArrowUpRight size={14}/></a>
    <small>External image · rights remain with its owner</small>
  </dialog>;
}

export default function SearchExplore({ content, slug, handleRef, onInteraction, onContext, onActivity }: {
  content: SiteContent; slug?: string; handleRef: Ref<SearchExploreHandle>;
  onInteraction: () => void; onContext: () => void; onActivity?: (activity: string) => void;
}) {
  const settings = exploreSettings(content);
  const [kind, setKind] = useState<ExploreKind>('web');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ExploreResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState('');
  useEffect(() => { onActivity?.(busy ? activity : ''); }, [busy, activity, onActivity]);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const history = useRef<ExploreResult[]>([]);
  const pending = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
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
    setResult(next); setKind(next.kind); setQuery(next.query); setSelected(null); setError('');
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
      else { const previous = history.current.pop(); setResult(previous ?? null); if (previous) { setKind(previous.kind); setQuery(previous.query); } }
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
      if (Number.isInteger(body.searchRemaining)) setRemaining(body.searchRemaining);
    } catch (error) {
      if (!abortSignal.aborted && pending.current === controller) setError(error instanceof Error ? error.message : 'Search could not finish. Your current view is unchanged.');
    } finally { if (pending.current === controller) { pending.current = null; setBusy(false); } }
  }
  useImperativeHandle(handleRef, () => ({ search, command, show, context, cancel }));
  const image = result?.images.find(image => image.id === selected);
  return <section ref={root} className={styles.explore} aria-label="Search and explore">
    <div className={styles.heading}><div><span className={styles.eyebrow}>BEYOND THIS SITE</span><h2>Search and explore</h2></div><Globe2 size={22}/></div>
    <p className={styles.help}>Explore the web without losing your place. Results are external information, separate from this site’s published content.</p>
    <div className={styles.modes} role="group" aria-label="Search type">{([{ id: 'web', label: 'Web', icon: Search }, ...(settings.images ? [{ id: 'images', label: 'Images', icon: ImageIcon }] : []), ...(settings.maps ? [{ id: 'map', label: 'Map', icon: Map }] : [])] as const).map(item => <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => { manual(); setKind(item.id as ExploreKind); input.current?.focus({ preventScroll: true }); }}><item.icon size={15}/>{item.label}</button>)}</div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); if (query.trim()) { manual(); void search(query.trim(), kind); } }}>
      <input ref={input} aria-label="Search the web, images or maps" value={query} onChange={event => setQuery(event.target.value)} maxLength={2000} placeholder={kind === 'map' ? 'Show me a map of the United States…' : kind === 'images' ? 'Find images of…' : 'What would you like to find?'}/>
      <button type={busy ? 'button' : 'submit'} disabled={!busy && !query.trim()} aria-label={busy ? 'Stop search' : 'Search'} onClick={busy ? manual : undefined}>{busy ? <X size={19}/> : <Search size={19}/>}</button>
    </form>
    <div className={styles.meta}><span>{!slug || result?.demo ? 'Preview · no live search' : settings.allowedDomains.length ? `Sources: ${settings.allowedDomains.join(', ')}` : 'Public web · sources included'}</span>{remaining !== null && <span>{remaining} searches left today</span>}</div>
    {busy && <p role="status">{kind === 'map' ? 'Preparing the map…' : 'Searching…'} Your current results remain available.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {result && <div className={styles.results}>
      <div className={styles.resultHeading}><button type="button" onClick={() => { manual(); command({ kind: 'back' }); }}><ArrowLeft size={15}/> Back</button><span>{result.demo ? 'Synthetic preview' : `Retrieved ${new Date(result.fetchedAt).toLocaleDateString()}`}</span></div>
      <h3>{result.query}</h3><CitedAnswer result={result}/>
      {kind === 'images' && (result.images.length ? <div className={styles.gallery}>{result.images.map((image, index) => <article key={image.id}>
        <button type="button" onClick={() => { manual(); command({ kind: 'open_image', id: image.id }); }} aria-label={`Open image ${index + 1}: ${image.caption}`}><WebImage src={image.thumbnail} alt={image.caption}/><span className={styles.number}>{index + 1}</span></button>
        <p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={manual}>{new URL(image.sourceUrl).hostname} <ArrowUpRight size={12}/></a>
      </article>)}</div> : <p>No image results in this view. Enter a query and choose Search.</p>)}
      {kind === 'map' && result.map && <div className={styles.map}>
        <h4>{result.map.label}</h4><div className={styles.mapControls} aria-label="Map controls">
          <button type="button" aria-label="Zoom in" disabled={result.map.zoom === 12} onClick={() => { manual(); command({ kind: 'zoom_in' }); }}><Plus size={17}/></button>
          <button type="button" aria-label="Zoom out" disabled={result.map.zoom === 2} onClick={() => { manual(); command({ kind: 'zoom_out' }); }}><Minus size={17}/></button>
          <span>Overview zoom {result.map.zoom}</span>
        </div>
        {result.demo ? <div className={styles.mapPreview}><Globe2 size={64}/><strong>{result.map.label}</strong><span>Offline map preview · no map tiles loaded</span><small>{result.map.latitude}°, {result.map.longitude}° · zoom {result.map.zoom}</small></div>
          : <iframe title={`Interactive map: ${result.map.label}`} src={mapEmbedUrl(result.map)} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups" onFocus={manual}/>}
        <p className={styles.help}>Approximate area overview, not a verified address. Drag the live map to pan. Overview zoom controls return to the named area. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      </div>}
      {kind === 'web' && <div className={styles.sources}>{result.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" onClick={manual}><span>{index + 1}</span><div><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></div><ArrowUpRight size={17}/></a>)}</div>}
      {kind === 'images' && !!result.images.length && <p className={styles.help}>Images link to their original sources. Display here does not grant permission to reuse them.</p>}
    </div>}
    {image && <ImageViewer key={image.id} image={image} close={() => { manual(); setSelected(null); }}/>}</section>;
}
