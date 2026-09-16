import { z } from 'zod';
import { respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { getPublished } from '@/lib/site-store';
import { CatalogRepository } from '@/lib/catalog-repository';
import { projectField } from '@/lib/catalog-query';
import type { WebsiteEntry } from '@thevoice/platform-ui';
import type { TypedValue } from '@thevoice/platform-ui/query';

const displayValue = (value: TypedValue | null) => value ? `${Array.isArray(value.value) ? value.value.join(', ') : String(value.value)}${value.currency ? ` ${value.currency}` : value.unit ? ` ${value.unit}` : ''}${value.basis ? ` / ${value.basis}` : ''}` : 'Unknown';

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
    const entries: WebsiteEntry[] = records.map(record => ({ id: `catalog:${record.id}`, recordId: record.id, name: record.name, body: record.summary,
      ...(id ? { blocks: record.blocks.filter(block => block.kind === 'paragraph' || block.kind === 'heading').map(block => ({ ...block, kind: block.kind as 'paragraph' | 'heading' })) } : {}),
      ...(record.media ? { imageAssetId: record.media.assetId, example: record.media.role === 'example' } : {}),
      eyebrow: index.space.memberships.filter(member => member.recordId === record.id).map(member => index.space.collections.find(collection => collection.id === member.collectionId)?.name).find(Boolean),
      values: index.space.fields.flatMap(field => {
        const result = projectField(index, record.id, field.id, new Date().toISOString());
        if (!result.assertionIds.length) return [];
        const assertions = (index.assertions.get(record.id)?.get(field.id) ?? []).filter(fact => result.assertionIds.includes(fact.id));
        const detail = assertions.map(fact => `${fact.polarity === 'denied' ? 'Not asserted: ' : ''}${displayValue(fact.value)}${fact.conditions.length ? ` — ${fact.conditions.join('; ')}` : ''}${fact.validFrom ? ` · from ${fact.validFrom}` : ''}${fact.validTo ? ` · until ${fact.validTo}` : ''}`).join('. ');
        return [{ label: field.label, text: result.state === 'known' ? displayValue(result.value) : result.state === 'stale' ? 'Unknown at this time' : `${result.state === 'conflicting' ? 'Conflicting approved assertions' : result.state === 'conditional' ? 'Conditions apply' : 'Unknown'}${detail ? `. ${detail}` : ''}` }];
      }).slice(0, id ? 64 : 4),
    }));
    return { publicationId: site.content.catalogPublicationId, section: { id: 'published-catalog', title: index.space.name, kind: 'collection', entries, paged: true, total: ids.length, offset }, next: offset + 24 < ids.length, entry: id ? entries[0] : undefined };
  });
}
