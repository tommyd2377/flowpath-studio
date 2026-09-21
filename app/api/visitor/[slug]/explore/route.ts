import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/firebase/session';
import { slugSchema } from '@/lib/site-store';
import { exploreRequestSchema } from '@/lib/explore-model';
import { requestTestRecorder } from '@/lib/visitor-test-recording-store';
import { authorizedExplore } from '@/lib/explore-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const globals = globalThis as typeof globalThis & { exploreTraffic?: { until: number; count: number } };

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const now = Date.now();
    if (!globals.exploreTraffic || globals.exploreTraffic.until <= now) globals.exploreTraffic = { until: now + 60_000, count: 0 };
    if (++globals.exploreTraffic.count > 120) throw new AppError('Too many searches. Please wait a minute.', 429);
    const slug = slugSchema.parse((await params).slug);
    const input = exploreRequestSchema.parse(await readJson(request));
    if (request.signal.aborted) throw new AppError('Search cancelled.', 499);
    return Response.json(await authorizedExplore(slug, input, request.signal, undefined, requestTestRecorder(request, input.requestId)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'Check your search request.' : 'Search is temporarily unavailable. Your current view is unchanged.' },
      { status: error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
