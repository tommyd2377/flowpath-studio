'use client';

import { useState, useSyncExternalStore } from 'react';
import type { VoiceDiagnosticEvent, VoiceDiagnosticReport } from '@/lib/voice-diagnostics';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
const browserMode = () => new URLSearchParams(window.location.search).get('diagnostics') === '1';
const serverMode = () => false;

export function useDiagnosticsMode() {
  return useSyncExternalStore(subscribe, browserMode, serverMode);
}

function describe(event: VoiceDiagnosticEvent): string {
  switch (event.type) {
    case 'input_transcript': return `You (transcribed): ${event.delta}`;
    case 'output_transcript': return `Voice (transcribed): ${event.delta}`;
    case 'delegation_created': return `Observed handoff request to ${event.target}. No intent or task text is exposed.`;
    case 'unavailable_context_accepted': return 'The unavailable-capability context was accepted. This does not confirm what was spoken.';
    case 'usage': return `Provider usage so far: ${event.seconds} seconds (cumulative).`;
    case 'session_started': return 'Provider session started.';
    case 'session_closed': return `Provider closure confirmed: ${event.reason}; final usage ${event.seconds} seconds.`;
    case 'provider_error': return 'Provider reported an error (details omitted).';
    case 'lifecycle': return event.name.replaceAll('_', ' ');
    case 'marker': return '*** PROBLEM MARKED ***';
    case 'recording_finished': return `Recording stopped: ${event.reason.replaceAll('_', ' ')}.`;
    case 'capture_truncated': return 'Log limit reached; some events or text were omitted.';
  }
}

function readableLog(report: VoiceDiagnosticReport) {
  const lines: string[] = [];
  let previous: VoiceDiagnosticEvent | undefined;
  for (const event of report.events) {
    // Join adjacent fragments without inventing turn boundaries or changing their text.
    if ((event.type === 'input_transcript' || event.type === 'output_transcript') && previous?.type === event.type) {
      lines[lines.length - 1] += event.delta;
    } else lines.push(`${(event.atMs / 1000).toFixed(2)}s  ${describe(event)}`);
    previous = event;
  }
  return lines.join('\n\n');
}

export default function VoiceDiagnostics({ active, recordNext, onRecordNext, recording, hasReport, version,
  getReport, mark, stopRecording, clear }: {
  active: boolean; recordNext: boolean; onRecordNext: (value: boolean) => void;
  recording: boolean; hasReport: boolean; version: number;
  getReport: () => VoiceDiagnosticReport | null; mark: () => boolean; stopRecording: () => void; clear: () => void;
}) {
  const [review, setReview] = useState<{ version: number; report: VoiceDiagnosticReport } | null>(null);
  const [notice, setNotice] = useState('');
  const shownReport = hasReport && review?.version === version ? review.report : null;
  const refresh = () => {
    const report = getReport();
    setReview(report ? { version, report } : null);
    return report;
  };
  const save = () => {
    const report = refresh();
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flowpath-voice-diagnostics.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setNotice('Log saved on this device. It contains conversation text; review it before sharing.');
  };

  return <details className="voice-diagnostics" open>
    <summary>Conversation diagnostics{recording ? ' · Recording' : ''}</summary>
    <p>Off by default. Capture one conversation’s text and timing in this tab only. No raw audio, server log or automatic upload. Refreshing discards it; starting another conversation replaces it.</p>
    <label className="diagnostics-consent">
      <input type="checkbox" checked={recordNext} disabled={active} onChange={event => { onRecordNext(event.target.checked); setNotice(''); }} />
      Record my next conversation locally
    </label>
    <p>Enable before tapping the waveform. Transcriptions can be imperfect or overlap. Handoff events show observable behavior, not the model’s private reasoning. Missing events do not prove that no handoff occurred.</p>
    <div className="diagnostics-actions">
      <button type="button" className="secondary-button" disabled={!recording} onClick={() => { const marked = mark(); refresh(); setNotice(marked ? 'Problem marked.' : 'The log is full or stopped. Save it, then start a new recording.'); }}>Mark problem</button>
      <button type="button" className="secondary-button" disabled={!recording} onClick={() => { stopRecording(); refresh(); setNotice('Recording stopped. The voice can continue.'); }}>Stop recording</button>
      <button type="button" className="secondary-button" disabled={!hasReport} onClick={() => { refresh(); setNotice('Showing the log as it is now. Review again for new events.'); }}>Review log</button>
      <button type="button" className="secondary-button" disabled={!hasReport} onClick={save}>Save log</button>
      <button type="button" className="secondary-button" disabled={!hasReport} onClick={() => { clear(); setReview(null); onRecordNext(false); setNotice('Local log cleared. Recording is off.'); }}>Clear log</button>
    </div>
    <p role="status">{notice}</p>
    {shownReport && <>
      {shownReport.truncated && <p>Log limit reached. Some text or events were omitted.</p>}
      <label htmlFor="diagnostics-review">Captured exchange · relative arrival times</label>
      <textarea id="diagnostics-review" readOnly value={readableLog(shownReport)} spellCheck={false} />
    </>}
  </details>;
}
