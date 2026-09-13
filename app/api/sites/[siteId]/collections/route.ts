import { z } from 'zod';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { readLimitedBody, respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { getSite, modifySite } from '@/lib/site-store';
import { updateDraft } from '@/lib/local-store';
import { CatalogRepository, catalogImportChunkSchema, catalogMetadataSchema } from '@/lib/catalog-repository';
import { readMediaLibrary } from '@/lib/media-store';
import { readKnowledgeArtifact } from '@/lib/knowledge-store';
import { typedValueSchema } from '@thevoice/platform-ui/query';
import { adaptV1Catalog, canonicalRecordSchema } from '@thevoice/platform-ui/collection-space';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const identity = { reviewId: z.string().uuid(), revision: z.number().int().nonnegative() };
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin'), siteRevision: z.number().int().positive(), metadata: catalogMetadataSchema, previousReviewId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('migrate'), siteRevision: z.number().int().positive(), previousReviewId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal('append'), ...identity, chunk: catalogImportChunkSchema }).strict(),
  z.object({ action: z.literal('finish'), ...identity }).strict(),
  z.object({ action: z.literal('review'), reviewId: z.string().uuid(), offset: z.number().int().min(0).max(10000).default(0) }).strict(),
  z.object({ action: z.literal('edit'), ...identity, patch: z.object({ id: z.string(), name: z.string().min(1).max(180).optional(), summary: z.string().max(1600).optional(), assertion: z.object({ id: z.string(), value: typedValueSchema.nullable() }).strict().optional() }).strict().optional(), record: canonicalRecordSchema.optional(), metadata: catalogMetadataSchema.optional(), membership: z.object({ collectionId: z.string(), recordId: z.string(), included: z.boolean() }).strict().optional() }).strict(),
  z.object({ action: z.literal('apply'), ...identity, siteRevision: z.number().int().positive() }).strict(),
]);
export async function GET(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => { const user = await requireWorkspaceUser(request), { siteId } = await params, site = await getSite(user, siteId); const repository = new CatalogRepository(), latest = await repository.latest(siteId); if (latest) return latest; if (!site.draft.catalogPublicationId) return { review: null }; const manifest = await repository.manifest(siteId, site.draft.catalogPublicationId); return manifest.reviewId ? repository.reviewPage(siteId, manifest.reviewId) : { review: null }; });
}
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request), { siteId } = await params;
    const site = await getSite(user, siteId);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    let raw: unknown; try { raw = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 600_000))); } catch (error) { if (error instanceof AppError) throw error; throw new AppError('Invalid import JSON.'); }
    const input = schema.parse(raw), repository = new CatalogRepository();
    try {
      if (input.action === 'begin' || input.action === 'migrate') {
        if (input.siteRevision !== site.revision) throw new AppError('The draft changed. Reload before importing.', 409);
        if (input.action === 'begin') return { review: await repository.begin(siteId, site.revision, input.metadata, input.previousReviewId) };
        if (!site.draft.knowledgeRevisionId) throw new AppError('Review and apply source knowledge first.');
        const { catalog } = await readKnowledgeArtifact(user, siteId, site.draft.knowledgeRevisionId);
        const { space } = adaptV1Catalog(catalog, { siteId, revisionId: site.draft.knowledgeRevisionId, indexRevision: site.draft.knowledgeRevisionId }, site.draft.mediaRevisionId ? await readMediaLibrary(user, siteId, site.draft.mediaRevisionId) : null);
        const previous = input.previousReviewId ? await repository.review(siteId, input.previousReviewId) : (await repository.latest(siteId))?.review;
        if (previous && ['importing', 'applying'].includes(previous.status)) throw new AppError('Finish the current collection import or Apply before refreshing source knowledge.', 409);
        const previousReviewId = previous?.id ?? (site.draft.catalogPublicationId ? (await repository.manifest(siteId, site.draft.catalogPublicationId)).reviewId : undefined);
        let review = await repository.begin(siteId, site.revision, catalogMetadataSchema.strip().parse(space), previousReviewId);
        for (let offset = 0; offset < space.records.length; offset += 100) { const records = space.records.slice(offset, offset + 100), ids = new Set(records.map(record => record.id)); review = await repository.append(siteId, review.id, review.revision, { records, memberships: space.memberships.filter(member => ids.has(member.recordId)), relationships: offset === 0 ? space.relationships : [] }); }
        review = await repository.finish(siteId, review.id, review.revision);
        return repository.reviewPage(siteId, review.id);
      }
      if (input.action === 'append') return { review: await repository.append(siteId, input.reviewId, input.revision, input.chunk) };
      if (input.action === 'finish') { await repository.finish(siteId, input.reviewId, input.revision); return repository.reviewPage(siteId, input.reviewId); }
      if (input.action === 'review') return repository.reviewPage(siteId, input.reviewId, input.offset);
      if (input.action === 'edit') { await repository.edit(siteId, input.reviewId, input.revision, input); return repository.reviewPage(siteId, input.reviewId); }
      let review = await repository.review(siteId, input.reviewId);
      if (site.draft.catalogPublicationId === review.manifestId && ['applying', 'applied'].includes(review.status)) return { site, review: review.status === 'applying' ? await repository.markApplied(siteId, review.id, review.revision) : review };
      if ((review.revision !== input.revision && !(review.status === 'applying' && review.revision === input.revision + 1)) || !['review', 'applying'].includes(review.status) || !review.manifestId || review.baseSiteRevision !== site.revision || input.siteRevision !== site.revision) throw new AppError('The review or draft changed. Start a fresh review.', 409);
      if (review.status === 'review') review = await repository.claimApply(siteId, review.id, review.revision);
      await repository.verify(siteId, review.manifestId!);
      const changed = await modifySite(user, siteId, site.revision, current => updateDraft(current, { ...current.draft, catalogPublicationId: review.manifestId }));
      await repository.markApplied(siteId, review.id, review.revision);
      return { site: changed, review: await repository.review(siteId, review.id) };
    } catch (error) { if (error instanceof AppError || error instanceof z.ZodError) throw error; throw new AppError(error instanceof Error ? error.message : 'Collection review could not finish.', 409); }
  });
}
