'use client';

import { useId, useState } from 'react';
import { projectTextPanelConfiguration, textPanelResetKey, type TextPanelConfiguration, type LegacyTextPanelConfiguration } from '@/lib/text-panel';

export type TextPanelProps = {
  configuration: TextPanelConfiguration | null;
  /** Change on waveform or account identity changes; never pass this value to analytics. */
  scopeKey: string;
  enabled?: boolean;
  initiallyVisible?: boolean;
};

function TextPanelContent({ configuration, enabled, initiallyVisible }: {
  configuration: LegacyTextPanelConfiguration; enabled: boolean; initiallyVisible: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);
  const contentId = useId();
  const shown = enabled && visible;

  return <section aria-label="Waveform text" style={{ width: '100%', maxWidth: '36rem', boxSizing: 'border-box',
    padding: '1rem', border: '1px solid currentColor', borderRadius: '1rem', textAlign: 'left' }}>
    <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem' }}>Text from this waveform’s creator</p>
    <button type="button" className="secondary-button" disabled={!enabled} aria-expanded={shown} aria-controls={contentId}
      onClick={() => setVisible(value => !value)}>{shown ? 'Hide text' : 'Show text'}</button>
    {!enabled && <p style={{ marginBottom: 0 }}>Text is unavailable.</p>}
    <div id={contentId} hidden={!shown} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', marginTop: '1rem' }}>
      {shown ? configuration.text : null}
    </div>
  </section>;
}

/** Displays approved creator text. Visitor actions affect this component only. */
export default function TextPanel({ configuration, scopeKey, enabled = true, initiallyVisible = false }: TextPanelProps) {
  const safeConfiguration = projectTextPanelConfiguration(configuration);
  if (!safeConfiguration || safeConfiguration.version !== 1) return null;
  return <TextPanelContent key={textPanelResetKey(scopeKey, safeConfiguration, enabled, initiallyVisible)}
    configuration={safeConfiguration} enabled={enabled} initiallyVisible={initiallyVisible} />;
}
