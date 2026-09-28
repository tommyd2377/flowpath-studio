import { z } from 'zod';
import { readLimitedBody } from '@/lib/http';
import { visitorControlCapabilitySchema } from '@/lib/visitor-realtime-context';
import { liveTestRegistry } from '@/lib/visitor-test-live';
import { recordingBuildMetadata, testRecordingStore } from '@/lib/visitor-test-recording-store';
import { phoneRecordingPairings, phoneRecordingRequest } from '@/lib/visitor-phone-recording';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().uuid(), slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(50);
const event = z.object({ type: z.string().max(80), data: z.unknown(), traceId: z.string().max(100).optional(), turn: z.number().int().nonnegative().optional(), truncated: z.boolean().optional(), redacted: z.boolean().optional(), at: z.number().finite().nonnegative().max(8_000_000_000_000), monotonicMs: z.number().finite().nonnegative(), sequence: z.number().int().nonnegative(), source: z.literal('browser') }).strict();
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), invitationId: id, slug }).strict(),
  z.object({ action: z.literal('append'), id, slug, events: z.array(event).max(100), dropped: z.number().int().min(0).max(1_000_000).default(0) }).strict(),
  z.object({ action: z.literal('attach-voice'), id, slug, control: visitorControlCapabilitySchema }).strict(),
  z.object({ action: z.literal('stop'), id, slug }).strict(),
]);

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!phoneRecordingRequest(request)) return Response.json({ error: 'Phone recording is unavailable.' }, { status: 404, headers });
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) throw new Error();
    const body = input.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 600_000))));
    const store = testRecordingStore(), pairing = phoneRecordingPairings(store);
    if (body.action === 'accept') return Response.json(await pairing.accept(request, body.invitationId, body.slug, recordingBuildMetadata), { headers });
    if (!pairing.authorize(request, body.id, body.slug)) throw new Error();
    if (body.action === 'append') return Response.json(store.append(body.id, body.events, body.dropped), { headers });
    if (body.action === 'attach-voice') return Response.json({ attached: !!liveTestRegistry()?.attach(body.slug, body.control, pairing.observer(request, body.id, body.slug)!) }, { headers });
    pairing.revoke(body.id); await store.stop(body.id); return Response.json({ stopped: true }, { headers });
  } catch { return Response.json({ error: 'Phone pairing expired or recording could not be saved. Your conversation is unaffected.' }, { status: 400, headers }); }
}
