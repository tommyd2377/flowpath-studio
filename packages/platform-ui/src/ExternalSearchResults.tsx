'use client';

/* External images load directly from their sources, without a server proxy. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { revealTransition } from './motion.js';
import { Icon } from './components.js';

export type ExternalSearchResult = {
  id: string; kind: 'web' | 'images' | 'map'; query: string; fetchedAt: string; demo: boolean;
  answer: string; sources: { url: string; title: string }[];
  citations: { url: string; title: string; start: number; end: number }[];
  images: { id: string; url: string; thumbnail: string; sourceUrl: string; caption: string }[];
  map: { label: string; latitude: number; longitude: number; zoom: number } | null;
};
export type ExternalSearchCommand = { kind: 'open_image'; id: string } | { kind: 'back' | 'images' | 'web' | 'zoom_in' | 'zoom_out' };
function mapUrl(map: NonNullable<ExternalSearchResult['map']>) {
  const span = 360 / 2 ** (map.zoom - 1);
  const bounds = [Math.max(-180, map.longitude - span), Math.max(-85, map.latitude - span / 2), Math.min(180, map.longitude + span), Math.min(85, map.latitude + span / 2)];
  return `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: bounds.join(','), layer: 'mapnik' })}`;
}
function CitedAnswer({ result }: { result: ExternalSearchResult }) {
  const parts: ReactNode[] = []; let cursor = 0;
  for (const [index, citation] of result.citations.entries()) {
    if (citation.start < cursor) continue;
    parts.push(result.answer.slice(cursor, citation.start));
    parts.push(<a key={index} href={citation.url} target="_blank" rel="noopener noreferrer" title={citation.title}>[{index + 1}]</a>);
    cursor = citation.end;
  }
  parts.push(result.answer.slice(cursor));
  return <p className="platform-external-answer">{parts}</p>;
}
function WebImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="platform-external-imageFallback">Image unavailable. You can still visit its source.</span>
    : <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/>;
}
function ImageViewer({ image, close }: { image: ExternalSearchResult['images'][number]; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={dialog} className="platform-external-viewer" aria-label="Web image viewer" onCancel={event => { event.preventDefault(); close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button type="button" className="platform-external-close" onClick={close} aria-label="Close image"><Icon name="close" size={20}/></button>
    <WebImage key={image.url} src={image.url} alt={image.caption}/>
    <p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Visit image source <Icon name="arrow" size={14}/></a>
    <small>External image · rights remain with its owner</small>
  </dialog>;
}

/** The host validates external results before handing them to this provider-independent view. */
export function ExternalSearchResults({ result, kind, selected, onCommand, onInteraction }: {
  result: ExternalSearchResult; kind: ExternalSearchResult['kind']; selected: string | null;
  onCommand: (command: ExternalSearchCommand) => void; onInteraction: () => void;
}) {
  const reduce = useReducedMotion();
  const image = result.images.find(image => image.id === selected);
  return <motion.section key={result.id} className="platform-external" aria-label="Search results" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={revealTransition}>
    <div className="platform-external-results">
      <div className="platform-external-resultHeading"><button type="button" onClick={() => { onInteraction(); onCommand({ kind: 'back' }); }}><Icon name="back" size={15}/> Back</button><span>{result.demo ? 'Synthetic preview' : `Retrieved ${new Date(result.fetchedAt).toLocaleDateString()}`}</span></div>
      <h3>{result.query}</h3><CitedAnswer result={result}/>
      {kind === 'images' && (result.images.length ? <div className="platform-external-gallery">{result.images.map((image, index) => <article key={image.id}>
        <button type="button" onClick={() => { onInteraction(); onCommand({ kind: 'open_image', id: image.id }); }} aria-label={`Open image ${index + 1}: ${image.caption}`}><WebImage src={image.thumbnail} alt={image.caption}/><span className="platform-external-number">{index + 1}</span></button>
        <p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={onInteraction}>{new URL(image.sourceUrl).hostname} <Icon name="arrow" size={12}/></a>
      </article>)}</div> : <p>No image results in this view. Ask the assistant to find images.</p>)}
      {kind === 'map' && result.map && <div className="platform-external-map">
        <h4>{result.map.label}</h4><div className="platform-external-mapControls" aria-label="Map controls">
          <button type="button" aria-label="Zoom in" disabled={result.map.zoom === 12} onClick={() => { onInteraction(); onCommand({ kind: 'zoom_in' }); }}><Icon name="plus" size={17}/></button>
          <button type="button" aria-label="Zoom out" disabled={result.map.zoom === 2} onClick={() => { onInteraction(); onCommand({ kind: 'zoom_out' }); }}><span aria-hidden="true">−</span></button>
          <span>Overview zoom {result.map.zoom}</span>
        </div>
        {result.demo ? <div className="platform-external-mapPreview"><span aria-hidden="true">◎</span><strong>{result.map.label}</strong><span>Offline map preview · no map tiles loaded</span><small>{result.map.latitude}°, {result.map.longitude}° · zoom {result.map.zoom}</small></div>
          : <iframe title={`Interactive map: ${result.map.label}`} src={mapUrl(result.map)} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-popups" onFocus={onInteraction}/>}
        <p className="platform-external-help">Approximate area overview, not a verified address. Drag the live map to pan. Overview zoom controls return to the named area. <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a></p>
      </div>}
      {kind === 'web' && <div className="platform-external-sources">{result.sources.map((source, index) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" onClick={onInteraction}><span>{index + 1}</span><div><strong>{source.title}</strong><small>{new URL(source.url).hostname}</small></div><Icon name="arrow" size={17}/></a>)}</div>}
      {kind === 'images' && !!result.images.length && <p className="platform-external-help">Images link to their original sources. Display here does not grant permission to reuse them.</p>}
    </div>
    {image && <ImageViewer key={image.id} image={image} close={() => { onInteraction(); onCommand({ kind: 'back' }); }}/>}</motion.section>;
}
