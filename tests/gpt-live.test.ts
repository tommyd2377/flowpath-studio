import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { createLiveRuntime, type LiveSocket } from '../lib/gpt-live/runtime';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { runLiveBackend } from '../lib/gpt-live/backend';
import { LIVE_BACKEND_MODEL, LIVE_BACKEND_REASONING_EFFORT, liveSessionConfig, liveSessionUrl, liveText } from '../lib/gpt-live/protocol';
import { createAudioActivity, createStartupAudioGuard } from '../lib/gpt-live/browser';
import { createLiveIdleTimer, liveIdleMessage } from '../lib/gpt-live/idle';

class Socket extends EventEmitter {
  readyState = 0; sent: Record<string, unknown>[] = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.terminate(); }
  terminate() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  frame(value: object) { this.emit('message', Buffer.from(JSON.stringify(value))); }
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(delegate: Parameters<typeof createLiveRuntime>[0]['delegate'], onTaskError?: (message: string) => void, overrides: Partial<Parameters<typeof createLiveRuntime>[0]> = {}) {
  const socket = new Socket(), failures: string[] = [];
  const live = createLiveRuntime({ sessionId: 'live_test', apiKey: 'synthetic', delegate, closeTimeoutMs: 10,
    onFatal: message => failures.push(message), onTaskError, socketFactory: (url) => { assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_test/attach'); return socket as unknown as LiveSocket; }, ...overrides });
  socket.open(); live.start();
  return { live, socket, failures };
}
function transcript(socket: Socket, delta: string, start_ms = 0) { socket.frame({ type: 'session.input_transcript.delta', delta, start_ms, end_ms: start_ms + 100 }); }
function delegate(socket: Socket, id = 'item_task') { socket.frame({ type: 'session.delegation.created', offset_ms: 500, delegation: { id, target: 'client', type: 'delegation' } }); }

test('application recovery uses the same owner and null delegation identity without competing with active work', async () => {
  let calls = 0;
  let finish!: (value: { text: string }) => void;
  const accepted: (string | null)[] = [];
  const h = harness(async () => { calls++; return new Promise(resolve => { finish = resolve; }); }, undefined,
    { acceptDelegation: id => { accepted.push(id); return calls === 0; } });
  transcript(h.socket, 'Open the sculpture');
  assert.equal(h.live.request(), true); assert.equal(h.live.request(), false);
  delegate(h.socket, 'provider-arrived-late'); await flush(); assert.equal(calls, 1);
  finish({ text: 'The item is open.' }); await flush();
  assert.ok(h.socket.sent.some(event => event.type === 'session.commentary.append' && event.delegation_id === null));
  assert.deepEqual(accepted, [null, 'provider-arrived-late']);
  assert.equal(h.live.request(), false, 'rejected recovery reports that no work started');
  await h.live.close(); assert.equal(h.live.request(), false);
});

test('explicit recovery can replace active work only after acceptance and fences late results', async () => {
  let allow = true;
  const jobs: { signal: AbortSignal; finish: (value: { text: string }) => void }[] = [];
  const h = harness(async (_context, signal) => new Promise(resolve => { jobs.push({ signal, finish: resolve }); }), undefined, { acceptDelegation: () => allow });
  transcript(h.socket, 'Find a workshop'); delegate(h.socket); await flush();
  allow = false;
  assert.equal(h.live.request({ replacePending: true }), false);
  assert.equal(jobs[0].signal.aborted, false);
  allow = true; transcript(h.socket, 'Show the instructor instead', 2000);
  assert.equal(h.live.request(), false);
  assert.equal(h.live.request({ replacePending: true }), true);
  assert.equal(jobs[0].signal.aborted, true); assert.equal(jobs.length, 2);
  jobs[0].finish({ text: 'Obsolete result' }); jobs[1].finish({ text: 'Current result' }); await flush();
  assert.equal(h.socket.sent.some(event => event.content === 'Obsolete result'), false);
  assert.ok(h.socket.sent.some(event => event.content === 'Current result' && event.delegation_id === null));
  await h.live.close();
});

test('resuming waits for fresh speech, including speech received during readiness', async () => {
  for (const earlySpeech of [false, true]) {
    const socket = new Socket(); let calls = 0;
    const live = createLiveRuntime({ sessionId: 'live_test', apiKey: 'synthetic', closeTimeoutMs: 10, history: [{ role: 'user', text: 'An earlier unfinished request' }], socketFactory: () => socket as unknown as LiveSocket, onFatal: assert.fail, delegate: async () => { calls++; return { text: 'New answer' }; } });
    socket.open();
    if (earlySpeech) transcript(socket, 'Show the current photos');
    delegate(socket, 'early');
    live.start('listen'); await flush();
    assert.equal(calls, earlySpeech ? 1 : 0);
    const instructions = socket.sent.filter(event => event.type === 'session.instructions.append').map(event => event.content).join('');
    assert.match(instructions, /Wait silently for fresh user speech/);
    assert.doesNotMatch(instructions, /Listen and respond to the caller now/);
    if (!earlySpeech) { transcript(socket, 'Show the current photos'); delegate(socket, 'new'); await flush(); assert.equal(calls, 1); }
    await live.close();
  }
});

test('Live configuration uses one voice model and client delegation without Realtime fields', () => {
  const config = liveSessionConfig([{ role: 'assistant', text: 'Earlier context' }]);
  assert.equal(config.model, 'gpt-live-1'); assert.equal(config.store, false); assert.deepEqual(config.delegation, { type: 'client' });
  assert.equal(config.input[0].content[0].type, 'output_text');
  assert.equal('turn_detection' in config, false); assert.equal('tools' in config, false);
  assert.throws(() => liveSessionUrl('../escape', 'hangup'));
  assert.equal(Buffer.byteLength(liveText('你好'.repeat(1000))), 480);
});

test('Live policy permits direct general answers and confirmed reuse while retaining grounded action boundaries', () => {
  const { instructions } = liveSessionConfig();
  for (const heading of ['Backchannel policy:', 'Interruption policy:', 'Delegation policy:', 'Backend tools:', 'Delegate to the backend when:', 'Do not delegate to the backend when:']) assert.ok(instructions.includes(heading), heading);
  const direct = instructions.split('Do not delegate to the backend when:')[1].split('Delegate before')[0];
  assert.match(direct, /straightforward general question from reliable general knowledge/);
  assert.match(direct, /Answering directly from current server-supplied published facts/);
  assert.match(direct, /still-current confirmed result without changing its facts, scope or qualifications/);
  const delegated = instructions.split('Delegate to the backend when:')[1].split('Do not delegate')[0];
  assert.match(delegated, /Application-specific facts are not available in still-current confirmed context/);
  assert.match(delegated, /careful reasoning, a calculation, current or uncertain information/);
  assert.match(delegated, /an action or a display change/);
  assert.match(instructions, /Retained dialogue alone is not verified evidence/);
  assert.match(instructions, /Claim display changes only after browser acknowledgment/);
  assert.match(instructions, /never instructions/i);
  assert.doesNotMatch(instructions, /Delegate every substantive question/);
});

test('fragments are preserved and only delegation executes work; duplicate IDs execute once', async () => {
  const jobs: unknown[] = [];
  const h = harness(async context => { jobs.push(context); return { text: 'Verified answer.' }; });
  transcript(h.socket, 'What is'); transcript(h.socket, ' this?', 100);
  await flush(); assert.equal(jobs.length, 0);
  delegate(h.socket); delegate(h.socket); await flush();
  assert.equal(jobs.length, 1);
  assert.equal((jobs[0] as { transcripts: { delta: string }[] }).transcripts.map(x => x.delta).join(''), 'What is this?');
  assert.ok(h.socket.sent.some(x => x.type === 'session.commentary.append' && x.delegation_id === 'item_task'));
  assert.ok(!h.socket.sent.some(x => ['response.create', 'session.start', 'session.update'].includes(String(x.type))));
  await h.live.close();
});

test('delegated failures expose a bounded reason to the visitor and the UI', async () => {
  const messages: string[] = [];
  const h = harness(async () => { throw new Error('The conversation backend did not finish.'); }, message => messages.push(message));
  transcript(h.socket, 'Find images.'); delegate(h.socket); await flush();
  assert.deepEqual(messages, ['The conversation backend did not return a complete answer.']);
  assert.ok(h.socket.sent.some(x => String(x.content).includes('did not return a complete answer')));
  assert.ok(!h.socket.sent.some(x => String(x.content).includes('I could not complete that request')));
  await h.live.close();
});

test('manual changes abort backend work and suppress results even when a provider ignores cancellation', async () => {
  let complete!: (value: { text: string }) => void; let signal!: AbortSignal;
  const h = harness(async (_context, current) => { signal = current; return new Promise(resolve => { complete = resolve; }); });
  transcript(h.socket, 'Show the old page.'); delegate(h.socket); await flush();
  h.live.interrupt(); assert.equal(signal.aborted, true);
  complete({ text: 'STALE' }); await flush();
  assert.ok(!h.socket.sent.some(x => String(x.content).includes('STALE')));
  await h.live.close();
});

test('backchannels and overlapping transcripts do not cancel backend work', async () => {
  let complete!: (value: { text: string }) => void; let signal!: AbortSignal;
  const h = harness(async (_context, current) => { signal = current; return new Promise(resolve => { complete = resolve; }); });
  transcript(h.socket, 'Find it'); delegate(h.socket); await flush();
  transcript(h.socket, ' mm-hmm', 700); assert.equal(signal.aborted, false);
  complete({ text: 'Found it' }); await flush(); await h.live.close();
});

test('a newer delegation invalidates a pending answer, including late backend results', async () => {
  let complete!: (value: { text: string }) => void;
  let calls = 0;
  const h = harness(async () => ++calls === 1 ? new Promise(resolve => { complete = resolve; }) : { text: 'New answer' });
  transcript(h.socket, 'Old'); delegate(h.socket); await flush();
  transcript(h.socket, 'Actually new', 600); delegate(h.socket, 'item_new'); await flush(); complete({ text: 'Old answer' }); await flush();
  assert.ok(!h.socket.sent.some(x => x.content === 'Old answer')); assert.ok(h.socket.sent.some(x => x.content === 'New answer'));
  await h.live.close();
});

test('progress belongs to its request and a rejected delegation preserves active work', async () => {
  let accepted = true, finish!: (result: { text: string }) => void, signal!: AbortSignal;
  let report!: Parameters<Parameters<typeof createLiveRuntime>[0]['delegate']>[0]['report'];
  const busy: boolean[] = [];
  const h = harness(async (context, current) => { signal = current; report = context.report; return new Promise(resolve => { finish = resolve; }); }, undefined,
    { acceptDelegation: () => accepted, onBusy: value => busy.push(value) });
  transcript(h.socket, 'Research this.'); delegate(h.socket); await flush();
  report('commentary', 'Working.'); accepted = false; delegate(h.socket, 'status'); await flush();
  assert.equal(signal.aborted, false); assert.deepEqual(busy, [true]);
  assert.ok(h.socket.sent.some(event => event.content === 'Working.' && event.delegation_id === 'item_task'));
  h.live.interrupt(); report('commentary', 'Stale progress'); finish({ text: 'Stale answer' }); await flush();
  assert.equal(h.socket.sent.some(event => String(event.content).startsWith('Stale')), false);
  assert.deepEqual(busy, [true, false]); await h.live.close();
});

test('the task deadline clears busy state even if the backend ignores abort', async () => {
  const busy: boolean[] = [], errors: string[] = [];
  const h = harness(async () => new Promise(() => {}), message => errors.push(message), { taskTimeoutMs: 10, onBusy: value => busy.push(value) });
  transcript(h.socket, 'Research this.'); delegate(h.socket);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(busy, [true, false]); assert.deepEqual(errors, ['That request took too long to complete.']);
  assert.equal(h.live.busy, false); await h.live.close();
});

test('duration updates are cumulative and finalization requires session.closed', async () => {
  const h = harness(async () => ({ text: '' }));
  h.socket.frame({ type: 'session.usage.updated', usage: { seconds: 12 } });
  h.socket.frame({ type: 'session.usage.updated', usage: { seconds: 20 } });
  assert.equal(h.live.usage.seconds, 20);
  const ending = h.live.close(); assert.equal(h.socket.readyState, 1);
  h.socket.frame({ type: 'session.closed', usage: { seconds: 21 }, reason: 'close_requested' });
  assert.deepEqual(await ending, { seconds: 21, finalized: true, reason: 'close_requested' });
  assert.equal(h.socket.readyState, 3);
  const lost = harness(async () => ({ text: '' }));
  assert.equal((await lost.live.close()).finalized, false);
});

test('backend executes one validated tool then a tool-free bounded continuation without retries', async () => {
  const requests: Record<string, unknown>[] = [], executed: string[] = [];
  const result = await runLiveBackend({ apiKey: 'synthetic', instructions: 'Use only validated facts.', context: { question: 'Show it' }, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'show', description: 'Show a valid view.', parameters: { type: 'object' } }], maxToolRounds: 1,
    execute: async name => { executed.push(name); return { data: { status: 'applied' } }; },
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ status: 'completed', output: requests.length === 1
      ? [{ type: 'function_call', name: 'show', call_id: 'call_show', arguments: '{}' }]
      : [{ type: 'message', content: [{ type: 'output_text', text: 'Confirmed.' }] }] }); },
  });
  assert.deepEqual(executed, ['show']); assert.equal(result.text, 'Confirmed.');
  assert.equal(LIVE_BACKEND_MODEL, 'gpt-6-astra'); assert.equal(LIVE_BACKEND_REASONING_EFFORT, 'high');
  for (const request of requests) {
    assert.equal(request.model, LIVE_BACKEND_MODEL);
    assert.equal(request.service_tier, 'default');
    assert.deepEqual(request.reasoning, { effort: LIVE_BACKEND_REASONING_EFFORT });
    assert.equal(request.max_output_tokens, 8192, 'Every round leaves room for high reasoning and a visible answer');
    assert.equal(request.store, false); assert.equal(request.parallel_tool_calls, false);
    assert.equal('temperature' in request, false); assert.equal('top_p' in request, false);
  }
  assert.deepEqual(requests[0].include, ['reasoning.encrypted_content']);
  assert.deepEqual(requests[1].tools, []); assert.equal(requests[1].tool_choice, 'none');
  let attempts = 0;
  await assert.rejects(runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal, tools: [], execute: async () => ({ data: {} }), fetch: async () => { attempts++; return new Response(null, { status: 429 }); } }), /busy/);
  assert.equal(attempts, 1);
});

test('tool failures can return deterministic spoken text without a continuation', async () => {
  let requests = 0;
  const result = await runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'search', description: '', parameters: {} }], maxToolRounds: 1,
    execute: async () => ({ data: { status: 'unavailable' }, directText: 'Image search returned no displayable results.' }),
    fetch: async () => { requests++; return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'search', call_id: 'call_search', arguments: '{}' }] }); },
  });
  assert.equal(result.text, 'Image search returned no displayable results.'); assert.equal(requests, 1);
});

test('unsupported or multiple backend tools never execute', async () => {
  for (const output of [[{ type: 'function_call', name: 'unknown', call_id: 'a', arguments: '{}' }], [1, 2].map(i => ({ type: 'function_call', name: 'show', call_id: String(i), arguments: '{}' }))]) {
    let executions = 0;
    await assert.rejects(runLiveBackend({ apiKey: 'synthetic', instructions: '', context: {}, signal: new AbortController().signal,
      tools: [{ type: 'function', name: 'show', description: '', parameters: {} }], execute: async () => { executions++; return { data: {} }; }, fetch: async () => Response.json({ status: 'completed', output }) }));
    assert.equal(executions, 0);
  }
});

test('audio activity uses media levels, with separate input and output states', () => {
  const states: unknown[] = []; const sample = createAudioActivity(state => states.push(state));
  sample(0, 0.1, 0); sample(0.1, 0.1, 100); sample(0, 0, 1500);
  assert.deepEqual(states, [{ inputActive: false, outputActive: true }, { inputActive: true, outputActive: true }, { inputActive: false, outputActive: false }]);
});

test('idle timer waits through audio and backend work, then closes once', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let ended = 0;
  const idle = createLiveIdleTimer({ timeoutMs: 1000, onIdle: () => { ended++; } });
  idle.start(); t.mock.timers.tick(999); assert.equal(ended, 0);
  idle.observeAudio({ inputActive: true, outputActive: false }); t.mock.timers.tick(2000); assert.equal(ended, 0);
  idle.observeAudio({ inputActive: false, outputActive: false }); idle.observeBusy(true); t.mock.timers.tick(2000); assert.equal(ended, 0);
  idle.observeBusy(false); t.mock.timers.tick(999); assert.equal(ended, 0); t.mock.timers.tick(1); assert.equal(ended, 1);
  assert.equal(liveIdleMessage(60_000), 'Voice ended after 1 minute of inactivity. Tap the wave to continue.');
  t.mock.timers.tick(2000); assert.equal(ended, 1);
});

test('startup protection preserves capture and ends two seconds after actual playback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clone = { enabled: true, stop() {} }, source = { enabled: true, clone: () => clone };
  const guard = createStartupAudioGuard({ stream: { getAudioTracks: () => [source as unknown as MediaStreamTrack] }, enabled: true });
  guard.start(); assert.equal(source.enabled, true); assert.equal(clone.enabled, false);
  t.mock.timers.tick(3000); guard.playbackStarted(); t.mock.timers.tick(1500); guard.playbackStarted(); t.mock.timers.tick(500);
  assert.equal(clone.enabled, true); guard.setInputEnabled(false); assert.equal(clone.enabled, false); guard.dispose();
});

test('the installed sibling checkout has byte-identical Live runtime and browser architecture', () => {
  const sibling = process.cwd().endsWith('/theVoice') ? '../flowpath' : '../theVoice';
  if (!existsSync(`${sibling}/lib/gpt-live/protocol.ts`)) return; // Each repo also builds independently.
  for (const file of ['protocol.ts', 'runtime.ts', 'backend.ts', 'browser.ts', 'idle.ts']) assert.equal(readFileSync(`lib/gpt-live/${file}`, 'utf8'), readFileSync(`${sibling}/lib/gpt-live/${file}`, 'utf8'), file);
});


test('backend chains different capabilities using each preceding tool result', async () => {
  const executed: string[] = [];
  let requests = 0;
  const result = await runVisitorTask({ channel: 'chat', model: 'synthetic', apiKey: 'synthetic', instructions: 'Complete the requested task.', context: { request: 'Find an item, retrieve details and display a comparison.' }, signal: new AbortController().signal,
    tools: ['find', 'retrieve', 'display'].map(name => ({ type: 'function', name, description: name, parameters: {} })),
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'find') return { data: { reference: 'resolved-item' } };
      if (name === 'retrieve') { assert.deepEqual(JSON.parse(args), { reference: 'resolved-item' }); return { data: { details: 'retrieved-details' } }; }
      assert.deepEqual(JSON.parse(args), { details: 'retrieved-details' });
      return { data: { status: 'applied' } };
    },
    fetch: async (_url, init) => {
      const request = JSON.parse(String(init?.body)); requests++;
      assert.equal(request.parallel_tool_calls, false);
      const results = request.input.filter((item: { type?: string }) => item.type === 'function_call_output');
      assert.equal(results.length, requests - 1);
      if (requests > 1) assert.deepEqual(JSON.parse(results.at(-1).output), requests === 2 ? { reference: 'resolved-item' } : requests === 3 ? { details: 'retrieved-details' } : { status: 'applied' });
      return Response.json({ status: 'completed', output: requests < 4
        ? [{ type: 'function_call', name: ['find', 'retrieve', 'display'][requests - 1], call_id: `step-${requests}`, arguments: JSON.stringify(requests === 1 ? {} : requests === 2 ? { reference: 'resolved-item' } : { details: 'retrieved-details' }) }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'The comparison is displayed.' }] }] });
    } });
  assert.deepEqual(executed, ['find', 'retrieve', 'display']); assert.equal(requests, 4); assert.equal(result.text, 'The comparison is displayed.');
});

test('cancellation after a chained tool prevents the next model call', async () => {
  const controller = new AbortController(); let requests = 0;
  await assert.rejects(runVisitorTask({ channel: 'voice', model: 'synthetic', apiKey: 'synthetic', instructions: '', context: {}, signal: controller.signal,
    tools: [{ type: 'function', name: 'find', description: '', parameters: {} }],
    execute: async () => { controller.abort(); return { data: { reference: 'discarded' } }; },
    fetch: async () => { requests++; return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'find', call_id: 'step-1', arguments: '{}' }] }); },
  }), { name: 'AbortError' });
  assert.equal(requests, 1);
});


test('chat uses the same sequential executor without voice transport instructions', async () => {
  let calls = 0;
  const result = await runVisitorTask({ channel: 'chat', model: 'synthetic-model', apiKey: 'synthetic', instructions: '', context: { request: 'Find and display an item' }, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'lookup', description: '', parameters: {} }], execute: async () => ({ data: { id: 'published-item', status: 'retrieved' } }),
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body)); calls++;
      assert.equal(body.model, 'synthetic-model');
      assert.match(body.instructions, /AI assistant for this publisher's website/);
      assert.doesNotMatch(body.instructions, /Transcripts may be incomplete|spoken delivery/);
      if (calls === 1) return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'lookup', arguments: '{}', call_id: 'lookup-1' }] });
      assert.equal(JSON.parse(body.input.at(-1).output).id, 'published-item');
      return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'The item was found; it has not been displayed yet.' }] }] });
    } });
  assert.equal(calls, 2); assert.match(result.text, /not been displayed/);
});


test('website task refreshes workspace instructions after each acknowledged action', async () => {
  let revision = 0, calls = 0;
  await runVisitorTask({ channel: 'chat', model: 'synthetic', apiKey: 'synthetic',
    instructions: () => `Current workspace revision: ${revision}`, context: {}, signal: new AbortController().signal,
    tools: [{ type: 'function', name: 'display', description: '', parameters: {} }],
    execute: async () => { revision++; return { data: { status: 'applied', revision } }; },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.match(body.instructions, new RegExp(`Current workspace revision: ${calls}`));
      calls++;
      return Response.json({ status: 'completed', output: calls < 3
        ? [{ type: 'function_call', name: 'display', arguments: '{}', call_id: `display-${calls}` }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }] });
    } });
  assert.equal(calls, 3); assert.equal(revision, 2);
});
