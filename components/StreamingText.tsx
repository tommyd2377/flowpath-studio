'use client';

import { Streamdown, defaultRehypePlugins } from 'streamdown';
import { useState } from 'react';

// Formatting only: no executable HTML, remote media, links or generated controls.
// Omit rehype-raw, retaining sanitization. Copy/source attribution use original text.
const rehypePlugins = [defaultRehypePlugins.sanitize];
const allowedElements = ['p', 'br', 'span', 'strong', 'em', 'del', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'];
const noExternalUrl = () => '';
const components = { strong: 'strong' } as const;
const animation = { animation: 'fadeIn', duration: 180, easing: 'ease-out', sep: 'word', stagger: 24, maxBacklogMs: 600 } as const;

export default function StreamingText({ text }: { text: string }) {
  const [document, setDocument] = useState({ text, version: 0 });
  if (document.text !== text) {
    // Streamdown retains seen-word offsets for appends. A replacement is a new
    // document, so reset only its renderer, keeping the panel and scroll frame.
    setDocument({ text, version: text.startsWith(document.text) ? document.version : document.version + 1 });
  }
  // This is a live, mutable display even when dictation is paused. Delegated
  // replacements and verified Knowledge batches need the same word reveal.
  // This renders arriving data; it does not create provider/network streaming.
  return <Streamdown key={document.version} className="streaming-text" isAnimating animated={animation} controls={false}
    rehypePlugins={rehypePlugins} components={components} allowedElements={allowedElements} unwrapDisallowed urlTransform={noExternalUrl}>
    {text}
  </Streamdown>;
}
