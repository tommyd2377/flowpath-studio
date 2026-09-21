import { z } from 'zod';
import { respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { getPublished } from '@/lib/site-store';
import { CatalogRepository } from '@/lib/catalog-repository';
import { websiteCatalogEntry } from '@/lib/website-catalog';
import { getPublishedMedia } from '@/lib/media-store';

export const dynamic = 'force-dynamic';
/** Ordinary paginated website browsing. No assistant session, task, or provider call. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return respond(async () => {
    const { slug } = await params, site = await getPublished(slug);
    if (!site?.content.catalogPublicationId) throw new AppError('Collection not found.', 404);
    const url = new URL(request.url), offset = z.coerce.number().int().min(0).max(10000).parse(url.searchParams.get('offset') ?? 0);
    const expected = url.searchParams.get('publicationId');
    if (expected && expected !== site.content.catalogPublicationId) throw new AppError('This website was updated. Reload to browse the current publication.', 409);
    const repository = new CatalogRepository(), index = await repository.index(site.siteId, site.content.catalogPublicationId);
    const id = url.searchParams.get('record');
    if (id && !index.records.has(id)) throw new AppError('Published item not found.', 404);
    const ids = [...index.records.keys()].sort((a, b) => index.records.get(a)!.name.localeCompare(index.records.get(b)!.name) || a.localeCompare(b));
    const records = id ? await repository.records(await repository.manifest(site.siteId, site.content.catalogPublicationId), [id]) : ids.slice(offset, offset + 24).map(id => index.records.get(id)!);
    const media = records.some(record => record.type === 'published-video') ? await getPublishedMedia(site.siteId, site.content.mediaRevisionId) : null;
    const asOf = new Date().toISOString();
    const entries = records.map(record => websiteCatalogEntry(record, index, { detail: Boolean(id), media, asOf }));
    return { publicationId: site.content.catalogPublicationId, section: { id: 'published-catalog', title: index.space.name, kind: 'collection', entries, paged: true, total: ids.length, offset }, next: offset + 24 < ids.length, entry: id ? entries[0] : undefined };
  });
}
