'use client';

import { useEffect, useRef, useState } from 'react';
import { canDecideCreationReview, creationReviewDecisionPayload, creationReviewQueueRecords, type CreationReviewQueueRecord } from '@/lib/creation-review-client';

function AdminReviewQueue() {
  const [reviews, setReviews] = useState<CreationReviewQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    setBusy(true); setError(''); setMessage('');
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
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="creation-review-queue" aria-label="Creation review queue" aria-busy={loading || busy}>
    <h2>Creation review queue</h2>
    <p>Read the exact version below before choosing a decision. Pending reviews cannot be approved.</p>
    <button type="button" className="secondary-button" disabled={loading || busy} onClick={refresh}>Refresh review queue</button>
    {loading && <p role="status">Loading reviews…</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!loading && !error && !reviews.length && <p>No reviews are waiting.</p>}
    {reviews.map(review => <article key={`${review.proof.ownerUid}:${review.proof.reviewId}:${review.proof.digest}`}
      style={{ marginTop: '1rem', padding: '1rem', border: '1px solid currentColor', borderRadius: '0.75rem' }}>
      <h3>{review.candidate.name}</h3>
      <p>Status: {review.status} · Categories: {review.categories.length ? review.categories.join(', ') : 'None'}</p>
      <p>Owner: {review.proof.ownerUid}</p>
      <h4>Instructions</h4>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.candidate.initialPrompt}</div>
      {review.candidate.textPanel?.version === 1 && <><h4>Creator text</h4><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.candidate.textPanel.text}</div></>}
      {review.candidate.textPanel?.version === 2 && <p>Text Box plugin enabled. Conversation text is not saved with this waveform.</p>}
      <div className="account-actions">
        <button type="button" className="primary-button" disabled={loading || busy || !canDecideCreationReview(review.status)} onClick={() => void decide(review, 'allowed')}>Approve reviewed version</button>
        <button type="button" className="secondary-button" disabled={loading || busy || !canDecideCreationReview(review.status)} onClick={() => void decide(review, 'blocked')}>Reject reviewed version</button>
      </div>
    </article>)}
  </section>;
}

/** Parent authority is a UI gate only; the server must verify every queue request. */
export default function CreationReviewQueue({ verifiedAdmin }: { verifiedAdmin: boolean }) {
  return verifiedAdmin ? <AdminReviewQueue /> : null;
}
