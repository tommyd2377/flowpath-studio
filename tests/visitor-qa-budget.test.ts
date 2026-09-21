import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVisitorQaBudget, visitorQaRequestBound } from '../lib/visitor-qa-budget';
import { safeTestRecorder, type TestRecorder } from '../lib/visitor-test-events';

const recordingId = '00000000-0000-4000-8000-000000000001';
const body = { model: 'gpt-5.6-luna', max_output_tokens: 1200, input: [{ role: 'user', content: 'Published content: café' }], tools: [] };
const config = { recordingId, slugs: ['synthetic-qa'], limitMicros: 3_000_000, voiceReserveMicros: 150_000 };
const record: TestRecorder = Object.assign(() => {}, { recordingId });
const scope = { slug: 'synthetic-qa', record };

test('text bounds include UTF-8 bytes, framing, hosted search and highest output rates', () => {
  const bound = visitorQaRequestBound(body);
  assert.equal(bound.reservedMicros, Buffer.byteLength(JSON.stringify(body)) + 20_000 + 4320);
  const search = visitorQaRequestBound({ ...body, tools: [{ type: 'web_search' }], max_tool_calls: 1 });
  assert.equal(search.feeMicros, 10_000);
  assert.ok(search.inputBound > bound.inputBound + 128_000);
  assert.throws(() => visitorQaRequestBound({ ...body, model: 'unknown' }), /supported price/);
  assert.throws(() => visitorQaRequestBound({ ...body, input: [{ type: 'input_image', image_url: 'https://example.com/test.jpg' }] }), /media inputs/);
  assert.throws(() => visitorQaRequestBound({ ...body, tools: [{ type: 'web_search' }] }), /one-call/);
});

test('only explicit matching recordings reserve; usage frees only a verified upper bound and survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-budget-'));
  try {
    const reserve = createVisitorQaBudget(directory);
    assert.equal(await reserve(body, scope), undefined);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify(config));
    assert.equal(await reserve(body, { ...scope, slug: 'another-publisher' }), undefined);
    await assert.rejects(reserve(body, { slug: scope.slug }), /active local recorder is required/);
    await assert.rejects(reserve(body, { ...scope, record: Object.assign(() => {}, { recordingId: 'another-recording' }) }), /active local recorder is required/);
    const first = await reserve(body, scope);
    assert.ok(first);
    await first.settle({ usage: { input_tokens: 12, output_tokens: 4 } });
    const path = join(directory, `qa-budget-${recordingId}.json`);
    let ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries[0].status, 'reserved');
    await first.settle({ service_tier: 'default', usage: { input_tokens: 12, output_tokens: 4 } });
    ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries[0].chargedMicros, 27);
    assert.equal(ledger.entries[0].status, 'measured');
    const restarted = createVisitorQaBudget(directory);
    await restarted(body, scope); // Abandoned call keeps the reservation after restart.
    ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries.length, 2);
    assert.equal(ledger.entries[1].chargedMicros, visitorQaRequestBound(body).reservedMicros);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 2_000_000 }));
    await assert.rejects(restarted(body, scope), /configuration changed/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent reservations cannot exceed the ceiling; corrupt ledger fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-budget-'));
  try {
    const reserve = createVisitorQaBudget(directory), bound = visitorQaRequestBound(body);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: config.voiceReserveMicros + bound.reservedMicros }));
    const results = await Promise.allSettled([reserve(body, scope), reserve(body, scope)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const path = join(directory, `qa-budget-${recordingId}.json`);
    const ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries.length, 1);
    await writeFile(path, 'broken');
    await assert.rejects(reserve(body, scope), /ledger could not be read/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('safe observer wrappers preserve current recording scope without exposing data', () => {
  const wrapped = safeTestRecorder(record);
  assert.equal(wrapped.recordingId, recordingId);
  let current = recordingId;
  const dynamic = safeTestRecorder(() => {}, () => current);
  assert.equal(dynamic.recordingId, recordingId);
  current = 'another-id';
  assert.equal(dynamic.recordingId, 'another-id');
});

test('real task provider boundary reserves before REST/WebSocket and blocks missing or oversized scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-route-'));
  try {
    await mkdir(join(directory, '.visitor-recordings'));
    await writeFile(join(directory, '.visitor-recordings', 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 200_000 }));
    // A fresh process uses an isolated local config, never the developer's QA
    // ledger. Both transports are mocked and global network access is forbidden.
    const script = `
      import assert from 'node:assert/strict';
      import { runVisitorTask } from ${JSON.stringify(new URL('../lib/visitor-task-runner.ts', import.meta.url).href)};
      import { requestTestRecorder } from ${JSON.stringify(new URL('../lib/visitor-test-recording-store.ts', import.meta.url).href)};
      globalThis.fetch = () => { throw new Error('Network forbidden'); };
      globalThis.visitorTestRecordings = { active: () => true, observer: () => () => {} };
      const record = requestTestRecorder(new Request('http://127.0.0.1:3220/api/visitor/synthetic-qa', { headers: { origin: 'http://127.0.0.1:3220', 'x-flowpath-local-test': '1', 'x-flowpath-test-recording': ${JSON.stringify(recordingId)} } }));
      let calls = 0;
      const payload = { status: 'completed', service_tier: 'default', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic answer.' }] }] };
      const options = { model: 'gpt-5.6-luna', channel: 'chat', apiKey: 'offline-test', instructions: 'Synthetic publisher', context: {}, signal: new AbortController().signal, tools: [], execute: async () => ({ data: {} }), qaSlug: 'synthetic-qa', record, fetch: async () => { calls++; return Response.json(payload); } };
      await assert.rejects(runVisitorTask({ ...options, record: undefined }), /active local recorder/);
      await assert.rejects(runVisitorTask({ ...options, instructions: 'x'.repeat(100000) }), /upper-bound reservation/);
      assert.equal(calls, 0);
      await runVisitorTask(options);
      await runVisitorTask({ ...options, responseRequest: async () => { calls++; return payload; } });
      assert.equal(calls, 2);
    `;
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, env: { NODE_ENV: 'development', PATH: process.env.PATH ?? '' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ledger = JSON.parse(await readFile(join(directory, '.visitor-recordings', `qa-budget-${recordingId}.json`), 'utf8'));
    assert.equal(ledger.entries.length, 2);
    assert.ok(ledger.entries.every((entry: { status: string; chargedMicros: number }) => entry.status === 'measured' && entry.chargedMicros === 28));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
