'use client';

import { useEffect, useState } from 'react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { SiteContent } from '@/lib/site-model';
import { DEFAULT_OPENING, openingCopy } from '@/lib/site-opening';

export default function OpeningSettings({ siteId, content, setContent, busy }: { siteId: string; content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; catalog: KnowledgeCatalog } | null>(null);
  const [loadedMedia, setLoadedMedia] = useState<{ id: string; media: MediaLibrary } | null>(null);
  const opening = content.opening ?? DEFAULT_OPENING;
  const catalog = loaded?.id === content.knowledgeRevisionId ? loaded?.catalog : null;
  const media = loadedMedia && loadedMedia.id === content.mediaRevisionId ? loadedMedia.media : null;
  useEffect(() => {
    if (!content.knowledgeRevisionId) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/knowledge?revisionId=${encodeURIComponent(content.knowledgeRevisionId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (response.ok && body.catalog && !controller.signal.aborted) setLoaded({ id: body.catalog.id, catalog: body.catalog }); }).catch(() => undefined);
    return () => controller.abort();
  }, [siteId, content.knowledgeRevisionId]);
  useEffect(() => {
    if (!content.mediaRevisionId) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/media?revisionId=${encodeURIComponent(content.mediaRevisionId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (response.ok && body.library && !controller.signal.aborted) setLoadedMedia({ id: body.library.id, media: body.library }); }).catch(() => undefined);
    return () => controller.abort();
  }, [siteId, content.mediaRevisionId]);
  const change = (patch: Partial<NonNullable<SiteContent['opening']>>) => setContent({ ...content, opening: { ...opening, ...patch } });
  const copy = openingCopy(content, catalog);
  return <section className="opening-settings"><div className="section-heading"><h3>Opening experience</h3></div><p className="field-help">Choose what visitors see before they ask for more. Save and publish to update your site.</p>
    <label className="field">Opening visibility<select aria-label="Opening visibility" disabled={busy} value={opening.visibility ?? 'intro-only'} onChange={event => change({ visibility: event.target.value as 'intro-only' | 'publisher-selected' })}><option value="intro-only">Introduction first — reveal content on request</option><option value="publisher-selected">Publisher-selected — show chosen content immediately</option></select><span className="field-help">Introduction first keeps catalog items, sections, albums, and photos out of the initial view. Publisher-selected shows only the references you choose below.</span></label>
    <label className="field">Opening copy<select disabled={busy} value={opening.copyMode ?? 'automatic'} onChange={event => change({ copyMode: event.target.value as 'automatic' | 'personalized' })}><option value="automatic">Automatic — from site content</option><option value="personalized">Personalized — write your own</option></select></label>
    {opening.copyMode === 'personalized' ? <>
      <label className="field">Opening headline<input disabled={busy} value={content.headline} maxLength={140} onChange={event => setContent({ ...content, headline: event.target.value })}/></label>
      <label className="field">Introduction<textarea disabled={busy} rows={4} value={content.description} maxLength={1500} onChange={event => setContent({ ...content, description: event.target.value })}/></label>
    </> : <div className="field-help" aria-label="Automatic opening preview">{content.knowledgeRevisionId && !catalog ? 'Loading catalog opening…' : <><strong>{copy.headline}</strong><p>{copy.description}</p></>}</div>}
    <label className="field">Highlights<textarea disabled={busy} rows={3} value={opening.highlights.join('\n')} placeholder="One highlight per line, up to three" onChange={event => change({ highlights: event.target.value.split('\n').slice(0, 3) })} onBlur={() => change({ highlights: opening.highlights.map(value => value.trim()).filter(Boolean) })}/><span className="field-help">Up to 180 characters per highlight.</span></label>
    {(opening.featuredEntityIds.length > 0 || opening.initialSections?.length || opening.initialAlbumIds?.length || opening.initialAssetIds?.length || opening.capabilityIds.length > 0) && <button className="text-button muted" disabled={busy} onClick={() => change({ featuredEntityIds: [], initialSections: [], initialAlbumIds: [], initialAssetIds: [], capabilityIds: [] })}>Clear selected opening content</button>}
    {opening.visibility === 'publisher-selected' && <>
      {!!content.sections.length && <div className="field"><span>Opening sections</span><div className="opening-choices">{content.sections.map(section => <label key={section.id}><input type="checkbox" disabled={busy || (opening.initialSections?.length ?? 0) >= 6 && !opening.initialSections?.includes(section.id)} checked={opening.initialSections?.includes(section.id) ?? false} onChange={event => change({ initialSections: event.target.checked ? [...(opening.initialSections ?? []), section.id] : (opening.initialSections ?? []).filter(id => id !== section.id) })}/>{section.title}</label>)}</div></div>}
      {catalog && <div className="field"><span>Featured items</span><div className="opening-choices">{catalog.entities.map(entity => <label key={entity.id}><input type="checkbox" disabled={busy || opening.featuredEntityIds.length >= 6 && !opening.featuredEntityIds.includes(entity.id)} checked={opening.featuredEntityIds.includes(entity.id)} onChange={event => change({ featuredEntityIds: event.target.checked ? [...opening.featuredEntityIds, entity.id] : opening.featuredEntityIds.filter(id => id !== entity.id) })}/>{entity.name}</label>)}</div></div>}
      {media && <>
        {!!media.albums.length && <div className="field"><span>Opening albums</span><div className="opening-choices">{media.albums.map(album => <label key={album.id}><input type="checkbox" disabled={busy || (opening.initialAlbumIds?.length ?? 0) >= 6 && !opening.initialAlbumIds?.includes(album.id)} checked={opening.initialAlbumIds?.includes(album.id) ?? false} onChange={event => change({ initialAlbumIds: event.target.checked ? [...(opening.initialAlbumIds ?? []), album.id] : (opening.initialAlbumIds ?? []).filter(id => id !== album.id) })}/>{album.title}</label>)}</div></div>}
        {!!media.assets.length && <div className="field"><span>Opening photos</span><div className="opening-choices">{media.assets.map(asset => <label key={asset.id}><input type="checkbox" disabled={busy || (opening.initialAssetIds?.length ?? 0) >= 12 && !opening.initialAssetIds?.includes(asset.id)} checked={opening.initialAssetIds?.includes(asset.id) ?? false} onChange={event => change({ initialAssetIds: event.target.checked ? [...(opening.initialAssetIds ?? []), asset.id] : (opening.initialAssetIds ?? []).filter(id => id !== asset.id) })}/>{asset.caption || asset.alt || 'Photo'}</label>)}</div></div>}
      </>}
      {!!catalog?.capabilities?.length && <div className="field"><span>Opening calls to action</span><div className="opening-choices">{catalog.capabilities.map(capability => <label key={capability.id}><input type="checkbox" disabled={busy || opening.capabilityIds.length >= 3 && !opening.capabilityIds.includes(capability.id)} checked={opening.capabilityIds.includes(capability.id)} onChange={event => change({ capabilityIds: event.target.checked ? [...opening.capabilityIds, capability.id] : opening.capabilityIds.filter(id => id !== capability.id) })}/>{capability.label}</label>)}</div></div>}
    </>}
  </section>;
}
