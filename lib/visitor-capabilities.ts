import 'server-only';
import { websiteQueryCommand } from './visitor-query-command';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { capabilityDefinitionSchema } from '@thevoice/platform-ui/contracts';
import { expressionSchema, fieldDescriptorSchema, relationshipDescriptorSchema, patchQuery, queryPatchSchema, queryPatchOperationSchema, queryScopeSchema, querySpecSchema, queryResultSchema, expressionNodes, validateQueryFields, selectionStateSchema, taskIdSchema, type QuerySpec } from '@thevoice/platform-ui/query';
import { canonicalRecordSchema, spaceCollectionSchema } from '@thevoice/platform-ui/collection-space';
import { capabilityDescriptorSchema, type CapabilityDescriptor } from '@thevoice/platform-ui/task';
import { displayedTaskRecordIds, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { describeScope, projectField, QueryResultStore, compatibleComparisonFields, evaluateQuery, resolveCollectionScope, CollectionScopeError } from './catalog-query';
import { queryHash, type CompiledQueryIndex } from './catalog-query-index';
import { EvidenceTypeError, retainEvidence, resolveEvidence } from './visitor-evidence-store';
import { retainVisitorConversationResearch } from './visitor-conversation-memory';
import { clarificationSchema, retainTaskSurface, confirmVisitorView, type VisitorTaskSession, type VisitorTaskStore } from './visitor-task-store';
import { visitorArtifactSchema } from '@thevoice/platform-ui/artifacts';
import { exploreResultSchema } from './explore-model';
import { getBackendMode } from './firebase/config';
import { researchCapabilities, taskMapSchema, type VisitorResearch } from './visitor-research';
import { taskExtensionCapabilities } from './visitor-task-extensions';
import { priceTotalInputSchema, priceTotalOutputSchema, totalPublishedPrices, PublishedPriceInputError } from './visitor-price-calculation';
import { publishedEstimateSchema } from '@thevoice/platform-ui/estimate';
import { estimateCapabilities } from './visitor-estimate-capabilities';
import { estimatePriceOptions } from './visitor-estimate-price-options';
import { readPublishedEstimate, updatePublishedEstimate } from './visitor-estimate';
import { estimateVisitorTax, TaxEstimateInputError } from './visitor-estimate-tax';
import type { VisitorEstimateTaxInput } from '@thevoice/platform-ui/estimate-tax';
import { queryFieldFeedback, type QueryFieldFeedback } from './visitor-query-field-feedback';

const id = taskIdSchema, empty = z.object({}).strict();
const scopeInputSchema = queryScopeSchema.extend({
  collectionId: queryScopeSchema.shape.collectionId.describe('For explicitUnion, the first member collection, not a container. Never combine an ancestor with its descendant.'),
  include: queryScopeSchema.shape.include.describe('Additional explicitUnion member collections. Each member includes its descendants; omit ancestor containers.'),
  path: queryScopeSchema.shape.path.optional(),
});
const patchInputSchema = queryPatchSchema.extend({ operations: z.array(z.union([
  z.object({ op: z.literal('setScope'), scope: scopeInputSchema }).strict(), ...queryPatchOperationSchema.options.filter(option => option.shape.op.value !== 'setScope'),
])).min(1).max(24) });
const comparisonInputSchema = z.object({ records: z.array(canonicalRecordSchema).max(6).optional(),
  recordIds: z.array(id).min(2).max(6).refine(ids => new Set(ids).size === ids.length, 'Comparison requires distinct published record IDs.').describe('Exact published IDs for two to six specifically requested records. Copy IDs from current context; do not use this to truncate a query result.').optional(), queryHandleId: id.optional(),
  queryId: id.optional(), baseRevision: queryPatchSchema.shape.baseRevision.optional() }).strict();
const displayValue = z.object({ fieldId: id, text: z.string().max(4000) }).strict();
const outputSchemas: Record<string, z.ZodType> = {
  estimate: publishedEstimateSchema,
  'price-total': priceTotalOutputSchema,
  links: z.array(capabilityDefinitionSchema).max(20), clarification: clarificationSchema, research: exploreResultSchema,
  display: z.object({ type: z.enum(['records', 'comparison', 'detail', 'map', 'research', 'links', 'estimate']) }).strict(), map: taskMapSchema,
  query: querySpecSchema, selection: selectionStateSchema, records: z.array(canonicalRecordSchema).max(48), home: z.object({ home: z.literal(true) }).strict(),
  page: z.object({ cursor: z.string().max(4096).nullable() }).strict(),
  detail: z.object({ priceOptions: z.array(z.object({ fieldId: id, label: z.string().max(160), text: z.string().max(160) }).strict()).max(16).optional(), nextBlockOffset: z.number().int().nullable().optional(), nextFieldOffset: z.number().int().nullable().optional(), blockOffset: z.number().int().optional(), fieldOffset: z.number().int().optional(), record: canonicalRecordSchema, values: z.array(displayValue.extend({ label: z.string().max(160) })).max(64) }).strict(),
  comparison: z.object({ fields: z.array(fieldDescriptorSchema).max(16), rows: z.array(z.object({ id, name: z.string().max(180), values: z.array(displayValue).max(16) }).strict()).max(6) }).strict(),
  schema: z.object({ collection: spaceCollectionSchema, scope: queryScopeSchema, children: z.array(spaceCollectionSchema).max(24), childScopes: z.array(queryScopeSchema).max(24), omittedChildren: z.number().int().nonnegative(), fields: z.array(fieldDescriptorSchema).max(32), omittedFields: z.number().int().nonnegative(), relationships: z.array(relationshipDescriptorSchema).max(16) }).strict(),
};
const resultStore = new QueryResultStore();
export type CapabilityContext = { nativeWebsite?: boolean; websiteOpening?: boolean; research?: VisitorResearch; records?: (ids: string[]) => Promise<z.infer<typeof canonicalRecordSchema>[]>; index: CompiledQueryIndex; session: VisitorTaskSession; signal: AbortSignal };
export type Capability = { descriptor: CapabilityDescriptor; input: z.ZodType; output: z.ZodType; execute: (context: CapabilityContext, input: unknown) => Promise<unknown> };
export function capability<T>(name: string, purpose: string, schema: z.ZodType<T>, outputType: string, execute: (context: CapabilityContext, input: T) => Promise<unknown>, effect: CapabilityDescriptor['effect'] = 'localState'): Capability {
  return { descriptor: capabilityDescriptorSchema.parse({ id: name, version: 1, purpose, inputType: `${name}.input`, outputType, effect, scopes: [], preconditions: [], freshnessMs: 1_800_000,
    authorization: 'published', prepare: false, status: false, idempotent: true, maxCalls: 16, cancellation: 'abort', presentations: ['query', 'comparison', 'detail'], demoOnly: false }),
    input: schema, output: outputSchemas[outputType] ?? z.never(), execute: (context, input) => execute(context, schema.parse(input)) };
}
function active(session: VisitorTaskSession) {
  const query = session.queries.find(value => value.current.queryId === session.activeQueryId) ?? session.queries[0];
  if (!query) throw new Error('Choose a query first.'); return query;
}
function createQuery(context: CapabilityContext, scope: QuerySpec['scope'] = { collectionId: context.index.space.rootId, traversal: 'descendants', path: [context.index.space.rootId] }) {
  if (context.session.queries.length >= 8) throw new Error('Eight queries are already open.');
  const current = querySpecSchema.parse({ version: 2, queryId: randomUUID(), revision: 0, publication: context.session.publication, scope,
    where: { kind: 'all', id: 'criteria', children: [] }, preferences: [], order: [], asOf: new Date().toISOString(), timeZone: 'UTC' });
  evaluateQuery(context.index, current); context.session.queries.push({ current, past: [] }); context.session.activeQueryId = current.queryId;
  return current;
}
const fieldText = (context: CapabilityContext, recordId: string, fieldId: string, asOf = active(context.session).current.asOf) => {
  const value = projectField(context.index, recordId, fieldId, asOf);
  return value.state === 'known' ? `${Array.isArray(value.value!.value) ? value.value!.value.join(', ') : typeof value.value!.value === 'object' ? JSON.stringify(value.value!.value) : value.value!.value}${value.value?.currency ? ` ${value.value.currency}` : ''}${value.value?.unit ? ` ${value.value.unit}` : ''}${value.value?.basis ? ` / ${value.value.basis}` : ''}` : value.state;
};
function comparePublishedRecords(context: CapabilityContext, recordIds: string[], asOf = active(context.session).current.asOf) {
  if (recordIds.length < 2 || recordIds.length > 6) throw new CapabilityInputError([{ path: 'input', code: 'comparison_size', message: `The exact result contains ${recordIds.length} records; comparison needs two to six. Keep the requested criteria. For zero or one match, use query.patch to show that result; for more than six, ask which records to compare or apply only a visitor-requested refinement. Never silently truncate or relax filters.` }]);
  const records = recordIds.map(id => { const record = context.index.records.get(id); if (!record) throw new CapabilityInputError([{ path: 'input', code: 'unavailable_comparison_record', message: 'A comparison record is not in the current publication. Use exact current published record IDs; do not construct IDs or substitute other records.' }]); return record; });
  const fields = compatibleComparisonFields(context.index.space.fields, records.map(record => record.type))
    .filter(field => records.some(record => projectField(context.index, record.id, field.id, asOf).state !== 'unknown')).slice(0, 16);
  if (!fields.length) throw new CapabilityInputError([{ path: 'input', code: 'comparison_fields', message: 'No compatible fields are published for this comparison. Keep the useful view and explain the published evidence without inventing fields.' }]);
  return { fields, rows: records.map(record => ({ id: record.id, name: record.name, values: fields.map(field => ({ fieldId: field.id, text: fieldText(context, record.id, field.id, asOf) })) })) };
}
function comparisonQuery(session: VisitorTaskSession, input: z.infer<typeof comparisonInputSchema>): QuerySpec | undefined {
  const currentQuery = input.queryId !== undefined || input.baseRevision !== undefined;
  if (Number(currentQuery) + Number(input.queryHandleId !== undefined) + Number(input.records !== undefined) + Number(input.recordIds !== undefined) > 1) throw new CapabilityInputError([{ path: 'input', code: 'ambiguous_comparison_source', message: 'Use one source: current queryId/baseRevision, a queryHandleId, exact published recordIds, or a records binding. Query sources select all matches, never a page.' }]);
  if (currentQuery) {
    if (input.queryId === undefined || input.baseRevision === undefined) throw new CapabilityInputError([{ path: 'input', code: 'incomplete_query_reference', message: 'Copy both queryId and baseRevision from the current query identity and revision.' }]);
    const query = active(session).current;
    if (input.queryId !== query.queryId) throw new CapabilityInputError([{ path: 'input.queryId', code: 'inactive_query', message: 'Only the current active query can be compared by queryId/baseRevision. Use the current context; do not reuse a remembered older query.' }]);
    if (input.baseRevision !== query.revision) throw new Error('Query changed.');
    return query;
  }
  try { return input.queryHandleId ? querySpecSchema.parse(resolveEvidence(session, input.queryHandleId, 'query')) : undefined; }
  catch (error) {
    if (!(error instanceof EvidenceTypeError)) throw error;
    throw new CapabilityInputError([{ path: 'input.queryHandleId', code: 'evidence_type_mismatch', message: error.message }]);
  }
}
export const visitorCapabilities = new Map<string, Capability>([
  // Model capability: Compute bounded subtotals from published money fields, never model-supplied prices.
  capability('prices.total', 'Calculate a listed-price subtotal from 1–12 published record/price-field references and integer quantities. Use this for price multiplication and addition; returns exact rounded line totals and subtotal. Match the requested unit to the published field. No taxes, fees, currency conversion, inventory, order or payment action.', priceTotalInputSchema, 'price-total', async (context, input) => totalPublishedPrices(context.index, input, active(context.session).current.asOf), 'read'),
  // Model capability: Describe the retained verbatim-command adapter, which the model-facing registry excludes.
  capability('query.command', 'Apply a clear conversational filter, scope, sort or undo using published field definitions. Supply the visitor words verbatim; ambiguous requests ask for clarification.', z.object({ text: z.string().trim().min(1).max(2000) }).strict(), 'query', async () => { throw new Error('Commands must run through validated task execution.'); }),
  // Model capability: Describe reviewed navigation links without implying external action completion.
  capability('publisher.links', 'List reviewed publisher links, optionally for exact record IDs. Links are visitor navigation, never confirmation of an external action.', z.object({ recordIds: z.array(id).max(100).optional() }).strict(), 'links', async (context, input) => context.index.space.links.filter(link => !input.recordIds?.length || !link.entityIds.length || link.entityIds.some(id => input.recordIds!.includes(id))), 'read'),
  // Model capability: Describe clarification that preserves the useful current view.
  capability('task.clarify', 'Ask a bounded clarification before interpreting an ambiguous field, reference or unsupported capability. Preserve the current useful view.', clarificationSchema, 'clarification', async (context, input) => { context.session.clarification = input; return input; }),
  // Model capability: Describe display of a retained typed result with a browser receipt.
  capability('presentation.show', 'Display a retained typed result. Completion requires the exact settled browser receipt.', z.object({ handleId: id, outputType: z.enum(['records', 'comparison', 'detail', 'map', 'research', 'links', 'estimate']) }).strict(), 'display', async (context, input) => {
    const data = outputSchemas[input.outputType].parse(resolveEvidence(context.session, input.handleId, input.outputType));
    context.session.presentation = { type: input.outputType, data }; return { type: input.outputType };
  }),
  // Model capability: Describe bounded record retrieval within active hard filters.
  capability('records.search', 'Find up to 24 authorized records by name, aliases or summary, within the active hard filters. Use query.patch setSearch for exhaustive counts and paging.', z.object({ text: z.string().trim().min(1).max(500) }).strict(), 'records', async (context, input) => evaluateQuery(context.index, { ...active(context.session).current, searchText: input.text }).ordered.slice(0, 24).map(id => context.index.records.get(id)!), 'read'),
  // Model capability: Describe filtering a previously retrieved bounded record set.
  capability('records.filter', 'Filter a previous bounded record result using the same typed query evaluator.', z.object({ records: z.array(canonicalRecordSchema).max(48), where: expressionSchema }).strict(), 'records', async (context, input) => {
    const query = { ...active(context.session).current, where: input.where };
    const eligible = new Set(evaluateQuery(context.index, query).ordered);
    return input.records.flatMap(record => { const approved = context.index.records.get(record.id); if (!approved) throw new Error('Unavailable dependent record.'); return eligible.has(record.id) ? [approved] : []; });
  }, 'read'),
  // Model capability: Describe replacing selection using server-owned record results.
  capability('selection.fromRecords', 'Replace the reversible selection from a typed record result, retaining canonical facts.', z.object({ records: z.array(canonicalRecordSchema).max(48) }).strict(), 'selection', async (context, input) => {
    if (input.records.some(record => !context.index.records.has(record.id))) throw new Error('Unavailable dependent record.');
    context.session.selection.members = [...new Set(input.records.map(record => record.id))].map(recordId => ({ recordId, resultSetId: 'dependent-records', available: true })); context.session.selection.revision++; return context.session.selection;
  }),
  // Model capability: Describe retrieval of reviewed fields and collection scopes.
  capability('schema.describe', 'Describe a published collection, exact childScopes and reviewed fields. Omit offsets for the first page. Use rootScope to discover top-level collections; a unique collection path can be omitted.', z.object({ scope: scopeInputSchema.optional(), children: z.number().int().min(0).max(1000).describe('Zero-based child collection offset, not a count or limit. Use 0 for the first page (up to 24 children), 24 for the next.').optional(), fields: z.number().int().min(0).max(64).describe('Zero-based field offset, not a count or limit. Use 0 for the first page (up to 32 fields), 32 for the next.').optional() }).strict(), 'schema', async (context, input) => describeScope(context.index, input.scope ? resolveCollectionScope(context.index, input.scope) : active(context.session).current.scope, input), 'read'),
  // Model capability: Describe paging through child collections and fields.
  capability('collection.page', 'Browse another bounded page of child collections and reviewed fields.', z.object({ children: z.number().int().min(0).max(1000).describe('Zero-based child collection offset, not a count or limit. Use 0 for the first page (up to 24 children), 24 for the next.'), fields: z.number().int().min(0).max(64).describe('Zero-based field offset, not a count or limit. Use 0 for the first page (up to 32 fields), 32 for the next.') }).strict(), 'schema', async (context, input) => { context.session.browse = input; return describeScope(context.index, active(context.session).current.scope, input); }),
  // Model capability: Describe closing a query while retaining visitor work.
  capability('query.close', 'Close a query while retaining selections, artifacts and cart.', z.object({ queryId: id }).strict(), 'home', async (context, input) => { context.session.queries = context.session.queries.filter(query => query.current.queryId !== input.queryId); if (context.session.activeQueryId === input.queryId) context.session.activeQueryId = context.session.queries[0]?.current.queryId ?? null; context.session.scene = null; context.session.page = null; return { home: true }; }),
  // Model capability: Describe creating an independent scoped query.
  capability('query.create', 'Create an independent query in a chosen collection scope; omit path for unique published ancestry.', z.object({ scope: scopeInputSchema.optional() }).strict(), 'query', async (context, input) => createQuery(context, input.scope ? resolveCollectionScope(context.index, input.scope) : undefined)),
  // Model capability: Describe typed criterion edits that preserve unrelated constraints.
  capability('query.patch', 'Atomically edit named criteria; preserve untouched constraints. setScope uses a published collectionId; omit path for unique ancestry or copy a schema.describe childScope. setSearch replaces only searchText, not where predicates. Search subject terms only; requested display fields are not filters. Supports undo and fork.', patchInputSchema, 'query', async (context, input) => {
    const history = context.session.queries.find(query => query.current.queryId === input.queryId);
    if (!history) throw new CapabilityInputError([{ path: 'input.queryId', code: 'unknown_query', message: 'Unknown query. Use the current query identity from context; do not construct or alter IDs.' }]);
    const updated = patchQuery(history, input, randomUUID()); evaluateQuery(context.index, updated.current);
    if (updated.current.queryId !== history.current.queryId) { if (context.session.queries.length >= 8) throw new Error('Query limit reached.'); context.session.queries.push(updated); }
    else context.session.queries[context.session.queries.indexOf(history)] = updated;
    context.session.navigation = []; context.session.activeQueryId = updated.current.queryId; context.session.scene = null; context.session.page = null; context.session.presentation = null; context.session.browse = { children: 0, fields: 0 }; return updated.current;
  }),
  // Model capability: Compose an exact query and comparison without model-side ID copying or an intermediate display.
  capability('query.compare', 'Apply query.patch operations, then compare all exact matches in one atomic display. Requires two to six; never truncates or relaxes filters. Unknown properties stay unknown. Complete any further calculation, recommendation or research separately.', patchInputSchema, 'comparison', async (context, input) => {
    const query = querySpecSchema.parse(await visitorCapabilities.get('query.patch')!.execute(context, input));
    return comparePublishedRecords(context, evaluateQuery(context.index, query).ordered, query.asOf);
  }),
  // Model capability: Describe returning to an existing query without transferring criteria.
  capability('query.activate', 'Return to another existing query without transferring incompatible criteria.', z.object({ queryId: id }).strict(), 'query', async (context, input) => {
    const history = context.session.queries.find(query => query.current.queryId === input.queryId); if (!history) throw new Error('Unknown query.'); if (context.session.activeQueryId !== input.queryId) context.session.page = null; context.session.activeQueryId = input.queryId; context.session.navigation = []; context.session.scene = null; context.session.presentation = null; context.session.browse = { children: 0, fields: 0 }; return history.current;
  }),
  // Model capability: Describe returning to a confirmed view or local collection results.
  capability('view.back', 'Return to the previous confirmed view. Use target results to leave all foreground details and restore the filtered page and order.', z.object({ target: z.enum(['previous', 'results']).default('previous') }).strict(), 'query', async (context, input) => {
    let previous = context.session.navigation.pop();
    if (input.target === 'results') while (previous?.presentation && context.session.navigation.length) previous = context.session.navigation.pop();
    if (input.target === 'results' && previous?.presentation) previous = { ...previous, presentation: null };
    if (previous) { context.session.activeQueryId = previous.queryId; context.session.page = previous.page; context.session.presentation = previous.presentation; }
    else context.session.presentation = null;
    return active(context.session).current;
  }),
  // Model capability: Describe clearing collection constraints separately from Home.
  capability('view.reset', 'Clear every constraint, search, sort and scope; show the complete website. Home is a separate opening experience.', empty, 'query', async context => {
    const history = active(context.session);
    const updated = { ...history.current, revision: history.current.revision + 1, scope: { collectionId: context.index.space.rootId, traversal: 'descendants' as const, path: [context.index.space.rootId] }, where: { kind: 'all' as const, id: 'criteria', children: [] }, searchText: '', preferences: [], order: [] };
    history.past = [...history.past, history.current].slice(-20); history.current = updated;
    context.session.activeQueryId = context.nativeWebsite ? null : updated.queryId; context.session.page = null; context.session.presentation = null; context.session.navigation = [];
    return updated;
  }),
  // Model capability: Describe cursor-based paging through the current result set.
  capability('query.page', 'Retrieve the next bounded result page with the current query cursor.', z.object({ cursor: z.string().max(4096).nullable() }).strict(), 'page', async (context, input) => { context.session.navigation = [...context.session.navigation, { queryId: context.session.activeQueryId, page: context.session.page, presentation: null }].slice(-8); context.session.presentation = null; context.session.page = input.cursor ? { queryId: active(context.session).current.queryId, revision: active(context.session).current.revision, cursor: input.cursor } : null; return input; }),
  // Model capability: Describe selecting or removing an exact published record.
  capability('selection.modify', 'Select or remove an exact current published canonical record.', z.object({ recordId: id, selected: z.boolean() }).strict(), 'selection', async (context, input) => {
    if (!context.index.records.has(input.recordId)) throw new Error('Unavailable record.');
    context.session.activeQueryId ??= context.session.queries[0]?.current.queryId ?? null;
    const selected = context.session.selection;
    if (input.selected && !selected.members.some(member => member.recordId === input.recordId)) {
      if (selected.members.length >= 100) throw new Error('Selection limit reached.');
      selected.members.push({ recordId: input.recordId, resultSetId: context.session.scene?.resultSetId ?? 'published-record', available: true });
    } else if (!input.selected) selected.members = selected.members.filter(member => member.recordId !== input.recordId);
    selected.revision++; context.session.presentation = null; return selected;
  }),
  // Model capability: Describe comparison using compatible reviewed fields.
  capability('selection.compare', 'Compare two to six exact records with published fields. For specifically named records whose exact published IDs are in context, pass recordIds directly; no records.lookup. For all current matches copy queryId and baseRevision from query. Or use a fresh queryHandleId, records binding, or current selection. Use one source. Never truncate to a page.', comparisonInputSchema, 'comparison', async (context, input) => {
    const query = comparisonQuery(context.session, input);
    return comparePublishedRecords(context, query ? evaluateQuery(context.index, query).ordered : input.recordIds ?? (input.records ? input.records.map(record => record.id) : context.session.selection.members.filter(member => member.available).map(member => member.recordId)), query?.asOf);
  }),
  // Model capability: Describe reading bounded published records without private or live-state claims.
  capability('records.lookup', 'Read bounded current published records; no private sources or inferred live availability.', z.object({ recordIds: z.array(id).min(1).max(6) }).strict(), 'records', async (context, input) => {
    if (context.records) return context.records(input.recordIds);
    return input.recordIds.map(id => { const record = context.index.records.get(id); if (!record) throw new Error('Unavailable published record.'); return record; });
  }, 'read'),
  // Model capability: Describe opening a published record and its qualified details.
  capability('record.detail', 'Open one published record with its detail blocks and qualified fields.', z.object({ recordId: id, blockOffset: z.number().int().min(0).max(32).default(0), fieldOffset: z.number().int().min(0).max(64).default(0) }).strict(), 'detail', async (context, input) => {
    const record = context.records ? (await context.records([input.recordId]))[0] : context.index.records.get(input.recordId); if (!record) throw new Error('Unavailable record.');
    const fields = context.index.space.fields.filter(field => (!field.recordTypes.length || field.recordTypes.includes(record.type)) && projectField(context.index, record.id, field.id, active(context.session).current.asOf).state !== 'unknown');
    // Keep paragraphs with their headings, with a bounded reading page.
    let end = Math.min(record.blocks.length, input.blockOffset + 12);
    if (end < record.blocks.length && record.blocks[end - 1]?.kind === 'heading') end--;
    return { priceOptions: estimatePriceOptions(context, record.id), record: { ...record, assertions: [], blocks: record.blocks.slice(input.blockOffset, end) }, blockOffset: input.blockOffset, fieldOffset: input.fieldOffset, nextBlockOffset: end < record.blocks.length ? end : null, nextFieldOffset: input.fieldOffset + 16 < fields.length ? input.fieldOffset + 16 : null, values: fields.slice(input.fieldOffset, input.fieldOffset + 16).map(field => ({ fieldId: field.id, label: field.label, text: fieldText(context, record.id, field.id).slice(0, 1000) })) };
  }),
  // Model capability: Describe resolving stable codes or ordinals against a confirmed scene.
  capability('reference.resolve', 'Resolve a stable result code or visible ordinal. Visible ordinals require the exact current sceneRevision; stale or unsettled scenes require clarification.', z.object({ ordinal: z.number().int().min(1).max(10000), resultSetId: id, visible: z.boolean(), sceneRevision: z.number().int().nonnegative().optional() }).strict(), 'records', async (context, input) => {
    const query = active(context.session).current, scene = context.session.viewport === undefined ? context.session.scene : context.session.viewport;
    if (input.visible && (!scene || scene.sceneRevision !== input.sceneRevision || scene.resultSetId !== input.resultSetId || scene.queryRevision !== query.revision || scene.queryId !== query.queryId)) throw new Error('The scene changed. Clarify the requested record.');
    const recordId = input.visible ? scene!.recordIds[input.ordinal - 1] : resultStore.resolve(input.resultSetId, input.ordinal, query, { sessionId: context.session.id, publication: context.session.publication, entitlement: 'public' });
    if (!recordId) throw new Error('That visible ordinal is unavailable.'); return [context.index.records.get(recordId)!];
  }, 'read'),
  // Model capability: Describe returning to the opening while retaining selected and saved work.
  capability('home', 'Cancel pending visitor tasks and return Home; retain selected records, cart and saved artifacts.', empty, 'home', async context => {
    if (context.session.queries.length) await visitorCapabilities.get('view.reset')!.execute(context, {});
    context.session.generation++; if (!context.websiteOpening || context.nativeWebsite) context.session.activeQueryId = null; context.session.scene = null; context.session.page = null; context.session.presentation = null; context.session.navigation = [];
    for (const task of context.session.tasks) if (!['completed', 'reconciling'].includes(task.status)) task.status = 'cancelled';
    return { home: true };
  }),
].map(value => [value.descriptor.id, value]));
for (const entry of [...taskExtensionCapabilities(), ...researchCapabilities(), ...estimateCapabilities()]) visitorCapabilities.set(entry.descriptor.id, entry);

export const capabilityCallSchema = z.object({ operationId: z.string().uuid(), capabilityId: id, expectedRevision: z.number().int().nonnegative(), input: z.unknown(),
  bindings: z.array(z.object({ input: id, handleId: id, outputType: id }).strict()).max(12).optional(),
}).strict();
export type CapabilityCall = z.infer<typeof capabilityCallSchema>;
/** Only validation before operation reservation is eligible for model correction. */
export class CapabilityInputError extends Error {
  constructor(readonly issues: { path: string; code: string; message: string }[], readonly queryFields?: QueryFieldFeedback) {
    super('The capability arguments do not match its typed input.'); this.name = 'CapabilityInputError';
  }
}
export async function executeVisitorCapability(options: { nativeWebsite?: boolean; websiteOpening?: boolean; research?: VisitorResearch; records?: CapabilityContext['records']; sessionId: string; sessionSnapshot?: VisitorTaskSession; index: CompiledQueryIndex; store: VisitorTaskStore; call: CapabilityCall; signal: AbortSignal; assertCurrent: () => Promise<void>; registry?: Map<string, Capability>; taskId?: string }) {
  const { index, store, signal } = options, call = capabilityCallSchema.parse(options.call), registry = options.registry ?? visitorCapabilities;
  signal.throwIfAborted();
  // Both are read-only prerequisites. Preserve the revision/CAS checks below,
  // but do not put publication I/O in front of independent session I/O.
  // Only server callers can supply a freshly read snapshot. The reservation
  // CAS below must still succeed before any adapter executes, including reads.
  let [, session] = await Promise.all([options.assertCurrent(), options.sessionSnapshot ?? store.read(options.sessionId, index.space.publication)]);
  if (session.id !== options.sessionId || queryHash(session.publication) !== queryHash(index.space.publication)) throw new Error('Visitor session snapshot does not match this publication.');
  signal.throwIfAborted();
  const hash = queryHash({ capabilityId: call.capabilityId, input: call.input, bindings: call.bindings });
  const prior = session.operations.find(operation => operation.id === call.operationId);
  if (prior) { if (prior.hash !== hash) throw new Error('Conflicting operation ID reuse.'); if (prior.status !== 'completed' || (prior.result as { expired?: boolean })?.expired) throw new Error('Operation requires status inspection; it will not execute twice.'); return prior.result as { view: VisitorTaskView; handleId: string; outputType: string; data: unknown }; }
  if (session.revision !== call.expectedRevision) throw new Error('Visitor state changed. Reload before continuing.');
  if (session.operations.length >= 100) throw new Error('Session operation budget reached.');
  if (call.capabilityId === 'query.command') {
    const input = registry.get('query.command')!.input.parse(call.input) as { text: string };
    const command = websiteQueryCommand(input.text, { index, session }) ?? { capabilityId: 'task.clarify', input: { question: 'Name a published collection or attribute and the change you want.', options: [] } };
    call.capabilityId = command.capabilityId; call.input = command.input;
  }
  const selected = registry.get(call.capabilityId);
  if (selected?.descriptor.demoOnly && getBackendMode() !== 'demo') throw new Error('Synthetic capability is not enabled.');
  if (!selected || selected.descriptor.authorization !== 'published') throw new Error('Capability is not enabled.');
  let input = call.input;
  if (call.bindings?.length) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CapabilityInputError([{ path: 'input', code: 'invalid_type', message: 'Bindings need typed object inputs.' }]);
    input = { ...input }; const assigned = new Set<string>();
    for (const [position, binding] of call.bindings.entries()) {
      let value: unknown;
      try { value = resolveEvidence(session, binding.handleId, binding.outputType); }
      catch (error) {
        if (error instanceof EvidenceTypeError) throw new CapabilityInputError([{ path: `bindings.${position}.outputType`, code: 'evidence_type_mismatch', message: error.message }]);
        throw error;
      }
      if (!(selected.input instanceof z.ZodObject) || !Object.hasOwn(selected.input.shape, binding.input) || assigned.has(binding.input)) throw new CapabilityInputError([{ path: `bindings.${position}.input`, code: 'invalid_binding_target', message: 'Bind each declared input field at most once; omit bindings for fields absent from this capability input schema.' }]);
      assigned.add(binding.input); (input as Record<string, unknown>)[binding.input] = value;
    }
  }
  const parsed = selected.input.safeParse(input);
  if (!parsed.success) throw new CapabilityInputError(parsed.error.issues.slice(0, 8).map(issue => ({ path: `input.${issue.path.join('.')}`.slice(0, 160), code: issue.code, message: issue.message.slice(0, 240) })));
  input = parsed.data;
  // Validate published money references before reserving state. The model may
  // correct a rejected reference inside the existing bounded turn; no action ran.
  if (call.capabilityId === 'prices.total' || call.capabilityId === 'estimate.update') {
    const priced = input as { op?: string };
    if (call.capabilityId === 'prices.total' || ['set', 'upsert'].includes(priced.op ?? '')) {
      try {
        const asOf = new Date().toISOString().slice(0, 10);
        if (call.capabilityId === 'prices.total') totalPublishedPrices(index, input as z.infer<typeof priceTotalInputSchema>, asOf);
        else updatePublishedEstimate(index, session.business.estimate, input, asOf);
      }
      catch (error) {
        if (!(error instanceof PublishedPriceInputError)) throw error;
        throw new CapabilityInputError([{ path: 'input.lines', code: 'invalid_published_price', message: `${error.message} Read records.lookup for the requested record IDs and copy their returned priceOptions fieldId and unit; never guess a field ID.`.slice(0, 500) }]);
      }
    }
  }
  if (call.capabilityId === 'estimate.tax') {
    const estimate = readPublishedEstimate(index, session.business.estimate, new Date().toISOString().slice(0, 10));
    try { estimateVisitorTax({ session, estimate, input: (input as { tax: VisitorEstimateTaxInput }).tax }); }
    catch (error) {
      if (!(error instanceof TaxEstimateInputError)) throw error;
      throw new CapabilityInputError([{ path: 'input.tax', code: 'invalid_tax_evidence', message: `${error.message} Copy the exact retained cited excerpt and source URL; do not rewrite the evidence.`.slice(0, 500) }]);
    }
  }
  // Resolve scope identity before reserving an operation. Unknown/ambiguous
  // references are correctable input, never a failed execution or a paid retry.
  try {
    if (call.capabilityId === 'query.patch' || call.capabilityId === 'query.compare') {
      const patch = input as z.infer<typeof patchInputSchema>;
      input = { ...patch, operations: patch.operations.map(operation => {
        if (operation.op !== 'setScope') return operation;
        const scope = resolveCollectionScope(index, operation.scope);
        const members = [...new Set([scope.collectionId, ...scope.include ?? []])];
        if (scope.traversal === 'explicitUnion' && members.some(parent => members.some(child => parent !== child && index.descendants.get(parent)?.has(child)))) {
          throw new CollectionScopeError('explicitUnion collectionId is the first member, not a container. Choose the desired member collections without also including their ancestors; each member already includes its descendants.');
        }
        return { ...operation, scope };
      }) };
    } else if (call.capabilityId === 'query.create' || call.capabilityId === 'schema.describe') {
      const scoped = input as { scope?: z.infer<typeof scopeInputSchema> };
      if (scoped.scope) input = { ...scoped, scope: resolveCollectionScope(index, scoped.scope) };
    }
  } catch (error) {
    if (!(error instanceof CollectionScopeError)) throw error;
    throw new CapabilityInputError([{ path: ['query.patch', 'query.compare'].includes(call.capabilityId) ? 'input.operations.setScope' : 'input.scope', code: 'invalid_scope', message: error.message }]);
  }
  // Field-dependent validation is also preflight: missing currency/basis must
  // be correctable without reserving an operation or losing the current view.
  if (call.capabilityId === 'query.patch' || call.capabilityId === 'query.compare') {
    const patch = input as z.infer<typeof patchInputSchema>;
    const history = session.queries.find(query => query.current.queryId === patch.queryId);
    if (!history) throw new CapabilityInputError([{ path: 'input.queryId', code: 'unknown_query', message: 'Unknown query. Use the current query identity from context; do not construct or alter IDs.' }]);
    const projected = patchQuery(history, patch, randomUUID()).current;
    try { validateQueryFields(projected, index.space.fields, index.space.relationshipTypes); }
    catch (error) {
      throw new CapabilityInputError([{ path: 'input.operations', code: 'invalid_query_fields', message: `${error instanceof Error ? error.message : 'Invalid query fields.'} queryFields contains exact published definitions and discovery candidates, not accepted replacements. Copy full field IDs and the correct type, currency, basis or numeric unit into filters and sort. Do not substitute unit for money basis. Use schema.describe only for unknown, ambiguous or omitted field meanings; never guess or relax the request.`.slice(0, 1600) }], queryFieldFeedback(projected, index.space.fields));
    }
    if (call.capabilityId === 'query.compare') comparePublishedRecords({ index, session, signal }, evaluateQuery(index, projected).ordered, projected.asOf);
  }
  if (call.capabilityId === 'selection.compare') {
    const comparison = input as z.infer<typeof comparisonInputSchema>, query = comparisonQuery(session, comparison);
    comparePublishedRecords({ index, session, signal }, query ? evaluateQuery(index, query).ordered : comparison.recordIds ?? (comparison.records ? comparison.records.map(record => record.id) : session.selection.members.filter(member => member.available).map(member => member.recordId)), query?.asOf);
  }
  const dependencies = (call.bindings ?? []).flatMap(binding => session.evidence.find(value => value.handle.id === binding.handleId)?.handle.dependencies ?? []);
  if (call.capabilityId === 'presentation.show') dependencies.push(...(session.evidence.find(value => value.handle.id === (input as { handleId: string }).handleId)?.handle.dependencies ?? []));
  if (call.capabilityId === 'selection.compare' && (input as { queryHandleId?: string }).queryHandleId) dependencies.push(...(session.evidence.find(value => value.handle.id === (input as { queryHandleId: string }).queryHandleId)?.handle.dependencies ?? []));
  if (call.capabilityId === 'reference.resolve' && (input as { visible: boolean }).visible) dependencies.push({ id: `scene:${session.id}`, revision: (input as { sceneRevision?: number }).sceneRevision ?? -1 });
  const generation = session.generation;
  const taskId = options.taskId ?? randomUUID();
  let task = session.tasks.find(task => task.taskId === taskId);
  if (!task) {
    if (session.tasks.length >= 8) session.tasks = session.tasks.filter(task => !['completed', 'cancelled', 'failed'].includes(task.status));
    if (session.tasks.length >= 8) throw new Error('Task capacity reached.');
    task = { version: 2, taskId, sessionId: session.id, revision: 0, publication: session.publication, generation, outcome: selected.descriptor.purpose, status: 'running', steps: [], receipts: [],
      budget: { modelCalls: 0, capabilityCalls: 0, expiresAt: new Date(Date.now() + 120_000).toISOString() } };
    session.tasks.push(task);
  }
  if (task.generation !== generation || task.budget.capabilityCalls >= 16 || Date.parse(task.budget.expiresAt) <= Date.now()) throw new Error('Task cancelled or budget exhausted.');
  task.budget.capabilityCalls++; task.revision++; task.status = 'running';
  if (call.capabilityId !== 'task.clarify') session.clarification = null;
  task.steps.push({ id: randomUUID(), capabilityId: call.capabilityId, capabilityVersion: selected.descriptor.version, operationId: call.operationId, bindings: call.bindings ?? [], status: 'running' });
  // Built-in query edits/comparisons are pure in-memory work: persist operation and
  // result atomically once. Every other adapter still reserves before executing,
  // including custom registries and anything that can call a provider.
  const atomicQuery = selected === visitorCapabilities.get('query.patch') || selected === visitorCapabilities.get('query.compare');
  session.operations.push({ id: call.operationId, hash, status: 'running' });
  if (!atomicQuery) session = await store.save(session, session.revision);
  const context = { nativeWebsite: options.nativeWebsite, websiteOpening: options.websiteOpening, index, session, signal, records: options.records, research: options.research };
  try {
    const sameDetail = call.capabilityId === 'record.detail' && session.presentation?.type === 'detail' && (session.presentation.data as VisitorTaskView['detail'])?.record.id === (input as { recordId: string }).recordId;
    if (['record.detail', 'selection.compare', 'presentation.show', 'estimate.update', 'estimate.show', 'estimate.tax'].includes(call.capabilityId) && !sameDetail) {
      session.navigation = [...session.navigation, { queryId: session.activeQueryId, page: session.page, presentation: session.presentation }].slice(-8);
      session.activeQueryId ??= session.queries[0]?.current.queryId ?? null;
    }
    const data = selected.output.parse(await selected.execute(context, input)); signal.throwIfAborted();
    // A pure query has no external effect and commits once below. That CAS
    // rejects intervening session changes without rereading the whole document.
    // Viewport-dependent bindings still require their independent scene check.
    const [, current] = await Promise.all([options.assertCurrent(), atomicQuery && !dependencies.some(dependency => dependency.id === `scene:${session.id}`)
      ? session : store.read(session.id, index.space.publication)]);
    signal.throwIfAborted();
    if (current.generation !== generation || current.revision !== session.revision) throw new Error('Manual interaction superseded this task.');
    if (dependencies.some(dependency => dependency.id === `scene:${session.id}` && current.viewport?.sceneRevision !== dependency.revision)) throw new Error('The viewport changed. Clarify the requested record.');
    if (call.capabilityId === 'research.lookup') retainVisitorConversationResearch(session, data);
    const query = session.queries.find(query => query.current.queryId === session.activeQueryId)?.current;
    const handle = retainEvidence(session, selected.descriptor.outputType, data, (call.capabilityId === 'prices.total' || call.capabilityId.startsWith('estimate.')) ? 'calculated' : ['research.lookup', 'research.recall', 'research.history'].includes(call.capabilityId) ? 'external' : selected.descriptor.effect === 'externalCommit' ? 'provider' : selected.descriptor.effect === 'read' ? 'publisher' : 'calculated', [...new Map([...dependencies, ...(query ? [{ id: query.queryId, revision: query.revision }] : []), ...(['selection.compare', 'artifact.compose'].includes(call.capabilityId) ? [{ id: session.selection.selectionId, revision: session.selection.revision }] : [])].map(dependency => [dependency.id, dependency])).values()]);
    if (selected.descriptor.effect !== 'read') { session.scene = null; session.viewport = null; }
    task = session.tasks.find(task => task.taskId === taskId)!;
    const step = task.steps.find(step => step.operationId === call.operationId)!;
    step.status = 'completed'; step.receipt = { id: randomUUID(), operationId: call.operationId, kind: selected.descriptor.effect === 'externalCommit' ? 'effect' : selected.descriptor.effect === 'externalDraft' ? 'draft' : 'result', status: 'confirmed', handle, observedAt: new Date().toISOString() };
    task.receipts.push(step.receipt); task.status = selected.descriptor.effect === 'read' ? 'completed' : 'awaitingDisplay';
    const view = buildVisitorTaskView(context, call.capabilityId === 'query.page' ? (input as { cursor: string | null }).cursor ?? undefined : undefined);
    if (selected.descriptor.outputType === 'comparison') view.comparison = data as VisitorTaskView['comparison'];
    if (selected.descriptor.outputType === 'detail') view.detail = data as VisitorTaskView['detail'];
    if (selected.descriptor.outputType === 'map') view.map = taskMapSchema.parse(data);
    view.operationId = call.operationId; view.revision = session.revision + 1;
    if (call.capabilityId === 'home') view.navigation = 'home';
    if (call.capabilityId === 'view.reset') view.navigation = 'reset';
    const surface = selected.descriptor.outputType === 'display' ? (data as { type: string }).type : selected.descriptor.outputType;
    view.focus = call.capabilityId === 'view.back' && session.presentation ? session.presentation.type : ['comparison', 'detail', 'research', 'map', 'artifact', 'clarification', 'records', 'links', 'estimate'].includes(surface) ? surface as VisitorTaskView['focus'] : ['demo-quote', 'demo-booking', 'demo-receipt', 'demo-cart', 'demo-slots'].includes(surface) ? surface.slice(5) as VisitorTaskView['focus'] : call.capabilityId.startsWith('demo.') ? 'business' : ['query', 'page', 'schema'].includes(surface) ? 'query' : undefined;
    if (Buffer.byteLength(JSON.stringify(view)) > 150_000) throw new Error('View exceeds the bounded page payload. Narrow the displayed fields.');
    const result = { view, handleId: handle.id, outputType: handle.type, data };
    const operation = session.operations.find(operation => operation.id === call.operationId)!; operation.status = 'completed'; operation.result = result;
    // Keep replay metadata but bound retained full result payloads.
    for (const old of session.operations.slice(0, -4)) if (old.status === 'completed' && old.id !== session.scene?.operationId) old.result = { expired: true };
    await store.save(session, session.revision); return result;
  } catch (error) {
    const current = await store.read(session.id, index.space.publication);
    const operation = current.operations.find(operation => operation.id === call.operationId);
    if (!operation) throw error; // A rejected atomic query never entered storage.
    operation.status = selected.descriptor.effect === 'externalCommit' ? 'reconciling' : 'failed';
    const task = current.tasks.find(task => task.taskId === taskId);
    if (task) { const step = task.steps.find(step => step.operationId === call.operationId)!; step.status = operation.status; task.status = operation.status === 'reconciling' ? 'reconciling' : signal.aborted || current.generation !== generation ? 'cancelled' : task.steps.some(step => step.status === 'completed') ? 'partiallyCompleted' : 'failed'; }
    await store.save(current, current.revision); throw error;
  }
}
export function buildVisitorTaskView(context: CapabilityContext, cursor?: string): VisitorTaskView {
  const { session, index } = context;
  const isActive = session.activeQueryId !== null;
  if (!session.queries.length) { createQuery(context); session.activeQueryId = null; }
  const history = session.queries.find(query => query.current.queryId === session.activeQueryId) ?? session.queries[0], query = history.current;
  const previousActive = session.activeQueryId; session.activeQueryId = query.queryId;
  cursor ??= session.page?.queryId === query.queryId && session.page.revision === query.revision ? session.page.cursor : undefined;
  const evaluated = resultStore.query(index, query, { sessionId: session.id, publication: session.publication, entitlement: 'public' }, { ...(cursor ? { cursor } : {}), facets: index.space.fields.filter(field => field.facet).slice(0, 4).map(field => field.id) });
  const result = queryResultSchema.strip().parse(evaluated);
  const scope = describeScope(index, query.scope, session.browse);
  const priority = [...query.order.map(term => term.fieldId), ...expressionNodes(query.where).flatMap(node => 'fieldId' in node ? [node.fieldId] : []), ...scope.fields.filter(field => field.type === 'money').map(field => field.id)];
  const cardFields = [...scope.fields].sort((a, b) => (priority.includes(a.id) ? priority.indexOf(a.id) : 100) - (priority.includes(b.id) ? priority.indexOf(b.id) : 100));
  const records = result.items.map(item => {
    const record = index.records.get(item.recordId)!;
    const memberships = index.space.memberships.filter(member => member.recordId === record.id);
    const group = memberships.map(member => index.space.collections.find(collection => collection.id === member.collectionId)!).sort((a, b) => (index.descendants.get(a.id)?.size ?? 0) - (index.descendants.get(b.id)?.size ?? 0))[0];
    return { ...(group ? { group: { id: group.id, name: group.name } } : {}), id: record.id, name: record.name, type: record.type, ...(record.media ? { media: record.media } : {}), summary: record.summary.slice(0, 320), code: item.code, values: cardFields.filter(field => projectField(context.index, record.id, field.id, active(context.session).current.asOf).state !== 'unknown').slice(0, 6).map(field => ({ fieldId: field.id, label: field.label, text: fieldText(context, record.id, field.id).slice(0, 240) })) };
  });
  session.activeQueryId = previousActive;
  const view: VisitorTaskView = { links: index.space.links, clarification: session.clarification, sessionId: session.id, revision: session.revision, generation: session.generation, active: isActive, query, queries: session.queries.map(query => ({ id: query.current.queryId, label: index.space.collections.find(collection => collection.id === query.current.scope.collectionId)!.name })),
    collection: scope.collection, children: scope.children, breadcrumbs: query.scope.path.map(id => ({ id, name: index.space.collections.find(collection => collection.id === id)!.name })),
    fields: scope.fields, result, records, selection: session.selection, selectedRecords: session.selection.members.flatMap(member => { const record = index.records.get(member.recordId); return record ? [{ id: record.id, name: record.name, type: record.type, summary: record.summary.slice(0, 320) }] : []; }),
    browse: session.browse, demoActions: getBackendMode() === 'demo', canUndo: history.past.length > 0, facets: evaluated.facets, alternatives: evaluated.alternatives, omittedChildren: scope.omittedChildren, omittedFields: scope.omittedFields, tasks: session.tasks.map(task => ({ id: task.taskId, status: task.status, completed: task.steps.filter(step => step.status === 'completed').length, total: task.steps.length })), artifactSummaries: session.artifacts.map(value => { const artifact = visitorArtifactSchema.parse(value); return { id: artifact.id, title: artifact.title, saved: artifact.saved }; }), artifacts: session.artifacts.filter(value => visitorArtifactSchema.parse(value).id === (session.activeArtifactId ?? visitorArtifactSchema.safeParse(session.artifacts.at(-1)).data?.id)), business: session.business };
  if (session.scene?.queryId === query.queryId && session.scene.queryRevision === query.revision && session.scene.resultSetId === result.resultSetId) view.operationId = session.scene.operationId;
  if (session.presentation?.type === 'records') view.lookupRecords = (outputSchemas.records.parse(session.presentation.data) as z.infer<typeof canonicalRecordSchema>[]).map(({ id, name, type, summary }) => ({ id, name, type, summary }));
  if (session.presentation?.type === 'links') view.links = outputSchemas.links.parse(session.presentation.data) as VisitorTaskView['links'];
  if (session.presentation?.type === 'research') { const result = exploreResultSchema.parse(session.presentation.data); view.research = { id: result.id, kind: result.kind, query: result.query, fetchedAt: result.fetchedAt, demo: result.demo, answer: result.answer, sources: result.sources, citations: result.citations, images: result.images, map: result.map }; }
  if (session.presentation?.type === 'estimate') view.estimate = publishedEstimateSchema.parse(session.presentation.data);
  if (session.presentation?.type === 'map') view.map = taskMapSchema.parse(session.presentation.data);
  if (session.presentation?.type === 'comparison') view.comparison = outputSchemas.comparison.parse(session.presentation.data) as VisitorTaskView['comparison'];
  if (session.presentation) view.focus = session.presentation.type;
  if (session.presentation?.type === 'detail') view.detail = outputSchemas.detail.parse(session.presentation.data) as VisitorTaskView['detail'];
  if (Buffer.byteLength(JSON.stringify(view)) > 150_000) throw new Error('View exceeds the bounded page payload. Narrow the displayed fields.');
  return view;
}
export async function acknowledgeTaskDisplay(store: VisitorTaskStore, sessionId: string, publication: QuerySpec['publication'], input: { generation?: number; operationId: string; queryId: string; queryRevision: number; resultSetId: string; sceneRevision: number; recordIds: string[] }) {
  const session = await store.read(sessionId, publication, { viewport: false }), operation = session.operations.find(operation => operation.id === input.operationId);
  const result = operation?.result as { view?: VisitorTaskView; outputType: string; data: unknown } | undefined, view = result?.view;
  const query = session.queries.find(query => query.current.queryId === input.queryId);
  const displayedIds = view ? displayedTaskRecordIds(view) : [];
  if (operation?.status !== 'completed' || !view || !query || query.current.revision !== input.queryRevision || view.query.queryId !== input.queryId || view.result.resultSetId !== input.resultSetId
    || input.generation !== undefined && input.generation !== session.generation || (view.active && session.activeQueryId !== input.queryId) || view.generation !== session.generation || input.recordIds.length > 48 || new Set(input.recordIds).size !== input.recordIds.length || input.recordIds.some(id => !displayedIds?.includes(id))) throw new Error('Display acknowledgment does not match the current result.');
  if (session.receipts.some(receipt => receipt.operationId === input.operationId && receipt.kind === 'display')) return session;
  if (result && ['comparison', 'detail', 'map'].includes(result.outputType)) session.presentation = { type: result.outputType as 'comparison' | 'detail' | 'map', data: outputSchemas[result.outputType].parse(result.data) };
  session.scene = { operationId: input.operationId, queryId: input.queryId, queryRevision: input.queryRevision, resultSetId: input.resultSetId, sceneRevision: input.sceneRevision, recordIds: input.recordIds };
  confirmVisitorView(session);
  retainTaskSurface(session, view);
  session.receipts.push({ id: randomUUID(), operationId: input.operationId, kind: 'display', status: 'confirmed', observedAt: new Date().toISOString(), display: { queryId: input.queryId, queryRevision: input.queryRevision, resultSetId: input.resultSetId, sceneRevision: input.sceneRevision } });
  for (const task of session.tasks) if (task.steps.some(step => step.operationId === input.operationId)) { task.receipts.push(session.receipts.at(-1)!); task.status = session.clarification && task.steps.some(step => step.operationId === input.operationId && step.capabilityId === 'task.clarify') ? 'needsClarification' : task.steps.every(step => step.status === 'completed') ? 'completed' : 'partiallyCompleted'; }
  return store.save(session, session.revision);
}

export async function observeTaskScene(store: VisitorTaskStore, sessionId: string, publication: QuerySpec['publication'], input: { operationId: string; queryId: string; queryRevision: number; resultSetId: string; sceneRevision: number; generation: number; recordIds: string[]; ready: boolean }) {
  const session = await store.read(sessionId, publication, { viewport: false }), base = session.scene;
  const view = (session.operations.find(operation => operation.id === input.operationId)?.result as { view?: VisitorTaskView } | undefined)?.view;
  const query = session.queries.find(value => value.current.queryId === session.activeQueryId)?.current;
  const allowed = new Set([...(view?.records.map(record => record.id) ?? []), ...(view?.comparison?.rows.map(record => record.id) ?? []), ...(view?.lookupRecords?.map(record => record.id) ?? []), ...(view?.detail ? [view.detail.record.id] : []), ...(view?.estimate?.lines.map(line => line.recordId) ?? [])]);
  if (!base || !view || input.operationId !== base.operationId || input.generation !== session.generation || input.queryId !== query?.queryId || input.queryRevision !== query.revision || input.resultSetId !== base.resultSetId || input.sceneRevision <= base.sceneRevision || input.recordIds.length > 48 || new Set(input.recordIds).size !== input.recordIds.length || input.recordIds.some(id => !allowed.has(id)) || !input.ready && input.recordIds.length) throw new Error('Viewport observation does not match the current displayed result.');
  await store.observeViewport(session, input);
}
