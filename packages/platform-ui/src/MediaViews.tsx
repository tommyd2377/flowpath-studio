'use client';
/* eslint-disable @next/next/no-img-element -- This framework-neutral package uses host-processed image variants. */

import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { galleryAssetIds, mediaForTarget, validateMediaLibrary, type AssetUrlResolver, type MediaLibrary, type MediaTarget } from './media.js';
import { MotionHeight, motionTiming, revealTransition, surfaceTransition } from './motion.js';

type Viewer = { assetIds: string[]; index: number; examples: string[] };
type MediaContextValue = { library: MediaLibrary; resolveAssetUrl: AssetUrlResolver; open: (ids: string[], initialId: string, examples?: string[]) => void; onInteraction?: () => void };
const MediaContext = createContext<MediaContextValue | null>(null);

function safeSource(value: string): string | undefined {
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try { const url = new URL(value); return ['https:', 'http:', 'blob:'].includes(url.protocol) && !url.username && !url.password ? value : undefined; }
  catch { return undefined; }
}

export type MediaProviderProps = { library: MediaLibrary | null; resolveAssetUrl: AssetUrlResolver; children?: ReactNode; onInteraction?: () => void; onPhotoView?: (assetId: string) => void };
export function MediaProvider({ library, ...props }: MediaProviderProps) {
  const checked = useMemo(() => library ? validateMediaLibrary(library) : null, [library]);
  return checked ? <MediaProviderContent {...props} library={checked} key={checked.id}/> : <>{props.children}</>;
}

function MediaProviderContent({ library, resolveAssetUrl, children, onInteraction, onPhotoView }: Omit<MediaProviderProps, 'library'> & { library: MediaLibrary }) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const photoCallback = useRef(onPhotoView);
  const labelId = useId();
  const reduced = useReducedMotion();
  const open = useCallback((ids: string[], initialId: string, examples: string[] = []) => {
    const known = new Set(library.assets.map(asset => asset.id));
    const assetIds = [...new Set(ids)].filter(id => known.has(id));
    if (!assetIds.includes(initialId)) return;
    onInteraction?.();
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setViewer({ assetIds, index: assetIds.indexOf(initialId), examples });
  }, [library, onInteraction]);
  const active = viewer !== null;
  useEffect(() => {
    const element = dialog.current;
    if (!active || !element) return;
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      if (opener.current?.isConnected && !opener.current.closest('[inert], [aria-hidden="true"]')) opener.current.focus({ preventScroll: true });
    };
  }, [active]);
  const context = useMemo(() => ({ library, resolveAssetUrl, open, onInteraction }), [library, resolveAssetUrl, open, onInteraction]);
  const asset = viewer ? library.assets.find(item => item.id === viewer.assetIds[viewer.index]) : undefined;
  const activeAssetId = asset?.id;
  useEffect(() => { photoCallback.current = onPhotoView; }, [onPhotoView]);
  useEffect(() => { if (activeAssetId) photoCallback.current?.(activeAssetId); }, [activeAssetId]);
  const move = (offset: number) => setViewer(value => value ? { ...value, index: Math.max(0, Math.min(value.assetIds.length - 1, value.index + offset)) } : value);
  return <MediaContext.Provider value={context}>{children}
    <dialog ref={dialog} className="platform-lightbox" aria-labelledby={labelId} onCancel={event => { event.preventDefault(); setViewer(null); }}
      onClick={event => { if (event.target === event.currentTarget) setViewer(null); }}
      onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }}>
      {asset && viewer && <div className="platform-lightbox-content">
        <div className="platform-lightbox-toolbar"><p id={labelId}>Photo {viewer.index + 1} of {viewer.assetIds.length}</p><button ref={closeButton} type="button" aria-label="Close photo" onClick={() => setViewer(null)}>Close <span aria-hidden="true">×</span></button></div>
        <div className="platform-lightbox-stage"><AnimatePresence initial={false} mode="wait"><motion.div key={asset.id} className="platform-lightbox-frame"
          initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.disclosure / 2 }}>
          <div className="platform-lightbox-image"><MediaImage assetId={asset.id} size="display" fit="contain" interactive={false}/></div>
          <div className="platform-lightbox-caption" aria-live="polite">{viewer.examples.includes(asset.id) && <span className="platform-media-example">Example photo</span>}<p>{asset.caption || asset.alt || 'Photo'}</p>{asset.credit && <small>{asset.credit}</small>}</div>
        </motion.div></AnimatePresence></div>
        {viewer.assetIds.length > 1 && <nav className="platform-lightbox-navigation" aria-label="Photo navigation"><button type="button" disabled={viewer.index === 0} onClick={() => move(-1)}>← Previous</button><button type="button" disabled={viewer.index === viewer.assetIds.length - 1} onClick={() => move(1)}>Next →</button></nav>}
      </div>}
    </dialog>
  </MediaContext.Provider>;
}

export type MediaImageProps = { assetId: string; size?: 'thumb' | 'display'; className?: string; fit?: 'cover' | 'contain'; interactive?: boolean; onOpen?: () => void };
export function MediaImage({ assetId, size = 'thumb', className = '', fit = 'cover', interactive = true, onOpen }: MediaImageProps) {
  const context = useContext(MediaContext);
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const asset = context?.library.assets.find(item => item.id === assetId);
  if (!asset || !context) return null;
  let src: string | undefined;
  try { src = safeSource(context.resolveAssetUrl(asset.id, size)); } catch { /* A missing host image keeps its reserved space. */ }
  const image = <span className={`platform-media-image ${className}`} data-fit={fit} style={{ aspectRatio: fit === 'contain' ? `${asset.width} / ${asset.height}` : '4 / 3' }}>
    {src && failedSource !== src ? <img src={src} width={asset.width} height={asset.height} alt={asset.alt || asset.caption || 'Photo'} loading={size === 'thumb' ? 'lazy' : 'eager'} decoding="async" onError={() => setFailedSource(src)}/>
      : <span className="platform-media-unavailable" role="img" aria-label={asset.alt || asset.caption || 'Photo unavailable'}>Photo unavailable</span>}
  </span>;
  return interactive ? <button type="button" className="platform-photo-open" aria-label={`Open photo: ${asset.caption || asset.alt || 'Photo'}`} onClick={onOpen ?? (() => context.open([asset.id], asset.id))}>{image}</button> : image;
}

export type MediaGalleryProps = {
  library?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver; assetIds?: string[]; albumId?: string; entityIds?: string[];
  variant?: 'grid' | 'list'; title?: string; showAlbums?: boolean; onInteraction?: () => void;
};
export function MediaGallery({ library, resolveAssetUrl, ...props }: MediaGalleryProps) {
  if (library && resolveAssetUrl) return <MediaProvider library={library} resolveAssetUrl={resolveAssetUrl} onInteraction={props.onInteraction}><GalleryContent {...props}/></MediaProvider>;
  return <GalleryContent {...props}/>;
}

const MediaFigure = forwardRef<HTMLElement, HTMLMotionProps<'figure'>>(function MediaFigure(props, ref) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  return <motion.figure {...props} ref={ref} layout={reduced ? false : 'position'} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : motionTiming.exit } }}
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal, layout: reduced ? { duration: 0 } : surfaceTransition }}/>;
});

function GalleryContent({ assetIds, albumId, entityIds, variant = 'grid', title = 'Photos', showAlbums = true, onInteraction }: Omit<MediaGalleryProps, 'library' | 'resolveAssetUrl'>) {
  const context = useContext(MediaContext);
  const reduced = useReducedMotion();
  const scopeKey = JSON.stringify([assetIds, albumId, entityIds]);
  const [selection, setSelection] = useState({ scopeKey, albumId: albumId ?? '' });
  const selectedAlbumId = selection.scopeKey === scopeKey ? selection.albumId : albumId ?? '';
  if (!context) return null;
  const { library } = context;
  const album = library.albums.find(item => item.id === selectedAlbumId);
  const ids = galleryAssetIds(library, { assetIds, entityIds, albumId: selectedAlbumId || undefined });
  const assets = ids.flatMap(id => library.assets.find(asset => asset.id === id) ?? []);
  const examples = entityIds?.length
    ? ids.filter(id => !library.associations.some(item => item.assetId === id && item.targetType === 'entity' && entityIds.includes(item.targetId!) && item.role === 'depicts'))
    : ids.filter(id => library.associations.some(item => item.assetId === id && item.role === 'example'));
  function chooseAlbum(id: string) { (onInteraction ?? context?.onInteraction)?.(); setSelection({ scopeKey, albumId: id }); }
  return <section className="platform-media-gallery" aria-label={title || 'Photos'}>
    <div className="platform-media-heading"><div>{title && <h3>{title}</h3>}{album?.description && <p>{album.description}</p>}</div><span>{assets.length} {assets.length === 1 ? 'photo' : 'photos'}</span></div>
    {showAlbums && !albumId && library.albums.length > 0 && <div className="platform-media-albums" aria-label="Photo albums"><button type="button" aria-pressed={!selectedAlbumId} onClick={() => chooseAlbum('')}>All photos</button>{library.albums.map(item => <button type="button" key={item.id} aria-pressed={selectedAlbumId === item.id} onClick={() => chooseAlbum(item.id)}>
      {(item.coverAssetId || item.assetIds[0]) && <MediaImage assetId={item.coverAssetId || item.assetIds[0]} interactive={false}/>}<span>{item.title}</span></button>)}</div>}
    <MotionHeight><motion.div layout={reduced ? false : 'position'} className="platform-media-grid" data-variant={variant} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }}>
      <AnimatePresence initial={false} mode="popLayout">{assets.map(asset => <MediaFigure key={asset.id} className="platform-media-card">
        <MediaImage assetId={asset.id} onOpen={() => context.open(ids, asset.id, examples)}/>
        {(asset.caption || asset.credit || examples.includes(asset.id)) && <figcaption>{examples.includes(asset.id) && <span className="platform-media-example">Example photo</span>}{asset.caption && <p>{asset.caption}</p>}{asset.credit && <small>{asset.credit}</small>}</figcaption>}
      </MediaFigure>)}
      {!assets.length && <MediaFigure key="empty" className="platform-media-empty"><p role="status">No photos are available in this view.</p></MediaFigure>}</AnimatePresence>
    </motion.div></MotionHeight>
  </section>;
}

export type EntityMediaProps = { targetType?: MediaTarget['targetType']; targetId?: string; variant?: 'card' | 'detail' | 'comparison'; includeExamples?: boolean; interactive?: boolean };
export function EntityMedia({ targetType = 'entity', targetId, variant = 'card', includeExamples = false, interactive = true }: EntityMediaProps) {
  const context = useContext(MediaContext);
  if (!context) return null;
  const matches = mediaForTarget(context.library, { targetType, targetId }, includeExamples);
  if (!matches.length) return null;
  const ids = matches.map(item => item.asset.id);
  const examples = matches.filter(item => item.association.role === 'example').map(item => item.asset.id);
  const visible = variant === 'detail' ? matches.slice(0, 4) : matches.slice(0, 1);
  return <div className="platform-entity-media" data-variant={variant}>{visible.map(({ asset, association }, index) => <figure key={asset.id}>
    <MediaImage assetId={asset.id} interactive={interactive} onOpen={() => context.open(ids, asset.id, examples)}/>
    {association.role === 'example' && <span className="platform-media-example">Example photo</span>}
    {index === 0 && ids.length > visible.length && <span className="platform-photo-count">{ids.length} photos</span>}
    {variant === 'detail' && asset.caption && <figcaption>{asset.caption}</figcaption>}
  </figure>)}</div>;
}
