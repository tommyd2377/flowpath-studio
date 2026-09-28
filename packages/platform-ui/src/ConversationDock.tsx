'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { revealTransition } from './motion.js';

function Suggestions({ children, reduced }: { children: ReactNode; reduced: boolean | null }) {
  const present = useIsPresent();
  return <motion.div className="platform-conversation-suggestions" inert={!present} aria-hidden={!present}
    initial={{ opacity: 0, y: reduced ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -4 }}
    transition={{ ...revealTransition, duration: reduced ? 0 : .35 }}>{children}</motion.div>;
}

/** Keeps the conversation control mounted while moving between its dock and editing surface. */
export function ConversationDock({ expanded, onDismiss, children, suggestions }: {
  expanded: boolean; onDismiss: () => void; children: ReactNode; suggestions?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const dock = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const host = dock.current, control = surface.current;
    if (!host || !control) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const center = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) * .42;
        // Measure the untransformed dock so motion never feeds back into its
        // target. The visual viewport keeps editing above phone keyboards.
        setOffset(Math.max(0, center - host.getBoundingClientRect().top - control.offsetTop - control.offsetHeight / 2));
      });
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(host); observer.observe(control);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [expanded]);
  return <div ref={dock} className="platform-conversation-dock" data-expanded={expanded} onKeyDown={event => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); onDismiss(); }
  }}>
    <AnimatePresence initial={false}>{expanded && <motion.div className="platform-conversation-backdrop" aria-hidden="true"
      onPointerDown={onDismiss} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ ...revealTransition, duration: reduced ? 0 : .45 }}/>}</AnimatePresence>
    <motion.div ref={surface} className="platform-conversation-surface" initial={false}
      animate={{ y: expanded ? offset : 0 }} transition={{ duration: reduced ? 0 : .65, ease: [.22, 1, .36, 1] }}>
      {children}
      <AnimatePresence initial={false}>{expanded && suggestions && <Suggestions key="suggestions" reduced={reduced}>{suggestions}</Suggestions>}</AnimatePresence>
    </motion.div>
  </div>;
}
