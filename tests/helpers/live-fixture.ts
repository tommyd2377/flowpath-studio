import { EventEmitter } from 'node:events';
export class FakeLiveSocket extends EventEmitter {
  readyState = 0; sent: Record<string, unknown>[] = []; acknowledgeAppends = true;
  send(raw: string) {
    const event = JSON.parse(raw); this.sent.push(event);
    if (event.type === 'session.close') queueMicrotask(() => this.frame({ type: 'session.closed', usage: { seconds: 10 }, reason: 'close_requested' }));
    if (this.acknowledgeAppends && /^session\.(thinking|instructions|commentary)\.append$/.test(event.type)) queueMicrotask(() => this.frame({ type: `${event.type}ed`, client_event_id: event.event_id, start_ms: 0, end_ms: 1 }));
  }
  close() { this.terminate(); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  frame(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  user(text: string, id = 'item_test') { this.frame({ type: 'session.input_transcript.delta', delta: text, start_ms: 0, end_ms: 100 }); this.frame({ type: 'session.delegation.created', offset_ms: 100, delegation: { id, target: 'client' } }); }
}
export const flushLive = () => new Promise<void>(resolve => setImmediate(resolve));
export const liveAnswer = (text = 'Grounded answer.') => ({ type: 'message', content: [{ type: 'output_text', text }] });
export const liveTool = (name: string, args: unknown) => ({ type: 'function_call', name, call_id: 'call_test', arguments: JSON.stringify(args) });
