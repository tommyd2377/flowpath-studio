import { z, ZodError } from 'zod';
import { AppError } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/firebase/session';
import { readJson } from '@/lib/http';
import { slugSchema } from '@/lib/site-store';
import { visitorControlCapabilitySchema, visitorControlSchema } from '@/lib/visitor-realtime-context';
import { submitVisitorRealtimeControl } from '@/lib/visitor-realtime-mailbox';

export const runtime = 'nodejs';
const bodySchema = z.object({ control: visitorControlCapabilitySchema, update: visitorControlSchema }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const slug = slugSchema.parse((await params).slug);
    const { control, update } = bodySchema.parse(await readJson(request));
    if (request.signal.aborted) throw new AppError('Voice control request cancelled.', 499);
    await submitVisitorRealtimeControl(slug, control, update);
    // The owning stream sends an acknowledgement after applying this desired state.
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof AppError ? error.message : error instanceof ZodError ? 'The voice control request is invalid.' : 'Voice control is temporarily unavailable.' }, {
      status: error instanceof AppError ? error.status : error instanceof ZodError ? 400 : 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
