'use client';

import { useEffect, useRef, useState } from 'react';
import type { Site } from '@/lib/site-model';
import type { WebsiteMigration } from '@/lib/website-migration-model';
import { Globe } from 'lucide-react';

type Props = { entities?: {id:string;name:string}[]; siteId: string; revision: number; disabled: boolean; onBusyChange: (busy: boolean) => void; onSiteChange: (site: Site) => void; onImport: (url: string, urls: string[]) => Promise<void> };
export default function WebsiteImport({ siteId, revision, disabled, onBusyChange, onSiteChange, onImport, entities=[] }: Props) {
  const [url, setUrl] = useState(''), [migration, setMigration] = useState<WebsiteMigration | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  const running = useRef(false), currentRevision = useRef(revision);
  useEffect(() => { currentRevision.current = revision; }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${siteId}/website/migration`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Migration could not be loaded.');
      if (!controller.signal.aborted) { setMigration(body.migration); if (body.migration) setUrl(body.migration.url); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [siteId]);
  async function request(action: string, values: Record<string, unknown> = {}) {
    const response = await fetch(`/api/sites/${siteId}/website/migration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: currentRevision.current, ...values }) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Migration could not finish. Reload to resume saved progress.');
    currentRevision.current = body.site.revision; setMigration(body.migration); onSiteChange(body.site);
    return body.migration as WebsiteMigration;
  }
  async function run(action: string, values: Record<string, unknown> = {}) {
    if (running.current || disabled) return;
    running.current = true; setBusy(true); onBusyChange(true); setError(''); setStatus('Saving migration…');
    try {
      if (action === 'download') {
        const selected = migration?.images.filter(i => i.status === 'selected' || i.status === 'failed') ?? [];
        for (let index = 0; index < Math.min(20, selected.length); index++) {
          setStatus(`Downloading best available original ${index + 1} of ${Math.min(20, selected.length)}…`);
          const result = await request('import-image', { url: selected[index].url });
          const failed = result.images.find(i => i.url === selected[index].url && i.status === 'failed');
          if (failed) throw new Error(failed.error || 'Download failed. Completed images are saved; retry or exclude this image.');
        }
        setStatus('Download progress saved. Continue remaining images or review placement before applying.');
      } else {
        await request(action, values);
        setStatus(action === 'apply' ? 'Reviewed photos applied to draft. Publish remains a separate step.' : 'Migration progress saved.');
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Migration could not finish.'); }
    finally { running.current = false; setBusy(false); onBusyChange(false); }
  }
  const supported = (url:string) => !/\.(?:svg|gif|avif)(?:[?#]|$)/i.test(url);
  const locked = disabled || busy, available = migration?.pages.filter(p => p.status === 'ready') ?? [];
  const pending = migration?.images.filter(i => i.status === 'selected' || i.status === 'failed').length ?? 0;
  return <section className="website-import" aria-label="Import a website" aria-busy={busy}>
    <h3><Globe size={18}/> Import a website</h3>
    <p>Bring your content and original-quality photos into a fresh FlowPath website. Review the knowledge, design and photo placements before applying. Progress is saved as you go.</p>
    <label className="field">Domain or website URL<input inputMode="url" value={url} disabled={locked} placeholder="example.com" onChange={e => setUrl(e.target.value)}/></label>
    <button className="button secondary" disabled={locked || !url.trim()} onClick={() => void run('discover', { url })}>Find website pages</button>
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="form-error">{error}</p>}
    {migration && <>
      <h4>Choose pages</h4><p>{available.length} available · {migration.selectedPages.length} selected (up to 24)</p>
      <button disabled={locked || !available.length} onClick={() => void run('select', { selectedPages: available.slice(0, 24).map(p => p.url) })}>Select all available pages</button>
      <button disabled={locked || !migration.selectedPages.length} onClick={() => void run('select', { selectedPages: [] })}>Clear page selection</button>
      <ul className="website-page-list">{migration.pages.map(page => <li key={page.url}><label><input type="checkbox" disabled={locked || page.status !== 'ready' || !migration.selectedPages.includes(page.url) && migration.selectedPages.length >= 24} checked={migration.selectedPages.includes(page.url)} onChange={e => void run('select', { selectedPages: e.target.checked ? [...migration.selectedPages, page.url] : migration.selectedPages.filter(url => url !== page.url) })}/><span><strong>{page.title}</strong><small>{page.url}</small><small>{page.message}</small></span></label></li>)}</ul>
      <button className="button secondary" disabled={locked || !migration.selectedPages.length} onClick={() => void run('discover-images')}>Discover images from selected pages</button>
      <button className="button secondary" disabled={locked || !migration.selectedPages.length} onClick={() => void onImport(migration.url, migration.selectedPages)}>Import selected page knowledge</button>
      <p className="field-help">Image discovery and downloads do not use AI. Knowledge import in connected mode uses one AI interpretation attempt; review comes before Apply.</p>
      <h4>Images and placement</h4>
      <p>Original downloads are retained privately; optimized copies power the website. Select images you want to carry over. Excluded images are not added to the gallery.</p>
      <button disabled={locked || !migration.images.length} onClick={() => void run('select', { images: migration.images.filter(i => i.status === 'excluded' && supported(i.url)).slice(0, 20).map(i => ({ ...i, status: i.fileId ? 'imported' : 'selected' })) })}>Select next 20 images</button>
      <button className="button secondary" disabled={locked || !pending} onClick={() => void run('download')}>Import next {Math.min(20, pending)} selected images</button>
      <ul className="website-page-list">{migration.images.map(item => <li key={item.url}>
        <label><input type="checkbox" checked={item.status !== 'excluded'} disabled={locked || !supported(item.url)} onChange={e => void run('select', { images: [{ ...item, status: e.target.checked ? item.fileId ? 'imported' : 'selected' : 'excluded' }] })}/><span><strong>{item.alt || 'Source website image'}</strong><small>{item.url}</small><small>{!supported(item.url) ? 'Unsupported image format; excluded. ' : ''}{item.status}{item.error ? `: ${item.error}` : ''}</small></span></label>
        <label>Caption<input key={`${item.url}-caption-${item.caption}`} defaultValue={item.caption} maxLength={500} disabled={locked} onBlur={e=>{if(e.target.value!==item.caption)void run('select',{images:[{...item,caption:e.target.value}]});}}/></label>
        <label>Alternative text<input key={`${item.url}-alt-${item.alt}`} defaultValue={item.alt} maxLength={500} disabled={locked} onBlur={e=>{if(e.target.value!==item.alt)void run('select',{images:[{...item,alt:e.target.value}]});}}/></label>
        <label>Associate with<select value={item.targetEntityId??''} disabled={locked} onChange={e=>void run('select',{images:[{...item,targetEntityId:e.target.value||undefined}]})}><option value="">Whole website</option>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Placement<select value={item.placement} disabled={locked} onChange={e => void run('select', { images: [{ ...item, placement: e.target.value }] })}><option value="source">Photo library</option><option value="lead">Lead photo</option><option value="logo">Site logo</option></select></label>
        <label>Use<select value={item.role} disabled={locked} onChange={e => void run('select', { images: [{ ...item, role: e.target.value }] })}><option value="depicts">Actual business photo</option><option value="example">Illustrative example</option></select></label>
        {item.fileId && <a href={`/api/files/${siteId}/${item.fileId}`} target="_blank" rel="noreferrer">Review imported image</a>}
      </li>)}</ul>
      {migration.notes.map(note => <p key={note} className="field-help">{note}</p>)}
      <button className="button primary" disabled={locked || pending > 0 || !migration.images.some(image=>image.status==='imported')} onClick={() => void run('apply')}>Apply reviewed photos to draft</button>
    </>}
  </section>;
}
