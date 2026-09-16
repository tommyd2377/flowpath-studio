'use client';

import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import LoadingIndicator from './LoadingIndicator';
import styles from './VisitorVoiceStage.module.css';

/** Shared invitation and dock for every publisher; the waveform never remounts. */
export default function VisitorVoiceStage({ entered, identity, status, hint, error = false, working = false, children }: {
  entered: boolean; working?: boolean; error?: boolean; identity?: ReactNode; status: string; hint: string; children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [lastStatus, setLastStatus] = useState('');
  if (status && status !== lastStatus) setLastStatus(status);
  return <motion.div className={styles.stage} data-voice-dock={entered || undefined} data-started={entered}
    initial={false} animate={{ '--opening-progress': entered ? 0 : 1 }}
    transition={{ duration: reduce ? 0 : .45, ease: [.22, 1, .36, 1], '--opening-progress': { duration: reduce ? 0 : 1.25, ease: [.22, 1, .36, 1] } }}>
    <motion.div className={styles.identity} aria-hidden={entered} initial={false} animate={{ opacity: entered ? 0 : 1 }} transition={{ duration: reduce ? 0 : .65 }}>{identity}</motion.div>
    <div className={styles.conversation}>
      {children}
      <motion.div className={styles.copy} aria-hidden={!status} initial={false} animate={{ opacity: status ? 1 : 0, y: status || reduce ? 0 : -4 }} transition={{ duration: reduce ? 0 : .45 }}>
        {working && !error ? <LoadingIndicator label={status || 'Working…'}/> : <p role={error ? 'alert' : 'status'} aria-live="polite" aria-atomic="true">{status || lastStatus}</p>}
      </motion.div>
      <motion.p className={styles.hint} aria-hidden={entered} initial={false} animate={{ opacity: entered ? 0 : 1 }} transition={{ duration: reduce ? 0 : .65 }}>{hint}</motion.p>
    </div>
  </motion.div>;
}
