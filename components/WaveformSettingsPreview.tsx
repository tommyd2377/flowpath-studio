import Link from 'next/link';
import { AudioLines, BookOpen, TextCursorInput } from 'lucide-react';

/** Appearance only: rendering this preview never opens media or a provider session. */
export default function WaveformSettingsPreview({ name, voice, photo, waveformId, textEnabled }: {
  name: string; voice: string; photo: string | null; waveformId?: string; textEnabled: boolean;
}) {
  return <aside className="settings-preview" aria-label="Waveform appearance preview">
    <div className="settings-preview-heading"><span>Your waveform</span><span className="settings-badge">Private</span></div>
    <div className="settings-preview-identity">
      {photo
        // A private data URL stays local; no image proxy or public asset is introduced.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="Waveform portrait preview" width={64} height={64} />
        : <span className="settings-preview-placeholder"><AudioLines aria-hidden="true" /></span>}
      <h2>{name.trim() || 'Your waveform'}</h2><p>{voice} voice</p>
    </div>
    <svg className="settings-preview-wave" viewBox="0 0 260 74" aria-hidden="true">
      <path d="M0 38 C30 38 38 38 54 34 S77 23 95 34 S120 47 133 35 S154 17 171 35 S192 48 207 40 S236 37 260 38" />
      <path d="M0 39 C32 39 49 38 65 35 S88 31 104 39 S125 44 142 34 S165 27 182 39 S211 39 230 39 S249 39 260 39" />
    </svg>
    <p className="settings-preview-caption">Appearance preview</p>
    <div className="settings-preview-capabilities"><span><BookOpen aria-hidden="true" />Knowledge available</span>{textEnabled && <span><TextCursorInput aria-hidden="true" />Text Box applied</span>}</div>
    {waveformId ? <Link className="secondary-button settings-preview-open" title="Opens your saved draft. Save first to include your edits." href={`/w/${encodeURIComponent(waveformId)}`}>Preview draft</Link>
      : <p className="field-help settings-preview-open">Save your draft to open it.</p>}
  </aside>;
}
