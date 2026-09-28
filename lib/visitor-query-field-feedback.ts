import { expressionNodes, type FieldDescriptor, type QuerySpec } from '@thevoice/platform-ui/query';

/** Published discovery hints only: the rejected query is never rewritten. */
export function queryFieldFeedback(query: QuerySpec, published: FieldDescriptor[]) {
  const referenced = [...new Set([
    ...[query.where, ...query.preferences.map(preference => preference.expression)].flatMap(expression => expressionNodes(expression).flatMap(node => 'fieldId' in node ? [node.fieldId] : [])),
    ...query.order.map(term => term.fieldId),
  ])];
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  const fields = new Map<string, Pick<FieldDescriptor, 'id' | 'label' | 'type' | 'cardinality' | 'unit' | 'currency' | 'basis' | 'operations' | 'filter' | 'sort'>>();
  const references = referenced.slice(0, 8).map(requestedId => {
    const exact = published.find(field => field.id === requestedId), normalized = normalize(requestedId);
    const matches = exact ? [exact] : published.filter(field =>
      field.id.endsWith(`.${requestedId}`) || field.id.endsWith(`:${requestedId}`)
      || normalize(field.label) === normalized || field.aliases.some(alias => normalize(alias) === normalized));
    const candidateIds: string[] = [];
    for (const field of matches) {
      if (!fields.has(field.id) && fields.size >= 6) continue;
      const { id, label, type, cardinality, unit, currency, basis, operations, filter, sort } = field;
      fields.set(id, { id, label, type, cardinality, unit, currency, basis, operations, filter, sort });
      candidateIds.push(id);
    }
    return { requestedId, match: exact ? 'exact' : matches.length > 1 ? 'ambiguous' : matches.length ? 'candidate' : 'unknown', candidateIds, omittedCandidates: matches.length - candidateIds.length };
  });
  return { references, fields: [...fields.values()], omittedReferences: referenced.length - references.length };
}

export type QueryFieldFeedback = ReturnType<typeof queryFieldFeedback>;
