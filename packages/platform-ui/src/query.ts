import { z } from 'zod';
import { temporalDateSchema } from './contracts.js';

export const taskIdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const id = taskIdSchema;
export const queryTimeSchema = temporalDateSchema.or(z.iso.datetime({ offset: true }));
export const publicationRefSchema = z.object({ siteId: id, revisionId: id, indexRevision: id }).strict();
export type PublicationRef = z.infer<typeof publicationRefSchema>;
export const fieldOperators = ['eq', 'contains', 'lt', 'lte', 'gt', 'gte', 'any', 'all'] as const;
export const informationStates = ['known', 'unknown', 'conflicting', 'conditional', 'stale'] as const;
export const scalarSchema = z.union([z.string().max(2000), z.number().finite(), z.boolean()]);
export const typedValueSchema = z.object({
  type: z.enum(['text', 'enum', 'number', 'money', 'boolean', 'date', 'reference', 'geo']),
  value: z.union([scalarSchema, z.array(scalarSchema).max(64), z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).strict()]),
  unit: z.string().min(1).max(40).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), basis: id.optional(),
}).strict().superRefine((value, ctx) => {
  const values = Array.isArray(value.value) ? value.value : [value.value];
  const valid = values.every(item => value.type === 'geo' ? typeof item === 'object' : value.type === 'boolean' ? typeof item === 'boolean'
    : value.type === 'number' || value.type === 'money' ? typeof item === 'number'
    : typeof item === 'string' && (value.type !== 'date' || queryTimeSchema.safeParse(item).success));
  if (!valid || (value.type === 'money') !== Boolean(value.currency) || value.unit && value.type !== 'number') ctx.addIssue({ code: 'custom', message: 'Invalid typed value or measurement.' });
});
export type TypedValue = z.infer<typeof typedValueSchema>;
export const fieldDescriptorSchema = z.object({ id, label: z.string().min(1).max(160), aliases: z.array(z.string().min(1).max(100)).max(16),
  recordTypes: z.array(id).max(32), type: typedValueSchema.shape.type, cardinality: z.enum(['one', 'many']),
  unit: z.string().min(1).max(40).optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(), basis: id.optional(), timeZone: z.string().max(80).optional(),
  values: z.array(scalarSchema).max(64).optional(), operations: z.array(z.enum(fieldOperators)).max(8),
  filter: z.boolean(), sort: z.boolean(), facet: z.boolean(), coverage: z.object({ known: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict(),
}).strict().superRefine((field, ctx) => {
  const range = ['number', 'money', 'date'].includes(field.type);
  if ((field.type === 'money') !== Boolean(field.currency) || field.unit && field.type !== 'number'
    || field.coverage.known > field.coverage.total || field.operations.some(op => ['lt', 'lte', 'gt', 'gte'].includes(op) && !range
      || op === 'contains' && field.type !== 'text' || ['any', 'all'].includes(op) && field.cardinality !== 'many')
    || field.sort && (field.cardinality === 'many' || field.type === 'geo')) ctx.addIssue({ code: 'custom', message: 'Unsupported field operation or measurement.' });
  if (field.timeZone) { try { new Intl.DateTimeFormat('en', { timeZone: field.timeZone }); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid time zone.' }); } }
});
export type FieldDescriptor = z.infer<typeof fieldDescriptorSchema>;
export const relationshipDescriptorSchema = z.object({ id, label: z.string().min(1).max(160), inverseLabel: z.string().min(1).max(160), fromTypes: z.array(id).max(32), toTypes: z.array(id).max(32) }).strict();
export type RelationshipDescriptor = z.infer<typeof relationshipDescriptorSchema>;
export type Expression = { kind: 'all' | 'any'; id: string; children: Expression[] }
  | { kind: 'not'; id: string; child: Expression }
  | { kind: 'field'; id: string; fieldId: string; op: typeof fieldOperators[number]; value: TypedValue }
  | { kind: 'state'; id: string; fieldId: string; state: typeof informationStates[number] }
  | { kind: 'relation'; id: string; predicateId: string; direction: 'out' | 'in'; target: Expression };
const recursiveExpression: z.ZodType<Expression> = z.lazy(() => z.union([
  z.object({ kind: z.enum(['all', 'any']), id, children: z.array(recursiveExpression).max(24) }).strict(),
  z.object({ kind: z.literal('not'), id, child: recursiveExpression }).strict(),
  z.object({ kind: z.literal('field'), id, fieldId: id, op: z.enum(fieldOperators), value: typedValueSchema }).strict(),
  z.object({ kind: z.literal('state'), id, fieldId: id, state: z.enum(informationStates) }).strict(),
  z.object({ kind: z.literal('relation'), id, predicateId: id, direction: z.enum(['out', 'in']), target: recursiveExpression }).strict(),
]));
/** Check before recursive parsing: callers may provide cyclic JS, not just JSON. */
function boundedExpression(value: unknown): boolean {
  const seen = new Set<unknown>(); let leaves = 0; let nodes = 0;
  function visit(input: unknown, depth: number, hops: number): boolean {
    if (!input || typeof input !== 'object' || seen.has(input) || depth > 4 || hops > 2 || ++nodes > 64) return false;
    seen.add(input); const node = input as Record<string, unknown>;
    if (node.kind === 'all' || node.kind === 'any') return Array.isArray(node.children) && node.children.length <= 24 && node.children.every(child => visit(child, depth + 1, hops));
    if (node.kind === 'not') return visit(node.child, depth + 1, hops);
    if (node.kind === 'relation') return visit(node.target, depth + 1, hops + 1);
    return ++leaves <= 24;
  }
  return visit(value, 0, 0);
}
export const expressionSchema = z.unknown().refine(boundedExpression, 'Expression exceeds bounds.').pipe(recursiveExpression).superRefine((expression, ctx) => {
  const ids = expressionNodes(expression).map(node => node.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Constraint IDs must be unique.' });
});
export function expressionNodes(node: Expression): Expression[] {
  return [node, ...('children' in node ? node.children.flatMap(expressionNodes) : 'child' in node ? expressionNodes(node.child) : 'target' in node ? expressionNodes(node.target) : [])];
}
export const queryScopeSchema = z.object({ collectionId: id, traversal: z.enum(['direct', 'descendants', 'explicitUnion']), include: z.array(id).max(24).optional(), path: z.array(id).min(1).max(9) }).strict();
export const preferenceSchema = z.object({ expression: expressionSchema, weight: z.number().finite().min(0).max(10) }).strict();
export const sortTermSchema = z.object({ fieldId: id, direction: z.enum(['asc', 'desc']) }).strict();
export const querySpecSchema = z.object({ version: z.literal(2), queryId: id, revision: z.number().int().nonnegative(), publication: publicationRefSchema,
  scope: queryScopeSchema, searchText: z.string().trim().max(500).default(''), where: expressionSchema, preferences: z.array(preferenceSchema).max(8), order: z.array(sortTermSchema).max(3),
  asOf: queryTimeSchema, timeZone: z.string().min(1).max(80),
}).strict().superRefine((query, ctx) => { try { new Intl.DateTimeFormat('en', { timeZone: query.timeZone }); } catch { ctx.addIssue({ code: 'custom', message: 'Invalid time zone.' }); } });
export type QuerySpec = z.infer<typeof querySpecSchema>;
export const queryPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addConstraint'), parentId: id, expression: expressionSchema }).strict(),
  z.object({ op: z.literal('replaceConstraint'), nodeId: id, expression: expressionSchema }).strict(),
  z.object({ op: z.literal('removeConstraint'), nodeId: id }).strict(),
  z.object({ op: z.literal('setPreferences'), preferences: z.array(preferenceSchema).max(8) }).strict(),
  z.object({ op: z.literal('setSearch'), text: z.string().trim().max(500) }).strict(),
  z.object({ op: z.literal('setSort'), order: z.array(sortTermSchema).max(3) }).strict(),
  z.object({ op: z.literal('setScope'), scope: queryScopeSchema }).strict(),
  z.object({ op: z.literal('setTime'), asOf: queryTimeSchema, timeZone: z.string().max(80) }).strict(),
  z.object({ op: z.literal('clearScopeCriteria') }).strict(), z.object({ op: z.literal('undo') }).strict(), z.object({ op: z.literal('fork') }).strict(),
]);
export const queryPatchSchema = z.object({ queryId: id, baseRevision: z.number().int().nonnegative(), operations: z.array(queryPatchOperationSchema).min(1).max(24) }).strict();
export type QueryPatch = z.infer<typeof queryPatchSchema>;
export type QueryHistory = { current: QuerySpec; past: QuerySpec[] };
function rewrite(node: Expression, target: string, replace: (node: Expression) => Expression | null): Expression | null {
  if (node.id === target) return replace(node);
  if ('children' in node) return { ...node, children: node.children.map(child => rewrite(child, target, replace)).filter((child): child is Expression => child !== null) };
  if ('child' in node) { const child = rewrite(node.child, target, replace); return child ? { ...node, child } : null; }
  if ('target' in node) { const child = rewrite(node.target, target, replace); return child ? { ...node, target: child } : null; }
  return node;
}
export function patchQuery(history: QueryHistory, input: unknown, forkId?: string): QueryHistory {
  const patch = queryPatchSchema.parse(input), current = querySpecSchema.parse(history.current);
  if (patch.queryId !== current.queryId || patch.baseRevision !== current.revision) throw new Error('Query changed. Reload results.');
  let next = structuredClone(current); let past = history.past;
  for (const op of patch.operations) {
    if (op.op === 'undo' || op.op === 'fork') {
      if (patch.operations.length !== 1) throw new Error('Undo and fork require separate patches.');
      if (op.op === 'undo') { if (!past.length) throw new Error('No query to undo.'); next = { ...past.at(-1)!, queryId: current.queryId }; past = past.slice(0, -1); }
      else { if (!forkId || forkId === current.queryId) throw new Error('Host must assign a new query ID.'); next.queryId = forkId; }
    } else if (op.op === 'setSearch') next.searchText = op.text;
    else if (op.op === 'setSort') next.order = op.order;
    else if (op.op === 'setPreferences') next.preferences = op.preferences;
    else if (op.op === 'setScope') next.scope = op.scope;
    else if (op.op === 'setTime') { next.asOf = op.asOf; next.timeZone = op.timeZone; }
    else if (op.op === 'clearScopeCriteria') next.where = { kind: 'all', id: 'criteria', children: [] };
    else {
      const target = op.op === 'addConstraint' ? op.parentId : op.nodeId;
      if (!expressionNodes(next.where).some(node => node.id === target)) throw new Error('Unknown constraint.');
      next.where = rewrite(next.where, target, node => {
        if (op.op === 'removeConstraint') return null;
        if (op.op === 'replaceConstraint') return op.expression;
        if (!('children' in node)) throw new Error('Add requires an AND/OR group.');
        return { ...node, children: [...node.children, op.expression] };
      }) ?? { kind: 'all', id: 'criteria', children: [] };
    }
  }
  next.revision = current.revision + 1;
  return { current: querySpecSchema.parse(next), past: patch.operations[0].op === 'undo' ? past : [...past, current].slice(-20) };
}
export function validateQueryFields(query: QuerySpec, fields: FieldDescriptor[], relationships: RelationshipDescriptor[]) {
  const definitions = new Map(fields.map(field => [field.id, field]));
  for (const expression of [query.where, ...query.preferences.map(preference => preference.expression)]) for (const node of expressionNodes(expression)) {
    if (node.kind === 'relation' && !relationships.some(relation => relation.id === node.predicateId)) throw new Error('Unsupported relationship.');
    if (node.kind !== 'field' && node.kind !== 'state') continue;
    const field = definitions.get(node.fieldId);
    if (!field?.filter) throw new Error('Unsupported filter field.');
    if (node.kind === 'state') continue;
    if (!field.operations.includes(node.op) || field.type !== node.value.type || field.unit !== node.value.unit || field.currency !== node.value.currency || field.basis !== node.value.basis
      || Array.isArray(node.value.value) !== ['any', 'all'].includes(node.op)
      || field.values && (Array.isArray(node.value.value) ? node.value.value : [node.value.value]).some(value => !field.values!.includes(value as string))) throw new Error('Unsupported filter value, operation or measurement basis.');
  }
  for (const term of query.order) if (!definitions.get(term.fieldId)?.sort) throw new Error('Unsupported sort field.');
}
export const resultReferenceSchema = z.object({ recordId: id, code: z.string().regex(/^R[1-9][0-9]*$/), ordinal: z.number().int().positive() }).strict();
export const queryResultSchema = z.object({ version: z.literal(2), queryId: id, revision: z.number().int().nonnegative(), publication: publicationRefSchema,
  resultSetId: id, items: z.array(resultReferenceSchema).max(48), nextCursor: z.string().max(4096).nullable(), evaluatedAt: queryTimeSchema,
  count: z.object({ value: z.number().int().nonnegative(), kind: z.enum(['exact', 'lowerBound', 'unknown']) }).strict(), coverage: z.enum(['complete', 'partial']),
  exclusions: z.object({ unknown: z.number().int().nonnegative(), conflicting: z.number().int().nonnegative(), conditional: z.number().int().nonnegative(), stale: z.number().int().nonnegative() }).strict(),
}).strict();
export type QueryResult = z.infer<typeof queryResultSchema>;
export const selectionStateSchema = z.object({ version: z.literal(2), selectionId: id, revision: z.number().int().nonnegative(), publication: publicationRefSchema,
  members: z.array(z.object({ recordId: id, resultSetId: id, available: z.boolean() }).strict()).max(100),
}).strict();
export type SelectionState = z.infer<typeof selectionStateSchema>;
