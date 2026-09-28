import { capabilityDefinitionSchema, type CapabilityDefinition } from './contracts.js';
import type { ExternalSearchResult } from './ExternalSearchResults.js';
import type { CanonicalRecord, SpaceCollection } from './collection-space.js';
import type { FieldDescriptor, QueryResult, QuerySpec, SelectionState } from './query.js';
import { z } from 'zod';
import { canonicalRecordSchema, spaceCollectionSchema } from './collection-space.js';
import { fieldDescriptorSchema, queryResultSchema, querySpecSchema, selectionStateSchema } from './query.js';
import { publishedEstimateSchema, type PublishedEstimate } from './estimate.js';

export type TaskRecordCard = Pick<CanonicalRecord, 'id' | 'name' | 'type' | 'summary'> & { media?: CanonicalRecord['media']; group?: { id: string; name: string }; code: string; values: { fieldId: string; label: string; text: string }[] };
export type VisitorTaskView = {
  navigation?: 'home' | 'reset';
  clarification?: { question: string; options: string[] } | null;
  focus?: 'query' | 'comparison' | 'detail' | 'research' | 'map' | 'artifact' | 'business' | 'clarification' | 'quote' | 'booking' | 'receipt' | 'cart' | 'slots' | 'records' | 'links' | 'estimate';
  sessionId: string; revision: number; generation: number; active: boolean; query: QuerySpec;
  queries: { id: string; label: string }[]; collection: SpaceCollection; children: SpaceCollection[]; breadcrumbs: { id: string; name: string }[];
  fields: FieldDescriptor[]; result: QueryResult; records: TaskRecordCard[]; selection: SelectionState; selectedRecords: Pick<CanonicalRecord, 'id' | 'name' | 'type' | 'summary'>[];
  facets?: { fieldId: string; values: { value: string | number | boolean; count: number }[]; unknown: number; coverage: 'complete' | 'partial' }[]; alternatives?: { removeNodeId: string; count: number }[]; omittedChildren?: number; omittedFields?: number; tasks?: { id: string; status: string; completed: number; total: number }[];
  browse?: { children: number; fields: number }; demoActions?: boolean; canUndo: boolean; operationId?: string; comparison?: { fields: FieldDescriptor[]; rows: { id: string; name: string; values: { fieldId: string; text: string }[] }[] };
  detail?: { priceOptions?: { fieldId: string; label: string; text: string }[]; nextBlockOffset?: number | null; nextFieldOffset?: number | null; blockOffset?: number; fieldOffset?: number; record: CanonicalRecord; values: { fieldId: string; label: string; text: string }[] };
  lookupRecords?: Pick<CanonicalRecord, 'id' | 'name' | 'type' | 'summary'>[];
  links?: CapabilityDefinition[];
  research?: ExternalSearchResult;
  estimate?: PublishedEstimate;
  map?: { label: string; latitude: number; longitude: number; zoom: number; approximate: true; demo: boolean; sources: { title: string; url: string }[] };
  artifactSummaries?: { id: string; title: string; saved: boolean }[]; artifacts: unknown[]; business: Record<string, unknown>;
};
const researchSourceSchema = z.object({ title: z.string().max(300), url: z.string().url() }).strict();
const researchSchema = z.object({ id: z.string().max(100), kind: z.enum(['web', 'images', 'map']), query: z.string().max(2000), fetchedAt: z.string(), demo: z.boolean(), answer: z.string().max(12000), sources: z.array(researchSourceSchema).max(20), citations: z.array(researchSourceSchema.extend({ start: z.number().int(), end: z.number().int() }).strict()).max(40), images: z.array(z.object({ id: z.string().max(100), url: z.string().max(2000), thumbnail: z.string().max(2000), sourceUrl: z.string().url(), caption: z.string().max(500) }).strict()).max(24), map: z.object({ label: z.string().max(160), latitude: z.number().min(-80).max(80), longitude: z.number().min(-180).max(180), zoom: z.number().min(2).max(12) }).strict().nullable() }).strict();
const valueSchema = z.object({ fieldId: z.string().max(100), label: z.string().max(160), text: z.string().max(4000) }).strict();
const summarySchema = canonicalRecordSchema.pick({ id: true, name: true, type: true, summary: true });
export const visitorTaskViewSchema: z.ZodType<VisitorTaskView> = z.object({
  navigation: z.enum(['home', 'reset']).optional(),
  clarification: z.object({ question: z.string().max(500), options: z.array(z.string().max(160)).max(4) }).strict().nullable().optional(),
  focus: z.enum(['query', 'comparison', 'detail', 'research', 'map', 'artifact', 'business', 'clarification', 'quote', 'booking', 'receipt', 'cart', 'slots', 'records', 'links', 'estimate']).optional(),
  sessionId: z.string().uuid(), revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), active: z.boolean(), query: querySpecSchema,
  queries: z.array(z.object({ id: z.string().max(100), label: z.string().max(160) }).strict()).max(8), collection: spaceCollectionSchema, children: z.array(spaceCollectionSchema).max(24),
  breadcrumbs: z.array(z.object({ id: z.string().max(100), name: z.string().max(180) }).strict()).max(9), fields: z.array(fieldDescriptorSchema).max(32),
  result: queryResultSchema, records: z.array(summarySchema.extend({ media: canonicalRecordSchema.shape.media, group: z.object({ id: z.string().max(100), name: z.string().max(180) }).strict().optional(), code: z.string().max(20), values: z.array(valueSchema).max(6) }).strict()).max(48),
  facets: z.array(z.object({ fieldId: z.string(), values: z.array(z.object({ value: z.union([z.string(), z.number(), z.boolean()]), count: z.number().int() }).strict()).max(64), unknown: z.number().int(), coverage: z.enum(['complete', 'partial']) }).strict()).max(8).optional(), alternatives: z.array(z.object({ removeNodeId: z.string(), count: z.number().int() }).strict()).max(24).optional(), omittedChildren: z.number().int().nonnegative().optional(), omittedFields: z.number().int().nonnegative().optional(), tasks: z.array(z.object({ id: z.string(), status: z.string(), completed: z.number().int(), total: z.number().int() }).strict()).max(8).optional(),
  selection: selectionStateSchema, selectedRecords: z.array(summarySchema).max(100), browse: z.object({ children: z.number().int(), fields: z.number().int() }).strict().optional(), demoActions: z.boolean().optional(), canUndo: z.boolean(), operationId: z.string().uuid().optional(),
  comparison: z.object({ fields: z.array(fieldDescriptorSchema).max(16), rows: z.array(z.object({ id: z.string().max(100), name: z.string().max(180), values: z.array(valueSchema.omit({ label: true })).max(16) }).strict()).max(6) }).strict().optional(),
  links: z.array(capabilityDefinitionSchema).max(20).optional(),
  research: researchSchema.optional(),
  estimate: publishedEstimateSchema.optional(),
  lookupRecords: z.array(summarySchema).max(48).optional(),
  map: z.object({ label: z.string().max(160), latitude: z.number().min(-80).max(80), longitude: z.number().min(-180).max(180), zoom: z.number().int().min(2).max(12), approximate: z.literal(true), demo: z.boolean(), sources: z.array(z.object({ title: z.string().max(300), url: z.string().url() }).strict()).max(20) }).strict().optional(),
  artifactSummaries: z.array(z.object({ id: z.string(), title: z.string().max(160), saved: z.boolean() }).strict()).max(12).optional(),
  detail: z.object({ priceOptions: z.array(z.object({ fieldId: z.string().max(100), label: z.string().max(160), text: z.string().max(160) }).strict()).max(16).optional(), nextBlockOffset: z.number().int().nullable().optional(), nextFieldOffset: z.number().int().nullable().optional(), blockOffset: z.number().int().optional(), fieldOffset: z.number().int().optional(), record: canonicalRecordSchema, values: z.array(valueSchema).max(64) }).strict().optional(), artifacts: z.array(z.unknown()).max(12), business: z.record(z.string(), z.unknown()),
}).strict();

/** Record visibility is scoped to the current task presentation, not adjacent regions. */
export function displayedTaskRecordIds(view: VisitorTaskView): string[] {
  if (!view.active || view.focus === 'clarification') return [];
  if (view.focus === 'detail') return view.detail ? [view.detail.record.id] : [];
  if (view.focus === 'estimate') return [...new Set(view.estimate?.lines.map(line => line.recordId) ?? [])];
  if (view.focus === 'comparison') return view.comparison?.rows.map(row => row.id) ?? [];
  if (view.focus === 'records') return view.lookupRecords?.map(record => record.id) ?? [];
  return view.records.map(record => record.id);
}
