'use client';

import type { SiteContent } from '@/lib/site-model';
import { exploreSettings, type ExploreSettings as Settings } from '@/lib/explore-model';

export default function ExploreSettings({ content, setContent, busy }: { content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean }) {
  const settings = exploreSettings(content);
  const change = (patch: Partial<Settings>) => setContent({ ...content, explore: { ...settings, ...patch } });
  return <section aria-label="Search and explore settings">
    <div className="section-heading"><h3>Search and explore</h3></div>
    <label className="field"><span><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={event => change({ enabled: event.target.checked })}/> Allow visitors to search beyond this site</span>
      <span className="field-help">Optional and off by default. Save and publish to enable cited web results. Outside information stays separate from your published knowledge.</span>
    </label>
    {settings.enabled && <>
      <label className="field"><span><input type="checkbox" checked={settings.images} disabled={busy} onChange={event => change({ images: event.target.checked })}/> Web image search</span></label>
      <label className="field"><span><input type="checkbox" checked={settings.maps} disabled={busy} onChange={event => change({ maps: event.target.checked })}/> Interactive maps</span><span className="field-help">Maps load from OpenStreetMap. Map positions are approximate area overviews, not verified business locations or directions.</span></label>
      <label className="field">Search websites<input disabled={busy} value={settings.allowedDomains.join(', ')} placeholder="Any public website, or e.g. wikipedia.org, nps.gov" onChange={event => change({ allowedDomains: event.target.value ? event.target.value.split(',').map(value => value.trim()) : [] })}/><span className="field-help">Optional: up to 8 domains, separated by commas. Subdomains are included. This restricts web and image sources; the map background still comes from OpenStreetMap.</span></label>
      <label className="field">Daily search limit<input type="number" min={1} max={100} step={1} disabled={busy} value={settings.dailyLimit} onChange={event => change({ dailyLimit: Number(event.target.value) })}/><span className="field-help">Shared across all visitors and voice searches; resets at midnight UTC. Each request allows at most one web-search tool call. Failed or cancelled attempts count. Search and model usage have API costs. Opening results and changing views do not search again.</span></label>
      <p className="field-help">External images load from their source hosts; attribution does not grant reuse rights. Studio previews use synthetic results and make no external requests.</p>
    </>}
  </section>;
}
