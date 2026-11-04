'use client';

import { Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { validateVisualDisplay, VISUAL_IMAGE_LIMIT, type VisualDisplayConfiguration, type VisualImage } from '@/lib/visual-display';
import { prepareVisualImage } from '@/lib/prepare-visual-image';
import { DisplayImage } from './DisplayContent';
import styles from './VisualDisplaySettings.module.css';

export default function VisualDisplaySettings({ value, disabled, onChange, onPreparing }: {
  value: VisualDisplayConfiguration; disabled: boolean; onChange: (value: VisualDisplayConfiguration) => void; onPreparing: (preparing: boolean) => void;
}) {
  const [preparing, setPreparing] = useState(false), [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const revision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const full = value.images.length >= VISUAL_IMAGE_LIMIT;
  const prefix = useId();
  const image = value.images.find(item => item.id === selectedId) ?? value.images[0];
  const index = value.images.findIndex(item => item.id === image?.id);
  useEffect(() => () => { revision.current++; onPreparing(false); }, [onPreparing]);
  function update(id: string, patch: Partial<VisualImage>) { onChange({ ...value, images: value.images.map(i => i.id === id ? { ...i, ...patch } : i) }); }
  async function add(file: File) {
    const ticket = ++revision.current; setPreparing(true); onPreparing(true); setError('');
    try {
      const src = await prepareVisualImage(file);
      if (ticket === revision.current) {
        const id = crypto.randomUUID();
        setSelectedId(id);
        onChange({ ...value, images: [...value.images, { id, title: file.name.replace(/\.[^.]+$/, '').slice(0, 80), description: '', text: '', src }] });
      }
    } catch (e) { if (ticket === revision.current) setError(e instanceof Error ? e.message : 'That picture could not be prepared.'); }
    finally { if (ticket === revision.current) { setPreparing(false); onPreparing(false); } }
  }
  return <div className={`visual-display-settings ${styles.editor}`}>
    <p>Add up to {VISUAL_IMAGE_LIMIT} pictures and choose one below to edit.</p>
    <p className="field-help">Describe each picture accurately so the voice can discuss it. The voice uses your description and cannot see the picture.</p>
    <div className={styles.gallery} aria-label="Pictures">
      {value.images.map((item, i) => <button className={styles.thumbnail} key={item.id} type="button" aria-pressed={image?.id === item.id} aria-label={`Edit picture ${i + 1}: ${item.title || 'Untitled'}`} disabled={disabled || preparing} onClick={() => setSelectedId(item.id)}>
        <DisplayImage content={{ ...item, type: 'image', description: '' }} /><span>{item.title || `Picture ${i + 1}`}</span>
      </button>)}
    </div>
    <div className={`visual-upload ${styles.upload}`}>
      <button className={`secondary-button ${styles.add}`} type="button" disabled={disabled || preparing || full}
        onClick={() => fileInput.current?.click()}>
        <Upload aria-hidden="true" />{preparing ? 'Preparing picture…' : 'Choose picture'}
      </button>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp"
        disabled={disabled || preparing || full} onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void add(file);
        }} />
      <p className="field-help" role="status">{full ? 'Gallery full. Remove a picture to add another.' : 'PNG, JPEG or WebP · up to 5 MB'}</p>
    </div>
    {image && <fieldset key={image.id} disabled={disabled || preparing}>
      <legend>Picture {index + 1} of {value.images.length}</legend><DisplayImage content={{ ...image, type: 'image' }} />
      <label htmlFor={`${prefix}-${image.id}-title`}>Picture title</label><input id={`${prefix}-${image.id}-title`} maxLength={80} value={image.title} onChange={e => update(image.id, { title: e.target.value })} />
      <label htmlFor={`${prefix}-${image.id}-caption`}>Description for the voice</label><p className="field-help">Describe what the picture shows. This is also the caption when no display text is set.</p><textarea id={`${prefix}-${image.id}-caption`} maxLength={500} value={image.description} onChange={e => update(image.id, { description: e.target.value })} />
      <label htmlFor={`${prefix}-${image.id}-text`}>Text shown beside the picture (optional)</label><textarea id={`${prefix}-${image.id}-text`} maxLength={2000} value={image.text} onChange={e => update(image.id, { text: e.target.value })} />
      <button className="settings-inline-link" type="button" onClick={() => { setSelectedId(null); onChange({ ...value, images: value.images.filter(i => i.id !== image.id) }); }}>Remove picture {index + 1}</button>
    </fieldset>}
    {!validateVisualDisplay(value).ok && <p className="field-help" role="status">Give every picture a unique title and a description before saving.</p>}
    {error && <p role="alert" className="account-error">{error}</p>}
  </div>;
}
