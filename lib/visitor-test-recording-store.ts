import 'server-only';
import { mkdir, readdir, readFile, writeFile, appendFile, stat, unlink, open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { safeTestRecorder, sanitizeTestObservation, RECORDING_HEADER, LOCAL_TEST_HEADER, type TestEvent, type TestRecorder } from './visitor-test-events';
import { phoneRecordingPairings, phoneRecordingRequest } from './visitor-phone-recording';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const recordingLimits = { sessions: 10, active: 4, durationMs: 60 * 60_000, retentionMs: 7 * 86400_000, bytes: 20_000_000, queueBytes: 2_000_000 };
type State = { id: string; startedAt: number; sequence: number; bytes: number; queuedBytes: number; queue: string[]; dropped: number; browserDropped: number; active: boolean; error?: string; timer?: ReturnType<typeof setTimeout>; expiry?: ReturnType<typeof setTimeout>; writing: Promise<void> };
export type RecordingInfo = { id: string; startedAt: number; label: string; active: boolean; bytes: number; dropped: number; error?: string };

/** No content endpoints in production; DNS rebinding and cross-origin reads/writes
 * are rejected. POST + custom header also prevents cross-site form submissions.
 */
export function localRecordingRequest(request: Request, mode = process.env.NODE_ENV) {
  if (mode !== 'development') return false;
  const url = new URL(request.url), origin = request.headers.get('origin'), host = request.headers.get('host') ?? url.host;
  const local = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;
  // Next may normalize request.url to localhost even when the browser uses
  // 127.0.0.1. Both must remain loopback; Origin must match the actual Host.
  return url.protocol === 'http:' && local.test(url.host) && local.test(host)
    && origin === `http://${host}` && request.headers.get(LOCAL_TEST_HEADER) === '1'
    && (!request.headers.has('sec-fetch-site') || request.headers.get('sec-fetch-site') === 'same-origin');
}

export function createTestRecordingStore(directory: string, limits = recordingLimits) {
  const sessions = new Map<string, State>();
  let lifecycle: Promise<unknown> = Promise.resolve();
  const path = (id: string) => { if (!idPattern.test(id)) throw new Error('Invalid recording ID.'); return join(directory, `${id}.jsonl`); };
  const exclusive = <T,>(operation: () => Promise<T>) => { const next = lifecycle.then(operation, operation); lifecycle = next.catch(() => {}); return next; };
  function flush(state: State) {
    clearTimeout(state.timer); state.timer = undefined;
    if (!state.queue.length) return state.writing;
    const lines = state.queue.join(''); state.queue = []; // queuedBytes includes writes in flight.
    state.writing = state.writing.then(async () => {
      try { if (!state.error) await appendFile(path(state.id), lines, { mode: 0o600 }); }
      catch { state.error = 'Recording could not be written. The application is unaffected.'; state.active = false; }
      finally { state.queuedBytes -= Buffer.byteLength(lines); }
    });
    return state.writing;
  }
  function enqueue(state: State, source: TestEvent['source'], observation: Parameters<TestRecorder>[0], clock?: { at: number; monotonicMs: number }) {
    if (!state.active) return;
    if (Date.now() - state.startedAt > limits.durationMs || state.bytes >= limits.bytes - 2048) { void stop(state.id, 'Recording limit reached'); return; }
    const event: TestEvent = { ...sanitizeTestObservation(observation), at: clock?.at ?? Date.now(), monotonicMs: clock?.monotonicMs ?? performance.now(), source, sequence: ++state.sequence };
    const line = `${JSON.stringify(event)}\n`, bytes = Buffer.byteLength(line);
    if (state.bytes + bytes > limits.bytes - 2048) { state.dropped++; void stop(state.id, 'Recording size limit reached'); return; }
    if (state.queuedBytes + bytes > limits.queueBytes) { state.dropped++; return; }
    state.bytes += bytes; state.queuedBytes += bytes; state.queue.push(line);
    state.timer ??= setTimeout(() => { void flush(state); }, 100);
    state.timer.unref?.();
  }
  async function stop(id: string, reason = 'Stopped by tester') {
    const state = sessions.get(id); if (!state) return;
    clearTimeout(state.expiry);
    if (state.active) {
      // The reserved tail records loss even if the event/queue budget was reached.
      const line = `${JSON.stringify({ type: 'recording.stopped', at: Date.now(), monotonicMs: performance.now(), source: 'server', sequence: ++state.sequence, data: { reason, dropped: state.dropped + state.browserDropped } })}\n`;
      state.queue.push(line); state.queuedBytes += Buffer.byteLength(line); state.bytes += Buffer.byteLength(line);
      state.active = false;
    }
    await flush(state);
  }
  async function files() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(directory)).filter(name => name.endsWith('.jsonl') && idPattern.test(name.slice(0, -6)));
    return (await Promise.all(names.map(async name => ({ id: name.slice(0, -6), ...(await stat(join(directory, name))) })))).sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
  async function prune(reserve = 0) {
    const entries = await files();
    let remaining = entries.length;
    for (const entry of entries.reverse()) {
      if (!sessions.get(entry.id)?.active && (remaining >= limits.sessions - reserve + 1 || Date.now() - entry.mtimeMs > limits.retentionMs)) {
        await unlink(path(entry.id)); sessions.delete(entry.id);
        remaining--;
      }
    }
  }
  async function read(id: string) {
    const state = sessions.get(id); if (state) await flush(state);
    if ((await stat(path(id))).size > limits.bytes + 2048) throw new Error('Recording exceeds the read limit.');
    const lines = (await readFile(path(id), 'utf8')).split('\n').filter(Boolean);
    const events: TestEvent[] = [];
    for (const line of lines) { try { const event = JSON.parse(line) as TestEvent; events.push({ ...event, ...sanitizeTestObservation(event) }); } catch { /* A crash may leave a partial final line. */ } }
    return events;
  }
  return {
    active(id: string) { return sessions.get(id)?.active === true; },
    start: (label: string, metadata: unknown, id: string = randomUUID()) => exclusive(async () => {
      for (const state of sessions.values()) if (state.active && Date.now() - state.startedAt > limits.durationMs) await stop(state.id, 'Recording limit reached');
      if ([...sessions.values()].filter(item => item.active).length >= limits.active) throw new Error('Stop a recording before starting another.');
      await prune(1);
      const startedAt = Date.now();
      await writeFile(path(id), '', { flag: 'wx', mode: 0o600 });
      const state: State = { id, startedAt, sequence: 0, bytes: 0, queuedBytes: 0, queue: [], dropped: 0, browserDropped: 0, active: true, writing: Promise.resolve() };
      sessions.set(id, state); enqueue(state, 'server', { type: 'recording.started', data: { label: label.slice(0, 160), metadata, limits } });
      state.expiry = setTimeout(() => { void stop(id, 'Recording time limit reached'); }, limits.durationMs); state.expiry.unref?.();
      await flush(state); if (state.error) throw new Error(state.error);
      return { id, startedAt };
    }),
    observer(id: string, traceId?: string): TestRecorder {
      const state = sessions.get(id);
      return safeTestRecorder(state?.active ? event => enqueue(state, 'server', { ...event, traceId: event.traceId ?? traceId }) : undefined, () => id);
    },
    append(id: string, events: TestEvent[], dropped = 0) {
      const state = sessions.get(id); if (!state?.active) throw new Error('Recording is no longer active.');
      state.browserDropped = Math.max(state.browserDropped, dropped);
      for (const event of events) enqueue(state, 'browser', event, { at: event.at, monotonicMs: event.monotonicMs });
      return { active: state.active, dropped: state.dropped, error: state.error };
    },
    stop, read,
    list: () => exclusive(async (): Promise<RecordingInfo[]> => {
      await prune();
      return Promise.all((await files()).map(async entry => {
        const state = sessions.get(entry.id);
        if (state?.active && Date.now() - state.startedAt > limits.durationMs) await stop(state.id, 'Recording limit reached');
        if (state) await flush(state);
        // Read only the bounded first/last lines for the session list.
        const file = await open(path(entry.id), 'r');
        let first: TestEvent | undefined, last: TestEvent | undefined;
        try {
          const size = (await file.stat()).size;
          const head = Buffer.alloc(Math.min(size, 16_384)), tail = Buffer.alloc(Math.min(size, 2048));
          await file.read(head, 0, head.length, 0); await file.read(tail, 0, tail.length, Math.max(0, size - tail.length));
          try { first = JSON.parse(head.toString().split('\n')[0]); } catch {}
          try { last = JSON.parse(tail.toString().trimEnd().split('\n').at(-1)!); } catch {}
        } finally { await file.close(); }
        const detail = first?.data as { label?: string } | undefined;
        return { id: entry.id, startedAt: first?.at ?? entry.birthtimeMs, label: detail?.label ?? 'Test session', active: state?.active ?? false, bytes: state?.bytes ?? entry.size,
          dropped: state ? state.dropped + state.browserDropped : (last?.type === 'recording.stopped' ? (last.data as { dropped: number }).dropped : 0),
          error: state?.error ?? (!state && last?.type !== 'recording.stopped' ? 'No stop marker: final buffered events may be missing after a restart.' : undefined) };
      }));
    }),
    remove: (id: string) => exclusive(async () => { await stop(id); await unlink(path(id)); sessions.delete(id); }),
  };
}

const globals = globalThis as typeof globalThis & { visitorTestRecordings?: ReturnType<typeof createTestRecordingStore> };
export function testRecordingStore() { return globals.visitorTestRecordings ??= createTestRecordingStore(join(process.cwd(), '.visitor-recordings')); }
export function requestTestRecorder(request: Request, traceId?: string): TestRecorder | undefined {
  if (!localRecordingRequest(request)) {
    if (!phoneRecordingRequest(request)) return undefined;
    const match = new URL(request.url).pathname.match(/^\/api\/visitor\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/(?:tasks|explore|dictation|session(?:\/control)?))?$/);
    return match ? phoneRecordingPairings(testRecordingStore()).observer(request, request.headers.get(RECORDING_HEADER) ?? '', match[1], traceId) : undefined;
  }
  const id = request.headers.get(RECORDING_HEADER) ?? '', store = testRecordingStore();
  // A global store can survive HMR with an older observer implementation.
  // Attach validated request scope here as well, rather than relying on its age.
  return store.active(id) ? safeTestRecorder(store.observer(id, traceId), () => id) : undefined;
}
export async function recordingBuildMetadata() {
  // Also eliminate development source-file tracing from production bundles.
  if (process.env.NODE_ENV !== 'development') return { node: process.version };
  const files = ['lib/visitor-task-runner.ts', 'lib/visitor-realtime-control.ts', 'lib/visitor-realtime-session.ts', 'lib/gpt-live/runtime.ts', 'lib/visitor-chat-task.ts', 'components/VisitorWorkspace.tsx', 'components/VisitorAssistant.tsx', 'lib/use-visitor-session.ts'];
  return { node: process.version, sourceHashes: Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(join(process.cwd(), file))).digest('hex')]))) };
}
