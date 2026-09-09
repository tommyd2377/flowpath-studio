import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendPlatformEvents, platformEventInputSchema, readPlatformEventSummary, recordPlatformEvent } from '../lib/platform-events';
import { measuredUsage } from '../lib/provider-usage';

test('event records reject raw text, invented conversion types and unsafe metrics', () => {
  assert.equal(platformEventInputSchema.safeParse({ type: 'outcome', surface: 'public', kind: 'display', text: 'private request' }).success, false);
  assert.equal(platformEventInputSchema.safeParse({ type: 'paid_conversion', surface: 'public' }).success, false);
  assert.equal(platformEventInputSchema.safeParse({ type: 'extraction', surface: 'preview', durationMs: Infinity }).success, false);
  assert.equal(platformEventInputSchema.safeParse({ type: 'outcome', surface: 'public', kind: 'link_click', capabilityId: 'javascript:bad' }).success, false);
  const event = appendPlatformEvents(undefined, [{ type: 'provider_usage', surface: 'public', usage: undefined, snapshotId: undefined }]).events[0];
  assert.equal(Object.hasOwn(event, 'usage'), false);
  assert.equal(Object.hasOwn(event, 'snapshotId'), false);
  assert.equal(measuredUsage(undefined), undefined);
  assert.equal(measuredUsage({ input_tokens: '100', output_tokens: -2 }), undefined);
  assert.deepEqual(measuredUsage({ input_tokens: 100, output_tokens: 20, total_tokens: 120, price: 999 }), { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
});

test('a rolling event window stays bounded and distinguishes preview from public observations', () => {
  let ledger: ReturnType<typeof appendPlatformEvents> | undefined;
  for (let index = 0; index < 25; index++) ledger = appendPlatformEvents(ledger, Array.from({ length: 10 }, () => ({ type: 'publication', surface: 'public', status: 'succeeded' })), 'server', index);
  assert.equal(ledger!.events.length, 200);
  assert.equal(ledger!.totalRecorded, 250);
  ledger = appendPlatformEvents(ledger, [{ type: 'outcome', surface: 'preview', kind: 'selection' }], 'owner_client', 1000);
  assert.equal(ledger.events.at(-1)?.source, 'owner_client');
  assert.equal(ledger.events.at(-1)?.surface, 'preview');
});

test('replayed event IDs deduplicate and client observations have a bounded write rate', () => {
  const input = { eventId: '00000000-0000-4000-8000-000000000001', type: 'outcome' as const, surface: 'public' as const, kind: 'display' as const };
  let ledger = appendPlatformEvents(undefined, [input, input], 'visitor_client', 1000);
  assert.equal(ledger.events.length, 1);
  for (let index = 0; index < 20; index++) ledger = appendPlatformEvents(ledger, Array.from({ length: 10 }, () => ({ type: 'outcome', surface: 'public', kind: 'display' })), 'visitor_client', 1000);
  assert.equal(ledger.events.length, 120);
  const withServer = appendPlatformEvents(ledger, [{ type: 'publication', surface: 'public' }], 'server', 1000);
  assert.equal(withServer.events.length, 121);
});

test('concurrent local event writes retain every completed event in a separate bounded ledger', async () => {
  const path = await mkdtemp(join(tmpdir(), 'platform-events-test-'));
  const previousDirectory = process.env.VOICE_DATA_DIR;
  const previousBackend = process.env.VOICE_BACKEND;
  process.env.VOICE_DATA_DIR = path;
  process.env.VOICE_BACKEND = 'demo';
  try {
    const siteId = '00000000-0000-4000-8000-000000000099';
    await Promise.all(Array.from({ length: 30 }, (_, index) => recordPlatformEvent(siteId, {
      type: 'provider_usage', surface: 'preview', requestId: `request-${index}`, kind: 'text', status: index % 2 ? 'confirmed' : 'unknown',
      ...(index % 2 ? { usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } } : {}),
    })));
    const summary = await readPlatformEventSummary(siteId);
    assert.equal(summary.retained, 30);
    assert.equal(summary.totalRecorded, 30);
    assert.equal(summary.window, 'recent_events');
    assert.equal(summary.counts['preview:server:provider_usage:text:unknown'], 15);
    assert.equal(summary.counts['preview:server:provider_usage:text:confirmed'], 15);
  } finally {
    if (previousDirectory === undefined) delete process.env.VOICE_DATA_DIR; else process.env.VOICE_DATA_DIR = previousDirectory;
    if (previousBackend === undefined) delete process.env.VOICE_BACKEND; else process.env.VOICE_BACKEND = previousBackend;
    await rm(path, { recursive: true, force: true });
  }
});
