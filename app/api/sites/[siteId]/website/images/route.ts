import { z } from 'zod';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { getSite, uploadFile } from '@/lib/site-store';
import { clientSite } from '@/lib/local-store';
import { AppError } from '@/lib/errors';
import { readJson, respond } from '@/lib/http';
import { prepareWebsiteImage } from '@/lib/website-images';

export const runtime = 'nodejs';
const command = z.object({ url: z.string().max(2048), pageUrl: z.string().max(2048), imageUrl: z.string().max(2048), preview: z.boolean().optional(), revision: z.number().int().positive() }).strict();
export async function POST(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request), { siteId } = await params;
    const site = await getSite(user, siteId), input = command.parse(await readJson(request));
    if (site.revision !== input.revision) throw new AppError('Your draft changed. Reload before importing images.', 409);
    const file = await prepareWebsiteImage(input.url, input.pageUrl, input.imageUrl);
    if (input.preview) return { thumbnail: `data:image/webp;base64,${file.thumbnailData}` };
    const current = await getSite(user, siteId);
    if (current.revision !== input.revision) throw new AppError('Your draft changed while the image was downloading. Reload before continuing.', 409);
    const duplicate = current.files.find(existing => existing.kind === 'image' && existing.image?.hash === file.image?.hash);
    if (duplicate) return { site: clientSite(current), fileId: duplicate.id, duplicate: true };
    return { site: await uploadFile(user, siteId, input.revision, file), fileId: file.id, duplicate: false };
  });
}
