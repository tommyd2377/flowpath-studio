import 'server-only';
import { randomUUID } from 'node:crypto';
import { querySpecSchema, validateQueryFields, expressionNodes, type Expression, type FieldDescriptor, type PublicationRef, type QueryResult, type QuerySpec, type TypedValue } from '@thevoice/platform-ui/query';
import { assertionActive } from '@thevoice/platform-ui/knowledge';
import { queryHash, type CompiledQueryIndex } from './catalog-query-index';

type InformationState = 'unknown' | 'conflicting' | 'conditional' | 'stale';
type Truth = boolean | InformationState;
export type FieldProjection = { state: 'known' | InformationState; value: TypedValue | null; assertionIds: string[] };
const missing: FieldProjection = { state: 'unknown', value: null, assertionIds: [] };
export function projectField(index: CompiledQueryIndex, recordId: string, fieldId: string, asOf: string): FieldProjection {
  const facts = index.assertions.get(recordId)?.get(fieldId) ?? [];
  if (!facts.length) return missing;
  const active = facts.filter(fact => assertionActive(fact, asOf));
  if (!active.length) return { state: 'stale', value: null, assertionIds: facts.map(fact => fact.id) };
  const plain = active.filter(fact => !fact.conditions.length && fact.polarity === 'affirmed' && fact.value !== null);
  const values = new Set(plain.map(fact => queryHash(fact.value)));
  const conflict = values.size > 1 || active.some(fact => fact.polarity === 'denied' && !fact.conditions.length && values.has(queryHash(fact.value)));
  const state = conflict ? 'conflicting' : active.some(fact => fact.conditions.length || fact.polarity === 'denied') ? 'conditional' : values.size ? 'known' : 'unknown';
  return { state, value: state === 'known' ? plain[0].value : null, assertionIds: active.map(fact => fact.id) };
}
const unknownResult = (values: Truth[]): InformationState => (['conflicting', 'conditional', 'stale', 'unknown'] as const).find(state => values.includes(state)) ?? 'unknown';
const combine = (values: Truth[], any: boolean): Truth => any ? values.includes(true) ? true : values.every(value => value === false) ? false : unknownResult(values)
  : values.includes(false) ? false : values.every(value => value === true) ? true : unknownResult(values);
const equal = (left: unknown, right: unknown) => canonicalValue(left) === canonicalValue(right);
const canonicalValue = (value: unknown) => typeof value === 'string' ? value.normalize('NFKC').toLocaleLowerCase('en') : JSON.stringify(value);
function cachedProjection(index: CompiledQueryIndex, recordId: string, fieldId: string, asOf: string, cache?: Map<string, FieldProjection>) {
  const key = JSON.stringify([recordId, fieldId]);
  let field = cache?.get(key);
  if (!field) { field = projectField(index, recordId, fieldId, asOf); cache?.set(key, field); }
  return field;
}
export function evaluateExpression(index: CompiledQueryIndex, recordId: string, expression: Expression, asOf: string, projection?: Map<string, FieldProjection>): Truth {
  const evaluate = (node: Expression) => evaluateExpression(index, recordId, node, asOf, projection);
  if (expression.kind === 'all' || expression.kind === 'any') return combine(expression.children.map(evaluate), expression.kind === 'any');
  if (expression.kind === 'search') return expression.text.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).every(term => index.tokens.get(term)?.has(recordId));
  if (expression.kind === 'not') { const value = evaluate(expression.child); return typeof value === 'boolean' ? !value : value; }
  if (expression.kind === 'relation') {
    const edges = (expression.direction === 'out' ? index.outgoing : index.incoming).get(recordId)?.filter(relation => relation.predicateId === expression.predicateId) ?? [];
    if (!edges.length) return 'unknown';
    return combine(edges.map(edge => {
      if (!assertionActive(edge, asOf)) return 'stale';
      if (edge.conditions.length) return 'conditional';
      if (edges.some(other => other.fromId === edge.fromId && other.toId === edge.toId && other.polarity !== edge.polarity && !other.conditions.length && assertionActive(other, asOf))) return 'conflicting';
      const value = evaluateExpression(index, expression.direction === 'out' ? edge.toId : edge.fromId, expression.target, asOf, projection);
      return edge.polarity === 'denied' ? value === true ? false : 'unknown' : value;
    }), true);
  }
  if (expression.kind !== 'field' && expression.kind !== 'state') return false;
  const field = cachedProjection(index, recordId, expression.fieldId, asOf, projection);
  if (expression.kind === 'state') return field.state === expression.state;
  if (field.state === 'conditional') {
    const facts = index.assertions.get(recordId)?.get(expression.fieldId)?.filter(fact => assertionActive(fact, asOf)) ?? [];
    if (expression.op === 'eq' && !facts.some(fact => fact.conditions.length) && facts.some(fact => fact.polarity === 'denied' && fact.value && equal(fact.value.value, expression.value.value))) return false;
  }
  if (field.state !== 'known' || !field.value) return field.state === 'known' ? 'unknown' : field.state;
  const actual = field.value.value, expected = expression.value.value;
  if (expression.op === 'any' || expression.op === 'all') {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
    return expression.op === 'any' ? expected.some(value => actual.some(item => equal(item, value))) : expected.every(value => actual.some(item => equal(item, value)));
  }
  if (expression.op === 'eq') return Array.isArray(actual) ? actual.some(value => equal(value, expected)) : equal(actual, expected);
  if (expression.op === 'contains') return typeof actual === 'string' && typeof expected === 'string' && canonicalValue(actual).includes(canonicalValue(expected));
  const a = field.value.type === 'date' ? Date.parse(String(actual)) : Number(actual), b = expression.value.type === 'date' ? Date.parse(String(expected)) : Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return expression.op === 'lt' ? a < b : expression.op === 'lte' ? a <= b : expression.op === 'gt' ? a > b : a >= b;
}
export function scopeRecords(index: CompiledQueryIndex, query: QuerySpec): Set<string> {
  const { scope } = query;
  if (scope.path[0] !== index.space.rootId || scope.path.at(-1) !== scope.collectionId || scope.path.some((id, i) => !index.direct.has(id) || i > 0 && !index.space.edges.some(edge => edge.parentId === scope.path[i - 1] && edge.childId === id))) throw new Error('Invalid chosen collection path.');
  if (scope.traversal === 'explicitUnion' && !scope.include?.length || scope.traversal !== 'explicitUnion' && scope.include?.length) throw new Error('Invalid scope union.');
  const roots = [scope.collectionId, ...scope.include ?? []];
  const collections = new Set<string>();
  for (const root of roots) {
    if (!index.direct.has(root)) throw new Error('Unknown collection scope.');
    for (const id of scope.traversal === 'direct' ? [root] : index.descendants.get(root)!) collections.add(id);
  }
  const records = new Set<string>();
  for (const id of collections) for (const record of index.direct.get(id)!) records.add(record);
  return records;
}
function withoutField(node: Expression, fieldId: string): Expression | null {
  if ((node.kind === 'field' || node.kind === 'state') && node.fieldId === fieldId) return null;
  if ('children' in node) {
    const children = node.children.map(child => withoutField(child, fieldId)).filter((value): value is Expression => value !== null);
    return node.children.length && !children.length ? null : { ...node, children };
  }
  if ('child' in node) { const child = withoutField(node.child, fieldId); return child ? { ...node, child } : null; }
  return node;
}
function withoutNode(node: Expression, nodeId: string): Expression | null {
  if (node.id === nodeId) return null;
  if ('children' in node) {
    const children = node.children.map(child => withoutNode(child, nodeId)).filter((value): value is Expression => value !== null);
    return node.children.length && !children.length ? null : { ...node, children };
  }
  if ('child' in node) { const child = withoutNode(node.child, nodeId); return child ? { ...node, child } : null; }
  return node;
}
const emptyWhere: Expression = { kind: 'all', id: 'criteria', children: [] };
export type QueryEvaluation = { ordered: string[]; exclusions: QueryResult['exclusions']; facets: { fieldId: string; values: { value: string | number | boolean; count: number }[]; unknown: number; coverage: 'complete' | 'partial' }[]; alternatives: { removeNodeId: string; count: number }[] };
/** Supported typed predicates evaluate the complete authorized scope, never a top-k sample. */
export function evaluateQuery(index: CompiledQueryIndex, input: unknown, options: { facets?: string[]; alternatives?: boolean } = {}): QueryEvaluation {
  const query = querySpecSchema.parse(input);
  if (queryHash(query.publication) !== queryHash(index.space.publication)) throw new Error('Publication changed. Reload results.');
  validateQueryFields(query, index.space.fields, index.space.relationshipTypes);
  const terms = [...new Set(query.searchText.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  const candidates = [...scopeRecords(index, query)].filter(id => terms.every(term => index.tokens.get(term)?.has(id))), projection = new Map<string, FieldProjection>();
  const exclusions = { unknown: 0, conflicting: 0, conditional: 0, stale: 0 };
  const ranked = candidates.flatMap(recordId => {
    const truth = evaluateExpression(index, recordId, query.where, query.asOf, projection);
    if (truth !== true) { if (typeof truth === 'string') exclusions[truth]++; return []; }
    const score = query.preferences.reduce((total, preference) => total + (evaluateExpression(index, recordId, preference.expression, query.asOf, projection) === true ? preference.weight : 0), 0);
    return [{ recordId, score }];
  });
  ranked.sort((left, right) => {
    for (const term of query.order) {
      const a = cachedProjection(index, left.recordId, term.fieldId, query.asOf, projection), b = cachedProjection(index, right.recordId, term.fieldId, query.asOf, projection);
      if (a.state !== b.state) return a.state === 'known' ? -1 : b.state === 'known' ? 1 : a.state.localeCompare(b.state);
      if (a.state !== 'known') continue;
      const av = a.value!.value, bv = b.value!.value;
      const comparison = a.value!.type === 'date' ? Date.parse(String(av)) - Date.parse(String(bv)) : typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (comparison) return term.direction === 'asc' ? comparison : -comparison;
    }
    return right.score - left.score || left.recordId.localeCompare(right.recordId);
  });
  if ((options.facets?.length ?? 0) > 8) throw new Error('At most eight facets per query.');
  const facets = (options.facets ?? []).map(fieldId => {
    if (!index.space.fields.some(field => field.id === fieldId && field.facet)) throw new Error('Unsupported facet.');
    const where = withoutField(query.where, fieldId) ?? emptyWhere, counts = new Map<string, { value: string | number | boolean; count: number }>(); let unknown = 0;
    for (const recordId of candidates) {
      if (evaluateExpression(index, recordId, where, query.asOf, projection) !== true) continue;
      const field = cachedProjection(index, recordId, fieldId, query.asOf, projection);
      if (field.state !== 'known') { unknown++; continue; }
      const values = Array.isArray(field.value!.value) ? field.value!.value : [field.value!.value];
      for (const value of new Set(values)) if (typeof value !== 'object') { const key = canonicalValue(value), prior = counts.get(key); counts.set(key, { value, count: (prior?.count ?? 0) + 1 }); }
    }
    return { fieldId, values: [...counts.values()].sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value))).slice(0, 64), unknown, coverage: counts.size > 64 ? 'partial' as const : 'complete' as const };
  });
  const alternatives = !ranked.length && options.alternatives !== false ? expressionNodes(query.where).filter(node => node.kind === 'field' || node.kind === 'state' || node.kind === 'relation' || node.kind === 'search').slice(0, 24).map(node => ({ removeNodeId: node.id,
    count: candidates.filter(id => evaluateExpression(index, id, withoutNode(query.where, node.id) ?? emptyWhere, query.asOf, projection) === true).length })).filter(alternative => alternative.count > 0) : [];
  return { ordered: ranked.map(item => item.recordId), exclusions, facets, alternatives };
}
// Immutable index identity + the entire query (including as-of and revision).
// Callers must still perform current-publication authorization before using it.
const evaluations = new WeakMap<CompiledQueryIndex, Map<string, QueryEvaluation>>();
export function preparedQuery(index: CompiledQueryIndex, query: QuerySpec): QueryEvaluation {
  const key = queryHash(query), cache = evaluations.get(index) ?? new Map<string, QueryEvaluation>();
  let result = cache.get(key);
  if (!result) { result = evaluateQuery(index, query); if (cache.size >= 32) cache.delete(cache.keys().next().value!); cache.set(key, result); evaluations.set(index, cache); }
  return result;
}
export type QueryAuthority = { publication: PublicationRef; sessionId: string; entitlement: string };
type SavedResult = { queryHash: string; authority: string; resultSetId: string; ordered: string[]; expiresAt: number; evaluation: QueryEvaluation };
export class QueryResultStore {
  private results = new Map<string, SavedResult>();
  private cursors = new Map<string, { result: string; offset: number }>();
  constructor(private readonly now = Date.now) {}
  query(index: CompiledQueryIndex, query: QuerySpec, authority: QueryAuthority, options: { pageSize?: number; cursor?: string; facets?: string[] } = {}): QueryResult & Pick<QueryEvaluation, 'facets' | 'alternatives'> {
    const pageSize = options.pageSize ?? 24;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 48) throw new Error('Invalid page size.');
    if (queryHash(authority.publication) !== queryHash(index.space.publication) || queryHash(query.publication) !== queryHash(authority.publication)) throw new Error('Publication authority changed.');
    // Strictly validate every request, including cached pages.
    querySpecSchema.parse(query); validateQueryFields(query, index.space.fields, index.space.relationshipTypes); scopeRecords(index, query);
    this.prune(); const hash = queryHash(query), binding = queryHash(authority); let result: SavedResult; let offset = 0;
    if (options.cursor) {
      const cursor = this.cursors.get(options.cursor), saved = cursor && this.results.get(cursor.result);
      if (!saved || saved.queryHash !== hash || saved.authority !== binding || saved.expiresAt <= this.now()) throw new Error('Invalid, expired or stale result cursor.');
      result = saved; offset = cursor!.offset;
    } else {
      const existing = [...this.results.values()].find(value => value.queryHash === hash && value.authority === binding);
      if (existing) result = existing;
      else {
      if (this.results.size >= 200 || this.cursors.size >= 2000) throw new Error('Result session capacity reached.');
      const evaluation = evaluateQuery(index, query, { facets: options.facets });
      result = { queryHash: hash, authority: binding, resultSetId: randomUUID(), ordered: evaluation.ordered, expiresAt: this.now() + 30 * 60_000, evaluation };
      this.results.set(result.resultSetId, result);
      }
    }
    let nextCursor: string | null = null;
    if (offset + pageSize < result.ordered.length) {
      if (this.cursors.size >= 2000) throw new Error('Cursor capacity reached.');
      nextCursor = [...this.cursors.entries()].find(([, cursor]) => cursor.result === result.resultSetId && cursor.offset === offset + pageSize)?.[0] ?? randomUUID(); this.cursors.set(nextCursor, { result: result.resultSetId, offset: offset + pageSize });
    }
    return { version: 2, publication: authority.publication, queryId: query.queryId, revision: query.revision, resultSetId: result.resultSetId,
      items: result.ordered.slice(offset, offset + pageSize).map((recordId, i) => ({ recordId, ordinal: offset + i + 1, code: `R${offset + i + 1}` })), nextCursor,
      evaluatedAt: new Date(this.now()).toISOString(), count: { value: result.ordered.length, kind: 'exact' }, coverage: 'complete', exclusions: result.evaluation.exclusions, facets: result.evaluation.facets, alternatives: result.evaluation.alternatives };
  }
  resolve(resultSetId: string, ordinal: number, query: QuerySpec, authority: QueryAuthority) {
    const result = this.results.get(resultSetId);
    if (!result || result.authority !== queryHash(authority) || result.queryHash !== queryHash(query) || result.expiresAt <= this.now() || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > result.ordered.length) throw new Error('Stale or unavailable result reference.');
    return result.ordered[ordinal - 1];
  }
  private prune() {
    for (const [id, result] of this.results) if (result.expiresAt <= this.now()) this.results.delete(id);
    for (const [id, cursor] of this.cursors) if (!this.results.has(cursor.result)) this.cursors.delete(id);
  }
}
export function describeScope(index: CompiledQueryIndex, scope: QuerySpec['scope'], offsets: { children?: number; fields?: number } = {}) {
  const childOffset = offsets.children ?? 0, fieldOffset = offsets.fields ?? 0;
  if (![childOffset, fieldOffset].every(value => Number.isInteger(value) && value >= 0) || childOffset > 1000 || fieldOffset > 64) throw new Error('Invalid schema page.');
  const collection = index.space.collections.find(item => item.id === scope.collectionId);
  if (!collection) throw new Error('Unknown collection.');
  const childIds = new Set(index.space.edges.filter(edge => edge.parentId === collection.id).map(edge => edge.childId));
  const children = index.space.collections.filter(item => childIds.has(item.id));
  return { collection, children: children.slice(childOffset, childOffset + 24), omittedChildren: Math.max(0, children.length - childOffset - 24), fields: index.space.fields.slice(fieldOffset, fieldOffset + 32), omittedFields: Math.max(0, index.space.fields.length - fieldOffset - 32), relationships: index.space.relationshipTypes.slice(0, 16) };
}
export function compatibleComparisonFields(fields: FieldDescriptor[], recordTypes: string[]) {
  return fields.filter(field => !field.recordTypes.length || recordTypes.every(type => field.recordTypes.includes(type)));
}
