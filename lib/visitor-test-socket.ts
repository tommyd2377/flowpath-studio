import type { LiveSocket } from './gpt-live/runtime';
import { safeTestRecorder, type TestRecorder } from './visitor-test-events';

/** Observe this Studio connection only. Keep the shared voice runtime unchanged,
 * and preserve the original bytes and WebSocket method receivers.
 */
export function observeTestSocket(socket: LiveSocket, observer: TestRecorder) {
  const record = safeTestRecorder(observer);
  function capture(type: string, raw: unknown) {
    try {
      const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString() : '';
      if (text.length > 256_000) record({ type, data: { omitted: 'Payload exceeded the capture limit', characters: text.length }, truncated: true });
      else if (text) record({ type, data: JSON.parse(text) });
    } catch {} // Neither parse errors nor a failed observer affect the transport.
  }
  socket.on('message', raw => capture('voice.received', raw));
  return new Proxy(socket, { get(target, key) {
    if (key === 'send') return (...args: Parameters<LiveSocket['send']>) => { const result = target.send(...args); capture('voice.sent', args[0]); return result; };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
