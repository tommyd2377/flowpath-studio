import { z } from 'zod';
import { annotationTargetForObject, exploreCommandSchema, exploreSettings, type ExploreKind, type ExploreContext } from './explore-model';
import type { WorkspaceState } from '@thevoice/platform-ui/workspace';
import type { SiteContent } from './site-model';
import { AppError } from './errors';

export const exploreVoiceInput = z.object({
  kind: z.enum(['web', 'images', 'map', 'annotate', 'open_image', 'open_source', 'back', 'gallery', 'sources', 'zoom_in', 'zoom_out']),
  query: z.string().trim().min(1).max(2000).nullable(), id: z.string().regex(/^[a-zA-Z0-9_:-]{1,100}$/).nullable(),
}).strict();
const parameters = z.toJSONSchema(exploreVoiceInput); delete parameters.$schema;
export const exploreVoiceTool = { type: 'function', name: 'search_explore',
  description: 'Search the external web, find web images, or show an approximate interactive map. The map operation only selects a viewport; it does not retrieve or verify an address. Retrieve missing requested facts through web search first, then use the returned location in the map query. Do not substitute a map overview for an unanswered factual request. When publisher-enabled, annotate adds cited web context INSIDE one open published card: id must be its workspace instanceId and query the requested topic. For open_image/open_source use an exact current result item ID; back, gallery, sources, zoom_in/out navigate existing results without another search. query is required only for web/images/map/annotate, otherwise null. id is required only for annotate/open_image/open_source, otherwise null. Resolve numbers and stable grid codes from currentView.explore only; clarify ambiguity. Wait for browser applied before claiming display.', parameters };
export function validateExploreVoice(value: unknown, content: SiteContent, context?: ExploreContext, workspace?: WorkspaceState) {
  const input = exploreVoiceInput.parse(value);
  const settings = exploreSettings(content);
  if (!settings.enabled) throw new AppError('Search is not enabled on this site.', 403);
  if (input.kind === 'annotate') {
    const target = workspace && input.id ? annotationTargetForObject(workspace, input.id) : undefined;
    if (!settings.annotations || !target || !input.query) throw new AppError('Choose an open published card and enable web additions before requesting web context.', 403);
    return { search: { query: input.query, kind: 'web' as ExploreKind, annotationTarget: target } };
  }
  if (['web', 'images', 'map'].includes(input.kind)) {
    if (!input.query || input.id !== null || input.kind === 'images' && !settings.images || input.kind === 'map' && !settings.maps) throw new AppError('That search capability is not available.', 403);
    return { search: { query: input.query, kind: input.kind as ExploreKind, annotationTarget: undefined } };
  }
  if (!context || input.query !== null || !['open_image', 'open_source'].includes(input.kind) && input.id !== null) throw new AppError('There is no matching search view.', 400);
  if (input.kind === 'open_image' && (!settings.images || !context.images.some(image => image.id === input.id))) throw new AppError('That image is not in the current results.', 400);
  if (input.kind === 'open_source' && !context.sources?.some(source => source.id === input.id)) throw new AppError('That source is not in the current results.', 400);
  const command = exploreCommandSchema.parse({ kind: input.kind === 'gallery' ? 'images' : input.kind === 'sources' ? 'web' : input.kind, ...(['open_image', 'open_source'].includes(input.kind) ? { id: input.id } : {}) });
  return { command };
}
