import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_GREETING_INSTRUCTIONS, PUBLIC_WELCOME_INSTRUCTIONS, VOICE_BACKEND_MODEL, VOICE_BACKEND_MAX_OUTPUT_TOKENS, voiceSessionConfig } from '../lib/voice-config';

test('the public voice explains the current product without claiming installed capabilities', () => {
  const { instructions } = voiceSessionConfig();
  assert.ok(instructions.includes(PUBLIC_WELCOME_INSTRUCTIONS));
  assert.match(instructions, /any general question or topic/);
  assert.match(instructions, /One account can save one private waveform/);
  assert.match(instructions, /invitation using Google or verified email sign-in/);
  assert.match(instructions, /not conversation memory/);
  assert.match(instructions, /News is a separate example today, not an installed plugin/);
  assert.match(instructions, /apply the Text Box plugin in waveform settings/);
  assert.match(instructions, /not enabled in this homepage demo/);
  assert.match(instructions, /cannot send or submit a request/);
  assert.match(instructions, /no web search, current news, external tools, messaging, or installed plugins/);
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


test('managed delegation defaults to GPT-6 Luna with bounded output and no reasoning or search tools', () => {
  const config = voiceSessionConfig({ name: 'Historical persona', initialPrompt: 'P'.repeat(15000) });
  assert.equal(config.delegation.type, 'responses');
  assert.equal(VOICE_BACKEND_MODEL, 'gpt-6-luna');
  const backend = config.delegation.responses;
  assert.equal(backend.model, VOICE_BACKEND_MODEL);
  assert.deepEqual(backend.reasoning, { effort: 'none' });
  assert.equal(backend.max_output_tokens, VOICE_BACKEND_MAX_OUTPUT_TOKENS);
  assert.equal(backend.service_tier, 'default');
  assert.deepEqual(backend.tools, []); assert.equal(backend.tool_choice, 'none');
  assert.equal(backend.parallel_tool_calls, false);
  assert.ok(config.instructions.includes('P'.repeat(15000)));
  assert.ok(backend.instructions.includes('P'.repeat(15000)));
  assert.match(config.instructions, /Generate <\|SpawnThinking\|>/);
  assert.match(config.instructions, /dates and biographical facts/);
  assert.match(config.instructions, /Let me think about that for a moment/);
  assert.match(config.instructions, /express it naturally in the saved persona/);
  assert.match(backend.instructions, /fact need not appear in the saved persona prompt/);
  assert.equal(config.store, false); assert.deepEqual(config.input, []);
});

test('only an explicitly enabled Text Box grants its local tools and transcript stream', () => {
  const waveform = { name: 'Text assistant', initialPrompt: 'Use a friendly voice.' };
  for (const textPanel of [undefined, null, { type: 'text', version: 1, text: 'Legacy creator content' }] as const) {
    const config = voiceSessionConfig({ ...waveform, textPanel });
    assert.deepEqual(config.delegation.responses.tools, []);
    assert.deepEqual(config.client.data_channel.allowed_client_events, ['session.close']);
  }
  const config = voiceSessionConfig({ ...waveform, textPanel: { type: 'text', version: 2 } });
  assert.equal(config.delegation.responses.model, 'gpt-6-luna');
  assert.equal(config.delegation.responses.tool_choice, 'auto');
  assert.deepEqual(config.delegation.responses.tools.map(tool => tool.name), ['update_text_box']);
  assert.equal(config.delegation.responses.parallel_tool_calls, false);
  assert.deepEqual(config.client.data_channel.allowed_client_events, ['session.close', 'response.item.create', 'response.create']);
  assert.deepEqual(config.client.data_channel.allowed_server_events.map(event => event.type), [
    'session.started', 'session.closed', 'error', 'session.input_transcript.delta',
    'response.event', 'response.event', 'response.event', 'response.event', 'response.event', 'session.delegation.created',
  ]);
  assert.match(config.instructions, /Stop writing pauses capture and leaves the panel visible/);
  assert.match(config.instructions, /starts closed/);
  const properties = config.delegation.responses.tools[0].parameters.properties;
  assert.ok('action' in properties && properties.action.enum.includes('show'));
  assert.ok('action' in properties && properties.action.enum.includes('hide'));
  assert.match(config.delegation.responses.instructions, /first call action read/);
  assert.equal(config.store, false);
  const diagnosed = voiceSessionConfig({ ...waveform, textPanel: { type: 'text', version: 2 } }, true);
  const events = diagnosed.client.data_channel.allowed_server_events.map(event => event.type);
  assert.equal(events.filter(event => event === 'session.input_transcript.delta').length, 1);
  // Required by Live ServerEventSelector; checking only outer type hid a real provider 400.
  for (const candidate of [config, diagnosed]) {
    assert.deepEqual(candidate.client.data_channel.allowed_server_events.filter(event => event.type === 'response.event'), [
      { type: 'response.event', response_event: 'response.created' },
      { type: 'response.event', response_event: 'response.output_item.done' },
      { type: 'response.event', response_event: 'response.completed' },
      { type: 'response.event', response_event: 'response.failed' },
      { type: 'response.event', response_event: 'response.incomplete' },
    ]);
  }
});
