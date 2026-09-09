import { requireWorkspaceUser } from '@/lib/firebase/session';
import { readJson, respond } from '@/lib/http';
import { changeLaunchBilling, readLaunchBilling } from '@/lib/launch-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ siteId: string }> };
export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    return { billing: await readLaunchBilling(user, (await params).siteId) };
  });
}
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    return changeLaunchBilling(user, (await params).siteId, await readJson(request));
  });
}
