'use client';
/* eslint-disable @next/next/no-img-element -- This framework-neutral package uses host-processed image variants. */

import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { galleryAssetIds, mediaForTarget, validateMediaLibrary, type AssetUrlResolver, type MediaLibrary, type MediaTarget } from './media.js';
import { galleryItemVariants, MotionHeight, motionTiming, revealTransition, sequenceVariants, surfaceTransition } from './motion.js';

type Viewer = { assetIds: string[]; index: number; examples: string[] };
type MediaContextValue = { library: MediaLibrary; resolveAssetUrl: AssetUrlResolver; open: (ids: string[], initialId: string, examples?: string[]) => void; onInteraction?: () => void; onPhotoView?: (assetId: string) => void };
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
    if (!active) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (opener.current?.isConnected && !opener.current.closest('[inert], [aria-hidden="true"]')) opener.current.focus({ preventScroll: true });
    };
  }, [active]);
  const context = useMemo(() => ({ library, resolveAssetUrl, open, onInteraction, onPhotoView }), [library, resolveAssetUrl, open, onInteraction, onPhotoView]);
  const asset = viewer ? library.assets.find(item => item.id === viewer.assetIds[viewer.index]) : undefined;
  const activeAssetId = asset?.id;
  useEffect(() => { photoCallback.current = onPhotoView; }, [onPhotoView]);
  useEffect(() => { if (activeAssetId) photoCallback.current?.(activeAssetId); }, [activeAssetId]);
  const move = (offset: number) => {
    if (!viewer) return;
    const index = Math.max(0, Math.min(viewer.assetIds.length - 1, viewer.index + offset));
    if (index === viewer.index) return;
    onInteraction?.(); setViewer({ ...viewer, index });
  };
  const close = () => { if (viewer) { onInteraction?.(); setViewer(null); } };
  return <LayoutGroup id={`gallery-${labelId}`}><MediaContext.Provider value={context}>{children}
    <AnimatePresence>{asset && viewer && <motion.div className="platform-lightbox-backdrop" key="lightbox" role="presentation" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.feedback }}
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <motion.div className="platform-lightbox" role="dialog" aria-modal="true" aria-labelledby={labelId} initial={reduced ? false : { y: 18, scale: 0.985 }} animate={{ y: 0, scale: 1 }} exit={{ y: 12, scale: 0.99 }} transition={{ type: 'spring', visualDuration: reduced ? 0 : motionTiming.reveal, bounce: 0.08 }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); close(); } if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); } }}>
      <div className="platform-lightbox-content">
        <div className="platform-lightbox-toolbar"><p id={labelId}>Photo {viewer.index + 1} of {viewer.assetIds.length}</p><button ref={closeButton} type="button" aria-label="Close photo" onClick={close}>Close <span aria-hidden="true">×</span></button></div>
        <div className="platform-lightbox-stage"><AnimatePresence initial={false} mode="wait"><motion.div key={asset.id} className="platform-lightbox-frame"
          initial={reduced ? false : { opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.disclosure / 2 }}>
          <div className="platform-lightbox-image"><MediaImage assetId={asset.id} size="display" fit="contain" interactive={false} layoutId={`gallery-photo-${asset.id}`}/></div>
          {(viewer.examples.includes(asset.id) || visibleCaption(asset.caption) || asset.credit) && <div className="platform-lightbox-caption" aria-live="polite">{viewer.examples.includes(asset.id) && <span className="platform-media-example">Example photo</span>}{visibleCaption(asset.caption) && <p>{visibleCaption(asset.caption)}</p>}{asset.credit && <small>{asset.credit}</small>}</div>}
        </motion.div></AnimatePresence></div>
        {viewer.assetIds.length > 1 && <nav className="platform-lightbox-navigation" aria-label="Photo navigation"><button type="button" disabled={viewer.index === 0} onClick={() => move(-1)}>← Previous</button><button type="button" disabled={viewer.index === viewer.assetIds.length - 1} onClick={() => move(1)}>Next →</button></nav>}
      </div></motion.div>
    </motion.div>}</AnimatePresence>
  </MediaContext.Provider></LayoutGroup>;
}

export type MediaImageProps = { assetId: string; size?: 'thumb' | 'display'; className?: string; fit?: 'cover' | 'contain'; aspectRatio?: string; interactive?: boolean; onOpen?: () => void; layoutId?: string };
export function MediaImage({ assetId, size = 'thumb', className = '', fit = 'cover', aspectRatio, interactive = true, onOpen, layoutId }: MediaImageProps) {
  const context = useContext(MediaContext);
  const [failedSource, setFailedSource] = useState<string | undefined>();
  const asset = context?.library.assets.find(item => item.id === assetId);
  if (!asset || !context) return null;
  let src: string | undefined;
  try { src = safeSource(context.resolveAssetUrl(asset.id, size)); } catch { /* A missing host image keeps its reserved space. */ }
  const image = <motion.span layout={layoutId ? 'position' : false} layoutId={layoutId} className={`platform-media-image ${className}`} data-source-id={`photo:${asset.id}`} data-fit={fit} style={{ aspectRatio: aspectRatio ?? (fit === 'contain' ? `${asset.width} / ${asset.height}` : '4 / 3') }}>
    {src && failedSource !== src ? <img src={src} width={asset.width} height={asset.height} alt={asset.alt || asset.caption || 'Photo'} loading={size === 'thumb' ? 'lazy' : 'eager'} decoding="async" onError={() => setFailedSource(src)}/>
      : <span className="platform-media-unavailable" role="img" aria-label={asset.alt || asset.caption || 'Photo unavailable'}>Photo unavailable</span>}
  </motion.span>;
  return interactive ? <motion.button type="button" className="platform-photo-open" aria-label={`Open photo: ${asset.caption || asset.alt || 'Photo'}`} onClick={onOpen ?? (() => context.open([asset.id], asset.id))}
    whileHover={size === 'display' ? undefined : { scale: 1.012 }} whileTap={{ scale: 0.985 }} whileFocus={{ scale: 1.01 }} transition={{ type: 'spring', visualDuration: motionTiming.feedback, bounce: 0.1 }}>{image}</motion.button> : image;
}

export type MediaGalleryProps = {
  library?: MediaLibrary | null; resolveAssetUrl?: AssetUrlResolver; assetIds?: string[]; albumId?: string; entityIds?: string[];
  variant?: 'grid' | 'list'; title?: string; showAlbums?: boolean; onInteraction?: () => void;
};
export function MediaGallery({ library, resolveAssetUrl, ...props }: MediaGalleryProps) {
  if (library && resolveAssetUrl) return <MediaProvider library={library} resolveAssetUrl={resolveAssetUrl} onInteraction={props.onInteraction}><GalleryContent {...props}/></MediaProvider>;
  return <GalleryContent {...props}/>;
}

type MediaFigureProps = HTMLMotionProps<'figure'> & { 'data-order'?: number };
const MediaFigure = forwardRef<HTMLElement, MediaFigureProps>(function MediaFigure(props, ref) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  return <motion.figure {...props} ref={ref} layout={reduced ? false : 'position'} whileHover={reduced ? undefined : { y: -5 }} whileTap={reduced ? undefined : { scale: 0.995 }} inert={!present} aria-hidden={!present || undefined}
    variants={reduced ? undefined : galleryItemVariants} initial={reduced ? false : 'hidden'} exit="exit"
    transition={{ ...revealTransition, duration: reduced ? 0 : motionTiming.reveal, layout: reduced ? { duration: 0 } : surfaceTransition }}/>;
});

function visibleCaption(value: string | undefined) {
  const caption = value?.trim();
  return caption && !/^(?:photo|image|full ?size ?render|img[_ -]?\d+)$/i.test(caption) ? caption : '';
}

function photoLabel(asset: MediaLibrary['assets'][number], index: number) {
  const supplied = visibleCaption(asset.caption) || (asset.alt && !/^photo$/i.test(asset.alt.trim()) ? asset.alt.trim() : '');
  return supplied || `Photo ${String(index + 1).padStart(2, '0')}`;
}

function GalleryContent({ assetIds, albumId, entityIds, variant = 'grid', title = 'Photos', showAlbums = true, onInteraction }: Omit<MediaGalleryProps, 'library' | 'resolveAssetUrl'>) {
  const context = useContext(MediaContext);
  const reduced = useReducedMotion();
  const scopeKey = JSON.stringify([assetIds, albumId, entityIds]);
  const [selection, setSelection] = useState({ scopeKey, albumId: albumId ?? '' });
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const selectedAlbumId = selection.scopeKey === scopeKey ? selection.albumId : albumId ?? '';
  if (!context) return null;
  const { library } = context;
  const album = library.albums.find(item => item.id === selectedAlbumId);
  const ids = galleryAssetIds(library, { assetIds, entityIds, albumId: selectedAlbumId || undefined });
  const assets = ids.flatMap(id => library.assets.find(asset => asset.id === id) ?? []);
  const focusedIndex = focusedAssetId ? assets.findIndex(asset => asset.id === focusedAssetId) : -1;
  const focusedAsset = focusedIndex >= 0 ? assets[focusedIndex] : undefined;
  const examples = entityIds?.length
    ? ids.filter(id => !library.associations.some(item => item.assetId === id && item.targetType === 'entity' && entityIds.includes(item.targetId!) && item.role === 'depicts'))
    : ids.filter(id => library.associations.some(item => item.assetId === id && item.role === 'example'));
  function chooseAlbum(id: string) { (onInteraction ?? context?.onInteraction)?.(); setFocusedAssetId(null); setSelection({ scopeKey, albumId: id }); }
  function focusPhoto(asset: MediaLibrary['assets'][number]) { (onInteraction ?? context?.onInteraction)?.(); context?.onPhotoView?.(asset.id); setFocusedAssetId(asset.id); }
  function movePhoto(offset: number) { const next = assets[focusedIndex + offset]; if (next) focusPhoto(next); }
  return <section className="platform-media-gallery" data-layout={variant === 'grid' ? 'editorial' : 'list'} aria-label={title || 'Photos'}>
    <div className="platform-media-heading"><div>{title && <h3>{title}</h3>}{album?.description && <p>{album.description}</p>}</div><span>{assets.length} {assets.length === 1 ? 'photo' : 'photos'}</span></div>
    {showAlbums && !albumId && library.albums.length > 0 && <div className="platform-media-albums" aria-label="Photo albums"><button type="button" aria-pressed={!selectedAlbumId} onClick={() => chooseAlbum('')}>All photos</button>{library.albums.map(item => <button type="button" key={item.id} aria-pressed={selectedAlbumId === item.id} onClick={() => chooseAlbum(item.id)}>
      {(item.coverAssetId || item.assetIds[0]) && <MediaImage assetId={item.coverAssetId || item.assetIds[0]} interactive={false}/>}<span>{item.title}</span></button>)}</div>}
    <AnimatePresence mode="popLayout" initial={false}>{focusedAsset ? <motion.section key={`photo-detail-${focusedAsset.id}`} layoutId={`gallery-card-${focusedAsset.id}`} layout="position" className="platform-detail platform-photo-detail" aria-label={`Details of ${photoLabel(focusedAsset, focusedIndex)}`} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }} initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
      <span className="platform-eyebrow">PHOTO · A CLOSER LOOK</span><motion.h3 layoutId={`gallery-title-${focusedAsset.id}`} tabIndex={-1}>{photoLabel(focusedAsset, focusedIndex)}</motion.h3>
      <div className="platform-photo-detail-image"><MediaImage assetId={focusedAsset.id} size="display" fit="contain" interactive={false} layoutId={`gallery-photo-${focusedAsset.id}`}/></div>
      {(visibleCaption(focusedAsset.caption) || focusedAsset.credit || examples.includes(focusedAsset.id)) && <div className="platform-photo-detail-copy">{examples.includes(focusedAsset.id) && <span className="platform-media-example">Example photo</span>}{visibleCaption(focusedAsset.caption) && <p>{visibleCaption(focusedAsset.caption)}</p>}{focusedAsset.credit && <small>{focusedAsset.credit}</small>}</div>}
      <div className="platform-photo-detail-bottom"><button className="platform-text-button" type="button" onClick={() => setFocusedAssetId(null)}>← Back to photos</button>{assets.length > 1 && <div><button className="platform-button" type="button" disabled={focusedIndex === 0} onClick={() => movePhoto(-1)}>Previous</button><button className="platform-button" type="button" disabled={focusedIndex === assets.length - 1} onClick={() => movePhoto(1)}>Next</button></div>}</div>
    </motion.section> : <MotionHeight key="photo-grid"><motion.div layout={reduced ? false : 'position'} variants={reduced ? undefined : sequenceVariants} initial={reduced ? false : 'hidden'} whileInView="visible" viewport={{ once: true, amount: 0.16 }} className="platform-media-grid platform-items" data-variant={variant} data-layout={variant === 'grid' ? 'editorial' : 'list'} transition={{ layout: reduced ? { duration: 0 } : surfaceTransition }}>
      {assets.map((asset, index) => { const caption = visibleCaption(asset.caption); const orientation = asset.width / asset.height > 1.25 ? 'landscape' : asset.height / asset.width > 1.25 ? 'portrait' : 'square'; return <MediaFigure key={asset.id} layoutId={`gallery-card-${asset.id}`} className="platform-media-card platform-item" data-order={index} data-orientation={orientation}>
        <MediaImage assetId={asset.id} size="display" layoutId={`gallery-photo-${asset.id}`} aspectRatio={`${asset.width} / ${asset.height}`} onOpen={() => focusPhoto(asset)}/>
        <div className="platform-item-kicker"><span>Photo</span><span>{String(index + 1).padStart(2, '0')}</span></div><button className="platform-item-open" type="button" onClick={() => focusPhoto(asset)}><motion.h4 layoutId={`gallery-title-${asset.id}`}>{photoLabel(asset, index)}</motion.h4><span aria-hidden="true">↗</span></button>
        {(caption || asset.credit || examples.includes(asset.id)) && <figcaption>{examples.includes(asset.id) && <span className="platform-media-example">Example photo</span>}{caption && <p>{caption}</p>}{asset.credit && <small>{asset.credit}</small>}</figcaption>}
        <div className="platform-item-bottom"><button className="platform-text-button" type="button" onClick={() => focusPhoto(asset)}>Take a closer look <span aria-hidden="true">↗</span></button></div>
      </MediaFigure>; })}
      {!assets.length && <MediaFigure key="empty" className="platform-media-empty"><p role="status">No photos are available in this view.</p></MediaFigure>}</motion.div></MotionHeight>}</AnimatePresence>
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
    <MediaImage assetId={asset.id} layoutId={targetId && index === 0 ? `entity-media-${targetType}-${targetId}` : undefined} interactive={interactive} onOpen={() => context.open(ids, asset.id, examples)}/>
    {association.role === 'example' && <span className="platform-media-example">Example photo</span>}
    {index === 0 && ids.length > visible.length && <span className="platform-photo-count">{ids.length} photos</span>}
    {variant === 'detail' && asset.caption && <figcaption>{asset.caption}</figcaption>}
  </figure>)}</div>;
}
