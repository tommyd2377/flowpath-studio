'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, Copy, EyeOff, Pause, Trash2, Undo2 } from 'lucide-react';

export type LiveTextPanelProps = {
  text: string;
  writing: boolean;
  canUndo: boolean;
  onStop: () => void;
  onClear: () => void;
  onUndo: () => void;
  onHide: () => void;
};

/** Session-owned plain text. The voice host owns updates and cancellation. */
export default function LiveTextPanel({ text, writing, canUndo, onStop, onClear, onUndo, onHide }: LiveTextPanelProps) {
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [copyResult, setCopyResult] = useState<{ text: string; message: string } | null>(null);

  useEffect(() => {
    if (following && content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [text, following]);

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
    <div ref={content} className="live-text-panel__content" role="region" aria-label="Text Box content" tabIndex={0}
      onScroll={event => { const node = event.currentTarget; setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 32); }}>
      {text || <span className="live-text-panel__placeholder">Say “Start writing” to dictate, or ask the waveform to put text here.</span>}
    </div>
    <footer className="live-text-panel__footer">
      {!following && text && <button type="button" className="secondary-button live-text-panel__latest" onClick={() => setFollowing(true)}><ArrowDown aria-hidden="true" />Jump to latest</button>}
      <div className="live-text-panel__actions">
        <button type="button" className="secondary-button" onClick={onStop} disabled={!writing}><Pause aria-hidden="true" />Stop writing</button>
        <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}><Undo2 aria-hidden="true" />Undo</button>
        <button type="button" className="secondary-button" onClick={onClear} disabled={!text}><Trash2 aria-hidden="true" />Clear</button>
        <button type="button" className="secondary-button live-text-panel__copy" onClick={() => void copyText()} disabled={!text}><Copy aria-hidden="true" />Copy text</button>
        <button type="button" className="secondary-button" onClick={onHide}><EyeOff aria-hidden="true" />Hide</button>
      </div>
      <p className="live-text-panel__help">Text stays in this conversation. Copy to keep it.</p>
      {copyResult?.text === text && <p className="live-text-panel__copy-status" role="status" aria-live="polite">{copyResult.message}</p>}
    </footer>
  </section>;
}
