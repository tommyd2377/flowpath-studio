import { createHash, randomUUID } from 'node:crypto';
import type { VoiceDatabase, VoiceTransaction } from './production-voice-store';
import {
  canonicalCreationCandidate, CreationSafetyError, creationContentDigest, creationPolicyDigest, creationSafetyBinding, evaluateCreationReview, sameCreationBinding,
  type CanonicalCreationCandidate, type CreationCandidate, type CreationReviewerResult, type CreationSafetyBinding,
  CREATION_SAFETY_CATEGORIES, type CreationSafetyCategory, type CreationSafetyPolicy, type CreationSafetyStatus,
} from './creation-safety';

export type CreationActor = { uid: string; accountSessionId: string };
export type CreationReviewProof = CreationSafetyBinding & { ownerUid: string; reviewId: string };
export type CreationReviewRecord = CreationReviewProof & {
  candidate: CanonicalCreationCandidate; status: CreationSafetyStatus; createdAt: number; updatedAt: number;
  attemptedAt: number | null; categories: CreationSafetyCategory[];
  reason: 'review-pending' | 'reviewed' | 'review-unavailable' | 'manual-decision';
  decision?: { actorUid: string; decision: 'allowed' | 'blocked'; decidedAt: number };
};
export type CreationReviewer = {
  mode: 'production' | 'fixture';
  review(candidate: CanonicalCreationCandidate, policy: CreationSafetyPolicy): Promise<CreationReviewerResult>;
};
export type CreationReviewOptions = {
  mode: 'production' | 'fixture'; policy(): CreationSafetyPolicy | null;
  verifyOwner(tx: VoiceTransaction, actor: CreationActor): Promise<void>;
  verifyAdmin(tx: VoiceTransaction, actor: CreationActor): Promise<void>;
  reviewer?: CreationReviewer | null; now?: () => number;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headPath = (uid: string) => `creationSafetyOwners/${hash(uid)}`;
const reviewPath = (id: string) => `creationSafetyReviews/${id}`;
const queuePath = 'creationSafetyQueue/manual';
const queueLimit = 200;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const proof = (record: CreationReviewRecord): CreationReviewProof => ({ ownerUid: record.ownerUid, reviewId: record.reviewId,
  digest: record.digest, policyVersion: record.policyVersion, policyDigest: record.policyDigest });
function actorValid(actor: CreationActor) {
  if (!actor || typeof actor.uid !== 'string' || !actor.uid || actor.uid.length > 128
    || typeof actor.accountSessionId !== 'string' || !actor.accountSessionId || actor.accountSessionId.length > 256) {
    throw new CreationSafetyError('A verified account session is required.', 403);
  }
}
function recordFrom(row: Record<string, unknown> | null): CreationReviewRecord | null {
  if (!row) return null;
  if (!validId(row.reviewId) || typeof row.ownerUid !== 'string' || !row.ownerUid
    || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)
    || typeof row.policyVersion !== 'string' || typeof row.policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.policyDigest)
    || !['pending', 'allowed', 'blocked', 'manual-review'].includes(String(row.status))
    || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)
    || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
    || row.attemptedAt !== null && (typeof row.attemptedAt !== 'number' || !Number.isFinite(row.attemptedAt))
    || !['review-pending', 'reviewed', 'review-unavailable', 'manual-decision'].includes(String(row.reason))
    || !Array.isArray(row.categories) || row.categories.some(category => !CREATION_SAFETY_CATEGORIES.includes(category))) {
    throw new CreationSafetyError('Invalid creation safety record.', 503);
  }
  const candidate = canonicalCreationCandidate(row.candidate);
  if (creationContentDigest(candidate) !== row.digest) throw new CreationSafetyError('Invalid creation safety content.', 503);
  return { ...row, candidate } as CreationReviewRecord;
}
function queueFrom(row: Record<string, unknown> | null): string[] {
  if (!row) return [];
  if (!Array.isArray(row.reviewIds) || row.reviewIds.length > queueLimit || row.reviewIds.some(id => !validId(id))
    || new Set(row.reviewIds).size !== row.reviewIds.length) throw new CreationSafetyError('Creation review queue is unavailable.', 503);
  return row.reviewIds as string[];
}

/** Server-only boundary. Actor verification callbacks must read authority inside the supplied transaction. */
export function createCreationReviewStore(database: VoiceDatabase, options: CreationReviewOptions) {
  if (options.mode === 'fixture' && process.env.NODE_ENV === 'production') {
    throw new CreationSafetyError('Creation safety fixtures are unavailable in production.', 503);
  }
  const now = options.now ?? Date.now;
  function policy() {
    const selected = options.policy();
    if (!selected) throw new CreationSafetyError('Creation safety is unavailable. Please try again later.', 503);
    creationPolicyDigest(selected);
    // Snapshot policy so an in-flight reviewer cannot mutate or inherit later configuration.
    return structuredClone(selected);
  }
  async function current(tx: VoiceTransaction, ownerUid: string) {
    const head = await tx.get(headPath(ownerUid));
    if (!head) return null;
    if (!validId(head.reviewId)) throw new CreationSafetyError('Invalid creation safety owner state.', 503);
    const record = recordFrom(await tx.get(reviewPath(head.reviewId)));
    if (!record || record.ownerUid !== ownerUid || record.reviewId !== head.reviewId) {
      throw new CreationSafetyError('Invalid creation safety ownership.', 503);
    }
    return record;
  }
  async function requireAllowed(tx: VoiceTransaction, ownerUid: string, candidate: CreationCandidate,
    expectedBinding?: CreationSafetyBinding): Promise<CreationReviewProof> {
    const binding = creationSafetyBinding(candidate, policy());
    const record = await current(tx, ownerUid);
    if (!record || record.status !== 'allowed' || !sameCreationBinding(record, binding)
      || expectedBinding && !sameCreationBinding(expectedBinding, binding)) {
      throw new CreationSafetyError('This exact content needs an allowed safety review before continuing.');
    }
    return proof(record);
  }
  return {
    requireAllowed,
    async get(actor: CreationActor) {
      actorValid(actor);
      return database.transaction(async tx => { await options.verifyOwner(tx, actor); return current(tx, actor.uid); });
    },
    async request(actor: CreationActor, input: CreationCandidate) {
      actorValid(actor);
      const candidate = canonicalCreationCandidate(input);
      return database.transaction(async tx => {
        await options.verifyOwner(tx, actor);
        const binding = creationSafetyBinding(candidate, policy());
        const prior = await current(tx, actor.uid);
        if (prior && sameCreationBinding(prior, binding)) return { record: prior, needsReview: false };
        const queue = queueFrom(await tx.get(queuePath)).filter(id => id !== prior?.reviewId);
        if (queue.length >= queueLimit) throw new CreationSafetyError('The creation review queue is full. Please try later.', 503);
        const timestamp = now();
        const record: CreationReviewRecord = { ...binding, ownerUid: actor.uid, reviewId: randomUUID(), candidate,
          status: 'pending', createdAt: timestamp, updatedAt: timestamp, attemptedAt: null, categories: [], reason: 'review-pending' };
        tx.set(reviewPath(record.reviewId), record);
        tx.set(headPath(actor.uid), { reviewId: record.reviewId });
        tx.set(queuePath, { reviewIds: [...queue, record.reviewId] });
        return { record, needsReview: true };
      });
    },
    /** At most one injected review attempt. Never accepts a browser-supplied verdict. */
    async runReview(expected: CreationReviewProof): Promise<CreationReviewRecord> {
      const selected = policy();
      const claim = await database.transaction(async tx => {
        if (!validId(expected.reviewId)) throw new CreationSafetyError('Unknown creation review.', 404);
        const record = recordFrom(await tx.get(reviewPath(expected.reviewId)));
        const active = record && await current(tx, record.ownerUid);
        if (!record || record.ownerUid !== expected.ownerUid || !sameCreationBinding(record, expected)
          || active?.reviewId !== record.reviewId || !sameCreationBinding(record, creationSafetyBinding(record.candidate, selected))) {
          throw new CreationSafetyError('This review is stale.');
        }
        if (record.status !== 'pending' || record.attemptedAt !== null) return { record, claimed: false };
        const claimed = { ...record, attemptedAt: now(), updatedAt: now() };
        tx.set(reviewPath(record.reviewId), claimed);
        return { record: claimed, claimed: true };
      });
      if (!claim.claimed) return claim.record;
      const reviewer = options.reviewer && (options.mode === 'fixture' || options.reviewer.mode !== 'fixture') ? options.reviewer : null;
      let result: unknown = null;
      let unavailable = !reviewer;
      if (reviewer) {
        try { result = await reviewer.review(structuredClone(claim.record.candidate), structuredClone(selected)); }
        catch { unavailable = true; }
      }
      return database.transaction(async tx => {
        const record = recordFrom(await tx.get(reviewPath(expected.reviewId)));
        const active = record && await current(tx, record.ownerUid);
        const queue = queueFrom(await tx.get(queuePath));
        if (!record || active?.reviewId !== record.reviewId || record.ownerUid !== expected.ownerUid
          || !sameCreationBinding(record, expected)
          || !sameCreationBinding(record, creationSafetyBinding(record.candidate, policy()))) {
          throw new CreationSafetyError('This review is stale.');
        }
        if (record.status !== 'pending') return record;
        const decision = evaluateCreationReview(result, selected);
        const completed: CreationReviewRecord = { ...record, ...decision, updatedAt: now(),
          reason: unavailable ? 'review-unavailable' : 'reviewed' };
        tx.set(reviewPath(record.reviewId), completed);
        tx.set(queuePath, { reviewIds: completed.status === 'manual-review' ? queue : queue.filter(id => id !== record.reviewId) });
        return completed;
      });
    },
    async listManual(actor: CreationActor): Promise<CreationReviewRecord[]> {
      actorValid(actor);
      return database.transaction(async tx => {
        await options.verifyAdmin(tx, actor);
        const queue = queueFrom(await tx.get(queuePath));
        const rows = await Promise.all(queue.map(id => tx.get(reviewPath(id))));
        return rows.map(recordFrom).filter((record): record is CreationReviewRecord => !!record
          && (record.status === 'pending' || record.status === 'manual-review'));
      });
    },
    async decide(actor: CreationActor, expected: CreationReviewProof & { decision: 'allowed' | 'blocked' }) {
      actorValid(actor);
      if (!['allowed', 'blocked'].includes(expected.decision)) throw new CreationSafetyError('Choose approve or reject.', 400);
      return database.transaction(async tx => {
        await options.verifyAdmin(tx, actor);
        if (!validId(expected.reviewId)) throw new CreationSafetyError('Unknown creation review.', 404);
        const record = recordFrom(await tx.get(reviewPath(expected.reviewId)));
        const active = record && await current(tx, record.ownerUid);
        const queue = queueFrom(await tx.get(queuePath));
        if (!record || record.ownerUid !== expected.ownerUid || active?.reviewId !== record.reviewId
          || !sameCreationBinding(record, expected)
          || !sameCreationBinding(record, creationSafetyBinding(record.candidate, policy()))) throw new CreationSafetyError('This review is stale.');
        if (record.status !== 'manual-review') throw new CreationSafetyError('Only content awaiting manual review can receive a manual decision.');
        const timestamp = now();
        const completed: CreationReviewRecord = { ...record, status: expected.decision, updatedAt: timestamp,
          reason: 'manual-decision', decision: { actorUid: actor.uid, decision: expected.decision, decidedAt: timestamp } };
        tx.set(reviewPath(record.reviewId), completed);
        tx.set(queuePath, { reviewIds: queue.filter(id => id !== record.reviewId) });
        return completed;
      });
    },
  };
}
export type CreationReviewStore = ReturnType<typeof createCreationReviewStore>;
