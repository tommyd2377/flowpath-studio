import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { updateRunningPluginVoice } from '../lib/plugin-voice-update';
import { PluginAccessError } from '../lib/plugin-access';
import { visualFixture } from './visual-display-fixture';

class FakeSocket extends EventEmitter {
  sent: Record<string, unknown>[] = [];
  terminated = false;
  respond = true;
  onSend?: (event: Record<string, unknown>) => void;
  send(raw: string) {
    const event = JSON.parse(raw); this.sent.push(event); this.onSend?.(event);
    if (this.respond) setImmediate(() => this.emit('message', Buffer.from(JSON.stringify({
      type: event.type === 'session.update' ? 'session.updated' : 'session.instructions.appended', client_event_id: event.event_id,
    }))));
  }
  terminate() { this.terminated = true; }
}
const target = () => ({ providerId: 'synthetic_provider_session', revision: 'synthetic-policy-a',
  waveform: { name: 'Synthetic voice', initialPrompt: 'Synthetic persona', textPanel: { type: 'text' as const, version: 2 as const } } });

test('an authorized in-call unlock updates only registered backend tools and brief frontend context, without closing or creating voice', async () => {
  const socket = new FakeSocket(); let checks = 0;
  const operation = updateRunningPluginVoice({ authorize: async () => { checks++; return target(); }, socketFactory: id => {
    assert.equal(id, 'synthetic_provider_session'); setImmediate(() => socket.emit('open')); return socket;
  } });
  await operation;
  assert.equal(checks, 4); assert.equal(socket.terminated, true);
  assert.deepEqual(socket.sent.map(event => event.type), ['session.update', 'session.instructions.append']);
  const update = socket.sent[0] as { session: { delegation: { responses: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(update.session).sort(), ['delegation']);
  const backend = update.session.delegation.responses;
  assert.deepEqual(Object.keys(backend).sort(), ['instructions', 'max_output_tokens', 'parallel_tool_calls', 'tool_choice', 'tools']);
  assert.deepEqual((backend.tools as { name: string }[]).map(tool => tool.name), ['update_text_box']);
  assert.equal(JSON.stringify(socket.sent).includes('session.close'), false);
  assert.equal(JSON.stringify(socket.sent[1]).includes('Synthetic persona'), false);
});

test('one plugin unlock cannot send another plugin’s catalogue or raster data', async () => {
  const full = { ...target(), waveform: { ...target().waveform, visualDisplay: await visualFixture() } };
  for (const visual of [false, true]) {
    const socket = new FakeSocket();
    const current = { ...full, waveform: { ...full.waveform, visualDisplay: visual ? full.waveform.visualDisplay : null } };
    await updateRunningPluginVoice({ authorize: async () => current, socketFactory: () => { setImmediate(() => socket.emit('open')); return socket; } });
    const serialized = JSON.stringify(socket.sent);
    assert.equal(serialized.includes('Town map'), visual);
    assert.equal(serialized.includes('data:image/'), false);
    assert.equal(serialized.includes('synthetic-policy-a'), false);
  }
});

test('revocation during connection prevents sending protected context', async () => {
  const socket = new FakeSocket(); let checks = 0;
  await assert.rejects(updateRunningPluginVoice({ authorize: async () => {
    if (++checks > 1) throw new PluginAccessError('Revoked.'); return target();
  }, socketFactory: () => { setImmediate(() => socket.emit('open')); return socket; } }), (error: unknown) => error instanceof PluginAccessError && error.status === 403);
  assert.deepEqual(socket.sent, []); assert.equal(socket.terminated, true);
});

test('changed target or policy after backend acknowledgment prevents further context and success', async () => {
  for (const kind of ['provider', 'revision', 'content'] as const) {
    const socket = new FakeSocket(); let checks = 0;
    await assert.rejects(updateRunningPluginVoice({ authorize: async () => {
      const next = target();
      if (++checks > 2) {
        if (kind === 'provider') next.providerId = 'another_provider_session';
        if (kind === 'revision') next.revision = 'synthetic-policy-b';
        if (kind === 'content') next.waveform.initialPrompt = 'changed persona';
      }
      return next;
    }, socketFactory: () => { setImmediate(() => socket.emit('open')); return socket; } }), (error: unknown) => error instanceof PluginAccessError && error.status === 409);
    assert.deepEqual(socket.sent.map(event => event.type), ['session.update']);
  }
});

test('wrong acknowledgments, duplicate opens and unrelated audio cannot complete an update', async () => {
  const socket = new FakeSocket(); socket.respond = false;
  const operation = updateRunningPluginVoice({ authorize: async () => target(), timeoutMs: 30, socketFactory: () => {
    setImmediate(() => { socket.emit('open'); socket.emit('open'); });
    return socket;
  } });
  socket.onSend = event => setImmediate(() => {
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated', client_event_id: 'wrong-command' })));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.input_audio.append', audio: 'synthetic-audio-must-not-be-recorded' })));
    assert.ok(event.event_id);
  });
  await assert.rejects(operation, (error: unknown) => error instanceof PluginAccessError && error.status === 503);
  assert.equal(socket.sent.length, 1); assert.equal(JSON.stringify(socket.sent).includes('synthetic-audio'), false);
});

test('provider validation errors fail closed without a retry or closing primary voice', async () => {
  const socket = new FakeSocket(); socket.respond = false;
  socket.onSend = () => setImmediate(() => socket.emit('message', Buffer.from(JSON.stringify({ type: 'error', error: { code: 'responses_validation_failed' } }))));
  await assert.rejects(updateRunningPluginVoice({ authorize: async () => target(), socketFactory: () => { setImmediate(() => socket.emit('open')); return socket; } }),
    (error: unknown) => error instanceof PluginAccessError && error.status === 503);
  assert.deepEqual(socket.sent.map(event => event.type), ['session.update']);
});

test('abort during an update withholds success and prevents delayed appends', async () => {
  const socket = new FakeSocket(); const controller = new AbortController();
  socket.onSend = () => controller.abort();
  await assert.rejects(updateRunningPluginVoice({ authorize: async () => target(), signal: controller.signal,
    socketFactory: () => { setImmediate(() => socket.emit('open')); return socket; } }), (error: unknown) => error instanceof PluginAccessError && error.status === 409);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(socket.sent.map(event => event.type), ['session.update']);
});
