import { z } from 'zod';
import { validatePlan, type KnowledgeCatalog } from '@thevoice/platform-ui/contracts';
import type { MediaLibrary } from '@thevoice/platform-ui/media';
import { visitorContextSchema, type VisitorContext } from './visitor-request';
import { presentationSources, validatePresentation } from './site-presentation';
import { validateCatalogState } from './catalog-presentation';
import type { SiteContent } from './site-model';
import { AppError } from './errors';
import { annotationMatches, exploreCommandSchema, exploreResultSchema, exploreSettings } from './explore-model';
import { validateWorkspace, workspaceBatchSchema, workspaceRecord, referenceKey } from '@thevoice/platform-ui/workspace';
import { publishedWorkspace } from './visitor-workspace';
import { visitorTaskViewSchema } from '@thevoice/platform-ui/task-view';
import { carouselNavigationSchema } from './visitor-carousel-control';

export { visitorScreenSchema, visitorContextSchema, visitorHistorySchema } from './visitor-request';
export type { VisitorContext, VisitorHistory } from './visitor-request';
export const visitorControlSchema = z.object({
  seq: z.number().int().min(1).max(1000), interactionRevision: z.number().int().min(0).max(1000),
  viewRevision: z.number().int().min(0).max(1000).default(0),
  navigationAck: z.object({ id: z.string().min(1).max(200), status: z.enum(['applied', 'failed', 'cancelled', 'unavailable']) }).strict().optional(),
  planAck: z.object({ revision: z.number().int().min(0).max(1000), status: z.enum(['applied', 'failed', 'cancelled']) }).strict().optional(),
  preparationAck: z.object({ revision: z.number().int().min(1).max(1000), status: z.enum(['applied', 'failed', 'cancelled']) }).strict().optional(),
  audio: z.object({ inputActive: z.boolean(), outputActive: z.boolean() }).strict().optional(),
  ready: z.boolean(), end: z.boolean().optional(), context: visitorContextSchema,
}).strict();
export type VisitorControlUpdate = z.infer<typeof visitorControlSchema>;
export const visitorControlCapabilitySchema = z.object({ id: z.string().uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export type VisitorControlCapability = z.infer<typeof visitorControlCapabilitySchema>;
export const visitorNavigationSchema = z.discriminatedUnion('kind', [
  carouselNavigationSchema.extend({ kind: z.literal('carousel') }).strict(),
  z.object({ kind: z.literal('answer'), text: z.string().max(8000), relationship: z.enum(['related', 'new-subject']).optional(), placement: z.literal('supporting').optional() }).strict(),
  z.object({ kind: z.literal('task'), view: visitorTaskViewSchema }).strict(),
  z.object({ kind: z.literal('workspace'), batch: workspaceBatchSchema }).strict(),
  z.object({ kind: z.literal('explore'), result: exploreResultSchema.optional(), command: exploreCommandSchema.optional() }).strict().refine(value => Boolean(value.result) !== Boolean(value.command), 'Supply one search view or command.'),
  z.object({ kind: z.enum(['open', 'focus', 'expand', 'spotlight']), id: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.enum(['close', 'collapse']), id: z.string().min(1).max(100).optional() }).strict(),
  z.object({ kind: z.literal('compare'), ids: z.array(z.string().min(1).max(100)).min(2).max(6) }).strict(),
  z.object({ kind: z.enum(['home', 'browse', 'clear', 'back', 'unfocus', 'up', 'down', 'next_section', 'previous_section']) }).strict(),
  z.object({ kind: z.literal('top') }).strict(), z.object({ kind: z.literal('bottom') }).strict(),
  z.object({ kind: z.literal('entity'), id: z.string().min(1).max(100) }).strict(),
  z.object({ kind: z.literal('source'), id: z.string().min(1).max(100) }).strict(),
]);

/** Screen data is a bounded hint, never an authority for facts or actions. */
export function validateVisitorContext(value: unknown, content: SiteContent, catalog?: KnowledgeCatalog, media?: MediaLibrary, tenantId?: string): VisitorContext {
  try {
    const context = visitorContextSchema.parse(value ?? {});
    if (context.surface) {
      const authority = publishedWorkspace(content, catalog, media, context.externalResults);
      if (context.surface.publicationId !== authority.publicationId || tenantId && context.surface.tenantId !== tenantId) throw new Error();
      if (context.surface.regions.filter(region => region.role === 'primary').length !== 1 || new Set(context.surface.regions.map(region => region.id)).size !== context.surface.regions.length) throw new Error();
      for (const region of context.surface.regions) {
        const known = region.referenceIds.flatMap(id => authority.records.filter(record => record.reference.id === id || referenceKey(record.reference) === id));
        if (known.length) region.title = known.map(record => record.name).join(' / ').slice(0, 200);
        if (region.referenceIds.length && !known.length && !context.taskSession) throw new Error();
      }
      delete context.screen; delete context.expandedSourceIds;
    }
    if (context.carousel) {
      const authority = publishedWorkspace(content, catalog, media, context.externalResults);
      for (const card of [...context.carousel.cards, ...context.carousel.recentCards ?? []]) {
        const known = card.referenceIds.flatMap(id => authority.records.filter(record => referenceKey(record.reference) === id || record.reference.id === id));
        if (known.length) card.title = known.map(record => record.name).join(' / ').slice(0, 200);
        else if (card.referenceIds.length && !context.taskSession) throw new Error();
      }
      if (context.carousel.media && !media?.videos?.some(video => video.id === context.carousel!.media!.id)) throw new Error();
      // The carousel replaces page observation; never carry a stale background snapshot.
      delete context.screen; delete context.expandedSourceIds;
    }
    if (context.externalResults) {
      const settings = exploreSettings(content);
      if (!settings.enabled || new Set(context.externalResults.map(result => result.resultId)).size !== context.externalResults.length
        || context.externalResults.some(result => result.kind === 'images' && !settings.images || result.map && !settings.maps
          || !settings.images && result.images.length || new Set(result.images.map(image => image.id)).size !== result.images.length
          || result.annotationTarget && (!settings.annotations || !context.workspace || !annotationMatches(result.annotationTarget, context.workspace))
          || result.selectedSourceId && !result.sources?.some(source => source.id === result.selectedSourceId)
          || result.selectedImageId && !result.images.some(image => image.id === result.selectedImageId))) throw new Error();
    }
    if (context.workspace) {
      const authority = publishedWorkspace(content, catalog, media, context.externalResults);
      context.workspace = validateWorkspace(context.workspace, authority);
      // Local idempotency history does not belong in provider context.
      context.workspace.receipts = [];
      if (context.scene) {
        const scene = context.scene;
        if (scene.browseItems?.some((item, index) => item.order !== index + 1 || !workspaceRecord(authority, item.reference)) || new Set(scene.browseItems?.map(item => referenceKey(item.reference))).size !== (scene.browseItems?.length ?? 0)) throw new Error();
        if (scene.highlightedReference && !workspaceRecord(authority, scene.highlightedReference)) throw new Error();
        if (scene.workspaceRevision !== context.workspace.revision || scene.focusedId !== context.workspace.focusedId
          || scene.objects.length !== context.workspace.objects.length || new Set(scene.objects.map(object => object.instanceId)).size !== scene.objects.length) throw new Error();
        if (scene.keyboardFocusId && !context.workspace.objects.some(object => object.instanceId === scene.keyboardFocusId)) throw new Error();
        if (scene.objects.reduce((sum, object) => sum + (object.items?.length ?? 0), 0) > 24) throw new Error();
        for (const [index, object] of scene.objects.entries()) {
          const expected = context.workspace.objects[index];
          if (object.instanceId !== expected.instanceId || object.order !== index + 1 || object.expanded !== expected.expanded || object.selected !== expected.selected
            || JSON.stringify(object.references.map(referenceKey)) !== JSON.stringify(expected.references.map(referenceKey))) throw new Error();
          // Browser labels are not accepted as factual authority. Enrich from approved records.
          object.name = `${expected.component === 'map' ? 'Map · ' : expected.component === 'comparison' ? 'Compare · ' : ''}${expected.references.map(ref => workspaceRecord(authority, ref)!.name).join(' / ')}`.slice(0, 160);
          object.sections = expected.expanded ? ['Published facts and related context'] : [];
          const members = expected.references.flatMap(ref => { const record = workspaceRecord(authority, ref)!; return record.members ?? [record.reference]; });
          for (const item of object.items ?? []) {
            const relatedPhoto = item.reference.kind === 'photo' && media?.associations.some(link => link.assetId === item.reference.id && expected.references.some(ref =>
              ref.kind === 'entity' && link.targetType === 'entity' && ref.id === link.targetId || ref.kind === 'source' && link.targetType === 'section' && ref.id === `section:${link.targetId}`));
            if (!workspaceRecord(authority, item.reference) || !members.some(ref => referenceKey(ref) === referenceKey(item.reference)) && !relatedPhoto) throw new Error();
          }
        }
        if (scene.modal && (!workspaceRecord(authority, scene.modal.reference) || scene.modal.kind === 'photo' && (scene.modal.reference.kind !== 'photo' || scene.modal.selectedId !== scene.modal.reference.id))) throw new Error();
        if (scene.modal?.kind === 'external' && !context.externalResults?.some(result => result.resultId === scene.modal!.reference.id && (result.images.some(image => image.id === scene.modal!.selectedId) || result.sources?.some(source => source.id === scene.modal!.selectedId)))) throw new Error();
      }
    } else if (context.scene) throw new Error();
    if (context.explore) {
      const settings = exploreSettings(content);
      if (context.explore.annotationTarget && (!settings.annotations || !context.workspace || !annotationMatches(context.explore.annotationTarget, context.workspace))
        || context.explore.selectedSourceId && !context.explore.sources?.some(source => source.id === context.explore!.selectedSourceId)
        || !settings.enabled || context.explore.kind === 'images' && !settings.images || context.explore.map && !settings.maps
        || !settings.images && context.explore.images.length || new Set(context.explore.images.map(image => image.id)).size !== context.explore.images.length
        || context.explore.selectedImageId && !context.explore.images.some(image => image.id === context.explore!.selectedImageId)) throw new Error();
    }
    if (!catalog && (context.catalogState || context.catalogPlan)) throw new Error();
    if (catalog && context.catalogState) context.catalogState = validateCatalogState(context.catalogState, catalog, media);
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
