import { z } from 'zod';
import { visitorControlCapabilitySchema, visitorNavigationSchema } from './visitor-realtime-context';

export const VISITOR_SESSION_MS = 120_000;
export const VISITOR_IDLE_MS = 20_000;
export const VISITOR_MAX_SPEECH_MS = 20_000;
export const VISITOR_MAX_PLAYBACK_MS = 30_000;

export const visitorAvailabilitySchema = z.object({
  enabled: z.boolean(), mode: z.enum(['chat', 'voice', 'both']), live: z.boolean(),
  chatRemaining: z.number().int().min(0).max(10000), voiceRemaining: z.number().int().min(0).max(10000), resetsAt: z.string().max(100),
}).strict();
const revision = z.number().int().nonnegative();
const responseId = z.string().min(1).max(200);
export const visitorRealtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('session'), sdp: z.string().min(1).max(65536), availability: visitorAvailabilitySchema, expiresAt: z.number().int().positive(), control: visitorControlCapabilitySchema }).strict(),
  z.object({ type: z.literal('ready') }).strict(),
  z.object({ type: z.literal('control_applied'), seq: revision, interactionRevision: revision, revision, ready: z.boolean() }).strict(),
  z.object({ type: z.literal('transcript'), id: responseId, role: z.enum(['user', 'assistant']), text: z.string().min(1).max(2000), revision, interactionRevision: revision }).strict(),
  z.object({ type: z.literal('navigation'), id: responseId, revision, interactionRevision: revision, target: visitorNavigationSchema }).strict(),
  z.object({ type: z.literal('speech_started'), revision }).strict(),
  z.object({ type: z.literal('speech_stopped') }).strict(),
  z.object({ type: z.literal('response_started'), revision, interactionRevision: revision }).strict(),
  z.object({ type: z.literal('playback_started'), responseId, interactionRevision: revision }).strict(),
  z.object({ type: z.enum(['playback_stopped', 'playback_cleared']), responseId: responseId.optional() }).strict(),
  // The host validates these references against its current published snapshot.
  z.object({ type: z.literal('plan'), revision, interactionRevision: revision, catalogPlan: z.unknown().optional(), presentation: z.unknown().optional() }).strict(),
  z.object({ type: z.literal('availability'), availability: visitorAvailabilitySchema }).strict(),
  z.object({ type: z.literal('ended'), message: z.string().max(500) }).strict(),
  z.object({ type: z.literal('error'), message: z.string().max(500), availability: visitorAvailabilitySchema.optional() }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type VisitorRealtimeEvent = z.infer<typeof visitorRealtimeEventSchema>;

/** No reconnects: closing or cancelling this body ends the provider session. */
export async function readVisitorRealtimeEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, accept: (event: VisitorRealtimeEvent) => void | Promise<void>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '', total = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read();
      if (signal.aborted) return;
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 4_000_000) throw new Error('The voice connection sent too much data.');
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0 && !signal.aborted) {
        const frame = pending.slice(0, end); pending = pending.slice(end + 1);
        if (frame.length > 256_000) throw new Error('The voice connection sent an invalid event.');
        const event = visitorRealtimeEventSchema.parse(JSON.parse(frame));
        await accept(event);
        if (event.type === 'ended' || event.type === 'error') return;
      }
      if (pending.length > 256_000) throw new Error('The voice connection sent an invalid event.');
    }
    if (!signal.aborted) throw new Error('The voice connection ended. Tap the wave to start again.');
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
