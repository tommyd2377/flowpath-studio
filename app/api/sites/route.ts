import { readJson, respond } from '@/lib/http';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { listSites, newSite, newSiteSchema } from '@/lib/site-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return respond(async () => ({ sites: await listSites(await requireWorkspaceUser(request)) }));
}
export async function POST(request: Request) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const input = newSiteSchema.parse(await readJson(request));
    return { site: await newSite(user, input) };
  });
}
