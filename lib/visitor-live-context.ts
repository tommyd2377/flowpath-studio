import type { LiveSocket } from './gpt-live/runtime';
import { liveText } from './gpt-live/protocol';

type Key = 'screen' | 'photos' | 'content' | 'memory' | 'reading';
type Snapshot = { generation: number; parts: string[]; index: number };

/** Studio screen observations have independent backpressure from task results.
 * Keep one append in flight and only the latest unsent snapshot per channel.
 * A provider ACK is delivery timing, not proof of model understanding or playback.
 */
export function createVisitorLiveContext(socket: LiveSocket) {
  const queued = new Map<Key, Snapshot>();
  let generation = 0, sequence = 0, stopped = false;
  let pending: { id: string; key: Key; generation: number } | undefined;
  function dispose() { stopped = true; queued.clear(); pending = undefined; }
  function pump() {
    if (stopped || pending || socket.readyState !== 1) return;
    // A concise new view takes precedence over remaining reference prose.
    const key = (['screen', 'photos', 'memory', 'content', 'reading'] as const).find(key => queued.has(key));
    if (!key) return;
    const snapshot = queued.get(key)!;
    const id = `visitor_context_${++sequence}`;
    pending = { id, key, generation: snapshot.generation };
    // Model context wrapper: label ordered parts of each screen, content, memory or reading snapshot.
    socket.send(JSON.stringify({ type: 'session.thinking.append', event_id: id, delegation_id: null,
      content: `[${key} ${snapshot.generation} part ${snapshot.index + 1}/${snapshot.parts.length}] ${snapshot.parts[snapshot.index]}` }));
  }
  socket.on('open', pump);
  socket.on('close', dispose);
  socket.on('message', raw => {
    if (!pending || stopped) return;
    let event: { type?: string; client_event_id?: string; error?: { client_event_id?: string } };
    try { if (raw.toString().length > 256_000) return; event = JSON.parse(raw.toString()); } catch { return; }
    if (event.type === 'error' && event.error?.client_event_id === pending.id) { dispose(); return; }
    if (event.type !== 'session.thinking.appended' || event.client_event_id !== pending.id) return;
    const snapshot = queued.get(pending.key);
    // A newer view replaces the rest of an obsolete multipart snapshot.
    if (snapshot?.generation === pending.generation && ++snapshot.index === snapshot.parts.length) queued.delete(pending.key);
    pending = undefined;
    pump();
  });
  return {
    publish(key: Key, text: string) {
      if (stopped) return;
      // Context schemas bound these observations. Fail rather than clip a fact.
      if (Buffer.byteLength(text) > 96_000) throw new Error('The voice screen observation exceeded its limit.');
      const parts: string[] = [];
      for (let remaining = text; remaining;) { const part = liveText(remaining, key === 'screen' ? 420 : 360); parts.push(part); remaining = remaining.slice(part.length); }
      if (!parts.length) return;
      if (key === 'screen') queued.delete('reading');
      queued.set(key, { generation: ++generation, parts, index: 0 });
      pump();
    },
    dispose,
  };
}
