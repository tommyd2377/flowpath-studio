import 'server-only';
import { retrieveKnowledge, type KnowledgeQuery } from '@thevoice/platform-ui/knowledge';
import { getPublishedKnowledgeSnapshot } from './knowledge-store';
import { getPublishedMedia } from './media-store';
import { AppError } from './errors';

/** Publication authorization is rechecked by each store. The caller supplies
 * the site's current media revision, never an upload or arbitrary library. */
export async function retrievePublishedKnowledge(siteId: string, query: KnowledgeQuery, mediaRevisionId?: string) {
  const catalog = await getPublishedKnowledgeSnapshot(siteId, query.revisionId);
  if (!catalog) throw new AppError('This site has no published knowledge.', 404);
  const media = mediaRevisionId ? await getPublishedMedia(siteId, mediaRevisionId) : null;
  return retrieveKnowledge(catalog, query, media);
}
