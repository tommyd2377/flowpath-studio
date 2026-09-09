import { readJson, respond } from '@/lib/http';
import { requireWorkspaceUser } from '@/lib/firebase/session';
import { clientSite } from '@/lib/local-store';
import { getSite, modifySite } from '@/lib/site-store';
import { applyCommand, commandSchema } from '@/lib/site-commands';
import { editWithChat } from '@/lib/chat-editor';
import { readKnowledgeArtifact, stagePublicKnowledge } from '@/lib/knowledge-store';
import { validateOpening } from '@/lib/site-opening';
import { recordPlatformEvent } from '@/lib/platform-events';
import { readMediaLibrary, stagePublicMedia } from '@/lib/media-store';
import { validateMediaLibrary } from '@thevoice/platform-ui/media';
import { assertLaunchPublication } from '@/lib/launch-billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ siteId: string }> };
export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId } = await params;
    return { site: clientSite(await getSite(user, siteId)) };
  });
}
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId } = await params;
    const command = commandSchema.parse(await readJson(request));
    if (command.action === 'publish') {
      const current = await getSite(user, siteId);
      await assertLaunchPublication(user, siteId);
      const catalog = current.draft.knowledgeRevisionId ? (await readKnowledgeArtifact(user, siteId, current.draft.knowledgeRevisionId)).catalog : null;
      validateOpening(current.draft, catalog);
      if (current.draft.knowledgeRevisionId) await stagePublicKnowledge(user, siteId, current.draft.knowledgeRevisionId);
      if (current.draft.mediaRevisionId) {
        const media = await readMediaLibrary(user, siteId, current.draft.mediaRevisionId);
        validateMediaLibrary(media, { entityIds: catalog?.entities.map(item => item.id) ?? [], sectionIds: current.draft.sections.map(item => item.id) });
        await stagePublicMedia(user, siteId, current.draft.mediaRevisionId);
      }
    }
    const site = command.action === 'chat' ? await editWithChat(user, siteId, command)
      : await modifySite(user, siteId, command.revision, site => applyCommand(site, command));
    if (command.action === 'publish') await recordPlatformEvent(siteId, { type: 'publication', surface: 'public', operation: 'publish', status: 'succeeded', snapshotId: site.published?.knowledgeRevisionId }).catch(() => undefined);
    return { site };
  });
}
