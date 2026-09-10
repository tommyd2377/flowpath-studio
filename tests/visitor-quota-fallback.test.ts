import assert from 'node:assert/strict';
import test from 'node:test';
import { currentLedger, reserveReply, VisitorLimitError } from '../lib/visitor-quota';
import { DEFAULT_VISITOR_SETTINGS, GLOBAL_VISITOR_LIMITS, visitorSettingsSchema } from '../lib/visitor-model';

test('published voice allowances can exceed 20 and remain bounded at 100', () => {
  const settings = visitorSettingsSchema.parse({ ...DEFAULT_VISITOR_SETTINGS, voiceDailyLimit: 100 });
  assert.equal(visitorSettingsSchema.safeParse({ ...settings, voiceDailyLimit: 101 }).success, false);
  const ledger = currentLedger(undefined);
  for (let turn = 1; turn <= 100; turn++) {
    const state = reserveReply(ledger, 'publisher', `voice-${turn}`, 'voice', settings, true);
    assert.equal(state.voiceRemaining, 100 - turn);
  }
  assert.throws(() => reserveReply(ledger, 'publisher', 'over-site', 'voice', settings, true), VisitorLimitError);
  assert.throws(() => reserveReply(ledger, 'another-publisher', 'over-global', 'voice', settings, true), VisitorLimitError);
});

test('voice-preferred sites allow independently capped chat before voice exhaustion', () => {
  const ledger = currentLedger(undefined);
  const settings = { ...DEFAULT_VISITOR_SETTINGS, chatDailyLimit: 2 };
  const first = reserveReply(ledger, 'publisher', 'typed-1', 'chat', settings, true);
  assert.equal(first.voiceRemaining, settings.voiceDailyLimit); assert.equal(first.chatRemaining, 1);
  assert.deepEqual(ledger.totals, { chat: 1, voice: 0 });
  assert.throws(() => reserveReply(ledger, 'publisher', 'typed-1', 'chat', settings, true), /already received/);
  reserveReply(ledger, 'publisher', 'typed-2', 'chat', settings, true);
  assert.throws(() => reserveReply(ledger, 'publisher', 'typed-3', 'chat', settings, true), VisitorLimitError);
  assert.deepEqual(ledger.totals, { chat: 2, voice: 0 });
  assert.equal(ledger.requests['typed-3'], undefined);
});

test('text fallback still obeys global caps and conversation enablement', () => {
  const ledger = currentLedger(undefined); ledger.totals.chat = GLOBAL_VISITOR_LIMITS.chat;
  assert.throws(() => reserveReply(ledger, 'publisher', 'global', 'chat', DEFAULT_VISITOR_SETTINGS, true), VisitorLimitError);
  assert.throws(() => reserveReply(currentLedger(undefined), 'publisher', 'disabled', 'chat', { ...DEFAULT_VISITOR_SETTINGS, enabled: false }, true), /not enabled/);
  assert.throws(() => reserveReply(currentLedger(undefined), 'publisher', 'voice', 'voice', { ...DEFAULT_VISITOR_SETTINGS, mode: 'chat' }, true), /not enabled/);
  assert.equal(ledger.requests.global, undefined);
});
