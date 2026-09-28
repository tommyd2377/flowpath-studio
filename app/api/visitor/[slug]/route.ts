import { loadGreetingRecords } from '@/lib/greeting-record-store';
import { visitorChatTask } from '@/lib/visitor-chat-task';
import { after } from 'next/server';
import { requestTestRecorder } from '@/lib/visitor-test-recording-store';
import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { readLimitedBody } from '@/lib/http';
import { assertSameOrigin } from '@/lib/firebase/session';
import { slugSchema } from '@/lib/site-store';
import { visitorAccess } from '@/lib/visitor-store';
import { VisitorAttemptError } from '@/lib/visitor-quota';
import { visitorRequestSchema } from '@/lib/visitor-request';
import { boundVisitorHistory } from '@/lib/visitor-conversation-bounds';
import { visitorRequestContext, visitorTextReply, visitorVoiceReply } from '@/lib/visitor-provider';
import { demoVisitorReply, MAX_PCM_BYTES } from '@/lib/visitor-model';
import { getWelcomeMessage } from '@/lib/site-greeting';
import { demoPresentation, presentationSummary } from '@/lib/site-presentation';
import { getPublishedMedia } from '@/lib/media-store';
import { getPublishedKnowledgeSnapshot } from '@/lib/knowledge-store';
import { recordPlatformEvent, recordPlatformEvents } from '@/lib/platform-events';
import { planForIntent } from '@thevoice/platform-ui/interaction';
import { meterDemoUsage } from '@/lib/billing-store';
import { assertNoStripeTestPaidAi } from '@/lib/billing-ai-guard';
import { planWorkspaceIntent, publishedWorkspace } from '@/lib/visitor-workspace';

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
  try { const result = await operation(); return result instanceof Response ? result : Response.json(result, { headers: { 'Cache-Control': 'no-store' } }); }
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
    const record = requestTestRecorder(request, input.requestId);
    record?.({ type: 'chat.received', data: input });
    let preparationStarted = performance.now();
    const prepared = (stage: string) => { const now = performance.now(); record?.({ type: 'chat.preparation', data: { stage, durationMs: now - preparationStarted } }); preparationStarted = now; };
    if (input.kind === 'voice') {
      const audio = Buffer.from(input.audio, 'base64');
      if (audio.length < 9600 || audio.length > MAX_PCM_BYTES || audio.length % 2) throw new AppError('Record between 0.2 and 20 seconds of audio.');
    }
    if (request.signal.aborted) throw new AppError('Request cancelled.', 499);
    // Validate client state against the published snapshot before reserving an attempt.
    const preview = await visitorAccess(slug);
    prepared('publication_access');
    const [catalog, media] = await Promise.all([
      preview.content.catalogPublicationId ? null : getPublishedKnowledgeSnapshot(preview.siteId, preview.content.knowledgeRevisionId),
      getPublishedMedia(preview.siteId, preview.content.mediaRevisionId),
      preview.availability.live ? assertNoStripeTestPaidAi(preview.siteId) : undefined,
    ]);
    input.context = visitorRequestContext(preview.content, input, catalog ?? undefined, media ?? undefined, slug);
    input.catalogState = input.context.catalogState;
    prepared('published_context');
    const { content, siteId, availability } = await visitorAccess(slug, { requestId: input.requestId, kind: input.kind === 'chat' ? 'chat' : 'voice', greeting: input.kind === 'greeting' });
    prepared('quota_reservation');
    const observed = { surface: 'public' as const, requestId: input.requestId, snapshotId: content.knowledgeRevisionId, kind: input.kind === 'chat' ? 'chat' as const : 'voice' as const };
    try {
      if (JSON.stringify(content) !== JSON.stringify(preview.content)) throw new AppError('The publication changed during this request. Reload to continue.', 409);
      if (!availability.live) {
        await recordPlatformEvent(siteId, { ...observed, type: 'visitor_intent', status: 'started' }).catch(() => undefined);
        await meterDemoUsage(siteId, input.kind === 'chat' ? 'chat' : 'voice', input.requestId);
        if (input.kind === 'greeting') return { text: getWelcomeMessage(content, catalog, await loadGreetingRecords(siteId, content)), demo: true, availability };
        if (input.kind === 'chat' && input.context.taskSession && /^(?:show|find|search|only|include|sort|remove|under|below|over|above|at least|at most|open|go back|back|clear)\b/i.test(input.text)) return visitorChatTask({ record, preview: true, slug, siteId, content, catalog: catalog ?? undefined, media: media ?? undefined, request: input, availability, signal: request.signal, onUsage: () => {} });
        if (input.context.workspace) {
          const reply = planWorkspaceIntent(input.kind === 'chat' ? input.text : '', input.context.workspace, publishedWorkspace(content, catalog, media, input.context.externalResults), input.context.scene, catalog, media);
          return { text: reply.message, ...(reply.batch ? { workspaceBatch: reply.batch } : {}), demo: true, availability };
        }
        if (catalog) return { text: 'Explore the published items below.', catalogPlan: planForIntent(catalog, input.kind === 'chat' ? input.text : '', input.catalogState, media ?? undefined), demo: true, availability };
        const history = input.context.presentation
          ? boundVisitorHistory([...input.history, { role: 'assistant' as const, text: presentationSummary(input.context.presentation, content, media) }])
          : input.history;
        const presentation = demoPresentation(content, input.kind === 'chat' ? input.text : '', history, media);
        return { text: input.kind === 'chat' ? presentationSummary(presentation, content, media) : demoVisitorReply(content, ''), presentation, demo: true, availability };
      }
      // These are observations, not the authoritative quota/budget reservation
      // above. Start their write now and keep it alive after the response, so
      // activity-ledger latency cannot delay the first useful model result.
      const observation = recordPlatformEvents(siteId, [{ ...observed, type: 'visitor_intent', status: 'started' }, { ...observed, type: 'provider_usage', status: 'reserved', count: 1 }])
        .catch(() => undefined);
      after(() => observation);
      prepared('operational_events_scheduled');
      if (input.kind === 'chat' && input.context.workspace) return visitorChatTask({ record, slug, siteId, content, catalog: catalog ?? undefined, media: media ?? undefined, request: input, availability, signal: request.signal,
        onUsage: usage => { void recordPlatformEvent(siteId, { ...observed, requestId: `${input.requestId}-${crypto.randomUUID()}`, type: 'provider_usage', status: 'confirmed', count: 1, usage }).catch(() => undefined); },
      });
      const reply = input.kind === 'chat' ? await visitorTextReply(content, input, request.signal, catalog ?? undefined, media ?? undefined, { slug, record }) : await visitorVoiceReply(content, input, request.signal, catalog ?? undefined, media ?? undefined);
      if (request.signal.aborted) throw new AppError('Request cancelled.', 499);
      if (JSON.stringify((await visitorAccess(slug)).content) !== JSON.stringify(content)) throw new AppError('The publication changed during this request. Reload to continue.', 409);
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
