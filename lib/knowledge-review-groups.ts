import type { KnowledgeCandidate } from './knowledge-model';
import type { AssertionReview } from './knowledge-assertions';

/** Group decisions around the content a publisher recognizes, without changing evidence. */
export function knowledgeReviewGroups(candidate: KnowledgeCandidate) {
  const groups = new Map<string, { id: string; name: string; summary: string; reviews: AssertionReview[] }>();
  groups.set('catalog', { id: 'catalog', name: candidate.catalog.name, summary: candidate.catalog.description, reviews: [] });
  for (const entity of candidate.catalog.entities) groups.set(entity.id, { id: entity.id, name: entity.name, summary: entity.summary, reviews: [] });
  for (const review of candidate.assertionReviews ?? []) {
    const entityId = review.targetType === 'field' ? review.targetId.split('/')[0]
      : review.targetType === 'fact' ? candidate.catalog.facts?.find(fact => fact.id === review.targetId)?.entityId
      : candidate.catalog.relationships.find(relation => relation.id === review.targetId)?.fromEntityId;
    if (entityId) groups.get(entityId)?.reviews.push(review);
  }
  return [...groups.values()].filter(group => group.reviews.length);
}

export function pendingKnowledgeReviews(candidate: KnowledgeCandidate) {
  return (candidate.assertionReviews ?? []).filter(review => review.support === 'unsupported' && review.status === 'pending');
}
