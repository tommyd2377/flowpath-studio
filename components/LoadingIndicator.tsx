import styles from './LoadingIndicator.module.css';

/** Indeterminate progress: the operation owns when this mounts and unmounts. */
export default function LoadingIndicator({ label = 'Working…', floating = false }: { label?: string; floating?: boolean }) {
  return <span className={`${styles.status}${floating ? ` ${styles.floating}` : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <span className={styles.spinner} aria-hidden="true"/><span>{label}</span>
  </span>;
}
