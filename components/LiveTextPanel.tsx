'use client';

import { useId, useState } from 'react';

export type LiveTextPanelProps = {
  text: string;
  writing: boolean;
  canUndo: boolean;
  onStop: () => void;
  onClear: () => void;
  onUndo: () => void;
};

/** Session-owned plain text. The voice host owns updates and cancellation. */
export default function LiveTextPanel({ text, writing, canUndo, onStop, onClear, onUndo }: LiveTextPanelProps) {
  const titleId = useId();
  const [copyResult, setCopyResult] = useState<{ text: string; message: string } | null>(null);

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopyResult({ text, message: 'Copied.' });
    } catch {
      setCopyResult({ text, message: 'Copy was unavailable. Select the text to copy it manually.' });
    }
  }

  return <section className="live-text-panel" aria-labelledby={titleId}>
    <div className="live-text-panel__heading">
      <h2 id={titleId}>Text Box</h2>
      <span className="live-text-panel__state" role="status" aria-live="polite">{writing ? 'Writing' : 'Paused'}</span>
    </div>
    <div className="live-text-panel__content" role="region" aria-label="Text Box content" tabIndex={0}>
      {text || <span className="live-text-panel__placeholder">Say “Start writing” to dictate, or ask the waveform to put text here.</span>}
    </div>
    <div className="live-text-panel__actions">
      <button type="button" className="secondary-button" onClick={onStop} disabled={!writing}>Stop writing</button>
      <button type="button" className="secondary-button" onClick={onClear} disabled={!text}>Clear</button>
      <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}>Undo</button>
      <button type="button" className="secondary-button" onClick={() => void copyText()} disabled={!text}>Copy text</button>
    </div>
    <p className="live-text-panel__help">Text stays in this conversation. Copy anything you want to keep.</p>
    <p className="live-text-panel__copy-status" role="status" aria-live="polite">{copyResult?.text === text ? copyResult.message : ''}</p>
  </section>;
}
