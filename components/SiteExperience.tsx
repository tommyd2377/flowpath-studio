'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MediaProvider } from '@thevoice/platform-ui';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import VisitorAssistant from './VisitorAssistant';
import VisitorDiagnostics from './VisitorDiagnostics';
import { VisitorTasksProvider } from './VisitorTasks';
import { type VisitorWorkspaceHandle } from './VisitorWorkspace';
import WebsiteSurface from './WebsiteSurface';
import { visitorSettings } from '@/lib/visitor-model';
import type { SiteContent } from '@/lib/site-model';
import { openingCopy, openingInitialPresentation, openingInitialSourceIds, openingVisibility } from '@/lib/site-opening';
import { siteStyle } from '@/lib/site-style';
import { observePlatformEvent } from '@/lib/platform-client-events';
import type { PlatformEventInput } from '@/lib/platform-events';

export default function SiteExperience({ content, siteId, publishedSlug, catalog, media }: { content: SiteContent; siteId: string; publishedSlug?: string; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null }) {
  const resolveAssetUrl = (id: string, size: 'thumb' | 'display') => `${publishedSlug ? `/api/public-files/${publishedSlug}` : `/api/files/${siteId}`}/${encodeURIComponent(id)}${size === 'thumb' ? '?size=thumb' : ''}`;
  const homeTasks = useRef<(() => void) | null>(null);
  const homeVisitor = useRef<(() => void) | null>(null);
  const staticWorkspace = useRef<VisitorWorkspaceHandle>(null);
  const [mediaDismissal, setMediaDismissal] = useState(0);
  const cancelVisitor = useRef<(() => void) | null>(null);
  const experienceKey = `${siteId}:${publishedSlug ?? 'preview'}:${catalog?.id ?? ''}:${media?.id ?? ''}:${JSON.stringify(content)}`;
  const initialCatalogPlan = useMemo(() => catalog ? openingInitialPresentation(content, catalog, media) : undefined, [content, catalog, media]);
  const initialSourceIds = useMemo(() => openingInitialSourceIds(content, media), [content, media]);
  const initialContentInvoked = openingVisibility(content) === 'legacy' || !!initialCatalogPlan || initialSourceIds.length > 0;
  const [layerOpen, setLayerOpen] = useState(false);
  const [controlsActive, setControlsActive] = useState(true);
  const [contentInvoked, setContentInvoked] = useState(initialContentInvoked);
  const previousExperience = useRef(experienceKey);
  useEffect(() => {
    if (previousExperience.current === experienceKey) return;
    previousExperience.current = experienceKey;
    setControlsActive(true); setContentInvoked(initialContentInvoked);
  }, [experienceKey, initialContentInvoked, content.style?.entry]);
  const activateControls = () => setControlsActive(true);
  const invokeContent = () => { setControlsActive(true); setContentInvoked(true); setLayerOpen(true); };
  const dismissMedia = () => setMediaDismissal(value => value + 1);
  const resetContent = () => { setControlsActive(true); setContentInvoked(initialContentInvoked); setMediaDismissal(value => value + 1); };
  const goHome = () => { if (homeVisitor.current) homeVisitor.current(); else { homeTasks.current?.(); resetContent(); void staticWorkspace.current?.home(); } };
  const reduce = useReducedMotion();
  const settings = visitorSettings(content);
  function photoEvent(assetId: string) {
    if (!media) return;
    observePlatformEvent(publishedSlug ? `/api/visitor/${publishedSlug}/events` : `/api/sites/${siteId}/events`, { type: 'outcome', kind: 'photo_view', surface: publishedSlug ? 'public' : 'preview', snapshotId: media.id, assetId });
  }
  function catalogEvent(event: Pick<PlatformEventInput, 'type' | 'kind' | 'operation' | 'entityId' | 'capabilityId'>) {
    if (!catalog) return;
    observePlatformEvent(publishedSlug ? `/api/visitor/${publishedSlug}/events` : `/api/sites/${siteId}/events`, { ...event, surface: publishedSlug ? 'public' : 'preview', snapshotId: catalog.id });
  }
  const copy = openingCopy(content, catalog);
  const opening = <AnimatePresence initial={false}>{!controlsActive && <motion.div className="site-opening" data-source-id="overview" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: reduce ? 0 : .52 }}>
    <h1>{copy.headline}</h1><p>{copy.description}</p>
    {!!content.opening?.highlights.length && <ul className="site-opening-highlights">{content.opening.highlights.map((highlight, index) => <li key={index}>{highlight}</li>)}</ul>}
  </motion.div>}</AnimatePresence>;
  const identity = <div className="site-wordmark"><span className="site-wordmark-line" aria-hidden="true"/><span>{content.name}</span><span className="site-wordmark-line" aria-hidden="true"/></div>;
  return <MediaProvider dismissalKey={mediaDismissal} onHome={goHome} library={media ?? null} resolveAssetUrl={resolveAssetUrl} onInteraction={() => { cancelVisitor.current?.(); invokeContent(); }} onPhotoView={photoEvent}><div className="voice-template" data-visitor-site="true" data-site-template={content.style?.template} data-ai-open={layerOpen} data-website-entry={content.style?.entry} data-workspace-palette={content.style?.palette ?? 'midnight'} data-entered={controlsActive} data-content-invoked={contentInvoked} style={siteStyle(content)}>
    {!publishedSlug && <div className="site-sample-note">Interactive site preview</div>}
    <VisitorTasksProvider active={layerOpen} homeRef={homeTasks} slug={publishedSlug} onInteraction={() => { cancelVisitor.current?.(); invokeContent(); }} beforeShow={async (_view, signal) => {
      if (signal?.aborted) return 'cancelled';
      invokeContent();
      return 'applied';
    }}>
    {settings.enabled ? <VisitorAssistant layerOpen={layerOpen} onLayerClose={() => setLayerOpen(false)} website={<WebsiteSurface slug={publishedSlug} content={content} catalog={catalog} media={media} onAsk={invokeContent} onInteraction={() => cancelVisitor.current?.()}/>} key={experienceKey} onDismissMedia={dismissMedia} workspaceRef={staticWorkspace} content={content} slug={publishedSlug} catalog={catalog} media={media} resolveAssetUrl={resolveAssetUrl} interactionRef={cancelVisitor} homeRef={homeVisitor} onPhotoView={photoEvent} entered={controlsActive} contentInvoked={contentInvoked} initialCatalogPlan={initialCatalogPlan} initialSourceIds={initialSourceIds} onControlActivate={activateControls} onContentInvoke={invokeContent} onContentReset={resetContent} onViewChange={() => {}} onCatalogEvent={catalogEvent} identity={identity} opening={opening}/>
      : <WebsiteSurface key={experienceKey} slug={publishedSlug} content={content} catalog={catalog} media={media} onAsk={() => {}}/>}

    </VisitorTasksProvider>
    {process.env.NODE_ENV === 'development' && <VisitorDiagnostics/>}
  </div></MediaProvider>;
}
