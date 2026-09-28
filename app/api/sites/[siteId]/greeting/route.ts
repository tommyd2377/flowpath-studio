import { z } from 'zod';
import { taskIdSchema } from '@thevoice/platform-ui/query';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { getSite } from '@/lib/site-store';
import { CatalogRepository } from '@/lib/catalog-repository';
import { greetingRecordTopic } from '@/lib/greeting-records';
import { selectedGreetingRecords } from '@/lib/greeting-record-store';
import { selectGreetingEditorialTopics } from '@/lib/greeting-topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const querySchema = z.object({ revisionId: z.string().uuid(), selected: z.string().max(302).optional(), selectedOnly: z.enum(['true', 'false']).default('false') }).strict();

export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request), { siteId } = await params;
    const site = await getSite(user, siteId), input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (input.revisionId !== site.draft.catalogPublicationId) throw new AppError('The introduction source changed. Reload the draft to choose current topics.', 409);
    const selectedIds = input.selected === undefined ? (site.draft.greetingPoints ?? []).flatMap(point => point?.kind === 'record' ? [point.id] : [])
      : z.array(taskIdSchema).max(3).parse(input.selected ? input.selected.split(',') : []);
    const repository = new CatalogRepository(), manifest = await repository.manifest(siteId, input.revisionId);
    // The interactive draft preview needs at most three topics, not a full index.
    if (input.selectedOnly === 'true') return { revisionId: manifest.id, selected: await selectedGreetingRecords(repository, manifest, selectedIds) };
    const index = await repository.index(siteId, manifest.id);
    const topics = selectGreetingEditorialTopics([...index.records.values()].map(record => ({ id: record.id, title: record.name, kind: record.type, body: record.summary })));
    const [records, selected] = await Promise.all([repository.records(manifest, topics.map(topic => topic.id)), selectedGreetingRecords(repository, manifest, selectedIds)]);
    return { revisionId: manifest.id, topics: records.map(record => ({ ...greetingRecordTopic(record, manifest.metadata.fields), kind: record.type })), selected };
  });
}
