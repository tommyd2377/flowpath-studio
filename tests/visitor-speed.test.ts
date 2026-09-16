import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryIndexCache, compileQueryIndex } from '../lib/catalog-query-index';
import { CatalogRepository } from '../lib/catalog-repository';
import type { TaskDocuments } from '../lib/task-persistence';
import { taskFixture, fixtureQuery } from '../fixtures/visitor-tasks';
import { evaluateQuery } from '../lib/catalog-query';
import { runVisitorTask } from '../lib/visitor-task-runner';
import { readVisitorResponse } from '../lib/visitor-response-stream';
import { completedSearchAnswer, createVisitorResearchCache } from '../lib/visitor-research-cache';
import { demoExploreResult } from '../lib/explore-model';

const signal = () => new AbortController().signal;
function sse(events: unknown[]) {
  const text = events.map(event => `event: ignored\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('cold index builds coalesce and failed preparations can be retried', async () => {
  const cache = new QueryIndexCache(), index = compileQueryIndex(taskFixture()); let builds = 0;
  let release!: () => void;
  const prepare = () => cache.prepare('publication', async () => { builds++; await new Promise<void>(resolve => { release = resolve; }); return index; });
  const first = prepare(), second = prepare(); await Promise.resolve(); assert.equal(builds, 1); release();
  assert.equal(await first, await second); assert.equal(await prepare(), index); assert.equal(builds, 1);
  await assert.rejects(cache.prepare('failed', async () => { throw new Error('Synthetic read failure'); }));
  assert.equal(await cache.prepare('failed', async () => index), index);
});

test('persisted prose terms avoid full record reads; detail loads only its bounded chunk', async () => {
  const data = new Map<string, unknown>(), reads: string[] = [];
  let inflight = 0, peak = 0;
  const documents: TaskDocuments = {
    read: async key => { reads.push(key); inflight++; peak = Math.max(peak, inflight); await new Promise(resolve => setImmediate(resolve)); inflight--; return structuredClone(data.get(key) ?? null); },
    create: async (key, value) => { if (data.has(key)) throw new Error('exists'); data.set(key, structuredClone(value)); },
    compareAndSwap: async () => { throw new Error('Unexpected mutation'); },
  };
  const space = taskFixture(undefined, 300); space.publication.siteId = randomUUID();
  space.records[250].blocks = [{ id: 'prose', kind: 'paragraph', text: 'Distinctiveproseterm appears only in approved reading content.' }];
  const manifest = await new CatalogRepository(documents, documents).stage(space.publication.siteId, space);
  const repository = new CatalogRepository(documents, documents, true);
  reads.length = 0; peak = 0;
  const index = await repository.index(space.publication.siteId, manifest.id);
  await repository.indexReading(space.publication.siteId, manifest.id, index);
  assert.equal(reads.some(id => manifest.chunks.some(chunk => chunk.kind === 'records' && chunk.id === id)), false);
  assert.ok(peak > 1 && peak <= 4, `Read concurrency ${peak} must be bounded`);
  assert.deepEqual(evaluateQuery(index, { ...fixtureQuery(index.space), searchText: 'distinctiveproseterm' }).ordered, ['record-00250']);
  reads.length = 0;
  const [record] = await repository.records(manifest, ['record-00250']); assert.match(record.blocks[0].text, /Distinctive/);
  assert.equal(reads.length, 1);
  await repository.records(manifest, ['record-00250']); assert.equal(reads.length, 1, 'Immutable chunk is reused');
  await assert.rejects(repository.manifest(randomUUID(), manifest.id), /another site/);
  const corrupt = new CatalogRepository({ ...documents, read: async key => key === manifest.chunks.find(chunk => chunk.kind === 'reading')!.id ? [] : documents.read(key) }, documents);
  const other = await corrupt.index(space.publication.siteId, manifest.id);
  await assert.rejects(corrupt.indexReading(space.publication.siteId, manifest.id, other), /checksum/);
  // Pre-upgrade manifests remain readable without republishing.
  const legacy = { ...manifest, chunks: manifest.chunks.filter(chunk => chunk.kind !== 'reading') }; data.set(manifest.id, legacy);
  const old = new CatalogRepository(documents, documents), oldIndex = await old.index(space.publication.siteId, manifest.id);
  await old.indexReading(space.publication.siteId, manifest.id, oldIndex);
  assert.ok(oldIndex.tokens.get('distinctiveproseterm')?.has('record-00250'));
});

test('chat streams provisional final-answer text, never reasoning or partial tools', async () => {
  const received: string[] = []; let tools = 0, requests = 0;
  const output = { type: 'message', role: 'assistant', id: 'msg', phase: 'final_answer', content: [{ type: 'output_text', text: 'Café policy.' }] };
  const result = await runVisitorTask({ model: 'synthetic', apiKey: 'synthetic', channel: 'chat', context: {}, instructions: '', tools: [], maxToolRounds: 0, signal: signal(),
    onAnswer: text => received.push(text), execute: async () => { tools++; return { data: {} }; },
    fetch: async (_url, init) => { requests++; assert.equal(JSON.parse(String(init?.body)).stream, true); return sse([
      { type: 'response.reasoning_text.delta', delta: 'PRIVATE' },
      { type: 'response.function_call_arguments.delta', delta: '{"partial":' },
      { type: 'response.output_item.added', item: output },
      { type: 'response.output_text.delta', item_id: 'msg', delta: 'Café ' },
      { type: 'response.output_text.delta', item_id: 'msg', delta: 'policy.' },
      { type: 'response.completed', response: { status: 'completed', output: [output] } },
    ]); } });
  assert.equal(result.text, 'Café policy.'); assert.deepEqual(received, ['Café ', 'Café policy.', '']); assert.equal(tools, 0); assert.equal(requests, 1);
});

test('HTTP stream truncation, cancellation and incomplete tool responses do not execute or retry', async () => {
  await assert.rejects(readVisitorResponse(sse([{ type: 'response.output_text.delta', delta: 'Unfinished' }]), signal()), /did not finish/);
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  const job = readVisitorResponse(response, controller.signal); controller.abort(); await assert.rejects(job, { name: 'AbortError' }); assert.equal(cancelled, true);
  let executed = 0, requests = 0;
  await assert.rejects(runVisitorTask({ model: 'synthetic', apiKey: 'synthetic', channel: 'voice', context: {}, instructions: '', tools: [{ type: 'function', name: 'lookup', parameters: {}, description: '' }], signal: signal(), execute: async () => { executed++; return { data: {} }; }, fetch: async () => { requests++; return sse([{ type: 'response.incomplete', response: { status: 'incomplete', output: [{ type: 'function_call', name: 'lookup', arguments: '{}', call_id: 'a' }] } }]); } }), /did not finish/);
  assert.equal(executed, 0); assert.equal(requests, 1);
});

test('grounded exact lookup skips synthesis; compound requests and missing citations do not', () => {
  const result = { ...demoExploreResult('What is the Eiffel Tower?', 'web'), answer: 'A landmark in Paris.', citations: [{ start: 0, end: 19, url: 'https://example.com/history', title: 'History' }] };
  assert.equal(completedSearchAnswer('Please look up what is the Eiffel Tower?', result), result.answer);
  for (const request of ['What is the Eiffel Tower and who built it?', 'Compare the Eiffel Tower with the Louvre', 'Show the Eiffel Tower', 'What is another landmark?']) assert.equal(completedSearchAnswer(request, result), undefined);
  assert.equal(completedSearchAnswer(result.query, { ...result, citations: [] }), undefined);
});

test('research cache is session-local, scoped, abortable and bypasses freshness requests', async () => {
  let calls = 0;
  const search = async (query: string) => { calls++; return demoExploreResult(query, 'web'); };
  const lookup = createVisitorResearchCache();
  await lookup(search, 'stable subject', 'web', signal()); await lookup(search, '  Stable  subject ', 'web', signal()); assert.equal(calls, 1);
  await lookup(search, 'stable subject', 'web', signal(), 'different-subject'); assert.equal(calls, 2);
  await createVisitorResearchCache()(search, 'stable subject', 'web', signal()); assert.equal(calls, 3);
  await lookup(search, 'latest subject', 'web', signal()); await lookup(search, 'latest subject', 'web', signal()); assert.equal(calls, 5);
  const aborted = new AbortController(); aborted.abort(); await assert.rejects(lookup(search, 'stable subject', 'web', aborted.signal)); assert.equal(calls, 5);
  await assert.rejects(lookup(async () => { throw new Error('Synthetic'); }, 'failed', 'web', signal()));
  await lookup(search, 'failed', 'web', signal()); assert.equal(calls, 6);
});

for (const effort of ['none', 'low'] as const) test(`reasoning experiment can explicitly select ${effort} without changing defaults`, async () => {
  await runVisitorTask({ model: 'synthetic', apiKey: 'synthetic', channel: 'chat', reasoningEffort: effort, context: {}, instructions: '', tools: [], signal: signal(), execute: async () => ({ data: {} }), fetch: async (_url, init) => { assert.equal(JSON.parse(String(init?.body)).reasoning.effort, effort); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer' }] }] }); } });
});
