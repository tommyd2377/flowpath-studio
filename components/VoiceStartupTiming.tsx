'use client';

import { useState } from 'react';
import type { StartupTimingReport } from '@/lib/voice-startup-timing';

export default function VoiceStartupTiming({ getReport }: { getReport: () => StartupTimingReport | null }) {
  const [report, setReport] = useState<StartupTimingReport | null>(null);
  return <details className="voice-diagnostics" open>
    <summary>Startup timing</summary>
    <p>Measures your next waveform click in this tab. Fixed timing labels only; no conversation text, audio or identifiers. Refreshing clears the report.</p>
    <p>Conversation readiness and first non-silent playback are separate. Playback is observed in the browser; confirm physical sound yourself. Record cold/warm conditions and any permission prompt separately.</p>
    <button type="button" className="secondary-button" onClick={() => setReport(getReport())}>Review startup timing</button>
    {report && <><label htmlFor="startup-timing-review">Startup timing · milliseconds from click</label>
      <textarea id="startup-timing-review" readOnly value={JSON.stringify(report, null, 2)} spellCheck={false} /></>}
  </details>;
}
