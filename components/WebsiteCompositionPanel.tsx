'use client';

import { useEffect, useRef, useState } from 'react';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import type { WebsiteCompositionPlan } from '@thevoice/platform-ui/website-composition';
import type { Site, SiteContent } from '@/lib/site-model';
import { buildWebsiteCompositionManifest, resolveWebsiteComposition, validateWebsiteCompositionPlan } from '@/lib/website-composition';
import styles from './BrandingPanel.module.css';

/** The parent keys this review to the exact draft; editing or leaving cancels its request. */
export default function WebsiteCompositionPanel({ site, content, setContent, catalog, media, busy, unsaved, connected, ready }: {
  site: Site; content: SiteContent; setContent: (content: SiteContent) => void;
  catalog: KnowledgeCatalog | null; media: MediaLibrary | null; busy: boolean; unsaved: boolean; connected: boolean; ready: boolean;
}) {
  const [proposal, setProposal] = useState<WebsiteCompositionPlan | null>(null);
  const [running, setRunning] = useState(false), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  const manifest = ready ? buildWebsiteCompositionManifest(content, catalog, media) : null;
  const current = ready ? resolveWebsiteComposition(content, catalog, media) : null;
  async function suggest(mode: 'local' | 'ai') {
    if (request.current || busy || unsaved || !manifest) return;
    const controller = new AbortController(); request.current = controller; setRunning(true); setError(''); setProposal(null);
    try {
      const response = await fetch(`/api/sites/${site.id}/website-composition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: site.revision, mode }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The layout suggestion could not be prepared.');
      if (!controller.signal.aborted) setProposal(validateWebsiteCompositionPlan(result.plan, manifest));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'The layout suggestion could not be prepared.'); }
    finally { if (!controller.signal.aborted) { request.current = null; setRunning(false); } }
  }
  const cancel = () => { request.current?.abort(); request.current = null; setRunning(false); setProposal(null); requestAnimationFrame(() => trigger.current?.focus()); };
  return <fieldset className={styles.fieldset}>
    <legend>Arrange your website</legend>
    <p className="field-help">Review a suggested section order, navigation and opening photo. Your saved visual choices and content stay in place. Apply the suggestion, preview it, then save your draft.</p>
    {unsaved && <p className={styles.notice}>Save your current draft before requesting a new layout.</p>}
    {ready && content.websiteComposition && !current && <p className={styles.notice}>Your content or styling has changed since the last layout suggestion. The website uses its default arrangement until you review a fresh suggestion.</p>}
    {current && <p className="field-help">A reviewed layout is applied to this draft.</p>}
    {manifest?.guidance.map(note => <p className={styles.notice} key={note}>{note}</p>)}
    <div className={styles.compositionActions}>
      <button ref={trigger} type="button" className="button secondary" disabled={busy || unsaved || running || !ready || !!manifest?.guidance.length} onClick={() => void suggest('local')}>Suggest layout</button>
      {connected && <button type="button" className="button secondary" disabled={busy || unsaved || running || !ready || !!manifest?.guidance.length} onClick={() => void suggest('ai')}>Suggest with AI</button>}
      {running && <button type="button" className="text-button" onClick={cancel}>Cancel layout suggestion</button>}
      {content.websiteComposition && <button type="button" className="text-button" disabled={busy} onClick={() => { const next = { ...content }; delete next.websiteComposition; setContent(next); }}>Reset layout</button>}
    </div>
    {running && <p role="status">Preparing your layout suggestion…</p>}
    {error && <p role="alert">{error}</p>}
    {proposal && <section aria-label="Website layout proposal" className={styles.compositionReview}>
      <h3>Suggested layout</h3>
      {proposal.reviewNotes.map(note => <p key={note}>{note}</p>)}
      <ol>{proposal.sectionOrder.map(id => <li key={id}>{manifest?.sections.find(section => section.id === id)?.title ?? id}</li>)}</ol>
      <p><strong>Navigation:</strong> {proposal.navigation.map(item => item.label).join(' · ') || 'No section links yet'}</p>
      <p><strong>Primary action:</strong> {proposal.primaryAction?.label ?? 'Default action'}</p>
      <p><strong>Opening photo:</strong> {manifest?.eligibleHeroAssets.find(asset => asset.id === proposal.heroAssetId)?.caption || 'Text introduction'}</p>
      <div className={styles.compositionActions}><button type="button" className="button primary" disabled={busy || unsaved} onClick={event => { const panel = event.currentTarget.closest('.settings-panel'); setContent({ ...content, style: content.style ?? proposal.style, websiteComposition: proposal }); requestAnimationFrame(() => panel?.querySelector<HTMLButtonElement>('.save-bar button')?.focus()); }}>Apply layout to draft</button><button type="button" className="text-button" onClick={cancel}>Discard layout proposal</button></div>
    </section>}
  </fieldset>;
}
