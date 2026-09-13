import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { validateCatalog, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from './errors';
import type { KnowledgeArtifact } from './knowledge-model';

export const assertionReviewSchema = z.object({
  targetType: z.enum(['field', 'fact', 'relationship']), targetId: z.string().min(1).max(180),
  origin: z.enum(['source', 'model', 'publisher']), support: z.enum(['anchored', 'unsupported', 'publisher']),
  status: z.enum(['pending', 'approved', 'rejected', 'unknown']), valueHash: z.string().length(64),
  // Extraction confidence is private and uncalibrated, never source certainty.
  extractionConfidence: z.number().finite().min(0).max(1).optional(),
}).strict();
export type AssertionReview = z.infer<typeof assertionReviewSchema>;
export const assertionDecisionSchema = z.object({ targetType: z.enum(['field', 'fact', 'relationship']), targetId: z.string().min(1).max(180), decision: z.enum(['approve', 'reject']) }).strict();
export type AssertionDecision = z.infer<typeof assertionDecisionSchema>;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function assertionValues(catalog: KnowledgeCatalog) {
  return [
    ...(catalog.description ? [{ targetType: 'field' as const, targetId: 'catalog/description', value: catalog.description }] : []),
    ...catalog.entities.flatMap(entity => Object.entries({ name: entity.name, kind: entity.kind, ...(entity.summary ? { summary: entity.summary } : {}), ...(entity.aliases?.length ? { aliases: entity.aliases } : {}), ...(entity.identifiers?.length ? { identifiers: entity.identifiers } : {}), ...Object.fromEntries(Object.entries(entity.attributes).map(([key, value]) => [`attributes.${key}`, value])) })
      .map(([field, value]) => ({ targetType: 'field' as const, targetId: `${entity.id}/${field}`, value }))),
    ...(catalog.facts ?? []).map(fact => ({ targetType: 'fact' as const, targetId: fact.id, value: fact })),
    ...catalog.relationships.map(relation => ({ targetType: 'relationship' as const, targetId: relation.id, value: relation })),
  ];
}
/** An exact anchor is a location, NOT a check that the excerpt entails the claim. */
export function refreshAssertionReviews(artifact: KnowledgeArtifact, origin: AssertionReview['origin'], prior: AssertionReview[] = artifact.assertionReviews ?? []): AssertionReview[] {
  return assertionValues(artifact.catalog).map(assertion => {
    const valueHash = digest(assertion.value);
    const retained = prior.find(review => review.targetType === assertion.targetType && review.targetId === assertion.targetId && review.valueHash === valueHash);
    if (retained) return retained;
    const supported = artifact.origins.some(source => {
      const provenance = source.provenance;
      const [entityId, field] = assertion.targetId.split('/');
      const reference = assertion.targetType === 'field' ? provenance?.fields.find(item => item.entityId === entityId && item.field === field)
        : (assertion.targetType === 'fact' ? provenance?.facts : provenance?.relationships)?.find(item => item.targetId === assertion.targetId);
      return reference?.anchorIds.some(id => provenance?.anchors.some(anchor => anchor.id === id && !anchor.truncated && anchor.excerpt.trim()));
    });
    return { targetType: assertion.targetType, targetId: assertion.targetId, valueHash, origin,
      support: origin === 'publisher' ? 'publisher' : supported ? 'anchored' : 'unsupported',
      status: origin === 'publisher' ? 'approved' : assertion.value === null || assertion.targetType === 'fact' && typeof assertion.value === 'object' && assertion.value !== null && 'value' in assertion.value && assertion.value.value === null
        || origin === 'source' && assertion.targetType === 'field' && assertion.targetId.endsWith('/kind') && assertion.value === 'item' && !supported ? 'unknown' : 'pending' };
  });
}
export function validateAssertionReviews(input: unknown, catalog: KnowledgeCatalog): AssertionReview[] {
  const reviews = assertionReviewSchema.array().max(5101).parse(input);
  const values = new Map(assertionValues(catalog).map(value => [`${value.targetType}/${value.targetId}`, digest(value.value)]));
  const keys = reviews.map(value => `${value.targetType}/${value.targetId}`);
  if (reviews.length !== values.size || new Set(keys).size !== keys.length || reviews.some((review, index) => values.get(keys[index]) !== review.valueHash)) throw new AppError('Assertion review does not cover the current proposal exactly.');
  return reviews;
}
/** Identity approval changes references, not the evidentiary status of copied
 * claims. Carry the original review across structural remaps only. */
export function remapAssertionReviews(before: KnowledgeArtifact, after: KnowledgeArtifact, resolveEntity: (id: string) => string): AssertionReview[] {
  const originals = new Map(assertionValues(before.catalog).map(value => [`${value.targetType}/${value.targetId}`, value.value]));
  const retained = new Map<string, AssertionReview>();
  for (const review of before.assertionReviews ?? []) {
    let value: unknown = originals.get(`${review.targetType}/${review.targetId}`);
    let targetId = review.targetId;
    if (review.targetType === 'field') {
      const [entityId, field] = targetId.split('/');
      targetId = `${entityId === 'catalog' ? entityId : resolveEntity(entityId)}/${field}`;
    } else if (value && typeof value === 'object') {
      if ('entityId' in value && typeof value.entityId === 'string') value = { ...value, entityId: resolveEntity(value.entityId) };
      else if ('fromEntityId' in value && typeof value.fromEntityId === 'string' && 'toEntityId' in value && typeof value.toEntityId === 'string') value = { ...value, fromEntityId: resolveEntity(value.fromEntityId), toEntityId: resolveEntity(value.toEntityId) };
    }
    const valueHash = digest(value); const key = `${review.targetType}/${targetId}/${valueHash}`;
    if (!retained.has(key)) retained.set(key, { ...review, targetId, valueHash });
  }
  return refreshAssertionReviews(after, 'model').map(review => retained.get(`${review.targetType}/${review.targetId}/${review.valueHash}`) ?? review);
}
export function resolveAssertionReviews(artifact: KnowledgeArtifact, input: AssertionDecision[]): KnowledgeArtifact {
  const decisions = assertionDecisionSchema.array().min(1).max(5101).parse(input);
  const reviews = structuredClone(artifact.assertionReviews ?? []);
  if (new Set(decisions.map(decision => `${decision.targetType}/${decision.targetId}`)).size !== decisions.length) throw new AppError('Choose each assertion once.');
  for (const decision of decisions) {
    const review = reviews.find(item => item.targetType === decision.targetType && item.targetId === decision.targetId);
    if (!review) throw new AppError('This assertion is no longer available. Reload the proposal.', 409);
    review.status = decision.decision === 'approve' ? 'approved' : 'rejected';
  }
  const id = randomUUID();
  return { ...structuredClone(artifact), id, catalog: { ...artifact.catalog, id }, assertionReviews: reviews };
}
/** Apply is approval of visible, anchored proposals; unsupported claims require
 * an explicit publisher choice first. This is never a semantic entailment test. */
export function catalogForPublication(artifact: KnowledgeArtifact): KnowledgeCatalog {
  const catalog = structuredClone(artifact.catalog);
  for (const review of artifact.assertionReviews ?? []) {
    if (review.support === 'unsupported' && review.status === 'pending') throw new AppError('Review unsupported assertions before Apply. Approve them as publisher decisions or reject them.', 409);
    if (review.status !== 'rejected') continue;
    if (review.targetType === 'fact') {
      const fact = catalog.facts?.find(fact => fact.id === review.targetId);
      if (fact) {
        const entity = catalog.entities.find(entity => entity.id === fact.entityId)!;
        if (fact.field.startsWith('attributes.')) entity.attributes[fact.field.slice(11)] = null;
        else if (fact.field === 'summary') entity.summary = '';
        else if ((fact.field === 'name' || fact.field === 'kind') && entity[fact.field] === fact.value) throw new AppError('Correct or remove the item whose identifying fact was rejected before Apply.');
      }
      catalog.facts = catalog.facts?.filter(fact => fact.id !== review.targetId);
    }
    else if (review.targetType === 'relationship') catalog.relationships = catalog.relationships.filter(relation => relation.id !== review.targetId);
    else {
      const [entityId, field] = review.targetId.split('/');
      if (entityId === 'catalog') { catalog.description = ''; continue; }
      const entity = catalog.entities.find(entity => entity.id === entityId)!;
      if (field === 'name' || field === 'kind') throw new AppError('Remove an item whose name or type was rejected, or correct that required field before Apply.');
      if (field === 'aliases' || field === 'identifiers') { delete entity[field]; continue; }
      if (field === 'summary') entity.summary = '';
      else entity.attributes[field.slice(11)] = null;
      catalog.facts = catalog.facts?.filter(fact => fact.entityId !== entityId || fact.field !== field);
    }
  }
  return validateCatalog(catalog);
}
