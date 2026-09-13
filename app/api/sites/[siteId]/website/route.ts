import { z } from 'zod';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { getSite } from '@/lib/site-store';
import { AppError } from '@/lib/errors';
import { readLimitedBody, respond } from '@/lib/http';
import { discoverWebsite } from '@/lib/website-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const command = z.object({ url: z.string().trim().min(1).max(2048), revision: z.number().int().positive() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request), { siteId } = await params;
    const site = await getSite(user, siteId);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    const input = command.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 4096))));
    if (site.revision !== input.revision) throw new AppError('Your draft changed. Reload before discovering pages.', 409);
    return discoverWebsite(input.url);
  });
}
