import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultPresentation } from '@thevoice/platform-ui/catalog';
import { validateCatalog } from '@thevoice/platform-ui/contracts';
import { AppError } from '../lib/errors';
import { sampleContent } from '../lib/site-model';
import { VisitorLimitError } from '../lib/visitor-quota';
import { createVisitorRealtimeControl, type VisitorControlSocket, type VisitorRealtimeControlOptions } from '../lib/visitor-realtime-control';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import type { ProviderUsage } from '../lib/provider-usage';

type Frame = Record<string, unknown>;
class Socket extends EventEmitter {
  readyState = 0;
  sent: Frame[] = [];
  send(data: string) { this.sent.push(JSON.parse(data)); }
  terminate() { this.readyState = 3; this.emit('close'); }
  close() { this.terminate(); }
  open() { this.readyState = 1; this.emit('open'); }
  frame(event: Frame) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  requests() { return this.sent.filter(event => event.type === 'response.create').map(event => event.response as Frame); }
  created(id: string, index = this.requests().length - 1) {
    this.frame({ type: 'response.created', response: { id, metadata: this.requests()[index].metadata } });
  }
  done(id: string, output: unknown[], status = 'completed') {
    this.frame({ type: 'response.done', response: { id, status, output, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } });
  }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const initialAvailability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 4, resetsAt: '2026-09-10T00:00:00Z' };
const presentation = { layout: 'detail' as const, sources: ['overview'], status: 'ready' as const };
const call = (value: unknown = presentation) => ({ type: 'function_call', name: 'present_site', call_id: 'call_view', arguments: JSON.stringify(value) });
const spoken = [{ type: 'message', role: 'assistant', content: [{ type: 'audio', transcript: 'Published information.' }] }];
const catalog = validateCatalog(JSON.parse(readFileSync(new URL('../fixtures/catalogs/tequila.json', import.meta.url), 'utf8')));

function setup(overrides: Partial<VisitorRealtimeControlOptions> = {}) {
  const socket = new Socket(), abort = new AbortController();
  const events: VisitorRealtimeEvent[] = [], fatal: string[] = [], usage: ProviderUsage[] = [];
  let reservations = 0, assertions = 0;
  const control = createVisitorRealtimeControl({
    callId: 'rtc_test', apiKey: 'mock-key', content: { ...sampleContent('photographer'), visitorSpeaksFirst: true },
    initialAvailability, signal: abort.signal, emit: event => events.push(event), onFatal: message => fatal.push(message),
    onUsage: value => usage.push(value), assertCurrent: async () => { assertions++; },
    reserveTurn: async () => { reservations++; return { ...initialAvailability, voiceRemaining: initialAvailability.voiceRemaining - reservations }; },
    socketFactory: (url, options) => {
      assert.equal(url, 'wss://api.openai.com/v1/realtime?call_id=rtc_test');
      assert.equal(options.maxPayload, 256 * 1024);
      assert.equal(options.handshakeTimeout, 10_000);
      return socket as unknown as VisitorControlSocket;
    }, ...overrides,
  });
  async function ready(start = true) {
    socket.open();
    socket.frame({ type: 'session.updated', session: socket.sent[0].session });
    await control.ready;
    if (start) { control.start(); await flush(); }
  }
  function user(id = 'input_1', committedFirst = false) {
    socket.frame({ type: 'input_audio_buffer.speech_started', item_id: id });
    if (committedFirst) socket.frame({ type: 'input_audio_buffer.committed', item_id: id });
    socket.frame({ type: 'input_audio_buffer.speech_stopped', item_id: id });
    socket.frame({ type: 'input_audio_buffer.committed', item_id: id });
  }
  return { socket, abort, events, fatal, usage, control, ready, user, reservations: () => reservations, assertions: () => assertions };
}

test('sideband waits for acknowledged manual-response VAD and explicit start; abort tears it down', async () => {
  const h = setup();
  await h.ready(false);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.socket.requests(), []);
  const config = h.socket.sent[0].session as Frame;
  assert.deepEqual(config.tools, []);
  assert.equal(config.tool_choice, 'none');
  assert.deepEqual((config.audio as { input: unknown }).input, { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'semantic_vad', eagerness: 'auto', create_response: false, interrupt_response: true } });
  h.control.start();
  h.abort.abort(); await h.control.closed;
  assert.equal(h.socket.readyState, 3);
  assert.deepEqual(h.fatal, []);
});

test('one prepaid turn validates the legacy view then speaks; duplicates never reserve or report usage twice', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready();
  h.user('input_1', true); await flush();
  h.socket.frame({ type: 'input_audio_buffer.speech_stopped', item_id: 'input_1' });
  h.socket.frame({ type: 'input_audio_buffer.committed', item_id: 'input_1' });
  assert.equal(h.reservations(), 0);
  assert.equal(h.socket.requests().length, 1);
  assert.deepEqual(h.socket.requests()[0].output_modalities, ['audio']);
  assert.equal(h.socket.requests()[0].tool_choice, 'auto');
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  assert.deepEqual(h.events.find(event => event.type === 'plan'), { type: 'plan', revision: 1, interactionRevision: 0, presentation });
  assert.equal(h.assertions(), 2);
  assert.equal(h.socket.requests().length, 2);
  const speech = h.socket.requests()[1];
  assert.deepEqual(speech.output_modalities, ['audio']); assert.deepEqual(speech.tools, []); assert.equal(speech.max_output_tokens, 500);
  h.socket.created('speech_1'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'speech_1' });
  h.socket.done('speech_1', spoken); h.socket.done('speech_1', spoken); await flush();
  assert.equal(h.usage.length, 2);
  assert.equal(h.events.at(-1)?.type, 'playback_started');
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'speech_1' });
  h.user('input_2'); await flush();
  assert.equal(h.reservations(), 1); assert.equal(h.socket.requests().length, 3);
  assert.equal(h.events.filter(event => event.type === 'availability').length, 1);
  assert.deepEqual(h.fatal, []);
});

test('catalog plans validate published references and carry the visible order into follow-ups', async t => {
  const h = setup({ catalog }); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  const plan = defaultPresentation(catalog);
  const narrowed = catalog.entities.slice(1, 3).map(entity => entity.id);
  plan.components = plan.components.map(component => component.type === 'collection' ? { ...component, entityIds: narrowed } : component);
  h.socket.created('plan_1'); h.socket.done('plan_1', [call({ status: 'ready', plan })]); await flush();
  const event = h.events.find(event => event.type === 'plan');
  assert.deepEqual(event && 'catalogPlan' in event ? event.catalogPlan : undefined, plan);
  h.socket.created('speech_1'); h.socket.done('speech_1', spoken);
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'speech_1' });
  h.user('input_2'); await flush();
  const instructions = String(h.socket.requests()[2].instructions);
  const context = JSON.parse(instructions.slice(instructions.indexOf('{"catalog":')));
  assert.deepEqual(context.catalog.state.entityIds, narrowed);
  assert.deepEqual(h.fatal, []);
});

test('catalog voice guidance maps a request to open an item to the card detail view', async t => {
  const h = setup({ catalog }); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  const instructions = String(h.socket.requests()[0].instructions);
  assert.match(instructions, /open.*one-item detail view/i);
  assert.match(instructions, /navigate_view for open, expand, spotlight, compare, back, collapse and scrolling/i);
});

test('unsupported catalog requests preserve the view and use the bounded speech response', async t => {
  const h = setup({ catalog }); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call({ status: 'unavailable', plan: null })]); await flush();
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.socket.requests()[1].tools, []);
  assert.deepEqual(h.fatal, []);
});

test('invalid references and extra tool calls fail closed without publishing or retrying', async t => {
  for (const output of [[call({ ...presentation, sources: ['private_secret'] })], [call(), call()]]) {
    const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
    h.socket.created('plan_1'); h.socket.done('plan_1', output); await flush();
    assert.equal(h.fatal.length, 1); assert.equal(h.socket.readyState, 3);
    assert.equal(h.events.some(event => event.type === 'plan'), false);
    assert.equal(h.socket.requests().length, 1);
  }
});

test('an interrupted plan cannot apply after its publication check resolves', async t => {
  let release!: () => void, assertions = 0;
  const check = new Promise<void>(resolve => { release = resolve; });
  const h = setup({ assertCurrent: async () => { if (++assertions === 2) await check; } });
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  h.user('input_2'); release(); await flush();
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  assert.equal(h.socket.requests().length, 2);
  assert.equal((h.socket.requests()[1].metadata as Frame).visitor_phase, 'answer');
  assert.equal(h.reservations(), 1);
  const cancelled = h.socket.sent.find(event => event.type === 'conversation.item.create');
  assert.match(String((cancelled?.item as Frame).output), /cancelled/);
  assert.deepEqual(h.fatal, []);
});

test('a response acknowledged after an interruption is cancelled by ID and cannot deliver a stale view', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.user('input_2'); h.socket.created('late_plan', 0);
  const cancelled = h.socket.sent.find(event => event.type === 'response.cancel');
  assert.equal(cancelled?.response_id, 'late_plan');
  h.socket.frame({ type: 'error', error: { code: 'response_cancel_not_active', event_id: cancelled?.event_id } });
  h.socket.done('late_plan', [call()], 'cancelled'); await flush();
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  assert.equal(h.socket.requests().length, 2);
  assert.equal(h.usage.length, 1);
  assert.deepEqual(h.fatal, []);
});

test('interruption during buffered speech waits for playback clearing before the next plan', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  h.socket.created('speech_1'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'speech_1' });
  h.socket.done('speech_1', spoken); await flush(); h.user('input_2'); await flush();
  assert.equal(h.socket.requests().length, 2);
  h.socket.frame({ type: 'output_audio_buffer.cleared', response_id: 'speech_1' }); await flush();
  assert.equal(h.socket.requests().length, 3);
  assert.equal(h.events.some(event => event.type === 'playback_cleared'), false);
  h.socket.created('plan_2');
  const eventCount = h.events.length;
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'speech_1' });
  assert.equal(h.events.length, eventCount);
  assert.deepEqual(h.fatal, []);
});

test('missing playback events on a later response still get a fresh 30 second watchdog', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  h.socket.created('speech_1'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'speech_1' });
  h.socket.done('speech_1', spoken);
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'speech_1' });
  h.user('input_2'); await flush();
  h.socket.created('plan_2'); h.socket.done('plan_2', [call()]); await flush();
  h.socket.created('speech_2'); h.socket.done('speech_2', spoken); await flush();
  t.mock.timers.tick(29_999); assert.deepEqual(h.fatal, []);
  t.mock.timers.tick(1); await h.control.closed;
  assert.match(h.fatal[0], /audio did not finish/);
});

test('the last prepaid greeting is allowed to play fully before quota ends the session', async () => {
  const h = setup({ content: sampleContent('photographer'), initialAvailability: { ...initialAvailability, voiceRemaining: 0 } });
  await h.ready(); assert.equal(h.reservations(), 0);
  assert.equal(h.socket.requests()[0].max_output_tokens, 750);
  h.socket.created('greeting'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'greeting' });
  h.socket.done('greeting', spoken); await flush(); assert.deepEqual(h.fatal, []);
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'greeting' }); await h.control.closed;
  assert.match(h.fatal[0], /daily limit/); assert.equal(h.socket.readyState, 3);
});

test('quota and changed publications end a call without another provider response', async t => {
  const exhausted = { ...initialAvailability, voiceRemaining: 0 };
  const h = setup({ reserveTurn: async () => { throw new VisitorLimitError('Daily voice allowance exhausted.', exhausted); } });
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  h.socket.created('speech_1'); h.socket.done('speech_1', spoken);
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'speech_1' });
  h.user('input_2'); await flush();
  assert.equal(h.socket.requests().length, 2); assert.match(h.fatal[0], /allowance/);
  assert.deepEqual(h.events.at(-1), { type: 'availability', availability: exhausted });
  let assertions = 0;
  const changed = setup({ assertCurrent: async () => { if (++assertions === 2) throw new AppError('The published site changed. Refresh to continue.', 409); } });
  t.after(() => changed.control.close()); await changed.ready(); changed.user(); await flush();
  changed.socket.created('plan_1'); changed.socket.done('plan_1', [call()]); await flush();
  assert.equal(changed.events.some(event => event.type === 'plan'), false);
  assert.equal(changed.socket.requests().length, 1); assert.match(changed.fatal[0], /published site changed/);
});

test('speech cannot start a second tool round', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
  h.socket.created('speech_1'); h.socket.done('speech_1', [call()]); await flush();
  assert.equal(h.fatal.length, 1); assert.equal(h.socket.requests().length, 2);
});

test('billing eligibility revoked during a connected call prevents the next paid turn', async t => {
  let testingBilling = false;
  const h = setup({ assertCurrent: async () => {
    if (testingBilling) throw new AppError('Test credits cannot fund live AI.', 503);
  } });
  t.after(() => h.control.close());
  await h.ready(); h.user(); await flush();
  h.socket.created('first'); h.socket.done('first', spoken);
  h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'first' });
  await flush();
  testingBilling = true;
  h.user('after-test-enrollment'); await h.control.closed;
  assert.equal(h.socket.requests().length, 1);
  assert.match(h.fatal[0], /Test credits cannot fund live AI/);
  assert.equal(h.socket.readyState, 3);
});

test('readiness, input, generation, playback and idle deadlines release the sideband', async t => {
  for (const phase of ['ready', 'input', 'generation', 'playback', 'idle']) await t.test(phase, async subtest => {
    subtest.mock.timers.enable({ apis: ['setTimeout'] });
    const h = setup(); subtest.after(() => h.control.close());
    if (phase === 'ready') subtest.mock.timers.tick(10_000);
    else {
      await h.ready();
      if (phase === 'idle') subtest.mock.timers.tick(20_000);
      else if (phase === 'input') {
        h.socket.frame({ type: 'input_audio_buffer.speech_started', item_id: 'input_1' });
        subtest.mock.timers.tick(20_000);
      } else {
        h.user(); await flush();
        if (phase === 'generation') subtest.mock.timers.tick(35_000);
        else {
          h.socket.created('plan_1'); h.socket.done('plan_1', [call()]); await flush();
          h.socket.created('speech_1'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'speech_1' });
          h.socket.done('speech_1', spoken); await flush(); subtest.mock.timers.tick(30_000);
        }
      }
    }
    await h.control.closed;
    assert.equal(h.fatal.length, 1); assert.equal(h.socket.readyState, 3);
  });
});

test('ordinary spoken answers keep the view and use one response; only heard speech enters shared history', async t => {
  const h = setup({ history: [{role:'user',text:'I am comparing the two published options.'}] });
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  assert.match(String(h.socket.requests()[0].instructions), /comparing the two published options/);
  h.socket.created('direct');
  h.socket.frame({type:'output_audio_buffer.started',response_id:'direct'});
  h.socket.done('direct', spoken); await flush();
  assert.equal(h.events.some(event => event.type === 'transcript'), false);
  h.socket.frame({type:'output_audio_buffer.stopped',response_id:'direct'});
  assert.equal(h.socket.requests().length, 1);
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  assert.deepEqual(h.events.find(event => event.type === 'transcript'), {type:'transcript',id:'direct',role:'assistant',text:'Published information.',revision:1,interactionRevision:0});
  assert.deepEqual(h.fatal, []);
});

test('manual browsing cancels stale output, preserves the call and updates next-turn grounding without another reservation', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('stale');
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{presentation}});
  assert.equal(h.socket.readyState, 1);
  assert.equal(h.reservations(), 0);
  assert.equal(h.socket.requests().length, 1);
  assert.ok(h.socket.sent.some(event => event.type === 'response.cancel' && event.response_id === 'stale'));
  assert.ok(h.socket.sent.some(event => event.type === 'output_audio_buffer.clear'));
  assert.deepEqual(h.events.at(-1), {type:'control_applied',seq:1,interactionRevision:1,revision:2,ready:true});
  h.socket.done('stale', [call()], 'cancelled'); await flush();
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  h.user('input_2'); await flush();
  assert.match(String(h.socket.requests()[1].instructions), /currentView.*presentation/);
  h.socket.created('fresh');
  assert.deepEqual(h.events.at(-1), {type:'response_started',revision:3,interactionRevision:1});
  assert.deepEqual(h.fatal, []);
});

test('manual input during the publication check suppresses late plans; invalid screen references fail before control ACK', async t => {
  let unblock!: () => void, count = 0;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const h = setup({assertCurrent: async () => { if (++count === 2) await gate; }});
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('waiting'); h.socket.done('waiting', [call()]); await flush();
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{}});
  unblock(); await flush();
  assert.equal(h.events.some(event => event.type === 'plan'), false);
  assert.equal(h.socket.requests().length, 1);
  await assert.rejects(h.control.applyControl({seq:2,interactionRevision:2,viewRevision:0,ready:true,context:{expandedSourceIds:['private-source']}}), /current view/);
  assert.equal(h.events.filter(event => event.type === 'control_applied').length, 1);
});

test('a delayed observation cannot replace a newly accepted screen; filters and spoken follow-ups use the new plan', async t => {
  const h = setup({catalog}); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  const plan = defaultPresentation(catalog);
  plan.components = plan.components.map(component => component.type === 'collection' ? {...component,entityIds:[catalog.entities[2].id]} : component);
  h.socket.created('plan'); h.socket.done('plan', [call({status:'ready',plan})]); await flush();
  await h.control.applyControl({seq:1,interactionRevision:0,viewRevision:0,ready:true,context:{}});
  h.socket.created('speech'); h.socket.done('speech', spoken);
  h.socket.frame({type:'output_audio_buffer.stopped',response_id:'speech'});
  h.user('input_2'); await flush();
  const instructions = String(h.socket.requests().at(-1)!.instructions);
  const context = JSON.parse(instructions.slice(instructions.indexOf('{"catalog":')));
  assert.deepEqual(context.catalog.state.entityIds, [catalog.entities[2].id]);
  assert.deepEqual(h.fatal, []);
});

test('asynchronous user transcripts are deduplicated and interrupted assistant speech is excluded', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  const transcript = {type:'conversation.item.input_audio_transcription.completed',item_id:'input_1',transcript:'What is published?'};
  h.socket.frame(transcript); h.socket.frame(transcript);
  h.socket.created('answer'); h.socket.frame({type:'output_audio_buffer.started',response_id:'answer'});
  h.socket.done('answer', spoken); await flush();
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{}});
  h.socket.frame({type:'output_audio_buffer.cleared',response_id:'answer'});
  h.socket.frame({type:'output_audio_buffer.stopped',response_id:'answer'});
  const transcripts = h.events.filter(event => event.type === 'transcript');
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].role, 'user');
  assert.equal(transcripts[0].text, 'What is published?');
  assert.deepEqual(h.fatal, []);
});

test('a mixed speech and view response waits for real playback before the single tool-free continuation', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('mixed'); h.socket.frame({type:'output_audio_buffer.started',response_id:'mixed'});
  h.socket.done('mixed', [...spoken,call()]); await flush();
  assert.equal(h.socket.requests().length, 1);
  h.socket.frame({type:'output_audio_buffer.stopped',response_id:'mixed'}); await flush();
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.socket.requests()[1].tools, []);
  assert.deepEqual(h.fatal, []);
});

test('navigation waits for the browser acknowledgement and carries the observed screen into its tool result', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('nav');
  h.socket.done('nav', [{type:'function_call',name:'navigate_view',call_id:'nav_top',arguments:JSON.stringify({kind:'top',id:null})}]); await flush();
  assert.equal(h.socket.requests().length, 1);
  assert.deepEqual(h.events.at(-1), {type:'navigation',id:'nav_top',revision:1,interactionRevision:0,target:{kind:'top'}});
  await h.control.applyControl({seq:1,interactionRevision:0,viewRevision:0,ready:true,navigationAck:{id:'nav_top',status:'applied'},context:{presentation}});
  await flush();
  const result = h.socket.sent.filter(event => event.type === 'conversation.item.create').at(-1)!;
  assert.equal(JSON.parse(String((result.item as Frame).output)).status, 'applied');
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.fatal, []);
});

test('manual input cancels pending navigation, and a late navigation acknowledgement cannot restart it', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('nav'); h.socket.done('nav', [{type:'function_call',name:'navigate_view',call_id:'nav_bottom',arguments:JSON.stringify({kind:'bottom',id:null})}]); await flush();
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{}});
  await h.control.applyControl({seq:2,interactionRevision:1,viewRevision:0,ready:true,navigationAck:{id:'nav_bottom',status:'applied'},context:{}});
  await flush();
  assert.equal(h.socket.requests().length, 1);
  const result = h.socket.sent.filter(event => event.type === 'conversation.item.create').at(-1)!;
  assert.equal(JSON.parse(String((result.item as Frame).output)).status, 'cancelled');
  assert.deepEqual(h.fatal, []);
});

test('missing navigation acknowledgements have one bounded failure result and no tool retry', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('nav'); h.socket.done('nav', [{type:'function_call',name:'navigate_view',call_id:'nav_top',arguments:JSON.stringify({kind:'top',id:null})}]); await flush();
  t.mock.timers.tick(8000); await flush();
  const result = h.socket.sent.filter(event => event.type === 'conversation.item.create').at(-1)!;
  assert.equal(JSON.parse(String((result.item as Frame).output)).status, 'unavailable');
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.socket.requests()[1].tools, []);
  assert.deepEqual(h.fatal, []);
});

test('a fresh utterance waits for an in-flight manual context check before using the updated guide', async t => {
  let unblock!: () => void, count = 0;
  const check = new Promise<void>(resolve => { unblock = resolve; });
  const h = setup({assertCurrent: async () => { if (++count === 1) await check; }});
  t.after(() => h.control.close()); await h.ready();
  const applying = h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{presentation}});
  h.user(); await flush();
  assert.equal(h.socket.requests().length, 0);
  unblock(); await applying; await flush();
  assert.equal(h.socket.requests().length, 1);
  assert.match(String(h.socket.requests()[0].instructions), /currentView.*presentation/);
  assert.deepEqual(h.fatal, []);
});

test('manual cancellation waits for old audio clearing even when playback starts after response.done', async t => {
  const h = setup(); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('old'); h.socket.done('old', spoken); await flush();
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{presentation}});
  h.user('new_input'); await flush();
  assert.equal(h.socket.requests().length, 1);
  h.socket.frame({type:'output_audio_buffer.started',response_id:'old'});
  assert.equal(h.events.some(event => event.type === 'playback_started'), false);
  assert.equal(h.socket.requests().length, 1);
  h.socket.frame({type:'output_audio_buffer.cleared',response_id:'old'}); await flush();
  assert.equal(h.socket.requests().length, 2);
  assert.equal(h.events.some(event => event.type === 'transcript' && event.role === 'assistant'), false);
  assert.deepEqual(h.fatal, []);
});

test('mixed audio and view output awaiting publication stays blocked until old playback clears after browsing', async t => {
  let unblock!: () => void, count = 0;
  const check = new Promise<void>(resolve => { unblock = resolve; });
  const h = setup({assertCurrent: async () => { if (++count === 2) await check; }});
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('mixed'); h.socket.done('mixed', [...spoken,call()]); await flush();
  await h.control.applyControl({seq:1,interactionRevision:1,viewRevision:0,ready:true,context:{}});
  h.user('fresh'); await flush();
  unblock(); await flush();
  assert.equal(h.socket.requests().length, 1);
  h.socket.frame({type:'output_audio_buffer.started',response_id:'mixed'});
  assert.equal(h.events.some(event => event.type === 'plan' || event.type === 'playback_started'), false);
  h.socket.frame({type:'output_audio_buffer.cleared',response_id:'mixed'}); await flush();
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.fatal, []);
});


test('direct screen commands validate targets, await the browser and retain one continuation', async t => {
  const h = setup({ catalog }); t.after(() => h.control.close()); await h.ready();
  h.user(); await flush(); h.socket.created('direct');
  h.socket.done('direct', [{ type: 'function_call', name: 'navigate_view', call_id: 'open_item', arguments: JSON.stringify({ kind: 'open', id: catalog.entities[0].id, ids: null }) }]);
  await flush();
  assert.equal(h.socket.requests().length, 1);
  assert.equal(h.events.find(event => event.type === 'navigation')?.target.kind, 'open');
  await h.control.applyControl({ seq: 1, interactionRevision: 0, viewRevision: 1, ready: true, context: {}, navigationAck: { id: 'open_item', status: 'applied' } });
  await flush();
  assert.equal(h.socket.requests().length, 2);
  assert.deepEqual(h.socket.requests()[1].tools, []);
  assert.deepEqual(h.fatal, []);
});

test('reservation with publication verification avoids a duplicate read and records latency', async t => {
  const timings: string[] = [];
  const h = setup({ reservationChecksPublication: true, onTiming: stage => timings.push(stage) });
  t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('first'); h.socket.frame({ type: 'output_audio_buffer.started', response_id: 'first' }); h.socket.done('first', spoken); await flush(); h.socket.frame({ type: 'output_audio_buffer.stopped', response_id: 'first' }); await flush();
  const before = h.assertions(); h.user('second'); await flush();
  assert.equal(h.reservations(), 1); assert.equal(h.assertions(), before);
  assert.ok(timings.includes('authorization'));
});

test('direct controls reject foreign items before dispatch or paid continuation', async t => {
  const h = setup({ catalog }); t.after(() => h.control.close()); await h.ready(); h.user(); await flush();
  h.socket.created('foreign');
  h.socket.done('foreign', [{ type: 'function_call', name: 'navigate_view', call_id: 'foreign_item', arguments: JSON.stringify({ kind: 'open', id: 'not-published', ids: null }) }]);
  await flush();
  assert.equal(h.events.filter(event => event.type === 'navigation').length, 0);
  assert.equal(h.socket.requests().length, 1);
  assert.equal(h.fatal.length, 1);
});
