import { z } from 'zod';
import { liveTestRegistry } from '@/lib/visitor-test-live';
import { visitorControlCapabilitySchema } from '@/lib/visitor-realtime-context';
import { slugSchema } from '@/lib/site-store';
import { readLimitedBody } from '@/lib/http';
import { localRecordingRequest, recordingBuildMetadata, testRecordingStore } from '@/lib/visitor-test-recording-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const id = z.string().uuid();
const event = z.object({ type: z.string().max(80), data: z.unknown(), traceId: z.string().max(100).optional(), turn: z.number().int().nonnegative().optional(), truncated: z.boolean().optional(), redacted: z.boolean().optional(), at: z.number().finite().nonnegative().max(8_000_000_000_000), monotonicMs: z.number().finite().nonnegative(), sequence: z.number().int().nonnegative(), source: z.literal('browser') });
const input = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), label: z.string().max(160), page: z.string().max(300) }),
  z.object({ action: z.literal('append'), id, events: z.array(event).max(100), dropped: z.number().int().min(0).max(1_000_000).default(0) }),
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('attach-voice'), id, slug: slugSchema, control: visitorControlCapabilitySchema }),
  z.object({ action: z.enum(['read', 'export', 'stop', 'delete']), id }),
]);
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!localRecordingRequest(request)) return Response.json({ error: 'Local development recording is unavailable.' }, { status: 404, headers });
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) throw new Error();
    const body = input.parse(JSON.parse(new TextDecoder().decode(await readLimitedBody(request, 600_000))));
    const store = testRecordingStore();
    if (body.action === 'start') return Response.json(await store.start(body.label, { page: body.page, ...await recordingBuildMetadata() }), { headers });
    if (body.action === 'attach-voice') {
      const attached = store.active(body.id) && !!liveTestRegistry()?.attach(body.slug, body.control, store.observer(body.id));
      return Response.json({ attached }, { headers });
    }
    if (body.action === 'list') return Response.json({ sessions: await store.list() }, { headers });
    if (body.action === 'append') return Response.json(store.append(body.id, body.events, body.dropped), { headers });
    if (body.action === 'stop') { await store.stop(body.id); return Response.json({ stopped: true }, { headers }); }
    if (body.action === 'delete') { await store.remove(body.id); return Response.json({ deleted: true }, { headers }); }
    const events = await store.read(body.id);
    if (body.action === 'export') return new Response(events.map(event => JSON.stringify(event)).join('\n'), { headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'Content-Disposition': `attachment; filename="flowpath-test-${body.id}.jsonl"` } });
    return Response.json({ events }, { headers });
  } catch { return Response.json({ error: 'The local recording could not be read or saved. Your conversation is unaffected.' }, { status: 400, headers }); }
}
