import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVisitorQaBudget, visitorQaRequestBound } from '../lib/visitor-qa-budget';
import { safeTestRecorder, type TestRecorder } from '../lib/visitor-test-events';
import sharp from 'sharp';

const recordingId = '00000000-0000-4000-8000-000000000001';
const body = { model: 'gpt-5.6-luna', max_output_tokens: 1200, input: [{ role: 'user', content: 'Published content: café' }], tools: [] };
const config = { recordingId, slugs: ['synthetic-qa'], limitMicros: 3_000_000, voiceReserveMicros: 150_000 };
const record: TestRecorder = Object.assign(() => {}, { recordingId });
const scope = { slug: 'synthetic-qa', record };
const astra = { ...body, model: 'gpt-6-astra', reasoning: { effort: 'high' }, service_tier: 'default', max_output_tokens: 8192 };
const astraResponse = (input = 1000, output = 200) => ({ model: astra.model, status: 'completed', service_tier: 'default', usage: {
  input_tokens: input, output_tokens: output, total_tokens: input + output,
  input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 },
} });
async function withBudget(run: (reserve: ReturnType<typeof createVisitorQaBudget>, read: () => Promise<{ entries: Record<string, unknown>[] }>, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-astra-'));
  try {
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 5_000_000 }));
    await run(createVisitorQaBudget(directory), async () => JSON.parse(await readFile(join(directory, `qa-budget-${recordingId}.json`), 'utf8')), directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function requestWithImages(count = 1) {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#546678' } }).jpeg().toBuffer();
  const image = { type: 'input_image', detail: 'low', image_url: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  return { ...body, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Describe the current photo without inventing its identity.' }, ...Array.from({ length: count }, () => ({ ...image }))] }] };
}

test('dictation reserves only fixed bounded PCM and retains its full conservative charge', async () => {
  const audio = { model: 'gpt-transcribe', input_audio_pcm_bytes: 960_000 };
  assert.equal(visitorQaRequestBound(audio).reservedMicros, 4500);
  for (const bytes of [0, 9598, 960_001, 960_002, '960000', NaN, 480001]) {
    assert.throws(() => visitorQaRequestBound({ ...audio, input_audio_pcm_bytes: bytes }), /PCM duration bound/);
  }
  assert.throws(() => visitorQaRequestBound({ ...audio, prompt: 'Extra text' }), /PCM duration bound/);
  await withBudget(async (reserve, read, directory) => {
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: config.voiceReserveMicros + 4500 }));
    await assert.rejects(reserve(audio, { slug: scope.slug }), /active local recorder/);
    const result = await reserve(audio, scope);
    assert.ok(result);
    await result.settle({ text: 'Example transcript', usage: { seconds: 20, type: 'duration' } });
    const entry = (await read()).entries[0];
    assert.equal(entry.chargedMicros, 4500);
    assert.equal(entry.status, 'reserved');
    await assert.rejects(createVisitorQaBudget(directory)(audio, scope), /upper-bound reservation/);
  });
});

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

test('explicit low-detail JPEGs reserve the documented image maximum per occurrence without dropping bytes', async () => {
  const request = await requestWithImages(2), before = JSON.stringify(request);
  const bound = visitorQaRequestBound(request);
  // Low detail: 512/32 squared = 256 patches; Luna multiplier 1.2, rounded
  // up, plus the documented possible one-token billing difference = 309.
  // https://developers.openai.com/api/docs/guides/images-vision#patch-based-image-tokenization
  assert.equal(bound.inputBound, Buffer.byteLength(before) + 20_000 + 309 * 2);
  assert.equal(bound.reservedMicros, bound.inputBound + 4320);
  assert.equal(JSON.stringify(request), before, 'Accounting must not mutate or remove the actual image inputs');
  const literal = { ...body, input: [{ role: 'user', content: 'Explain this JSON: {"type":"input_image","detail":"auto"}, and input_audio.' }] };
  assert.equal(visitorQaRequestBound(literal).inputBound, Buffer.byteLength(JSON.stringify(literal)) + 20_000, 'Quoted user text is not media');
});

test('unknown models, details, media formats and ambiguous image placements fail closed', async () => {
  const request = await requestWithImages(), image = request.input[0].content[1];
  const withPart = (part: unknown) => ({ ...request, input: [{ role: 'user', content: [part] }] });
  for (const detail of [undefined, null, 'auto', 'high', 'original', 'LOW']) {
    assert.throws(() => visitorQaRequestBound(withPart({ ...image, detail })), /media inputs/);
  }
  for (const part of [
    { ...image, file_id: 'file_synthetic' },
    { ...image, image_url: 'https://example.com/image.jpg' },
    { ...image, image_url: 'data:image/png;base64,iVBORw0KGgo=' },
    { ...image, image_url: 'data:image/jpeg;base64,' },
    { ...image, image_url: 'data:image/jpeg;base64,not-base64' },
    { ...image, image_url: `data:image/jpeg;base64,${Buffer.from('not a JPEG').toString('base64')}` },
    { ...image, image_url: `data:image/jpeg;base64,${Buffer.alloc(200_001).toString('base64')}` },
    { ...image, extra: true },
    { type: 'input_audio', input_audio: { data: 'synthetic', format: 'wav' } },
    { type: 'input_file', file_id: 'file_synthetic' },
    { type: 'input_video', video_url: 'https://example.com/video.mp4' },
  ]) assert.throws(() => visitorQaRequestBound(withPart(part)), /media inputs/);
  assert.throws(() => visitorQaRequestBound({ ...request, model: 'gpt-5.6-sol' }), /supported price/);
  assert.throws(() => visitorQaRequestBound({ ...request, input: [image] }), /media inputs/);
  assert.throws(() => visitorQaRequestBound({ ...request, input: [{ role: 'assistant', content: [image] }] }), /media inputs/);
  assert.throws(() => visitorQaRequestBound({ ...request, input: [{ role: 'user', content: [{ wrapper: image }] }] }), /media inputs/);
});

test('image reservations remain cumulative across restart and release only on bounded late usage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-images-'));
  try {
    const request = await requestWithImages(2), bound = visitorQaRequestBound(request);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: config.voiceReserveMicros + bound.reservedMicros * 2 }));
    const reserve = createVisitorQaBudget(directory);
    const first = await reserve(request, scope); assert.ok(first);
    const restarted = createVisitorQaBudget(directory), second = await restarted(request, scope); assert.ok(second);
    await assert.rejects(restarted(request, scope), /upper-bound reservation/);
    await first.settle({ service_tier: 'default', usage: { input_tokens: bound.inputBound + 1, output_tokens: 4 } });
    await second.settle({ usage: { input_tokens: 650, output_tokens: 4 } });
    const path = join(directory, `qa-budget-${recordingId}.json`);
    let ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(ledger.entries.every((entry: { status: string; chargedMicros: number }) => entry.status === 'reserved' && entry.chargedMicros === bound.reservedMicros));
    await first.settle({ service_tier: 'default', usage: { input_tokens: 650, output_tokens: 4 } });
    ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries[0].chargedMicros, 665);
    assert.equal(ledger.entries[1].chargedMicros, bound.reservedMicros, 'An unknown concurrent call keeps its full charge');
    await assert.rejects(restarted(request, scope), /upper-bound reservation/);
    await second.settle({ service_tier: 'default', usage: { input_tokens: 650, output_tokens: 4 } });
    assert.ok(await restarted(request, scope));
    ledger = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(ledger.entries.length, 3);
    assert.equal(ledger.entries.reduce((sum: number, entry: { chargedMicros: number }) => sum + entry.chargedMicros, 0), 1330 + bound.reservedMicros);
  } finally { await rm(directory, { recursive: true, force: true }); }
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

test('an explicitly configured five-dollar batch is accepted and larger ceilings fail closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-five-'));
  try {
    const reserve = createVisitorQaBudget(directory);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 5_000_001 }));
    await assert.rejects(reserve(body, scope), /configuration is invalid/);
    await writeFile(join(directory, 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 5_000_000 }));
    assert.ok(await reserve(body, scope));
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

test('Astra reserves standard/high output, cache-write input, long-context and Fast prices', () => {
  const bound = visitorQaRequestBound(astra);
  assert.equal(bound.outputBound, 8192);
  assert.equal(bound.reservedMicros, Math.ceil(bound.inputBound * 12.5) + 409_600);
  for (const service_tier of [undefined, 'auto', 'fast', 'priority']) {
    const fast = visitorQaRequestBound({ ...astra, service_tier });
    assert.equal(fast.reservedMicros, fast.inputBound * 25 + 819_200, 'Unspecified project routing reserves Fast prices');
  }
  const flex = visitorQaRequestBound({ ...astra, service_tier: 'flex' });
  assert.equal(flex.reservedMicros, Math.ceil(flex.inputBound * 6.25) + 204_800);
  const sized = { ...astra, input: '' };
  const framing = visitorQaRequestBound(sized).inputBound;
  const atThreshold = visitorQaRequestBound({ ...sized, input: 'x'.repeat(272_000 - framing) });
  assert.equal(atThreshold.inputBound, 272_000);
  assert.equal(atThreshold.reservedMicros, 272_000 * 12.5 + 409_600);
  const long = visitorQaRequestBound({ ...sized, input: 'x'.repeat(272_001 - framing) });
  assert.equal(long.inputBound, 272_001);
  assert.equal(long.reservedMicros, 272_001 * 25 + 8192 * 75, 'Long pricing applies to the whole request');
  const longFast = visitorQaRequestBound({ ...astra, service_tier: 'fast', input: 'x'.repeat(273_000) });
  assert.equal(longFast.reservedMicros, longFast.inputBound * 50 + 8192 * 150);
  const search = visitorQaRequestBound({ ...astra, tools: [{ type: 'web_search' }], max_tool_calls: 1 });
  assert.equal(search.feeMicros, 10_000);
  assert.ok(search.inputBound > bound.inputBound + 128_000);
  assert.equal(search.reservedMicros, Math.ceil(search.inputBound * 12.5) + 409_600 + 10_000);
});

test('Astra counts documented low-detail pixels instead of JPEG transport bytes, leaving actual inputs and quoted text intact', async () => {
  const request = { ...await requestWithImages(2), model: astra.model, reasoning: astra.reasoning, service_tier: 'default' };
  const before = JSON.stringify(request);
  const withoutEncodedBytes = JSON.parse(before);
  withoutEncodedBytes.input[0].content.filter((part: { type: string }) => part.type === 'input_image').forEach((part: { image_url: string }) => { part.image_url = ''; });
  const bound = visitorQaRequestBound(request);
  assert.equal(bound.inputBound, Buffer.byteLength(JSON.stringify(withoutEncodedBytes)) + 20_000 + 2 * 309);
  assert.equal(JSON.stringify(request), before);
  const image = request.input[0].content[1]; assert.ok('image_url' in image);
  const quoted = { ...astra, input: [{ role: 'user', content: `Literal input_image data: ${image.image_url}` }] };
  assert.equal(visitorQaRequestBound(quoted).inputBound, Buffer.byteLength(JSON.stringify(quoted)) + 20_000);
  for (const detail of [undefined, 'auto', 'high', 'original']) assert.throws(() => visitorQaRequestBound({ ...request, input: [{ role: 'user', content: [{ ...image, detail }] }] }), /media inputs/);
});

test('Astra rejects unbounded reasoning, unsupported hosted work, implicit server state and unknown routing', () => {
  for (const invalid of [
    { model: 'gpt-6-astra-pro' }, { reasoning: { effort: 'high', mode: 'pro' } }, { reasoning: { effort: 'max' } },
    { service_tier: 'scale' }, { service_tier: 'regional' }, { max_output_tokens: 128_001 },
    { previous_response_id: 'resp_unknown' }, { conversation: 'conv_unknown' }, { prompt: { id: 'stored-prompt' } },
    { context_management: [] }, { background: true }, { tools: [{ type: 'code_interpreter' }] },
    { tools: [{ type: 'web_search' }], max_tool_calls: 2 }, { tools: [{ type: 'web_search' }, { type: 'web_search' }], max_tool_calls: 1 },
    { input: [{ type: 'reasoning', encrypted_content: 'untracked' }] }, { input: [{ type: 'item_reference', id: 'item_unknown' }] },
    { input: [{ type: 'compaction', encrypted_content: 'untracked' }] },
  ]) assert.throws(() => visitorQaRequestBound({ ...astra, ...invalid }), /Local QA budget/);
});

test('Astra settlement uses actual cached/write categories without double charging reasoning', async () => {
  await withBudget(async (reserve, read) => {
    const request = await reserve(astra, scope); assert.ok(request);
    const response = astraResponse();
    response.usage.input_tokens_details = { cached_tokens: 200, cache_write_tokens: 100 };
    await request.settle(response);
    assert.equal((await read()).entries[0].chargedMicros, 700 * 10 + 200 + 100 * 12.5 + 200 * 50);
    const fallback = await reserve(astra, scope); assert.ok(fallback);
    await fallback.settle({ ...response, usage: { ...response.usage, input_tokens_details: { cached_tokens: 200 } } });
    assert.equal((await read()).entries[1].chargedMicros, 1000 * 12.5 + 200 * 50, 'Missing cache-write detail must not be treated as zero');
    const fast = await reserve({ ...astra, service_tier: 'fast' }, scope); assert.ok(fast);
    await fast.settle({ ...response, service_tier: 'fast' });
    assert.equal((await read()).entries[2].chargedMicros, 2 * (700 * 10 + 200 + 100 * 12.5 + 200 * 50));
  });
});

test('unknown or inconsistent Astra usage keeps reservations, and later verified usage can reconcile', async () => {
  await withBudget(async (reserve, read) => {
    const request = await reserve(astra, scope); assert.ok(request);
    const response = astraResponse(), usage = response.usage;
    for (const invalid of [
      { ...response, model: undefined }, { ...response, status: 'in_progress' }, { ...response, service_tier: 'unknown' },
      { ...response, usage: undefined }, { ...response, usage: { ...usage, total_tokens: undefined } },
      { ...response, usage: { ...usage, total_tokens: 999 } },
      { ...response, usage: { ...usage, input_tokens_details: { cached_tokens: -1, cache_write_tokens: 0 } } },
      { ...response, usage: { ...usage, input_tokens_details: { cached_tokens: 800, cache_write_tokens: 201 } } },
      { ...response, usage: { ...usage, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0.5 } } },
      { ...response, usage: { ...usage, output_tokens_details: { reasoning_tokens: 201 } } },
    ]) {
      await request.settle(invalid);
      const entry = (await read()).entries[0];
      assert.equal(entry.status, 'reserved'); assert.equal(entry.chargedMicros, visitorQaRequestBound(astra).reservedMicros);
    }
    await request.settle(response);
    assert.equal((await read()).entries[0].status, 'measured');
    await assert.rejects(request.settle(response), /could not be reconciled/);
  });
});

test('a proven under-reservation blocks later calls until late accounting is reconciled', async () => {
  await withBudget(async (reserve, read) => {
    const request = await reserve(astra, scope); assert.ok(request);
    await request.settle(astraResponse(visitorQaRequestBound(astra).inputBound + 1));
    assert.equal((await read()).entries[0].accountingIssue, true);
    await assert.rejects(reserve(body, scope), /previous response exceeded/);
    await request.settle(astraResponse());
    assert.equal((await read()).entries[0].accountingIssue, undefined);
    const next = await reserve(astra, scope); assert.ok(next);
    await next.settle({ ...astraResponse(20_000, 8192), service_tier: 'fast' });
    assert.equal((await read()).entries[1].accountingIssue, true, 'Unexpected Fast charges above the reservation must not be silently capped');
    await assert.rejects(reserve(astra, scope), /previous response exceeded/);
  });
});

test('exact encrypted items get original output bounds even with unknown usage, across restarts, without persisting their content', async () => {
  await withBudget(async (reserve, read, directory) => {
    const reasoning = { id: 'rs_synthetic', type: 'reasoning', encrypted_content: 'opaque-synthetic-ciphertext', summary: [{ type: 'summary_text', text: 'Private synthetic summary.' }] };
    const request = await reserve(astra, scope); assert.ok(request);
    await request.settle({ model: astra.model, status: 'completed', output: [reasoning] });
    const saved = await read(), stored = JSON.stringify(saved);
    assert.equal(saved.entries[0].chargedMicros, visitorQaRequestBound(astra).reservedMicros);
    assert.equal(saved.entries[0].status, 'reserved');
    assert.ok(!stored.includes('opaque-synthetic') && !stored.includes('Private synthetic') && !stored.includes('rs_synthetic'));
    assert.match((saved.entries[0].reasoningItems as { digest: string }[])[0].digest, /^[a-f0-9]{64}$/);
    const restarted = createVisitorQaBudget(directory);
    const followup = { ...astra, input: [...astra.input, reasoning] };
    assert.throws(() => visitorQaRequestBound(followup), /opaque reasoning/, 'Standalone bounds must not trust unregistered ciphertext');
    const next = await restarted(followup, scope); assert.ok(next);
    assert.equal((await read()).entries[1].inputBound, Buffer.byteLength(JSON.stringify(followup)) + 20_000 + 8192);
    const duplicate = { ...astra, input: [...astra.input, reasoning, reasoning] };
    await restarted(duplicate, scope);
    assert.equal((await read()).entries[2].inputBound, Buffer.byteLength(JSON.stringify(duplicate)) + 20_000 + 8192 * 2, 'Every replayed occurrence consumes input');
    for (const changed of [{ ...reasoning, encrypted_content: 'other' }, { ...reasoning, id: 'rs_other' }, { ...reasoning, summary: [] }]) {
      await assert.rejects(restarted({ ...astra, input: [changed] }, scope), /opaque reasoning/);
    }
    await assert.rejects(restarted({ ...body, input: [reasoning] }, scope), /opaque reasoning/, 'Model families cannot borrow opaque bounds');
    await request.settle({ ...astraResponse(), output: [reasoning] });
    assert.equal((await read()).entries[0].status, 'measured', 'A late receipt still reconciles the original reservation');
  });
});

test('legacy reservations and unknown historical entries stay charged unchanged when Astra is added', async () => {
  await withBudget(async (reserve, read, directory) => {
    const legacy = { id: 'old-reservation', reservedMicros: 123_000, chargedMicros: 123_000, inputBound: 20_000, outputBound: 1200, feeMicros: 0, status: 'reserved' };
    const unknown = { ...legacy, id: 'old-unknown-model', model: 'historical-unknown', reservedMicros: 111_000, chargedMicros: 111_000 };
    const path = join(directory, `qa-budget-${recordingId}.json`);
    await writeFile(path, JSON.stringify({ version: 1, config: { ...config, limitMicros: 5_000_000 }, entries: [legacy, unknown] }));
    const luna = await reserve(body, scope); assert.ok(luna);
    const high = await reserve(astra, scope); assert.ok(high);
    await luna.settle({ service_tier: 'default', usage: { input_tokens: 12, output_tokens: 4 } });
    await high.settle(astraResponse());
    const entries = (await read()).entries;
    assert.deepEqual(entries.slice(0, 2), [legacy, unknown]);
    assert.equal(entries[2].chargedMicros, 27);
    assert.equal(entries[3].chargedMicros, 20_000);
    await assert.rejects(reserve({ ...astra, input: 'x'.repeat(273_000) }, scope), /upper-bound reservation/, 'A documented long-context price does not authorize exceeding the existing $5 ceiling');
    await writeFile(path, JSON.stringify({ version: 1, config: { ...config, limitMicros: 5_000_000 }, entries: [{ ...legacy, reasoningItems: [{ digest: 'invalid', tokenBound: 1200 }] }] }));
    await assert.rejects(reserve(astra, scope), /ledger or configuration changed/);
  });
});

test('real task provider boundary reserves before REST/WebSocket and blocks missing or oversized scope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-route-'));
  try {
    const imageRequest = await requestWithImages(), image = imageRequest.input[0].content[1];
    assert.ok('image_url' in image);
    const imageUrl = image.image_url;
    await mkdir(join(directory, '.visitor-recordings'));
    await writeFile(join(directory, '.visitor-recordings', 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 250_000 }));
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
      const imageUrl = ${JSON.stringify(imageUrl)};
      const imagePayload = { ...payload, usage: { input_tokens: 350, output_tokens: 5 } };
      const imageOptions = { ...options, activeImage: async () => ({ label: 'Current synthetic photo.', image_url: imageUrl }) };
      const verifyImage = body => {
        const image = body.input.find(item => Array.isArray(item.content)).content.find(part => part.type === 'input_image');
        assert.deepEqual(image, { type: 'input_image', image_url: imageUrl, detail: 'low' });
      };
      await runVisitorTask({ ...imageOptions, fetch: async (_url, init) => { calls++; verifyImage(JSON.parse(String(init.body))); return Response.json(imagePayload); } });
      await runVisitorTask({ ...imageOptions, responseRequest: async body => { calls++; verifyImage(body); return imagePayload; } });
      await assert.rejects(runVisitorTask({ ...options, activeImage: async () => ({ label: 'Unsupported remote image.', image_url: 'https://example.com/image.jpg' }) }), /media inputs/);
      assert.equal(calls, 4, 'Unsupported media is blocked before either transport');
    `;
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, env: { NODE_ENV: 'development', PATH: process.env.PATH ?? '' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const ledger = JSON.parse(await readFile(join(directory, '.visitor-recordings', `qa-budget-${recordingId}.json`), 'utf8'));
    assert.equal(ledger.entries.length, 4);
    assert.ok(ledger.entries.every((entry: { status: string }) => entry.status === 'measured'));
    assert.deepEqual(ledger.entries.map((entry: { chargedMicros: number }) => entry.chargedMicros), [28, 28, 368, 368]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real Astra runner reserves each transport round and safely continues with exact opaque output after missing usage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowpath-qa-astra-route-'));
  try {
    await mkdir(join(directory, '.visitor-recordings'));
    await writeFile(join(directory, '.visitor-recordings', 'qa-budget.json'), JSON.stringify({ ...config, limitMicros: 5_000_000 }));
    const script = `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { runVisitorTask } from ${JSON.stringify(new URL('../lib/visitor-task-runner.ts', import.meta.url).href)};
      globalThis.fetch = () => { throw new Error('Network forbidden'); };
      const record = Object.assign(() => {}, { recordingId: ${JSON.stringify(recordingId)} });
      const ledger = async () => JSON.parse(await readFile('.visitor-recordings/qa-budget-${recordingId}.json', 'utf8'));
      let calls = 0;
      const options = { model: 'gpt-6-astra', channel: 'chat', apiKey: 'offline-test', instructions: 'Synthetic publisher', context: {},
        signal: new AbortController().signal, tools: [{ type: 'function', name: 'lookup', description: 'Synthetic lookup', parameters: {} }],
        execute: async () => ({ data: { value: 'Synthetic result.' } }), qaSlug: 'synthetic-qa', record };
      for (const transport of ['http', 'websocket']) {
        let round = 0;
        const reasoning = { id: 'rs_' + transport, type: 'reasoning', encrypted_content: 'opaque_' + transport, summary: [] };
        const response = async body => {
          calls++;
          assert.equal(body.model, 'gpt-6-astra'); assert.equal(body.reasoning.effort, 'high');
          assert.equal(body.service_tier, 'default'); assert.equal(body.max_output_tokens, 8192);
          const entries = (await ledger()).entries;
          assert.equal(entries.length, calls, 'Reservation is persisted before either provider transport');
          assert.equal(entries.at(-1).status, 'reserved');
          if (round++ === 0) return { model: body.model, status: 'completed', output: [reasoning, { type: 'function_call', name: 'lookup', call_id: 'call_' + transport, arguments: '{}' }] };
          assert.equal(entries.at(-2).status, 'reserved', 'Missing first-round usage still holds its full monetary bound');
          assert.deepEqual(body.input.find(item => item.type === 'reasoning'), reasoning);
          assert.equal(entries.at(-1).inputBound, Buffer.byteLength(JSON.stringify(body)) + 20000 + 8192);
          return { model: body.model, status: 'completed', service_tier: 'default', usage: { input_tokens: 5000, output_tokens: 100, total_tokens: 5100,
            input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic completed answer.' }] }] };
        };
        const result = await runVisitorTask({ ...options, ...(transport === 'http' ? { fetch: async (_url, init) => { const body = JSON.parse(String(init.body)); delete body.stream; return Response.json(await response(body)); } } : { responseRequest: response }) });
        assert.equal(result.text, 'Synthetic completed answer.');
        assert.equal((await ledger()).entries.at(-1).chargedMicros, 55000);
      }
      assert.equal(calls, 4);
    `;
    const result = spawnSync(process.execPath, ['--conditions=react-server', '--import', import.meta.resolve('tsx'), '--input-type=module', '--eval', script], {
      cwd: directory, encoding: 'utf8', timeout: 15_000, env: { NODE_ENV: 'development', PATH: process.env.PATH ?? '' },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
