import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult, type ExploreResult } from '../lib/explore-model';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';

type Frame = Record<string, unknown>;
class Socket extends EventEmitter {
  readyState = 0; sent: Frame[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  terminate() { this.readyState = 3; }
  close() { this.terminate(); }
  frame(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value))); }
  requests() { return this.sent.filter(frame => frame.type === 'response.create').map(frame => frame.response as Frame); }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
async function setup(search: (query: string, kind: 'web' | 'images' | 'map', signal: AbortSignal) => Promise<ExploreResult>, enabled = true) {
  const socket = new Socket(); const events: VisitorRealtimeEvent[] = []; const fatal: string[] = [];
  const control = createVisitorRealtimeControl({
    callId: 'rtc_explore', apiKey: 'offline-placeholder', content: { ...sampleContent('general'), visitorSpeaksFirst: true, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled } },
    initialAvailability: { enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' },
    reserveTurn: async () => ({ enabled: true, mode: 'voice', live: true, chatRemaining: 25, voiceRemaining: 4, resetsAt: '' }),
    assertCurrent: async () => {}, emit: event => events.push(event), onFatal: message => fatal.push(message), signal: new AbortController().signal,
    search, socketFactory: () => socket as unknown as VisitorControlSocket,
  });
  socket.readyState = 1; socket.emit('open'); socket.frame({ type: 'session.updated', session: socket.sent[0].session });
  await control.ready; control.start();
  for (const type of ['speech_started', 'speech_stopped', 'committed']) socket.frame({ type: `input_audio_buffer.${type}`, item_id: 'input-1' });
  await flush();
  const tool = () => {
    socket.frame({ type: 'response.created', response: { id: 'response-1', metadata: socket.requests()[0].metadata } });
    socket.frame({ type: 'response.done', response: { id: 'response-1', status: 'completed', output: [{ type: 'function_call', name: 'search_explore', call_id: 'search-call', arguments: JSON.stringify({ kind: 'images', query: 'Parks', id: null }) }] } });
  };
  return { control, socket, events, fatal, tool };
}

test('voice search waits for browser acknowledgment and continues without further tools', async t => {
  let calls = 0;
  const result = demoExploreResult('Parks', 'images');
  const h = await setup(async () => { calls++; return result; }); t.after(() => h.control.close());
  assert.ok((h.socket.requests()[0].tools as { name: string }[]).some(tool => tool.name === 'search_explore'));
  h.tool(); await flush();
  assert.equal(calls, 1);
  assert.ok(h.events.some(event => event.type === 'activity' && event.activity === 'images'), 'search progress is emitted from actual validated tool work');
  const event = h.events.find(event => event.type === 'navigation'); assert.ok(event?.type === 'navigation');
  assert.equal(event.target.kind, 'explore');
  assert.equal(h.socket.requests().length, 1, 'no speech claims before browser ack');
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 1, ready: true, navigationAck: { id: 'search-call', status: 'applied' },
    context: { explore: { resultId: result.id, kind: 'images', images: result.images.map(({ id, caption }) => ({ id, caption })), selectedImageId: null, map: null } } });
  await flush();
  assert.equal(h.socket.requests().length, 2); assert.deepEqual(h.socket.requests()[1].tools, []);
  assert.match(String(h.socket.requests()[1].instructions), /external search finding/);
  assert.deepEqual(h.fatal, []);
});

test('manual navigation aborts an outstanding voice search and suppresses late results', async t => {
  let signal: AbortSignal | undefined; let finish!: (result: ExploreResult) => void;
  const h = await setup(async (_query, _kind, currentSignal) => { signal = currentSignal; return new Promise(resolve => { finish = resolve; }); });
  t.after(() => h.control.close()); h.tool(); await flush(); assert.ok(signal);
  await h.control.applyControl({ seq: 1, interactionRevision: 1, viewRevision: 0, ready: true, context: {} });
  assert.equal(signal.aborted, true);
  finish(demoExploreResult('Parks', 'images')); await flush();
  assert.equal(h.events.some(event => event.type === 'navigation'), false);
  assert.equal(h.socket.requests().length, 1);
});

test('disabled search is not advertised to voice and cannot be invoked by a forged call', async t => {
  let calls = 0; const h = await setup(async () => { calls++; return demoExploreResult('Parks', 'images'); }, false);
  t.after(() => h.control.close());
  assert.equal((h.socket.requests()[0].tools as { name: string }[]).some(tool => tool.name === 'search_explore'), false);
  h.tool(); await flush();
  assert.equal(calls, 0); assert.equal(h.events.some(event => event.type === 'navigation'), false);
});
