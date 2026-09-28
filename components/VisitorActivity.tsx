'use client';

import { AnimatePresence, motion } from 'motion/react';
import { usePlatformReducedMotion } from '@thevoice/platform-ui';
import styles from './VisitorActivity.module.css';

/** Status comes from real task events; motion conveys activity, never completion. */
export default function VisitorActivity({ label }: { label: string }) {
  const reduce = usePlatformReducedMotion();
  return <span className={styles.activity} data-visitor-activity role="status" aria-live="polite" aria-atomic="true">
    <svg className={styles.orbit} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle className={styles.track} cx="10" cy="10" r="7.5"/>
      <circle className={styles.arc} cx="10" cy="10" r="7.5" pathLength="100" strokeDasharray="28 72"/>
    </svg>
    <span className={styles.accessibleLabel}>{label}</span>
    <span className={styles.labels} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.span key={label} className={styles.label} initial={{ opacity: 0, y: reduce ? 0 : 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : -3 }} transition={{ duration: reduce ? 0 : .16 }}>{label}</motion.span>
      </AnimatePresence>
    </span>
  </span>;
}
