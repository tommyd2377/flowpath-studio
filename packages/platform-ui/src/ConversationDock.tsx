'use client';

import type { ReactNode } from 'react';
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
  expanded: boolean; onDismiss: () => void; children: ReactNode; suggestions: ReactNode;
}) {
  const reduced = useReducedMotion();
  return <div className="platform-conversation-dock" data-expanded={expanded} onKeyDown={event => {
    if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); onDismiss(); }
  }}>
    <AnimatePresence initial={false}>{expanded && <motion.div className="platform-conversation-backdrop" aria-hidden="true"
      onPointerDown={onDismiss} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ ...revealTransition, duration: reduced ? 0 : .45 }}/>}</AnimatePresence>
    <motion.div className="platform-conversation-surface" initial={false}
      animate={{ '--composer-progress': expanded ? 1 : 0 }} transition={{ duration: reduced ? 0 : .8, ease: [.22, 1, .36, 1] }}>
      {children}
      <AnimatePresence initial={false}>{expanded && <Suggestions key="suggestions" reduced={reduced}>{suggestions}</Suggestions>}</AnimatePresence>
    </motion.div>
  </div>;
}
