'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { canDecideCreationReview, creationReviewDecisionPayload, creationReviewQueueRecords, type CreationReviewQueueRecord } from '@/lib/creation-review-client';
import BrandLoader from './BrandLoader';
import { MixedDisplayContent } from './DisplayContent';
import CreationReviewFindings from './CreationReviewFindings';

const needsDecision = (review: CreationReviewQueueRecord) => review.status === 'manual-review' && review.policyCurrent !== false && !review.itemBlocked;
const caseName = (review: CreationReviewQueueRecord) => review.candidate.document?.filename ?? review.candidate.name;
const groupKey = (review: CreationReviewQueueRecord) => JSON.stringify([
  review.proof.ownerUid,
  review.candidate.document ? ['document', review.candidate.document.id] : review.waveformId ?? ['legacy', review.candidate.name],
]);

function versionChanges(previous: CreationReviewQueueRecord, current: CreationReviewQueueRecord) {
  const fields = [
    ['Name', 'name'], ['Instructions', 'initialPrompt'], ['Profile photo', 'profilePhoto'],
    ['Gallery', 'visualDisplay'], ['Creator text', 'textPanel'], ['Document', 'document'],
  ] as const;
  return fields.filter(([, field]) => JSON.stringify(previous.candidate[field]) !== JSON.stringify(current.candidate[field]))
    .map(([label]) => label).join(', ');
}

const reviewIssues = {
  coverage: 'The automatic review could not inspect the complete file.',
  budget: 'The automatic review budget was unavailable.',
  abandoned: 'The automatic review was interrupted.',
  provider: 'The automatic review result could not be confirmed.',
};

function AdminReviewQueue({ reviewStatus }: { reviewStatus?: string | null }) {
  const [records, setReviews] = useState<CreationReviewQueueRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [historyId, setHistoryId] = useState<string>();
  const [itemSelection, setItem] = useState<{ reviewId: string; key: string }>();
  const ordered = records.filter(needsDecision);
  const history = new Map<string, CreationReviewQueueRecord[]>();
  for (const record of records.filter(record => !needsDecision(record))) {
    const key = groupKey(record);
    history.set(key, [...(history.get(key) ?? []), record]);
  }
  const index = Math.max(0, ordered.findIndex(record => record.proof.reviewId === selectedId));
  const historyCase = records.find(record => record.proof.reviewId === historyId && !needsDecision(record));
  const review = historyCase ?? ordered[index];
  const item = itemSelection?.reviewId === review?.proof.reviewId ? itemSelection?.key ?? '' : '';
  const heading = useRef<HTMLHeadingElement>(null);
  const focusCaseHeading = useRef(false);
  const advance = useRef<{ decidedId: string; nextIds: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyDecision, setBusyDecision] = useState<'allowed' | 'blocked' | 'revoked' | null>(null);
  const busy = busyDecision !== null;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const decisionRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; decisionRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/creation-review/admin', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('unavailable');
        const records = creationReviewQueueRecords(await response.json());
        if (!records) throw new Error('invalid');
        if (current) {
          setReviews(records);
          if (advance.current) {
            const { decidedId, nextIds } = advance.current;
            const remaining = records.filter(record => needsDecision(record) && record.proof.reviewId !== decidedId);
            setSelectedId(nextIds.find(id => remaining.some(record => record.proof.reviewId === id))
              ?? remaining[0]?.proof.reviewId);
            advance.current = null;
          } else {
            setSelectedId(id => records.some(record => needsDecision(record) && record.proof.reviewId === id) ? id : records.find(needsDecision)?.proof.reviewId);
          }
        }
      } catch {
        if (current) setError('The review queue could not be loaded. Refresh to try again.');
      } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; controller.abort(); };
  }, [revision, reviewStatus]);

  useEffect(() => {
    if (loading || busy || !focusCaseHeading.current) return;
    focusCaseHeading.current = false;
    heading.current?.focus();
  }, [loading, busy, selectedId, historyId]);

  function navigate(offset: number) {
    focusCaseHeading.current = true;
    setItem(undefined);
    setSelectedId(ordered[index + offset].proof.reviewId);
  }

  function refresh() {
    if (inFlight.current) return;
    setReviews([]); setLoading(true); setError(''); setRevision(value => value + 1);
  }

  async function decide(review: CreationReviewQueueRecord, decision: 'allowed' | 'blocked' | 'revoked', rejectedItem?: string) {
    if (inFlight.current || review.policyCurrent === false || (decision === 'revoked' ? review.status !== 'allowed' : !canDecideCreationReview(review.status))) return;
    inFlight.current = true;
    setBusyDecision(decision); setError(''); setMessage('');
    const controller = new AbortController();
    decisionRequest.current = controller;
    try {
      const response = await fetch('/api/creation-review/admin', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creationReviewDecisionPayload(review, decision, rejectedItem)) });
      if (!mounted.current || controller.signal.aborted) return;
      focusCaseHeading.current = true;
      if (response.status === 409 || response.status === 412) {
        setMessage('This review changed. The queue has been refreshed; review the current version before deciding.');
        setReviews([]); setLoading(true); setRevision(value => value + 1);
      } else if (!response.ok) {
        setReviews([]);
        setError('The decision could not be saved. Refresh the queue before trying again.');
      } else {
        advance.current = {
          decidedId: review.proof.reviewId,
          nextIds: [...ordered.slice(index + 1), ...ordered.slice(0, index)].map(record => record.proof.reviewId),
        };
        setHistoryId(undefined);
        setItem(undefined);
        setMessage(decision === 'allowed' ? 'The reviewed version was approved.' : rejectedItem ? 'The selected item was rejected.' : 'The reviewed version was rejected.');
        setReviews([]); setLoading(true); setRevision(value => value + 1);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        focusCaseHeading.current = true;
        setReviews([]); setError('The decision could not be confirmed. Refresh the queue before trying again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && !controller.signal.aborted) setBusyDecision(null);
    }
  }

  const canDecide = review && needsDecision(review);
  const canRejectApproved = review?.status === 'allowed' && review.policyCurrent !== false && !review.itemBlocked;
  const rejectDecision = canRejectApproved ? 'revoked' : 'blocked';

  return <section className="creation-review-queue" aria-label="Creation review queue" aria-busy={loading || busy}>
    <h2>Creation review queue</h2>
    <h3>Needs a decision</h3>
    <button type="button" className="secondary-button" disabled={loading || busy} onClick={refresh}>Refresh review queue</button>
    {loading && <BrandLoader label="Loading reviews…" />}
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!loading && !ordered.length && <p tabIndex={-1} ref={review ? undefined : heading}>{error ? 'Review queue unavailable' : 'Nothing needs a decision.'}</p>}
    {!loading && history.size > 0 && <details>
      <summary>Review history · {records.length - ordered.length} records</summary>
      {[...history].map(([key, versions]) => <details key={key}>
        <summary>{caseName(versions[versions.length - 1])} · {versions.length} {versions.length === 1 ? 'version' : 'versions'}</summary>
        <ol>{versions.map((version, i) => {
          const changes = i ? versionChanges(versions[i - 1], version) : '';
          return <li key={version.proof.reviewId}>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => {
              focusCaseHeading.current = true;
              setItem(undefined);
              setHistoryId(version.proof.reviewId);
            }}>View version {i + 1}</button>{' '}
            {version.reviewHead && 'Latest reviewed submission · '}
            {version.published && 'Matches a published snapshot · '}
            {version.status === 'allowed' && !version.itemBlocked ? 'Use allowed' : version.status === 'pending' ? 'Checking' : 'Use held'}
            {changes && ` · Changed: ${changes}`}
          </li>;
        })}</ol>
      </details>)}
    </details>}
    {!loading && review && <>
      {historyCase && <button type="button" className="secondary-button" disabled={busy} onClick={() => {
        focusCaseHeading.current = true;
        setHistoryId(undefined);
        setItem(undefined);
      }}>Back to decisions</button>}
      {!historyCase && <nav className="account-actions" aria-label="Review case navigation">
        <button type="button" className="secondary-button" disabled={busy || index === 0} onClick={() => navigate(-1)}>Previous case</button>
        <span role="status">Case {index + 1} of {ordered.length}</span>
        <button type="button" className="secondary-button" disabled={busy || index === ordered.length - 1} onClick={() => navigate(1)}>Next case</button>
      </nav>}
      <article key={review.proof.reviewId}>
        <h3 tabIndex={-1} ref={heading}>{caseName(review)}</h3>
        <p><strong>{review.status === 'allowed' && !review.itemBlocked ? 'Use allowed' : 'Use held'}</strong></p>
        {review.itemBlocked && <p>This version contains a rejected item.</p>}
        {review.status === 'allowed' && !review.itemBlocked && <p>This version is usable. {review.reason === 'manual-decision' ? 'An admin approved this version. Earlier findings are retained for reference.' : 'See the recorded findings below.'}</p>}
        {review.status === 'blocked' && <p>This version was automatically blocked. Edit the flagged content and review the new version. This verdict cannot be overridden here.</p>}
        {review.status === 'manual-review' && !review.itemBlocked && <p>This version requires a decision before it can be used.</p>}
        {review.status === 'pending' && <p>The automatic review is still running.</p>}
        {review.policyCurrent === false && <p>This result used an earlier policy and is available for inspection. The creator can submit the version for review under the current policy.</p>}
        {review.issue && <p>{reviewIssues[review.issue]}</p>}
        {review.status === 'manual-review' && !review.categories.length && !review.issue && <p>No complete category findings were recorded for this review.</p>}
        <CreationReviewFindings categories={review.categories} expanded />
        {(review.categories.length > 0 || review.issue) && <p>The record contains category labels or review issues. It does not identify a flagged excerpt or image region.</p>}

        <div className="creation-review-evidence">
          <h4>Submitted evidence</h4>
          {review.candidate.profilePhoto && <details>
            <summary>View reviewed portrait{review.categories.includes('portrait-provenance') ? ' · source or permission concern' : ''}</summary>
            <Image src={review.candidate.profilePhoto} alt="Portrait submitted for review" width={320} height={320} unoptimized />
          </details>}
          {review.candidate.document && <><p><a href={`/api/creation-review/admin/${encodeURIComponent(review.proof.reviewId)}/file`}>Download {review.candidate.document.filename} for full review</a>. Inspect the complete matching file before deciding.</p><p>Original SHA-256: {review.candidate.document.digest}</p></>}
          <details>
            <summary>Read full instructions</summary>
            <div className="creation-review-text">{review.candidate.initialPrompt}</div>
          </details>
          {review.candidate.visualDisplay?.images.length ? <details>
            <summary>View submitted Visual Display images and text</summary>
            {review.candidate.visualDisplay.images.map(image => <div key={image.id}><h4>{image.title}</h4><MixedDisplayContent image={{ ...image, type: 'image' }} text={{ type: 'text', text: image.text }} /></div>)}
          </details> : null}
          {review.candidate.textPanel?.version === 1 && <details>
            <summary>Read creator text</summary>
            <div className="creation-review-text">{review.candidate.textPanel.text}</div>
          </details>}
          {review.candidate.textPanel?.version === 2 && <p>Text Box plugin enabled. Conversation text is not saved with this waveform.</p>}
          <details>
            <summary>Review version details</summary>
            <p>Owner: {review.proof.ownerUid}</p>
            <p>Review ID: {review.proof.reviewId}</p>
            <p>Policy: {review.proof.policyVersion}</p>
            {review.published && <p>Matches a published snapshot.</p>}
          </details>
        </div>

        {(canDecide || canRejectApproved) && <>
          <p id="creation-review-consequence">Rejection stops use of this reviewed version. Rejecting an item also requires the creator to replace or remove that item before resubmitting.</p>
          <div className="account-actions">
            {canDecide && <button type="button" className="primary-button" disabled={busy} onClick={() => void decide(review, 'allowed')}>Approve reviewed version</button>}
            <button type="button" className="secondary-button" disabled={busy} aria-describedby="creation-review-consequence" onClick={() => void decide(review, rejectDecision, review.candidate.document ? 'document' : undefined)}>
              {review.candidate.document ? 'Reject document' : 'Reject waveform'}
            </button>
          </div>
          {!review.candidate.document && <div className="account-actions">
            <label>Item to reject <select value={item} onChange={event => setItem({ reviewId: review.proof.reviewId, key: event.target.value })} disabled={busy}>
              <option value="">Choose an item</option>
              <option value="name">Name</option>
              <option value="instructions">Instructions</option>
              {review.candidate.profilePhoto && <option value="portrait">Profile photo</option>}
              {review.candidate.textPanel?.version === 1 && <option value="creator-text">Creator text</option>}
              {review.candidate.visualDisplay?.images.map(image => <option value={`image:${image.id}`} key={image.id}>Gallery photo: {image.title}</option>)}
            </select></label>
            <button type="button" className="secondary-button" disabled={busy || !item} aria-describedby="creation-review-consequence" onClick={() => void decide(review, rejectDecision, item)}>Reject item</button>
          </div>}
        </>}
      </article>
    </>}
  </section>;
}

/** Parent authority is a UI gate only; the server must verify every queue request. */
export default function CreationReviewQueue({ verifiedAdmin, reviewStatus }: { verifiedAdmin: boolean; reviewStatus?: string | null }) {
  return verifiedAdmin ? <AdminReviewQueue reviewStatus={reviewStatus} /> : null;
}
