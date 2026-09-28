import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyWorkspace } from '@thevoice/platform-ui/workspace';
import { newSite, modifySite } from '../lib/site-store';
import { applyCommand } from '../lib/site-commands';
import { DEFAULT_EXPLORE_SETTINGS, type ExploreResult } from '../lib/explore-model';
import { createVisitorTaskBridge, readVisitorConversationMemory } from '../lib/visitor-task-bridge';
import { visitorTaskContext } from '../lib/visitor-task-context';
import { publishedWorkspace } from '../lib/visitor-workspace';
import { createVisitorRealtimeControl, type VisitorControlSocket } from '../lib/visitor-realtime-control';
import { sampleContent } from '../lib/site-model';
import type { VisitorRealtimeEvent } from '../lib/visitor-realtime';
import { visitorChatTask } from '../lib/visitor-chat-task';
import { submitVisitorRealtimeControl } from '../lib/visitor-realtime-mailbox';
import type { VisitorControlCapability, VisitorContext } from '../lib/visitor-realtime-context';
import type { VisitorChatEvent } from '../lib/visitor-chat-protocol';
import { FakeLiveSocket, flushLive, liveAnswer, liveTool } from './helpers/live-fixture';
import { VisitorConversationHistory } from '../lib/visitor-conversation-history';
import { visitorHistorySchema, type VisitorHistory } from '../lib/visitor-request';
import { expandPromptData } from './helpers/prompt-context-fixture';

// Provider cache framing can move developer guidance out of body.instructions;
// factual data may now live in the self-contained current-request envelope.
type ModelRequest = { instructions?: unknown; input?: unknown };
function inputOf(request: ModelRequest) {
  const user = (request.input as { role?: string; content?: string | { text?: string }[] }[]).find(item => item.role === 'user');
  return JSON.parse(typeof user?.content === 'string' ? user.content : user?.content?.find(part => part.text)?.text ?? '{}');
}
function guideOf(request: ModelRequest) {
  const developers = (request.input as { role?: string; content?: string | { text?: string }[] }[]).filter(item => item.role === 'developer');
  return [String(request.instructions), ...developers.map(item => typeof item.content === 'string' ? item.content : item.content?.map(part => part.text ?? '').join('\n') ?? '')].join('\n');
}
function referenceTextOf(request: ModelRequest) {
  const input = inputOf(request);
  return `${guideOf(request)}\n${JSON.stringify(input.promptData ? expandPromptData(input) : input)}`;
}

const availability = { enabled: true, mode: 'voice' as const, live: true, chatRemaining: 25, voiceRemaining: 5, resetsAt: '' };
async function fixture(slug: string) {
  const user = { uid: 'local-demo', mode: 'demo' as const, email: null, displayName: null };
  let site = await newSite(user, { name: 'Synthetic service', slug, kind: 'general' });
  site = await modifySite(user, site.id, site.revision, stored => applyCommand(stored, { action: 'save', revision: stored.revision,
    content: { ...stored.draft, visitorSpeaksFirst: true, explore: { ...DEFAULT_EXPLORE_SETTINGS, enabled: true } } }));
  await modifySite(user, site.id, site.revision, stored => applyCommand(stored, { action: 'publish', revision: stored.revision }));
  const data = await visitorTaskContext(slug), bridge = await createVisitorTaskBridge(slug);
  const saved = await data.store.read(bridge.sessionId, data.publication);
  const context: VisitorContext = { workspace: emptyWorkspace(publishedWorkspace(data.site.content).publicationId),
    taskSession: { sessionId: saved.id, revision: saved.revision, generation: saved.generation } };
  return { slug, ...data, context, sessionId: saved.id };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function voice(f: Fixture, outputs: unknown[], search: () => Promise<ExploreResult>, history: VisitorHistory = []) {
  const socket = new FakeLiveSocket(), requests: Record<string, unknown>[] = [], failures: string[] = [];
  const events: VisitorRealtimeEvent[] = [];
  const completed: Extract<VisitorRealtimeEvent, { type: 'answer_completed' }>[] = [];
  let turn = 0, sequence = 0, resolve!: () => void, reject!: (error: Error) => void;
  const control = createVisitorRealtimeControl({ taskSlug: f.slug, callId: randomUUID(), apiKey: 'synthetic', content: f.site.content, context: f.context, history,
    initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {},
    signal: new AbortController().signal, socketFactory: () => socket as unknown as VisitorControlSocket, search,
    onFatal: message => { failures.push(message); reject?.(new Error(message)); },
    emit: event => {
      events.push(event);
      if (event.type === 'response_started') void control.applyControl({ seq: ++sequence, interactionRevision: event.interactionRevision, viewRevision: event.revision,
        ready: true, context: control.recordingSnapshot().context, preparationAck: { revision: event.revision, status: 'applied' } }).catch(reject);
      if (event.type === 'answer_completed') completed.push(event);
      if (event.type === 'task_error') reject?.(new Error(event.message));
      if (event.type === 'backend_idle') resolve?.();
      if (event.type === 'navigation') void control.applyControl({ seq: ++sequence, interactionRevision: 0, viewRevision: event.revision,
        ready: true, context: f.context, navigationAck: { id: event.id, status: 'applied' } }).catch(reject);
    },
    fetch: async (_url, init) => { requests.push(JSON.parse(String(init?.body))); const output = outputs.shift(); assert.ok(output, 'Unexpected model request'); return Response.json({ status: 'completed', output: [output] }); },
  });
  socket.open(); await control.ready; control.start();
  return { socket, control, requests, failures, completed, events, async ask(text: string) {
    const finished = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => reject(new Error('Mocked voice request timed out')), 5000);
    const start = ++turn * 2500;
    socket.frame({ type: 'session.input_transcript.delta', delta: text, start_ms: start, end_ms: start + 200 });
    socket.frame({ type: 'session.delegation.created', offset_ms: start + 200, delegation: { id: `request-${turn}`, target: 'client' } });
    try { await finished; await flushLive(); } finally { clearTimeout(timer); }
  } };
}
async function chat(f: Fixture, text: string, history: VisitorHistory = []) {
  const response = visitorChatTask({ slug: f.slug, siteId: f.site.siteId, content: f.site.content, availability,
    request: { kind: 'chat', requestId: randomUUID(), text, history, context: f.context }, signal: new AbortController().signal, onUsage() {} });
  const events: VisitorChatEvent[] = [];
  let control: VisitorControlCapability | undefined, sequence = 0, buffer = '';
  const reader = response.body!.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { reader.releaseLock(); break; }
    buffer += new TextDecoder().decode(value);
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const event = JSON.parse(buffer.slice(0, end)) as VisitorChatEvent; buffer = buffer.slice(end + 1); events.push(event);
      if (event.type === 'control') control = event.control;
      if (event.type === 'navigation') {
        assert.ok(control);
        await submitVisitorRealtimeControl(f.slug, control, { seq: ++sequence, interactionRevision: 0, viewRevision: 0, ready: true,
          context: f.context, navigationAck: { id: event.id, status: 'applied' } });
      }
    }
  }
  assert.equal(events.some(event => event.type === 'error'), false, JSON.stringify(events.filter(event => event.type === 'error')));
  assert.ok(events.some(event => event.type === 'done'));
  return events;
}

test('voice background lookup preserves cited evidence for synthesis and recall without a search panel', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'background-research-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture('background-reference');
    const query = 'What is the synthetic preservation temperature?';
    const answer = 'The synthetic preservation temperature is 18°C for the sealed example sample only. Unsealed samples are excluded.';
    const source = { title: 'Synthetic preservation reference', url: 'https://example.com/preservation' };
    const result: ExploreResult = { id: 'preservation-reference', kind: 'web', query, fetchedAt: new Date().toISOString(), demo: true,
      answer, sources: [source], citations: [{ ...source, start: 0, end: answer.length }], images: [], map: null };
    const synthesis = 'Use 18°C for the sealed example sample only. Unsealed samples are excluded. [Preservation reference](https://example.com/preservation)';
    let searches = 0;
    const h = await voice(f, [liveTool('visitor_task', { capabilityId: 'research.lookup', input: { query, kind: 'web' } }), liveAnswer(synthesis), liveAnswer(synthesis)], async () => { searches++; return result; });
    try {
      await h.ask(query);
      assert.equal(h.requests.length, 2, 'An exact lookup must still pass its complete citations to synthesis');
      const toolOutput = (h.requests[1].input as { type: string; output?: string }[]).find(item => item.type === 'function_call_output');
      const { evidenceExcerpts, omittedEvidenceExcerpts, ...returnedResult } = JSON.parse(toolOutput!.output!).result;
      assert.deepEqual(returnedResult, result, 'The original answer, conditions, source and citation offsets remain intact');
      assert.equal(omittedEvidenceExcerpts, 0);
      assert.equal(evidenceExcerpts.length, 1);
      assert.match(evidenceExcerpts[0].excerptId, /^excerpt_/);
      assert.deepEqual({ ...evidenceExcerpts[0], excerptId: undefined }, { excerptId: undefined, resultId: result.id, start: 0, end: answer.length, excerpt: answer, url: source.url });
      assert.deepEqual(h.completed.map(event => event.text), [synthesis]);
      assert.equal(h.events.some(event => event.type === 'navigation' || event.type === 'plan'), false, 'Background lookup must not open a search panel');
      assert.ok(h.events.some(event => event.type === 'progress' && event.stage === 'searching'), 'Visual status may report research without displaying results');
      const guide = guideOf(h.requests[0]);
      assert.match(guide, /research\.lookup capability for background evidence/);
      assert.doesNotMatch(guide, /Use search_explore when external information is requested or needed/);
      assert.doesNotMatch(guide, /Briefly distinguish it as general background/);
      await h.ask('Use the same conditions for another sealed sample.');
      assert.ok(referenceTextOf(h.requests.at(-1)!).includes(answer));
      assert.ok(referenceTextOf(h.requests.at(-1)!).includes(source.url));
      assert.equal(searches, 1);
      assert.deepEqual(h.failures, []);
    } finally { await h.control.close(); }
    t.diagnostic('Mocked model/voice transport; verifies source delivery and display routing, not live generated quality.');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('chat background lookup produces a sourced answer without displaying retrieved search results', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-background-research-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const originalFetch = globalThis.fetch;
  try {
    const f = await fixture('background-learning');
    f.context.carousel = { version: 1, open: true, revision: 0, cards: [], activeId: null, previousId: null, lastNarratedId: null, expanded: false, reading: { scrollTop: 0, blockId: null }, media: null };
    const query = 'What is the synthetic course format?';
    let calls = 0, sourceUrl = '';
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'No live network is allowed');
      const body = JSON.parse(String(init?.body));
      assert.match(guideOf(body), /research\.lookup to gather a missing fact/);
      assert.match(guideOf(body), /Never use it to invent this publisher.s prices/);
      assert.doesNotMatch(guideOf(body), /Briefly distinguish it as general background/);
      if (++calls === 1) return Response.json({ status: 'completed', output: [liveTool('visitor_task', { capabilityId: 'research.lookup', input: { query, kind: 'web' } })] });
      assert.equal(calls, 2, 'The background result requires one synthesis round, not another lookup');
      const evidence = JSON.parse(body.input.find((item: { type: string }) => item.type === 'function_call_output').output).result as ExploreResult;
      assert.equal(evidence.query, query); assert.ok(evidence.sources.length); assert.ok(evidence.fetchedAt);
      sourceUrl = evidence.sources[0].url;
      return Response.json({ status: 'completed', output: [liveAnswer(`This is the synthetic reference. [Source](${sourceUrl})`)] });
    };
    const events = await chat(f, query);
    assert.equal(calls, 2);
    const navigation = events.filter(event => event.type === 'navigation');
    assert.deepEqual(navigation.map(event => event.target.kind), ['answer'], 'Only the synthesized answer changes the surface');
    assert.ok(navigation[0].target.kind === 'answer' && navigation[0].target.text.includes(sourceUrl));
    assert.equal((await readVisitorConversationMemory(f.slug, f.sessionId)).available.length, 1);
  } finally { globalThis.fetch = originalFetch; process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('a hypothetical assumption survives twelve voice exchanges, a typed follow-up and resumed voice in actual model inputs', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'long-conversation-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  const originalFetch = globalThis.fetch;
  try {
    const f = await fixture('hypothetical-workshop'), history = new VisitorConversationHistory();
    const assumption = 'For this hypothetical workshop, use 7 guests and a 12% materials allowance; these are not published terms.';
    const noSearch = async (): Promise<ExploreResult> => { throw new Error('Retaining a hypothetical assumption must not trigger research'); };
    const first = await voice(f, Array.from({ length: 13 }, (_, index) => liveAnswer(`Hypothetical comparison ${index} uses your stated guest count and allowance.`)), noSearch);
    try {
      for (let index = 0; index < 13; index++) {
        const text = index ? `Compare hypothetical workshop option ${index} using the same assumptions.` : assumption;
        await first.ask(text);
        history.append([{ role: 'user', text }, { role: 'assistant', text: first.completed.at(-1)!.text }]);
      }
      const finalInput = inputOf(first.requests.at(-1)!);
      assert.equal(finalInput.history.length, 24, 'The thirteenth request receives all twelve completed exchanges');
      assert.deepEqual(finalInput.history[0], { role: 'user', text: assumption });
      assert.match(guideOf(first.requests.at(-1)!), /do not turn a hypothetical value or a prior assistant answer into a verified publisher fact/);
      assert.equal(first.requests.length, 13, 'Retention causes no summary or extra model call');
      assert.deepEqual(first.failures, []);
    } finally { await first.control.close(); }
    // Display navigation invalidates unfinished writes, then the same client history travels to chat.
    for (const navigation of ['Home', 'Back', 'Forward']) {
      const pending = history.checkpoint(); history.invalidatePending();
      assert.equal(history.append([{ role: 'assistant', text: `Cancelled before ${navigation}` }], pending), false);
    }
    history.endVoice();
    let chatCalls = 0;
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'No live network is allowed');
      const body = JSON.parse(String(init?.body)), input = inputOf(body);
      assert.equal(input.history.length, 26);
      assert.deepEqual(input.history[0], { role: 'user', text: assumption });
      assert.match(guideOf(body), /A later correction supersedes an earlier assumption/);
      chatCalls++;
      return Response.json({ status: 'completed', output: [liveAnswer('The hypothetical guest count is now 9; the hypothetical allowance remains 12%.')] });
    };
    const correction = 'Keep the same hypothetical allowance, but use 9 guests.';
    await chat(f, correction, visitorHistorySchema.parse(history.snapshot()));
    assert.equal(chatCalls, 1);
    history.append([{ role: 'user', text: correction }, { role: 'assistant', text: 'The hypothetical guest count is now 9; the hypothetical allowance remains 12%.' }]);
    history.beginVoice();
    const resumed = await voice(f, [liveAnswer('The next example uses those same hypothetical assumptions.')], noSearch, visitorHistorySchema.parse(history.snapshot()));
    try {
      const frontline = resumed.socket.sent.filter(event => event.type === 'session.thinking.append').map(event => event.content).join('');
      await resumed.ask('Apply those hypothetical assumptions to the next example.');
      const input = inputOf(resumed.requests[0]);
      assert.equal(input.history.length, 28);
      assert.equal(input.history[0].text, assumption);
      assert.equal(input.history.at(-2).text, correction);
      assert.deepEqual((await readVisitorConversationMemory(f.slug, f.sessionId)).available, [], 'Dialogue did not become sourced research');
      assert.deepEqual(resumed.failures, []);
      // Frontline recall is independent of the full bounded backend history.
      assert.ok(frontline.includes(assumption), 'Resumed frontline voice must retain the original hypothetical assumption');
      assert.ok(frontline.includes(correction));
    } finally { await resumed.control.close(); }
    t.diagnostic('Synthetic providers verify full model inputs and no extra calls, not live interpretation or speech.');
  } finally { globalThis.fetch = originalFetch; process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('one voice lookup survives an empty view, typed follow-up and reconnect without another search', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'conversation-recall-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture('recall-services');
    const answer = 'The synthetic delivery surcharge is 7.625% of the item subtotal, only for Harbor pickup. Delivery elsewhere is excluded.';
    const source = { title: 'Synthetic published rate', url: 'https://example.com/harbor-rate' };
    const result: ExploreResult = { id: 'harbor-rate', kind: 'web', query: 'Harbor pickup surcharge', fetchedAt: new Date().toISOString(), demo: true,
      answer, sources: [source], citations: [{ ...source, start: 0, end: answer.length }], images: [], map: null };
    let searches = 0;
    const firstAnswer = 'The synthetic earlier estimate was 123.45, for Harbor pickup only; delivery elsewhere is excluded.';
    const first = await voice(f, [liveTool('search_explore', { kind: 'web', query: result.query }), liveAnswer(firstAnswer), liveAnswer('The estimate uses the same rate and its conditions.')], async () => { searches++; return result; });
    try {
      await first.ask('Look up the surcharge for this destination.');
      assert.deepEqual(first.completed.map(event => event.text), [firstAnswer], 'the final backend answer is emitted once, independently of a display change');
      await first.ask('Use that same surcharge for a larger order.');
      assert.match(referenceTextOf(first.requests.at(-1)!), /7\.625%/);
      assert.ok(referenceTextOf(first.requests.at(-1)!).includes('Delivery elsewhere is excluded.'));
      const nextInput = inputOf(first.requests.at(-1)!);
      assert.deepEqual(nextInput.history, [
        { role: 'user', text: 'Look up the surcharge for this destination.' },
        { role: 'assistant', text: firstAnswer },
      ], 'a later request receives the exact completed dialogue without assistant captions or a visible card');
      assert.equal(nextInput.currentView, undefined);
      assert.equal(nextInput.transcripts.some((fragment: { role: string }) => fragment.role === 'assistant'), false);
      assert.equal(first.completed.filter(event => event.text === firstAnswer).length, 1);
      assert.equal(searches, 1);
    } finally { await first.control.close(); }
    const originalFetch = globalThis.fetch, chatRequests: Record<string, unknown>[] = [];
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'No live network is allowed');
      const body = JSON.parse(String(init?.body)); chatRequests.push(body);
      assert.ok(referenceTextOf(body).includes(answer)); assert.ok(referenceTextOf(body).includes(source.url)); assert.ok(referenceTextOf(body).includes(result.fetchedAt));
      return Response.json({ status: 'completed', output: [liveAnswer('The new estimate uses the retained rate.')] });
    };
    try { await chat(f, 'What about two items instead of one?'); } finally { globalThis.fetch = originalFetch; }
    assert.equal(chatRequests.length, 1, 'Recall needs no additional model/tool round');
    const reconnected = await voice(f, [liveAnswer('I still have the applicable sourced rate.')], async () => { searches++; throw new Error('Unexpected repeat search'); });
    try {
      await reconnected.ask('Do you still have the rate we just looked up?');
      assert.ok(referenceTextOf(reconnected.requests[0]).includes(answer));
      await flushLive();
      const memoryText = reconnected.socket.sent.filter(event => String(event.content).startsWith('[memory ')).map(event => String(event.content).replace(/^\[memory \d+ part \d+\/\d+\] /, '')).join('');
      assert.ok(memoryText.includes(answer), 'Frontline voice also receives complete historical research');
      assert.deepEqual(reconnected.failures, []); assert.equal(searches, 1);
    } finally { await reconnected.control.close(); }
    assert.deepEqual((await readVisitorConversationMemory(f.slug, f.sessionId)).available, [result]);
    t.diagnostic('Mocked transport and model inputs verified; spoken behavior and generated arithmetic are not live-tested.');
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});

test('a cancelled late answer never enters later same-connection dialogue or emits completion', { timeout: 5000 }, async t => {
  const socket = new FakeLiveSocket(), requests: Record<string, unknown>[] = [], events: VisitorRealtimeEvent[] = [], failures: string[] = [];
  let finishOld!: (response: Response) => void, requested!: () => void, completed!: () => void, oldSignal!: AbortSignal, sequence = 0;
  const firstRequest = new Promise<void>(resolve => { requested = resolve; });
  const freshCompletion = new Promise<void>(resolve => { completed = resolve; });
  const history = [{ role: 'user' as const, text: 'What is the published group limit?' }, { role: 'assistant' as const, text: 'The earlier confirmed group limit is 12 people.' }];
  const control = createVisitorRealtimeControl({ callId: randomUUID(), apiKey: 'synthetic', content: { ...sampleContent('general'), visitorSpeaksFirst: true }, history,
    initialAvailability: availability, reserveTurn: async () => availability, assertCurrent: async () => {}, signal: new AbortController().signal,
    socketFactory: () => socket as unknown as VisitorControlSocket, onFatal: message => failures.push(message),
    emit: event => { events.push(event); if (event.type === 'answer_completed') completed();
      if (event.type === 'response_started') void control.applyControl({ seq: ++sequence, interactionRevision: event.interactionRevision, viewRevision: event.revision, ready: true,
        context: control.recordingSnapshot().context, preparationAck: { revision: event.revision, status: 'applied' } }).catch(error => failures.push(String(error))); },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1) { oldSignal = init!.signal!; requested(); return new Promise(resolve => { finishOld = resolve; }); }
      return Response.json({ status: 'completed', output: [liveAnswer('Fresh confirmed answer.')] });
    },
  });
  t.after(() => control.close()); socket.open(); await control.ready; control.start();
  socket.user('Calculate the old selection.'); await firstRequest;
  await control.applyControl({ seq: ++sequence, interactionRevision: 1, viewRevision: 0, ready: true, context: {} });
  assert.equal(oldSignal.aborted, true);
  finishOld(Response.json({ status: 'completed', output: [liveAnswer('Obsolete estimate: 987.65.')] })); await flushLive();
  assert.equal(events.some(event => event.type === 'answer_completed'), false);
  socket.frame({ type: 'session.input_transcript.delta', delta: 'What was the confirmed group limit?', start_ms: 3000, end_ms: 3200 });
  socket.frame({ type: 'session.delegation.created', offset_ms: 3200, delegation: { id: 'fresh-after-navigation', target: 'client' } });
  await freshCompletion; await flushLive();
  const input = inputOf(requests[1]);
  assert.deepEqual(input.history, history);
  assert.equal(JSON.stringify(input).includes('987.65'), false);
  assert.deepEqual(events.filter(event => event.type === 'answer_completed').map(event => event.text), ['Fresh confirmed answer.']);
  assert.deepEqual(failures, []);
});

test('chat search retains its result for voice even when no external card reference remains', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-memory-')), previous = process.env;
  process.env = { NODE_ENV: 'test', VOICE_BACKEND: 'demo', VOICE_AI_MODE: 'demo', VOICE_DATA_DIR: directory };
  try {
    const f = await fixture('recall-learning'), originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url) => {
      assert.equal(String(url), 'https://api.openai.com/v1/responses', 'External search uses the existing offline demo');
      return Response.json({ status: 'completed', output: [++calls === 1 ? liveTool('search_explore', { kind: 'web', query: 'Historical course scheduling conventions' }) : liveAnswer('The reference is ready.')] });
    };
    try { await chat(f, 'Look up historical course scheduling conventions.'); } finally { globalThis.fetch = originalFetch; }
    assert.equal(calls, 2);
    const stored = await readVisitorConversationMemory(f.slug, f.sessionId);
    assert.equal(stored.available.length, 1); assert.equal(stored.available[0].query, 'Historical course scheduling conventions');
    const resumed = await voice(f, [liveAnswer('The earlier source is available.')], async () => { throw new Error('Recall must not search'); });
    try {
      await resumed.ask('What did that earlier source say?');
      assert.ok(referenceTextOf(resumed.requests[0]).includes(stored.available[0].answer));
      assert.ok(referenceTextOf(resumed.requests[0]).includes(stored.available[0].query));
    } finally { await resumed.control.close(); }
  } finally { process.env = previous; await rm(directory, { recursive: true, force: true }); }
});
