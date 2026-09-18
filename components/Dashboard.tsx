'use client';
import LoadingIndicator from './LoadingIndicator';

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowUp, ArrowUpRight, AudioLines, Check, ChevronDown, CircleHelp, CreditCard, FileText, FolderOpen, Globe2, Layers3, Menu, MessageSquare, Monitor, Palette, Paperclip, Plus, RotateCcw, Smartphone, Sparkles, X } from 'lucide-react';
import { visitorDraft } from '@/lib/visitor-model';
import { hasChanges, summarize, type Site, type SiteContent, type SiteSummary } from '@/lib/site-model';
import { CreateSiteDialog, EditorPanels, type Command, type Panel } from './EditorPanels';
import KnowledgePreview from './KnowledgePreview';
import KnowledgeReview from './KnowledgeReview';
import PersonalFooter from './PersonalFooter';
import ThemeToggle from './ThemeToggle';
import SignOutButton from './SignOutButton';
import type { WorkspaceUser } from '@/lib/firebase/types';
import type { EditorStatus } from '@/lib/editor-types';
import { observePlatformEvent } from '@/lib/platform-client-events';
import type { PhotoUploadResult } from './MediaPanel';

const navigation = [
  { id: 'chat', label: 'Editor', icon: MessageSquare }, { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'voice', label: 'The Voice', icon: AudioLines },
  { id: 'content', label: 'Content', icon: FileText }, { id: 'knowledge', label: 'Knowledge', icon: Layers3 }, { id: 'files', label: 'Files', icon: FolderOpen },
  { id: 'domains', label: 'Domains', icon: Globe2 }, { id: 'billing', label: 'Usage & billing', icon: CreditCard },
] as const;
const suggestions = ['Set my brand color to blue', 'Change my hours to Monday–Friday, 10am–6pm', 'Use my latest file'];

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json();
  if (response.status === 401) throw new Error('Your session expired. Sign in again to continue.');
  if (!response.ok) throw new Error(body.error || 'Something went wrong. Try again.');
  return body;
}

export default function Dashboard({ initialSites, initialSite, user, editor, initialPanel }: { initialSites: SiteSummary[]; initialSite: Site; user: WorkspaceUser; editor: EditorStatus; initialPanel?: 'billing' }) {
  const cloud = user.mode === 'firebase';
  const liveEditor = editor.mode === 'openai';
  const editorUnavailable = editor.mode === 'unavailable';
  const editorLabel = liveEditor ? 'AI editor' : editorUnavailable ? 'AI unavailable' : 'Demo editor';
  const ownerName = user.displayName || user.email || (cloud ? 'Your workspace' : 'Demo workspace');
  const [sites, setSites] = useState(initialSites);
  const [site, setSite] = useState(initialSite);
  const [content, setContent] = useState<SiteContent>(() => visitorDraft(initialSite.draft));
  const [panel, setPanel] = useState<Panel>(initialPanel ?? 'chat');
  const [text, setText] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newSite, setNewSite] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [previewMode, setPreviewMode] = useState<'draft' | 'published'>('draft');
  const [publishReview, setPublishReview] = useState(false);
  const [mediaPending, setMediaPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const endOfChat = useRef<HTMLDivElement>(null);
  const requestInFlight = useRef(false);
  const chatRequest = useRef<{ signature: string; id: string } | null>(null);
  const unsaved = JSON.stringify(content) !== JSON.stringify(site.draft);
  const dirty = hasChanges(site);
  const textFiles = site.files.filter(file => file.kind === 'text' && /^text\/(?:plain|csv)$/.test(file.mime));
  useEffect(() => { observePlatformEvent(`/api/sites/${site.id}/events`, { type: 'studio_visit', surface: 'preview' }); }, [site.id]);

  useEffect(() => { endOfChat.current?.scrollIntoView({ block: 'nearest' }); }, [site.messages.length, panel]);
  useEffect(() => {
    if (!unsaved && !text.trim() && !mediaPending) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [unsaved, text, mediaPending]);

  function acceptSite(next: Site) {
    setSite(next); setContent(visitorDraft(next.draft));
    setSelectedFileIds(current => current.filter(id => next.files.some(file => file.id === id && file.kind === 'text')));
    setSites(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? summarize(next) : item) : [...current, summarize(next)]);
  }

  function editText(value: string) {
    if (value !== text) chatRequest.current = null;
    setText(value);
  }

  function selectFile(id: string) {
    chatRequest.current = null;
    setSelectedFileIds(current => current.includes(id) ? current.filter(item => item !== id) : current.length < 3 ? [...current, id] : current);
  }

  function submitChat() {
    if (requestInFlight.current || !text.trim() || unsaved || editorUnavailable) return;
    if (!liveEditor) { void command({ action: 'chat', text }); return; }
    const fileIds = selectedFileIds.filter(id => textFiles.some(file => file.id === id));
    const signature = JSON.stringify({ siteId: site.id, revision: site.revision, text, fileIds });
    if (chatRequest.current?.signature !== signature) chatRequest.current = { signature, id: crypto.randomUUID() };
    void command({ action: 'chat', text, fileIds, requestId: chatRequest.current.id });
  }

  function confirmAccountNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if ((unsaved || text.trim() || mediaPending) && !window.confirm('Discard unsaved form changes, photo changes, and any unsent message, then open sign-in?')) event.preventDefault();
  }

  async function command(action: Command) {
    if (requestInFlight.current) return;
    if (unsaved && action.action !== 'save') { setError('Save or undo your unsaved form changes first.'); return; }
    if (mediaPending && ['publish', 'undo', 'remove-file', 'clear-history'].includes(action.action)) { setError('Apply or discard your photo changes in Files first.'); return; }
    requestInFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ site: Site }>(`/api/sites/${site.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...action, revision: site.revision }) });
      acceptSite(result.site);
      if (action.action === 'chat') { setText(''); setSelectedFileIds([]); chatRequest.current = null; }
      else setNotice(action.action === 'publish' ? (cloud ? 'Published to Firebase. Your site is ready to open in this app.' : 'Published locally. Your site is ready to open.') : action.action === 'undo' ? 'Last draft change undone.' : action.action === 'clear-history' ? 'Undo history cleared. Unused originals can now be deleted.' : action.action === 'discard' ? 'Proposal dismissed.' : action.action === 'remove-file' ? 'File removed.' : action.action === 'use-logo' ? 'Logo added to your draft. Publish to update your site.' : 'Draft saved.');
      setPublishReview(false);
      if (action.action === 'apply' || action.action === 'save' || action.action === 'undo' || action.action === 'use-logo' || action.action === 'remove-file') setPreviewMode('draft');
    } catch (error) { setError((error as Error).message); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function switchSite(id: string) {
    if (requestInFlight.current || id === site.id) return;
    if ((unsaved || text.trim() || mediaPending) && !window.confirm('Discard unsaved form changes, photo changes, and any unsent message, then switch sites?')) return;
    requestInFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try { const result = await request<{ site: Site }>(`/api/sites/${id}`); setMediaPending(false); acceptSite(result.site); editText(''); setSelectedFileIds([]); setPreviewMode('draft'); setPublishReview(false); }
    catch (error) { setError((error as Error).message); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function upload(files: FileList | File[] | null): Promise<PhotoUploadResult | undefined> {
    if (!files?.length || requestInFlight.current) return;
    if (unsaved) { setError('Save your form changes before uploading files.'); return; }
    requestInFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    const uploaded: PhotoUploadResult['uploaded'] = [];
    let latest = site;
    let revision = site.revision;
    try {
      for (const [index, file] of Array.from(files).entries()) {
        setNotice(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
        const image = /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
        const maximum = file.type === 'video/mp4' || /\.mp4$/i.test(file.name) ? 50 : image || file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 10 : /\.(csv|txt)$/i.test(file.name) ? .25 : 2;
        if (file.size > maximum * 1024 * 1024) throw new Error(`${file.name} is larger than ${maximum} MB.`);
        const contentType = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.mp4$/i.test(file.name) ? 'video/mp4' : /\.csv$/i.test(file.name) ? 'text/csv' : /\.txt$/i.test(file.name) ? 'text/plain' : /\.docx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : /\.xlsx$/i.test(file.name) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.html?$/i.test(file.name) ? 'text/html' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.webp$/i.test(file.name) ? 'image/webp' : 'application/octet-stream');
        const result = await request<{ site: Site; fileId: string }>(`/api/sites/${site.id}/files`, { method: 'POST', headers: { 'Content-Type': contentType, 'X-File-Name': encodeURIComponent(file.name), 'X-Site-Revision': String(revision) }, body: file });
        revision = result.site.revision;
        const fileId = result.fileId || result.site.files.find(item => !latest.files.some(previous => previous.id === item.id))?.id;
        latest = result.site; acceptSite(result.site);
        if (fileId) uploaded.push({ fileId, name: file.name, relativePath: file.webkitRelativePath || '' });
      }
      setNotice(`${uploaded.length} ${uploaded.length === 1 ? 'file' : 'files'} saved ${cloud ? 'with Firebase' : 'locally'}. Review photos in Files, or combine related documents in Knowledge.`);
      if (panel === 'branding') setPanel('files');
      return { site: latest, uploaded };
    } catch (error) { const message = `${uploaded.length ? `${uploaded.length} file(s) saved. ` : ''}${(error as Error).message}`; setError(message); return { site: latest, uploaded, error: message }; }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  async function createSite(name: string, slug: string, kind: string) {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{ site: Site }>('/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, slug, kind }) });
      setMediaPending(false); acceptSite(result.site); setNewSite(false); setPanel('chat'); editText(''); setSelectedFileIds([]); setPreviewMode('draft'); setPublishReview(false); setMobileNav(false); setMobilePreview(false); setNotice('Your new site is ready to edit.');
    } catch (error) { setError((error as Error).message); }
    finally { requestInFlight.current = false; setBusy(false); }
  }

  const editorPanelProps = { editor, mode: user.mode, site, content, setContent, busy, unsaved, mediaPending, command, upload,
    onMediaBusyChange: (value: boolean) => { requestInFlight.current = value; setBusy(value); },
    onMediaSiteChange: (next: Site) => { acceptSite(next); setPreviewMode('draft'); }, onMediaDirtyChange: setMediaPending };

  return <div className="studio-shell">
    {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <div className="studio-brand"><Image className="brand-logo-full" src="/brand/flowpath-logo-full.png" alt="FlowPath Studio" width={168} height={112} priority/><Image className="brand-logo-square" src="/brand/flowpath-icon-square.png" alt="" width={40} height={40} priority/><span className="brand-name">FlowPath Studio</span><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={20}/></button></div>
      <div className="site-switcher"><span className="site-avatar" style={{ background: site.draft.accent }}>{site.draft.name.slice(0, 1)}</span><label className="site-picker"><span>Current site</span><select aria-label="Current site" disabled={busy} value={site.id} onChange={e => void switchSite(e.target.value)}>{sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><ChevronDown size={14}/></div>
      <button className="new-site-button" disabled={busy} onClick={() => { if (unsaved || mediaPending) { setError('Save form changes and apply or discard photo changes before creating another site.'); return; } if (text.trim() && !window.confirm('Discard your unsent message when the new site is created?')) return; setError(''); setNewSite(true); }}><Plus size={15}/>Create a site</button>
      <span className="nav-caption">WORKSPACE</span>
      <nav aria-label="Workspace">{navigation.map(item => <button key={item.id} disabled={busy} className={`nav-item ${panel === item.id ? 'active' : ''}`} aria-current={panel === item.id ? 'page' : undefined} onClick={() => { setPanel(item.id); setMobileNav(false); setMobilePreview(false); }}><item.icon size={18}/>{item.label}{item.id === 'files' && site.files.length > 0 && <span>{site.files.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="demo-card"><span className="status-light"/><strong>{cloud ? 'Firebase workspace' : 'Local prototype'}</strong><p>{cloud ? 'Accounts, sites, and files are connected. ' : 'Sample workspace with local storage. '}{editor.message} Choose visitor chat and voice in The Voice.</p>{!cloud && <Link href="/sign-in" prefetch={false} className="text-button" onClick={confirmAccountNavigation}>Connect Firebase</Link>}</div><PersonalFooter/><div className="workspace-owner"><span>{ownerName.slice(0, 1).toUpperCase()}</span><div><strong>{ownerName}</strong><small>{cloud ? 'Signed in · saved with Firebase' : 'Saved on this computer'}</small></div>{cloud && <SignOutButton disabled={busy || unsaved || mediaPending || Boolean(text.trim())} onBusyChange={value => { requestInFlight.current = value; setBusy(value); }}/>}</div></div>
    </aside>
    <div className="studio-main">
      <header className="topbar"><div className="breadcrumbs"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={20}/></button><Layers3 size={16}/><span>My sites</span><span className="crumb-divider">/</span><strong>{site.draft.name}</strong><span className="badge desktop-only">{site.publishedAt ? (cloud ? 'Published' : 'Published locally') : 'Draft'}</span></div>
        <div className="topbar-actions"><ThemeToggle/><span className="save-state">{busy ? <LoadingIndicator/> : mediaPending ? 'Photos to review' : unsaved ? 'Unsaved changes' : dirty ? 'Draft saved' : 'Up to date'}</span><button className="icon-button" aria-label="Undo last draft change" disabled={busy || mediaPending || (!unsaved && !site.history.length)} onClick={() => { if (unsaved) { setContent(site.draft); setError(''); setNotice('Unsaved changes discarded.'); } else void command({ action: 'undo' }); }}><RotateCcw size={17}/></button>
        {unsaved && <button className="button secondary" disabled={busy} onClick={() => void command({ action: 'save', content })}>Save draft</button>}
        {site.publishedAt && <a className="icon-button" aria-label="Open published site" href={`/s/${site.slug}`} target="_blank" rel="noopener noreferrer"><ArrowUpRight size={19}/></a>}
        <button className="button primary publish-button" disabled={busy || unsaved || mediaPending || !dirty} onClick={() => setPublishReview(!publishReview)}>Publish<ArrowUpRight size={16}/></button></div>
      </header>
      {(error || notice) && <div className={`notification ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span>{error.includes('Reload') && <button className="text-button" onClick={() => window.location.reload()}>Reload</button>}{error.includes('Your session expired.') && <Link href="/sign-in" prefetch={false} className="text-button" onClick={confirmAccountNavigation}>Sign in</Link>}<button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice(''); }}><X size={16}/></button></div>}
      {publishReview && <div className="publish-review"><div><strong>{cloud ? 'Publish this draft?' : 'Publish this draft locally?'}</strong><p>The saved draft will replace the version at /s/{site.slug}. You can edit or undo a draft and publish again.</p></div><div className="inline-actions"><button className="button secondary" disabled={busy} onClick={() => setPublishReview(false)}>Cancel</button><button className="button primary" disabled={busy || unsaved || mediaPending || !dirty} onClick={() => void command({ action: 'publish' })}>{cloud ? 'Publish' : 'Publish locally'}</button></div></div>}
      <div className="mobile-workspace-tabs"><button className={!mobilePreview ? 'active' : ''} onClick={() => setMobilePreview(false)}>Workspace</button><button className={mobilePreview ? 'active' : ''} onClick={() => setMobilePreview(true)}>Site preview</button></div>
      <div className={`workspace-grid ${mobilePreview ? 'show-mobile-preview' : ''}`}>
        <section className="editor-workspace" aria-label="Site editor">
          {panel === 'chat' ? <>
            <div className="editor-heading"><div><span className="eyebrow">Your site, in your words</span><h1>Let’s make it yours.</h1><p>Describe a change. See it take shape.</p></div><span className="editor-spark"><Sparkles size={22}/></span></div>
            <div className="chat-history" aria-label="Editor conversation" aria-live="polite">
              {site.messages.map(message => <div className={`chat-message ${message.role}`} key={message.id}>
                {message.role === 'assistant' && <span className="assistant-avatar"><AudioLines size={16}/></span>}
                <div className="message-body"><span className="message-author">{message.role === 'assistant' ? (message.source === 'openai' ? 'Studio · AI editor' : 'Studio · demo editor') : 'You'}</span><p>{message.text}</p>
                  {message.proposal && <div className="change-proposal"><div className="proposal-title"><Palette size={15}/><strong>Proposed change</strong><span>{message.proposal.changes.length}</span></div>{message.proposal.changes.map(change => <div className="proposed-field" key={change.label}><label>{change.label}</label><div><span className="change-before">{change.label === 'Logo' ? (change.before === 'None' ? 'No logo' : site.files.find(file => file.id === change.before)?.name || 'Previous logo') : change.before || 'Empty'}</span><span className="change-after">{change.label === 'Logo' ? (change.after === 'None' ? 'No logo' : site.files.find(file => file.id === change.after)?.name || 'Uploaded logo') : change.after}</span></div></div>)}
                    {message.proposal.status === 'pending' ? <div className="proposal-actions"><button className="button primary" disabled={busy || unsaved || message.proposal.baseContent !== JSON.stringify(site.draft)} onClick={() => void command({ action: 'apply', messageId: message.id })}><Check size={15}/>Apply to draft</button><button className="text-button muted" disabled={busy || unsaved} onClick={() => void command({ action: 'discard', messageId: message.id })}>Dismiss</button>{message.proposal.baseContent !== JSON.stringify(site.draft) && <span className="field-help">The draft has changed. Ask for a fresh edit.</span>}</div> : <div className="proposal-status"><Check size={14}/>{message.proposal.status === 'applied' ? 'Applied to draft' : 'Dismissed'}</div>}
                  </div>}
                </div>
              </div>)}<div ref={endOfChat}/>
            </div>
            <div className="composer-area"><div className="suggestions">{suggestions.map((suggestion, index) => <button key={suggestion} disabled={busy || editorUnavailable || (liveEditor && index === 2 && !selectedFileIds.length)} onClick={() => editText(liveEditor && index === 2 ? 'Use the selected text files to update my website' : suggestion)}>{index === 0 ? <Palette size={13}/> : index === 1 ? <FileText size={13}/> : <Paperclip size={13}/>} {index === 0 ? 'Try a new color' : index === 1 ? 'Update my hours' : liveEditor ? 'Use selected files' : 'Use a document'}</button>)}</div>
              {site.files.length > 0 && <button className="attached-count" onClick={() => setPanel('files')}><Paperclip size={13}/>{site.files.length} {site.files.length === 1 ? 'file' : 'files'} in this site</button>}
              {liveEditor && <details className="chat-context"><summary><Paperclip size={13}/><span>Text file context</span><span>{selectedFileIds.length} / 3 selected</span></summary><div className="chat-context-options">{textFiles.length ? textFiles.map(file => <label className="chat-context-file" key={file.id}><input type="checkbox" checked={selectedFileIds.includes(file.id)} disabled={busy || (!selectedFileIds.includes(file.id) && selectedFileIds.length >= 3)} onChange={() => selectFile(file.id)}/><span>{file.name}</span></label>) : <p>Upload a .txt file in Files to include it in a message.</p>}</div></details>}
              {editorUnavailable && <p className="editor-availability" role="status">{editor.message} You can still edit your draft in Branding and Content.</p>}
              <form className="composer" onSubmit={event => { event.preventDefault(); submitChat(); }}><textarea aria-label="Describe a change" disabled={busy || editorUnavailable} value={text} maxLength={4000} placeholder="What would you like to change?" onChange={event => editText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submitChat(); } }}/><div className="composer-tools"><button type="button" className="icon-button" aria-label="Add files" disabled={busy || unsaved} onClick={() => fileInput.current?.click()}><Plus size={20}/></button><span>{editorLabel}</span><button type="submit" className="send-button" aria-label="Send message" disabled={busy || !text.trim() || unsaved || editorUnavailable}><ArrowUp size={19}/></button></div></form>
              <input hidden ref={fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/html,text/plain,text/csv,.docx,.xlsx,.html,.htm,.txt,.csv" onChange={e => { void upload(e.target.files); e.target.value = ''; }}/>
              {liveEditor && <p className="chat-disclosure">Sending shares your saved draft, recent chat, logo filenames, and selected text (up to 8,000 characters per file) with OpenAI. PDFs and images are not read.</p>}
              <p className="composer-note"><CircleHelp size={12}/>Review changes before they go live. Nothing publishes automatically.</p>
            </div>
          </> : panel === 'knowledge' ? <KnowledgeReview key={site.id} site={site} blocked={busy || unsaved} onBusyChange={value => { requestInFlight.current = value; setBusy(value); }} onSiteChange={next => { acceptSite(next); setPreviewMode('draft'); }}/> : panel === 'files' ? null : <EditorPanels {...editorPanelProps} panel={panel}/>}
          <div className="media-files-panel" hidden={panel !== 'files'}><EditorPanels key={site.id} {...editorPanelProps} panel="files"/></div>
        </section>
        <section className="preview-workspace" aria-label="FlowPath Studio website preview"><div className="preview-toolbar"><div className="preview-title"><span className="status-light"/>Site preview</div><div className="segmented" aria-label="Preview size"><button aria-label="Desktop preview" aria-pressed={device === 'desktop'} className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}><Monitor size={16}/></button><button aria-label="Mobile preview" aria-pressed={device === 'mobile'} className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}><Smartphone size={16}/></button></div></div>
          <div className="preview-options"><span>{previewMode === 'published' ? 'Published version' : unsaved ? 'Unsaved preview' : 'Saved draft'}</span><div className="preview-mode"><button aria-pressed={previewMode === 'draft'} className={previewMode === 'draft' ? 'active' : ''} onClick={() => setPreviewMode('draft')}>Draft</button><button aria-pressed={previewMode === 'published'} disabled={!site.published} className={previewMode === 'published' ? 'active' : ''} onClick={() => setPreviewMode('published')}>Published</button></div></div>
          <div className="preview-canvas"><div className={`browser-frame ${device}`}><div className="browser-chrome"><div className="traffic-lights"><i/><i/><i/></div><span><Globe2 size={11}/>{site.slug} · {cloud ? 'preview' : 'local preview'}</span><ArrowUpRight size={13}/></div><div className="preview-scroll"><KnowledgePreview key={site.id} siteId={site.id} content={previewMode === 'published' && site.published ? site.published : content}/></div></div></div>
          <div className="preview-footer"><span><Layers3 size={13}/>{content.style?.template ? `${content.style.template[0].toUpperCase()}${content.style.template.slice(1)} template` : 'Original template'}</span><span>{previewMode === 'published' ? 'Showing the last published version' : 'Changes appear here as you edit'}</span></div>
        </section>
      </div>
    </div>
    {newSite && <CreateSiteDialog mode={user.mode} busy={busy} error={error} onClose={() => { setNewSite(false); setError(''); }} onCreate={(name, slug, kind) => void createSite(name, slug, kind)}/>}
  </div>;
}
