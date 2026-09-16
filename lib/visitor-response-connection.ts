import WebSocket from 'ws';
import { safeTestRecorder, type TestRecorder } from './visitor-test-events';

export type VisitorResponseRequest = (body: Record<string, unknown>, signal: AbortSignal, onOutput?: () => void, onEvent?: (event: Record<string, unknown>) => void) => Promise<Record<string, unknown>>;
type Socket = Pick<WebSocket, 'readyState' | 'send' | 'terminate' | 'on'>;
type SocketFactory = (url: string, options: WebSocket.ClientOptions) => Socket;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unavailable = () => new Error('The conversation backend is temporarily unavailable.');

/** One lazy, sequential Responses connection per voice session. No warmup,
 * automatic retry or shared cross-visitor state. Cancelling discards the socket
 * so late frames cannot be mistaken for the next request's output.
 */
export function createVisitorResponseConnection(apiKey: string, factory: SocketFactory = (url, options) => new WebSocket(url, options), observer?: TestRecorder) {
  const observe = safeTestRecorder(observer);
  let socket: Socket | undefined, closed = false;
  let cached: { id: string; model: unknown; input: unknown[]; serialized: string } | undefined;
  let pending: { body: Record<string, unknown>; signal: AbortSignal; bytes: number; output: boolean; onOutput?: () => void; onEvent?: (event: Record<string, unknown>) => void;
    finish: (result: Record<string, unknown>) => void; fail: (error: unknown) => void } | undefined;
  function disconnect(error: unknown) {
    const active = pending, previous = socket;
    pending = undefined; socket = undefined; cached = undefined;
    active?.fail(error);
    if (previous && previous.readyState !== WebSocket.CLOSED) previous.terminate();
  }
  function send() {
    if (!pending || socket?.readyState !== WebSocket.OPEN) return;
    const body = { ...pending.body };
    if (cached && cached.model === body.model && Array.isArray(body.input) && body.input.length > cached.input.length
      && JSON.stringify(body.input.slice(0, cached.input.length)) === cached.serialized) {
      body.previous_response_id = cached.id; body.input = body.input.slice(cached.input.length);
    }
    // WebSocket responses stream by default. Only this implicit lane is used.
    socket.send(JSON.stringify({ ...body, type: 'response.create' }));
    observe({ type: 'model.transport', data: { transport: 'websocket', body } });
  }
  function connect() {
    const current = factory('wss://api.openai.com/v1/responses', {
      headers: { Authorization: `Bearer ${apiKey}` }, handshakeTimeout: 10_000, maxPayload: 256_000,
    });
    socket = current;
    current.on('open', () => { if (socket === current) { try { send(); } catch { disconnect(unavailable()); } } });
    current.on('message', raw => {
      if (socket !== current || !pending) return;
      try {
        const text = raw.toString(); pending.bytes += Buffer.byteLength(text);
        if (Buffer.byteLength(text) > 256_000 || pending.bytes > 1_000_000) throw new Error('The conversation backend returned too much data.');
        const event = record(JSON.parse(text));
        if (event.type === 'error') throw new Error(event.status === 429 ? 'The conversation backend is busy. Try again shortly.' : 'The conversation backend rejected the request.');
        if (!pending.output && ['response.output_text.delta', 'response.function_call_arguments.delta'].includes(String(event.type))) {
          pending.output = true; pending.onOutput?.();
        }
        pending.onEvent?.(event);
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(String(event.type))) {
          const active = pending, result = record(event.response);
          const input = Array.isArray(active.body.input) && Array.isArray(result.output) ? [...active.body.input, ...result.output] : [];
          cached = result.status === 'completed' && typeof result.id === 'string' && result.id.length <= 200 && input.length
            ? { id: result.id, model: active.body.model, input, serialized: JSON.stringify(input) } : undefined;
          pending = undefined; active.finish(result);
        }
      } catch (error) { disconnect(error instanceof SyntaxError ? new Error('The conversation backend did not finish.') : error); }
    });
    current.on('error', () => { if (socket === current) disconnect(unavailable()); });
    current.on('close', () => { if (socket === current) disconnect(unavailable()); });
  }
  const request: VisitorResponseRequest = (body, signal, onOutput, onEvent) => {
    signal.throwIfAborted();
    if (closed || pending) return Promise.reject(unavailable());
    return new Promise((resolve, reject) => {
      const abort = () => disconnect(signal.reason);
      const clear = () => signal.removeEventListener('abort', abort);
      pending = { body, signal, bytes: 0, output: false, onOutput, onEvent,
        finish: result => { clear(); resolve(result); }, fail: error => { clear(); reject(error); } };
      signal.addEventListener('abort', abort, { once: true });
      try { if (!socket) connect(); else send(); } catch { disconnect(unavailable()); }
    });
  };
  return { request, close() { closed = true; disconnect(new DOMException('Cancelled', 'AbortError')); } };
}
