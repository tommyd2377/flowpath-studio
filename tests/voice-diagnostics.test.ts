import assert from 'node:assert/strict';
import test from 'node:test';
import { createVoiceDiagnostics, type VoiceDiagnosticFinishReason, type VoiceDiagnosticLifecycle } from '../lib/voice-diagnostics';

const input = (delta: string, start_ms = 0, end_ms = 100) => ({ type: 'session.input_transcript.delta', delta, start_ms, end_ms });
const output = (delta: string, start_ms = 0, end_ms = 100) => ({ type: 'session.output_transcript.delta', delta, start_ms, end_ms });

test('diagnostics preserve overlapping transcript fragments and only relative capture timing', () => {
  let now = 1_000;
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => now });
  capture.lifecycle('connecting');
  now += 20;
  capture.providerEvent(input('I’d like', 20, 300));
  now += 10;
  capture.providerEvent(output('Sure.', 200, 350));
  capture.providerEvent(input(' to ask a question.', 300, 700));
  assert.equal(capture.mark(), true);
  const report = capture.snapshot();
  assert.equal(report.format, 'flowpath-voice-diagnostics');
  assert.equal(report.version, 1);
  assert.equal(report.app, 'FlowPath Studio');
  assert.equal(report.model, 'gpt-live-1');
  assert.equal(report.surface, 'public');
  assert.equal(report.recording, true);
  assert.equal(report.truncated, false);
  assert.deepEqual(report.events, [
    { type: 'lifecycle', name: 'connecting', atMs: 0 },
    { type: 'input_transcript', delta: 'I’d like', startMs: 20, endMs: 300, atMs: 20 },
    { type: 'output_transcript', delta: 'Sure.', startMs: 200, endMs: 350, atMs: 30 },
    { type: 'input_transcript', delta: ' to ask a question.', startMs: 300, endMs: 700, atMs: 30 },
    { type: 'marker', atMs: 30 },
  ]);
  now -= 40;
  capture.lifecycle('connected');
  assert.equal(capture.snapshot().events.at(-1)?.atMs, 30, 'a clock correction cannot reverse relative time');
});

test('provider metadata is explicitly selected without retaining secrets, IDs, prompts, snapshots or audio', () => {
  const capture = createVoiceDiagnostics({ surface: 'personal', now: () => 10 });
  const privateFields = { event_id: 'private-event-id', client_event_id: 'private-command-id', cookie: 'private-cookie',
    session: { id: 'private-provider-id', instructions: 'private-prompt', input: [{ text: 'private-history' }] },
    audio: 'private-audio', sdp: 'private-sdp', token: 'private-token' };
  capture.providerEvent({ ...privateFields, ...input('Allowed transcript.') });
  capture.providerEvent({ ...privateFields, type: 'session.started' });
  capture.providerEvent({ ...privateFields, type: 'session.delegation.created', offset_ms: 100,
    delegation: { type: 'delegation', target: 'client', id: 'private-delegation-id', response_id: 'private-response-id', task: 'private-task' } });
  capture.providerEvent({ ...privateFields, type: 'session.usage.updated', usage: { seconds: 12, prompt: 'private-usage' },
    context_window: { usage_ratio: 0.2, internal: 'private-context' } });
  capture.providerEvent({ ...privateFields, type: 'error', error: { type: 'private-error-type', code: 'private-error-code',
    message: 'private-secret-message', param: 'private-param', client_event_id: 'private-error-command' } });
  capture.providerEvent({ ...privateFields, type: 'session.closed', reason: 'close_requested', usage: { seconds: 15 } });
  capture.providerEvent({ ...privateFields, type: 'session.output_audio.delta', delta: 'private-output-audio' });
  capture.providerEvent({ ...privateFields, type: 'unknown', data: 'private-unknown-data' });
  const report = capture.snapshot();
  assert.equal(report.surface, 'personal');
  assert.deepEqual(report.events, [
    { type: 'input_transcript', delta: 'Allowed transcript.', startMs: 0, endMs: 100, atMs: 0 },
    { type: 'session_started', atMs: 0 },
    { type: 'delegation_created', target: 'client', offsetMs: 100, atMs: 0 },
    { type: 'usage', seconds: 12, contextUsageRatio: 0.2, atMs: 0 },
    { type: 'provider_error', atMs: 0 },
    { type: 'session_closed', reason: 'close_requested', seconds: 15, finalizationConfirmed: true, atMs: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /private-|event_id|client_event_id|sessionId|ownerUid|delegation_id|sdp|cookie|instructions|audio/);
});

test('only recognized unavailable-context acknowledgments are recorded without claiming speech or exposing IDs', () => {
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  const ack = { type: 'session.commentary.appended', event_id: 'secret-event', start_ms: 5, end_ms: 10 };
  for (const id of [undefined, 'flowpath_greeting', 'other_command', 'flowpath_unavailable_0', 'flowpath_unavailable_1-secret']) {
    capture.providerEvent({ ...ack, client_event_id: id });
  }
  capture.providerEvent({ ...ack, client_event_id: 'flowpath_unavailable_1', content: 'private-context' });
  assert.deepEqual(capture.snapshot().events, [{ type: 'unavailable_context_accepted', startMs: 5, endMs: 10, atMs: 0 }]);
  assert.doesNotMatch(JSON.stringify(capture.snapshot()), /flowpath_unavailable|private-context|secret-event|played|spoken|intent|thought/);
});

test('malformed event shapes, timings and usage cannot enter the report or interrupt capture', () => {
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  for (const event of [null, [], 'text', {}, input('bad', -1, 2), input('bad', 5, 2), input('bad', NaN, 2),
    input('bad', 1, Infinity), input('bad', 0, Number.MAX_VALUE), { ...input('bad'), delta: 42 },
    { type: 'session.delegation.created', offset_ms: -1, delegation: { type: 'delegation', target: 'client' } },
    { type: 'session.delegation.created', offset_ms: 0, delegation: { type: 'delegation', target: 'private-target' } },
    { type: 'session.delegation.created', offset_ms: 0, delegation: { type: 'delegation', target: { toString: () => 'client', secret: 'private-target' } } },
    { type: 'session.usage.updated', usage: { seconds: NaN } },
    { type: 'session.closed', reason: 'private-reason', usage: { seconds: 1 } },
    { type: 'session.closed', reason: 'expired', usage: { seconds: -1 } },
    { type: 'session.commentary.appended', client_event_id: 'flowpath_unavailable_1', start_ms: 3, end_ms: 2 },
    { get type() { throw new Error('private-getter'); } },
  ]) assert.doesNotThrow(() => capture.providerEvent(event));
  assert.deepEqual(capture.snapshot().events, []);
  capture.lifecycle('private-lifecycle' as VoiceDiagnosticLifecycle);
  assert.deepEqual(capture.snapshot().events, []);
  capture.providerEvent(input('Still recording.'));
  assert.equal(capture.snapshot().events.length, 1);
});

test('diagnostics bound transcripts and mark dropped oversized deltas without retaining their contents', () => {
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  capture.providerEvent(input('x'.repeat(8_001)));
  assert.deepEqual(capture.snapshot().events, [{ type: 'capture_truncated', reason: 'oversized_delta', atMs: 0 }]);
  for (let index = 0; index < 15; index++) capture.providerEvent(input('a'.repeat(8_000)));
  capture.providerEvent(output('Do not retain this over-budget text.'));
  const report = capture.snapshot();
  const characters = report.events.reduce((count, event) => count + ('delta' in event ? event.delta.length : 0), 0);
  assert.equal(characters, 120_000);
  assert.equal(report.truncated, true);
  assert.doesNotMatch(JSON.stringify(report), /Do not retain|xxxxxxxx/);
  const combined = createVoiceDiagnostics({ surface: 'personal', now: () => 0 });
  for (let index = 0; index < 15; index++) combined.providerEvent(index % 2 ? input('a'.repeat(8_000)) : output('b'.repeat(8_000)));
  combined.providerEvent(input('one too many'));
  assert.equal(combined.snapshot().events.at(-1)?.type, 'capture_truncated');
  assert.equal(combined.snapshot().truncated, true);
});

test('event floods cannot exceed the bounded report or hide that events were dropped', () => {
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  for (let index = 0; index < 2_000; index++) assert.equal(capture.mark(), true);
  const accepted = capture.snapshot().events;
  for (let index = 0; index < 100; index++) assert.equal(capture.mark(), false);
  const report = capture.snapshot();
  assert.equal(report.events.length, 2_000);
  assert.equal(report.truncated, true);
  assert.deepEqual(report.events.at(-1), { type: 'marker', atMs: 0 }, 'the successful final marker survives overflow');
  assert.deepEqual(report.events, accepted, 'overflow cannot replace any previously accepted event');
  assert.equal(capture.mark(), false, 'a full recorder must not report a successfully added marker');
  capture.finish('user_stop');
  assert.equal(capture.snapshot().recording, false);
  assert.equal(capture.snapshot().events.length, 2_000);
});

test('finish is idempotent and a snapshot cannot mutate the retained report', () => {
  const capture = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  capture.providerEvent(input('Keep until cleared.'));
  capture.finish('user_stop');
  capture.finish('connection_error');
  capture.providerEvent(input('Must not capture after finish.'));
  capture.lifecycle('ended');
  assert.equal(capture.mark(), false);
  const report = capture.snapshot();
  assert.equal(report.recording, false);
  assert.deepEqual(report.events.at(-1), { type: 'recording_finished', reason: 'user_stop', atMs: 0 });
  assert.equal(report.events.length, 2);
  report.events[0].type = 'provider_error';
  report.events.pop();
  assert.equal(capture.snapshot().events[0].type, 'input_transcript');
  assert.equal(capture.snapshot().events.length, 2);
  const invalidReason = createVoiceDiagnostics({ surface: 'public', now: () => 0 });
  invalidReason.finish('private-freeform-reason' as VoiceDiagnosticFinishReason);
  assert.deepEqual(invalidReason.snapshot().events, [{ type: 'recording_finished', reason: 'capture_stopped', atMs: 0 }]);
});

test('clearing a running recorder discards captured text and permanently prevents late capture', () => {
  const capture = createVoiceDiagnostics({ surface: 'personal', now: () => 0 });
  capture.providerEvent(input('Discard this private conversation.'));
  capture.clear();
  capture.providerEvent(output('Late provider event.'));
  capture.lifecycle('playback_started');
  assert.equal(capture.mark(), false);
  capture.finish('session_closed');
  const report = capture.snapshot();
  assert.deepEqual(report.events, []);
  assert.equal(report.recording, false);
  assert.equal(report.truncated, false);
  assert.doesNotMatch(JSON.stringify(report), /Discard|Late provider/);
});
