import { getBackendMode } from './firebase/config';
import { visitorDiagnostic } from './visitor-diagnostics';
import 'server-only';
import { adaptV1Catalog, addPublishedMedia, validatePublicationSpace } from '@thevoice/platform-ui/collection-space';
import { compileQueryIndex, QueryIndexCache, queryHash } from './catalog-query-index';
import { getPublished } from './site-store';
import { getPublishedKnowledgeSnapshot } from './knowledge-store';
import { getPublishedMedia } from './media-store';
import { CatalogRepository, type CatalogManifest } from './catalog-repository';
import { VisitorTaskStore } from './visitor-task-store';
import { presentationSources } from './site-presentation';
import { AppError } from './errors';

const cache = new QueryIndexCache();
const repositories = new Map<string, CatalogRepository>();
function preparedRepository() {
  const storage = getBackendMode() === 'demo' ? `demo:${process.env.VOICE_DATA_DIR ?? process.cwd()}` : 'firebase';
  let repository = repositories.get(storage);
  if (!repository) { repository = new CatalogRepository(undefined, undefined, true); if (repositories.size >= 8) repositories.delete(repositories.keys().next().value!); repositories.set(storage, repository); }
  return { storage, repository };
}
const stored = new WeakMap<ReturnType<typeof compileQueryIndex>, { ids: Set<string>; manifest: CatalogManifest }>();
export async function visitorTaskContext(slug: string, traceId?: string) {
  const started = performance.now();
  const site = await getPublished(slug);
  if (!site) throw new AppError('Published site not found.', 404);
  const { storage, repository } = preparedRepository();
  const publication = { siteId: site.siteId, revisionId: queryHash(site.content), indexRevision: site.content.catalogPublicationId ?? site.content.knowledgeRevisionId ?? queryHash(site.content) };
  const key = queryHash([storage, publication]);
  const hit = Boolean(cache.get(key));
  if (traceId) visitorDiagnostic({ traceId, channel: 'server', stage: 'cache', status: 'observed', cacheHit: hit });
  const index = await cache.prepare(key, async () => {
    const catalog = site.content.catalogPublicationId ? null : await getPublishedKnowledgeSnapshot(site.siteId, site.content.knowledgeRevisionId);
    const media = await getPublishedMedia(site.siteId, site.content.mediaRevisionId);
    let space = site.content.catalogPublicationId ? structuredClone((await repository.index(site.siteId, site.content.catalogPublicationId)).space) : catalog ? adaptV1Catalog(catalog, publication, media).space : validatePublicationSpace({ version: 2, publication, name: site.content.name, rootId: 'publication-root', fields: [], relationshipTypes: [], collections: [{ id: 'publication-root', name: site.content.name, introduction: site.content.description.slice(0, 1600), kind: 'explicit', view: 'grid' }], edges: [], records: [], memberships: [], relationships: [], links: [] });
    const storedIds = new Set(space.records.map(record => record.id));
    if (!catalog && media) space = addPublishedMedia(space, media);
    const sources = presentationSources(site.content);
    let sourceCollection = 'published-information'; while (space.collections.some(collection => collection.id === sourceCollection)) sourceCollection += '-source';
    space.collections.push({ id: sourceCollection, name: 'Website information', introduction: '', kind: 'explicit', view: 'list' }); space.edges.push({ parentId: space.rootId, childId: sourceCollection });
    const used = new Set(space.records.map(record => record.id));
    for (const [ordinal, source] of sources.entries()) {
      let id = `published-source-${ordinal}`; while (used.has(id)) id += '-source'; used.add(id);
      space.records.push({ id, type: 'published-information', name: source.title, summary: source.body.slice(0, 1600), aliases: [source.id], assertions: [], blocks: [{ id: 'published-text', kind: 'paragraph', text: source.body }] });
      space.memberships.push({ collectionId: sourceCollection, recordId: id });
    }
    const index = compileQueryIndex({ ...space, publication });
    if (site.content.catalogPublicationId) await repository.indexReading(site.siteId, site.content.catalogPublicationId, index);
    if (site.content.catalogPublicationId) stored.set(index, { ids: storedIds, manifest: await repository.manifest(site.siteId, site.content.catalogPublicationId) });
    return index;
  });
  if (!hit) { const fresh = await getPublished(slug); if (!fresh || queryHash(fresh.content) !== publication.revisionId) throw new AppError('Publication changed.', 409); }
  if (traceId) visitorDiagnostic({ traceId, channel: 'server', stage: 'retrieval', status: 'succeeded', durationMs: performance.now() - started, cacheHit: hit });
  const records = async (ids: string[]) => {
    if (ids.length > 48) throw new AppError('Excessive record references.', 400);
    const current = await getPublished(slug);
    if (!current || queryHash(current.content) !== publication.revisionId) throw new AppError('Publication changed.', 409);
    if (site.content.catalogPublicationId) {
      const published = stored.get(index)!;
      const records = new Map((await repository.records(published.manifest, ids.filter(id => published.ids.has(id)))).map(record => [record.id, record]));
      return ids.map(id => { const record = records.get(id) ?? index.records.get(id); if (!record) throw new AppError('Unavailable record.', 404); return record; });
    }
    return ids.map(id => { const record = index!.records.get(id); if (!record) throw new AppError('Unavailable record.', 404); return record; });
  };
  return { site, index, store: new VisitorTaskStore(), publication, records };
}
