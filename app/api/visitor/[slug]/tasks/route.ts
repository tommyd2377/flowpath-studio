import { websiteQueryCommand } from '@/lib/visitor-query-command';
import { AppError } from '@/lib/errors';
import { z } from 'zod';
import { readJson, respond } from '@/lib/http';
import { assertSameOrigin } from '@/lib/firebase/session';
import { visitorTaskContext } from '@/lib/visitor-task-context';
import { acknowledgeTaskDisplay, observeTaskScene, buildVisitorTaskView, capabilityCallSchema, executeVisitorCapability } from '@/lib/visitor-capabilities';
import { confirmVisitorView, restoreConfirmedView } from '@/lib/visitor-task-store';
import { queryHash } from '@/lib/catalog-query-index';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('init') }).strict(),
  z.object({ action: z.literal('refresh'), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('execute'), sessionId: z.string().uuid(), call: capabilityCallSchema }).strict(),
  z.object({ action: z.literal('interrupt'), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('ack'), generation: z.number().int().nonnegative().optional(), sessionId: z.string().uuid(), operationId: z.string().uuid(), queryId: z.string(), queryRevision: z.number().int().nonnegative(), resultSetId: z.string(), sceneRevision: z.number().int().nonnegative(), recordIds: z.array(z.string()).max(48) }).strict(),
  z.object({ action: z.literal('scene'), sessionId: z.string().uuid(), operationId: z.string().uuid(), queryId: z.string(), queryRevision: z.number().int().nonnegative(), resultSetId: z.string(), sceneRevision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), ready: z.boolean(), recordIds: z.array(z.string()).max(48) }).strict(),
]);
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return respond(async () => {
    try {
    assertSameOrigin(request);
    const input = requestSchema.parse(await readJson(request)), { slug } = await params;
    const context = await visitorTaskContext(slug), { index, publication, store } = context;
    if (input.action === 'execute' && input.call.capabilityId === 'query.command') {
      const command = z.object({ text: z.string().trim().min(1).max(2000) }).strict().parse(input.call.input);
      const session = await store.read(input.sessionId, publication);
      if (session.revision !== input.call.expectedRevision) throw new Error('Visitor state changed.');
      if (!websiteQueryCommand(command.text, { index, session })) return { handled: false };
    }
    if (input.action === 'execute') return await executeVisitorCapability({ nativeWebsite: false, websiteOpening: false, index, store, records: context.records, sessionId: input.sessionId, call: input.call, signal: request.signal,
      assertCurrent: async () => { if (queryHash((await visitorTaskContext(slug)).publication) !== queryHash(publication)) throw new Error('Publication changed. Reload results.'); } });
    if (input.action === 'ack') { const saved = await acknowledgeTaskDisplay(store, input.sessionId, publication, input); return { revision: saved.revision, generation: saved.generation }; }
    if (input.action === 'scene') { const scene = { operationId: input.operationId, queryId: input.queryId, queryRevision: input.queryRevision, resultSetId: input.resultSetId, sceneRevision: input.sceneRevision, generation: input.generation, ready: input.ready, recordIds: input.recordIds }; await observeTaskScene(store, input.sessionId, publication, scene); return { sceneRevision: scene.sceneRevision }; }
    let session = input.action === 'init' ? await store.create(publication) : await store.read(input.sessionId, publication);
    if (input.action === 'interrupt') { restoreConfirmedView(session); session.generation++; for (const task of session.tasks) if (!['completed', 'reconciling', 'failed', 'cancelled'].includes(task.status)) { task.status = 'cancelled'; for (const step of task.steps) if (step.status === 'pending' || step.status === 'running') step.status = 'cancelled'; } session = await store.save(session, session.revision); return { revision: session.revision, generation: session.generation, view: buildVisitorTaskView({ index, session, signal: request.signal }) }; }
    const view = buildVisitorTaskView({ index, session, signal: request.signal });
    if (input.action === 'init') confirmVisitorView(session);
    session = await store.save(session, session.revision); view.revision = session.revision;
    return { view };
    } catch (error) {
      if (error instanceof AppError || error instanceof z.ZodError) throw error;
      if (error instanceof Error && !('code' in error)) throw new AppError(error.message.slice(0, 300), 409);
      throw error;
    }
  });
}
