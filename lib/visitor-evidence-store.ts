import 'server-only';
import { randomUUID } from 'node:crypto';
import type { ResultHandle } from '@thevoice/platform-ui/task';
import type { VisitorTaskSession } from './visitor-task-store';
import { queryHash } from './catalog-query-index';

export function retainEvidence(session: VisitorTaskSession, type: string, data: unknown, authority: ResultHandle['authority'], dependencies: ResultHandle['dependencies'] = [], now = Date.now()): ResultHandle {
  if (Buffer.byteLength(JSON.stringify(data)) > 48_000) throw new Error('Evidence exceeds the bounded result size.');
  session.evidence = session.evidence.filter(value => { try { resolveEvidence(session, value.handle.id, value.handle.type, now); return true; } catch { return false; } });
  if (session.evidence.length >= 32) throw new Error('Evidence capacity reached. Start a new task session.');
  const handle: ResultHandle = { id: randomUUID(), type, sessionId: session.id, publication: session.publication, generation: session.generation, observedAt: new Date(now).toISOString(),
    expiresAt: new Date(Math.min(now + 30 * 60_000, session.createdAt + 2 * 60 * 60_000)).toISOString(), authority, dependencies };
  session.evidence.push({ handle, data: structuredClone(data) }); return handle;
}
export function resolveEvidence(session: VisitorTaskSession, id: string, type: string, now = Date.now()): unknown {
  const result = session.evidence.find(value => value.handle.id === id);
  if (!result || result.handle.type !== type || result.handle.sessionId !== session.id || queryHash(result.handle.publication) !== queryHash(session.publication)
    || result.handle.generation !== session.generation || Date.parse(result.handle.expiresAt) <= now
    || result.handle.dependencies.some(dependency => {
      if (dependency.id === `scene:${session.id}`) return (session.viewport === undefined ? session.scene : session.viewport)?.sceneRevision !== dependency.revision;
      const query = session.queries.find(query => query.current.queryId === dependency.id);
      return query ? query.current.revision !== dependency.revision : dependency.id === session.selection.selectionId ? session.selection.revision !== dependency.revision : true;
    })) throw new Error('Evidence is unavailable, expired or stale.');
  return structuredClone(result.data);
}
