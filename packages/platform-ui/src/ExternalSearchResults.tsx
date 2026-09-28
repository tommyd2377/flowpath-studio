'use client';

/* External images load directly from their sources, without a server proxy. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { revealTransition, sequenceVariants, sequenceItemVariants } from './motion.js';
import { Icon } from './components.js';
import { externalItemLabel } from './workspace.js';
import { RichAnswer } from './RichAnswer.js';

export type ExternalSearchResult = {
  id: string; kind: 'web' | 'images' | 'map'; query: string; fetchedAt: string; demo: boolean;
  answer: string; sources: { url: string; title: string }[];
  citations: { url: string; title: string; start: number; end: number }[];
  images: { id: string; url: string; thumbnail: string; sourceUrl: string; caption: string }[];
  map: { label: string; latitude: number; longitude: number; zoom: number } | null;
};
export type ExternalSearchCommand = { kind: 'open_image' | 'open_source'; id: string } | { kind: 'back' | 'images' | 'web' | 'zoom_in' | 'zoom_out' };
function mapUrl(map: NonNullable<ExternalSearchResult['map']>) {
  const span = 360 / 2 ** (map.zoom - 1);
  const bounds = [Math.max(-180, map.longitude - span), Math.max(-85, map.latitude - span / 2), Math.min(180, map.longitude + span), Math.min(85, map.latitude + span / 2)];
  return `https://www.openstreetmap.org/export/embed.html?${new URLSearchParams({ bbox: bounds.join(','), layer: 'mapnik' })}`;
}
function CitedAnswer({ result }: { result: ExternalSearchResult; formatted?: boolean }) {
  return <RichAnswer text={result.answer} sources={result.sources} citations={result.citations}/>;
}
function WebImage({ src, fallbackSrc, alt }: { src: string; fallbackSrc?: string; alt: string }) {
  const [failure, setFailure] = useState<{ source: string; fallback: boolean } | null>(null);
  const current = failure?.source === src ? failure.fallback ? fallbackSrc : undefined : src;
  return !current ? <span className="platform-external-imageFallback">Image unavailable. You can still visit its source.</span>
    : <img src={current} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => {
      setFailure({ source: src, fallback: current === src && Boolean(fallbackSrc && fallbackSrc !== src) });
    }}/>;
}
function ResultViewer({ image, source, result, close, onHome }: { image?: ExternalSearchResult['images'][number]; source?: { index: number; url: string; title: string }; result: ExternalSearchResult; close: () => void; onHome?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reduced = useReducedMotion();
  const present = useIsPresent();
  useEffect(() => {
    if (!present) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous?.isConnected && (document.activeElement === document.body || element?.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, [present]);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (present) {
      // A quick reopen can revive this key before AnimatePresence unmounts it.
      for (const property of ['display', 'position', 'margin', 'left', 'top', 'width', 'height', 'box-sizing', 'pointer-events', 'z-index']) element.style.removeProperty(property);
      return;
    }
    if (!element.open) return;
    const rect = element.getBoundingClientRect();
    // Release the native modal/focus trap immediately. A noninteractive copy
    // finishes the visual exit without swallowing the visitor's next input.
    element.close();
    Object.assign(element.style, { display: 'block', position: 'fixed', margin: '0', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, boxSizing: 'border-box', pointerEvents: 'none', zIndex: '1000' });
  }, [present]);
  return <motion.dialog ref={dialog} data-workspace-external={result.id} data-workspace-image={image?.id} data-workspace-source={source ? `source-${source.index + 1}` : undefined} className="platform-external-viewer" aria-label={image ? 'Web image viewer' : 'Web result viewer'} onCancel={event => { event.preventDefault(); close(); }}
    inert={!present || undefined} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: 18, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 10, scale: reduced ? 1 : .98 }} transition={{ ...revealTransition, duration: reduced ? 0 : .38 }}
    onClick={event => { if (present && event.target instanceof Element && !event.target.closest('button, a, input, select, textarea, [role="button"], [contenteditable="true"]') && !window.getSelection()?.toString()) close(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    {onHome && <button type="button" className="platform-viewer-home" onClick={onHome}>Home</button>}
    <button type="button" className="platform-external-close" onClick={close} aria-label={image ? 'Close image' : 'Close result'}><Icon name="close" size={20}/></button>
    {image ? <><WebImage key={image.url} src={image.url} alt={image.caption}/><p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">Visit image source <Icon name="arrow" size={14}/></a><small>External image · rights remain with its owner</small></>
      : source && <><span className="platform-external-eyebrow">From the web · Result {source.index + 1} / {externalItemLabel(source.index)}</span><h2>{source.title}</h2><p>{new URL(source.url).hostname}</p><h3>Cited search summary</h3><CitedAnswer result={result}/><a href={source.url} target="_blank" rel="noopener noreferrer">Read this source <Icon name="arrow" size={14}/></a><small>Web findings are separate from the publisher’s information.</small></>}
  </motion.dialog>;
}

/** The host validates external results before handing them to this provider-independent view. */
export function ExternalSearchViewer({ result, selected, onClose, onHome }: { result: ExternalSearchResult; selected: string | null; onClose: () => void; onHome?: () => void }) {
  const image = result.images.find(image => image.id === selected);
  const sourceIndex = result.sources.findIndex((_, index) => selected === `source-${index + 1}`);
  const source = sourceIndex >= 0 ? { ...result.sources[sourceIndex], index: sourceIndex } : undefined;
  return <AnimatePresence>{(image || source) && <ResultViewer key={selected} image={image} source={source} result={result} close={onClose} onHome={onHome}/>}</AnimatePresence>;
}

export function ExternalSearchResults({ result, kind, selected, onCommand, onInteraction, embedded = false, showViewer = true, surface = false }: {
  result: ExternalSearchResult; kind: ExternalSearchResult['kind']; selected: string | null;
  onCommand: (command: ExternalSearchCommand) => void; onInteraction: () => void;
  embedded?: boolean;
  showViewer?: boolean;
  surface?: boolean;
}) {
  const reduce = useReducedMotion();
  const imageHelp = useId(), imageGrid = surface && kind === 'images' && result.images.length > 0;
  return <motion.section key={result.id} className="platform-external" data-image-grid={imageGrid || undefined} data-item-count={imageGrid ? result.images.length : undefined} aria-label="Search results" initial={reduce || surface ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={revealTransition}>
    <div className="platform-external-results">
      {!surface && <div className="platform-external-resultHeading"><button type="button" onClick={() => { onInteraction(); onCommand({ kind: 'back' }); }}><Icon name="back" size={15}/>{embedded ? 'Remove web context' : 'Back'}</button><span>{result.demo ? 'Synthetic preview' : `From the web · ${new Date(result.fetchedAt).toLocaleDateString()}`}</span></div>}
      {imageGrid ? <h3 className="platform-external-imageCount" aria-label={`${result.images.length} images for ${result.query}`}>{result.images.length} {result.images.length === 1 ? 'image' : 'images'}</h3>
        : <>{(!surface || !/^#{1,3} /m.test(result.answer)) && kind !== 'map' && <h3>{result.query}</h3>}<CitedAnswer result={result} formatted={surface}/></>}
      {kind !== 'map' && (result.images.length ? <><p id={imageHelp} className={imageGrid ? 'platform-sr-only' : 'platform-external-help'}>Open an image by number or code, such as “expand image {Math.min(2, result.images.length)}” or “image {externalItemLabel(Math.min(1, result.images.length - 1))}”. Labels stay the same as the grid reflows.</p><motion.div className="platform-external-gallery" role="group" aria-label="Web images" aria-describedby={imageHelp} variants={sequenceVariants} initial={reduce ? false : 'hidden'} animate="visible">{result.images.map((image, index) => <motion.article key={image.id} variants={sequenceItemVariants} transition={reduce ? { duration: 0 } : undefined}>
        <button type="button" data-external-item={image.id} data-external-label={externalItemLabel(index)} onClick={() => { onInteraction(); onCommand({ kind: 'open_image', id: image.id }); }} aria-label={`Open image ${index + 1}: ${image.caption} (${externalItemLabel(index)})`}><WebImage src={image.thumbnail} fallbackSrc={image.url} alt={image.caption}/><span className="platform-external-number">{index + 1} <b>{externalItemLabel(index)}</b></span></button>
        <p>{image.caption}</p><a href={image.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={onInteraction}>{new URL(image.sourceUrl).hostname} <Icon name="arrow" size={12}/></a>
      </motion.article>)}</motion.div></> : kind === 'images' && <p>{result.answer || 'No displayable image results were returned. Try a more specific image search.'}</p>)}
      {imageGrid && <CitedAnswer result={result} formatted/>}
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
      {surface && <p className="platform-external-help">{result.demo ? 'Synthetic preview' : `External sources · ${new Date(result.fetchedAt).toLocaleDateString()}`}</p>}
      {kind === 'web' && <>{!surface && <p className="platform-external-help">Choose a source card, or say “expand result 1”.</p>}<motion.div className="platform-external-sources" variants={sequenceVariants} initial={reduce || surface ? false : 'hidden'} animate="visible">{result.sources.map((source, index) => {
        const preview = result.images.find(image => image.sourceUrl === source.url);
        return <motion.article key={source.url} variants={sequenceItemVariants}><button type="button" data-external-item={`source-${index + 1}`} data-external-label={externalItemLabel(index)} aria-label={`Open result ${index + 1}: ${source.title} (${externalItemLabel(index)})`} onClick={() => { onInteraction(); onCommand({ kind: 'open_source', id: `source-${index + 1}` }); }}>
          {preview && <WebImage src={preview.thumbnail} alt={preview.caption}/>}
          <span className="platform-external-sourceMeta"><span>{index + 1} · {externalItemLabel(index)}</span><small>{new URL(source.url).hostname}</small></span><strong>{source.title}</strong><span className="platform-external-sourceAction">Explore source <Icon name="arrow" size={15}/></span>
        </button></motion.article>;
      })}</motion.div></>}
      {kind === 'images' && !!result.images.length && <p className="platform-external-help">Images link to their original sources. Display here does not grant permission to reuse them.</p>}
    </div>
    {showViewer && <ExternalSearchViewer result={result} selected={selected} onClose={() => { onInteraction(); onCommand({ kind: 'back' }); }}/>}</motion.section>;
}
