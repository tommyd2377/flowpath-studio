import type { CreationSafetyStatus as SafetyStatus } from '@/lib/creation-safety';
import BrandLoader from './BrandLoader';

type Status = SafetyStatus | 'stale' | 'unavailable' | null;
const messages: Record<Exclude<Status, null>, string> = {
  pending: 'Checking this content before you create your waveform…',
  allowed: 'This version passed the safety review.',
  revoked: 'Approval for this version was revoked. Edit the content before requesting a new review.',
  blocked: 'This content cannot be used. Edit the name, instructions or text and try again.',
  'manual-review': 'This version needs an admin review before it can be used.',
  stale: 'Your content changed. This version needs a new safety review.',
  unavailable: 'Safety review is unavailable. Creation is paused until a review can be completed.',
};
/** Presentational only. The server must independently enforce the exact reviewed version. */
export default function CreationSafetyStatus({ status, categories = [] }: { status: Status; categories?: string[] }) {
  if (!status) return null;
  return <p className={status === 'blocked' || status === 'revoked' || status === 'unavailable' ? 'account-error' : 'field-help'}
    role="status" aria-live="polite" data-creation-safety={status}>{status === 'pending' && <BrandLoader variant="inline" />}{messages[status]}{(status === 'blocked' || status === 'manual-review') && categories.length > 0 && <> Review flags: {categories.join(', ')}.</>}</p>;
}
