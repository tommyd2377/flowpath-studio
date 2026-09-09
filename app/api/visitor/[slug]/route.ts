import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { readLimitedBody } from '@/lib/http';
import { assertSameOrigin } from '@/lib/firebase/session';
import { slugSchema } from '@/lib/site-store';
import { visitorAccess } from '@/lib/visitor-store';
import { VisitorAttemptError } from '@/lib/visitor-quota';
import { visitorRequestSchema } from '@/lib/visitor-request';
import { visitorTextReply, visitorVoiceReply } from '@/lib/visitor-provider';
import { demoVisitorReply, MAX_PCM_BYTES } from '@/lib/visitor-model';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { demoPresentation, presentationSummary } from '@/lib/site-presentation';
import { getPublishedMedia } from '@/lib/media-store';
import { getPublishedKnowledge } from '@/lib/knowledge-store';
import { validateCatalogState } from '@/lib/catalog-presentation';
import { recordPlatformEvent } from '@/lib/platform-events';
import { planForIntent } from '@thevoice/platform-ui/interaction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const globals = globalThis as typeof globalThis & { visitorTraffic?: { until: number; count: number } };
function guard(request: Request) {
  assertSameOrigin(request);
  const now = Date.now();
  if (!globals.visitorTraffic || globals.visitorTraffic.until <= now) globals.visitorTraffic = { until: now + 60_000, count: 0 };
  if (++globals.visitorTraffic.count > 120) throw new AppError('Too many requests. Please wait a minute.', 429);
}
async function respond(operation: () => Promise<object>) {
  try { return Response.json(await operation(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    const status = error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 502;
    return Response.json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'Check the message or recording and try again.' : 'The assistant is temporarily unavailable.',
      ...(error instanceof VisitorAttemptError ? { availability: error.availability } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
type Context = { params: Promise<{ slug: string }> };
export async function GET(request: Request, { params }: Context) {
  return respond(async () => {
    guard(request);
    const slug = slugSchema.parse((await params).slug);
    return { availability: (await visitorAccess(slug)).availability };
  });
}
export async function POST(request: Request, { params }: Context) {
  return respond(async () => {
    guard(request);
    const slug = slugSchema.parse((await params).slug);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    const bytes = await readLimitedBody(request, 1_400_000);
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError('Invalid JSON.'); }
    const input = visitorRequestSchema.parse(raw);
    if (input.kind === 'voice') {
      const audio = Buffer.from(input.audio, 'base64');
      if (audio.length < 9600 || audio.length > MAX_PCM_BYTES || audio.length % 2) throw new AppError('Record between 0.2 and 20 seconds of audio.');
    }
    if (request.signal.aborted) throw new AppError('Request cancelled.', 499);
    // Validate client state against the published snapshot before reserving an attempt.
    const preview = await visitorAccess(slug);
    const catalog = await getPublishedKnowledge(preview.siteId, preview.content.knowledgeRevisionId);
    const media = await getPublishedMedia(preview.siteId, preview.content.mediaRevisionId);
    if (catalog) input.catalogState = validateCatalogState(input.catalogState, catalog);
    else if (input.catalogState) throw new AppError('This site changed. Reload to use the current published information.', 409);
    const { content, siteId, availability } = await visitorAccess(slug, { requestId: input.requestId, kind: input.kind === 'chat' ? 'chat' : 'voice', greeting: input.kind === 'greeting' });
    const observed = { surface: 'public' as const, requestId: input.requestId, snapshotId: content.knowledgeRevisionId, kind: input.kind === 'chat' ? 'chat' as const : 'voice' as const };
    try {
      if (content.knowledgeRevisionId !== preview.content.knowledgeRevisionId || content.mediaRevisionId !== preview.content.mediaRevisionId) throw new AppError('The published catalog changed during this request. Reload to continue.', 409);
      await recordPlatformEvent(siteId, { ...observed, type: 'visitor_intent', status: 'started' }).catch(() => undefined);
      if (!availability.live) {
        if (input.kind === 'greeting') return { text: getWelcomeMessage(content), demo: true, availability };
        if (catalog) return { text: 'Explore the published items below.', catalogPlan: planForIntent(catalog, input.kind === 'chat' ? input.text : '', input.catalogState, media ?? undefined), demo: true, availability };
        const presentation = demoPresentation(content, input.kind === 'chat' ? input.text : '', input.history, media);
        return { text: input.kind === 'chat' ? presentationSummary(presentation, content, media) : demoVisitorReply(content, ''), presentation, demo: true, availability };
      }
      await recordPlatformEvent(siteId, { ...observed, type: 'provider_usage', status: 'reserved', count: 1 }).catch(() => undefined);
      const reply = input.kind === 'chat' ? await visitorTextReply(content, input, request.signal, catalog ?? undefined, media ?? undefined) : await visitorVoiceReply(content, input, request.signal, catalog ?? undefined, media ?? undefined);
      await recordPlatformEvent(siteId, { ...observed, type: 'provider_usage', status: 'confirmed', count: 1, usage: reply.usage }).catch(() => undefined);
      const { usage, ...publicReply } = reply;
      void usage;
      return { ...publicReply, availability };
    } catch (error) {
      await recordPlatformEvent(siteId, { ...observed, type: 'presentation_rejected', status: request.signal.aborted ? 'cancelled' : 'rejected' }).catch(() => undefined);
      if (availability.live) await recordPlatformEvent(siteId, { ...observed, type: 'provider_usage', status: 'unknown', count: 1 }).catch(() => undefined);
      throw new VisitorAttemptError(error instanceof AppError ? error.message : error instanceof Error && !availability.live ? error.message : 'The assistant could not finish this reply. Please try a new turn later.',
        availability, error instanceof AppError ? error.status : request.signal.aborted ? 499 : 502);
    }
  });
}
