import type { CreationSafetyStatus as SafetyStatus } from '@/lib/creation-safety';

type Status = SafetyStatus | 'stale' | 'unavailable' | null;
const messages: Record<Exclude<Status, null>, string> = {
  pending: 'Checking this content before you create your waveform…',
  allowed: 'This version passed the safety review.',
  blocked: 'This content cannot be used. Edit the name, instructions or text and try again.',
  'manual-review': 'This version needs an admin review before it can be used.',
  stale: 'Your content changed. This version needs a new safety review.',
  unavailable: 'Safety review is unavailable. Creation is paused until a review can be completed.',
};
/** Presentational only. The server must independently enforce the exact reviewed version. */
export default function CreationSafetyStatus({ status }: { status: Status }) {
  if (!status) return null;
  return <p className={status === 'blocked' || status === 'unavailable' ? 'account-error' : 'field-help'}
    role="status" aria-live="polite" data-creation-safety={status}>{messages[status]}</p>;
}
