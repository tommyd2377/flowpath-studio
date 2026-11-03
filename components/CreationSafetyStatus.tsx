import type { CreationSafetyStatus as SafetyStatus } from '@/lib/creation-safety';
import BrandLoader from './BrandLoader';
import CreationReviewFindings from './CreationReviewFindings';

type Status = SafetyStatus | 'stale' | 'unavailable' | null;
const messages: Record<Exclude<Status, null>, string> = {
  pending: 'Checking this content before you create your waveform…',
  allowed: 'This version passed the safety review.',
  revoked: 'This version or an item it contains was rejected. Replace rejected content before requesting a new review.',
  blocked: 'This version was blocked by the safety review and sent to the founder’s queue for inspection. Open the review details below, then edit the relevant content and review again.',
  'manual-review': 'Sent to the founder for a decision. This version is on hold until that review is complete.',
  stale: 'This version needs a current safety review before it can be saved.',
  unavailable: 'Safety review is unavailable. Creation is paused until a review can be completed.',
};
const compactMessages: typeof messages = {
  pending: 'Checking…',
  allowed: 'Ready to save',
  revoked: 'Content rejected. Edit this version before saving.',
  blocked: 'Blocked. Edit the flagged content before saving.',
  'manual-review': 'Founder review required. This version is on hold.',
  stale: 'Review this version before saving.',
  unavailable: 'Review unavailable. Saving is paused.',
};
/** Presentational only. The server must independently enforce the exact reviewed version. */
export default function CreationSafetyStatus({ status, categories = [], compact = false }: { status: Status; categories?: string[]; compact?: boolean }) {
  if (!status) return null;
  return <div role="status" aria-live="polite" data-creation-safety={status}>
    <p className={status === 'blocked' || status === 'revoked' || status === 'unavailable' ? 'account-error' : 'field-help'}>
      {status === 'pending' && <BrandLoader variant="inline" />}
      {status === 'allowed' && categories.length ? compact ? 'Ready to save · Founder follow-up' : 'This version can be used now. It was also sent to the founder for follow-up.' : (compact ? compactMessages : messages)[status]}</p>
    {['blocked', 'manual-review', 'allowed'].includes(status) && <CreationReviewFindings categories={categories} />}
  </div>;
}
