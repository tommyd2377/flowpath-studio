import { assertLocal, respond } from '@/lib/http';
import { getBackendMode } from '@/lib/firebase/config';
import { downloadPublishedFile } from '@/lib/site-store';
import { fileResponse } from '@/lib/file-validation';

export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; fileId: string }> }) {
  let result: Response | undefined;
  const errorResponse = await respond(async () => {
    if (getBackendMode() === 'demo') assertLocal(request);
    const { slug, fileId } = await params;
    const size = new URL(request.url).searchParams.get('size') === 'thumb' ? 'thumb' : 'display';
    const { file, bytes } = await downloadPublishedFile(slug, fileId, size);
    result = fileResponse(file, bytes);
    return {};
  });
  return result ?? errorResponse;
}
