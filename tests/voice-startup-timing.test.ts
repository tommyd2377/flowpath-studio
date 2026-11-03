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
