'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, Copy, EyeOff, Pause, Trash2, Undo2 } from 'lucide-react';
import type { KnowledgePassage } from '@/lib/plugin-contract';
import BrandLoader from './BrandLoader';
import StreamingText from './StreamingText';

export type LiveTextPanelProps = {
  text: string;
  sources?: KnowledgePassage[];
  pending?: boolean;
  writing: boolean;
  canUndo: boolean;
  onStop: () => void;
  onClear: () => void;
  onUndo: () => void;
  onHide: () => void;
  display?: 'text' | 'knowledge';
  externalHide?: boolean;
};
const NO_SOURCES: KnowledgePassage[] = [];

/** Page-local displayed text. The voice host owns updates and cancellation. */
export default function LiveTextPanel({ text, sources = NO_SOURCES, pending = false, writing, canUndo, onStop, onClear, onUndo, onHide, display = 'text', externalHide = false }: LiveTextPanelProps) {
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(display === 'text');
  const [copyResult, setCopyResult] = useState<{ text: string; message: string } | null>(null);

  useLayoutEffect(() => {
    if (display === 'text' && following && content.current) content.current.scrollTop = content.current.scrollHeight;
  }, [text, following, display]);

  useLayoutEffect(() => {
    // A fresh retrieval is a document to read from the beginning, not a transcript
    // to follow. Do not move it while the user scrolls or expands a source.
    if (display === 'knowledge' && !pending && content.current) content.current.scrollTop = 0;
  }, [text, display, pending, sources]);

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text + (sources.length ? '\n\nSources: ' + sources.map(p => p.filename).join('; ') : ''));
      setCopyResult({ text, message: 'Copied.' });
    } catch {
      setCopyResult({ text, message: 'Copy was unavailable. Select the text to copy it manually.' });
    }
  }

  return <section className="live-text-panel" aria-labelledby={titleId}>
    <div className="live-text-panel__heading">
      <h2 id={titleId}>{display === 'knowledge' ? 'Knowledge' : 'Text Box'}</h2>
      <span className="live-text-panel__state" role="status" aria-live="polite">{pending && !!text && <BrandLoader variant="inline" />}{pending ? 'Finding sources…' : display === 'knowledge' ? sources.length ? 'Sources ready' : 'No passages' : writing ? 'Writing' : 'Paused'}</span>
    </div>
    <div ref={content} className="live-text-panel__content" role="region" aria-label={display === 'knowledge' ? 'Knowledge content' : 'Text Box content'} aria-busy={pending} tabIndex={0}
      onScroll={event => { if (display === 'text') { const node = event.currentTarget; setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 32); } }}>
      {text ? <StreamingText text={text} /> : (pending ? <BrandLoader label="Finding relevant passages in your documents…" />
        : <span className="live-text-panel__placeholder">{display === 'knowledge' ? 'Ask about your documents and request the relevant passages and sources.' : 'Say “Start writing” to dictate, or ask the waveform to put text here.'}</span>)}
      {sources.length > 0 && <aside className="knowledge-sources" aria-label="Sources">
        <h3>Sources</h3>
        {sources.map((source, i) => <details key={source.id}>
          <summary>{i + 1}. {source.filename}</summary><blockquote>{source.quote}</blockquote>
        </details>)}
        <p>Passages from your selected documents. Page numbers are unavailable.</p>
      </aside>}
    </div>
    <footer className="live-text-panel__footer">
      {display === 'text' && !following && text && <button type="button" className="secondary-button live-text-panel__latest" onClick={() => setFollowing(true)}><ArrowDown aria-hidden="true" />Jump to latest</button>}
      <div className="live-text-panel__actions">
        {display === 'text' && <button type="button" className="secondary-button" onClick={onStop} disabled={!writing}><Pause aria-hidden="true" />Stop writing</button>}
        <button type="button" className="secondary-button" onClick={onUndo} disabled={!canUndo}><Undo2 aria-hidden="true" />Undo</button>
        <button type="button" className="secondary-button" onClick={onClear} disabled={!text}><Trash2 aria-hidden="true" />Clear</button>
        <button type="button" className="secondary-button live-text-panel__copy" onClick={() => void copyText()} disabled={!text}><Copy aria-hidden="true" />Copy text</button>
        {!externalHide && <button type="button" className="secondary-button" onClick={onHide}><EyeOff aria-hidden="true" />Hide</button>}
      </div>
      <p className="live-text-panel__help">{display === 'knowledge' ? 'Passages stay on this page. Copy to keep them.' : 'Text stays on this page. Copy to keep it.'}</p>
      {copyResult?.text === text && <p className="live-text-panel__copy-status" role="status" aria-live="polite">{copyResult.message}</p>}
    </footer>
  </section>;
}
