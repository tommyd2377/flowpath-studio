import assert from 'node:assert/strict';
import test from 'node:test';
import { createStartupTiming } from '../lib/voice-startup-timing';

test('startup timing uses click-relative monotonic marks, only once, and ignores late events after stop', () => {
  let now = 120;
  const timing = createStartupTiming(100, () => now);
  timing.mark('previous_cleanup_ready');
  now = 140;
  timing.mark('readiness_complete');
  now = 130;
  timing.mark('microphone_requested');
  timing.mark('microphone_requested');
  timing.finish();
  now = 200;
  timing.mark('first_audible_output');
  assert.deepEqual(timing.snapshot().events, [
    { name: 'click', atMs: 0 }, { name: 'previous_cleanup_ready', atMs: 20 },
    { name: 'readiness_complete', atMs: 40 }, { name: 'microphone_requested', atMs: 40 }, { name: 'stopped', atMs: 40 },
  ]);
});

test('startup report accepts only bounded fixed server phase durations, never header descriptions or content', () => {
  const timing = createStartupTiming(0, () => 1);
  timing.serverTiming('readiness', 'fp_scope;dur=250.5, secret;dur=9, fp_provider;desc="secret";dur=1, fp_persist;dur=-1');
  timing.serverTiming('readiness', 'fp_scope;dur=999, fp_provider;dur=999999');
  timing.serverTiming('session', 'fp_scope;dur=80, fp_provider;dur=320, fp_supervision;dur=12');
  timing.mark('secret' as Parameters<typeof timing.mark>[0]);
  assert.deepEqual(timing.snapshot().server, [
    { request: 'readiness', name: 'fp_scope', durationMs: 250.5 },
    { request: 'session', name: 'fp_scope', durationMs: 80 },
    { request: 'session', name: 'fp_provider', durationMs: 320 },
    { request: 'session', name: 'fp_supervision', durationMs: 12 },
  ]);
  assert.doesNotMatch(JSON.stringify(timing.snapshot()), /secret|desc|transcript|token|sdp/);
  const snapshot = timing.snapshot(); snapshot.events.length = 0; snapshot.server.length = 0;
  assert.equal(timing.snapshot().events.length, 1);
  assert.equal(timing.snapshot().server.length, 4);
});

test('permission snapshot cannot be filled from a late query after capture began', () => {
  const timing = createStartupTiming(0, () => 1);
  timing.permission('prompt');
  timing.mark('microphone_requested');
  timing.permission('granted');
  assert.equal(timing.snapshot().permissionBeforeCapture, 'prompt');
});

test('readiness preparation has separate finite, rounded, click-relative timing and is copied on snapshot', () => {
  const timing = createStartupTiming(100.25, () => 101);
  timing.mark('readiness_wait_started');
  timing.preparation('ready', 25.08, 80.12);
  timing.mark('prepared_readiness_used');
  assert.deepEqual(timing.snapshot().readinessPreparation, {
    source: 'ready', durationMs: 55, startedBeforeClickMs: 75.2, completedBeforeClickMs: 20.1,
  });
  const snapshot = timing.snapshot();
  snapshot.readinessPreparation!.durationMs = 999;
  timing.preparation('cold', 0, 999);
  assert.equal(timing.snapshot().readinessPreparation?.durationMs, 55);
  assert.doesNotMatch(JSON.stringify(timing.snapshot()), /transcript|secret|token|sdp/);
});

test('preparation durations clamp negative values; invalid or late input is ignored', () => {
  const timing = createStartupTiming(100, () => 110);
  timing.preparation('secret' as 'ready', 1, 2);
  timing.preparation('ready', NaN, 2);
  timing.preparation('ready', 1, Infinity);
  assert.equal(timing.snapshot().readinessPreparation, undefined);
  timing.preparation('pending', 130, 120);
  assert.deepEqual(timing.snapshot().readinessPreparation, {
    source: 'pending', durationMs: 0, startedBeforeClickMs: 0, completedBeforeClickMs: 0,
  });
  const stopped = createStartupTiming(100, () => 110);
  stopped.finish();
  stopped.preparation('cold', 0, 100);
  assert.equal(stopped.snapshot().readinessPreparation, undefined);
});

test('preparation numbers remain finite for extreme inputs', () => {
  const timing = createStartupTiming(0, () => 0);
  timing.preparation('cold', 0, Number.MAX_VALUE);
  assert.ok(Number.isFinite(timing.snapshot().readinessPreparation?.durationMs));
});
