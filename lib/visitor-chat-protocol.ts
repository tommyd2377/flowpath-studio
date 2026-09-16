import { visitorWorkStageSchema } from './visitor-progress';
import { z } from 'zod';
import { visitorControlCapabilitySchema, visitorNavigationSchema } from './visitor-realtime-context';
import { visitorAvailabilitySchema } from './visitor-realtime';

export const visitorChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), requestId: z.string().uuid(), stage: visitorWorkStageSchema }).strict(),
  z.object({ type: z.literal('answer'), requestId: z.string().uuid(), round: z.number().int().min(0).max(4), text: z.string().max(2000), provisional: z.literal(true) }).strict(),
  z.object({ type: z.literal('control'), control: visitorControlCapabilitySchema }).strict(),
  z.object({ type: z.literal('navigation'), id: z.string().uuid(), target: visitorNavigationSchema }).strict(),
  z.object({ type: z.literal('done'), text: z.string().max(2000), displaySatisfied: z.boolean().optional(), availability: visitorAvailabilitySchema }).strict(),
  z.object({ type: z.literal('error'), message: z.string().max(500), diagnostic: z.object({
    httpStatus: z.number().int().min(400).max(599).optional(),
    reason: z.enum(['schema','auth','quota','model','provider','reference','stale','capacity','timeout']).optional(),
    schemaPath: z.string().max(250).optional(),
  }).strict().optional() }).strict(),
]);
export type VisitorChatEvent = z.infer<typeof visitorChatEventSchema>;

export async function readVisitorChatEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal, accept: (event: VisitorChatEvent) => Promise<void>) {
  const reader = body.getReader(), decoder = new TextDecoder(); let pending = '', total = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (!signal.aborted) {
      const chunk = await reader.read(); if (signal.aborted) break;
      if (chunk.done) throw new Error('The task connection ended before completion.');
      total += chunk.value.byteLength; if (total > 2_000_000) throw new Error('The task response was too large.');
      pending += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        const event = visitorChatEventSchema.parse(JSON.parse(line));
        signal.throwIfAborted(); await accept(event);
        if (event.type === 'done' || event.type === 'error') return;
      }
      if (pending.length > 256_000) throw new Error('The task event was too large.');
    }
    signal.throwIfAborted();
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
