import { z } from 'zod';
import { MAX_PCM_BYTES } from './visitor-model';
import { catalogFilterSchema, presentationPlanSchema } from '@thevoice/platform-ui/contracts';
import { presentationSchema } from './site-presentation';
import { exploreContextSchema } from './explore-model';
import { workspaceStateSchema, workspaceSceneSchema } from '@thevoice/platform-ui/workspace';

export const visitorHistorySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) }).strict()).max(8).default([]);
export type VisitorHistory = z.infer<typeof visitorHistorySchema>;
export const visitorCatalogStateSchema = z.object({ snapshotId: z.string().max(100), filters: z.array(catalogFilterSchema).max(24),
  selectedIds: z.array(z.string().max(100)).max(6), focusedId: z.string().max(100).nullable(),
  focusedRef: z.object({ kind: z.enum(['entity', 'photo']), id: z.string().max(100) }).nullable().default(null),
  focusOrigin: z.object({ reference: z.object({ kind: z.enum(['entity', 'photo']), id: z.string().max(100) }).strict(), surface: z.enum(['collection', 'gallery']), focusKey: z.string().max(160), scrollTop: z.number().int().min(0).max(10000000) }).nullable().default(null),
  entityIds: z.array(z.string().max(100)).max(100) }).strict();
const ids = z.array(z.string().min(1).max(100)).max(100);
export const visitorScreenSchema = z.object({
  viewportWidth: z.number().int().min(0).max(20000), viewportHeight: z.number().int().min(0).max(20000),
  scrollY: z.number().int().min(0).max(10000000), documentHeight: z.number().int().min(0).max(10000000),
  visibleEntityIds: ids, visibleSourceIds: ids,
  fullyVisibleEntityIds: ids.default([]), expandedEntityIds: ids.default([]),
  primaryEntityId: z.string().min(1).max(100).nullable().default(null),
  visibleComponentTypes: z.array(z.enum(['collection', 'criteria', 'detail', 'comparison', 'selection', 'relationships', 'actions', 'gallery'])).max(8),
  visibleControls: z.array(z.string().trim().min(1).max(160)).max(60).default([]),
  focusedEntityId: z.string().min(1).max(100).nullable(), focusedSourceId: z.string().min(1).max(100).nullable(),
}).strict();
export const visitorContextSchema = z.object({
  workspace: workspaceStateSchema.optional(), scene: workspaceSceneSchema.optional(), externalResults: z.array(exploreContextSchema).max(6).optional(),
  explore: exploreContextSchema.optional(),
  catalogState: visitorCatalogStateSchema.optional(), catalogPlan: presentationPlanSchema.optional(), presentation: presentationSchema.optional(),
  expandedSourceIds: ids.optional(), screen: visitorScreenSchema.optional(),
}).strict();
export type VisitorContext = z.infer<typeof visitorContextSchema>;

const common = {
  requestId: z.string().uuid(),
  history: visitorHistorySchema,
  catalogState: visitorCatalogStateSchema.optional(), context: visitorContextSchema.optional(),
};
export const visitorRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('chat'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...common, kind: z.literal('voice'), audio: z.string().min(6400).max(Math.ceil(MAX_PCM_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ ...common, kind: z.literal('greeting') }).strict(),
]);
export type VisitorRequest = z.infer<typeof visitorRequestSchema>;
