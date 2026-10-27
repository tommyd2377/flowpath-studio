'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { canDecideCreationReview, creationReviewDecisionPayload, creationReviewQueueRecords, type CreationReviewQueueRecord } from '@/lib/creation-review-client';
import BrandLoader from './BrandLoader';

function AdminReviewQueue() {
  const [reviews, setReviews] = useState<CreationReviewQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDecision, setBusyDecision] = useState<{ review: CreationReviewQueueRecord; decision: 'allowed' | 'blocked' } | null>(null);
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
        if (current) setReviews(records);
      } catch {
        if (current) setError('The review queue could not be loaded. Refresh to try again.');
      } finally { if (current) setLoading(false); }
    })();
    return () => { current = false; controller.abort(); };
  }, [revision]);

  function refresh() {
    if (inFlight.current) return;
    setReviews([]); setLoading(true); setError(''); setRevision(value => value + 1);
  }

  async function decide(review: CreationReviewQueueRecord, decision: 'allowed' | 'blocked') {
    if (inFlight.current || !canDecideCreationReview(review.status)) return;
    inFlight.current = true;
    setBusyDecision({ review, decision }); setError(''); setMessage('');
    const controller = new AbortController();
    decisionRequest.current = controller;
    try {
      const response = await fetch('/api/creation-review/admin', { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creationReviewDecisionPayload(review, decision)) });
      if (!mounted.current || controller.signal.aborted) return;
      if (response.status === 409 || response.status === 412) {
        setMessage('This review changed. The queue has been refreshed; review the current version before deciding.');
        setReviews([]); setLoading(true); setRevision(value => value + 1);
      } else if (!response.ok) {
        setReviews([]);
        setError('The decision could not be saved. Refresh the queue before trying again.');
      } else {
        setMessage(decision === 'allowed' ? 'The reviewed version was approved.' : 'The reviewed version was rejected.');
        setReviews([]); setLoading(true); setRevision(value => value + 1);
      }
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        setReviews([]); setError('The decision could not be confirmed. Refresh the queue before trying again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current && !controller.signal.aborted) setBusyDecision(null);
    }
  }

  return <section className="creation-review-queue" aria-label="Creation review queue" aria-busy={loading || busy}>
    <h2>Creation review queue</h2>
    <p>Read the exact version below before choosing a decision. Pending reviews cannot be approved.</p>
    <button type="button" className="secondary-button" disabled={loading || busy} onClick={refresh}>Refresh review queue</button>
    {loading && <BrandLoader label="Loading reviews…" />}
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!loading && !error && !reviews.length && <p>No reviews are waiting.</p>}
    {reviews.map(review => <article key={`${review.proof.ownerUid}:${review.proof.reviewId}:${review.proof.digest}`}
      style={{ marginTop: '1rem', padding: '1rem', border: '1px solid currentColor', borderRadius: '0.75rem' }}>
      <h3>{review.candidate.name}</h3>
      <p>Status: {review.status} · Categories: {review.categories.length ? review.categories.join(', ') : 'None'}</p>
      {review.issue && <p>Automatic review needs a human decision: {review.issue === 'coverage' ? 'complete file coverage was unavailable' : review.issue === 'budget' ? 'review budget unavailable' : review.issue === 'abandoned' ? 'the attempt was interrupted' : 'the provider result could not be confirmed'}. No automatic retry was made.</p>}
      <p>Owner: {review.proof.ownerUid}</p>
      <h4>Instructions</h4>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.candidate.initialPrompt}</div>
      {review.candidate.profilePhoto && <><h4>Portrait</h4><Image src={review.candidate.profilePhoto} alt="Portrait submitted for review" width={160} height={160} unoptimized /></>}
      {review.candidate.document && <><p>Document: <a href={`/api/creation-review/admin/${encodeURIComponent(review.proof.reviewId)}/file`}>Download {review.candidate.document.filename} for full review</a>. Read the complete original before deciding. If retrieval is unavailable, keep it blocked until you can inspect a matching original.</p><p style={{ overflowWrap: 'anywhere' }}>Original SHA-256: {review.candidate.document.digest}</p></>}
      {review.candidate.textPanel?.version === 1 && <><h4>Creator text</h4><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.candidate.textPanel.text}</div></>}
      {review.candidate.textPanel?.version === 2 && <p>Text Box plugin enabled. Conversation text is not saved with this waveform.</p>}
      <div className="account-actions">
        <button type="button" className="primary-button" disabled={loading || busy || !canDecideCreationReview(review.status)} aria-busy={busyDecision?.review === review && busyDecision.decision === 'allowed'} onClick={() => void decide(review, 'allowed')}>{busyDecision?.review === review && busyDecision.decision === 'allowed' && <BrandLoader variant="inline" />}Approve reviewed version</button>
        <button type="button" className="secondary-button" disabled={loading || busy || !canDecideCreationReview(review.status)} aria-busy={busyDecision?.review === review && busyDecision.decision === 'blocked'} onClick={() => void decide(review, 'blocked')}>{busyDecision?.review === review && busyDecision.decision === 'blocked' && <BrandLoader variant="inline" />}Reject reviewed version</button>
      </div>
    </article>)}
  </section>;
}

/** Parent authority is a UI gate only; the server must verify every queue request. */
export default function CreationReviewQueue({ verifiedAdmin }: { verifiedAdmin: boolean }) {
  return verifiedAdmin ? <AdminReviewQueue /> : null;
}
