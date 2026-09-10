import { z } from 'zod';
import { exploreCommandSchema, exploreSettings, type ExploreKind, type ExploreContext } from './explore-model';
import type { SiteContent } from './site-model';
import { AppError } from './errors';

export const exploreVoiceInput = z.object({
  kind: z.enum(['web', 'images', 'map', 'open_image', 'back', 'gallery', 'sources', 'zoom_in', 'zoom_out']),
  query: z.string().trim().min(1).max(2000).nullable(), id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).nullable(),
}).strict();
const parameters = z.toJSONSchema(exploreVoiceInput); delete parameters.$schema;
export const exploreVoiceTool = { type: 'function', name: 'search_explore',
  description: 'Search the external web, find web images, or show an approximate interactive map. Use open_image with an exact displayed image ID; back, gallery, sources, zoom_in and zoom_out change existing search views without another search. query is required only for web/images/map, otherwise null. id is required only for open_image, otherwise null. Ask when a photo reference is ambiguous. Wait for the browser to apply the result before claiming it is displayed.', parameters };
export function validateExploreVoice(value: unknown, content: SiteContent, context?: ExploreContext) {
  const input = exploreVoiceInput.parse(value);
  const settings = exploreSettings(content);
  if (!settings.enabled) throw new AppError('Search is not enabled on this site.', 403);
  if (['web', 'images', 'map'].includes(input.kind)) {
    if (!input.query || input.id !== null || input.kind === 'images' && !settings.images || input.kind === 'map' && !settings.maps) throw new AppError('That search capability is not available.', 403);
    return { search: { query: input.query, kind: input.kind as ExploreKind } };
  }
  if (!context || input.query !== null || input.kind !== 'open_image' && input.id !== null) throw new AppError('There is no matching search view.', 400);
  if (input.kind === 'open_image' && (!settings.images || !context.images.some(image => image.id === input.id))) throw new AppError('That image is not in the current results.', 400);
  const command = exploreCommandSchema.parse({ kind: input.kind === 'gallery' ? 'images' : input.kind === 'sources' ? 'web' : input.kind, ...(input.kind === 'open_image' ? { id: input.id } : {}) });
  return { command };
}
