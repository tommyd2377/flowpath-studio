import { requireWorkspaceUser } from '@/lib/firebase/session';
import { readMediaLibrary } from '@/lib/media-store';
import { getSite } from '@/lib/site-store';
import { readJson, respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { platformEventBatchSchema, readPlatformEventSummary, recordPlatformEvents } from '@/lib/platform-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ siteId: string }> };

export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId } = await params;
    await getSite(user, siteId);
    return { activity: await readPlatformEventSummary(siteId) };
  });
}

export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    const user = await requireWorkspaceUser(request);
    const { siteId } = await params;
    const site = await getSite(user, siteId);
    const { events } = platformEventBatchSchema.parse(await readJson(request));
    for (const event of events) {
      if (event.surface !== 'preview' || !['studio_visit', 'preview', 'approval', 'visitor_intent', 'presentation_accepted', 'presentation_rejected', 'outcome'].includes(event.type)) throw new AppError('Unsupported preview event.');
      if (event.usage !== undefined || event.count !== undefined || event.status && event.status !== 'observed') throw new AppError('Client activity cannot supply measured provider usage or operation status.');
      if (event.kind === 'photo_view') {
        if (!event.snapshotId || ![site.draft.mediaRevisionId, site.published?.mediaRevisionId].includes(event.snapshotId) || event.type !== 'outcome' || !event.assetId || event.entityId || event.capabilityId) throw new AppError('Unknown preview photo.');
        const media = await readMediaLibrary(user, siteId, event.snapshotId);
        if (!media.assets.some(asset => asset.id === event.assetId)) throw new AppError('Unknown preview photo.');
      } else if (event.assetId) throw new AppError('Photo references require a photo view event.');
      if (event.snapshotId && ![site.draft.knowledgeRevisionId, site.published?.knowledgeRevisionId, site.draft.mediaRevisionId, site.published?.mediaRevisionId].includes(event.snapshotId)) throw new AppError('This preview has changed. Refresh the site.', 409);
    }
    await recordPlatformEvents(siteId, events.map(event => ({ ...event, status: 'observed' })), 'owner_client');
    return { accepted: true };
  });
}
