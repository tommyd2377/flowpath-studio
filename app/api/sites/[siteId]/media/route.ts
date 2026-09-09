import { z } from 'zod';
import { respond, readLimitedBody } from '@/lib/http';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { getSite } from '@/lib/site-store';
import { retainedMediaReferences } from '@/lib/local-store';
import { readMediaLibrary, saveMediaLibrary } from '@/lib/media-store';
import { AppError } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ siteId: string }> };
export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request); const { siteId } = await params;
    const site = await getSite(user, siteId);
    const requested = new URL(request.url).searchParams.get('revisionId');
    if (requested && !retainedMediaReferences(site).includes(z.string().uuid().parse(requested))) throw new AppError('Media revision not found.', 404);
    const revisionId = requested ?? site.draft.mediaRevisionId;
    return { library: revisionId ? await readMediaLibrary(user, siteId, revisionId) : null };
  });
}
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request); const { siteId } = await params;
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 600_000))); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('Invalid JSON.'); }
    const input = z.object({ revision: z.number().int().positive(), library: z.unknown() }).strict().parse(value);
    return saveMediaLibrary(user, siteId, input.revision, input.library);
  });
}
