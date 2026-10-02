'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, Image as ImageIcon, RotateCcw } from 'lucide-react';
import { MediaProvider, PublishedWebsite } from '@thevoice/platform-ui';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { CURATED_PALETTES, FONT_PAIRINGS, SITE_PALETTES, WEBSITE_TEMPLATES, effectiveWebsiteTemplate, resetWebsiteStyle, selectWebsiteTemplate, websiteDesignTokens, type SiteDesign, type WebsiteTemplate } from '@thevoice/platform-ui/site-design';
import type { Site, SiteContent } from '@/lib/site-model';
import { publishedWorkspace } from '@/lib/visitor-workspace';
import { websiteEntry, websiteHeroId, websiteSections } from '@/lib/website-presentation';
import { openingCopy } from '@/lib/site-opening';
import type { UploadFiles } from './MediaPanel';
import styles from './BrandingPanel.module.css';
import WebsiteCompositionPanel from './WebsiteCompositionPanel';

const noop = () => {};
export default function BrandingPanel({ connected = false, site, content, setContent, busy, unsaved, upload, save }: {
  connected?: boolean; site: Site; content: SiteContent; setContent: (content: SiteContent) => void; busy: boolean; unsaved: boolean; upload: UploadFiles; save: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ key: string; catalog: KnowledgeCatalog | null; media: MediaLibrary | null }>();
  const [error, setError] = useState('');
  const key = `${site.id}:${content.knowledgeRevisionId ?? ''}:${content.mediaRevisionId ?? ''}`;
  useEffect(() => {
    const controller = new AbortController();
    const read = async (path: string) => { const response = await fetch(path, { signal: controller.signal, cache: 'no-store' }); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Preview unavailable.'); return body; };
    void Promise.all([
      content.knowledgeRevisionId ? read(`/api/sites/${site.id}/knowledge?revisionId=${content.knowledgeRevisionId}`) : Promise.resolve(null),
      content.mediaRevisionId ? read(`/api/sites/${site.id}/media?revisionId=${content.mediaRevisionId}`) : Promise.resolve(null),
    ]).then(([knowledge, media]) => { if (!controller.signal.aborted) { setPreview({ key, catalog: knowledge?.catalog ?? null, media: media?.library ?? null }); setError(''); } }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [site.id, content.knowledgeRevisionId, content.mediaRevisionId, key]);
  const catalog = !content.catalogPublicationId && preview?.key === key ? preview.catalog : null, media = preview?.key === key ? preview.media : null;
  const style = content.style;
  const effectiveTemplate = effectiveWebsiteTemplate(style);
  const change = <K extends keyof SiteContent>(key: K, value: SiteContent[K]) => setContent({ ...content, [key]: value });
  const updateStyle = (patch: Partial<SiteDesign>) => change('style', { layout: 'balanced', palette: 'midnight', ...style, ...patch, customized: [...new Set([...(style?.customized ?? []), ...Object.keys(patch).filter(key => key !== 'entry' && key !== 'paletteVersion') as NonNullable<SiteDesign['customized']>])] });
  return <div className="settings-panel">
    <div className="panel-heading"><span className="eyebrow">A place that feels like you</span><h2>Branding</h2><p>Choose a starting point. Make a few adjustments. Your content does the rest.</p></div>
    <WebsiteCompositionPanel key={`${site.id}:${site.revision}:${JSON.stringify(content)}`} site={site} content={content} setContent={setContent} busy={busy} unsaved={unsaved} catalog={content.catalogPublicationId ? null : catalog} media={media} connected={connected} ready={preview?.key === key}/>
    <fieldset className={styles.fieldset}><legend>Choose your template</legend><p className="field-help">Previews use your draft. The full preview beside this panel updates immediately; use its desktop and mobile controls.</p>
      {!style?.template && <p className={styles.notice}>Your website uses the {WEBSITE_TEMPLATES[effectiveTemplate].name} layout with your saved colors and content. Customize it below, or preview another template. Changes stay in your draft until you Publish.</p>}
      {error && <p role="alert">{error} Template previews currently show only the site information available here.</p>}
      {!preview && !error && (content.knowledgeRevisionId || content.mediaRevisionId) && <p role="status">Loading your content for the template previews…</p>}
      <p className="field-help">Your custom styling choices travel with you. Reset styling below to use every default of the selected template.</p>
      <div className={styles.templates}>{(Object.keys(WEBSITE_TEMPLATES) as WebsiteTemplate[]).map(id => {
        const template = WEBSITE_TEMPLATES[id], sample = { ...content, style: selectWebsiteTemplate(style, id) };
        const authority = publishedWorkspace(sample, catalog, media), heroId = websiteHeroId(sample, media);
        const hero = authority.records.find(record => record.reference.kind === 'photo' && record.reference.id === heroId);
        return <div className={styles.template} data-selected={style?.template === id} key={id}>
          <div className={styles.thumbnail} aria-hidden="true" inert><div className={styles.miniature} data-site-template={id} style={websiteDesignTokens(sample.style, content.accent)}>
            <MediaProvider library={media} resolveAssetUrl={(assetId, size) => `/api/files/${site.id}/${assetId}${size === 'thumb' ? '?size=thumb' : ''}`}>
              <PublishedWebsite name={content.name} tagline={content.tagline} {...openingCopy(sample, catalog)} template={id} websiteMotion="off" hero={hero ? websiteEntry(hero, media) : undefined} logoAssetId={content.logoAssetId} sections={websiteSections(authority, sample, catalog, media)} onOpen={noop} onHome={noop} onInteraction={noop} assistantEnabled={false}/>
            </MediaProvider>
          </div></div>
          <button type="button" className={styles.choose} disabled={busy} aria-pressed={style?.template === id} onClick={() => change('style', selectWebsiteTemplate(style, id))}><span><strong>{template.name}</strong><small>{template.description}</small></span>{style?.template === id ? <Check size={18}/> : <span aria-hidden="true">↗</span>}</button>
        </div>;
      })}</div>
    </fieldset>
    <fieldset className={styles.fieldset}><legend>Identity</legend>
      <label className="field">Site name<input disabled={busy} value={content.name} maxLength={80} onChange={e => change('name', e.target.value)}/></label>
      <label className="field">Short tagline<input disabled={busy} value={content.tagline ?? ''} maxLength={180} placeholder="A few words that describe you" onChange={e => change('tagline', e.target.value)}/></label>
      <div className="field"><span>Logo</span><div className="logo-field">{content.logoAssetId ? <Image unoptimized width={54} height={54} alt="Current logo" src={`/api/files/${site.id}/${content.logoAssetId}`}/> : <div className="logo-placeholder"><ImageIcon size={22}/></div>}
        <div><strong>{content.logoAssetId ? 'Your site logo' : 'Make a familiar first impression'}</strong><p>PNG, JPEG, or WebP · up to 10 MB</p><div className="inline-actions"><button className="text-button" disabled={busy || unsaved} onClick={() => input.current?.click()}>Upload a logo</button>{content.logoAssetId && <button className="text-button" disabled={busy} onClick={() => change('logoAssetId', null)}>Remove logo</button>}</div></div>
        <input hidden type="file" ref={input} accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(e.target.files); e.target.value = ''; }}/>
      </div><span className="field-help">After uploading, choose “Use as logo” in Files.</span></div>
    </fieldset>
    <fieldset className={styles.fieldset} disabled={busy}><legend>Colors</legend><p className="field-help">Soft neutrals, vivid color, or a bold dark canvas. Your palette carries through the website and assistant.</p>
      {style?.paletteVersion !== 2 && ['linen', 'ink', 'cloud', 'sage'].includes(style?.palette ?? '') && <p className="field-help">Your saved colors are retained. Choose a swatch to preview its refreshed colors.</p>}
      <div className={styles.palettes}>{Object.entries(SITE_PALETTES).filter(([id]) => (CURATED_PALETTES as readonly string[]).includes(id) || id === style?.palette).map(([id, palette]) => <button key={id} type="button" aria-pressed={style?.palette === id} className={styles.palette} onClick={() => updateStyle({ palette: id as SiteDesign['palette'], paletteVersion: 2 })}><span className={styles.swatches} aria-hidden="true">{[palette.background, palette.surface, palette.accent].map(color => <i key={color} style={{ background: color }}/>)}</span>{palette.label}</button>)}</div>
      <label className={styles.toggle}><input type="checkbox" checked={style?.customAccent ?? false} onChange={event => updateStyle({ customAccent: event.target.checked })}/>Use a custom accent color</label>
      {style?.customAccent && <label className="field">Brand accent<div className="color-row"><input type="color" aria-label="Brand color" value={content.accent} onChange={event => change('accent', event.target.value)}/><span>{content.accent.toUpperCase()}</span></div><span className="field-help">If the color is too light or dark to read, text and buttons use the palette’s accessible accent.</span></label>}
    </fieldset>
    <fieldset className={styles.fieldset} disabled={busy}><legend>Typography</legend><div className={styles.fonts}>{Object.entries(FONT_PAIRINGS).map(([id, font]) => <button type="button" key={id} aria-pressed={(style?.typography ?? WEBSITE_TEMPLATES[effectiveTemplate].defaults.typography) === id} onClick={() => updateStyle({ typography: id as SiteDesign['typography'] })}><span style={{ fontFamily: font.heading, fontWeight: font.weight }}>Your story, beautifully told.</span><small>{font.label} · {font.description}</small></button>)}</div>
      <div className={styles.controls}><label className="field">Text size<select value={style?.textSize ?? 'standard'} onChange={event => updateStyle({ textSize: event.target.value as SiteDesign['textSize'] })}><option value="standard">Standard</option><option value="larger">Larger</option></select></label>
      <label className="field">Spacing<select value={style?.spacing ?? 'comfortable'} onChange={event => updateStyle({ spacing: event.target.value as SiteDesign['spacing'] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></label></div>
    </fieldset>
    <fieldset className={styles.fieldset} disabled={busy}><legend>Website motion</legend>
      <label className="field">Scrolling &amp; transitions<select value={style?.websiteMotion ?? 'subtle'} onChange={event => updateStyle({ websiteMotion: event.target.value as SiteDesign['websiteMotion'] })}><option value="off">Off</option><option value="subtle">Subtle</option><option value="expressive">Expressive</option></select></label>
      <p className="field-help">Subtle adds quiet section entrances. Expressive adds your template’s signature effects. Applies to the regular website; visitors who prefer reduced motion see a still page.</p>
    </fieldset>
    {style?.template && <button type="button" className="button secondary" disabled={busy} onClick={() => change('style', resetWebsiteStyle(style))}><RotateCcw size={16}/>Reset styling to template defaults</button>}
    <div className="save-bar"><span>{unsaved ? 'Save your styling in the draft, then Publish when ready.' : 'Your saved draft is up to date.'}</span><button className="button primary" disabled={busy || !unsaved} onClick={save}><Check size={16}/>Save draft</button></div>
  </div>;
}
