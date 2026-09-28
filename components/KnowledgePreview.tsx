'use client';
import LoadingIndicator from './LoadingIndicator';

import { useEffect, useState } from 'react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { SiteContent } from '@/lib/site-model';
import type { GreetingRecordTopic } from '@/lib/greeting-records';
import SiteExperience from './SiteExperience';
import { observePlatformEvent } from '@/lib/platform-client-events';

export default function KnowledgePreview({ content, siteId }: { content: SiteContent; siteId: string }) {
  const [loaded, setLoaded] = useState<{ id: string; catalog: KnowledgeCatalog } | null>(null);
  const [error, setError] = useState('');
  const [loadedMedia, setLoadedMedia] = useState<{ siteId: string; id: string; library: MediaLibrary } | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [greeting, setGreeting] = useState<{ key: string; topics: GreetingRecordTopic[]; error?: string } | null>(null);
  const greetingIds = (content.greetingPoints ?? []).flatMap(point => point?.kind === 'record' ? [point.id] : []).join(',');
  const catalogRevision = content.catalogPublicationId;
  const greetingKey = `${siteId}:${catalogRevision}:${greetingIds}`;
  const greetingLoaded = greeting?.key === greetingKey ? greeting : null;
  const mediaRevision = content.mediaRevisionId;
  const media = loadedMedia?.siteId === siteId && loadedMedia.id === mediaRevision ? loadedMedia.library : null;
  const revisionId = content.knowledgeRevisionId;
  const catalog = loaded && loaded.id === revisionId ? loaded.catalog : null;
  useEffect(() => {
    if (!revisionId) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/knowledge?revisionId=${encodeURIComponent(revisionId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.catalog) throw new Error(body.error || 'Knowledge preview is unavailable.'); if (!controller.signal.aborted) { setLoaded({ id: revisionId, catalog: body.catalog }); setError(''); observePlatformEvent(`/api/sites/${siteId}/events`, { type: 'preview', surface: 'preview', snapshotId: revisionId }); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [revisionId, siteId]);
  useEffect(() => {
    if (!mediaRevision) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/media?revisionId=${encodeURIComponent(mediaRevision)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !body.library) throw new Error(body.error || 'Photo preview is unavailable.'); if (!controller.signal.aborted) { setLoadedMedia({ siteId, id: mediaRevision, library: body.library }); setMediaError(''); } })
      .catch(error => { if (!controller.signal.aborted) setMediaError(error.message); });
    return () => controller.abort();
  }, [mediaRevision, siteId]);
  useEffect(() => {
    if (!catalogRevision || !greetingIds) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ revisionId: catalogRevision, selected: greetingIds, selectedOnly: 'true' });
    void fetch(`/api/sites/${siteId}/greeting?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok || !Array.isArray(body.selected)) throw new Error(body.error || 'Introduction preview is unavailable.'); if (!controller.signal.aborted) setGreeting({ key: greetingKey, topics: body.selected }); })
      .catch(error => { if (!controller.signal.aborted) setGreeting({ key: greetingKey, topics: [], error: error.message }); });
    return () => controller.abort();
  }, [catalogRevision, greetingIds, greetingKey, siteId]);
  return <>{revisionId && !catalog && <p className="knowledge-preview-status" role="status">{error || <LoadingIndicator label="Loading knowledge preview…"/>}</p>}{mediaRevision && !media && <p className="knowledge-preview-status" role="status">{mediaError || <LoadingIndicator label="Loading photo preview…"/>}</p>}{catalogRevision && greetingIds && (!greetingLoaded || greetingLoaded.error) && <p className="knowledge-preview-status" role="status">{greetingLoaded?.error || <LoadingIndicator label="Loading introduction preview…"/>}</p>}<SiteExperience siteId={siteId} content={content} catalog={catalog} media={media} greetingRecords={greetingLoaded?.topics}/></>;
}
