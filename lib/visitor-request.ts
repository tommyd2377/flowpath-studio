import { z } from 'zod';
import { MAX_PCM_BYTES } from './visitor-model';
import { catalogFilterSchema } from '@thevoice/platform-ui/contracts';

const common = {
  requestId: z.string().uuid(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) }).strict()).max(8).default([]),
  catalogState: z.object({ snapshotId: z.string().max(100), filters: z.array(catalogFilterSchema).max(24),
    selectedIds: z.array(z.string().max(100)).max(6), focusedId: z.string().max(100).nullable(), entityIds: z.array(z.string().max(100)).max(100) }).strict().optional(),
};
export const visitorRequestSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('chat'), text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...common, kind: z.literal('voice'), audio: z.string().min(6400).max(Math.ceil(MAX_PCM_BYTES / 3) * 4)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ ...common, kind: z.literal('greeting') }).strict(),
]);
export type VisitorRequest = z.infer<typeof visitorRequestSchema>;
