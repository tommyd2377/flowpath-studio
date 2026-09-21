import { z } from 'zod';
import { workspaceStateSchema } from '@thevoice/platform-ui/workspace';
import { visitorTaskViewSchema } from '@thevoice/platform-ui/task-view';
import { SURFACE_HISTORY_BYTES, SURFACE_HISTORY_ENTRIES } from '@thevoice/platform-ui/surface';
import { exploreResultSchema } from './explore-model';

export const surfaceSnapshotSchema = z.object({
  id: z.string().min(1).max(200), requestId: z.string().max(200).nullable(), tenantId: z.string().max(200), publicationId: z.string().max(100),
  workspace: workspaceStateSchema, task: visitorTaskViewSchema.nullable(), taskBookmark: z.string().max(200).nullable(),
  external: z.array(exploreResultSchema).max(6), selections: z.record(z.string().max(200), z.string().max(200).nullable()).refine(value => Object.keys(value).length <= 64),
  answer: z.string().max(8000), answerPlacement: z.literal('supporting').optional(), primaryId: z.string().max(200).nullable(), expanded: z.boolean(),
  scrollTop: z.number().int().min(0).max(10000000),
}).strict();
export type SurfaceSnapshot = z.infer<typeof surfaceSnapshotSchema>;
/** Scroll, receipts, and server revisions are observations, never undo steps. */
export function surfaceFingerprint(state: SurfaceSnapshot) {
  const { workspace, task } = state;
  return JSON.stringify({ workspace: { objects: workspace.objects.map(object => ({ ...object, scrollTop: 0 })), focusedId: workspace.focusedId },
    task: task && { query: task.query, result: task.result, detail: task.detail, comparison: task.comparison, focus: task.focus, research: task.research, map: task.map, artifacts: task.artifacts, selection: task.selection },
    external: state.external, selections: state.selections, answer: state.answer, answerPlacement: state.answer ? state.answerPlacement : undefined, primaryId: state.primaryId, expanded: state.expanded });
}
export class SurfaceHistory {
  past: SurfaceSnapshot[] = [];
  future: SurfaceSnapshot[] = [];
  pending: { id: string; before: SurfaceSnapshot } | null = null;
  begin(id: string, before: SurfaceSnapshot) { if (this.pending?.id === id) return; this.pending = { id, before }; }
  commit(id: string, after: SurfaceSnapshot) {
    if (this.pending?.id !== id) return false;
    const before = this.pending.before; this.pending = null;
    if (surfaceFingerprint(before) === surfaceFingerprint(after)) return false;
    this.future = [];
    // The empty invitation is not an answer to navigate back to.
    if (!before.answer.trim() && !before.workspace.objects.length && !before.task) return true;
    this.past.push(before); this.trim(); return true;
  }
  destination() { return this.pending?.before ?? this.past.at(-1); }
  forwardDestination() { return this.pending ? undefined : this.future.at(-1); }
  acceptBack(current?: SurfaceSnapshot) {
    // Cancelling unfinished work never makes it a Forward destination.
    if (this.pending) this.pending = null;
    else if (this.past.pop() && current) { this.future.push(current); this.trim(); }
  }
  acceptForward(current: SurfaceSnapshot) {
    if (this.pending || !this.future.pop()) return;
    this.past.push(current); this.trim();
  }
  private trim() {
    // One shared limit for both directions. Discard the farthest saved states.
    while (this.past.length + this.future.length > SURFACE_HISTORY_ENTRIES || new TextEncoder().encode(JSON.stringify([this.past, this.future])).byteLength > SURFACE_HISTORY_BYTES) {
      (this.past.length >= this.future.length ? this.past : this.future).shift();
    }
  }
  clear() { this.pending = null; this.past = []; this.future = []; }
}
