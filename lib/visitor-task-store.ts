import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { querySpecSchema, publicationRefSchema, selectionStateSchema, type PublicationRef } from '@thevoice/platform-ui/query';
import { taskReceiptSchema, visitorTaskStateSchema, resultHandleSchema } from '@thevoice/platform-ui/task';
import { visitorTaskViewSchema, type VisitorTaskView } from '@thevoice/platform-ui/task-view';
import { queryHash } from './catalog-query-index';
import { taskDocuments, type TaskDocuments } from './task-persistence';
import { pruneVisitorConversationMemory, visitorResearchMemorySchema } from './visitor-conversation-memory';

export const clarificationSchema = z.object({ question: z.string().min(1).max(500), options: z.array(z.string().min(1).max(160)).max(4) }).strict();
const taskSceneSchema = z.object({ operationId: z.string().uuid().optional(), queryId: z.string(), queryRevision: z.number().int(), resultSetId: z.string(), sceneRevision: z.number().int().nonnegative(), recordIds: z.array(z.string()).max(48) }).strict();
type TaskScene = z.infer<typeof taskSceneSchema>;
const viewportSchema = taskSceneSchema.extend({ revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), ready: z.boolean() }).strict();
const pageSchema = z.object({ queryId: z.string(), revision: z.number().int(), cursor: z.string() }).strict().nullable();
const presentationSchema = z.object({ type: z.enum(['records', 'comparison', 'detail', 'map', 'research', 'links', 'estimate']), data: z.unknown() }).strict().nullable();
const queryHistorySchema = z.object({ current: querySpecSchema, past: z.array(querySpecSchema).max(20) }).strict();
const navigationSchema = z.object({ queryId: z.string().nullable(), page: pageSchema, presentation: presentationSchema }).strict();
const confirmedSchema = z.object({ scene: taskSceneSchema.nullable().default(null), activeQueryId: z.string().nullable(), queries: z.array(queryHistorySchema).max(8), page: pageSchema, presentation: presentationSchema, navigation: z.array(navigationSchema).max(8), selection: selectionStateSchema.optional(), activeArtifactId: z.string().nullable().optional(), browse: z.object({ children: z.number().int(), fields: z.number().int() }).optional() }).strict();
const sessionSchema = z.object({ version: z.literal(2), id: z.string().uuid(), revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), publication: publicationRefSchema,
  browse: z.object({ children: z.number().int().min(0).max(1000), fields: z.number().int().min(0).max(64) }).strict().default({ children: 0, fields: 0 }),
  page: pageSchema.default(null),
  presentation: presentationSchema.default(null),
  navigation: z.array(navigationSchema).max(8).default([]), confirmed: confirmedSchema.nullable().default(null),
  surfaceHistory: z.array(z.object({ id: z.string().max(200), snapshot: confirmedSchema, view: visitorTaskViewSchema }).strict()).max(32).default([]),
  clarification: clarificationSchema.nullable().default(null),
  createdAt: z.number(), touchedAt: z.number(), activeQueryId: z.string().nullable(),
  queries: z.array(queryHistorySchema).max(8), selection: selectionStateSchema,
  tasks: z.array(visitorTaskStateSchema).max(8), receipts: z.array(taskReceiptSchema).max(100),
  evidence: z.array(z.object({ handle: resultHandleSchema, data: z.unknown() }).strict()).max(32),
  researchMemory: visitorResearchMemorySchema,
  operations: z.array(z.object({ id: z.string().uuid(), hash: z.string(), status: z.enum(['running', 'completed', 'failed', 'reconciling']), result: z.unknown().optional() }).strict()).max(100),
  scene: taskSceneSchema.nullable(),
  activeArtifactId: z.string().nullable().default(null), artifacts: z.array(z.unknown()).max(12), business: z.record(z.string(), z.unknown()),
}).strict();
export type VisitorTaskSession = z.infer<typeof sessionSchema> & { viewport?: TaskScene | null };
/** A newer interaction resumes the last acknowledged composition, never a pending proposal. */
export function restoreConfirmedView(session: VisitorTaskSession) {
  if (session.confirmed) Object.assign(session, structuredClone(session.confirmed));
  session.clarification = null;
}
export function confirmVisitorView(session: VisitorTaskSession) {
  session.confirmed = structuredClone({ scene: session.scene, activeQueryId: session.activeQueryId, queries: session.queries, page: session.page, presentation: session.presentation, navigation: session.navigation, selection: session.selection, activeArtifactId: session.activeArtifactId, browse: session.browse });
}
/** Server-owned results only. Restore never repeats a search, calculation, or action. */
export function retainTaskSurface(session: VisitorTaskSession, view: VisitorTaskView) {
  if (!session.confirmed) return;
  const id = view.operationId ?? 'initial';
  session.surfaceHistory = [...session.surfaceHistory.filter(frame => frame.id !== id), { id, snapshot: structuredClone(session.confirmed), view: structuredClone(view) }].slice(-32);
  while (session.surfaceHistory.length && Buffer.byteLength(JSON.stringify(session.surfaceHistory)) > 300_000) session.surfaceHistory.shift();
}
export function restoreTaskSurface(session: VisitorTaskSession, id: string) {
  const index = session.surfaceHistory.findIndex(frame => frame.id === id), frame = session.surfaceHistory[index];
  if (!frame) throw new Error('That saved result has expired. Your current information remains available.');
  Object.assign(session, structuredClone(frame.snapshot));
  // Keep later receipts available for Forward; navigation never replays a tool.
  session.generation++; session.scene = null; session.viewport = null;
  for (const task of session.tasks) if (!['completed', 'failed', 'cancelled', 'reconciling'].includes(task.status)) task.status = 'cancelled';
  confirmVisitorView(session);
  // Business effects/artifact contents remain current. Presentation is all that Back restores.
  return { ...structuredClone(frame.view), generation: session.generation, revision: session.revision + 1, business: session.business };
}
export class VisitorTaskStore {
  constructor(private readonly documents: TaskDocuments = taskDocuments('visitorTaskSessions'), private readonly now = Date.now) {}
  async create(publication: PublicationRef): Promise<VisitorTaskSession> {
    const id = randomUUID(), session: VisitorTaskSession = { version: 2, id, revision: 0, generation: 0, publication, createdAt: this.now(), touchedAt: this.now(), activeQueryId: null,
      surfaceHistory: [], clarification: null, browse: { children: 0, fields: 0 }, page: null, presentation: null, navigation: [], confirmed: null, queries: [], selection: { version: 2, selectionId: randomUUID(), revision: 0, publication, members: [] }, tasks: [], receipts: [], evidence: [], researchMemory: [], operations: [], scene: null, activeArtifactId: null, artifacts: [], business: {} };
    await this.documents.create(id, session); return session;
  }
  async read(id: string, publication: PublicationRef, options?: { viewport: false | 'parallel' }): Promise<VisitorTaskSession> {
    z.string().uuid().parse(id);
    // A resumed request needs both documents. Overlap their I/O only when
    // requested; retain scene failures until the validated session needs it.
    const [raw, observed] = await Promise.all([this.documents.read(id), options?.viewport === 'parallel'
      ? this.documents.read(`scene-${id}`).then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })) : undefined]);
    const session = sessionSchema.parse(raw);
    if (queryHash(publication) !== queryHash(session.publication)) throw new Error('Publication changed. Start a new visitor session.');
    if (this.now() - session.createdAt >= 2 * 60 * 60_000 || this.now() - session.touchedAt >= 30 * 60_000) throw new Error('Visitor session expired.');
    pruneVisitorConversationMemory(session, this.now());
    // Receipt/observation writes validate against the saved operation itself.
    // A null viewport deliberately supplies no authority for visible ordinals.
    return { ...session, viewport: options?.viewport === false ? null : await this.viewport(session, observed) };
  }
  private async viewport(session: VisitorTaskSession, loaded?: PromiseSettledResult<unknown | null>): Promise<TaskScene | null> {
    const base = session.scene, query = session.queries.find(value => value.current.queryId === session.activeQueryId)?.current;
    if (!base?.operationId || base.queryId !== query?.queryId || base.queryRevision !== query.revision) return null;
    if (loaded?.status === 'rejected') throw loaded.reason;
    const raw = loaded?.status === 'fulfilled' ? loaded.value : await this.documents.read(`scene-${session.id}`);
    if (!raw) return base;
    const observed = viewportSchema.parse(raw);
    if (observed.operationId !== base.operationId || observed.generation !== session.generation || observed.sceneRevision < base.sceneRevision
      || observed.queryId !== base.queryId || observed.queryRevision !== base.queryRevision || observed.resultSetId !== base.resultSetId) return base;
    return observed.ready ? taskSceneSchema.parse({ operationId: observed.operationId, queryId: observed.queryId, queryRevision: observed.queryRevision, resultSetId: observed.resultSetId, sceneRevision: observed.sceneRevision, recordIds: observed.recordIds }) : null;
  }
  /** Viewport writes do not contend with task-state revisions or create completion receipts. */
  async observeViewport(session: VisitorTaskSession, scene: TaskScene & { ready: boolean; generation: number }) {
    const key = `scene-${session.id}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const raw = await this.documents.read(key), previous = raw ? viewportSchema.parse(raw) : null;
      if (previous && scene.sceneRevision <= previous.sceneRevision) {
        const same = queryHash({ ...scene, revision: previous.revision }) === queryHash(previous);
        if (same) return;
        throw new Error('Viewport observation is stale.');
      }
      const next = viewportSchema.parse({ ...scene, revision: (previous?.revision ?? -1) + 1 });
      try { if (previous) await this.documents.compareAndSwap(key, previous.revision, next); else await this.documents.create(key, next); return; }
      catch (error) { if (attempt === 2) throw error; }
    }
  }
  async save(session: VisitorTaskSession, expectedRevision: number) {
    pruneVisitorConversationMemory(session, this.now());
    for (const operation of session.operations.slice(0, -1)) {
      if (Buffer.byteLength(JSON.stringify(session)) < 580_000) break;
      if (operation.status === 'completed' && operation.id !== session.scene?.operationId) operation.result = { expired: true };
    }
    while (session.evidence.length > 1 && Buffer.byteLength(JSON.stringify(session)) > 580_000) session.evidence.shift();
    while (session.researchMemory.length && Buffer.byteLength(JSON.stringify(session)) > 580_000) session.researchMemory.shift();
    while (session.surfaceHistory.length && Buffer.byteLength(JSON.stringify(session)) > 680_000) session.surfaceHistory.shift();
    const { viewport, ...persisted } = session;
    const next = sessionSchema.parse({ ...persisted, revision: expectedRevision + 1, touchedAt: this.now() });
    await this.documents.compareAndSwap(next.id, expectedRevision, next); return { ...next, viewport };
  }
}
