import 'server-only';
import { createHash } from 'node:crypto';
import type { VisitorControlCapability } from './visitor-realtime-context';
import { safeTestRecorder, type TestRecorder } from './visitor-test-events';

/** Local, capability-scoped observer attachment. Never store tokens, buffer
 * unrecorded speech, reconnect audio, or publish recording IDs to Firebase. */
export function createLiveTestRegistry() {
  const sessions = new Map<string, { slug: string; attach: (record: TestRecorder) => void }>();
  const key = (control: VisitorControlCapability) => createHash('sha256').update(`${control.id}:${control.token}`).digest('hex');
  return {
    register(slug: string, control: VisitorControlCapability, attach: (record: TestRecorder) => void) {
      const id = key(control), entry = { slug, attach };
      sessions.set(id, entry);
      return () => { if (sessions.get(id) === entry) sessions.delete(id); };
    },
    attach(slug: string, control: VisitorControlCapability, record: TestRecorder) {
      const entry = sessions.get(key(control));
      if (!entry || entry.slug !== slug) return false;
      entry.attach(safeTestRecorder(record));
      return true;
    },
  };
}
const globals = globalThis as typeof globalThis & { visitorLiveTestRegistry?: ReturnType<typeof createLiveTestRegistry> };
export function liveTestRegistry() {
  if (process.env.NODE_ENV !== 'development') return undefined;
  return globals.visitorLiveTestRegistry ??= createLiveTestRegistry();
}
