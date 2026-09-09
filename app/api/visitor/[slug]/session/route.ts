import { createHash, randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { after } from 'next/server';
import { AppError } from '@/lib/errors';
import { readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/firebase/session';
import { slugSchema } from '@/lib/site-store';
import { visitorAccess } from '@/lib/visitor-store';
import { VisitorAttemptError } from '@/lib/visitor-quota';
import { getPublishedKnowledge } from '@/lib/knowledge-store';
import { getPublishedMedia } from '@/lib/media-store';
import { validateCatalogState } from '@/lib/catalog-presentation';
import { visitorRequestSchema } from '@/lib/visitor-request';
import { recordPlatformEvent } from '@/lib/platform-events';
import { validateVisitorOffer, visitorRealtimeSession } from '@/lib/visitor-realtime-session';
import { validateVisitorContext, visitorContextSchema, visitorHistorySchema } from '@/lib/visitor-realtime-context';
import { assertNoStripeTestPaidAi } from '@/lib/billing-ai-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inputSchema = z.object({
  requestId: z.string().uuid(), sdp: z.string().min(1).max(32_768),
  catalogState: visitorRequestSchema.options[0].shape.catalogState,
  context: visitorContextSchema.optional(), history: visitorHistorySchema,
}).strict();
// The transactional shared ledger bounds spend across workers. These additional
// process-local controls bound sockets and stop starts after uncertain cleanup.
const globals = globalThis as typeof globalThis & {
  visitorRealtimeGate?: { active: number; blocked: boolean; until: number; starts: number };
};
const gate = globals.visitorRealtimeGate ??= { active: 0, blocked: false, until: 0, starts: 0 };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let slot = false;
  const release = () => { if (slot) { slot = false; gate.active--; } };
  try {
    assertSameOrigin(request);
    if (gate.blocked) throw new AppError('Voice is temporarily unavailable while a previous connection is checked.', 503);
    if (gate.until <= Date.now()) { gate.until = Date.now() + 60_000; gate.starts = 0; }
    if (++gate.starts > 30 || gate.active >= 4) throw new AppError('Voice is busy. Please try again shortly.', 429);
    const slug = slugSchema.parse((await params).slug);
    const input = inputSchema.parse(await readJson(request));
    validateVisitorOffer(input.sdp);
    if (request.signal.aborted) throw new AppError('Voice request cancelled.', 499);
    const preview = await visitorAccess(slug);
    if (!preview.availability.live) throw new AppError('Continuous voice is unavailable in the demo preview.', 503);
    await assertNoStripeTestPaidAi(preview.siteId);
    const catalog = await getPublishedKnowledge(preview.siteId, preview.content.knowledgeRevisionId);
    const media = await getPublishedMedia(preview.siteId, preview.content.mediaRevisionId);
    const context = validateVisitorContext(input.context ?? (input.catalogState ? { catalogState: input.catalogState } : {}), preview.content, catalog ?? undefined, media ?? undefined);
    if (input.context?.catalogState && input.catalogState && JSON.stringify(input.catalogState) !== JSON.stringify(input.context.catalogState)) throw new AppError('The current view is inconsistent. Reload and try again.', 400);
    const catalogState = catalog ? validateCatalogState(context.catalogState, catalog) : undefined;
    if (!catalog && input.catalogState) throw new AppError('This site changed. Reload to continue.', 409);
    // Recheck after asynchronous validation before taking a process-local slot.
    if (gate.blocked || gate.active >= 4) throw new AppError('Voice is temporarily unavailable.', 503);
    if (request.signal.aborted) throw new AppError('Voice request cancelled.', 499);
    gate.active++; slot = true;
    const snapshot = JSON.stringify(preview.content);
    const matches = (current: Awaited<ReturnType<typeof visitorAccess>>) => {
      if (current.siteId !== preview.siteId || JSON.stringify(current.content) !== snapshot || !current.availability.live) {
        throw new AppError('This site was updated. Reload to continue with its current information.', 409);
      }
    };
    const assertCurrent = async () => {
      matches(await visitorAccess(slug));
      // Enrollment can change while a continuous session is already connected.
      await assertNoStripeTestPaidAi(preview.siteId);
    };
    const observed = { surface: 'public' as const, snapshotId: preview.content.knowledgeRevisionId, kind: 'voice' as const };
    let currentRequestId = input.requestId;
    const reserve = async (requestId: string) => {
      if (request.signal.aborted) throw new AppError('Voice request cancelled.', 499);
      await assertCurrent();
      const next = await visitorAccess(slug, { requestId, kind: 'voice' });
      matches(next);
      currentRequestId = requestId;
      await recordPlatformEvent(preview.siteId, { ...observed, type: 'provider_usage', status: 'reserved', count: 1, requestId }).catch(() => undefined);
      return next.availability;
    };
    // Connection startup reserves its first turn even if abandoned or silent.
    // Later model turns require another transactional reservation before work.
    const availability = await reserve(input.requestId);
    if (request.signal.aborted) throw new AppError('Voice request cancelled.', 499);
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) throw new AppError('Voice is temporarily unavailable.', 503);
    return visitorRealtimeSession({
      offer: input.sdp, apiKey: key, signal: request.signal,
      content: preview.content, catalog: catalog ?? undefined, media: media ?? undefined, catalogState,
      context, history: input.history,
      mailbox: { slug, siteId: preview.siteId, publicationKey: createHash('sha256').update(snapshot).digest('hex') },
      availability, reserveTurn: () => reserve(randomUUID()), assertCurrent,
      onUsage: (usage, source) => { void recordPlatformEvent(preview.siteId, { ...observed, type: 'provider_usage', status: 'observed', ...(source === 'transcription' ? { operationId: 'input_transcription' } : { requestId: currentRequestId }), usage }).catch(() => undefined); },
      onCleanupFailure: () => { gate.blocked = true; }, onClosed: release,
      retainCleanup: work => { after(() => work); },
    });
  } catch (error) {
    release();
    return Response.json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'The voice connection request is invalid.' : 'Voice is temporarily unavailable.',
      ...(error instanceof VisitorAttemptError ? { availability: error.availability } : {}) }, {
      status: error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
