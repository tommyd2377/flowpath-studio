'use client';
import { useState } from 'react';
import { PublishedWebsite } from '@thevoice/platform-ui';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { applyWebsiteDesign, type WebsiteDesign, type WebsiteProposal } from '@/lib/website-import-model';
import type { SiteContent } from '@/lib/site-model';
import { siteStyle } from '@/lib/site-style';
import { websiteSections } from '@/lib/website-presentation';
import { publishedWorkspace } from '@/lib/visitor-workspace';

export default function WebsiteDesignReview({ proposal, design, content, catalog, disabled, onChange, include, onInclude, acceptPartial, onAcceptPartial }: {
  proposal: WebsiteProposal; design: WebsiteDesign; content: SiteContent; catalog: KnowledgeCatalog; disabled: boolean; onChange: (design: WebsiteDesign) => void;
  include: boolean; onInclude: (value: boolean) => void; acceptPartial: boolean; onAcceptPartial: (value: boolean) => void;
}) {
  const [query, setQuery] = useState(''), [opened, setOpened] = useState<string | null>(null), [mobile, setMobile] = useState(false);
  const preview = applyWebsiteDesign(content, { ...design, name: design.name.trim() || content.name, headline: design.headline.trim() || content.headline });
  const authority = publishedWorkspace(preview, catalog);
  const sections = websiteSections(authority, preview, catalog);
  const entries = sections.flatMap(section => section.entries);
  const record = authority.records.find(record => `${record.reference.kind}:${record.reference.id}` === opened);
  const partial = proposal.pages.some(page => page.status === 'failed' || page.status === 'skipped');
  return <section className="website-design-review" aria-label="Website design proposal">
    <h3>Your FlowPath website</h3><p>Review the captured pages and the identity and semantic fallback design. Existing draft sections and photos are retained.</p>
    <details><summary>Page import report · {proposal.pages.filter(page => page.status === 'imported').length} imported</summary><ul className="website-page-list">{proposal.pages.map((page, i) => <li key={`${page.url}:${i}`}><strong>{page.title} · {page.status}</strong><small>{page.url}</small><p>{page.message}</p></li>)}</ul><p className="field-help">Captured {new Date(proposal.capturedAt).toLocaleString()}. Applying uses this snapshot.</p></details>
    {proposal.notes.map(note => <p className="field-help" key={note}>{note}</p>)}
    {partial && <label className="website-check"><input type="checkbox" checked={acceptPartial} disabled={disabled} onChange={event => onAcceptPartial(event.target.checked)}/> I reviewed the missing pages and want to apply this partial import.</label>}
    <label className="website-check"><input type="checkbox" checked={include} disabled={disabled} onChange={event => onInclude(event.target.checked)}/> Apply this design with the knowledge</label>
    <div className="website-design-fields">
      <label className="field">Website name<input value={design.name} maxLength={80} disabled={disabled} onChange={event => onChange({ ...design, name: event.target.value })}/></label>
      <label className="field">Website headline<input value={design.headline} maxLength={140} disabled={disabled} onChange={event => onChange({ ...design, headline: event.target.value })}/></label>
      <label className="field">Website introduction<textarea value={design.description} maxLength={1500} disabled={disabled} onChange={event => onChange({ ...design, description: event.target.value })}/></label>
      <label className="field">Imported contact<input value={design.contact ?? content.contact} maxLength={180} disabled={disabled} onChange={event => onChange({ ...design, contact:event.target.value })}/></label><label className="field">Imported hours<input value={design.hours ?? content.hours} maxLength={180} disabled={disabled} onChange={event => onChange({ ...design, hours:event.target.value })}/></label>
      <label className="field">Brand color<input type="color" value={design.accent} disabled={disabled} onChange={event => onChange({ ...design, accent: event.target.value })}/></label>
      <label className="field">Website palette<select value={design.style?.palette ?? 'parchment'} disabled={disabled} onChange={event => onChange({ ...design, style: { layout: 'editorial', ...design.style, palette: event.target.value as 'midnight' | 'forest' | 'parchment' } })}><option value="parchment">Parchment</option><option value="midnight">Midnight</option><option value="forest">Forest</option></select></label>
      <label className="field">Website layout<select value={design.style?.layout ?? 'editorial'} disabled={disabled} onChange={event => onChange({ ...design, style: { palette: 'parchment', ...design.style, layout: event.target.value as 'balanced' | 'editorial' | 'compact' } })}><option value="editorial">Editorial</option><option value="balanced">Balanced</option><option value="compact">Compact</option></select></label>
      <label className="field">First view<select value={design.style?.entry ?? 'website'} disabled={disabled} onChange={event => onChange({ ...design, style: { palette: 'parchment', layout: 'editorial', ...design.style, entry: event.target.value as 'website' | 'assistant' } })}><option value="website">Complete website</option><option value="assistant">Assistant opening</option></select></label>
    </div>
    <details className="website-preview"><summary>Preview proposed website</summary>
      <p className="field-help">Private design preview. Knowledge still needs review. No model calls are made by this preview.</p>
      <button type="button" className="button secondary" aria-pressed={mobile} onClick={() => setMobile(value => !value)}>{mobile ? 'Show desktop preview' : 'Show mobile preview'}</button>
      <div className="website-design-preview" data-mobile={mobile} style={siteStyle(preview)}>
        <PublishedWebsite name={preview.name} headline={preview.headline} description={preview.description} layout={preview.style?.layout} sections={sections} contact={preview.contact} hours={preview.hours}
          onOpen={setOpened} onHome={() => { setOpened(null); setQuery(''); }} onInteraction={() => {}} query={query} onQueryChange={setQuery} searchResults={entries.filter(entry => `${entry.name} ${entry.body} ${catalog.entities.find(entity => `entity:${entity.id}` === entry.id)?.blocks?.map(block => block.text).join(' ') ?? ''}`.toLowerCase().includes(query.toLowerCase()))}/>
        {record && <article className="website-preview-detail" aria-label="Preview reading detail"><button type="button" onClick={() => setOpened(null)}>Close detail</button><h3>{record.name}</h3>{catalog.entities.find(entity => entity.id === record.reference.id)?.blocks?.map(block => <p key={block.id}>{block.text}</p>) ?? <p>{record.body}</p>}</article>}
      </div>
    </details>
  </section>;
}
