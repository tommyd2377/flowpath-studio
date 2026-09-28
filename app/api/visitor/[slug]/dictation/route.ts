import { ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/firebase/session';
import { readLimitedBody } from '@/lib/http';
import { slugSchema } from '@/lib/site-store';
import { visitorDictation, visitorDictationSchema } from '@/lib/visitor-dictation';
import { VisitorAttemptError } from '@/lib/visitor-quota';
import { requestTestRecorder } from '@/lib/visitor-test-recording-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const slug = slugSchema.parse((await params).slug);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new AppError('Expected JSON.', 415);
    const bytes = await readLimitedBody(request, 1_300_000);
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError('Invalid JSON.'); }
    const input = visitorDictationSchema.parse(raw);
    const result = await visitorDictation(slug, input, request.signal, requestTestRecorder(request, input.requestId));
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'The dictation recording is invalid.' : 'Dictation is temporarily unavailable. Type your message instead.',
      ...(error instanceof VisitorAttemptError ? { availability: error.availability } : {}) }, {
      status: error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
