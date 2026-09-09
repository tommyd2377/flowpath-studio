import { assertSameOrigin } from '@/lib/firebase/session';
import { getPublished, slugSchema } from '@/lib/site-store';
import { getPublishedMedia } from '@/lib/media-store';
import { getPublishedKnowledge } from '@/lib/knowledge-store';
import { readJson, respond } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { platformEventBatchSchema, recordPlatformEvents } from '@/lib/platform-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ slug: string }> };
const globalTraffic = globalThis as typeof globalThis & { platformEventTraffic?: { until: number; count: number } };

export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    assertSameOrigin(request);
    const now = Date.now();
    if (!globalTraffic.platformEventTraffic || globalTraffic.platformEventTraffic.until <= now) globalTraffic.platformEventTraffic = { until: now + 60000, count: 0 };
    if (++globalTraffic.platformEventTraffic.count > 120) throw new AppError('Too many activity requests. Please wait a minute.', 429);
    const slug = slugSchema.parse((await params).slug);
    const { events } = platformEventBatchSchema.parse(await readJson(request));
    const site = await getPublished(slug);
    if (!site) throw new AppError('Site not found.', 404);
    const catalog = await getPublishedKnowledge(site.siteId, site.content.knowledgeRevisionId);
    const media = events.some(event => event.kind === 'photo_view') ? await getPublishedMedia(site.siteId, site.content.mediaRevisionId) : null;
    for (const event of events) {
      if (event.usage !== undefined || event.count !== undefined || event.status && event.status !== 'observed') throw new AppError('Client activity cannot supply measured provider usage or operation status.');
      if (event.kind === 'photo_view') {
        if (event.type !== 'outcome' || event.surface !== 'public' || !media || event.snapshotId !== media.id || !event.assetId || !media.assets.some(asset => asset.id === event.assetId) || event.entityId || event.capabilityId) throw new AppError('This published photo is no longer available.', 409);
        continue;
      }
      if (!catalog || event.assetId) throw new AppError('This site has no matching published catalog event.', 409);
      if (event.surface !== 'public' || event.snapshotId !== catalog.id) throw new AppError('The published catalog changed. Reload the site.', 409);
      if (!['presentation_accepted', 'presentation_rejected', 'outcome'].includes(event.type)
        || event.kind && !['display', 'selection', 'link_click'].includes(event.kind)) throw new AppError('Unsupported visitor event.');
      if (event.entityId && !catalog.entities.some(entity => entity.id === event.entityId)) throw new AppError('Unknown catalog item.');
      if (event.capabilityId && !catalog.capabilities?.some(capability => capability.id === event.capabilityId
        && (!capability.entityIds.length || Boolean(event.entityId && capability.entityIds.includes(event.entityId))))) throw new AppError('Unknown catalog action.');
      if (event.kind === 'selection' && !event.entityId || event.kind === 'link_click' && !event.capabilityId) throw new AppError('A visitor event requires its catalog reference.');
      if (event.type === 'outcome' && !event.kind) throw new AppError('Choose a specific observed outcome.');
    }
    // Client-observed display, selection and link clicks never claim an external conversion.
    await recordPlatformEvents(site.siteId, events.map(event => ({ ...event, status: 'observed' })), 'visitor_client');
    return { accepted: true };
  });
}
