import { z } from 'zod';
import { validatePlan, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { visitorContextSchema, type VisitorContext } from './visitor-request';
import { presentationSources, validatePresentation } from './site-presentation';
import { validateCatalogState } from './catalog-presentation';
import type { SiteContent } from './site-model';
import { AppError } from './errors';
import { exploreCommandSchema, exploreResultSchema, exploreSettings } from './explore-model';

export { visitorScreenSchema, visitorContextSchema, visitorHistorySchema } from './visitor-request';
export type { VisitorContext, VisitorHistory } from './visitor-request';
export const visitorControlSchema = z.object({
  seq: z.number().int().min(1).max(1000), interactionRevision: z.number().int().min(0).max(1000),
  viewRevision: z.number().int().min(0).max(1000).default(0),
  navigationAck: z.object({ id: z.string().min(1).max(200), status: z.enum(['applied', 'unavailable']) }).strict().optional(),
  ready: z.boolean(), end: z.boolean().optional(), context: visitorContextSchema,
}).strict();
export type VisitorControlUpdate = z.infer<typeof visitorControlSchema>;
export const visitorControlCapabilitySchema = z.object({ id: z.string().uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export type VisitorControlCapability = z.infer<typeof visitorControlCapabilitySchema>;
export const visitorNavigationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('explore'), result: exploreResultSchema.optional(), command: exploreCommandSchema.optional() }).strict().refine(value => Boolean(value.result) !== Boolean(value.command), 'Supply one search view or command.'),
  z.object({ kind: z.enum(['open', 'expand', 'spotlight']), id: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('compare'), ids: z.array(z.string().min(1).max(100)).min(2).max(6) }).strict(),
  z.object({ kind: z.enum(['back', 'collapse', 'up', 'down', 'next_section', 'previous_section']) }).strict(),
  z.object({ kind: z.literal('top') }).strict(), z.object({ kind: z.literal('bottom') }).strict(),
  z.object({ kind: z.literal('entity'), id: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('source'), id: z.string().min(1).max(100) }).strict(),
]);

/** Screen data is a bounded hint, never an authority for facts or actions. */
export function validateVisitorContext(value: unknown, content: SiteContent, catalog?: KnowledgeCatalog, media?: MediaLibrary): VisitorContext {
  try {
    const context = visitorContextSchema.parse(value ?? {});
    if (context.explore) {
      const settings = exploreSettings(content);
      if (!settings.enabled || context.explore.kind === 'images' && !settings.images || context.explore.map && !settings.maps
        || !settings.images && context.explore.images.length || new Set(context.explore.images.map(image => image.id)).size !== context.explore.images.length
        || context.explore.selectedImageId && !context.explore.images.some(image => image.id === context.explore!.selectedImageId)) throw new Error();
    }
    if (!catalog && (context.catalogState || context.catalogPlan)) throw new Error();
    if (catalog && context.catalogState) context.catalogState = validateCatalogState(context.catalogState, catalog);
    if (catalog && context.catalogPlan) context.catalogPlan = validatePlan(context.catalogPlan, catalog, catalog.id, media);
    if (context.presentation) context.presentation = validatePresentation(context.presentation, content, media);
    const entityIds = new Set(catalog?.entities.map(entity => entity.id) ?? []);
    const sourceIds = new Set(presentationSources(content, media).map(source => source.id));
    const known = (values: string[], allowed: Set<string>) => new Set(values).size === values.length && values.every(id => allowed.has(id));
    if (!known(context.expandedSourceIds ?? [], sourceIds)) throw new Error();
    if (context.screen) {
      const screen = context.screen;
      if (!known(screen.fullyVisibleEntityIds, entityIds) || !known(screen.expandedEntityIds, entityIds)
        || screen.primaryEntityId !== null && !entityIds.has(screen.primaryEntityId)
        || !known(screen.visibleEntityIds, entityIds) || !known(screen.visibleSourceIds, sourceIds)
        || screen.focusedEntityId !== null && !entityIds.has(screen.focusedEntityId)
        || screen.focusedSourceId !== null && !sourceIds.has(screen.focusedSourceId)) throw new Error();
    }
    return context;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('The current view is no longer valid. Reload to continue.', 400);
  }
}
