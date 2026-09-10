'use client';

import Image from 'next/image';

import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown } from 'lucide-react';
import Waveform from './Waveform';
import { CatalogExplorer, MediaProvider, MediaGallery } from '@thevoice/platform-ui';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import VisitorAssistant from './VisitorAssistant';
import { visitorSettings } from '@/lib/visitor-model';
import type { SiteContent } from '@/lib/site-model';
import { openingPresentation } from '@/lib/site-opening';
import { observePlatformEvent } from '@/lib/platform-client-events';
import type { PlatformEventInput } from '@/lib/platform-events';

export default function SiteExperience({ content, siteId, publishedSlug, catalog, media }: { content: SiteContent; siteId: string; publishedSlug?: string; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null }) {
  const resolveAssetUrl = (id: string, size: 'thumb' | 'display') => `${publishedSlug ? `/api/public-files/${publishedSlug}` : `/api/files/${siteId}`}/${encodeURIComponent(id)}${size === 'thumb' ? '?size=thumb' : ''}`;
  const cancelVisitor = useRef<(() => void) | null>(null);
  const [entered, setEntered] = useState(false);
  const experienceKey = `${siteId}:${publishedSlug ?? 'preview'}:${catalog?.id ?? ''}:${JSON.stringify(content)}`;
  const openingPlan = useMemo(() => catalog ? openingPresentation(content, catalog) : undefined, [content, catalog]);
  const waveControl = useRef<HTMLButtonElement>(null);
  const assistantControl = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const duration = reduce ? 0 : 1.1;
  const settings = visitorSettings(content);
  const assistantEnabled = settings.enabled;
  const chatOpening = assistantEnabled && settings.mode === 'chat' || Boolean(catalog);
  function photoEvent(assetId: string) {
    if (!media) return;
    observePlatformEvent(publishedSlug ? `/api/visitor/${publishedSlug}/events` : `/api/sites/${siteId}/events`, { type: 'outcome', kind: 'photo_view', surface: publishedSlug ? 'public' : 'preview', snapshotId: media.id, assetId });
  }
  function catalogEvent(event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) {
    if (!catalog) return;
    observePlatformEvent(publishedSlug ? `/api/visitor/${publishedSlug}/events` : `/api/sites/${siteId}/events`, { ...event, surface: publishedSlug ? 'public' : 'preview', snapshotId: catalog.id });
  }
  const opening = <AnimatePresence initial={false}>{!entered && <motion.div className="site-opening" data-source-id="overview" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration }}>
        <h1>{content.headline}</h1>
        <p>{content.description}</p>
        {!!content.opening?.highlights.length && <ul className="site-opening-highlights">{content.opening.highlights.map((highlight, index) => <li key={index}>{highlight}</li>)}</ul>}
        <button type="button" className="site-explore" onClick={() => { cancelVisitor.current?.(); setEntered(true); (waveControl.current || assistantControl.current?.querySelector<HTMLElement>('textarea, .site-wave'))?.focus({ preventScroll: true }); }}>Explore the site <ArrowDown size={14} aria-hidden="true"/></button>
      </motion.div>}</AnimatePresence>;
  return <MediaProvider library={media ?? null} resolveAssetUrl={resolveAssetUrl} onInteraction={() => { cancelVisitor.current?.(); setEntered(true); }} onPhotoView={assetId => photoEvent(assetId)}><div className="voice-template" data-visitor-site="true" style={{ '--site-accent': content.accent } as CSSProperties}>
    <div className="site-sample-note">{publishedSlug ? 'Published site' : 'Interactive site preview'}<span>{assistantEnabled ? 'AI assistant' : 'Explore the site'}</span></div>
    <motion.div className="site-voice-stage" animate={{ paddingTop: entered ? 28 : 64, paddingBottom: entered ? 20 : 44 }} transition={{ duration }}>
      <div className="site-wordmark">
        {content.logoAssetId && <Image unoptimized width={32} height={32} className="site-logo" src={publishedSlug ? `/api/public-files/${publishedSlug}/${content.logoAssetId}` : `/api/files/${siteId}/${content.logoAssetId}`} alt=""/>}
        <span>{content.name}</span>
      </div>
      {chatOpening && <div style={{ paddingTop: 24 }}>{opening}</div>}
      {assistantEnabled ? <div ref={assistantControl}><VisitorAssistant key={experienceKey} content={content} slug={publishedSlug} catalog={catalog} media={media} resolveAssetUrl={resolveAssetUrl} interactionRef={cancelVisitor} onPhotoView={photoEvent} entered={entered} onExplore={() => { setEntered(true); }} onViewChange={() => {}} onCatalogEvent={catalogEvent}/></div> : <motion.button ref={waveControl} type="button" className="site-wave" aria-label={entered ? 'Return to opening view' : 'Explore this site'} aria-pressed={entered} onClick={() => { setEntered(!entered); }} animate={{ height: entered ? 80 : 140 }} transition={{ duration }}>
        <Waveform phase="idle" inputAnalyser={null} outputAnalyser={null}/>
      </motion.button>}
      {!chatOpening && opening}
    </motion.div>
    <div className="site-content">
      {!assistantEnabled && catalog && <CatalogExplorer key={catalog.id} catalog={catalog} media={media} resolveAssetUrl={resolveAssetUrl} accent={content.accent} plan={openingPlan} onPhotoView={photoEvent} showComposer={false} onOutcome={event => catalogEvent({ ...event, type: 'outcome' })} onPresentation={plan => catalogEvent({ type: 'presentation_accepted', kind: 'display', operation: plan.operation })}/>}
      {!!media?.assets.length && !catalog && <MediaGallery title="Photos & albums"/>}
      <div className="site-signature"><span>{content.name}</span><span>A website with a voice.</span></div>
    </div>
  </div></MediaProvider>;
}
