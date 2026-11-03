import { createHash, randomUUID } from 'node:crypto';
import { FRANKLIN_DEMO_ID } from './public-voice-identity';
import { compatiblePreviousBindings } from './creation-policy';
import type { VoiceDatabase, VoiceTransaction } from './production-voice-store';
import {
  canonicalCreationCandidate, CreationSafetyError, creationContentDigest, creationPolicyDigest, creationSafetyBinding, evaluateCreationReview, sameCreationBinding,
  type CanonicalCreationCandidate, type CreationCandidate, type CreationReviewerResult, type CreationSafetyBinding,
  CREATION_SAFETY_CATEGORIES, CreationReviewUnavailable, type ReviewIssue, type CreationSafetyCategory, type CreationSafetyPolicy, type CreationSafetyStatus,
} from './creation-safety';

export type CreationActor = { waveformId?: string; uid: string; accountSessionId: string };
export type CreationReviewProof = CreationSafetyBinding & { ownerUid: string; reviewId: string };
export type CreationReviewRecord = CreationReviewProof & {
  waveformId?: string;
  candidate: CanonicalCreationCandidate; status: CreationSafetyStatus; createdAt: number; updatedAt: number;
  attemptedAt: number | null; categories: CreationSafetyCategory[];
  reason: 'review-pending' | 'reviewed' | 'review-unavailable' | 'manual-decision' | 'manual-revocation';
  decision?: { actorUid: string; decision: 'allowed' | 'blocked' | 'revoked'; decidedAt: number; item?: string };
  issue?: ReviewIssue;
};
export class RejectedCreationItem extends CreationSafetyError {
  constructor() { super('An item in this submission was rejected. Replace or remove it before requesting another review.'); }
}

export type CreationReviewer = {
  mode: 'production' | 'fixture';
  review(candidate: CanonicalCreationCandidate, policy: CreationSafetyPolicy, context?: { ownerUid: string; reviewId: string }): Promise<CreationReviewerResult>;
};
export type CreationReviewOptions = {
  mode: 'production' | 'fixture'; policy(): CreationSafetyPolicy | null;
  verifyOwner(tx: VoiceTransaction, actor: CreationActor): Promise<void>;
  verifyAdmin(tx: VoiceTransaction, actor: CreationActor): Promise<void>;
  reviewer?: CreationReviewer | null; now?: () => number;
  validateCandidate?(tx: VoiceTransaction, ownerUid: string, candidate: CanonicalCreationCandidate): Promise<void>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const headPath = (uid: string, documentId?: string, waveformId?: string) => `creationSafetyOwners/${hash(documentId ? `${uid}:document:${documentId}${waveformId ? `:waveform:${waveformId}` : ''}` : waveformId ? `${uid}:waveform:${waveformId}` : uid)}`;
const reviewPath = (id: string) => `creationSafetyReviews/${id}`;
const approvedVersionPath = (uid: string, binding: CreationSafetyBinding) => `creationSafetyVersions/${hash(`${uid}:${binding.digest}:${binding.policyDigest}`)}`;
// A field decision follows the exact submitted value across edits to this waveform.
const rejectedItemsPath = (uid: string, waveformId?: string) => `creationSafetyRejectedItems/${hash(JSON.stringify([uid, waveformId]))}`;
function reviewItems(candidate: CanonicalCreationCandidate) {
  if (candidate.document) return [['document', candidate.document.digest]];
  return [
    ['name', candidate.name], ['instructions', candidate.initialPrompt],
    ...(candidate.profilePhoto ? [['portrait', candidate.profilePhoto]] : []),
    ...(candidate.textPanel?.version === 1 ? [['creator-text', candidate.textPanel.text]] : []),
    ...(candidate.visualDisplay?.images.map(image => [`image:${image.id}`, image.src]) ?? []),
  ];
}
const itemFingerprint = ([key, value]: string[]) => hash(JSON.stringify([key.startsWith('image:') || key === 'portrait' ? 'image' : key, value]));

const queuePath = 'creationSafetyQueue/manual';
const queueLimit = 200;
const validId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const proof = (record: CreationReviewRecord): CreationReviewProof => ({ ownerUid: record.ownerUid, reviewId: record.reviewId,
  digest: record.digest, policyVersion: record.policyVersion, policyDigest: record.policyDigest });
function actorValid(actor: CreationActor) {
  if (actor?.waveformId !== undefined && !validId(actor.waveformId)) throw new CreationSafetyError('Invalid waveform.', 400);
  if (!actor || typeof actor.uid !== 'string' || !actor.uid || actor.uid.length > 128
    || typeof actor.accountSessionId !== 'string' || !actor.accountSessionId || actor.accountSessionId.length > 256) {
    throw new CreationSafetyError('A verified account session is required.', 403);
  }
}
function recordFrom(row: Record<string, unknown> | null): CreationReviewRecord | null {
  if (!row) return null;
  if (!validId(row.reviewId) || typeof row.ownerUid !== 'string' || !row.ownerUid
    || row.waveformId !== undefined && !validId(row.waveformId)
    || typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)
    || typeof row.policyVersion !== 'string' || typeof row.policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(row.policyDigest)
    || !['pending', 'allowed', 'blocked', 'manual-review', 'revoked'].includes(String(row.status))
    || typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)
    || typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)
    || row.attemptedAt !== null && (typeof row.attemptedAt !== 'number' || !Number.isFinite(row.attemptedAt))
    || !['review-pending', 'reviewed', 'review-unavailable', 'manual-decision', 'manual-revocation'].includes(String(row.reason))
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
  async function current(tx: VoiceTransaction, ownerUid: string, documentId?: string, waveformId?: string) {
    const scoped = await tx.get(headPath(ownerUid, documentId, waveformId));
    const head = scoped ?? (waveformId ? await tx.get(headPath(ownerUid, documentId)) : null);
    if (!head) return null;
    if (!validId(head.reviewId)) throw new CreationSafetyError('Invalid creation safety owner state.', 503);
    const record = recordFrom(await tx.get(reviewPath(head.reviewId)));
    if (!record || record.ownerUid !== ownerUid || record.reviewId !== head.reviewId || record.candidate.document?.id !== documentId) {
      throw new CreationSafetyError('Invalid creation safety ownership.', 503);
    }
    return record;
  }
  function matches(record: CreationReviewRecord, binding: CreationSafetyBinding) {
    return sameCreationBinding(record, binding) || record.status === 'allowed'
      && compatiblePreviousBindings(binding).some(previous => sameCreationBinding(record, previous));
  }
  function inspectable(record: CreationReviewRecord, binding: CreationSafetyBinding) {
    return matches(record, binding) || record.status === 'blocked' && record.reason === 'reviewed'
      && compatiblePreviousBindings(binding).some(previous => sameCreationBinding(record, previous));
  }
  function restoreAutomaticBlock(queue: string[], record: CreationReviewRecord | null, selected: CreationSafetyPolicy) {
    if (!record || record.status !== 'blocked' || record.reason !== 'reviewed' || queue.includes(record.reviewId)
      || !inspectable(record, creationSafetyBinding(record.candidate, selected))) return queue;
    if (queue.length >= queueLimit) throw new CreationSafetyError('The creation review queue is full. Please try later.', 503);
    return [...queue, record.reviewId];
  }
  async function indexed(tx: VoiceTransaction, uid: string, binding: CreationSafetyBinding) {
    for (const version of [binding, ...compatiblePreviousBindings(binding)]) {
      const reference = await tx.get(approvedVersionPath(uid, version));
      if (reference && !validId(reference.reviewId)) throw new CreationSafetyError('Invalid saved review reference.', 503);
      if (reference) return recordFrom(await tx.get(reviewPath(reference.reviewId as string)));
    }
    return null;
  }
  async function rejectedItems(tx: VoiceTransaction, uid: string, waveformId?: string): Promise<string[]> {
    const row = await tx.get(rejectedItemsPath(uid, waveformId));
    if (!row) return [];
    if (!Array.isArray(row.items) || row.items.some(item => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item))) {
      throw new CreationSafetyError('Item review decisions are unavailable.', 503);
    }
    return row.items as string[];
  }

  async function hasRejectedItem(tx: VoiceTransaction, uid: string, candidate: CanonicalCreationCandidate, waveformId?: string) {
    const rejected = await rejectedItems(tx, uid, waveformId);
    const legacy = waveformId ? await rejectedItems(tx, uid) : [];
    if (!rejected.length && !legacy.length) return false;
    return reviewItems(candidate).some(item => {
      const fingerprint = itemFingerprint(item);
      return rejected.includes(fingerprint) || legacy.includes(fingerprint);
    });
  }

  async function assertItemsAllowed(tx: VoiceTransaction, uid: string, candidate: CanonicalCreationCandidate, waveformId?: string) {
    if (await hasRejectedItem(tx, uid, candidate, waveformId)) {
      throw new RejectedCreationItem();
    }
  }

  async function requireAllowed(tx: VoiceTransaction, ownerUid: string, candidate: CreationCandidate & { id?: string },
    expectedBinding?: CreationSafetyBinding, waveformId = candidate.id ?? candidate.document?.waveformId): Promise<CreationReviewProof> {
    const binding = creationSafetyBinding(candidate, policy());
    const canonical = canonicalCreationCandidate(candidate);
    await options.validateCandidate?.(tx, ownerUid, canonical);
    await assertItemsAllowed(tx, ownerUid, canonical, waveformId);
    const record = await current(tx, ownerUid, candidate.document?.id, waveformId);
    if (!record || record.status !== 'allowed' || !matches(record, binding)
      || expectedBinding && !sameCreationBinding(expectedBinding, record)) {
      throw new CreationSafetyError('This exact content needs an allowed safety review before continuing.');
    }
    return proof(record);
  }
  // A stored published snapshot can retain its exact, unrevoked approval while the draft changes.
  // Draft Save/Create still requires the current review head through requireAllowed.
  async function requireSnapshotAllowed(tx: VoiceTransaction, ownerUid: string, candidate: CreationCandidate & { id?: string }) {
    const binding = creationSafetyBinding(candidate, policy());
    const canonical = canonicalCreationCandidate(candidate);
    await options.validateCandidate?.(tx, ownerUid, canonical);
    const waveformId = candidate.id ?? candidate.document?.waveformId;
    await assertItemsAllowed(tx, ownerUid, canonical, waveformId);
    const head = await current(tx, ownerUid, candidate.document?.id, waveformId);
    if (head?.status === 'allowed' && matches(head, binding)) return proof(head);
    const record = await indexed(tx, ownerUid, binding);
    if (!record || record.ownerUid !== ownerUid || record.candidate.document?.id !== candidate.document?.id
      || record.status !== 'allowed' || !matches(record, binding)) {
      throw new CreationSafetyError('This published version needs an allowed safety review before continuing.');
    }
    return proof(record);
  }
  return {
    requireAllowed, requireSnapshotAllowed,
    // A curated publication may retain an older manual approval in the founder's
    // follow-up queue. This never grants or changes an approval.
    async followUp(ownerUid: string, candidate: CreationCandidate) {
      return database.transaction(async tx => {
        const approved = await requireSnapshotAllowed(tx, ownerUid, candidate);
        const record = recordFrom(await tx.get(reviewPath(approved.reviewId)))!;
        const queue = queueFrom(await tx.get(queuePath));
        if ((record.categories.length || record.reason === 'manual-decision') && !queue.includes(record.reviewId)) {
          if (queue.length >= queueLimit) throw new CreationSafetyError('The creation review queue is full.', 503);
          tx.set(queuePath, { reviewIds: [...queue, record.reviewId] });
        }
      });
    },
    async get(actor: CreationActor, documentId?: string) {
      actorValid(actor);
      if (documentId !== undefined && !validId(documentId)) throw new CreationSafetyError('Invalid document.', 400);
      const selected = policy();
      const record = await database.transaction(async tx => {
        await options.verifyOwner(tx, actor); const record = await current(tx, actor.uid, documentId, actor.waveformId);
        if (record && await hasRejectedItem(tx, actor.uid, record.candidate, actor.waveformId ?? record.waveformId)) {
          return { ...record, itemBlocked: true };
        }
        if (!record || record.status !== 'blocked' || record.reason !== 'reviewed') return record;
        try { await options.validateCandidate?.(tx, actor.uid, record.candidate); }
        catch (error) {
          if (record.candidate.document && error instanceof CreationSafetyError && error.status === 409) return record;
          throw error;
        }
        const queue = queueFrom(await tx.get(queuePath));
        const restored = restoreAutomaticBlock(queue, record, selected);
        if (restored !== queue) tx.set(queuePath, { reviewIds: restored });
        return record;
      });
      // Commit queue repair even when the old verdict now needs a fresh review.
      if (record && !matches(record, creationSafetyBinding(record.candidate, selected))) throw new CreationSafetyError('The review policy changed. Review this version again.');
      return record && 'itemBlocked' in record ? { ...record, status: 'revoked' as const } : record;
    },
    async getForAdmin(actor: CreationActor, id: string) {
      actorValid(actor);
      return database.transaction(async tx => {
        await options.verifyAdmin(tx, actor);
        if (!validId(id)) throw new CreationSafetyError('Invalid review.', 400);
        const record = recordFrom(await tx.get(reviewPath(id)));
        if (!record || !['pending', 'manual-review', 'allowed', 'blocked'].includes(record.status)
          || record.status !== 'allowed' && (await current(tx, record.ownerUid, record.candidate.document?.id, record.waveformId))?.reviewId !== id
          || !inspectable(record, creationSafetyBinding(record.candidate, policy()))) throw new CreationSafetyError('This review is no longer current.', 409);
        await options.validateCandidate?.(tx, record.ownerUid, record.candidate);
        return record;
      });
    },
    async request(actor: CreationActor, input: CreationCandidate) {
      actorValid(actor);
      const candidate = canonicalCreationCandidate(input);
      return database.transaction(async tx => {
        await options.verifyOwner(tx, actor);
        await options.validateCandidate?.(tx, actor.uid, candidate);
        await assertItemsAllowed(tx, actor.uid, candidate, actor.waveformId ?? candidate.document?.waveformId);
        const selected = policy(), binding = creationSafetyBinding(candidate, selected);
        const prior = await current(tx, actor.uid, candidate.document?.id, actor.waveformId ?? candidate.document?.waveformId);
        if (prior && matches(prior, binding)) {
          // Older automatic blocks were removed from the queue. An explicit
          // request restores visibility without another provider call or verdict.
          if (prior.status === 'blocked' && prior.reason === 'reviewed') {
            const queue = queueFrom(await tx.get(queuePath));
            const restored = restoreAutomaticBlock(queue, prior, selected);
            if (restored !== queue) tx.set(queuePath, { reviewIds: restored });
          }
          return { record: prior, needsReview: false };
        }
        const reusable = await indexed(tx, actor.uid, binding);
        if (reusable && (reusable.ownerUid !== actor.uid || reusable.candidate.document?.id !== candidate.document?.id
          || !(matches(reusable, binding) || reusable.status === 'revoked'
            && compatiblePreviousBindings(binding).some(previous => sameCreationBinding(reusable, previous))))) throw new CreationSafetyError('Invalid saved review binding.', 503);
        if (reusable && reusable.status !== 'allowed') throw new CreationSafetyError('The previous approval is no longer valid.');
        const queue = queueFrom(await tx.get(queuePath)).filter(id => id !== prior?.reviewId || prior?.waveformId !== actor.waveformId || prior?.status === 'allowed');
        if (!reusable && queue.length >= queueLimit) throw new CreationSafetyError('The creation review queue is full. Please try later.', 503);
        // Index only an actual completed approval, never a client verdict or missing legacy review.
        if (prior?.status === 'allowed' && matches(prior, creationSafetyBinding(prior.candidate, selected))) {
          tx.set(approvedVersionPath(actor.uid, prior), { reviewId: prior.reviewId });
        }
        if (reusable) {
          tx.set(headPath(actor.uid, candidate.document?.id, actor.waveformId ?? candidate.document?.waveformId), { reviewId: reusable.reviewId });
          tx.set(queuePath, { reviewIds: queue });
          return { record: reusable, needsReview: false };
        }
        const timestamp = now();
        const record: CreationReviewRecord = { ...binding, ...((actor.waveformId ?? candidate.document?.waveformId) ? { waveformId: actor.waveformId ?? candidate.document?.waveformId } : {}), ownerUid: actor.uid, reviewId: randomUUID(), candidate,
          status: 'pending', createdAt: timestamp, updatedAt: timestamp, attemptedAt: null, categories: [], reason: 'review-pending' };
        tx.set(reviewPath(record.reviewId), record);
        tx.set(headPath(actor.uid, candidate.document?.id, actor.waveformId ?? candidate.document?.waveformId), { reviewId: record.reviewId });
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
        const active = record && await current(tx, record.ownerUid, record.candidate.document?.id, record.waveformId);
        if (!record || record.ownerUid !== expected.ownerUid || !sameCreationBinding(record, expected)
          || active?.reviewId !== record.reviewId || !sameCreationBinding(record, creationSafetyBinding(record.candidate, selected))) {
          throw new CreationSafetyError('This review is stale.');
        }
        await options.validateCandidate?.(tx, record.ownerUid, record.candidate);
        await assertItemsAllowed(tx, record.ownerUid, record.candidate, record.waveformId);
        if (record.status !== 'pending' || record.attemptedAt !== null) return { record, claimed: false };
        const claimed = { ...record, attemptedAt: now(), updatedAt: now() };
        tx.set(reviewPath(record.reviewId), claimed);
        return { record: claimed, claimed: true };
      });
      if (!claim.claimed) return claim.record;
      const reviewer = options.reviewer && (options.mode === 'fixture' || options.reviewer.mode !== 'fixture') ? options.reviewer : null;
      let result: unknown = null;
      let unavailable = !reviewer;
      let issue: ReviewIssue | undefined;
      if (reviewer) {
        try { result = await reviewer.review(structuredClone(claim.record.candidate), structuredClone(selected), { ownerUid: claim.record.ownerUid, reviewId: claim.record.reviewId }); }
        catch (error) { unavailable = true; issue = error instanceof CreationReviewUnavailable ? error.issue : 'provider'; }
      }
      return database.transaction(async tx => {
        const record = recordFrom(await tx.get(reviewPath(expected.reviewId)));
        const active = record && await current(tx, record.ownerUid, record.candidate.document?.id, record.waveformId);
        const queue = queueFrom(await tx.get(queuePath));
        if (!record || active?.reviewId !== record.reviewId || record.ownerUid !== expected.ownerUid
          || !sameCreationBinding(record, expected)
          || !matches(record, creationSafetyBinding(record.candidate, policy()))) {
          throw new CreationSafetyError('This review is stale.');
        }
        await options.validateCandidate?.(tx, record.ownerUid, record.candidate);
        if (record.status !== 'pending') return record;
        await assertItemsAllowed(tx, record.ownerUid, record.candidate, record.waveformId);
        const decision = evaluateCreationReview(result, selected);
        const completed: CreationReviewRecord = { ...record, ...decision, updatedAt: now(),
          reason: unavailable ? 'review-unavailable' : 'reviewed', ...(issue ? { issue } : {}) };
        tx.set(reviewPath(record.reviewId), completed);
        tx.set(queuePath, { reviewIds: completed.status === 'manual-review' || completed.status === 'blocked'
          || completed.status === 'allowed' && completed.categories.length > 0 ? queue : queue.filter(id => id !== record.reviewId) });
        return completed;
      });
    },
    async listManual(actor: CreationActor): Promise<(CreationReviewRecord & { policyCurrent: boolean; reviewHead: boolean; itemBlocked: boolean; published: boolean })[]> {
      actorValid(actor);
      const selected = policy();
      return database.transaction(async tx => {
        await options.verifyAdmin(tx, actor);
        const storedQueue = queueFrom(await tx.get(queuePath));
        const queue = restoreAutomaticBlock(storedQueue, await current(tx, actor.uid), selected);
        const rows = await Promise.all(queue.map(id => tx.get(reviewPath(id))));
        const demo = await tx.get(`publicDemoWaveforms/${FRANKLIN_DEMO_ID}`);
        const publications = new Map<string, Promise<Record<string, unknown> | null>>();
        const checked = await Promise.all(rows.map(async row => {
          const record = recordFrom(row);
          if (!record || !['pending', 'manual-review', 'allowed', 'blocked'].includes(record.status)
            || record.status === 'blocked' && record.reason !== 'reviewed'
            || !inspectable(record, creationSafetyBinding(record.candidate, selected))) return null;
          const reviewHead = (await current(tx, record.ownerUid, record.candidate.document?.id, record.waveformId))?.reviewId === record.reviewId;
          if (record.status !== 'allowed' && !reviewHead) return null;
          try {
            await options.validateCandidate?.(tx, record.ownerUid, record.candidate);
            const itemBlocked = await hasRejectedItem(tx, record.ownerUid, record.candidate, record.waveformId);
            let published = !record.candidate.document && demo?.ownerUid === record.ownerUid && demo?.contentDigest === record.digest;
            if (!published && !record.candidate.document && record.waveformId) {
              const id = record.waveformId;
              const publication = publications.get(id) ?? tx.get(`paidTestWaveforms/${hash(id)}`);
              publications.set(id, publication);
              const row = await publication;
              published = row?.published === true && row.ownerUid === record.ownerUid && !!row.waveform
                && creationContentDigest(row.waveform as CreationCandidate) === record.digest;
            }
            return { ...record, reviewHead, itemBlocked, published };
          } catch (error) {
            // Prune deleted/changed documents from the active queue, retaining
            // their review records. Infrastructure failures must remain visible.
            if (record.candidate.document && error instanceof CreationSafetyError && error.status === 409) return null;
            throw error;
          }
        }));
        const records = checked.filter(record => record !== null);
        if (records.length !== storedQueue.length || queue !== storedQueue) tx.set(queuePath, { reviewIds: records.map(record => record.reviewId) });
        return records.map(({ reviewHead, itemBlocked, published, ...record }) => {
          const policyCurrent = matches(record, creationSafetyBinding(record.candidate, selected));
          if (record.status !== 'pending' || now() - (record.attemptedAt ?? record.createdAt) < 120_000) return { ...record, policyCurrent, reviewHead, itemBlocked, published };
          const recovered: CreationReviewRecord = { ...record, status: 'manual-review', issue: 'abandoned', reason: 'review-unavailable', updatedAt: now() };
          tx.set(reviewPath(record.reviewId), recovered); return { ...recovered, policyCurrent, reviewHead, itemBlocked, published };
        });
      });
    },
    async decide(actor: CreationActor, expected: CreationReviewProof & { decision: 'allowed' | 'blocked' | 'revoked'; item?: string }) {
      actorValid(actor);
      if (!['allowed', 'blocked', 'revoked'].includes(expected.decision)) throw new CreationSafetyError('Choose approve or reject.', 400);
      return database.transaction(async tx => {
        await options.verifyAdmin(tx, actor);
        if (!validId(expected.reviewId)) throw new CreationSafetyError('Unknown creation review.', 404);
        const record = recordFrom(await tx.get(reviewPath(expected.reviewId)));
        const active = record && await current(tx, record.ownerUid, record.candidate.document?.id, record.waveformId);
        const queue = queueFrom(await tx.get(queuePath));
        if (!record || record.ownerUid !== expected.ownerUid || (expected.decision === 'revoked' ? !queue.includes(record.reviewId) : active?.reviewId !== record.reviewId)
          || !sameCreationBinding(record, expected)
          || !matches(record, creationSafetyBinding(record.candidate, policy()))) throw new CreationSafetyError('This review is stale.');
        await options.validateCandidate?.(tx, record.ownerUid, record.candidate);
        if (expected.decision === 'revoked' ? record.status !== 'allowed' : record.status !== 'manual-review') {
          throw new CreationSafetyError(expected.decision === 'revoked' ? 'This approved version is no longer available to reject.' : 'Only content awaiting manual review can receive a manual decision.');
        }
        if (expected.item !== undefined) {
          const item = reviewItems(record.candidate).find(([key]) => key === expected.item);
          if (!item || expected.decision === 'allowed') throw new CreationSafetyError('Choose an item from this review to reject.', 400);
          const rejected = await rejectedItems(tx, record.ownerUid, record.waveformId);
          const fingerprint = itemFingerprint(item);
          if (!rejected.includes(fingerprint)) {
            if (rejected.length >= 1000) throw new CreationSafetyError('The item decision limit has been reached.', 503);
            tx.set(rejectedItemsPath(record.ownerUid, record.waveformId), { items: [...rejected, fingerprint] });
          }
        } else if (expected.decision === 'allowed') {
          await assertItemsAllowed(tx, record.ownerUid, record.candidate, record.waveformId);
        }
        const timestamp = now();
        const completed: CreationReviewRecord = { ...record, status: expected.decision, updatedAt: timestamp,
          reason: expected.decision === 'revoked' ? 'manual-revocation' : 'manual-decision', decision: { actorUid: actor.uid, decision: expected.decision, decidedAt: timestamp, ...(expected.item ? { item: expected.item } : {}) } };
        tx.set(reviewPath(record.reviewId), completed);
        // Preserve revocation by content/policy even if the creator later edits
        // away and returns to this version. A new head must not erase this verdict.
        if (expected.decision !== 'allowed' && !expected.item) tx.set(approvedVersionPath(record.ownerUid, record), { reviewId: record.reviewId });
        tx.set(queuePath, { reviewIds: expected.decision === 'allowed' ? queue : queue.filter(id => id !== record.reviewId) });
        return completed;
      });
    },
  };
}
export type CreationReviewStore = ReturnType<typeof createCreationReviewStore>;
