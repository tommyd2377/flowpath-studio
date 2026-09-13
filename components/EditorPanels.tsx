'use client';
import LoadingIndicator from './LoadingIndicator';

import Image from 'next/image';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight, Check, CircleHelp, FileText, Globe2, Image as ImageIcon, Link2, Plus, Trash2, Upload, X } from 'lucide-react';
import type { Site, SiteContent } from '@/lib/site-model';
import type { WorkspaceUser } from '@/lib/firebase/types';
import type { EditorStatus } from '@/lib/editor-types';
import GreetingSettings from './GreetingSettings';
import { SITE_PALETTES } from '@/lib/site-style';
import VisitorSettings from './VisitorSettings';
import ExploreSettings from './ExploreSettings';
import OpeningSettings from './OpeningSettings';
import RecentActivity from './RecentActivity';
import BillingPanel from './BillingPanel';
import MediaPanel, { type UploadFiles } from './MediaPanel';

export type Panel = 'chat' | 'branding' | 'content' | 'knowledge' | 'files' | 'domains' | 'billing';
export type Command = { action: string; [key: string]: unknown };
type Props = {
  editor: EditorStatus; mode: WorkspaceUser['mode']; panel: Panel; site: Site; content: SiteContent; setContent: (content: SiteContent) => void;
  busy: boolean; unsaved: boolean; mediaPending: boolean; command: (action: Command) => Promise<void>; upload: UploadFiles;
  onMediaBusyChange: (busy: boolean) => void; onMediaSiteChange: (site: Site) => void; onMediaDirtyChange: (dirty: boolean) => void;
};

export function EditorPanels({ editor, mode, panel, site, content, setContent, busy, unsaved, mediaPending, command, upload, onMediaBusyChange, onMediaSiteChange, onMediaDirtyChange }: Props) {
  const cloud = mode === 'firebase';
  const input = useRef<HTMLInputElement>(null);
  const change = (key: keyof SiteContent, value: unknown) => setContent({ ...content, [key]: value });
  const save = () => void command({ action: 'save', content });
  const saveBar = <div className="save-bar"><span>{unsaved ? 'Save to keep these changes in your draft.' : 'Your draft is up to date.'}</span><button className="button primary" disabled={busy || !unsaved} onClick={save}><Check size={16}/>Save draft</button></div>;

  if (panel === 'branding') return <div className="settings-panel">
    <div className="panel-heading"><span className="eyebrow">Make it yours</span><h2>Branding</h2><p>The details that make your site feel like you.</p></div>
    <label className="field">Site name<input disabled={busy} value={content.name} maxLength={80} onChange={e => change('name', e.target.value)}/></label>
    <div className="field"><span>Logo</span><div className="logo-field">
      {content.logoAssetId ? <Image unoptimized width={54} height={54} alt="Current logo" src={`/api/files/${site.id}/${content.logoAssetId}`}/> : <div className="logo-placeholder"><ImageIcon size={22}/></div>}
      <div><strong>{content.logoAssetId ? 'Your site logo' : 'A familiar first impression'}</strong><p>PNG, JPEG, or WebP · up to 10 MB</p><div className="inline-actions"><button className="text-button" disabled={busy || unsaved} onClick={() => input.current?.click()}>Upload a logo</button>{content.logoAssetId && <button className="text-button muted" disabled={busy} onClick={() => change('logoAssetId', null)}>Remove</button>}</div></div>
      <input hidden type="file" ref={input} accept="image/png,image/jpeg,image/webp" onChange={e => { upload(e.target.files); e.target.value = ''; }}/>
    </div><span className="field-help">After uploading, choose “Use as logo” in Files.</span></div>
    <div className="field"><span>Brand accent</span><div className="color-row"><input disabled={busy} type="color" aria-label="Brand color" value={content.accent} onChange={e => change('accent', e.target.value)}/><span className="color-code">{content.accent.toUpperCase()}</span></div>
      <div className="palette">{['#c8ac85', '#a9bf99', '#829de5', '#b2a2e3', '#dfa4b7', '#87c6be'].map(color => <button disabled={busy} aria-label={`Use color ${color}`} aria-pressed={content.accent === color} key={color} style={{ background: color }} onClick={() => change('accent', color)}>{content.accent === color && <Check size={16}/>}</button>)}</div>
    </div>
    <div className="info-note"><CircleHelp size={16}/><p>Your accent appears on borders, highlighted content, and small details in the shared FlowPath layout.</p></div>
    <label className="field">Visitor layout<select disabled={busy} value={content.style?.layout ?? 'balanced'} onChange={event => change('style', { palette: content.style?.palette ?? 'midnight', layout: event.target.value })}>
      <option value="balanced">Balanced · equal objects</option><option value="editorial">Editorial · generous reading</option><option value="compact">Compact · more at a glance</option>
    </select></label>
    <label className="field">Visitor palette<select disabled={busy} value={content.style?.palette ?? 'midnight'} onChange={event => change('style', { layout: content.style?.layout ?? 'balanced', palette: event.target.value })}>
      {Object.entries(SITE_PALETTES).map(([id, palette]) => <option key={id} value={id}>{palette.label}</option>)}
    </select><span className="field-help">Three accessible palettes share the same content, controls, and motion. Save and publish to update visitors.</span></label>
    {saveBar}
  </div>;

  if (panel === 'content') return <div className="settings-panel">
    <div className="panel-heading"><span className="eyebrow">Your story</span><h2>Content</h2><p>Keep the information on your site clear and current.</p></div>
    <label className="field">Hours or availability<input disabled={busy} value={content.hours} maxLength={180} onChange={e => change('hours', e.target.value)}/></label>
    <label className="field">Contact information<input disabled={busy} value={content.contact} maxLength={180} onChange={e => change('contact', e.target.value)}/></label>
    <VisitorSettings content={content} setContent={setContent} busy={busy}/>
    <ExploreSettings content={content} setContent={setContent} busy={busy}/>
    <GreetingSettings key={site.id} siteId={site.id} content={content} setContent={setContent} busy={busy}/>
    <OpeningSettings siteId={site.id} content={content} setContent={setContent} busy={busy}/>
    <div className="section-heading"><h3>Content sections</h3><span>{content.sections.length} / 12</span></div>
    {content.sections.map((section, index) => <div className="section-editor" key={section.id}>
      <div className="section-editor-top"><span>Section {String(index + 1).padStart(2, '0')}</span><button className="icon-button" aria-label={`Remove ${section.title}`} disabled={busy} onClick={() => change('sections', content.sections.filter(item => item.id !== section.id))}><Trash2 size={15}/></button></div>
      <label className="field">Title<input disabled={busy} value={section.title} maxLength={100} onChange={e => change('sections', content.sections.map(item => item.id === section.id ? { ...item, title: e.target.value } : item))}/></label>
      <label className="field">Details<textarea disabled={busy} rows={4} maxLength={2500} value={section.body} onChange={e => change('sections', content.sections.map(item => item.id === section.id ? { ...item, body: e.target.value } : item))}/></label>
    </div>)}
    <button className="button secondary" disabled={busy || content.sections.length >= 12} onClick={() => change('sections', [...content.sections, { id: crypto.randomUUID(), title: 'New section', body: 'Add the details you want visitors to know.' }])}><Plus size={16}/>Add section</button>
    {saveBar}
  </div>;

  if (panel === 'files') return <div className="settings-panel">
    <div className="panel-heading"><span className="eyebrow">Your source material</span><h2>Files</h2><p>Keep photos, logos, documents, and information together.</p></div>
    <MediaPanel site={site} blocked={busy || unsaved} connected={editor.mode === 'openai'} upload={upload} onBusyChange={onMediaBusyChange} onSiteChange={onMediaSiteChange} onDirtyChange={onMediaDirtyChange}/>
    <div className="media-files-heading"><h3>Documents & original uploads</h3><p>Keep reference material and choose a site logo here.</p></div>
    {site.history.length > 0 && <details><summary>Files protected by Undo history</summary><p className="field-help">After removing photos or a logo and publishing, clear Undo history to delete originals retained only by earlier drafts. This permanently removes the ability to restore those drafts. Your current draft and published site stay unchanged.</p><button className="text-button" disabled={busy || unsaved || mediaPending} onClick={() => { if (window.confirm(`Clear all Undo history for ${site.draft.name}? Earlier drafts cannot be restored. Current draft, publication and files will remain.`)) void command({ action: 'clear-history' }); }}>Clear Undo history</button></details>}
    <button className="upload-zone" disabled={busy || unsaved} onClick={() => input.current?.click()}><Upload size={24}/><strong>Choose files to upload</strong><span>Images and PDFs · 10 MB. DOCX, XLSX or HTML · 2 MB. CSV or text · 256 KB.</span></button>
    <input hidden aria-label="Upload source files" multiple ref={input} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,text/plain,text/csv,.docx,.xlsx,.html,.htm,.txt,.csv" onChange={e => { void upload(e.target.files); e.target.value = ''; }}/>
    <p className="field-help">{cloud ? 'Files are saved in your Firebase workspace' : 'Files stay on this computer'}, with up to 100 photos, 20 documents, and 100 MB of total storage per site. Open Knowledge to interpret CSV, text, DOCX, XLSX, HTML, OCR images and text-bearing PDFs. {editor.mode === 'openai' ? 'Choose up to three text files in the editor to include in your next AI message. Uploads are not sent to OpenAI automatically.' : editor.mode === 'demo' ? 'Text files can be added to your site through the demo editor.' : 'AI editing is unavailable. You can still manage your files here.'}</p>
    <div className="file-list">{site.files.length ? site.files.map(file => <div className="file-row" key={file.id}>
      <div className="file-icon">{file.kind === 'image' ? <ImageIcon size={20}/> : <FileText size={20}/>}</div>
      <div className="file-info"><a href={`/api/files/${site.id}/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name}</a><span>{Math.max(1, Math.round(file.size / 1024))} KB · {file.kind === 'pdf' || /(?:docx|xlsx|html?)$/i.test(file.name) ? 'Ready for Knowledge interpretation' : file.kind === 'text' ? (editor.mode === 'openai' && /^text\/(?:plain|csv)$/.test(file.mime) ? 'Available to select for chat' : editor.mode === 'demo' ? 'Ready for demo chat' : 'Stored') : file.kind === 'image' ? 'Available for OCR or photos' : 'Ready to use'}</span>
        {file.kind === 'image' && <button className="text-button" disabled={busy || unsaved || site.draft.logoAssetId === file.id} onClick={() => void command({ action: 'use-logo', fileId: file.id })}>{site.draft.logoAssetId === file.id ? 'Current logo' : 'Use as logo'}</button>}
      </div><button className="icon-button" aria-label={`Delete ${file.name}`} title={site.published?.logoAssetId === file.id ? "Replace or remove this published logo and publish before deleting it." : mediaPending ? 'Apply or discard photo changes before deleting original uploads.' : undefined} disabled={busy || unsaved || mediaPending || site.published?.logoAssetId === file.id} onClick={() => void command({ action: 'remove-file', fileId: file.id })}><Trash2 size={16}/></button>
    </div>) : <div className="empty-files"><FileText size={28}/><h3>A home for your files</h3><p>Add a logo or a text document to try your first upload.</p></div>}</div>
  </div>;

  if (panel === 'domains') return <div className="settings-panel">
    <div className="panel-heading"><span className="eyebrow">Your place on the web</span><h2>Domains</h2><p>A platform address to start. Your own domain when you’re ready.</p></div>
    <div className="domain-card"><div className="section-heading"><Globe2 size={20}/><span className="badge">{cloud ? 'Site path' : 'Local preview'}</span></div><h3>Included site address</h3><code>/s/{site.slug}</code><p>{cloud ? 'This path serves your published site in this app. Platform subdomains will be connected when hosting is set up.' : 'This address works on your local server after you publish. A real subdomain will be connected when hosting is set up.'}</p>{site.publishedAt && <a className="button secondary" target="_blank" rel="noopener noreferrer" href={`/s/${site.slug}`}>Open published site <ArrowUpRight size={16}/></a>}</div>
    <div className="domain-card future-card"><Link2 size={20}/><h3>Bring your own domain</h3><p>Enter your domain, follow the DNS instructions, and check its connection here. Available after hosting and domain verification are connected.</p><span className="future-label">Not connected in this prototype</span></div>
  </div>;

  return <div className="settings-panel">
    <BillingPanel key={`billing-${site.id}`} siteId={site.id} siteName={site.draft.name}/>
    <RecentActivity key={`activity-${site.id}`} siteId={site.id}/>
  </div>;
}

export function CreateSiteDialog({ mode = 'demo', busy, error, onClose, onCreate }: { mode?: WorkspaceUser['mode']; busy: boolean; error: string; onClose: () => void; onCreate: (name: string, slug: string, kind: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState('general');
  const [customSlug, setCustomSlug] = useState(false);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  return <dialog className="create-dialog" ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if (!busy) onCreate(name.trim(), slug, kind); }}>
      <div className="section-heading"><h2 id={titleId}>Create a site</h2><button type="button" className="icon-button" aria-label="Close new site dialog" disabled={busy} onClick={onClose}><X size={19}/></button></div>
      <p>Start with your own content or choose a sample.</p>
      <label className="field">Site name<input disabled={busy} autoFocus required maxLength={80} value={name} onChange={e => { setName(e.target.value); if (!customSlug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/^-|-$/g, '')); }}/></label>
      <label className="field">Site address<input disabled={busy} required minLength={3} maxLength={50} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} onChange={e => { setSlug(e.target.value); setCustomSlug(true); }}/><span className="field-help">{mode === 'firebase' ? 'Site path' : 'Local address'}: /s/{slug || 'your-site'}</span></label>
      <label className="field">Starting content<select disabled={busy} value={kind} onChange={e => setKind(e.target.value)}><option value="general">Start from my content</option><option value="photographer">Photographer sample</option><option value="florist">Flower studio</option></select></label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button type="submit" className="button primary" disabled={busy}>{busy ? <LoadingIndicator label="Creating…"/> : 'Create site'}<ArrowUpRight size={16}/></button>
    </form>
  </dialog>;
}
