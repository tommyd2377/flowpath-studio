import { z } from 'zod';
import type { VisitorTaskView } from '@thevoice/platform-ui/task-view';

/** Completion metadata can advance only the exact task view already displayed. */
export const visitorTaskCheckpointSchema = z.object({
  sessionId: z.string().uuid(), revision: z.number().int().nonnegative(), generation: z.number().int().nonnegative(),
  queryId: z.string().min(1).max(200), queryRevision: z.number().int().nonnegative(), resultSetId: z.string().min(1).max(200),
  operationId: z.string().uuid().optional(), active: z.boolean(),
}).strict();
export type VisitorTaskCheckpoint = z.infer<typeof visitorTaskCheckpointSchema>;

export function visitorTaskCheckpoint(view: VisitorTaskView): VisitorTaskCheckpoint {
  return { sessionId: view.sessionId, revision: view.revision, generation: view.generation, queryId: view.query.queryId,
    queryRevision: view.query.revision, resultSetId: view.result.resultSetId, ...(view.operationId ? { operationId: view.operationId } : {}), active: view.active };
}

export function reconcileVisitorTaskCheckpoint(view: VisitorTaskView | null, checkpoint: VisitorTaskCheckpoint): VisitorTaskView | null {
  if (!view || view.sessionId !== checkpoint.sessionId || view.revision > checkpoint.revision || view.generation > checkpoint.generation
    || view.query.queryId !== checkpoint.queryId || view.query.revision !== checkpoint.queryRevision || view.result.resultSetId !== checkpoint.resultSetId
    || view.operationId !== checkpoint.operationId || view.active !== checkpoint.active) return null;
  return view.revision === checkpoint.revision && view.generation === checkpoint.generation ? view
    : { ...view, revision: checkpoint.revision, generation: checkpoint.generation };
}

/** A request owns this handoff only until the next local interaction. */
export function captureVisitorTaskCompletion(options: {
  signal: AbortSignal;
  current: () => { interaction: number; view: VisitorTaskView | null; confirmed: VisitorTaskView | null };
  pause: () => void;
  accept: (view: VisitorTaskView, confirmed: VisitorTaskView) => Promise<void>;
  interrupt: () => Promise<void>;
}) {
  const initial = { ...options.current() };
  let checkpointSeen = false, synchronized = false, finished = false;
  const current = () => {
    const state = options.current();
    return !options.signal.aborted && initial.view && state.interaction === initial.interaction && state.view?.sessionId === initial.view.sessionId ? state : null;
  };
  // The bridge advances generation before displaying an answer. Old observers
  // must stop until a confirmed display or checkpoint supplies its identity.
  if (current()) options.pause();
  return {
    async accept(checkpoint: VisitorTaskCheckpoint) {
      if (finished) return;
      checkpointSeen = true;
      const state = current(); if (!state) return;
      const next = reconcileVisitorTaskCheckpoint(state.view, checkpoint), confirmed = reconcileVisitorTaskCheckpoint(state.confirmed, checkpoint);
      if (!next || !confirmed) return;
      await options.accept(next, confirmed); synchronized = true;
    },
    async finish() {
      if (finished) return;
      finished = true;
      const state = current();
      if (!state || synchronized) return;
      // Legacy streams may have no checkpoint but already showed and ACKed a
      // current task view. Their observations were resumed by that display.
      if (!checkpointSeen && state.view !== initial.view && state.view === state.confirmed) return;
      // An error/legacy answer can advance generation without revealing it.
      // Reuse explicit cancellation reconciliation; never retry model work.
      await options.interrupt();
    },
  };
}
