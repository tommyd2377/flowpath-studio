'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MediaImage, MediaVideo, PublishedWebsite, type WebsiteEntry, type WebsiteSection } from '@thevoice/platform-ui';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { effectiveWebsiteTemplate } from '@thevoice/platform-ui/site-design';
import { referenceKey } from '@thevoice/platform-ui/workspace';
import { publishedWorkspace } from '@/lib/visitor-workspace';
import { detailedWebsiteEntry, websiteEntry, websiteHeroId, websiteSections } from '@/lib/website-presentation';
import { openingCopy } from '@/lib/site-opening';
import { applyWebsiteCompositionSections, resolveWebsiteComposition } from '@/lib/website-composition';
import { visitorSettings } from '@/lib/visitor-model';
import type { SiteContent } from '@/lib/site-model';

/** Ordinary website browsing never creates a task or reports a scene to the assistant. */
export default function WebsiteSurface({ content, catalog: suppliedCatalog, media, onAsk, slug, active = true, onInteraction = () => {} }: { content: SiteContent; catalog?: KnowledgeCatalog | null; media?: MediaLibrary | null; onAsk: () => void; slug?: string; active?: boolean; onInteraction?: () => void }) {
  const catalog = content.catalogPublicationId ? null : suppliedCatalog;
  const authority = useMemo(() => publishedWorkspace(content, catalog, media), [content, catalog, media]);
  const composition = useMemo(() => resolveWebsiteComposition(content, catalog, media), [content, catalog, media]);
  const [catalogSection, setCatalogSection] = useState<WebsiteSection | null>(null);
  const [detail, setDetail] = useState<WebsiteEntry | null>(null), [error, setError] = useState('');
  const pageRequest = useRef<AbortController | null>(null), detailRequest = useRef<AbortController | null>(null);
  async function loadPage(offset: number) {
    pageRequest.current?.abort(); const controller = new AbortController(); pageRequest.current = controller;
    try { const response = await fetch(`/api/visitor/${slug}/catalog?offset=${offset}&publicationId=${content.catalogPublicationId}`, { signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (controller.signal.aborted) return; if (result.publicationId !== content.catalogPublicationId) throw new Error('This website was updated. Reload to see the current publication.'); setCatalogSection(result.section); setError(''); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The collection could not load. Try again.'); }
  }
  // This effect starts a cancellable read; state changes only when the response arrives.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (slug && content.catalogPublicationId) void loadPage(0); return () => { pageRequest.current?.abort(); detailRequest.current?.abort(); }; }, [slug, content.catalogPublicationId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function open(id: string) {
    onInteraction(); setSelected(id); setDetail(null); detailRequest.current?.abort();
    if (!id.startsWith('catalog:') || !slug) return;
    const controller = new AbortController(); detailRequest.current = controller;
    try { const response = await fetch(`/api/visitor/${slug}/catalog?record=${encodeURIComponent(id.slice(8))}&publicationId=${content.catalogPublicationId}`, { signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error); if (controller.signal.aborted) return; if (result.publicationId !== content.catalogPublicationId) throw new Error('This website was updated. Reload to see the current publication.'); setDetail(result.entry); }
    catch { if (!controller.signal.aborted) setError('The full details could not load. The published summary is still available.'); }
  }
  const sections = useMemo<WebsiteSection[]>(() => [...applyWebsiteCompositionSections(websiteSections(authority, content, catalog, media), composition), ...(catalogSection ? [catalogSection] : []), ...(media?.videos?.length ? [{ id: 'videos', title: 'Videos', kind: 'collection' as const, entries: media.videos.map(video => ({ id: `video:${video.id}`, name: video.title, body: video.description, eyebrow: 'Watch', videoId: video.id, imageAssetId: video.posterAssetId })) }] : [])], [authority, content, catalog, media, catalogSection, composition]);
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const entry = detail && detail.id === selected ? detail : selected ? sections.flatMap(section => section.entries).find(entry => entry.id === selected) ?? (() => { const record = authority.records.find(record => referenceKey(record.reference) === selected); return record ? detailedWebsiteEntry(record, catalog, media) : undefined; })() : undefined;
  useEffect(() => { if (entry) dialog.current?.showModal(); else dialog.current?.close(); }, [entry]);
  const heroId = composition ? composition.heroAssetId : content.style?.template ? websiteHeroId(content, media) : media?.associations.find(link => link.targetType === 'site' && link.primary)?.assetId ?? content.opening?.initialAssetIds?.[0] ?? media?.albums.flatMap(album => album.assetIds).find(id => id !== content.logoAssetId) ?? media?.assets.find(asset => asset.id !== content.logoAssetId)?.id;
  const hero = authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === heroId);
  return <>
    <PublishedWebsite primaryAction={composition?.primaryAction} name={content.name} tagline={content.tagline} template={content.style?.template} styleSettings={content.style} websiteMotion={content.style?.websiteMotion} active={active && !entry} assistantEnabled={visitorSettings(content).enabled} {...openingCopy(content, catalog)} layout={content.style?.layout} sections={sections} logoAssetId={content.logoAssetId} hero={hero ? websiteEntry(hero, media) : undefined} contact={content.contact} hours={content.hours} onOpen={id => void open(id)} onPage={offset => { onInteraction(); void loadPage(offset); }} onHome={() => { onInteraction(); setSelected(null); dialog.current?.closest('[data-visitor-site]')?.scrollIntoView({ block: 'start', behavior: 'instant' }); }} onAsk={onAsk} onInteraction={onInteraction}/>
    {error && <p role="alert">{error} <button type="button" onClick={() => void loadPage(catalogSection?.offset ?? 0)}>Retry</button></p>}
    <dialog ref={dialog} className="website-detail" data-website-detail={effectiveWebsiteTemplate(content.style)} aria-label={entry?.name ?? 'Published detail'} onClose={() => { detailRequest.current?.abort(); setSelected(null); setDetail(null); }} onClick={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      {entry && <article><button type="button" className="website-detail-close" onClick={() => setSelected(null)} aria-label="Close detail">Close</button><h2>{entry.name}</h2>{'videoId' in entry && typeof entry.videoId === 'string' ? <MediaVideo videoId={entry.videoId}/> : entry.imageAssetId && <MediaImage checkInitialLoad assetId={entry.imageAssetId} size="display" fit="contain" interactive={false}/>}{entry.caption && <p className="website-detail-caption">{entry.caption}</p>}{entry.credit && <small className="website-detail-credit">{entry.credit}</small>}{!entry.blocks?.length && <p>{entry.body}</p>}{entry.blocks?.map(block => block.kind === 'heading' ? <h3 key={block.id}>{block.text}</h3> : <p key={block.id}>{block.text}</p>)}{!!entry.values?.length && <dl className="website-detail-values">{entry.values.map(value => <div key={value.label}><dt>{value.label}</dt><dd>{value.text}</dd></div>)}</dl>}{entry.example && <p>Illustrative example</p>}</article>}
    </dialog>
  </>;
}
