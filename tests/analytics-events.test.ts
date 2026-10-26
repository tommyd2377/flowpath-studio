import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnalyticsEvent, validateAnalyticsObservation,
  type AnalyticsEvent, type AnalyticsObservation } from '../lib/analytics-events';
import { createAnalyticsRecorder, createInMemoryAnalyticsSink, noopAnalyticsSink } from '../lib/analytics-sink';

const id = (index = 1) => `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
const envelope = (observation: AnalyticsObservation, source = 'client') => ({
  schemaVersion: 1, eventId: id(), occurredAt: 1_000, source, platform: 'web', ...observation,
});
const view: AnalyticsObservation = { eventName: 'waveform_viewed', properties: { surface: 'public' } };
const all: AnalyticsObservation[] = [
  { eventName: 'session_visited', properties: { surface: 'home', visit: 'first_in_tab' } },
  { eventName: 'session_visited', properties: { surface: 'account', visit: 'return_in_tab' } }, view,
  { eventName: 'demo_started', properties: {} },
  { eventName: 'demo_ended', properties: { reason: 'limit' } },
  { eventName: 'navigation_selected', properties: { destination: 'news' } },
  { eventName: 'creation_step', properties: { step: 'review_pending', outcome: 'blocked' } },
  { eventName: 'voice_start_requested', properties: { surface: 'private' } },
  { eventName: 'voice_connected', properties: { surface: 'public' } },
  { eventName: 'voice_ended', properties: { surface: 'private', reason: 'user' } },
  { eventName: 'paywall_shown', properties: { mode: 'intro' } },
  { eventName: 'payer_selected', properties: { payer: 'self' } },
  { eventName: 'usage_observed', properties: { seconds: 900, evidence: 'provider_confirmed' } },
  { eventName: 'cost_observed', properties: { amountMicrounits: 123, currency: 'USD', evidence: 'ledger_committed' } },
];

test('allowlisted events cover engagement, navigation, creation, tab-only retention and server metrics', () => {
  for (const event of all) {
    assert.deepEqual(validateAnalyticsObservation(event), event);
    assert.deepEqual(validateAnalyticsEvent(envelope(event, 'server')), envelope(event, 'server'));
  }
  for (const destination of ['home', 'account', 'news', 'private', 'public']) {
    assert.ok(validateAnalyticsObservation({ eventName: 'navigation_selected', properties: { destination } }));
  }
  for (const step of ['opened', 'editing', 'review_pending', 'review_approved', 'review_rejected', 'saved', 'published']) {
    assert.ok(validateAnalyticsObservation({ eventName: 'creation_step', properties: { step, outcome: 'success' } }));
  }
});

test('unknown fields, private payloads, raw errors and persistent identity are rejected at every level', () => {
  const sensitive = ['prompt', 'transcript', 'audio', 'ownerUid', 'providerId', 'sessionId', 'email', 'cookie', 'token', 'error', 'publicWaveformId'];
  for (const key of sensitive) {
    assert.equal(validateAnalyticsObservation({ ...view, [key]: 'private-value' }), null);
    assert.equal(validateAnalyticsObservation({ ...view, properties: { ...view.properties, [key]: 'private-value' } }), null);
    assert.equal(validateAnalyticsEvent({ ...envelope(view), [key]: 'private-value' }), null);
  }
  for (const input of [null, [], 'text', {}, { ...view, eventName: 'private error' },
    { eventName: '__proto__', properties: {} }, { ...view, properties: { surface: 'private-owner' } },
    { ...view, properties: { surface: { toString: () => 'public' } } },
    { ...view, [Symbol('secret')]: 'private' }, new Error('private raw error')]) {
    assert.equal(validateAnalyticsObservation(input), null);
  }
});

test('validators do not invoke accessors or leak failures from hostile objects', () => {
  let accessed = false;
  const getter = { get eventName() { accessed = true; throw new Error('private getter'); }, properties: {} };
  assert.equal(validateAnalyticsObservation(getter), null);
  assert.equal(validateAnalyticsEvent({ ...envelope(view), get source() { accessed = true; return 'server'; } }), null);
  assert.equal(validateAnalyticsObservation(new Proxy({}, { ownKeys() { throw new Error('private proxy'); } })), null);
  assert.equal(accessed, false);
});

test('metrics require server origin, explicit evidence and bounded nonnegative integer observations', () => {
  for (const observation of all.filter(value => ['usage_observed', 'cost_observed'].includes(value.eventName))) {
    assert.equal(validateAnalyticsEvent(envelope(observation)), null);
    assert.ok(validateAnalyticsEvent(envelope(observation, 'server')));
  }
  for (const seconds of [-1, 0.5, NaN, Infinity, 86_401, Number.MAX_SAFE_INTEGER]) {
    assert.equal(validateAnalyticsObservation({ eventName: 'usage_observed', properties: { seconds, evidence: 'provider_confirmed' } }), null);
  }
  for (const amountMicrounits of [-1, 0.5, NaN, Infinity, 1_000_000_000_001]) {
    assert.equal(validateAnalyticsObservation({ eventName: 'cost_observed', properties: { amountMicrounits, currency: 'USD', evidence: 'ledger_committed' } }), null);
  }
  assert.equal(validateAnalyticsObservation({ eventName: 'usage_observed', properties: { seconds: 1, evidence: 'browser_timer' } }), null);
  assert.equal(validateAnalyticsObservation({ eventName: 'cost_observed', properties: { amountMicrounits: 1, currency: 'private', evidence: 'ledger_committed' } }), null);
});

test('invalid event envelopes cannot enter a sink', () => {
  for (const patch of [{ schemaVersion: 2 }, { eventId: 'provider-private-id' }, { occurredAt: -1 },
    { occurredAt: 1.5 }, { occurredAt: Infinity }, { source: 'admin' }, { platform: 'private-agent' }]) {
    assert.equal(validateAnalyticsEvent({ ...envelope(view), ...patch }), null);
  }
  const original = envelope(view);
  const safe = validateAnalyticsEvent(original);
  assert.notEqual(safe, original);
  assert.notEqual(safe?.properties, original.properties);
});

test('no-op default and bounded memory adapter need no vendor, persistent identity or external delivery', () => {
  assert.doesNotThrow(() => noopAnalyticsSink.write(envelope(view) as AnalyticsEvent));
  assert.equal(createAnalyticsRecorder({ source: 'client', platform: 'web', now: () => 1_000, eventId: id }).record(view), true);
  const sink = createInMemoryAnalyticsSink({ maxEvents: 2 });
  let index = 0;
  const recorder = createAnalyticsRecorder({ source: 'client', platform: 'web', sink, now: () => 1_000, eventId: () => id(++index) });
  assert.equal(recorder.record(view), true);
  const copied = sink.snapshot();
  assert.equal(copied.length, 1);
  copied[0].properties = {} as AnalyticsEvent['properties'];
  copied.pop();
  assert.deepEqual(sink.snapshot(), [envelope(view)]);
  sink.write(envelope(view) as AnalyticsEvent);
  assert.equal(sink.snapshot().length, 1, 'duplicate telemetry event IDs do not add records');
  recorder.record(view);
  for (let attempt = 0; attempt < 10; attempt++) recorder.record(view);
  assert.equal(sink.snapshot().length, 2);
  sink.clear();
  assert.deepEqual(sink.snapshot(), []);
  assert.equal(recorder.record(view), true);
  assert.equal(sink.snapshot().length, 1);
  sink.close();
  assert.equal(recorder.record(view), true, 'accepted is not a delivery acknowledgment');
  assert.deepEqual(sink.snapshot(), []);
});

test('closing a recorder prevents late callbacks and rejects private input before generating metadata', () => {
  const sink = createInMemoryAnalyticsSink();
  let generated = 0;
  const recorder = createAnalyticsRecorder({ source: 'client', platform: 'web', sink, eventId: () => { generated++; return id(generated); }, now: () => 0 });
  assert.equal(recorder.record({ ...view, transcript: 'private' }), false);
  assert.equal(generated, 0);
  assert.equal(recorder.record(view), true);
  recorder.close();
  recorder.close();
  assert.equal(recorder.record(view), false);
  assert.equal(generated, 1);
  assert.equal(sink.snapshot().length, 1);
  sink.close();
  assert.deepEqual(sink.snapshot(), []);
});

test('synchronous and asynchronous analytics failures cannot interrupt host cleanup', async () => {
  let cleanups = 0;
  for (const write of [() => { throw new Error('private sync error'); }, async () => { throw new Error('private async error'); }]) {
    const recorder = createAnalyticsRecorder({ source: 'client', platform: 'web', sink: { write }, now: () => 0, eventId: id });
    assert.doesNotThrow(() => { try { recorder.record(view); } finally { cleanups++; } });
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cleanups, 2);
  for (const maxEvents of [0, -1, 1.5, 1_001, Infinity]) assert.throws(() => createInMemoryAnalyticsSink({ maxEvents }), RangeError);
});
