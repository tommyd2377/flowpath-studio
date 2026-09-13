import 'server-only';
import { adaptV1Catalog } from '@thevoice/platform-ui/collection-space';
import { compileQueryIndex, QueryIndexCache, queryHash } from './catalog-query-index';
import { getPublished } from './site-store';
import { getPublishedKnowledgeSnapshot } from './knowledge-store';
import { getPublishedMedia } from './media-store';
import { CatalogRepository } from './catalog-repository';
import { VisitorTaskStore } from './visitor-task-store';
import { AppError } from './errors';

const cache = new QueryIndexCache();
export async function visitorTaskContext(slug: string) {
  const site = await getPublished(slug);
  if (!site) throw new AppError('Published site not found.', 404);
  const repository = new CatalogRepository();
  const catalog = site.content.catalogPublicationId ? null : await getPublishedKnowledgeSnapshot(site.siteId, site.content.knowledgeRevisionId);
  if (!catalog && !site.content.catalogPublicationId) throw new AppError('This publication has no queryable collection.', 404);
  const publication = { siteId: site.siteId, revisionId: queryHash(site.content), indexRevision: site.content.catalogPublicationId ?? catalog!.id };
  const key = queryHash(publication); let index = cache.get(key);
  if (!index) {
    const space = site.content.catalogPublicationId ? (await repository.index(site.siteId, site.content.catalogPublicationId)).space : adaptV1Catalog(catalog!, publication, await getPublishedMedia(site.siteId, site.content.mediaRevisionId)).space;
    index = compileQueryIndex({ ...space, publication }); cache.set(key, index);
  }
  const records = async (ids: string[]) => {
    const current = await getPublished(slug);
    if (!current || queryHash(current.content) !== publication.revisionId) throw new AppError('Publication changed.', 409);
    if (site.content.catalogPublicationId) return repository.records(await repository.manifest(site.siteId, site.content.catalogPublicationId), ids);
    return ids.map(id => { const record = index!.records.get(id); if (!record) throw new AppError('Unavailable record.', 404); return record; });
  };
  return { site, index, store: new VisitorTaskStore(), publication, records };
}
