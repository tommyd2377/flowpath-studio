import assert from 'node:assert/strict';
import test from 'node:test';
import { createVisitorLiveContext } from '../lib/visitor-live-context';
import type { LiveSocket } from '../lib/gpt-live/runtime';
import { FakeLiveSocket } from './helpers/live-fixture';
import { visitorScreenSummary } from '../lib/visitor-screen-summary';
import type { InformationSurfaceContext } from '@thevoice/platform-ui/surface';

test('a large gallery reports current visibility atomically without hundreds of reference IDs', () => {
  const region = { id: 'gallery', kind: 'collection' as const, role: 'primary' as const, title: '作品集 '.repeat(20), referenceIds: Array.from({ length: 48 }, (_, i) => `photo:uuid-${i}`), visibleReferenceIds: ['photo:uuid-0', 'photo:uuid-1'], itemCount: 57, visible: true, selectedId: null };
  const surface: InformationSurfaceContext = { version: 1, stateId: 'state', requestId: null, tenantId: 'synthetic', publicationId: 'published', revision: 9999, status: 'committed', layout: 'collection', subject: [], regions: [region, { ...region, id: 'other', role: 'supporting', kind: 'information', visible: false, visibleReferenceIds: [] }, { ...region, id: 'third', role: 'supporting', kind: 'comparison', visible: false, visibleReferenceIds: [] }], answer: '', pendingRequestId: null, previous: [], reading: { scrollTop: 0, blockId: null } };
  const summary = visitorScreenSummary(surface);
  assert.ok(Buffer.byteLength(summary) <= 420, `${Buffer.byteLength(summary)} bytes`);
  assert.match(summary, /2\/57 items visible/); assert.match(summary, /offscreen; 0\/57/);
  assert.doesNotMatch(summary, /uuid-/);
  const socket = new FakeLiveSocket(), channel = createVisitorLiveContext(socket as unknown as LiveSocket); socket.open();
  channel.publish('screen', summary);
  assert.equal(socket.sent.length, 1); assert.match(String(socket.sent[0].content), /part 1\/1/);
  channel.dispose();
});

test('slow context acknowledgments bound traffic and discard obsolete unsent snapshots', () => {
  const socket = new FakeLiveSocket(); socket.acknowledgeAppends = false;
  const channel = createVisitorLiveContext(socket as unknown as LiveSocket); socket.open();
  channel.publish('screen', 'Old screen '.repeat(3000));
  channel.publish('reading', 'Old scroll position');
  for (let i = 0; i < 18; i++) channel.publish('screen', `Intermediate screen ${i} `.repeat(1000));
  const latest = '最新資料 '.repeat(500) + ' Exact phone +1 212 555 0194';
  channel.publish('screen', latest);
  assert.equal(socket.sent.length, 1, 'only one quiet context append may await acknowledgment');
  socket.frame({ type: 'session.thinking.appended', client_event_id: 'unrelated' }); assert.equal(socket.sent.length, 1);
  const ack = (id: unknown) => socket.frame({ type: 'session.thinking.appended', client_event_id: id, start_ms: 0, end_ms: 1 });
  const firstId = socket.sent[0].event_id;
  ack(firstId); assert.equal(socket.sent.length, 2);
  ack(firstId); assert.equal(socket.sent.length, 2, 'duplicate acknowledgments never drain another part');
  for (let i = 1; i < socket.sent.length; i++) { assert.ok(i < 100); ack(socket.sent[i].event_id); }
  assert.ok(socket.sent.every(event => Buffer.byteLength(String(event.content)) <= 480));
  const received = socket.sent.slice(1).map(event => String(event.content).replace(/^\[screen \d+ part \d+\/\d+\] /, '')).join('');
  assert.equal(received, latest, 'whole latest facts survive; abandoned remaining parts and reading positions do not');
  assert.ok(socket.sent.every(event => event.type === 'session.thinking.append' && event.delegation_id === null));
  channel.publish('screen', 'Pending screen '.repeat(100)); const before = socket.sent.length;
  channel.dispose(); ack(socket.sent.at(-1)?.event_id); channel.publish('screen', 'Closed'); assert.equal(socket.sent.length, before);
});

test('context rejection never schedules retries or sends further queued parts', () => {
  const socket = new FakeLiveSocket(); socket.acknowledgeAppends = false;
  const channel = createVisitorLiveContext(socket as unknown as LiveSocket); socket.open(); channel.publish('screen', 'Large screen '.repeat(1000));
  assert.throws(() => channel.publish('reading', 'x'.repeat(96_001)), /exceeded/);
  socket.frame({ type: 'error', error: { client_event_id: socket.sent[0].event_id, code: 'too_many_pending_appends' } });
  channel.publish('screen', 'Later screen'); socket.frame({ type: 'session.thinking.appended', client_event_id: socket.sent[0].event_id });
  assert.equal(socket.sent.length, 1);
});

test('a new visible selection overtakes queued prose without losing the complete reference content', () => {
  const socket = new FakeLiveSocket(); socket.acknowledgeAppends = false;
  const channel = createVisitorLiveContext(socket as unknown as LiveSocket); socket.open();
  const reference = 'Complete published context. '.repeat(200) + 'Exact final condition.';
  channel.publish('content', reference);
  channel.publish('screen', 'Selected photo A');
  channel.publish('screen', 'Selected photo B');
  const ack = (id: unknown) => socket.frame({ type: 'session.thinking.appended', client_event_id: id });
  ack(socket.sent[0].event_id);
  assert.match(String(socket.sent[1].content), /Selected photo B/);
  for (let i = 1; i < socket.sent.length; i++) { assert.ok(i < 100); ack(socket.sent[i].event_id); }
  const delivered = socket.sent.filter(event => String(event.content).startsWith('[content ')).map(event => String(event.content).replace(/^\[content \d+ part \d+\/\d+\] /, '')).join('');
  assert.equal(delivered, reference);
  assert.equal(socket.sent.some(event => String(event.content).includes('Selected photo A')), false);
});

test('changing visibility does not discard queued conversation memory or speak it as a new answer', () => {
  const socket = new FakeLiveSocket(); socket.acknowledgeAppends = false;
  const channel = createVisitorLiveContext(socket as unknown as LiveSocket); socket.open();
  const memory = 'Historical evidence, with its exact conditions. '.repeat(80) + 'Only applies to the stated destination.';
  channel.publish('memory', memory);
  channel.publish('screen', 'A different item is now open.');
  channel.publish('screen', 'Home: no information card is visible.');
  const ack = (id: unknown) => socket.frame({ type: 'session.thinking.appended', client_event_id: id });
  ack(socket.sent[0].event_id);
  assert.match(String(socket.sent[1].content), /Home: no information card is visible/);
  for (let i = 1; i < socket.sent.length; i++) { assert.ok(i < 100); ack(socket.sent[i].event_id); }
  const delivered = socket.sent.filter(event => String(event.content).startsWith('[memory '))
    .map(event => String(event.content).replace(/^\[memory \d+ part \d+\/\d+\] /, '')).join('');
  assert.equal(delivered, memory);
  assert.ok(socket.sent.every(event => event.type === 'session.thinking.append' && event.delegation_id === null));
});
