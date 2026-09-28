import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runVisitorTask, type VisitorTaskOptions } from '../lib/visitor-task-runner';
import { VisitorTaskConnectionError } from '../lib/visitor-task-error';
import type { TestObservation } from '../lib/visitor-test-events';

const socketFailure = () => new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
const answer = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer.' }] }], usage: { total_tokens: 10 } };
const frame = (event: unknown) => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
const base = (): VisitorTaskOptions => ({ channel: 'chat', model: 'offline-test-model', apiKey: 'synthetic', instructions: 'Offline fixture', context: {}, signal: new AbortController().signal, tools: [], maxToolRounds: 0, execute: async () => { assert.fail('No tool expected'); } });
const transportEvents = (events: TestObservation[]) => events.filter(event => event.type === 'model.transport').map(event => event.data as Record<string, unknown>);

test('HTTP pre-header failure records a unique client ID, retains unknown usage, and never retries automatically', async () => {
  const events: TestObservation[] = [], clientIds: string[] = []; let requests = 0, usage = 0;
  const options = { ...base(), record: (event: TestObservation) => events.push(event), onUsage: () => { usage++; }, fetch: async (_url: unknown, init?: RequestInit) => {
    requests++; clientIds.push(new Headers(init?.headers).get('X-Client-Request-Id')!);
    assert.equal(init?.redirect, 'error'); assert.equal(JSON.parse(String(init?.body)).stream, true);
    if (requests === 1) throw socketFailure();
    return Response.json(answer, { headers: { 'x-request-id': 'req_second' } });
  } };
  await assert.rejects(runVisitorTask(options), VisitorTaskConnectionError);
  assert.equal(requests, 1); assert.equal(usage, 0, 'A dropped request must not be settled as zero usage');
  assert.deepEqual(transportEvents(events).map(event => [event.phase, event.stage, event.events]), [['started', 'request', 0], ['failed', 'request', 0]]);
  assert.equal(transportEvents(events)[1].requestId, undefined, 'No provider header was received');
  assert.equal((await runVisitorTask(options)).text, 'Synthetic answer.');
  assert.equal(requests, 2); assert.equal(usage, 1); assert.notEqual(clientIds[0], clientIds[1]);
  for (const id of clientIds) assert.match(id, /^[a-f0-9-]{36}$/);
  assert.equal(transportEvents(events).at(-1)?.requestId, 'req_second');
  assert.equal(JSON.stringify(transportEvents(events)).includes('Authorization'), false);
});

test('HTTP diagnostics distinguish a stream disconnect after headers and partial output, without executing or settling it', async () => {
  const events: TestObservation[] = []; let requests = 0, usage = 0, chunks = 0;
  const response = new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (chunks++ === 0) controller.enqueue(frame({ type: 'response.function_call_arguments.delta', delta: '{"partial":' }));
    else controller.error(socketFailure());
  } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_partial', 'set-cookie': 'private-fixture' } });
  await assert.rejects(runVisitorTask({ ...base(), record: event => events.push(event), onUsage: () => { usage++; }, fetch: async () => { requests++; return response; } }), VisitorTaskConnectionError);
  assert.equal(requests, 1); assert.equal(usage, 0); assert.equal(response.body!.locked, false);
  const observed = transportEvents(events);
  assert.deepEqual(observed.map(event => event.phase), ['started', 'headers', 'first_event', 'failed']);
  assert.equal(observed.at(-1)?.stage, 'stream'); assert.equal(observed.at(-1)?.events, 1);
  assert.equal(observed.at(-1)?.requestId, 'req_partial'); assert.equal(observed.at(-1)?.status, 200);
  assert.equal(JSON.stringify(observed).includes('private-fixture'), false);
});

test('HTTP cancellation stays cancellation, and selected metadata excludes malformed provider request IDs', async () => {
  const events: TestObservation[] = [], controller = new AbortController();
  await assert.rejects(runVisitorTask({ ...base(), signal: controller.signal, record: event => events.push(event), fetch: async () => { controller.abort(); throw socketFailure(); } }), { name: 'AbortError' });
  assert.equal(transportEvents(events).at(-1)?.phase, 'cancelled');
  const next: TestObservation[] = [];
  await runVisitorTask({ ...base(), record: event => next.push(event), fetch: async () => Response.json(answer, { headers: { 'x-request-id': 'untrusted provider sentence', 'authorization': 'sensitive-fixture' } }) });
  assert.ok(transportEvents(next).every(event => !('requestId' in event)));
  assert.equal(JSON.stringify(transportEvents(next)).includes('sensitive-fixture'), false);
});

test('HTTP rejection cancels an unread error body promptly even if its cleanup promise stalls', { timeout: 2000 }, async () => {
  const events: TestObservation[] = []; let cancelled = 0, requests = 0, usage = 0;
  const response = new Response(new ReadableStream({ cancel() { cancelled++; return new Promise<void>(() => {}); } }), { status: 503, headers: { 'x-request-id': 'req_rejected' } });
  await assert.rejects(runVisitorTask({ ...base(), record: event => events.push(event), onUsage: () => { usage++; }, fetch: async () => { requests++; return response; } }), /temporarily unavailable/);
  assert.equal(cancelled, 1); assert.equal(requests, 1); assert.equal(usage, 0);
  const failure = transportEvents(events).at(-1);
  assert.equal(failure?.phase, 'failed'); assert.equal(failure?.stage, 'headers'); assert.equal(failure?.status, 503); assert.equal(failure?.requestId, 'req_rejected');
});

test('dropped HTTP requests retain their full isolated QA reservations; only terminal usage settles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'visitor-transport-accounting-')), recordingId = '00000000-0000-4000-8000-000000000001';
  try {
    await mkdir(join(directory, '.visitor-recordings'));
    await writeFile(join(directory, '.visitor-recordings', 'qa-budget.json'), JSON.stringify({ recordingId, slugs: ['synthetic-transport'], limitMicros: 1_000_000, voiceReserveMicros: 150_000 }));
    // The child changes cwd before importing the budget. No developer recording,
    // configured credential, network or real provider call can participate.
    const script = `
      import assert from 'node:assert/strict';
      import { runVisitorTask } from ${JSON.stringify(new URL('../lib/visitor-task-runner.ts', import.meta.url).href)};
      globalThis.fetch = () => { throw new Error('Network forbidden'); };
      const failure = () => new TypeError('fetch failed', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
      const payload = { status: 'completed', service_tier: 'default', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer.' }] }] };
      const record = Object.assign(() => {}, { recordingId: ${JSON.stringify(recordingId)} });
      const options = { model: 'gpt-5.6-luna', channel: 'chat', apiKey: 'offline-test', instructions: '', context: {}, signal: new AbortController().signal, tools: [], execute: async () => { assert.fail('No tool expected'); }, qaSlug: 'synthetic-transport', record };
      let calls = 0;
      await assert.rejects(runVisitorTask({ ...options, fetch: async () => { calls++; throw failure(); } }));
      const stream = terminal => {
        let chunks = 0;
        return new Response(new ReadableStream({ pull(controller) {
          if (chunks++ === 0) controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(terminal ? { type: 'response.completed', response: payload } : { type: 'response.output_text.delta', delta: 'Partial' }) + '\\n\\n'));
          else controller.error(failure());
        } }), { headers: { 'content-type': 'text/event-stream' } });
      };
      await assert.rejects(runVisitorTask({ ...options, fetch: async () => { calls++; return stream(false); } }));
      assert.equal(calls, 2, 'Neither failed request was replayed');
      assert.equal((await runVisitorTask({ ...options, fetch: async () => { calls++; return stream(true); } })).text, 'Synthetic answer.');
      assert.equal(calls, 3, 'A terminal tail drop cannot replay the completed request');
    `;
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script], { cwd: directory, encoding: 'utf8', timeout: 15_000, env: { NODE_ENV: 'development' } });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ledger = JSON.parse(await readFile(join(directory, '.visitor-recordings', `qa-budget-${recordingId}.json`), 'utf8'));
    assert.equal(ledger.entries.length, 3);
    assert.deepEqual(ledger.entries.map((entry: { status: string }) => entry.status), ['reserved', 'reserved', 'measured']);
    for (const entry of ledger.entries.slice(0, 2)) assert.equal(entry.chargedMicros, entry.reservedMicros);
    assert.equal(ledger.entries[2].chargedMicros, 28);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
