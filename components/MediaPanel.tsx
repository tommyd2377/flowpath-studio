'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, FolderOpen, Images, Plus, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { validateMediaLibrary, type MediaLibrary } from '@thevoice/platform-ui/media';
import type { KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { Site } from '@/lib/site-model';

export type PhotoUploadResult = { site: Site; uploaded: { fileId: string; name: string; relativePath: string }[]; error?: string };
export type UploadFiles = (files: FileList | File[] | null) => Promise<PhotoUploadResult | undefined>;
type Props = { site: Site; blocked: boolean; connected: boolean; upload: UploadFiles; onBusyChange: (busy: boolean) => void; onSiteChange: (site: Site) => void; onDirtyChange: (dirty: boolean) => void };
type Asset = MediaLibrary['assets'][number];

const emptyLibrary = (): MediaLibrary => ({ schemaVersion: 1, id: crypto.randomUUID(), assets: [], albums: [], associations: [] });
const titleFromName = (name: string) => { const title = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim(); return /^(?:img|dsc|dscn|pxl|image|photo)?\s*\d[\d\s]*$/i.test(title) ? '' : title.slice(0, 180); };
const description = (error: unknown) => error instanceof Error ? error.message : 'The photo changes could not finish.';

export default function MediaPanel({ site, blocked, connected, upload, onBusyChange, onSiteChange, onDirtyChange }: Props) {
  const [library, setLibrary] = useState<MediaLibrary | null>(null);
  const [saved, setSaved] = useState('');
  const [catalog, setCatalog] = useState<KnowledgeCatalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [albumId, setAlbumId] = useState('');
  const [editing, setEditing] = useState('');
  const [context, setContext] = useState('');
  const [target, setTarget] = useState('site');
  const [role, setRole] = useState<'depicts' | 'example'>('depicts');
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState(false);
  const [destination, setDestination] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const dirty = library !== null && JSON.stringify(library) !== saved;
  const dirtyRef = useRef(dirty);
  const disabled = blocked || busy;
  const album = library?.albums.find(item => item.id === albumId);
  const assets = library?.assets.filter(asset => !album || album.assetIds.includes(asset.id)).sort((a, b) => album ? album.assetIds.indexOf(a.id) - album.assetIds.indexOf(b.id) : 0) ?? [];
  const editor = library?.assets.find(asset => asset.id === editing);
  const unorganized = site.files.filter(file => file.kind === 'image' && file.image && !library?.assets.some(asset => asset.id === file.id));

  useEffect(() => { folder.current?.setAttribute('webkitdirectory', ''); }, []);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${site.id}/media`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Photos could not be loaded.');
        if (controller.signal.aborted || dirtyRef.current) return;
        const next = body.library ? validateMediaLibrary(body.library) : emptyLibrary();
        setLibrary(next); setSaved(JSON.stringify(next));
      }).catch(error => { if (!controller.signal.aborted) setError(description(error)); });
    return () => controller.abort();
  }, [site.id, site.draft.mediaRevisionId]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sites/${site.id}/knowledge`, { cache: 'no-store', signal: controller.signal })
      .then(async response => { const body = await response.json(); if (response.ok && !controller.signal.aborted) setCatalog(body.catalog ?? null); })
      .catch(() => {});
    return () => controller.abort();
  }, [site.id, site.draft.knowledgeRevisionId]);

  function update(next: MediaLibrary) { setLibrary(next); setError(''); }
  function toggle(id: string) { setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]); }
  function addUploaded(result: PhotoUploadResult) {
    const next = structuredClone(library ?? emptyLibrary());
    const groups = new Map<string, string[]>();
    for (const uploaded of result.uploaded) {
      const file = result.site.files.find(file => file.id === uploaded.fileId);
      if (!file?.image) continue;
      if (!next.assets.some(asset => asset.id === file.id)) next.assets.push({ id: file.id, width: file.image.width, height: file.image.height,
        caption: file.image.caption || titleFromName(file.name), alt: '', ...(file.image.credit ? { credit: file.image.credit } : {}) });
      const path = uploaded.relativePath.split('/').slice(0, -1).join(' / ');
      const title = (path || album?.title || 'Photos').slice(0, 120);
      groups.set(title, [...groups.get(title) ?? [], file.id]);
    }
    for (const [title, ids] of groups) {
      let destination = next.albums.find(item => item.title === title);
      if (!destination) {
        if (next.albums.length >= 24) continue;
        destination = { id: crypto.randomUUID(), title, description: '', assetIds: [] }; next.albums.push(destination);
      }
      destination.assetIds = [...new Set([...destination.assetIds, ...ids])];
      destination.coverAssetId ??= destination.assetIds[0];
    }
    setLibrary(next); setSelected(result.uploaded.map(file => file.fileId).filter(id => next.assets.some(asset => asset.id === id)));
    setAlbumId(groups.size === 1 ? next.albums.find(item => item.title === [...groups.keys()][0])?.id ?? '' : '');
    setNotes(['Review the album names and any photo details you want visitors to see. Connections are optional.']);
    setError(result.error ?? ''); setExisting(false); setContext('');
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length || disabled || running.current || !library) return;
    running.current = true; setBusy(true); setError('');
    try {
      const photos = Array.from(files).filter(file => /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
      if (!photos.length) throw new Error('Choose PNG, JPEG, or WebP photos.');
      const result = await upload(photos); if (result?.uploaded.length) addUploaded(result); else if (result?.error) setError(result.error);
    }
    catch (error) { setError(description(error)); }
    finally { running.current = false; setBusy(false); }
  }

  async function suggest(useVision: boolean) {
    if (!library || !selected.length || disabled || running.current) return;
    running.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const response = await fetch(`/api/sites/${site.id}/media/interpret`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: site.revision, requestId: crypto.randomUUID(), fileIds: selected, context, library, useVision }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Suggestions could not be prepared.');
      setLibrary(validateMediaLibrary(body.library)); setNotes(body.notes ?? []);
    } catch (error) { setError(description(error)); }
    finally { running.current = false; setBusy(false); onBusyChange(false); }
  }

  async function apply() {
    if (!library || disabled || running.current || !dirty) return;
    running.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const checked = validateMediaLibrary(library);
      const response = await fetch(`/api/sites/${site.id}/media`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: site.revision, library: checked }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Photos could not be applied to the draft.');
      const next = validateMediaLibrary(body.library);
      setLibrary(next); setSaved(JSON.stringify(next)); setNotes(['Photos applied to your draft. Publish when you are ready to update the site.']);
      onSiteChange(body.site);
    } catch (error) { setError(description(error)); }
    finally { running.current = false; setBusy(false); onBusyChange(false); }
  }

  function assign() {
    if (!library || !selected.length) return;
    const [targetType, ...parts] = target.split(':'); const targetId = parts.join(':');
    if (!['site', 'entity', 'section'].includes(targetType)) return;
    const associations = library.associations.filter(item => !(selected.includes(item.assetId) && item.targetType === targetType && (item.targetId ?? '') === targetId));
    for (const assetId of selected) associations.push({ id: crypto.randomUUID(), assetId, targetType: targetType as 'site' | 'entity' | 'section', ...(targetId ? { targetId } : {}), role });
    update({ ...library, associations }); setNotes([`${selected.length} ${selected.length === 1 ? 'photo connected' : 'photos connected'} as ${role === 'depicts' ? 'actual photos' : 'examples'}. Review and apply these changes.`]);
  }

  function createAlbum() {
    if (!library || !selected.length || library.albums.length >= 24) return;
    const next = { id: crypto.randomUUID(), title: 'New album', description: '', assetIds: [...selected], coverAssetId: selected[0] };
    update({ ...library, albums: [...library.albums, next] }); setAlbumId(next.id);
  }
  function addToAlbum() {
    const id = destination || library?.albums[0]?.id;
    if (!library || !id || !selected.length) return;
    update({ ...library, albums: library.albums.map(item => item.id === id ? { ...item, assetIds: [...new Set([...item.assetIds, ...selected])], coverAssetId: item.coverAssetId || selected[0] } : item) });
    setAlbumId(id);
  }
  function leadPhoto(association: MediaLibrary['associations'][number]) {
    if (!library) return;
    update({ ...library, associations: library.associations.map(item => item.targetType === association.targetType && item.targetId === association.targetId && item.role === association.role
      ? { ...item, primary: item.id === association.id } : item) });
  }

  function removeFromLibrary() {
    if (!library) return;
    update({ ...library, assets: library.assets.filter(asset => !selected.includes(asset.id)), associations: library.associations.filter(item => !selected.includes(item.assetId)),
      albums: library.albums.map(item => {
        const ids = item.assetIds.filter(id => !selected.includes(id));
        return { ...item, assetIds: ids, coverAssetId: item.coverAssetId && ids.includes(item.coverAssetId) ? item.coverAssetId : ids[0] };
      }).filter(item => item.assetIds.length) });
    setSelected([]); setEditing('');
  }
  function changeAlbum(patch: Partial<MediaLibrary['albums'][number]>) { if (library && album) update({ ...library, albums: library.albums.map(item => item.id === album.id ? { ...item, ...patch } : item) }); }
  function move(id: string, direction: number) {
    if (!album) return; const ids = [...album.assetIds]; const index = ids.indexOf(id); const next = index + direction;
    if (index < 0 || next < 0 || next >= ids.length) return;
    [ids[index], ids[next]] = [ids[next], ids[index]]; changeAlbum({ assetIds: ids });
  }
  function editAsset(patch: Partial<Asset>) { if (library && editor) update({ ...library, assets: library.assets.map(asset => asset.id === editor.id ? { ...asset, ...patch } : asset) }); }

  return <section className="media-panel" aria-label="Photo library">
    <div className="section-heading"><div><span className="eyebrow">Show what makes it yours</span><h3>Photos</h3></div><span>{library?.assets.length ?? 0} / 100</span></div>
    <p>Bring in a few photos or an entire folder. Organize them together, then apply the collection to your draft.</p>
    <div className="media-upload-actions"><button className="button primary" disabled={disabled || !library} onClick={() => input.current?.click()}><Upload size={16}/>Add photos</button><button className="button secondary" disabled={disabled || !library} onClick={() => folder.current?.click()}><FolderOpen size={16}/>Add a folder</button></div>
    <input hidden aria-label="Upload photos" ref={input} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { void addFiles(event.target.files); event.target.value = ''; }}/>
    <input hidden aria-label="Upload a photo folder" ref={folder} type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={event => { void addFiles(event.target.files); event.target.value = ''; }}/>
    <p className="field-help">PNG, JPEG, or WebP · up to 10 MB each. Folder names become editable albums. Uploads stay private. Selected photos appear on your site after you apply and publish.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!library && !error && <p role="status">Loading photos…</p>}
    {library && <>
      {unorganized.length > 0 && <details className="media-existing" open={existing} onToggle={event => setExisting(event.currentTarget.open)}><summary>Add from uploaded files ({unorganized.length})</summary><div className="media-existing-grid">{unorganized.map(file => <button key={file.id} disabled={disabled} onClick={() => addUploaded({ site, uploaded: [{ fileId: file.id, name: file.name, relativePath: '' }] })}><Image unoptimized src={`/api/files/${site.id}/${file.id}?size=thumb`} width={96} height={72} alt=""/><span><Plus size={14}/>{file.name}</span></button>)}</div></details>}
      {library.assets.length > 0 ? <>
        <nav className="media-albums" aria-label="Photo albums"><button disabled={disabled} aria-pressed={!album} onClick={() => { setAlbumId(''); setSelected([]); }}>All photos</button>{library.albums.map(item => <button key={item.id} disabled={disabled} aria-pressed={album?.id === item.id} onClick={() => { setAlbumId(item.id); setSelected([]); }}>{item.title}<span>{item.assetIds.length}</span></button>)}</nav>
        {album && <div className="media-album-fields"><label className="field">Album title<input value={album.title} maxLength={120} disabled={disabled} onChange={event => changeAlbum({ title: event.target.value })}/></label><label className="field">Album description<textarea value={album.description} rows={2} maxLength={1000} disabled={disabled} onChange={event => changeAlbum({ description: event.target.value })}/></label></div>}
        <div className="media-selection"><span>{selected.length} selected</span><button className="text-button" disabled={disabled} onClick={() => setSelected(assets.map(asset => asset.id))}>Select {album ? 'album' : 'all'}</button><button className="text-button muted" disabled={disabled || !selected.length} onClick={() => setSelected([])}>Clear selection</button></div>
        <div className="media-grid">{assets.map((asset, index) => {
          const fileName = site.files.find(file => file.id === asset.id)?.name ?? asset.caption ?? 'Photo';
          const connections = library.associations.filter(item => item.assetId === asset.id);
          return <article className={`media-photo ${selected.includes(asset.id) ? 'is-selected' : ''}`} key={asset.id} data-media-asset={asset.id}>
            <label className="media-photo-select"><Image unoptimized src={`/api/files/${site.id}/${asset.id}?size=thumb`} width={320} height={240} alt={asset.alt}/><input type="checkbox" aria-label={`Select photo ${fileName}`} checked={selected.includes(asset.id)} disabled={disabled} onChange={() => toggle(asset.id)}/>{album?.coverAssetId === asset.id && <span className="media-cover"><Star size={12}/>Cover</span>}</label>
            <div className="media-photo-caption"><strong>{asset.caption || 'Photo'}</strong><span>{connections.length ? connections.map(item => `${item.role === 'example' ? 'Example' : 'Actual'} · ${item.targetType === 'site' ? site.draft.name : item.targetType === 'section' ? site.draft.sections.find(section => section.id === item.targetId)?.title ?? 'Section' : catalog?.entities.find(entity => entity.id === item.targetId)?.name ?? 'Item'}`).join('; ') : 'No specific connection'}</span><button className="text-button" disabled={disabled} onClick={() => setEditing(asset.id)}>Edit photo details</button></div>
            {album && <div className="media-photo-order"><button className="icon-button" aria-label={`Move ${fileName} earlier`} disabled={disabled || index === 0} onClick={() => move(asset.id, -1)}><ArrowUp size={14}/></button><button className="icon-button" aria-label={`Move ${fileName} later`} disabled={disabled || index === assets.length - 1} onClick={() => move(asset.id, 1)}><ArrowDown size={14}/></button><button className="text-button" disabled={disabled || album.coverAssetId === asset.id} onClick={() => changeAlbum({ coverAssetId: asset.id })}>Make cover</button></div>}
          </article>;
        })}</div>
        {editor && <section className="media-detail-editor" aria-label="Photo details"><div className="section-heading"><h4>Photo details</h4><button className="icon-button" aria-label="Close photo details" onClick={() => setEditing('')}><X size={16}/></button></div><Image unoptimized src={`/api/files/${site.id}/${editor.id}?size=thumb`} width={320} height={240} alt={editor.alt}/><label className="field">Photo caption<input disabled={disabled} maxLength={500} value={editor.caption} onChange={event => editAsset({ caption: event.target.value })}/></label><label className="field">Alternative text<textarea disabled={disabled} maxLength={500} value={editor.alt} rows={2} onChange={event => editAsset({ alt: event.target.value })}/><span className="field-help">Describe what the photo shows for someone who cannot see it.</span></label><label className="field">Photo credit<input disabled={disabled} maxLength={180} value={editor.credit ?? ''} onChange={event => editAsset({ credit: event.target.value || undefined })}/></label>{library.associations.filter(item => item.assetId === editor.id).map(item => <div className="media-connection" key={item.id}><span>{item.role === 'example' ? 'Example' : 'Actual photo'} · {item.targetType}{item.primary ? ' · Lead photo' : ''}</span><button className="text-button" disabled={disabled || item.primary} onClick={() => leadPhoto(item)}>Use as lead photo</button><button className="text-button muted" disabled={disabled} onClick={() => update({ ...library, associations: library.associations.filter(connection => connection.id !== item.id) })}>Remove connection</button></div>)}</section>}
        {selected.length > 0 && <section className="media-batch" aria-label="Selected photo actions"><h4>Work with these {selected.length} {selected.length === 1 ? 'photo' : 'photos'}</h4><label className="field">What should we know about these photos?<textarea disabled={disabled} rows={3} maxLength={2000} value={context} onChange={event => setContext(event.target.value)} placeholder="For example: These are examples of our past wedding arrangements."/></label><div className="inline-actions"><button className="button secondary" disabled={disabled} onClick={() => void suggest(false)}><Sparkles size={15}/>Suggest connections</button>{connected && <button className="text-button" disabled={disabled || selected.length > 20} onClick={() => void suggest(true)}>Suggest from photos</button>}</div><p className="field-help">Suggestions use your notes and filenames. {connected && '“Suggest from photos” shares up to 20 selected photos with your configured AI service.'} Review every suggestion before applying.</p>
          <div className="media-bulk-fields"><label className="field">Connect selected photos to<select disabled={disabled} value={target} onChange={event => setTarget(event.target.value)}><option value="site">The whole site</option>{site.draft.sections.length > 0 && <optgroup label="Content sections">{site.draft.sections.map(section => <option key={section.id} value={`section:${section.id}`}>{section.title}</option>)}</optgroup>}{catalog && <optgroup label="Knowledge items">{catalog.entities.map(entity => <option key={entity.id} value={`entity:${entity.id}`}>{entity.name}</option>)}</optgroup>}</select></label><label className="field">These photos are<select disabled={disabled} value={role} onChange={event => setRole(event.target.value as 'depicts' | 'example')}><option value="depicts">Actual photos of this</option><option value="example">Examples or inspiration</option></select></label></div><button className="button secondary" disabled={disabled} onClick={assign}>Connect selected photos</button>
          <details className="media-group-tools"><summary>Organize selected photos</summary><button className="button secondary" disabled={disabled || library.albums.length >= 24} onClick={createAlbum}><Plus size={14}/>Create album from selection</button>{library.albums.length > 0 && <div className="media-add-to-album"><label className="field">Destination album<select disabled={disabled} value={destination || library.albums[0]?.id || ''} onChange={event => setDestination(event.target.value)}>{library.albums.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><button className="button secondary" disabled={disabled} onClick={addToAlbum}>Add to album</button></div>}{album && context.trim() && <button className="text-button" disabled={disabled} onClick={() => changeAlbum({ description: context.trim().slice(0, 1000) })}>Use note as album description</button>}</details><div className="media-batch-removal">{album && <button className="text-button muted" disabled={disabled} onClick={() => { const ids = album.assetIds.filter(id => !selected.includes(id)); changeAlbum({ assetIds: ids, coverAssetId: album.coverAssetId && ids.includes(album.coverAssetId) ? album.coverAssetId : ids[0] }); setSelected([]); }}><X size={14}/>Remove from this album</button>}<button className="text-button muted" disabled={disabled} onClick={removeFromLibrary}><Trash2 size={14}/>Remove from photo library</button></div><p className="field-help">Removing a photo here changes the reviewed collection. The private upload remains in Files.</p>
        </section>}
      </> : <div className="media-empty"><Images size={28}/><strong>A place for your photos</strong><p>Albums work on their own. You can connect photos to specific items or sections whenever you are ready.</p></div>}
      {notes.length > 0 && <ul className="media-notes" aria-label="Photo review notes">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      <div className="save-bar media-save"><span>{dirty ? 'Photo changes are ready to review.' : 'Your photo draft is up to date.'}</span><div className="inline-actions">{dirty && <button className="text-button muted" disabled={disabled} onClick={() => { setLibrary(JSON.parse(saved)); setSelected([]); setEditing(''); setError(''); setNotes([]); }}>Discard photo changes</button>}<button className="button primary" disabled={disabled || !dirty} onClick={() => void apply()}><Check size={16}/>Apply to draft</button></div></div>
    </>}
  </section>;
}
