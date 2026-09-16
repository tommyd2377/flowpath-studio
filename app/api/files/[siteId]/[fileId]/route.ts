import { respond } from '@/lib/http';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { downloadFile } from '@/lib/site-store';
import { fileResponse } from '@/lib/file-validation';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ siteId: string; fileId: string }> }) {
  let result: Response | undefined;
  const errorResponse = await respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId, fileId } = await params;
    const size = new URL(request.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'display';
    const { file, bytes } = await downloadFile(user, siteId, fileId, size);
    result = fileResponse(file, bytes, request.headers.get('range'));
    return {};
  });
  return result ?? errorResponse;
}
