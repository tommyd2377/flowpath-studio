'use client';

import { useEffect, useState } from 'react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { SiteContent } from '@/lib/site-model';
import { DEFAULT_OPENING, openingCopy } from '@/lib/site-opening';

export default function OpeningSettings({ siteId, content, setContent, busy }: { siteId: string; content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; catalog: KnowledgeCatalog } | null>(null);
  const opening = content.opening ?? DEFAULT_OPENING;
  const catalog = loaded?.id === content.knowledgeRevisionId ? loaded?.catalog : null;
  useEffect(() => {
    if (!content.knowledgeRevisionId) return;
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/knowledge?revisionId=${encodeURIComponent(content.knowledgeRevisionId)}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (response.ok && body.catalog && !controller.signal.aborted) setLoaded({ id: body.catalog.id, catalog: body.catalog }); }).catch(() => undefined);
    return () => controller.abort();
  }, [siteId, content.knowledgeRevisionId]);
  const change = (patch: Partial<NonNullable<SiteContent['opening']>>) => setContent({ ...content, opening: { ...opening, ...patch } });
  const copy = openingCopy(content, catalog);
  return <section className="opening-settings"><div className="section-heading"><h3>Opening experience</h3></div><p className="field-help">Your opening is composed automatically from the current catalog or content sections. Personalize it here if you prefer. Save and publish to update your site.</p>
    <label className="field">Opening copy<select disabled={busy} value={opening.copyMode ?? 'automatic'} onChange={event => change({ copyMode: event.target.value as 'automatic' | 'personalized' })}><option value="automatic">Automatic — from site content</option><option value="personalized">Personalized — write your own</option></select></label>
    {opening.copyMode === 'personalized' ? <>
      <label className="field">Opening headline<input disabled={busy} value={content.headline} maxLength={140} onChange={event => setContent({ ...content, headline: event.target.value })}/></label>
      <label className="field">Introduction<textarea disabled={busy} rows={4} value={content.description} maxLength={1500} onChange={event => setContent({ ...content, description: event.target.value })}/></label>
    </> : <div className="field-help" aria-label="Automatic opening preview">{content.knowledgeRevisionId && !catalog ? 'Loading catalog opening…' : <><strong>{copy.headline}</strong><p>{copy.description}</p></>}</div>}
    <label className="field">Highlights<textarea disabled={busy} rows={3} value={opening.highlights.join('\n')} placeholder="One highlight per line, up to three" onChange={event => change({ highlights: event.target.value.split('\n').slice(0, 3) })} onBlur={() => change({ highlights: opening.highlights.map(value => value.trim()).filter(Boolean) })}/><span className="field-help">Up to 180 characters per highlight.</span></label>
    <label className="field">Tone<select disabled={busy} value={opening.tone} onChange={event => change({ tone: event.target.value as NonNullable<SiteContent['opening']>['tone'] })}><option value="warm">Warm</option><option value="direct">Direct</option><option value="calm">Calm</option></select></label>
    {(opening.featuredEntityIds.length > 0 || opening.capabilityIds.length > 0) && <button className="text-button muted" disabled={busy} onClick={() => change({ featuredEntityIds: [], capabilityIds: [] })}>Clear featured items and opening links</button>}
    {catalog && <><div className="field"><span>Featured items</span><div className="opening-choices">{catalog.entities.map(entity => <label key={entity.id}><input type="checkbox" disabled={busy || opening.featuredEntityIds.length >= 6 && !opening.featuredEntityIds.includes(entity.id)} checked={opening.featuredEntityIds.includes(entity.id)} onChange={event => change({ featuredEntityIds: event.target.checked ? [...opening.featuredEntityIds, entity.id] : opening.featuredEntityIds.filter(id => id !== entity.id) })}/>{entity.name}</label>)}</div></div>
      {!!catalog.capabilities?.length && <div className="field"><span>Opening calls to action</span><div className="opening-choices">{catalog.capabilities.map(capability => <label key={capability.id}><input type="checkbox" disabled={busy || opening.capabilityIds.length >= 3 && !opening.capabilityIds.includes(capability.id)} checked={opening.capabilityIds.includes(capability.id)} onChange={event => change({ capabilityIds: event.target.checked ? [...opening.capabilityIds, capability.id] : opening.capabilityIds.filter(id => id !== capability.id) })}/>{capability.label}</label>)}</div></div>}</>}
  </section>;
}
