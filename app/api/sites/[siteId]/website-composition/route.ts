import { requireWorkspaceUser } from '@/lib/firebase/session';
import { AppError } from '@/lib/errors';
import { readLimitedBody, respond } from '@/lib/http';
import { proposeSiteWebsiteComposition } from '@/lib/website-composition-provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    let input: unknown;
    try { input = JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 1024))); }
    catch (error) { if (error instanceof AppError) throw error; throw new AppError('Invalid JSON.'); }
    return proposeSiteWebsiteComposition(user, (await params).siteId, input, request.signal);
  });
}
