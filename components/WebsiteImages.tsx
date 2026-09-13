'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { Site } from '@/lib/site-model';
import { WEBSITE_LIMITS, type WebsiteDiscovery, type WebsiteImage } from '@/lib/website-import-model';

export default function WebsiteImages({ discovery, siteId, revision, disabled, onBusyChange, onSiteChange }: {
  discovery: WebsiteDiscovery; siteId: string; revision: number; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onSiteChange: (site: Site) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]), [done, setDone] = useState<string[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const images = discovery.images ?? [];
  async function run(items: WebsiteImage[], preview = false) {
    if (busy || disabled) return;
    setBusy(true); onBusyChange(true); setMessage(''); let currentRevision = revision, completed = 0;
    try {
      for (const image of items) {
        setMessage(preview ? 'Loading preview…' : `Importing image ${completed + 1} of ${items.length}…`);
        const response = await fetch(`/api/sites/${siteId}/website/images`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: discovery.url, pageUrl: image.pageUrl, imageUrl: image.url, revision: currentRevision, preview }) });
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Image download failed.');
        if (preview) setPreviews(current => ({ ...current, [image.url]: body.thumbnail }));
        else {
          currentRevision = body.site.revision; onSiteChange(body.site);
          setDone(current => [...current, image.url]); setSelected(current => current.filter(url => url !== image.url));
        }
        completed++;
      }
      setMessage(preview ? '' : `${completed} images are available in Files → Photos. Review and apply them there before publishing.`);
    } catch (error) { setMessage(`${completed ? `${completed} completed. ` : ''}${error instanceof Error ? error.message : 'Image download failed.'} Import stopped; completed images are retained.`); }
    finally { setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="Website images" aria-busy={busy}>
    <h4>Bring your images</h4>
    <p>{images.length} image references found. Select up to {WEBSITE_LIMITS.imageBatch} per batch. Copies are stored privately in your photo library.</p>
    <p className="field-help">We compare available original and responsive variants and retain the highest-resolution supported download unchanged. Still PNG, JPEG and WebP, up to 10 MB each. External stylesheets and JavaScript-only galleries are not scanned. SVG and animated images need a supported replacement.</p>
    {images.length > 0 && <>
      <div className="proposal-actions"><button type="button" className="text-button" disabled={disabled || busy} onClick={() => setSelected(images.filter(image => !done.includes(image.url)).slice(0, WEBSITE_LIMITS.imageBatch).map(image => image.url))}>Select first {Math.min(images.filter(image => !done.includes(image.url)).length, WEBSITE_LIMITS.imageBatch)} images</button><button type="button" className="text-button" disabled={disabled || busy} onClick={() => setSelected([])}>Clear image selection</button></div>
      <ul className="website-page-list">{images.map(image => <li key={image.url}>
        <label><input type="checkbox" checked={selected.includes(image.url)} disabled={disabled || busy || done.includes(image.url) || !selected.includes(image.url) && selected.length >= WEBSITE_LIMITS.imageBatch} onChange={event => setSelected(current => event.target.checked ? [...current, image.url] : current.filter(url => url !== image.url))}/><span><strong>{image.alt || 'Website image'}</strong><small>{image.url}</small>{done.includes(image.url) && <small>Available in Photos</small>}</span></label>
        {previews[image.url] ? <Image unoptimized src={previews[image.url]} width={160} height={120} style={{ objectFit: 'contain' }} alt={image.alt}/> : <button type="button" className="text-button" disabled={disabled || busy} onClick={() => void run([image], true)}>Preview image</button>}
      </li>)}</ul>
      <button type="button" className="button secondary" disabled={disabled || busy || !selected.length} onClick={() => void run(images.filter(image => selected.includes(image.url)))}>Import {selected.length} selected images</button>
    </>}
    {message && <p role="status">{message}</p>}
    <p className="field-help">Apply the website knowledge first, then use Files → Photos → Add from uploaded files to review captions, alternative text, and actual/example connections and choose a lead photo. Use Files → Use as logo for your logo. Importing images does not publish them or use AI.</p>
  </section>;
}
