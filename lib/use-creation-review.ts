'use client';

import { useEffect, useRef, useState } from 'react';
import { canonicalCreationReviewCandidate, creationReviewResponseCategories, creationReviewResponseStatus, creationReviewView,
  type CreationReviewCandidate, type CreationReviewClientResult } from './creation-review-client';

export const CREATION_REVIEW_DEBOUNCE_MS = 350;

export function useCreationReview({ enabled, candidate, ownerKey, automatic = true }: {
  enabled: boolean; candidate: CreationReviewCandidate; ownerKey: string; automatic?: boolean;
}) {
  const [requested, setRequested] = useState<{ key: string; revision: number } | null>(null);
  const key = canonicalCreationReviewCandidate(candidate)?.key ?? null;
  const [state, setState] = useState<{ ownerKey: string; enabled: boolean; scope: number; result: CreationReviewClientResult | null }>(
    { ownerKey, enabled, scope: 0, result: null });
  const changed = state.ownerKey !== ownerKey || state.enabled !== enabled;
  const scope = changed ? state.scope + 1 : state.scope;
  const result = changed ? null : state.result;
  // Invalidate in this render, including a quick disable/re-enable for the same owner.
  if (changed) setState({ ownerKey, enabled, scope, result: null });
  const completed = useRef<{ scope: number; result: CreationReviewClientResult } | null>(null);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const apply = (next: CreationReviewClientResult) => {
      setState(previous => previous.scope === scope && previous.enabled && previous.ownerKey === ownerKey ? { ...previous, result: next } : previous);
    };
    if (completed.current?.scope !== scope || !enabled) completed.current = null;
    if (completed.current && completed.current.result.key !== key) completed.current = null;
    if (!enabled || !ownerKey || !key) return () => { current = false; controller.abort(); };
    const cached = completed.current?.result;
    if (cached?.ownerKey === ownerKey && cached.key === key) {
      queueMicrotask(() => { if (current) apply(cached); });
      return () => { current = false; controller.abort(); };
    }
    const timer = setTimeout(() => {
      apply({ ownerKey, key, status: 'pending' });
      void (async () => {
        let status: CreationReviewClientResult['status'] = 'unavailable';
        let categories: string[] = [];
        try {
          const submit = automatic || requested?.key === key;
          const response = await fetch('/api/creation-review', submit ? { method: 'POST', signal: controller.signal,
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate: JSON.parse(key) }) }
            : { cache: 'no-store', signal: controller.signal });
          if (response.ok) {
            const body = await response.json();
            status = !submit && canonicalCreationReviewCandidate(body.review?.candidate ?? {})?.key !== key ? 'stale' : creationReviewResponseStatus(body);
            if (status !== 'stale') categories = creationReviewResponseCategories(body);
          }
        } catch { /* Fixed unavailable state; never expose raw errors or automatically retry. */ }
        if (!current || controller.signal.aborted) return;
        const next = { ownerKey, key, status, ...(categories.length ? { categories } : {}) };
        if (status !== 'pending' && status !== 'stale' && status !== 'unavailable') completed.current = { scope, result: next };
        apply(next);
      })();
    }, CREATION_REVIEW_DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [enabled, ownerKey, key, scope, automatic, requested]);

  return { ...creationReviewView({ enabled, ownerKey, key, result }), requestReview: () => {
    completed.current = null;
    if (key) setRequested(previous => ({ key, revision: (previous?.revision ?? 0) + 1 }));
  } };
}
