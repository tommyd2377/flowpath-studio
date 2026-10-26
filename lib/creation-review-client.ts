import { WAVEFORM_NAME_LIMIT, WAVEFORM_PROMPT_LIMIT } from './account-model';
import { validateTextPanelConfiguration, type TextPanelConfiguration } from './text-panel';

export type CreationReviewStatus = 'pending' | 'allowed' | 'blocked' | 'manual-review' | 'stale' | 'unavailable';
export type CreationReviewCandidate = { name: string; initialPrompt: string; textPanel?: TextPanelConfiguration | null };
export type CanonicalCreationReviewCandidate = { name: string; initialPrompt: string; textPanel: TextPanelConfiguration | null };
export type CreationReviewProof = { ownerUid: string; reviewId: string; digest: string; policyVersion: string; policyDigest: string };
export type CreationReviewQueueRecord = { proof: CreationReviewProof; candidate: CanonicalCreationReviewCandidate;
  status: CreationReviewStatus; categories: string[] };
export type CreationReviewClientResult = { ownerKey: string; key: string; status: CreationReviewStatus };

export const canDecideCreationReview = (status: CreationReviewStatus): boolean => status === 'manual-review';
export function creationReviewDecisionPayload(review: CreationReviewQueueRecord, decision: 'allowed' | 'blocked') {
  const { ownerUid, reviewId, digest, policyVersion, policyDigest } = review.proof;
  return { ownerUid, reviewId, digest, policyVersion, policyDigest, decision };
}

const statuses: CreationReviewStatus[] = ['pending', 'allowed', 'blocked', 'manual-review', 'stale', 'unavailable'];
const object = (input: unknown): Record<string, unknown> | null => input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null;
const identifier = (input: unknown): input is string => typeof input === 'string' && input.length > 0 && input.length <= 256;

/** Client cache key only. The server recomputes its own authoritative digest. */
export function canonicalCreationReviewCandidate(input: CreationReviewCandidate): { candidate: CanonicalCreationReviewCandidate; key: string } | null {
  try {
    if (typeof input.name !== 'string' || typeof input.initialPrompt !== 'string') return null;
    const name = input.name.trim(), initialPrompt = input.initialPrompt.trim();
    if (!name || name.length > WAVEFORM_NAME_LIMIT || /[\u0000-\u001f\u007f]/.test(name)
      || !initialPrompt || initialPrompt.length > WAVEFORM_PROMPT_LIMIT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(initialPrompt)) return null;
    const text = validateTextPanelConfiguration(input.textPanel);
    if (!text.ok) return null;
    const candidate = { name, initialPrompt, textPanel: text.value };
    return { candidate, key: JSON.stringify(candidate) };
  } catch { return null; }
}

export function creationReviewResponseStatus(input: unknown): CreationReviewStatus {
  try {
    const value = object(input), review = object(value?.review);
    if (value?.enabled !== true || !review || !identifier(review.reviewId) || !identifier(review.digest)
      || !identifier(review.policyVersion) || !identifier(review.policyDigest) || !statuses.includes(review.status as CreationReviewStatus)) return 'unavailable';
    return review.status as CreationReviewStatus;
  } catch { return 'unavailable'; }
}

/** A response for another edit/owner never enables Save, even before effect cleanup runs. */
export function creationReviewView({ enabled, ownerKey, key, result }: {
  enabled: boolean; ownerKey: string; key: string | null; result: CreationReviewClientResult | null;
}): { status: CreationReviewStatus | null; canSave: boolean } {
  if (!enabled) return { status: null, canSave: true };
  if (!ownerKey) return { status: 'unavailable', canSave: false };
  if (!key) return { status: null, canSave: false };
  const current = result?.ownerKey === ownerKey && result.key === key;
  const status = current ? result.status : result ? 'stale' : 'pending';
  return { status, canSave: current && status === 'allowed' };
}

/** Select only bounded review display/proof fields from the same-origin admin response. */
export function creationReviewQueueRecords(input: unknown): CreationReviewQueueRecord[] | null {
  try {
    const value = object(input);
    if (!Array.isArray(value?.reviews) || value.reviews.length > 100) return null;
    const records: CreationReviewQueueRecord[] = [];
    for (const input of value.reviews) {
      const row = object(input), proof = row, content = object(row?.candidate);
      if (!row || !proof || !content || !['ownerUid', 'reviewId', 'digest', 'policyVersion', 'policyDigest'].every(key => identifier(proof[key]))
        || !statuses.includes(row.status as CreationReviewStatus) || !Array.isArray(row.categories) || row.categories.length > 20
        || !row.categories.every(category => typeof category === 'string' && category.length <= 80)) return null;
      const normalized = canonicalCreationReviewCandidate(content as CreationReviewCandidate);
      if (!normalized) return null;
      records.push({ proof: { ownerUid: proof.ownerUid as string, reviewId: proof.reviewId as string, digest: proof.digest as string,
        policyVersion: proof.policyVersion as string, policyDigest: proof.policyDigest as string },
      candidate: normalized.candidate, status: row.status as CreationReviewStatus, categories: [...row.categories] });
    }
    return records;
  } catch { return null; }
}
