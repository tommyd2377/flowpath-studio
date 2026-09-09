import { respond } from '@/lib/http';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { getSite, uploadFile } from '@/lib/site-store';
import { readUpload } from '@/lib/file-validation';
import { recordPlatformEvent } from '@/lib/platform-events';

export const runtime = 'nodejs';
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId } = await params;
    await getSite(user, siteId);
    const { revision, file } = await readUpload(request);
    const site = await uploadFile(user, siteId, revision, file);
    await recordPlatformEvent(siteId, { type: 'upload', surface: 'preview', operationId: file.id, status: 'succeeded',
      ...(file.kind === 'pdf' ? { kind: 'pdf' as const } : file.kind === 'text' ? { kind: file.mime === 'text/csv' ? 'csv' as const : 'txt' as const } : {}) }).catch(() => undefined);
    return { site, fileId: file.id };
  });
}
