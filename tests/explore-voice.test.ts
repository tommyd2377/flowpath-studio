import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { sampleContent } from '../lib/site-model';
import { DEFAULT_EXPLORE_SETTINGS, demoExploreResult, type ExploreResult } from '../lib/explore-model';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
async function setup(search: (query: string, kind: 'web' | 'images' | 'map', signal: AbortSignal) => Promise<ExploreResult>, enabled = true) {
  const socket = new FakeLiveSocket(), events: VisitorRealtimeEvent[] = [], requests: Record<string, unknown>[] = [];
  const availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
  const control = createVisitorRealtimeControl({ callId: 'live_search', apiKey: 'synthetic', content: { ...sampleContent('general'), visitorSpeaksFirst: true, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled } },
    initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {}, emit: e => events.push(e), onFatal() {}, signal: new AbortController().signal,
    socketFactory: () => socket as unknown as VisitorControlSocket, search,
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: requests.length === 1 ? [liveTool('search_explore', { kind: 'images', query: 'Parks', id: null })] : [liveAnswer()] }); },
  });
  socket.open(); await control.ready; control.start(); socket.user('Find park images'); await flushLive();
  return { control, socket, events, requests };
}
test('Live search requires browser acknowledgement before describing its result', async t => {
  const result = demoExploreResult('Parks', 'images'); const h = await setup(async () => result); t.after(() => h.control.close());
  const navigation = h.events.find(e => e.type === 'navigation'); assert.ok(navigation); assert.equal(h.requests.length, 1);
  assert.ok(h.events.some(e => e.type === 'activity' && e.activity === 'images'));
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 0, ready: true, context: {}, navigationAck: { id: navigation.id, status: 'applied' } }); await flushLive();
  assert.equal(h.requests.length, 2);
  assert.ok((h.requests[1].tools as { name: string }[]).some(tool => tool.name === 'search_explore'), 'later steps retain enabled capabilities after the browser acknowledgment');
  assert.match(JSON.stringify(h.requests[1].input), /external/);
});
test('image search reports an empty validated result without claiming a view was applied', async t => {
  const empty = { ...demoExploreResult('Parks', 'images'), images: [], answer: 'No displayable image results were returned. Try a more specific image search.' };
  const h = await setup(async () => empty); t.after(() => h.control.close());
  assert.ok(!h.events.some(e => e.type === 'navigation'));
  assert.deepEqual(h.events.filter(e => e.type === 'task_error').map(e => e.type === 'task_error' ? e.message : ''), [empty.answer]);
  assert.equal(h.requests.length, 1);
  assert.ok(h.socket.sent.some(event => event.type === 'session.commentary.append' && String(event.content).includes('No displayable image results')));
});
test('manual browsing aborts search and suppresses late navigation', async t => {
  let signal!: AbortSignal, finish!: (result: ExploreResult) => void;
  const h = await setup(async (_query, _kind, current) => { signal = current; return new Promise(resolve => { finish = resolve; }); }); t.after(() => h.control.close());
  await h.control.applyControl({ seq: 1, interactionRevision: 1, viewRevision: 0, ready: true, context: {} }); assert.equal(signal.aborted, true);
  finish(demoExploreResult('Parks', 'images')); await flushLive(); assert.ok(!h.events.some(e => e.type === 'navigation'));
});
test('disabled publisher search cannot execute an invented backend tool', async t => {
  let calls = 0; const h = await setup(async () => { calls++; return demoExploreResult('Parks', 'images'); }, false); t.after(() => h.control.close());
  assert.equal(calls, 0); assert.equal(h.requests.length, 1);
});
