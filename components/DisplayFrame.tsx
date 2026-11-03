'use client';

import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';

/** Host-sized, accessible frame. Content never controls voice, focus, permissions or visibility. */
export default function DisplayFrame({ title, status, children, controls, contentKey, label = title + ' content' }: {
  title: string; status?: string; children: ReactNode; controls?: ReactNode; label?: string; contentKey?: string;
}) {
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (body.current) body.current.scrollTop = 0; }, [contentKey]);
  return <section className="live-text-panel display-frame" aria-labelledby={titleId}>
    <div className="live-text-panel__heading"><h2 id={titleId}>{title}</h2>{status && <span className="live-text-panel__state" role="status" aria-live="polite">{status}</span>}</div>
    <div ref={body} className="live-text-panel__content display-frame__body" role="region" aria-label={label} tabIndex={0}>{children}</div>
    {controls && <footer className="live-text-panel__footer">{controls}</footer>}
  </section>;
}
