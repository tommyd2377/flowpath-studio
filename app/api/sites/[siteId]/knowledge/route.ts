import { z } from 'zod';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { readLimitedBody, respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { getKnowledgeState, analyzeKnowledge, analyzeKnowledgeUrl, reviewDraftKnowledge, reviseKnowledge, resolveKnowledge, resolveKnowledgeIdentityReview, reviewKnowledgeAssertions, correctKnowledge, applyKnowledge, discardKnowledge, removeKnowledge } from '@/lib/ingestion';
import { assertionDecisionSchema, catalogForPublication } from '@/lib/knowledge-assertions';
import { getSite } from '@/lib/site-store';
import { readKnowledgeArtifact } from '@/lib/knowledge-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ siteId: string }> };
const uuid = z.string().uuid();
const revision = z.number().int().positive();
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('analyze'), fileId: uuid, revision, requestId: uuid, replacesSourceKey: z.string().min(1).max(255).optional() }).strict(),
  z.object({ action: z.literal('analyze-url'), url: z.string().url().max(2048), revision, requestId: uuid, replacesSourceKey: z.string().min(1).max(255).optional() }).strict(),
  z.object({ action: z.literal('review'), revision, requestId: uuid }).strict(),
  z.object({ action: z.literal('revise'), candidateId: uuid, revision, catalog: z.unknown() }).strict(),
  z.object({ action: z.literal('resolve'), candidateId: uuid, candidateRevisionId: uuid, revision,
    decisions: z.array(z.object({ id: z.string().min(1).max(80), choice: z.enum(['keep', 'incoming']) }).strict()).min(1).max(2700) }).strict(),
  z.object({ action: z.literal('identity'), candidateId: uuid, candidateRevisionId: uuid, revision,
    decisions: z.array(z.object({ id: z.string().min(1).max(80), action: z.enum(['approve', 'reject', 'alias']), alias: z.string().trim().min(1).max(160).optional() }).strict()).min(1).max(500) }).strict(),
  z.object({ action: z.literal('assertions'), candidateId: uuid, candidateRevisionId: uuid, revision, decisions: z.array(assertionDecisionSchema).min(1).max(4900) }).strict(),
  z.object({ action: z.literal('correct'), candidateId: uuid, revision, text: z.string().trim().min(1).max(2000), requestId: uuid }).strict(),
  z.object({ action: z.literal('apply'), candidateId: uuid, revision, candidateRevisionId: uuid.optional() }).strict(),
  z.object({ action: z.literal('discard'), candidateId: uuid, revision }).strict(),
  z.object({ action: z.literal('remove'), revision }).strict(),
]);

export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request); const { siteId } = await params;
    const revisionId = new URL(request.url).searchParams.get('revisionId');
    if (!revisionId) return getKnowledgeState(user, siteId);
    uuid.parse(revisionId);
    const site = await getSite(user, siteId);
    if (revisionId !== site.draft.knowledgeRevisionId && revisionId !== site.published?.knowledgeRevisionId) throw new AppError('Knowledge revision not found.', 404);
    return { catalog: catalogForPublication(await readKnowledgeArtifact(user, siteId, revisionId)) };
  });
}
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request); const { siteId } = await params;
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 400_000))); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('Invalid JSON.'); }
    const action = command.parse(input);
    if (action.action === 'analyze') return analyzeKnowledge(user, siteId, action);
    if (action.action === 'analyze-url') return analyzeKnowledgeUrl(user, siteId, action);
    if (action.action === 'review') return reviewDraftKnowledge(user, siteId, action);
    if (action.action === 'revise') return reviseKnowledge(user, siteId, action);
    if (action.action === 'resolve') return resolveKnowledge(user, siteId, action);
    if (action.action === 'identity') return resolveKnowledgeIdentityReview(user, siteId, action);
    if (action.action === 'assertions') return reviewKnowledgeAssertions(user, siteId, action);
    if (action.action === 'correct') return correctKnowledge(user, siteId, action);
    if (action.action === 'apply') return applyKnowledge(user, siteId, action);
    if (action.action === 'discard') return discardKnowledge(user, siteId, action.candidateId);
    return removeKnowledge(user, siteId, action.revision);
  });
}
