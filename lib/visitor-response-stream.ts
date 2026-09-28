/** Consume the small SSE tail without delaying the terminal result. EOF lets
 * fetch reuse its connection; an endless/large tail is cancelled within 250 ms
 * or 8 KiB / 64 chunks. Nothing after the terminal event can produce events.
 */
async function drainTerminalTail(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal, bufferedBytes: number, total: number) {
  let tail = bufferedBytes, chunks = 0, cancelled = false;
  const cancel = () => { if (!cancelled) { cancelled = true; void reader.cancel().catch(() => undefined); } };
  const timer = setTimeout(cancel, 250); timer.unref?.();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted || tail > 8192) cancel();
    while (!cancelled) {
      if (++chunks > 64) { cancel(); break; }
      const chunk = await reader.read();
      if (chunk.done) break;
      tail += chunk.value.byteLength; total += chunk.value.byteLength;
      if (tail > 8192 || total > 1_000_000) cancel();
    }
  } catch { cancel(); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Bounded Responses SSE reader. Only complete events escape; tool arguments
 * and structural JSON are never interpreted until response.completed. */
export async function readVisitorResponse(response: Response, signal: AbortSignal, onEvent?: (event: Record<string, unknown>) => void) {
  if (!response.body) throw new Error('The conversation backend returned no answer.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', total = 0, terminal = false, exhausted = false;
  const streaming = response.headers.get('content-type')?.includes('text/event-stream');
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read(); signal.throwIfAborted();
      if (chunk.done) {
        exhausted = true;
        if (streaming) throw new Error('The conversation backend did not finish.');
        return JSON.parse(pending + decoder.decode()) as Record<string, unknown>;
      }
      total += chunk.value.byteLength;
      if (total > (streaming ? 1_000_000 : 500_000)) throw new Error('The conversation backend returned too much data.');
      pending += decoder.decode(chunk.value, { stream: true });
      if (!streaming) continue;
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data) as Record<string, unknown>;
        if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('The conversation backend did not finish.');
        signal.throwIfAborted(); onEvent?.(event);
        if (event.type === 'error') throw new Error('The conversation backend rejected the request.');
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(String(event.type))) {
          if (!event.response || typeof event.response !== 'object' || Array.isArray(event.response)) throw new Error('The conversation backend did not finish.');
          terminal = true;
          return event.response as Record<string, unknown>;
        }
      }
      if (pending.length > 500_000) throw new Error('The conversation backend returned too much data.');
    }
  } finally {
    signal.removeEventListener('abort', abort);
    if (terminal) void drainTerminalTail(reader, signal, new TextEncoder().encode(pending).byteLength, total);
    else { if (!exhausted) await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
}
