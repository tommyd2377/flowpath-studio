export type ReadinessSnapshot = { ok: boolean; body: unknown; serverTiming: string | null };
// This is an availability hint, never authority: POST repeats current access,
// content and admission checks before creating any provider session.
export const READINESS_PREPARATION_TTL_MS = 60_000;

type Read = (signal: AbortSignal) => Promise<ReadinessSnapshot>;
type TakenReadiness = { result: ReadinessSnapshot; source: 'ready' | 'pending' | 'cold'; startedAt: number; completedAt: number };
type Entry = {
  key: string;
  controller: AbortController;
  startedAt: number;
  completedAt?: number;
  result?: ReadinessSnapshot;
  consumed: boolean;
  promise: Promise<ReadinessSnapshot>;
};

const enabled = (result: ReadinessSnapshot) => result.ok && result.body !== null
  && typeof result.body === 'object' && !Array.isArray(result.body)
  && 'enabled' in result.body && result.body.enabled === true;
const aborted = () => new DOMException('Readiness preparation canceled.', 'AbortError');

/** One short-lived, single-use read. The callback may only perform the caller's readiness GET. */
export function createReadinessPreparation(now: () => number = () => performance.now()) {
  let entry: Entry | undefined;
  const attempts = new Map<string, number>();

  function abortEntry() {
    const previous = entry;
    entry = undefined;
    previous?.controller.abort();
  }
  function clear() {
    abortEntry();
    attempts.clear();
  }
  function fresh(key: string) {
    return entry && !entry.consumed && entry.key === key
      && !entry.controller.signal.aborted && now() - entry.startedAt < READINESS_PREPARATION_TTL_MS;
  }
  function begin(key: string, read: Read): Entry {
    abortEntry();
    const controller = new AbortController();
    const next: Entry = { key, controller, startedAt: now(), consumed: false, promise: undefined! };
    entry = next;
    // Invoke the read immediately, while treating a synchronous throw like a rejected promise.
    try { next.promise = Promise.resolve(read(controller.signal)); }
    catch (error) { next.promise = Promise.reject(error); }
    next.promise = next.promise.then(result => {
      next.completedAt = now();
      next.result = result;
      if (entry === next && (!enabled(result) || controller.signal.aborted)) entry = undefined;
      return result;
    }, error => {
      if (entry === next) entry = undefined;
      throw error;
    });
    // Prewarming is optional: a failed background read must never be unhandled.
    void next.promise.catch(() => {});
    return next;
  }

  function prepare(key: string, read: Read) {
    // A passive hover/focus must never cancel a read already owned by a click.
    if (entry?.consumed || fresh(key)) return;
    const at = now();
    for (const [attemptKey, startedAt] of attempts) {
      if (at - startedAt >= READINESS_PREPARATION_TTL_MS) attempts.delete(attemptKey);
    }
    if (attempts.has(key)) return;
    attempts.set(key, at);
    begin(key, read);
  }

  async function take(key: string, read: Read, signal: AbortSignal): Promise<TakenReadiness> {
    if (signal.aborted) throw aborted();
    let selected: Entry;
    let source: 'ready' | 'pending' | 'cold';
    if (fresh(key)) {
      selected = entry!;
      source = selected.completedAt === undefined ? 'pending' : 'ready';
    } else {
      selected = begin(key, read);
      source = 'cold';
    }
    selected.consumed = true;
    const cancel = () => selected.controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      // A callback that ignores abort must not make cancellation wait for its result.
      const result = await new Promise<ReadinessSnapshot>((resolve, reject) => {
        const rejectAbort = () => reject(aborted());
        selected.controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (selected.controller.signal.aborted) rejectAbort();
        selected.promise.then(resolve, reject).finally(() => selected.controller.signal.removeEventListener('abort', rejectAbort));
      });
      return { result, source, startedAt: selected.startedAt, completedAt: selected.completedAt! };
    } catch (error) {
      // A failed pre-click read is only a hint. Retry once as the click's own
      // ordinary GET, unless cancellation or scope invalidation caused failure.
      if (source !== 'cold' && !signal.aborted && !selected.controller.signal.aborted) return take(key, read, signal);
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
      if (entry === selected) entry = undefined;
    }
  }
  return { prepare, take, clear };
}
