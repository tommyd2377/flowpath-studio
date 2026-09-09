'use client';

import { forwardRef, useState, type PropsWithChildren } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { ArrowDown, ArrowUpRight, Clock3, Layers2, Mail, RotateCcw } from 'lucide-react';
import { MotionHeight, MediaGallery, EntityMedia, motionTiming, revealTransition, surfaceTransition } from '@thevoice/platform-ui';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { SiteContent } from '@/lib/site-model';
import { presentationSources, type PresentationSource, type SitePresentation as Presentation } from '@/lib/site-presentation';
import styles from './SitePresentation.module.css';

const icons = { overview: Layers2, section: ArrowUpRight, hours: Clock3, contact: Mail, album: Layers2, photos: Layers2, photo: Layers2 };

function ViewSurface(props: PropsWithChildren<HTMLMotionProps<'section'>>) {
  const present = useIsPresent();
  return <motion.section {...props} inert={!present} aria-hidden={!present}/>;
}

const SourceCard = forwardRef<HTMLElement, { source: PresentationSource; detail: boolean; index: number }>(function SourceCard({ source, detail, index }, ref) {
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();
  const present = useIsPresent();
  const Icon = icons[source.kind];
  const long = source.body.length > 500;
  const collapse = long && !detail && !expanded;
  return <motion.article ref={ref} layout={!reduce} className={styles.card} data-kind={source.kind} inert={!present} aria-hidden={!present || undefined} style={{ borderRadius: 18 }}
    initial={{ opacity: 0, y: reduce ? 0 : 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
    transition={{ ...revealTransition, duration: reduce ? 0 : motionTiming.reveal, delay: reduce ? 0 : Math.min(index * 0.025, 0.1), layout: reduce ? { duration: 0 } : surfaceTransition }}>
    <motion.div layout={reduce ? false : 'position'} className={styles.cardContent}>
    <div className={styles.cardTop}><span>{source.kind === 'section' ? 'Explore' : source.kind === 'overview' ? 'The introduction' : source.kind === 'hours' ? 'Plan your visit' : 'Start a conversation'}</span><Icon size={18} strokeWidth={1.3} aria-hidden="true"/></div>
    <h3>{source.title}</h3>
    {source.kind === 'section' && <EntityMedia targetType="section" targetId={source.id.slice(8)} variant={detail ? 'detail' : 'card'} includeExamples={detail}/>}
    <MotionHeight className={styles.copy} duration={motionTiming.disclosure} clip><p className={collapse ? styles.clamped : undefined}>{source.body}</p></MotionHeight>
    {long && !detail && <motion.button type="button" className={styles.expand} aria-expanded={expanded} onClick={() => setExpanded(!expanded)} whileTap={reduce ? undefined : { scale: 0.97 }}>
      {expanded ? 'Show less' : 'Read the details'}<motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: reduce ? 0 : 0.25 }}><ArrowDown size={13}/></motion.span>
    </motion.button>}
    <div className={styles.cardFoot}><span className={styles.sourceDot}/><span>From this site</span></div>
    </motion.div>
  </motion.article>;
});

export default function SitePresentation({ content, presentation, busy, onReset, media }: {
  media?: MediaLibrary | null; content: SiteContent; presentation: Presentation | null; busy: boolean; onReset: () => void;
}) {
  const reduce = useReducedMotion();
  const sources = presentation ? presentation.sources.flatMap(id => presentationSources(content, media).filter(source => source.id === id)) : [];
  const galleryIds = [...new Set(sources.flatMap(source => source.kind === 'photos' ? media?.assets.map(asset => asset.id) ?? [] : source.kind === 'album' ? media?.albums.find(album => `album:${album.id}` === source.id)?.assetIds ?? [] : source.kind === 'photo' ? [source.id.slice(6)] : []))];
  return <MotionHeight className={styles.surface}>
    <div className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">
      {busy ? 'Finding the information for your view.' : presentation ? presentation.status === 'unavailable' ? 'That information is not published on this site.' : `Showing ${sources.map(source => source.title).join(' and ')}.` : ''}
    </div>
    <AnimatePresence initial={false}>{busy && <motion.div className={styles.loading} key="loading" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ ...revealTransition, duration: reduce ? 0 : motionTiming.disclosure }}>
      <span>Finding your view</span><div className={styles.loadingTrack}><motion.i animate={reduce ? { x: 0 } : { x: ['-100%', '400%'] }} transition={reduce ? { duration: 0 } : { duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}/></div>
    </motion.div>}</AnimatePresence>
    <AnimatePresence initial={false}>
      {presentation && <ViewSurface key="information" className={styles.result} aria-label="Your requested information" aria-busy={busy}
        initial={{ opacity: 0, y: reduce ? 0 : 12 }} animate={{ opacity: busy ? 0.75 : 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -8 }} transition={{ ...revealTransition, duration: reduce ? 0 : motionTiming.reveal }}>
        <div className={styles.heading}><div><span className={styles.eyebrow}>{presentation.layout === 'comparison' ? 'A LITTLE PERSPECTIVE' : 'BROUGHT INTO FOCUS'}</span><h2>{presentation.status === 'unavailable' ? 'Not on this site yet' : presentation.layout === 'comparison' ? 'Side by side.' : sources.length === 1 ? 'A closer look.' : 'Here’s what matters.'}</h2></div>
          <motion.button type="button" className={styles.reset} onClick={onReset} disabled={busy} whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.96 }}><RotateCcw size={13}/><span>All of the site</span></motion.button>
        </div>
        {presentation.status === 'unavailable' && <p className={styles.missing}>That information hasn’t been published here. {content.contact ? 'The owner can help with the details.' : 'You can keep exploring the information below.'}</p>}
        {presentation.layout === 'gallery' ? <MediaGallery assetIds={galleryIds} title={sources.length === 1 ? sources[0].title : 'Photos for you'} showAlbums={sources.some(source => source.kind === 'photos')}/> : <motion.div layout={reduce ? false : 'position'} className={styles.grid} data-layout={presentation.layout} data-count={sources.length}>
          <AnimatePresence initial={false} mode="popLayout">{sources.map((source, index) => <SourceCard key={source.id} source={source} index={index} detail={presentation.layout === 'detail'}/>)}</AnimatePresence>
        </motion.div>}
      </ViewSurface>}
    </AnimatePresence>
  </MotionHeight>;
}
