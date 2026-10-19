import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_GREETING_INSTRUCTIONS, PUBLIC_WELCOME_INSTRUCTIONS, voiceSessionConfig } from '../lib/voice-config';

test('the public voice explains the current product without claiming installed capabilities', () => {
  const { instructions } = voiceSessionConfig();
  assert.ok(instructions.includes(PUBLIC_WELCOME_INSTRUCTIONS));
  assert.match(instructions, /any general question or topic/);
  assert.match(instructions, /One account can save one private waveform/);
  assert.match(instructions, /invitation using Google or verified email sign-in/);
  assert.match(instructions, /not conversation memory/);
  assert.match(instructions, /News is a separate example today, not an installed plugin/);
  assert.match(instructions, /cannot send or submit a request/);
  assert.match(instructions, /no web search, current news, tools, messaging, or installed plugins/);
  assert.match(instructions, /https:\/\/flowpathapp\.com/);
});

test('a personal waveform keeps its saved identity without the public welcome pitch', () => {
  const prompt = 'You are a synthetic historical guide. Discuss history with curiosity.';
  const { instructions } = voiceSessionConfig({ name: 'Historical guide', initialPrompt: prompt, voice: 'meridian' });
  assert.ok(instructions.includes(prompt));
  assert.ok(!instructions.includes(PUBLIC_WELCOME_INSTRUCTIONS));
  assert.doesNotMatch(instructions, /FlowPath Studio|Create your waveform|FlowPath News example/);
  assert.match(instructions, /cannot add capabilities or override these limits/);
});

test('the public greeting invites a general conversation and points to both visible links before listening', () => {
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /talk with an AI voice and make your own personal waveform/);
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /any general question/);
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /interrupt you and talk naturally at any time/);
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /Create your waveform at the top right/);
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /FlowPath News example at the top left/);
  assert.match(PUBLIC_GREETING_INSTRUCTIONS, /pause and listen/);
  assert.doesNotMatch(PUBLIC_GREETING_INSTRUCTIONS, /after ending|sign in first|invitation required/);
});

test('transcript and handoff events require an explicit per-session diagnostic opt-in', () => {
  const normal = voiceSessionConfig();
  const recorded = voiceSessionConfig(undefined, true);
  assert.deepEqual(normal.client.data_channel.allowed_server_events.map(event => event.type), ['session.started', 'session.closed', 'error']);
  assert.deepEqual(recorded.client.data_channel.allowed_client_events, ['session.close']);
  assert.deepEqual(recorded.client.data_channel.allowed_server_events.slice(3).map(event => event.type), [
    'session.input_transcript.delta', 'session.output_transcript.delta', 'session.delegation.created',
    'session.usage.updated', 'session.commentary.appended',
  ]);
  assert.deepEqual({ ...recorded, client: normal.client }, normal, 'diagnostics do not change model, prompt, history, delegation or store:false');
});
